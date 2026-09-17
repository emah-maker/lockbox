// useAuthStore.ts -- account state: Firebase Auth user + sync status. Mirrors
// the "optimistic local write, best-effort remote sync" pattern useStore.ts
// already uses for box settings. See
// docs/rfcs/google-signin-cross-device-sync-architecture.md §4.3, §6.
//
// Never logs user.email/displayName/photoURL/uid (design doc §5 checklist
// item 3) -- SettingsScreen reads them straight off `user` for display only.
//
// Three sign-in providers (Google, Apple, email/password) share one Firebase
// Auth user per email via accountLinking.ts: `pendingLink` below surfaces the
// "sign in with one of your other providers to link" prompt state to
// SettingsScreen, and handleProviderSignIn() completes the link once the
// user proves ownership by signing in with one of those other providers.
// linkProvider/linkEmailPassword/unlinkProvider below are the separate,
// additive case: already signed in, and adding/removing another provider
// deliberately rather than resolving a sign-in conflict.
//
// autoSyncEnabled gates ONLY the automatic syncNow() call in init()'s
// onAuthStateChanged handler below -- syncNow() itself (and the manual
// "Sync now" button that calls it) is never gated by this preference.
import { create } from 'zustand';
import { onAuthStateChanged, unlink, type User } from 'firebase/auth';
import { initFirebaseAuth, getFirebaseAuth, getAuthInitStage } from './firebase';
import {
  signInWithGoogle as signInWithGoogleAuth,
  signOutFully as signOutGoogleFully,
  reauthenticateForDeletion as reauthenticateGoogleForDeletion,
  deleteUserAccount as deleteGoogleUserAccount,
  linkGoogleToCurrentUser,
} from './googleAuth';
import {
  signInWithApple as signInWithAppleAuth,
  signOutFully as signOutAppleFully,
  reauthenticateForDeletion as reauthenticateAppleForDeletion,
  deleteUserAccount as deleteAppleUserAccount,
  linkAppleToCurrentUser,
} from './appleAuth';
import {
  signInWithEmail as signInWithEmailAuth,
  createAccountWithEmail as createAccountWithEmailAuth,
  sendPasswordReset as sendPasswordResetAuth,
  linkEmailToCurrentUser,
  signOutFully as signOutEmailFully,
  reauthenticateForDeletion as reauthenticateEmailForDeletion,
  deleteUserAccount as deleteEmailUserAccount,
} from './emailAuth';
import {
  getPendingLink,
  completePendingLink,
  clearPendingLink,
  AccountExistsError,
  type AuthProviderKind,
  type PendingAccountLink,
} from './accountLinking';
import {
  toProviderKinds,
  canUnlink,
  syncErrorMessage,
  providerActionErrorMessage,
  SIGN_IN_NOT_CONFIGURED_MESSAGE,
} from './accountDisplay';
import { runMigrationAndSync, deleteAllUserData, beginAccountDeletion, endAccountDeletion } from '../sync/firestoreSync';
import { clearLocalAccountData } from '../sync/localDataOwner';
import { unregisterPushToken } from '../push/pushRegistration';
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
   * provider id besides google.com/apple.com/password, per spec §1, rather
   * than silently dropping it the way linkedProviders below deliberately does. */
  providerIds: string[];
  /** providerIds narrowed to the three providers this app's link/unlink
   * actions understand -- same data linkedProviders(user) below has always
   * computed for signOut/deleteAccount's provider-specific branching. */
  linkedProviders: AuthProviderKind[];
}

/** linkProvider (below) only ever runs a native picker/sheet -- there is no
 * typed-credential equivalent of that for a password, so linking one has its
 * own action (linkEmailPassword) instead. Excluding 'password' here makes
 * passing it to linkProvider a compile error rather than a runtime no-op or,
 * worse, silently falling into the wrong branch of a ternary that assumed
 * only two members. */
