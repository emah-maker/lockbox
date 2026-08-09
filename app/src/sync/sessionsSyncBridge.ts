// sessionsSyncBridge.ts -- wires useStore's local session log to a
// best-effort incremental Firestore push, mirroring settingsSyncBridge.ts's
// pattern for the same reason: useStore.ts's own header comment scopes it to
// "the only thing that actually talks to the box over BLE" -- adding a
// Firestore call inside its handleHistory action body would blur that
// boundary for every future reader. This module subscribes to useStore from
// the outside instead, so useStore.ts stays exactly as documented, with zero
// awareness of sync/auth. See
// docs/rfcs/google-signin-cross-device-sync-architecture.md §4.3.
import { useStore } from '../store/useStore';
import { pushNewSessions } from './firestoreSync';
import type { LoggedSession } from '../stats/sessionHistory';

let started = false;
// In-memory only (reset per app run): tracks which sessions this run has
// already considered for upload, so a re-render/resubscribe never re-pushes
// the same ones. Cross-run/cross-device duplicate protection is Firestore's
// own idempotent set() at the deterministic doc ID (firestoreSync.ts), not this.
const seen = new Set<string>();

function sessionKey(s: LoggedSession): string {
  return `${s.startedAt}_${s.actualS}`;
}

/**
 * Call once at app start (after initFirebaseAuth() has resolved -- see
 * App.tsx). Idempotent. Every subsequent growth of useStore's `sessions`
 * array (new sessions appended by handleHistory) triggers a best-effort
 * push of just the new entries; a no-op while signed out (pushNewSessions
 * itself checks for a signed-in user).
 */
export function startSessionsSyncBridge(): void {
  if (started) return;
  started = true;
  for (const s of useStore.getState().sessions) seen.add(sessionKey(s));

  useStore.subscribe((state) => {
    const fresh: LoggedSession[] = [];
    for (const s of state.sessions) {
      const key = sessionKey(s);
      if (!seen.has(key)) {
        seen.add(key);
        fresh.push(s);
      }
    }
    if (fresh.length) {
      pushNewSessions(fresh).catch(() => {}); // best-effort; next full sync (syncNow) catches up
    }
  });
}
