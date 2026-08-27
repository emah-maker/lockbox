// goalMerge.ts -- pure per-goal merge for the goals/config Firestore doc
// (see docs/rfcs/google-signin-cross-device-sync-architecture.md and this
// feature's own contract). Split out from wherever the actual Firestore
// read/write lives (that code talks to `firebase/firestore`, which jest's
// default transform can't parse -- see sync/sessionMerge.ts's own header for
// the identical reasoning) so this stays unit-testable.
//
// This is a union-by-id, per-item last-write-wins merge -- structurally the
// same shape as sync/sessionMerge.ts's per-session merge, but simpler: a
// goal has exactly one mutable "version" (the whole record, compared by its
// own updatedAt), where sessionMerge.ts has to special-case which *part* of
// a session (just its topic) is being LWW'd versus which parts are
// immutable. Follows sync/firestoreSync.ts's syncSettingsTwoWay for the
// doc-level clock idea (mergedGoalsDocUpdatedAt below).
//
// The result is also capped to MAX_GOALS (see capToMaxGoals below) --
// createGoal caps a *single* side at MAX_GOALS, and so does
// sanitizeRemoteGoals, but a union of two disjoint capped sets can still be
// up to 2*MAX_GOALS. app/firestore.rules enforces goals.size() <= MAX_GOALS
// on the goals/config doc, and the push path that writes a merge result
// back is best-effort (swallows its own errors) -- so an uncapped merge
// here wouldn't fail loudly, it would just make every subsequent sync
// silently stop working. This is the one place that guarantee has to be
// enforced, since it's the only function that can produce an over-cap
// array in the first place.
import { type Goal, MAX_GOALS } from './goals';

/**
 * Union by `id`. For an id present on both sides, keeps whichever copy has
 * the greater `updatedAt`; a tie keeps local (matches syncSettingsTwoWay's
 * own tie-break, and sessionMerge.ts's "falls back to local-wins" case) --
 * ties are the ordinary case for a goal neither side has touched since the
 * last sync, so this is really "prefer local when nothing changed" rather
 * than a coin flip. `archived` is just a field on the record like any
 * other, so a delete-vs-edit conflict resolves by the same compare, with no
 * special-casing -- deliberately: giving "archived" priority regardless of
 * recency would let a stale delete on one device permanently resurrect-proof
 * itself against a genuinely newer edit made on another device before it
 * ever saw the delete.
 *
 * The unioned set is then run through capToMaxGoals, which can evict
 * entries when the union exceeds MAX_GOALS -- see that function for the
 * eviction rule. Swapping `local`/`remote` reproduces the exact same
 * result, except for which copy wins a genuine updatedAt tie (documented
 * above): capToMaxGoals's own ranking depends only on each merged goal's
 * `archived`/`updatedAt`/`id`, none of which depend on which argument was
 * "local".
 */
export function mergeGoals(local: Goal[], remote: Goal[]): Goal[] {
  const merged = new Map<string, Goal>();

  for (const g of remote) merged.set(g.id, g);
  for (const g of local) {
    const existing = merged.get(g.id);
    if (!existing || g.updatedAt >= existing.updatedAt) merged.set(g.id, g);
  }

  return capToMaxGoals(Array.from(merged.values()));
}

/** Deterministic display/storage order: by `createdAt` ascending, then `id`
 * ascending as a tiebreak -- so re-running the merge (e.g. after another
 * round-trip through Firestore) never reorders a list a UI might be
 * rendering by array position. */
function sortGoals(goals: Goal[]): Goal[] {
  return goals.slice().sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
}

/**
 * If `goals` is already within MAX_GOALS, just applies the deterministic
 * display sort. Otherwise evicts down to MAX_GOALS *before* sorting, so the
 * final sort never influences which entries survive:
 *
 * 1. Live goals (`archived: false`) are kept over archived tombstones --
 *    losing a tombstone early is a small, self-healing loss (tombstones are
 *    already meant to be pruned once old enough, see goals.ts's
 *    pruneArchivedGoals); losing a live goal is a real, permanent loss of
 *    the user's own data.
 * 2. Within the same archived status, the most-recently-updated entries are
 *    kept over the stalest ones -- a goal nobody has touched in a long time
 *    is the least likely one anybody would notice or mind losing.
 * 3. Ties (identical archived + updatedAt) break by `id` ascending, purely
 *    for determinism -- this can only matter for two goals that are
 *    otherwise indistinguishable by eviction priority.
 *
 * This ranking depends only on each goal's own `archived`/`updatedAt`/`id`,
 * never on which side of mergeGoals it came from, so the eviction outcome
 * is identical regardless of argument order.
 */
function capToMaxGoals(goals: Goal[]): Goal[] {
  if (goals.length <= MAX_GOALS) return sortGoals(goals);
  const ranked = goals.slice().sort((a, b) => {
    if (a.archived !== b.archived) return a.archived ? 1 : -1; // live before archived
    if (a.updatedAt !== b.updatedAt) return b.updatedAt - a.updatedAt; // newer before older
    return a.id.localeCompare(b.id);
  });
  return sortGoals(ranked.slice(0, MAX_GOALS));
}

/**
 * The doc-level `updatedAt` to store alongside a merged goals array: the max
 * of every merged goal's own `updatedAt` and both sides' prior doc-level
 * clocks. This is *not* used by mergeGoals itself (which only ever compares
 * per-goal clocks) -- it exists purely so the sync layer can compare this
 * against what's already on Firestore and skip writing back a merge result
 * that wouldn't actually change anything, the same "is this write even
 * worth making" role firestoreSync.ts's syncSettingsTwoWay gives its own
 * settings doc clock.
 */
export function mergedGoalsDocUpdatedAt(merged: Goal[], localDocUpdatedAt: number, remoteDocUpdatedAt: number): number {
  return merged.reduce((max, g) => Math.max(max, g.updatedAt), Math.max(localDocUpdatedAt, remoteDocUpdatedAt));
}