type OAuthProviderKind = Exclude<AuthProviderKind, 'password'>;

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
  /** Set when a sign-in succeeded but the cross-provider link it was meant to
   * complete then failed (handleProviderSignIn below). Its own field rather
   * than syncError or a thrown error: the user IS signed in, so this is not a
   * sign-in failure, and the place to say so is the signed-in Account page's
   * Sign-in methods section -- which is also where the remedy (the "Link
   * Google"/"Link Apple" button) lives. Cleared on sign-out and by the next
   * link/unlink action. */
  linkError: string | null;
  lastSyncedAt: number | null;
  /** Set when a sign-in attempt hit auth/account-exists-with-different-credential:
   * surfaces "sign in with one of your other providers to link" to
   * SettingsScreen. Cleared once the user completes that sign-in (link
   * succeeds or fails). */
  pendingLink: PendingAccountLink | null;

  /** Call once at app start (App.tsx's init effect). Runs
   * wipeStaleSessionOnFreshInstall() + initializeAuth() (via
   * initFirebaseAuth(), §2.5's ordering requirement) before attaching the
   * auth-state listener. */
  init: () => Promise<void>;
  signInWithGoogle: () => Promise<void>;
  signInWithApple: () => Promise<void>;
  /** Signs in with an existing email/password account. Can still complete a
   * pending cross-provider link the same way signInWithGoogle/
   * signInWithApple do -- handleProviderSignIn checks the pending link's
   * candidateProviders, not which path the sign-in itself took -- even
   * though this path never THROWS the conflict that creates one; see
   * emailAuth.ts's signInWithEmail for why. */
  signInWithEmail: (email: string, password: string) => Promise<void>;
  /** Creates a brand-new email/password account and signs it in. Deliberately
   * never completes a pending link -- see this action's own implementation
   * comment for why that would be unsafe to do here. */
  createAccountWithEmail: (email: string, password: string) => Promise<void>;
  /** Sends a password-reset email; resolves the same way whether or not
   * `email` has an account (see emailAuth.ts's sendPasswordReset). */
  sendPasswordReset: (email: string) => Promise<void>;
  signOut: () => Promise<void>;
  /** Full account deletion (§4.3, §5 checklist item 12): re-authenticates
   * FIRST (proving recent presence before anything irreversible runs),
   * then cascade-deletes what firestore.rules permits, then deletes the
   * Firebase Auth user itself, then clears local account state. A cancelled
   * or failed re-auth aborts the whole flow untouched. "What firestore.rules
   * permits" now includes the session log, but only because deleteAllUserData
   * deletes the parent user doc first to open that window -- see its docblock
   * before reordering anything in this flow. See also this file's
   * AccountDataWipedError for the one abnormal outcome (data wiped, Auth
   * user deletion itself then failed).
   *
   * `password` is required only when email/password ends up the CHOSEN
   * provider for this deletion (see this action's own comment for the
   * google > apple > password preference order) -- every other case ignores
   * it. Throws PasswordRequiredError, BEFORE any of the above runs, if it's
   * needed and wasn't passed. */
  deleteAccount: (password?: string) => Promise<void>;
  syncNow: () => Promise<void>;
  /** Links `provider`'s credential to the CURRENT signed-in user -- the
   * additive "I'm signed in and want to also add my other method" case.
   * No-op if signed out. Throws (generic, credential-free message) if the
   * link fails, e.g. that credential already belongs to a different
   * Firebase user -- see accountDisplay.ts's providerActionErrorMessage,
   * which UI callers should use to translate the thrown error's `code`.
   * Google/Apple only -- linking a password needs typed credentials rather
   * than a native picker/sheet, so it has its own action (linkEmailPassword)
   * instead, and `provider` is typed to make passing 'password' here a
   * compile error rather than a silent no-op/wrong branch. */
  linkProvider: (provider: OAuthProviderKind) => Promise<void>;
  /** The password counterpart to linkProvider -- see its doc comment for why
   * it's a separate action instead of a case linkProvider handles. */
  linkEmailPassword: (email: string, password: string) => Promise<void>;
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

/** Wraps a provider's reauthenticateForDeletion() with exactly one retry on
 * auth/requires-recent-login (spec §4). This runs BEFORE any destructive
 * step in deleteAccount below -- a cancelled native picker/sheet throws a
 * plain (non-`auth/requires-recent-login`) error from
 * googleAuth.ts/appleAuth.ts's reauthenticateForDeletion, which is rethrown
 * immediately below without a second prompt; only a genuine
 * requires-recent-login failure gets one more attempt. A second failure of
 * any kind propagates unchanged -- deleteAccount's own caller (the Account
 * page) turns any failure here into one generic, credential-free message,
 * never this raw error. */
async function deleteWithReauthRetry(run: () => Promise<void>): Promise<void> {
  try {
    await run();
  } catch (e: any) {
    if (e?.code !== 'auth/requires-recent-login') throw e;
    await run();
  }
}

/** Thrown by deleteAccount() below in the one abnormal case it can produce:
 * deleteAllUserData(uid) already succeeded (cloud settings/goals/devices/etc.
 * are irreversibly gone) but the Auth-user deletion that follows it
 * (deleteUserAccount) failed, so the user is left signed in. Callers
 * (DangerZoneSection) must check for this and show a message that says the
 * data is gone even though the account isn't -- never the generic "please
 * try again" text, which would imply nothing happened. `cause` is logged,
 * never shown (matches this file's credential-free-message discipline). */
export class AccountDataWipedError extends Error {
  constructor(public readonly cause: unknown) {
    super('Account data was deleted, but removing the sign-in itself failed.');
    this.name = 'AccountDataWipedError';
  }
}

/** Thrown by deleteAccount() below, BEFORE beginAccountDeletion and before
 * anything destructive runs, when email/password is the chosen provider for
 * this deletion (see deleteAccount's own comment for the preference order)
 * and no password was passed in. Unlike a cancelled native Google picker/
 * Apple sheet -- which the OAuth paths treat as a hard failure that aborts an
 * already-started flow -- there is no native prompt this store can trigger on
 * its own for a password, so the flow can't even start without one: callers
 * (the Account page) must catch this by name, collect a password, and retry
 * with it. */
export class PasswordRequiredError extends Error {
  constructor(message = 'A password is required to delete this account.') {
    super(message);
    this.name = 'PasswordRequiredError';
  }
}

/**
 * Everything that has to happen once nobody is signed in on this device any
 * more -- the tail of BOTH signOut and deleteAccount, which were the same
 * six statements twice with the same three comments explaining them.
 *
 * Runs AFTER the provider sign-out / Auth-user deletion, never before:
 * clearing settings triggers settingsSyncBridge push subscription, which
 * itself no-ops once signed out, but ordering it this way makes that
 * explicit rather than relying on the no-op.
 */
async function clearSignedInState(set: (partial: Partial<AuthState>) => void): Promise<void> {
  await clearLocalAccountData();
  // clearLocalAccountData() only wipes AsyncStorage -- useStore.sessions
  // (what StatsScreen/DashboardScreen/CalendarScreen actually render) needs
  // its own update or it keeps showing the previous account's sessions until
  // the next BLE history event or an app restart.
  useStore.getState().setSessions([]);
  set({ user: null, lastSyncedAt: null, syncError: null, linkError: null });
  // A credential stashed by an earlier conflict is now both moot and unsafe
  // to keep -- without this it survived sign-out entirely, ready for the NEXT
  // person to sign in on this device to have it silently linked onto their
  // account. See dismissPendingLink just below.
  dismissPendingLink(set);
  await setJSON<number | null>(LAST_SYNCED_KEY, null);
}

