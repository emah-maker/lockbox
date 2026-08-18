// useAuthStore.ts -- account state: Firebase Auth user + sync status. Mirrors
// the "optimistic local write, best-effort remote sync" pattern useStore.ts
// already uses for box settings. See
// docs/rfcs/google-signin-cross-device-sync-architecture.md §4.3, §6.
//
// Never logs user.email/displayName/photoURL/uid (design doc §5 checklist
// item 3) -- SettingsScreen reads them straight off `user` for display only.
import { create } from 'zustand';
import { onAuthStateChanged, type User } from 'firebase/auth';
import { initFirebaseAuth, getFirebaseAuth } from './firebase';
import { signInWithGoogle, signOutFully, deleteAccountFully } from './googleAuth';
import { runMigrationAndSync, deleteAllUserData, beginAccountDeletion, endAccountDeletion } from '../sync/firestoreSync';
import { clearLocalAccountData } from '../sync/localDataOwner';
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

  /** Call once at app start (App.tsx's init effect). Runs
   * wipeStaleSessionOnFreshInstall() + initializeAuth() (via
   * initFirebaseAuth(), §2.5's ordering requirement) before attaching the
   * auth-state listener. */
  init: () => Promise<void>;
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
  /** Full account deletion (§4.3, §5 checklist item 12): cascade-deletes
   * what firestore.rules permits, then deletes the Firebase Auth user
   * itself, then clears local account state. See firestoreSync.ts's
   * deleteAllUserData for the one documented exception (session docs are
   * orphaned, not purged, by design). */
  deleteAccount: () => Promise<void>;
  syncNow: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  ready: false,
  user: null,
  syncing: false,
  syncingUid: null,
  syncError: null,
  lastSyncedAt: null,

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

  signIn: async () => {
    set({ syncError: null });
    await signInWithGoogle();
    // onAuthStateChanged (above) picks up the new user and triggers syncNow().
  },

  signOut: async () => {
    await signOutFully();
    // After sign-out, not before: clearing settings triggers
    // settingsSyncBridge's push subscription, which itself no-ops once
    // signed out, but ordering it this way makes that explicit rather than
    // relying on the no-op.
    await clearLocalAccountData();
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
    // re-authenticates via a fresh native Google sign-in, which can take a
    // while, and a settings/session change landing in that window (still
    // authenticated as this uid) would otherwise repush straight back in.
    beginAccountDeletion(user.uid);
    try {
      await deleteAllUserData(user.uid);
      await deleteAccountFully();
    } finally {
      endAccountDeletion();
    }
    await clearLocalAccountData();
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
