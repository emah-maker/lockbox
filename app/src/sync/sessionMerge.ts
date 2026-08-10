// sessionMerge.ts -- pure session-merge logic for firestoreSync.ts's
// syncSessions, split into its own Firebase-free module so it's
// unit-testable: firestoreSync.ts imports `firebase/firestore`, which jest's
// default transform can't parse (ESM re-export syntax), so anything living
// in that file is untestable under this repo's jest config. Same reasoning
// as stats/customLabels.ts's split from stats/topics.ts.
import type { LoggedSession } from '../stats/sessionHistory';

export function sessionDocId(deviceId: string, s: Pick<LoggedSession, 'startedAt' | 'actualS'>): string {
  return `${deviceId}_${s.startedAt}_${s.actualS}`;
}

/** For an id known to both sides, LOCAL's `topic` wins over remote's:
 * firestore.rules makes a session doc create-only (`allow update, delete: if
 * false`, for integrity -- see that file's comment), so remote's topic can
 * only ever be whatever it was at original upload time, while local is
 * where retagSession()'s edits actually land. This does not push a retag to
 * Firestore (still blocked by the same rule) -- it only stops a stale
 * remote copy from clobbering a local retag on the next sync. */
export function mergeSessionsPreferLocalTopic(
  localSessions: LoggedSession[],
  remoteEntries: { id: string; session: LoggedSession }[],
  deviceId: string,
): { merged: LoggedSession[]; toUpload: { id: string; session: LoggedSession }[] } {
  const merged = new Map<string, LoggedSession>();
  const remoteIds = new Set<string>();
  for (const { id, session } of remoteEntries) {
    remoteIds.add(id);
    merged.set(id, session);
  }

  const toUpload: { id: string; session: LoggedSession }[] = [];
  for (const s of localSessions) {
    const id = sessionDocId(deviceId, s);
    if (remoteIds.has(id)) {
      merged.set(id, { ...merged.get(id)!, topic: s.topic });
    } else {
      merged.set(id, s);
      toUpload.push({ id, session: s });
    }
  }

  return { merged: Array.from(merged.values()).sort((a, b) => a.startedAt - b.startedAt), toUpload };
}