/** Clears BOTH halves of the pending-link state: accountLinking.ts's
 * module-level stashed credential AND this store's UI mirror of it.
 *
 * They are two separate pieces of state and every path that abandons a
 * pending link must clear both, which is exactly what was going wrong:
 * `set({ pendingLink: null })` alone only takes the prompt off the screen,
 * while the stashed credential lives on in accountLinking.ts's module
 * singleton. clearPendingLink() was exported but called from no production
 * path at all -- only tests -- so an abandoned link left a live credential
 * behind indefinitely. Because handleProviderSignIn below consults
 * getPendingLink() (the module state, not this store's copy), the next
 * successful sign-in by ANY candidate provider would then silently link that
 * orphaned credential onto whatever account had just authenticated -- an
 * unrelated one, possibly under a different email. Routing every dismissal
 * through here is what keeps the two from diverging.
 */
function dismissPendingLink(set: (partial: Partial<AuthState>) => void): void {
  clearPendingLink();
  set({ pendingLink: null });
}

/** Whether the account that just signed in is the one the pending conflict
 * was actually about.
 *
 * candidateProviders answers "is this one of the METHODS we asked for", which
 * was the only thing checked -- and a method is not an identity. On a shared
 * phone: A taps Google, hits the conflict, and leaves the prompt up naming
 * a@example.com. B then signs in with their own email/password. 'password' is
 * a candidate, so A's stashed Google credential was linked onto B's account,
 * and A could afterwards sign in with one tap AS B. accountLinking.ts's header
 * states that a credential is only ever linked "once the user has proven
 * ownership"; proving you hold *some* account by *some* listed method is not
 * that proof. This is the check that makes the sentence true.
 *
 * Fails closed on a missing email on either side. The two are always both
 * present in the legitimate case -- Firebase only raises
 * account-exists-with-different-credential when it matched an existing
 * account BY email, so the account the user then signs into carries that same
 * address -- which leaves no honest reason to link when either is unknown.
 * Nothing is lost by refusing: the user is signed in, and the Account page's
 * "Link Google" action performs the same link deliberately, on an account
 * they are demonstrably already inside.
 */
function ownsPendingLink(pending: PendingAccountLink, user: User): boolean {
  if (!pending.email || !user.email) return false;
  // Case-insensitively: Firebase stores the address as registered, so the
  // conflict's customData.email and the signed-in user's can differ in case
  // alone for one and the same account.
  return pending.email.trim().toLowerCase() === user.email.trim().toLowerCase();
}

/** Shared by signInWithGoogle/signInWithApple/signInWithEmail below: runs the
 * provider's own sign-in, and if it succeeds while a link conflict was
 * pending and this provider is one of its candidateProviders (i.e. this
 * sign-in is one of the ways the user was asked to prove ownership), completes
 * the link. `pendingLink` is cleared as soon as `doSignIn` succeeds
 * regardless of what linkWithCredential does next -- the user has done what
 * was asked; a link failure surfaces as a normal error, not a stuck prompt. */
async function handleProviderSignIn(
  provider: AuthProviderKind,
  doSignIn: () => Promise<User>,
  set: (partial: Partial<AuthState>) => void,
): Promise<void> {
  try {
    const user = await doSignIn();
    const pending = getPendingLink();
    set({ pendingLink: null });
    if (pending && pending.candidateProviders.includes(provider) && ownsPendingLink(pending, user)) {
      try {
        await completePendingLink(user); // consumes and clears the stashed credential itself
      } catch (e: any) {
        // Reported, not rethrown. doSignIn() already SUCCEEDED -- the user is
        // signed in -- so letting this out of signInWithGoogle/Apple/Email
        // made a sign-in that worked look like one that failed: the caller
        // logged it as 'sign-in failed', and the message it produced was
        // written into SignedOutAccount's own state at the exact moment
        // AccountSection swaps that component out for the signed-in view
        // (`user` is set by then), so it rendered to nobody. The link
        // silently did not happen and nothing anywhere said so.
        console.warn('[useAuthStore] pending link failed after sign-in:', e?.code ?? e?.name ?? e?.message ?? e);
        // `?? LINK_FAILED` because providerActionErrorMessage returns null for
        // a user-initiated cancel -- correct where a picker was open, but
        // there is no picker on this path, so a null here would mean the
        // link quietly failed with nothing on screen: the exact outcome this
        // block exists to end.
        set({ linkError: providerActionErrorMessage(e, LINK_FAILED_MESSAGE) ?? LINK_FAILED_MESSAGE });
      }
    } else {
      // Not a candidate (or nothing pending): there is no link to complete,
      // but any stashed credential must still go rather than be left for a
      // later, unrelated sign-in to pick up -- see dismissPendingLink above.
      // Reachable whenever a conflicted provider later succeeds on its own,
      // e.g. the user retries Google and picks a different Google account.
      dismissPendingLink(set);
    }
  } catch (e: any) {
    if (e instanceof AccountExistsError) {
      set({ pendingLink: e.pending });
    }
    throw e;
  }
}

/** Shown on the signed-in Account page when a sign-in completed but the
 * cross-provider link it was meant to finish did not -- see
 * handleProviderSignIn's catch. Points at Sign-in methods, the section that
 * renders this and also carries the Link buttons that are the remedy. */
