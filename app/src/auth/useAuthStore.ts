// useAuthStore.ts -- account state: Firebase Auth user + sync status. Mirrors
// the "optimistic local write, best-effort remote sync" pattern useStore.ts
// already uses for box settings. See
// docs/rfcs/google-signin-cross-device-sync-architecture.md §4.3, §6.
//
// Never logs user.email/displayName/photoURL/uid (design doc §5 checklist
// item 3) -- SettingsScreen reads them straight off `user` for display only.
//
// Two sign-in providers (Google, Apple) share one Firebase Auth user per
// email via accountLinking.ts: `pendingLink` below surfaces the "sign in
// with your other provider to link" prompt state to SettingsScreen, and
// handleProviderSignIn() completes the link once the user proves ownership
// by signing in with that other provider. linkProvider/unlinkProvider below
// are the separate, additive case: already signed in, and adding/removing
// the OTHER provider deliberately rather than resolving a sign-in conflict.
//
// autoSyncEnabled gates ONLY the automatic syncNow() call in init()'s
// onAuthStateChanged handler below -- syncNow() itself (and the manual
// "Sync now" button that calls it) is never gated by this preference.
import { create } from 'zustand';
import { onAuthStateChanged, unlink, type User } from 'firebase/auth';
import { initFirebaseAuth, getFirebaseAuth } from './firebase';
import {
  signInWithGoogle as signInWithGoogleAuth,
  signOutFully as signOutGoogleFully,
  deleteAccountFully as deleteAccountGoogleFully,
  linkGoogleToCurrentUser,
} from './googleAuth';
import {
  signInWithApple as signInWithAppleAuth,
  signOutFully as signOutAppleFully,
  deleteAccountFully as deleteAccountAppleFully,
  linkAppleToCurrentUser,
} from './appleAuth';
import {
  getPendingLink,
  completePendingLink,
  AccountExistsError,
  type AuthProviderKind,
  type PendingAccountLink,
} from './accountLinking';
import { toProviderKinds, canUnlink, SIGN_IN_NOT_CONFIGURED_MESSAGE } from './accountDisplay';
import { runMigrationAndSync, deleteAllUserData, beginAccountDeletion, endAccountDeletion } from '../sync/firestoreSync';
import { clearLocalAccountData } from '../sync/localDataOwner';
import { useStore } from '../store/useStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { getJSON, setJSON } from '../storage/storage';

export interface AccountUser {
  uid: string;
  email: string | null;
  displayName: string | null;
  photoURL: string | null;
  emailVerified: boolean;
  /** ISO date strings straight off Firebase's user.metadata -- display-only,
   * formatted by accountDisplay.ts's formatShortDate, never parsed for logic. */
  creationTime: string | null;
  lastSignInTime: string | null;
  /** Raw Firebase providerData ids, unfiltered -- so the Account page's chip
   * list can show an "Other" chip (accountDisplay.ts's providerLabel) for a
   * provider id besides google.com/apple.com, per spec §1, rather than
   * silently dropping it the way linkedProviders below deliberately does. */
  providerIds: string[];
  /** providerIds narrowed to the two providers this app's link/unlink
   * actions understand -- same data linkedProviders(user) below has always
   * computed for signOut/deleteAccount's provider-specific branching. */
  linkedProviders: AuthProviderKind[];
}

const LAST_SYNCED_KEY = 'lastSyncedAt';

function toAccountUser(u: User): AccountUser {
  const providerIds = u.providerData.map((p) => p.providerId);
  return {
    uid: u.uid,
    email: u.email,
    displayName: u.displayName,
    photoURL: u.photoURL,
    emailVerified: u.emailVerified,
    creationTime: u.metadata.creationTime ?? null,
    lastSignInTime: u.metadata.lastSignInTime ?? null,
    providerIds,
    linkedProviders: toProviderKinds(providerIds),
  };
}

