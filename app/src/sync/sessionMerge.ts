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

export interface SessionRetag {
  id: string;
  topic: string | undefined;
  topicUpdatedAt: number;
}

export interface SessionMergeResult {
  merged: LoggedSession[];
  toUpload: { id: string; session: LoggedSession }[];
  /** Sessions known to both sides where LOCAL's topic is the newer edit --
   * these need an `update` pushed to the already-existing remote doc (see
   * firestoreSync.ts's pushTopicRetags), since toUpload only covers docs that
   * don't exist remotely yet. */
  toRetag: SessionRetag[];
}

/** For an id known to both sides, the side with the higher `topicUpdatedAt`
 * wins -- last-write-wins, the same policy syncSettingsTwoWay already uses
 * for settings/app. firestore.rules now allows updating just a session doc's
 * topic (scoped `update` rule, see that file's comment), so a relabel can
 * come from either this device's retagSession() or the website dashboard;
 * without a real LWW compare, whichever synced second would silently win by
 * accident instead of by recency. Falls back to local-wins when neither side
 * has ever stamped topicUpdatedAt (both 0) -- preserves the original
 * behavior for records written before this field existed. */
export function mergeSessionsPreferLocalTopic(
  localSessions: LoggedSession[],
  remoteEntries: { id: string; session: LoggedSession }[],
  deviceId: string,
): SessionMergeResult {
  const merged = new Map<string, LoggedSession>();
  const remoteIds = new Set<string>();
  for (const { id, session } of remoteEntries) {
    remoteIds.add(id);
    merged.set(id, session);
  }

  const toUpload: { id: string; session: LoggedSession }[] = [];
  const toRetag: SessionRetag[] = [];
  for (const s of localSessions) {
    const id = sessionDocId(deviceId, s);
    const remote = merged.get(id);
    if (remote) {
      const localAt = s.topicUpdatedAt ?? 0;
      const remoteAt = remote.topicUpdatedAt ?? 0;
      if (remoteAt > localAt) {
        // Remote (e.g. a dashboard relabel) is newer -- keep it; local picks
        // this up locally via replaceSessions, no push needed.
        continue;
      }
      merged.set(id, { ...remote, topic: s.topic, topicUpdatedAt: s.topicUpdatedAt });
      if (localAt > remoteAt) {
        toRetag.push({ id, topic: s.topic, topicUpdatedAt: s.topicUpdatedAt ?? Date.now() });
      }
    } else {
      merged.set(id, s);
      toUpload.push({ id, session: s });
    }
  }

  return { merged: Array.from(merged.values()).sort((a, b) => a.startedAt - b.startedAt), toUpload, toRetag };
}