const LINK_FAILED_MESSAGE = "Couldn't finish linking your accounts. You can add that sign-in method below.";

const AUTH_INIT_ERROR = "Couldn't start sign-in. Check your connection and try again.";
// A FirebaseConfigError (firebase.ts) means the build itself is missing/has
// invalid Firebase config -- no amount of retrying or checking the network
// fixes that, so it gets its own message rather than AUTH_INIT_ERROR's
// "check your connection" wording, which would send a user chasing the
// wrong problem.
function initErrorMessageFor(e: any): string {
  return e?.name === 'FirebaseConfigError'
    ? SIGN_IN_NOT_CONFIGURED_MESSAGE
    : `${AUTH_INIT_ERROR} ${initFailureTag(e)}`;
}

/** The stall stage, plus the error's name/code when there was an error at all,
 * appended to AUTH_INIT_ERROR's user-facing text.
 *
 * This is deliberately shown rather than only logged. describeInitError below
 * has always composed the same diagnostic, but only for console.warn -- which
 * is unreadable on an internal-distribution or TestFlight build from a Windows
 * machine, the only kind this project's owner can produce. Without it every
 * cause of a failed init is the same sentence on screen ("check your
 * connection"), including the causes that have nothing to do with the network,
 * so a report from the device cannot distinguish them and the bug gets chased
 * by rebuilding rather than by reading.
 *
 * Safe to render under design doc §5 checklist item 3, which forbids surfacing
 * a raw error payload, token or credential: `name` and `code` are short
 * identifier strings, and `message` -- the one field that can be long, or (for
 * FirebaseConfigError) is explicitly documented as never-show -- is left to
 * describeInitError and the console. */
function initFailureTag(e: any): string {
  const stage = getAuthInitStage();
  const kind = [e?.name, e?.code].filter(Boolean).join('/');
  return kind ? `(stage: ${stage}, ${kind})` : `(stage: ${stage})`;
}

/** name/code/message plus the stage it died at -- deliberately these fields
 * rather than the error object, which for some Firebase Auth errors carries a
 * `_tokenResponse`/`customData` credential payload this file must never print
 * (design doc §5 checklist item 3; website/js/authErrors.js redacts the same
 * way for the same reason). An init failure shouldn't carry one, but the log
 * shouldn't be what depends on that being true. Both init paths below log
 * through this so a failed sign-in gate reports which of the two it was. */
function describeInitError(e: any): string {
  const parts = [e?.name, e?.code, e?.message ?? String(e)].filter(Boolean);
  return `${parts.join(' / ')} (stage: ${getAuthInitStage()})`;
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

// Bounds for the three Firestore-backed steps BELOW sign-in: the sync, the
// account-deletion wipe, and sign-out's push-token cleanup.
//
// They need bounds for a reason a try/catch cannot cover. The Firestore JS
// SDK resolves a write only once the backend acknowledges it -- offline, the
// local mutation applies instantly and the returned promise simply stays
// pending. It never rejects, so every `catch` around these is dead code on
// exactly the network where it is needed, and the `finally` that clears the
// button's spinner never runs either. The result is not a slow operation; it
// is a permanently disabled control with no error and no way back short of
// force-quitting.
//
// Only the sign-in path was bounded before this (withAuthInitTimeout), which
// left the app easy to get into and impossible to get out of.
//
// Generous rather than tight: a real sync on a slow connection is allowed to
// take its time, since the failure being prevented is infinite, not slow.
const SYNC_TIMEOUT_MS = 30_000;
const DELETE_WIPE_TIMEOUT_MS = 30_000;
// Shorter, because sign-out does not depend on it -- see its call site.
const PUSH_CLEANUP_TIMEOUT_MS = 5_000;

/** Rejects `promise` with a named error if it hasn't settled within `ms`. */
function withTimeout<T>(promise: Promise<T>, ms: number, name: string, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      const e = new Error(message);
      e.name = name;
      reject(e);
    }, ms);
  });
  // The timer is always cleared, including on the success path -- a stray
  // timer per call would otherwise keep a Jest run (and the RN timer queue)
  // alive past the work it belongs to.
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/**
 * Releases a guard when `work` ITSELF settles, rather than when whoever was
 * waiting on it gave up.
 *
 * withTimeout above bounds how long the caller waits; it cannot cancel what
 * it raced, and the Firestore SDK gives it nothing to cancel with. So a
 * timeout means "stop waiting", never "it stopped" -- and a guard released
 * from the racing caller's own `finally` is released while the very work it
 * guards against is still in flight. Both 30s bounds below had that bug:
 * deleteAccount's endAccountDeletion let a push bridge re-create a document
 * inside the account being deleted, and syncNow's syncingUid let a second
 * run for the same uid interleave with the first.
 *
 * The same callback on both settlement paths, because the guard comes off
 * because the work STOPPED, not because it succeeded. `void` plus a handler
 * on the rejection path is also what keeps a failed `work` from surfacing
 * here as a second, unhandled rejection -- the caller already has its own.
 */
function releaseWhenSettled(work: Promise<unknown>, release: () => void): void {
  void work.then(release, release);
}

/** Registered exactly once, by whichever of init() or a sign-in retry first
 * gets initFirebaseAuth() to resolve. The unsubscribe onAuthStateChanged
 * returns is deliberately never called (the listener lives as long as the
 * process), so a second registration would be a permanent duplicate --
 * every auth change would fire syncNow() twice. */
let authListenerAttached = false;

