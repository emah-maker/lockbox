// goalsSyncPlan.ts -- pure decision layer for firestoreSync.ts's
// syncGoalsTwoWay, split out for the same reason sync/sessionMerge.ts is its
// own module (see that file's header): firestoreSync.ts imports
// `firebase/firestore`, which jest's default transform can't parse (ESM
// re-export syntax), so anything living in that file -- or importing it --
// is untestable under this repo's jest config.
//
// This module composes goals.ts's sanitizeRemoteGoals and goalMerge.ts's
// mergeGoals/mergedGoalsDocUpdatedAt (all already Firebase-free and
// independently unit-tested by their own colocated tests) with one more
// piece of logic that belongs to the Firestore sync *protocol*, not the
// goal data model itself, and so doesn't belong in goals-core's goals.ts/
// goalMerge.ts: whether a merge result actually needs to be written back to
// Firestore, versus just applied locally. Exposing that as its own pure,
// testable function is what lets firestoreSync.ts's syncGoalsTwoWay stay a
// thin I/O wrapper (read doc, call this, apply the result, maybe write it
// back) instead of duplicating decision logic no test can reach.
import { sanitizeRemoteGoals, type Goal } from '../goals/goals';
import { mergeGoals, mergedGoalsDocUpdatedAt } from '../goals/goalMerge';

export interface GoalsSyncPlan {
  /** The union-merged goals to apply locally (useGoalsStore's
   * applyRemoteGoals). Already run through sanitizeRemoteGoals on the
   * remote side and mergeGoals's own MAX_GOALS-capping eviction, so this is
   * always a valid, in-bounds Goal[] regardless of how malformed or
   * oversized the raw remote input was. */
  merged: Goal[];
  /** The doc-level clock to store alongside `merged` (goalMerge.ts's
   * mergedGoalsDocUpdatedAt) -- always >= both input doc clocks. */
  docUpdatedAt: number;
  /** True when the remote doc is missing something the merge produced --
   * either its clock is behind (docUpdatedAt > remoteDocUpdatedAt) or its
   * CONTENT is stale (goalsDifferFrom below) -- so a write-back is worth
   * making. See goalsDifferFrom's own comment for why both checks are
   * needed, and firestoreSync.ts's syncGoalsTwoWay for the setDoc call this
   * gates. */
  shouldPushBack: boolean;
}

/**
 * True when `merged` contains anything `remote` doesn't -- a different set
 * of ids, or a shared id whose comparison-relevant fields (topic/period/
 * targetS/updatedAt/archived) differ. `createdAt` is deliberately excluded:
 * it's immutable per id (goals.ts never rewrites it), so it can never differ
 * between two records that share an id without one of them being corrupt,
 * which sanitizeRemoteGoals/mergeGoals already guard against upstream.
 *
 * This exists because a doc-level clock compare (docUpdatedAt >
 * remoteDocUpdatedAt) is NOT sufficient on its own for goals, unlike
 * syncSettingsTwoWay's identical-looking compare, which IS sufficient for
 * settings/app. Settings is whole-doc last-write-wins: either the entire
 * doc is replaced or it isn't, so "is my clock newer" and "do I have
 * content the remote lacks" are the same question. Goals is a per-item
 * UNION merge: the union can legitimately contain a goal only the local
 * side has -- e.g. one created while offline or signed out -- even while
 * the REMOTE doc's own clock is ahead of the local device's overall,
 * because some OTHER goal was edited elsewhere more recently. A clock-only
 * gate would then see "remote is newer" and skip the write-back entirely,
 * silently stranding that local-only goal off Firestore -- lost outright if
 * this device is later lost or reset. Hence: push when EITHER check says
 * there's something new for the remote side, not only when the clock does.
 */
function goalsDifferFrom(merged: Goal[], remote: Goal[]): boolean {
  if (merged.length !== remote.length) return true;
  const remoteById = new Map(remote.map((g) => [g.id, g]));
  for (const g of merged) {
    const r = remoteById.get(g.id);
    if (!r) return true;
    if (g.topic !== r.topic || g.period !== r.period || g.targetS !== r.targetS || g.updatedAt !== r.updatedAt || g.archived !== r.archived) {
      return true;
    }
  }
  return false;
}

/**
 * Computes the full two-way-sync decision for one goals/config read, given
 * this device's current local state and whatever Firestore returned.
 * `remoteGoalsRaw` is untrusted -- a Firestore doc's `goals` field, or test
 * input standing in for one -- and is pushed through sanitizeRemoteGoals
 * before anything here trusts it (goals.ts's own boundary-validation choke
 * point); a malformed or malicious remote doc can't corrupt what this
 * function hands back.
 */
export function planGoalsSync(
  localGoals: Goal[],
  localDocUpdatedAt: number,
  remoteGoalsRaw: unknown,
  remoteDocUpdatedAt: number,
): GoalsSyncPlan {
  const remoteGoals = sanitizeRemoteGoals(remoteGoalsRaw);
  const merged = mergeGoals(localGoals, remoteGoals);
  const docUpdatedAt = mergedGoalsDocUpdatedAt(merged, localDocUpdatedAt, remoteDocUpdatedAt);
  const shouldPushBack = docUpdatedAt > remoteDocUpdatedAt || goalsDifferFrom(merged, remoteGoals);
  return { merged, docUpdatedAt, shouldPushBack };
}