interface AuthState {
  ready: boolean; // Firebase Auth has finished its initial "do we have a session" check
  /** Set when Firebase Auth failed to start at all (see init() below), so the
   * Account page can say so instead of just showing two dead buttons. Distinct
   * from syncError (auth is up, a Firestore sync failed) and from a sign-in
   * attempt's own error (auth is up, the provider flow failed). Generic,
   * credential-free string, same discipline as the rest of this file. */
  initError: string | null;
  user: AccountUser | null;
  syncing: boolean;
  // The uid syncNow's currently in-flight call was started for, or null when
  // idle. Re-entrancy used to be guarded by a bare `syncing` boolean, so if
  // user A's syncNow was still in flight when user B signed in, B's own
  // syncNow call would no-op (seeing `syncing === true`), and A's stale
  // promise would later settle and unconditionally overwrite whatever was
  // now the *current* store state -- B could inherit A's error message or a
  // bogus lastSyncedAt. Tying the guard (and the result-application check
  // below) to the specific uid a call was started for closes that race: a
  // different uid's syncNow is never blocked by another user's in-flight
  // call, and a completing call only ever applies its result if its uid is
  // still the signed-in user.
  syncingUid: string | null;
  syncError: string | null;
  lastSyncedAt: number | null;
  /** Set when a sign-in attempt hit auth/account-exists-with-different-credential:
   * surfaces "sign in with your other provider to link" to SettingsScreen.
   * Cleared once the user completes that sign-in (link succeeds or fails). */
  pendingLink: PendingAccountLink | null;

  /** Call once at app start (App.tsx's init effect). Runs
   * wipeStaleSessionOnFreshInstall() + initializeAuth() (via
   * initFirebaseAuth(), §2.5's ordering requirement) before attaching the
   * auth-state listener. */
  init: () => Promise<void>;
  signInWithGoogle: () => Promise<void>;
  signInWithApple: () => Promise<void>;
  signOut: () => Promise<void>;
  /** Full account deletion (§4.3, §5 checklist item 12): cascade-deletes
   * what firestore.rules permits, then deletes the Firebase Auth user
   * itself, then clears local account state. See firestoreSync.ts's
   * deleteAllUserData for the one documented exception (session docs are
   * orphaned, not purged, by design). */
  deleteAccount: () => Promise<void>;
  syncNow: () => Promise<void>;
  /** Links `provider`'s credential to the CURRENT signed-in user -- the
   * additive "I'm signed in and want to also add my other method" case.
   * No-op if signed out. Throws (generic, credential-free message) if the
   * link fails, e.g. that credential already belongs to a different
   * Firebase user -- see accountDisplay.ts's providerActionErrorMessage,
   * which UI callers should use to translate the thrown error's `code`. */
  linkProvider: (provider: AuthProviderKind) => Promise<void>;
  /** Unlinks `provider` from the current user. Refuses (throws) unless 2+
   * providers are currently linked -- §1's "never leave zero sign-in
   * methods" rule, enforced here (not just in the UI) so this action is
   * safe to call from anywhere. No-op if signed out. */
  unlinkProvider: (provider: AuthProviderKind) => Promise<void>;
}

/** The providers `user` is currently linked to, read straight off Firebase's
 * own providerData rather than tracked separately -- this can never drift
 * out of sync with what Firebase actually has linked. Delegates the actual
 * id->kind mapping to accountDisplay.ts's toProviderKinds so AccountUser's
 * own linkedProviders field (above) is computed from the exact same logic,
 * not a second copy of it. */
function linkedProviders(user: User): AuthProviderKind[] {
  return toProviderKinds(user.providerData.map((p) => p.providerId));
}

/** Wraps a provider's deleteAccountFully() with exactly one retry on
 * auth/requires-recent-login (spec §4). Each call to `run` already performs
 * its own fresh native sign-in + reauthenticateWithCredential before
 * deleteUser() (see googleAuth.ts/appleAuth.ts's deleteAccountFully), so a
 * first attempt that hit this because that reauth step was itself skipped
 * (e.g. a cancelled native picker, which both files deliberately swallow and
 * fall through past) gets exactly one more chance to complete it. A second
 * failure of any kind propagates unchanged -- deleteAccount's own caller
 * (the Account page) turns any failure here into one generic,
 * credential-free message, never this raw error. */
async function deleteWithReauthRetry(run: () => Promise<void>): Promise<void> {
  try {
    await run();
  } catch (e: any) {
    if (e?.code !== 'auth/requires-recent-login') throw e;
    await run();
  }
}