/** Rejects `promise` if it hasn't settled within AUTH_INIT_TIMEOUT_MS.
 *
 * init()'s watchdog above releases the sign-in GATE when auth never starts,
 * but it cannot un-hang the sign-in itself: initFirebaseAuth() memoizes its
 * promise, so a call that never settles (a SecureStore/Keychain read that
 * neither resolves nor rejects -- the same hang the watchdog exists for) is
 * handed to every later caller too. requireFirebaseAuth below then awaits it
 * forever, and SignedOutAccount's `busy` flag -- only cleared in its
 * `finally` -- keeps every button on the page disabled and spinning until
 * the app is force-quit. The watchdog made that WORSE, not better: before
 * it, the buttons were at least visibly dead from the start; now they look
 * live, accept the tap, and then hang with no error.
 *
 * The timer is always cleared, including on the success path -- a stray 10s
 * timer per sign-in attempt would otherwise keep a Jest run (and the RN
 * timer queue) alive past the work it belongs to.
 */
function withAuthInitTimeout(promise: Promise<void>): Promise<void> {
  return withTimeout(
    promise,
    AUTH_INIT_TIMEOUT_MS,
    'AuthInitTimeoutError', // initFailureTag surfaces this name on screen
    `Firebase Auth did not start within ${AUTH_INIT_TIMEOUT_MS}ms.`,
  );
}

/** startFirebaseAuth() for the sign-in path: same retry, but any failure
 * surfaces as this file's one generic, credential-free string rather than a
 * raw SDK message (design doc §5 checklist item 3 -- SignedOutAccount renders
 * `e.message` verbatim). The underlying error is logged, not shown.
 *
 * Time-bounded, unlike init()'s own call -- see withAuthInitTimeout above for
 * why a sign-in tap must never inherit a never-settling init. */
async function requireFirebaseAuth(
  set: (partial: Partial<AuthState>) => void,
  get: () => AuthState,
): Promise<void> {
  try {
    await withAuthInitTimeout(startFirebaseAuth(set, get));
  } catch (e: any) {
    console.warn('[useAuthStore] Firebase Auth init failed on sign-in:', describeInitError(e));
    const message = initErrorMessageFor(e);
    set({ initError: message });
    // Named so SignedOutAccount can suppress it. This failure is ALREADY on
    // screen via the `initError` set on the line above, which the page
    // renders as its own line; throwing the identical string then had
    // signInErrorMessage pass it through (no `.code`, so it takes the "our
    // own static string" branch) into a SECOND red line saying exactly the
    // same sentence. One problem, printed twice, reading like two. The throw
    // itself has to stay -- it's what stops the caller from proceeding to the
    // provider flow -- so the name is what tells the screen not to print it
    // again. Same "already represented elsewhere in the UI" reasoning as
    // AccountExistsError, which pendingLink carries.
    const reported = new Error(message);
    reported.name = 'AuthInitReportedError';
    throw reported;
  }
}

