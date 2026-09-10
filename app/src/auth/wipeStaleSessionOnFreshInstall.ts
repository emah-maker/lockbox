// wipeStaleSessionOnFreshInstall.ts -- reinstall-session-leak mitigation. See
// docs/rfcs/google-signin-cross-device-sync-architecture.md §2.5.
//
// iOS Keychain entries are not guaranteed to be cleared when an app is
// deleted (a well-known platform quirk, independent of keychainAccessible
// choice) -- a fresh install can silently resume a previous install's
// signed-in session. AsyncStorage IS cleared on uninstall (app sandbox),
// unlike Keychain, so the *absence* of the marker this function writes is a
// reliable "this is a fresh install" signal.
//
// Must run before Firebase Auth's `initializeAuth()` is ever called -- see
// firebase.ts's initFirebaseAuth(), which awaits this first.
import { getJSON, setJSON } from '../storage/storage';
import { wipeFirebaseAuthSecureStore } from './secureStoreKeys';

const MARKER_KEY = 'hasRunBefore'; // storage.ts prefixes this with 'phonebox:'

export async function wipeStaleSessionOnFreshInstall(): Promise<void> {
  const hasRunBefore = await getJSON<boolean>(MARKER_KEY, false);
  if (!hasRunBefore) {
    // Proactively wipe any Keychain-resident auth state left over from a
    // previous install before Firebase Auth even initializes. Same shared
    // wipe every sign-out/delete path uses -- see secureStoreKeys.ts.
    await wipeFirebaseAuthSecureStore('[wipeStaleSessionOnFreshInstall]');
    await setJSON(MARKER_KEY, true);
  }
}
