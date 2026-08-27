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
import { pushNewSessions, pushSessionRetag } from './firestoreSync';
import type { LoggedSession } from '../stats/sessionHistory';

let started = false;
// In-memory only (reset per app run): tracks which sessions this run has
// already considered for upload, and the topic/topicUpdatedAt it last pushed
// for each, so a re-render/resubscribe never re-pushes the same create, and a
// retag of an already-seen session (useStore.retagSession, which mutates
// `sessions` in place rather than appending) is still noticed. Cross-run/
// cross-device duplicate protection for creates is Firestore's own idempotent
// set() at the deterministic doc ID (firestoreSync.ts), not this.
const seen = new Map<string, { topic: string | undefined; topicUpdatedAt: number | undefined }>();

function sessionKey(s: LoggedSession): string {
  return `${s.startedAt}_${s.actualS}`;
}

/**
 * Marks sessions as already accounted for, without pushing them. Call this
 * before firestoreSync.ts's syncSessions replaces useStore's live session
 * list with a merged (possibly cross-device) set -- otherwise the subscribe
 * callback below would treat any session it hasn't personally seen (e.g. one
 * that another device originally uploaded) as newly-logged and re-upload it
 * under *this* device's doc-id namespace (sessionDocId is deviceId-scoped),
 * creating a second Firestore doc for the same session and permanently
 * double-counting it in stats. syncSessions already uploads whatever is
 * genuinely new (and retags whatever needs relabeling) in its own batches,
 * correctly keyed -- this just stops that work from being redundantly (and
 * incorrectly) repeated here.
 */
export function markSessionsSeen(sessions: LoggedSession[]): void {
  for (const s of sessions) seen.set(sessionKey(s), { topic: s.topic, topicUpdatedAt: s.topicUpdatedAt });
}

/**
 * Call once at app start (after initFirebaseAuth() has resolved -- see
 * App.tsx). Idempotent. Every subsequent change to useStore's `sessions`
 * array triggers a best-effort push: new entries (appended by handleHistory)
 * go through pushNewSessions, and a topic/topicUpdatedAt change on an
 * already-seen entry (retagSession, called from CalendarScreen) goes through
 * pushSessionRetag -- a no-op either way while signed out (both push
 * functions check for a signed-in user themselves).
 */
export function startSessionsSyncBridge(): void {
  if (started) return;
  started = true;
  markSessionsSeen(useStore.getState().sessions);

  useStore.subscribe((state) => {
    const fresh: LoggedSession[] = [];
    const retagged: LoggedSession[] = [];
    for (const s of state.sessions) {
      const key = sessionKey(s);
      const prev = seen.get(key);
      if (!prev) {
        seen.set(key, { topic: s.topic, topicUpdatedAt: s.topicUpdatedAt });
        fresh.push(s);
      } else if (prev.topic !== s.topic || prev.topicUpdatedAt !== s.topicUpdatedAt) {
        seen.set(key, { topic: s.topic, topicUpdatedAt: s.topicUpdatedAt });
        retagged.push(s);
      }
    }
    if (fresh.length) {
      pushNewSessions(fresh).catch(() => {}); // best-effort; next full sync (syncNow) catches up
    }
    for (const s of retagged) {
      // best-effort; if the doc isn't uploaded yet (not-found) or the push
      // fails, the next full sync's toRetag catches it via topicUpdatedAt.
      pushSessionRetag(s, s.topic, s.topicUpdatedAt ?? Date.now()).catch(() => {});
    }
  });
}
