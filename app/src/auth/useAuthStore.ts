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
// by signing in with that other provider.
import { create } from 'zustand';
import { onAuthStateChanged, type User } from 'firebase/auth';
import { initFirebaseAuth, getFirebaseAuth } from './firebase';
import {
  signInWithGoogle as signInWithGoogleAuth,
  signOutFully as signOutGoogleFully,
  deleteAccountFully as deleteAccountGoogleFully,
} from './googleAuth';
import {
  signInWithApple as signInWithAppleAuth,
  signOutFully as signOutAppleFully,
  deleteAccountFully as deleteAccountAppleFully,
} from './appleAuth';
import {
  getPendingLink,
  completePendingLink,
  AccountExistsError,
  type AuthProviderKind,
  type PendingAccountLink,
} from './accountLinking';
import { runMigrationAndSync, deleteAllUserData, beginAccountDeletion, endAccountDeletion } from '../sync/firestoreSync';
import { clearLocalAccountData } from '../sync/localDataOwner';
import { useStore } from '../store/useStore';
import { getJSON, setJSON } from '../storage/storage';

export interface AccountUser {
  uid: string;
  email: string | null;
  displayName: string | null;
  photoURL: string | null;
}

const LAST_SYNCED_KEY = 'lastSyncedAt';

function toAccountUser(u: User): AccountUser {
  return { uid: u.uid, email: u.email, displayName: u.displayName, photoURL: u.photoURL };
}

interface AuthState {
  ready: boolean; // Firebase Auth has finished its initial "do we have a session" check
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
}

/** The providers `user` is currently linked to, read straight off Firebase's
 * own providerData rather than tracked separately -- this can never drift
 * out of sync with what Firebase actually has linked. */
function linkedProviders(user: User): AuthProviderKind[] {
  return user.providerData
    .map((p) => p.providerId)
    .filter((id): id is 'google.com' | 'apple.com' => id === 'google.com' || id === 'apple.com')
    .map((id) => (id === 'google.com' ? 'google' : 'apple'));
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

export const useAuthStore = create<AuthState>((set, get) => ({
  ready: false,
  user: null,
  syncing: false,
  syncingUid: null,
  syncError: null,
  lastSyncedAt: null,
  pendingLink: null,

  init: async () => {
    const lastSyncedAt = await getJSON<number | null>(LAST_SYNCED_KEY, null);
    set({ lastSyncedAt });
    await initFirebaseAuth();
    const auth = getFirebaseAuth();
    onAuthStateChanged(auth, (u) => {
      set({ ready: true, user: u ? toAccountUser(u) : null });
      if (u) {
        get().syncNow(); // fire-and-forget: migration/sync never blocks the UI
      }
    });
  },

  signInWithGoogle: async () => {
    set({ syncError: null });
    await handleProviderSignIn('google', signInWithGoogleAuth, set);
    // onAuthStateChanged (above) picks up the new user and triggers syncNow().
  },

  signInWithApple: async () => {
    set({ syncError: null });
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
      await deleteAccountFully();
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
}));