async function startFirebaseAuth(
  set: (partial: Partial<AuthState>) => void,
  get: () => AuthState,
): Promise<void> {
  await initFirebaseAuth();
  if (authListenerAttached) return;
  // Set AFTER the registration below actually returns, never before. Claiming
  // it first meant that if getFirebaseAuth() or onAuthStateChanged threw --
  // the SDK in a state where `auth` is somehow still null, a Fast Refresh
  // reset, an internal assertion -- the flag stayed true with no listener
  // ever attached. The throw propagates the first time (init()'s catch shows
  // an error), but every retry after that takes the `return` above and
  // reports SUCCESS: the sign-in then runs, Firebase really does authenticate
  // the user, and nothing is left to tell this store about it. `user` stays
  // null forever, the Account page stays signed-out, and there is no error
  // anywhere -- the sign-in silently does nothing. Attaching first means a
  // failure stays a failure, and stays retryable.
  onAuthStateChanged(getFirebaseAuth(), (u) => {
    const hadUser = !!get().user;
    set({ ready: true, initError: null, user: u ? toAccountUser(u) : null });
    // A session can end without anyone tapping Sign out: Firebase drops it
    // by itself whenever the refresh token stops being valid -- the password
    // was changed on another device, the account was disabled or deleted
    // from the console, the credential was revoked. There is no action and
    // no `await` anywhere in this app for those; there is only this callback
    // firing with null.
    //
    // Setting `user: null` alone was therefore a leak of exactly the kind
    // clearSignedInState exists to prevent (see its comment, and
    // clearLocalAccountData's "so no account's data lingers on a shared,
    // resold, or reset device"): localDataOwnerUid still named the old uid,
    // and that account's sessions, goals, plans and armed reminders all
    // stayed. The Account page flipped to signed-out while Stats and
    // Calendar went on rendering the previous account's history and its
    // scheduled-session reminders went on firing.
    //
    // Only on a real user -> nobody transition. Firebase also fires once on
    // every startup, with null when there is no session, and treating that
    // as a sign-out would wipe local data (and reset the five syncable
    // settings to their defaults) on each launch of a signed-out app.
    //
    // The deliberate paths -- signOut and deleteAccount -- run the same
    // teardown themselves once their provider call returns, so this fires
    // for them too. That is a repeat, not a conflict: every step of
    // clearSignedInState is idempotent, and the alternative (a flag saying
    // "a deliberate sign-out is in progress, skip") would be one more piece
    // of state able to get stuck in the position where this stops running.
    //
    // Fire-and-forget with its own catch, because this callback is
    // synchronous and belongs to the Firebase SDK: there is no caller here
    // to await it or to handle a rejection. A failed wipe must not become an
    // unhandled rejection inside the SDK's call stack, and must not stop the
    // signed-out state above from reaching the screen -- what it says is
    // true either way.
    if (!u && hadUser) {
      clearSignedInState(set).catch((e) => {
        console.warn('[useAuthStore] local data not cleared after session ended:', (e as Error)?.message ?? e);
      });
    }
    // autoSyncEnabled (useSettingsStore) gates ONLY this automatic call --
    // a local-only per-device preference (§3), off by exception rather
    // than by default. The manual "Sync now" button calls syncNow()
    // directly and is unaffected either way.
    if (u && useSettingsStore.getState().autoSyncEnabled) {
      get().syncNow(); // fire-and-forget: migration/sync never blocks the UI
    }
  });
  authListenerAttached = true;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  ready: false,
  initError: null,
  user: null,
  syncing: false,
  syncingUid: null,
  syncError: null,
  linkError: null,
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
      // The stage is the whole diagnostic here: this message is otherwise
      // identical whether the config check hung, the Keychain wipe hung, or
      // initializeAuth() finished cleanly and the SDK simply never called
      // back. 'done' specifically means the last of those -- look at
      // secureStorePersistence.ts, not at the network.
      console.warn(
        `[useAuthStore] Firebase Auth did not start within ${AUTH_INIT_TIMEOUT_MS}ms ` +
          `(stalled at stage: ${getAuthInitStage()}); releasing the sign-in gate.`,
      );
      // Shown, not just logged, for the reason initFailureTag documents: the
      // console this warning goes to is not reachable on the build types this
      // project ships. There is no error object on this path -- nothing threw,
      // the callback simply never came -- so the tag carries the stage alone,
      // which is exactly the distinction the comment above says matters.
      set({ ready: true, initError: `${AUTH_INIT_ERROR} ${initFailureTag(null)}` });
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
      console.warn('[useAuthStore] Firebase Auth init failed:', describeInitError(e));
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

  signInWithEmail: async (email, password) => {
    set({ syncError: null });
    await requireFirebaseAuth(set, get); // no-op once started; retries a failed init()
    await handleProviderSignIn('password', () => signInWithEmailAuth(email, password), set);
    // onAuthStateChanged (above) picks up the new user and triggers syncNow().
  },

  createAccountWithEmail: async (email, password) => {
    set({ syncError: null });
    await requireFirebaseAuth(set, get); // no-op once started; retries a failed init()
    await createAccountWithEmailAuth(email, password);
    // Deliberately NOT handleProviderSignIn/completePendingLink: that path
    // exists to complete a link once the user has PROVEN ownership of the
    // SAME email a previous sign-in attempt conflicted on. This call always
    // creates a brand-new Firebase user under whatever email was typed,
    // which proves nothing about a pending conflict's (possibly different)
    // email -- and if the two happen to be the same email, Firebase itself
    // already refuses this call outright with auth/email-already-in-use
    // (that email is already the other provider's account), so there is no
    // legitimate case here that needs completing. Any stale prompt is
    // cleared instead, since a newly-created and signed-in account makes it
    // moot either way -- and cleared through dismissPendingLink so the
    // stashed credential goes with the prompt, not just the prompt.
    dismissPendingLink(set);
    // onAuthStateChanged (above) picks up the new user and triggers syncNow().
  },

  sendPasswordReset: async (email) => {
    await requireFirebaseAuth(set, get); // no-op once started; retries a failed init()
    await sendPasswordResetAuth(email);
  },

  signOut: async () => {
    // All three providers' signOutFully() do the same generic Firebase
    // auth.signOut() + SecureStore wipe (redundant but harmless if more than
    // one run); only Google's additionally revokes its native OAuth grant,
    // which is why an account linked to more than one provider runs each of
    // them rather than just one.
    const auth = getFirebaseAuth();
    const providers = auth.currentUser ? linkedProviders(auth.currentUser) : [];
    // BEFORE the provider sign-outs, not after: deleting this device's push
    // token is authorized by isOwner(uid), which needs the user still signed
    // in. Left behind, it would keep this phone receiving the previous
    // account's reminders -- on a shared or resold device, the worst leak
    // this feature could produce. Best-effort, and never a reason to block a
    // sign-out (push/pushRegistration.ts swallows its own failures).
    // Still awaited, not fired and forgotten: the delete is authorized by the
    // credential this line is about to destroy, so letting sign-out race ahead
    // would sometimes revoke it before the write lands -- which is the leak
    // above, reintroduced. Bounded instead, so an unreachable Firestore costs
    // PUSH_CLEANUP_TIMEOUT_MS rather than the whole sign-out. Swallowed for
    // the same reason the comment above gives: nothing here is worth trapping
    // a user in a session they asked to leave.
    const signingOutUid = auth.currentUser?.uid;
    if (signingOutUid) {
      await withTimeout(
        unregisterPushToken(signingOutUid),
        PUSH_CLEANUP_TIMEOUT_MS,
        'PushCleanupTimeoutError',
        `Push-token cleanup did not finish within ${PUSH_CLEANUP_TIMEOUT_MS}ms.`,
      ).catch((e) => {
        console.warn('[useAuthStore] signOut: push-token cleanup skipped:', (e as Error)?.message ?? e);
      });
    }
    if (providers.includes('apple')) await signOutAppleFully();
    if (providers.includes('password')) await signOutEmailFully();
    if (providers.includes('google') || providers.length === 0) await signOutGoogleFully();
    // After the provider sign-outs, not before -- see clearSignedInState.
    await clearSignedInState(set);
  },

  deleteAccount: async (password) => {
    const user = get().user;
    if (!user) return;
    // Order matters, and this order is the fix for a real data-loss bug: the
    // re-auth step -- the one step in this whole flow the user can cancel or
    // fail -- MUST complete successfully BEFORE deleteAllUserData runs.
    // Firestore data used to be wiped first and re-auth attempted after, so
    // a cancelled/failed picker left cloud data destroyed with the user
    // still signed in and no indication anything happened. Re-auth still
    // has to happen while signed in as this uid (same reason as before --
    // deleteAllUserData's own header comment: firestore.rules' isOwner(uid)
    // needs a live credential), it just now happens first instead of last.
    //
    // Local data is cleared last, after the Auth user is gone, for the same
    // reason signOut clears after signOutFully -- no lingering local data
    // once nobody is signed in on this device.
    //
    // beginAccountDeletion/endAccountDeletion still bracket the whole
    // sequence (reauth through deleteUser) so the best-effort push bridges
    // (sessionsSyncBridge/settingsSyncBridge) can't re-create a doc that was
    // just wiped -- the native picker/sheet can take a while, and a
    // settings/session change landing in that window (still authenticated
    // as this uid) would otherwise repush straight back in.
    //
    // deleteUser() only needs to run once -- it removes the Firebase Auth
    // user and ALL its linked provider associations in a single call, so
    // when more than one provider is linked this deliberately picks exactly
    // one to reauthenticate with rather than running every linked provider's
    // flow, which would double- (or triple-) prompt for no benefit. The
    // preference order is google > apple > password, so an existing OAuth
    // user's flow is completely unchanged by password now existing as an
    // option -- they never see a new prompt because of it. Password is only
    // ever the chosen provider when it's the sole one linked, since there is
    // no native picker/sheet for it to run on its own: the caller (the
    // Account page) must have already collected `password` and passed it in,
    // which is what the PasswordRequiredError check just below is for.
    const auth = getFirebaseAuth();
    const providers = auth.currentUser ? linkedProviders(auth.currentUser) : [];
    const chosenProvider: AuthProviderKind = providers.includes('google')
      ? 'google'
      : providers.includes('apple')
        ? 'apple'
        : providers.includes('password')
          ? 'password'
          : // No RECOGNIZED provider linked -- reachable if auth.currentUser
            // went null between this action's `get().user` check and here, or
            // for an account carrying only some provider toProviderKinds
            // doesn't narrow. Falls back to Google, which is what this chose
            // before password existed. The point is what it must NOT do:
            // land on 'password' by exhaustion and demand a password the user
            // has no reason to be asked for, for an account that isn't
            // password-linked at all. Both providers' reauthenticateForDeletion
            // no-op on a null currentUser, so the flow then fails at the
            // Firestore wipe (isOwner(uid) with no credential) exactly as it
            // did before.
            'google';
    if (chosenProvider === 'password' && !password) {
      // Thrown BEFORE beginAccountDeletion and before anything destructive --
      // see PasswordRequiredError's own comment for why this is a distinct
      // failure mode from a cancelled native picker/sheet, which the OAuth
      // branches below instead let run through deleteWithReauthRetry and
      // treat as a normal (already-started-flow) failure.
      throw new PasswordRequiredError();
    }
    let reauthenticateForDeletion: () => Promise<void>;
    let deleteUserAccount: () => Promise<void>;
    if (chosenProvider === 'google') {
      reauthenticateForDeletion = reauthenticateGoogleForDeletion;
      deleteUserAccount = deleteGoogleUserAccount;
    } else if (chosenProvider === 'apple') {
      reauthenticateForDeletion = reauthenticateAppleForDeletion;
      deleteUserAccount = deleteAppleUserAccount;
    } else {
      // Safe: chosenProvider === 'password' only reaches here after the
      // PasswordRequiredError check above has already ensured `password` is set.
      reauthenticateForDeletion = () => reauthenticateEmailForDeletion(password!);
      deleteUserAccount = deleteEmailUserAccount;
    }
    beginAccountDeletion(user.uid);
    // The wipe's OWN promise, kept because the timeout below cannot cancel
    // it: when the bound fires, this is still deleting documents, and the
    // guard has to come off from this settling rather than from the race
    // giving up on it (see releaseWhenSettled). Starts already-settled so
    // the `finally` needs no null case -- a flow that aborts at re-auth
    // never starts a wipe and must still release the guard promptly.
    let wipe: Promise<unknown> = Promise.resolve();
    try {
      // Step 1: prove the user is currently present. Throws (and aborts
      // everything below, untouched) on a cancelled or otherwise failed
      // picker/sheet -- see reauthenticateForDeletion's own comment.
      await deleteWithReauthRetry(reauthenticateForDeletion);
      // Step 2: only now wipe Firestore -- reauth already succeeded.
      //
      // Bounded, because this is the step Guideline 5.1.1(v) invites a
      // reviewer to exercise and it is a chain of Firestore deletes. Timing
      // out leaves a partly-wiped account, which deleteAllUserData is
      // explicitly built to survive: it removes users/{uid} first, so a retry
      // re-enters the same window and finishes the sweep. Better a "please
      // try again" the user can act on than a spinner that never ends.
      wipe = deleteAllUserData(user.uid);
      await withTimeout(
        wipe,
        DELETE_WIPE_TIMEOUT_MS,
        'DeleteWipeTimeoutError',
        `Account data wipe did not finish within ${DELETE_WIPE_TIMEOUT_MS}ms.`,
      );
      // Step 3: only after the wipe succeeds, remove the Auth user itself.
      try {
        await deleteUserAccount();
      } catch (e) {
        // The one abnormal outcome this flow can produce: cloud data is
        // already gone but the Auth user survived. Tag it so
        // DangerZoneSection can tell the user the truth instead of the
        // generic "please try again" that would imply nothing happened.
        console.warn('[useAuthStore] deleteAccount: data wiped but deleteUserAccount failed:', (e as any)?.message ?? e);
        throw new AccountDataWipedError(e);
      }
    } finally {
      // Chained onto the wipe rather than called outright, so the guard is
      // held by whichever of the two finishes LAST. The `finally` covers the
      // flow ending (including step 3, deleteUserAccount, which the bracket
      // has always spanned); the chain covers the one case the `finally`
      // cannot see -- a wipe that outlived DELETE_WIPE_TIMEOUT_MS and is
      // still deleting documents. Clearing it then made isBeingDeleted(uid)
      // false mid-wipe, pushTarget() start returning the uid again, and the
      // next bridge emission re-create a document inside the account being
      // deleted: precisely the race syncCommon's deletingUid exists for.
      releaseWhenSettled(wipe, endAccountDeletion);
    }
    await clearSignedInState(set);
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
    const work = runMigrationAndSync(uid);
    // The guard comes off when the RUN stops, not when this call stops
    // waiting for it. withTimeout below cannot cancel anything (see
    // releaseWhenSettled), so clearing syncingUid from the race's own
    // `finally` re-enabled Sync now for a run that was still going, and two
    // runMigrationAndSync calls for one uid then interleaved their
    // replaceSessions, applyRemoteSettings and upload batches.
    //
    // `syncing` is cleared here as well as in the `finally`, and the two are
    // not redundant: this path is the only one that runs when the work
    // outlives the bound and then finishes, and the `finally` is the only
    // one that runs when the bound fires first. Whichever happens, the
    // ownership test is the same -- a run that no longer owns syncingUid
    // must not take a newer run's spinner down with it.
    releaseWhenSettled(work, () => {
      if (get().syncingUid === uid) set({ syncing: false, syncingUid: null });
    });
    try {
      // Bounded because `syncing` gates more than a label: SyncStatusSection
      // disables its own button on it, and DangerZoneSection disables Sign
      // out. autoSyncEnabled defaults true and the auth listener fires
      // syncNow() on sign-in, so an unbounded sync that never settles means
      // the FIRST sign-in on a device permanently greys out the way back out
      // of it. The catch below turns this into the same on-screen sentence as
      // any other sync failure.
      await withTimeout(
        work,
        SYNC_TIMEOUT_MS,
        'SyncTimeoutError',
        `Sync did not finish within ${SYNC_TIMEOUT_MS}ms.`,
      );
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
        // Through accountDisplay's mapper, like every other error this file
        // puts on screen. `e.message` used to go straight into `syncError`,
        // which SyncStatusSection and SignedOutAccount both render verbatim,
        // so Firestore's own words landed on the Account page: "Missing or
        // insufficient permissions." for a rules change not yet deployed,
        // "Failed to get document because the client is offline." for no
        // network. autoSyncEnabled defaults to true and the auth listener
        // fires syncNow() on sign-in, so that arrived seconds after signing
        // in and read as the sign-in having half-worked.
        console.warn('[useAuthStore] syncNow failed:', e?.code ?? e?.name ?? e?.message ?? e);
        set({ syncError: syncErrorMessage(e) });
      }
    } finally {
      // Only the UI flag, deliberately -- syncingUid is the guard above and
      // belongs to the run, which may still be going. `syncing` is what
      // SyncStatusSection and DangerZoneSection disable their buttons on, so
      // the bound has to release it or the first sign-in on a flaky
      // connection permanently greys out the way back out of the app, which
      // is the whole reason SYNC_TIMEOUT_MS exists. The consequence is
      // deliberate and mild: between the bound firing and the run really
      // stopping, Sync now is tappable but returns at the guard, with the
      // timeout's own message still on screen explaining why.
      if (get().syncingUid === uid) set({ syncing: false });
    }
  },

  linkProvider: async (provider) => {
    // Clears the sign-in-time link failure this action is the remedy for --
    // in the store, not in SignInMethodsSection's local `error`, because that
    // is where it lives. Same shape as the sign-in actions clearing syncError.
    set({ linkError: null });
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

  linkEmailPassword: async (email, password) => {
    set({ linkError: null }); // see linkProvider's note
    const auth = getFirebaseAuth();
    const current = auth.currentUser;
    if (!current) return;
    // Same "already signed in, adding on purpose" case as linkProvider above
    // (see its comment), but kept as its own action rather than a case
    // linkProvider handles: linking a password needs the typed email/password
    // this action's caller collected, not a native picker/sheet result, so
    // its parameters -- and the emailAuth.ts call it makes -- are shaped
    // differently from linkProvider's throughout.
    const uid = current.uid;
    const updated = await linkEmailToCurrentUser(current, email, password);
    // Same stale-uid discipline as linkProvider's own result-application
    // check above -- see its comment.
    if (get().user?.uid === uid) set({ user: toAccountUser(updated) });
  },

  unlinkProvider: async (provider) => {
    set({ linkError: null }); // see linkProvider's note
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
    const providerId = provider === 'google' ? 'google.com' : provider === 'apple' ? 'apple.com' : 'password';
    const uid = current.uid;
    const updated = await unlink(current, providerId);
    if (get().user?.uid === uid) set({ user: toAccountUser(updated) }); // see linkProvider's note
  },
}));