/** Shared by signInWithGoogle/signInWithApple below: runs the provider's own
 * sign-in, and if it succeeds while a link conflict was pending FOR THIS
 * provider (i.e. this sign-in is the "other provider" the user was asked to
 * prove ownership with), completes the link. `pendingLink` is cleared as
 * soon as `doSignIn` succeeds regardless of what linkWithCredential does
 * next -- the user has done what was asked; a link failure surfaces as a
 * normal error, not a stuck prompt. */
async function handleProviderSignIn(
  provider: AuthProviderKind,
  doSignIn: () => Promise<User>,
  set: (partial: Partial<AuthState>) => void,
): Promise<void> {
  try {
    const user = await doSignIn();
    const pending = getPendingLink();
    set({ pendingLink: null });
    if (pending && pending.linkWithProvider === provider) {
      await completePendingLink(user);
    }
  } catch (e: any) {
    if (e instanceof AccountExistsError) {
      set({ pendingLink: e.pending });
    }
    throw e;
  }
}

const AUTH_INIT_ERROR = "Couldn't start sign-in. Check your connection and try again.";
// A FirebaseConfigError (firebase.ts) means the build itself is missing/has
// invalid Firebase config -- no amount of retrying or checking the network
// fixes that, so it gets its own message rather than AUTH_INIT_ERROR's
// "check your connection" wording, which would send a user chasing the
// wrong problem.
function initErrorMessageFor(e: any): string {
  return e?.name === 'FirebaseConfigError' ? SIGN_IN_NOT_CONFIGURED_MESSAGE : AUTH_INIT_ERROR;
}
// Watchdog for init(): everything it awaits is local (SecureStore/AsyncStorage
// reads, then initializeAuth -- no network; Firebase fires onAuthStateChanged
// off local persistence without waiting on a token refresh), so taking this
// long means it isn't coming. Covers the failure mode a try/catch can't: a
// promise that never settles rather than one that rejects, which left `ready`
// false -- and both sign-in buttons greyed out -- just as permanently.
// Deliberately self-healing: if auth does come up late, onAuthStateChanged
// sets ready and clears initError, so a false positive costs a stale message
// for a moment and nothing else.
const AUTH_INIT_TIMEOUT_MS = 10_000;

/** Registered exactly once, by whichever of init() or a sign-in retry first
 * gets initFirebaseAuth() to resolve. The unsubscribe onAuthStateChanged
 * returns is deliberately never called (the listener lives as long as the
 * process), so a second registration would be a permanent duplicate --
 * every auth change would fire syncNow() twice. */
let authListenerAttached = false;

/** startFirebaseAuth() for the sign-in path: same retry, but any failure
 * surfaces as this file's one generic, credential-free string rather than a
 * raw SDK message (design doc §5 checklist item 3 -- SignedOutAccount renders
 * `e.message` verbatim). The underlying error is logged, not shown. */
async function requireFirebaseAuth(
  set: (partial: Partial<AuthState>) => void,
  get: () => AuthState,
): Promise<void> {
  try {
    await startFirebaseAuth(set, get);
  } catch (e: any) {
    console.warn('[useAuthStore] Firebase Auth init failed on sign-in:', e?.message ?? e);
    const message = initErrorMessageFor(e);
    set({ initError: message });
    throw new Error(message);
  }
}

async function startFirebaseAuth(
  set: (partial: Partial<AuthState>) => void,
  get: () => AuthState,
): Promise<void> {
  await initFirebaseAuth();
  if (authListenerAttached) return;
  authListenerAttached = true;
  onAuthStateChanged(getFirebaseAuth(), (u) => {
    set({ ready: true, initError: null, user: u ? toAccountUser(u) : null });
    // autoSyncEnabled (useSettingsStore) gates ONLY this automatic call --
    // a local-only per-device preference (§3), off by exception rather
    // than by default. The manual "Sync now" button calls syncNow()
    // directly and is unaffected either way.
    if (u && useSettingsStore.getState().autoSyncEnabled) {
      get().syncNow(); // fire-and-forget: migration/sync never blocks the UI
    }
  });
}

