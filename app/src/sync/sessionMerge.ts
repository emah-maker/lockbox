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

/** Total order over topics, used only to break a same-millisecond conflict.
 * Which side it picks doesn't matter; that BOTH sides pick the same one, from
 * data they each already hold, is the entire requirement. An untagged session
 * sorts below every tag, so "someone cleared it" never beats "someone named
 * it" on a coin-flip. */
function topicWins(local: string | undefined, remote: string | undefined): boolean {
  return (local ?? '') > (remote ?? '');
}

/** For an id known to both sides, the side with the higher `topicUpdatedAt`
 * wins -- last-write-wins, the same policy syncSettingsTwoWay already uses
 * for settings/app. firestore.rules now allows updating just a session doc's
 * topic (scoped `update` rule, see that file's comment), so a relabel can
 * come from either this device's retagSession() or the website dashboard;
 * without a real LWW compare, whichever synced second would silently win by
 * accident instead of by recency. Falls back to local-wins when neither side
 * has ever stamped topicUpdatedAt (both 0) -- preserves the original
 * behavior for records written before this field existed.
 *
 * A genuine tie -- both sides stamped, same millisecond, different topics --
 * is broken by comparing the topic strings themselves, which is the whole
 * point: the tiebreak has to be DETERMINISTIC, so that both devices in the
 * conflict independently reach the same answer. It previously wasn't handled
 * at all: the tie fell into the local-wins branch, which applied local's
 * topic locally but only pushed when `localAt > remoteAt` strictly, so
 * nothing was ever sent. Each device kept its own answer, the remote doc kept
 * a third, and no future sync could correct it -- every subsequent run
 * recomputed the same tie and did the same nothing. Simply pushing on a tie
 * would be worse, not better: both devices would push their own topic on
 * every sync forever, each overwriting the other. Ordering by topic breaks
 * the loop, because the loser recognises itself as the loser. */
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
      // A real conflict at the same instant: both stamped, and they disagree.
      // Two devices relabelling the same session within a millisecond of each
      // other is rare; a tie at 0 is not a conflict at all, just two records
      // predating the field, which local-wins already covers.
      const tie = localAt === remoteAt && localAt > 0 && s.topic !== remote.topic;
      // `approxStart` is local-only bookkeeping (see sessionHistory.ts): it is
      // deliberately not in firestoreSync's sessionPayload, so the remote copy
      // of this very session never carries it. Every branch below rebuilds the
      // merged record from `remote`, which would therefore drop the flag --
      // and appendSessions' resend dedupe for clock-less sessions is the thing
      // that depends on it. A first sync landing between a failed history ack
      // and the box's resend would otherwise quietly restore the
      // double-counting bug this flag exists to prevent.
      const approx = s.approxStart ? { approxStart: true as const } : {};
      if (remoteAt > localAt || (tie && !topicWins(s.topic, remote.topic))) {
        // Remote (e.g. a dashboard relabel) is newer, or won the tiebreak --
        // keep it; local picks this up locally via replaceSessions, no push
        // needed.
        merged.set(id, { ...remote, ...approx });
        continue;
      }
      // Winning a tie BUMPS the clock rather than keeping the tied value, and
      // that is not cosmetic. firestore.rules' sessions `update` rule requires
      // topicUpdatedAt to strictly increase (it's what stops a client
      // replaying a stale edit over a newer one), so a retag pushed at the
      // tied timestamp is rejected outright -- the divergence this branch
      // exists to resolve would survive, and every subsequent sync would
      // recompute the same tie and retry the same rejected write. Bumping
      // also settles the conflict in the data itself: the loser's next sync
      // sees a strictly newer remote and adopts it through the ordinary
      // remote-is-newer path above, with no tiebreak needed at all.
      const topicUpdatedAt = tie ? localAt + 1 : s.topicUpdatedAt;
      merged.set(id, { ...remote, topic: s.topic, topicUpdatedAt, ...approx });
      if (localAt > remoteAt || tie) {
        toRetag.push({ id, topic: s.topic, topicUpdatedAt: topicUpdatedAt ?? Date.now() });
      }
    } else {
      merged.set(id, s);
      toUpload.push({ id, session: s });
    }
  }

  return { merged: Array.from(merged.values()).sort((a, b) => a.startedAt - b.startedAt), toUpload, toRetag };
}
