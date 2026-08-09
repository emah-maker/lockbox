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
import { runMigrationAndSync, deleteAllUserData } from '../sync/firestoreSync';
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
    set({ user: null, lastSyncedAt: null, syncError: null });
    await setJSON<number | null>(LAST_SYNCED_KEY, null);
  },

  deleteAccount: async () => {
    const user = get().user;
    if (!user) return;
    // Order matters: Firestore data must go first, while still authenticated
    // as this uid -- see deleteAllUserData's own header comment.
    await deleteAllUserData(user.uid);
    await deleteAccountFully();
    set({ user: null, lastSyncedAt: null, syncError: null });
    await setJSON<number | null>(LAST_SYNCED_KEY, null);
  },

  syncNow: async () => {
    const user = get().user;
    if (!user || get().syncing) return;
    set({ syncing: true, syncError: null });
    try {
      await runMigrationAndSync(user.uid);
      const now = Date.now();
      set({ lastSyncedAt: now });
      await setJSON(LAST_SYNCED_KEY, now);
    } catch (e: any) {
      // Generic message only -- never interpolate e's full payload in case a
      // future error type ever carries more than a plain string message.
      set({ syncError: typeof e?.message === 'string' ? e.message : 'Sync failed' });
    } finally {
      set({ syncing: false });
    }
  },
}));