export const useAuthStore = create<AuthState>((set, get) => ({
  ready: false,
  initError: null,
  user: null,
  syncing: false,
  syncingUid: null,
  syncError: null,
  lastSyncedAt: null,
  pendingLink: null,

  init: async () => {
    // Its own catch: a read failure here is cosmetic (a missing "last synced"
    // timestamp) and must not take auth down with it, which is exactly what
    // it used to do by rejecting before initFirebaseAuth() was even reached.
    // Armed before the first await, so it also covers a hang in the
    // lastSyncedAt read below. Never cleared: it self-cancels via the `ready`
    // check, and one pending 10s timer per app launch is not worth tracking.
    setTimeout(() => {
      if (get().ready) return;
      console.warn(
        `[useAuthStore] Firebase Auth did not start within ${AUTH_INIT_TIMEOUT_MS}ms; releasing the sign-in gate.`,
      );
      set({ ready: true, initError: AUTH_INIT_ERROR });
    }, AUTH_INIT_TIMEOUT_MS);
    const lastSyncedAt = await getJSON<number | null>(LAST_SYNCED_KEY, null).catch(() => null);
    set({ lastSyncedAt });
    try {
      await startFirebaseAuth(set, get);
    } catch (e: any) {
      // `ready` gates both sign-in buttons (SignedOutAccount), and it was only
      // ever set inside the onAuthStateChanged callback above -- which is
      // never reached if this throws. Combined with App.tsx swallowing the
      // rejection silently, one failure here left the buttons permanently
      // disabled with nothing logged and nothing shown: "logging in doesn't
      // work", with no error to report. Release the gate and say so instead;
      // initFirebaseAuth() no longer caches its rejection, so the retry the
      // sign-in actions below make can actually succeed.
      console.warn('[useAuthStore] Firebase Auth init failed:', e?.message ?? e);
      set({ ready: true, initError: initErrorMessageFor(e) });
    }
  },

  signInWithGoogle: async () => {
    set({ syncError: null });
    await requireFirebaseAuth(set, get); // no-op once started; retries a failed init()
    await handleProviderSignIn('google', signInWithGoogleAuth, set);
    // onAuthStateChanged (above) picks up the new user and triggers syncNow().
  },

  signInWithApple: async () => {
    set({ syncError: null });
    await requireFirebaseAuth(set, get); // no-op once started; retries a failed init()
    await handleProviderSignIn('apple', signInWithAppleAuth, set);
    // onAuthStateChanged (above) picks up the new user and triggers syncNow().
  },

  signOut: async () => {
    // Both providers' signOutFully() do the same generic Firebase
    // auth.signOut() + SecureStore wipe (redundant but harmless if both run);
    // only Google's additionally revokes its native OAuth grant, which is
    // why a both-linked account runs both rather than just one.
    const auth = getFirebaseAuth();
    const providers = auth.currentUser ? linkedProviders(auth.currentUser) : [];
    if (providers.includes('apple')) await signOutAppleFully();
    if (providers.includes('google') || providers.length === 0) await signOutGoogleFully();
    // After sign-out, not before: clearing settings triggers
    // settingsSyncBridge's push subscription, which itself no-ops once
    // signed out, but ordering it this way makes that explicit rather than
    // relying on the no-op.
    await clearLocalAccountData();
    // clearLocalAccountData() only wipes AsyncStorage -- useStore.sessions
    // (what StatsScreen/DashboardScreen/CalendarScreen actually render) needs
    // its own update or it keeps showing this account's sessions until the
    // next BLE history event or an app restart.
    useStore.getState().setSessions([]);
    set({ user: null, lastSyncedAt: null, syncError: null });
    await setJSON<number | null>(LAST_SYNCED_KEY, null);
  },

  deleteAccount: async () => {
    const user = get().user;
    if (!user) return;
    // Order matters: Firestore data must go first, while still authenticated
    // as this uid -- see deleteAllUserData's own header comment. Local data
    // is cleared last, after the Auth user is gone, for the same reason
    // signOut clears after signOutFully -- no lingering local data once
    // nobody is signed in on this device.
    //
    // beginAccountDeletion/endAccountDeletion bracket the whole sequence so
    // the best-effort push bridges (sessionsSyncBridge/settingsSyncBridge)
    // can't re-create a doc deleteAllUserData just wiped -- deleteAccountFully
    // re-authenticates via a fresh native sign-in, which can take a while,
    // and a settings/session change landing in that window (still
    // authenticated as this uid) would otherwise repush straight back in.
    //
    // deleteUser() only needs to run once -- it removes the Firebase Auth
    // user and ALL its linked provider associations in a single call, so
    // when both providers are linked this deliberately picks exactly one
    // (Google, if present) to reauthenticate with rather than running both
    // deleteAccountFully()s, which would double-prompt (Google picker +
    // Apple sheet) for no benefit.
    const auth = getFirebaseAuth();
    const providers = auth.currentUser ? linkedProviders(auth.currentUser) : [];
    const deleteAccountFully = providers.includes('apple') && !providers.includes('google')
      ? deleteAccountAppleFully
      : deleteAccountGoogleFully;
    beginAccountDeletion(user.uid);
    try {
      await deleteAllUserData(user.uid);
      await deleteWithReauthRetry(deleteAccountFully);
    } finally {
      endAccountDeletion();
    }
    await clearLocalAccountData();
    // See signOut's identical call: clearLocalAccountData() only clears
    // AsyncStorage, not the live store the Stats/Dashboard/Calendar screens read.
    useStore.getState().setSessions([]);
    set({ user: null, lastSyncedAt: null, syncError: null });
    await setJSON<number | null>(LAST_SYNCED_KEY, null);
  },

  syncNow: async () => {
    const user = get().user;
    if (!user) return;
    const uid = user.uid;
    // Only re-entrancy for this SAME uid is guarded -- a different uid's own
    // call (e.g. B signing in right after A's syncNow started) must not be
    // blocked just because some other user's sync happens to be in flight.
    if (get().syncingUid === uid) return;
    set({ syncing: true, syncingUid: uid, syncError: null });
    try {
      await runMigrationAndSync(uid);
      const now = Date.now();
      // Apply the result only if `uid` is still the signed-in user -- a
      // stale call for a since-signed-out (or since-switched) uid must not
      // clobber whichever user is actually current by now.
      if (get().user?.uid === uid) {
        set({ lastSyncedAt: now });
        await setJSON(LAST_SYNCED_KEY, now);
      }
    } catch (e: any) {
      if (get().user?.uid === uid) {
        // Generic message only -- never interpolate e's full payload in case
        // a future error type ever carries more than a plain string message.
        set({ syncError: typeof e?.message === 'string' ? e.message : 'Sync failed' });
      }
    } finally {
      if (get().syncingUid === uid) set({ syncing: false, syncingUid: null });
    }
  },

  linkProvider: async (provider) => {
    const auth = getFirebaseAuth();
    const current = auth.currentUser;
    if (!current) return;
    // Deliberately not routed through handleProviderSignIn/pendingLink --
    // that flow is for the sign-in-time conflict case (not yet signed in,
    // Firebase itself rejected the credential). Here the user is already
    // signed in and choosing to add their other provider on purpose, so this
    // goes straight to linkGoogleToCurrentUser/linkAppleToCurrentUser, which
    // call Firebase's linkWithCredential on the CURRENT user instead of
    // signInWithCredential (see those functions' own comments for why that
    // distinction matters).
    const uid = current.uid;
    const updated = provider === 'google'
      ? await linkGoogleToCurrentUser(current)
      : await linkAppleToCurrentUser(current);
    // Same stale-uid discipline as syncNow's own result-application check
    // above: the native picker/sheet this just awaited can stay open
    // indefinitely, so a sign-out (or a completed deleteAccount) can land
    // while it's up. Applying `updated` unconditionally would then repopulate
    // `user` with an account nobody is signed in as any more, leaving the
    // Account page rendering a signed-in state after sign-out.
    if (get().user?.uid === uid) set({ user: toAccountUser(updated) });
  },

  unlinkProvider: async (provider) => {
    const auth = getFirebaseAuth();
    const current = auth.currentUser;
    if (!current) return;
    if (!canUnlink(current.providerData.map((p) => p.providerId))) {
      // Generic, credential-free message matching this file's other thrown
      // errors -- this should be unreachable from a UI that itself gates the
      // Unlink action on canUnlink, but the store-level check is what makes
      // this action safe to call from anywhere, not just a UI that
      // remembered to check first.
      throw new Error('Cannot remove your only sign-in method.');
    }
    const providerId = provider === 'google' ? 'google.com' : 'apple.com';
    const uid = current.uid;
    const updated = await unlink(current, providerId);
    if (get().user?.uid === uid) set({ user: toAccountUser(updated) }); // see linkProvider's note
  },
}));
