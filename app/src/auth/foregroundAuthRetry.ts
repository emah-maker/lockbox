// foregroundAuthRetry.ts -- retries a failed Firebase Auth init the next time
// the app comes to the foreground.
//
// Its own module, rather than an inline AppState listener in App.tsx, for the
// same reason the sync bridges are: App.tsx has no tests (it imports the whole
// app), so anything that lives only there is unverifiable. This is the piece
// that decides whether a user who was signed in stays signed in, so it needs
// to be drivable from a test.
//
// THE FAILURE IT EXISTS FOR
//
// useAuthStore.init() runs once, from App.tsx's mount effect. That is fine on
// a normal launch -- but this app declares UIBackgroundModes
// ["bluetooth-central"] and sets a restoreStateIdentifier, so iOS also
// cold-launches the process in the BACKGROUND, screen off, to hand back a
// restored central when the box has something to say. If that happens in the
// window between a reboot and the owner's first unlock, the Keychain answers
// nothing (SECURE_STORE_OPTS pins AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY) and
// initFirebaseAuth() fails at its keychain-probe stage.
//
// Without this, that failure is permanent for the process: init() has already
// run, nothing calls it again, and the process survives into the foreground.
// The owner unlocks their phone, opens Phone Box, and is signed out -- and
// because the Firebase SDK only picks its persistence once, signing in again
// would previously have been stored in memory only, so the next launch signs
// them out too. It reads exactly as "the app keeps signing me out", with
// nothing on screen or in any log naming a cause.
import { AppState, type NativeEventSubscription } from 'react-native';
import { useAuthStore } from './useAuthStore';

/**
 * Subscribes for the life of the app. Returns the subscription so App.tsx's
 * effect can remove it, matching onBackgroundWake's shape.
 */
export function startForegroundAuthRetry(): NativeEventSubscription {
  return AppState.addEventListener('change', (next) => {
    if (next !== 'active') return;
    // Gated on initError so an ordinary foreground costs nothing: a healthy
    // session never enters this branch, and init() is not re-run on every
    // app switch. initError is set by BOTH paths that can leave auth down --
    // init()'s catch and its 10s watchdog -- so this covers a stalled init
    // as well as a refused Keychain.
    if (!useAuthStore.getState().initError) return;
    // Safe to call again: initFirebaseAuth() never caches a rejected promise
    // (firebase.ts's catch clears it), and the auth-state listener is
    // registered at most once (authListenerAttached), so a retry cannot
    // double-subscribe and make every auth change fire syncNow() twice.
    void useAuthStore
      .getState()
      .init()
      .catch((e: any) => {
        // Logged, never surfaced: init() has already written its own message
        // into initError, which the Account page renders. Throwing or setting
        // anything here would either duplicate that line or replace a specific
        // message with a vaguer one.
        console.warn('[foregroundAuthRetry] auth init retry failed:', e?.message ?? e);
      });
  });
}
