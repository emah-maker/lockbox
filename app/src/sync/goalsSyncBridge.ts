// goalsSyncBridge.ts -- wires useGoalsStore mutations to a best-effort
// Firestore push, mirroring settingsSyncBridge.ts's pattern exactly (see
// that file's header for the full reasoning, repeated briefly here):
// useStore.ts's existing "optimistic local write, best-effort remote sync"
// pattern for box settings (pushBoxSettings), applied to goals.
//
// Lives outside both useGoalsStore.ts and firestoreSync.ts (rather than
// having either import the other) for the same circular-dependency reason
// settingsSyncBridge.ts does: firestoreSync.ts already reads useGoalsStore
// for the migration/merge logic, so useGoalsStore itself stays free of any
// Firebase import.
import { useGoalsStore } from '../store/useGoalsStore';
import { pushGoalsPatch } from './firestoreSync';
import { createSnapshotPushBridge } from './syncCommon';
import type { Goal } from '../goals/goals';

function snapshot(state: ReturnType<typeof useGoalsStore.getState>): Goal[] {
  return state.goals;
}

function equal(a: Goal[], b: Goal[]): boolean {
  // goals is replaced with a new array on every CRUD op (see useGoalsStore's
  // addGoal/updateGoal/archiveGoal, both of which go through its module-
  // private persist() helper), so a reference check alone would miss
  // nothing here -- JSON compare is just belt-and-suspenders against a
  // future caller that mutates in place, same reasoning as
  // settingsSyncBridge.ts's customLabels compare.
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Call once at app start, after initFirebaseAuth() has resolved. Idempotent.
 * Shares settingsSyncBridge's whole scaffold through
 * createSnapshotPushBridge (syncCommon.ts) -- `equal` above is the only
 * difference, so that hydrated flipping with no actual goal change doesn't
 * push. */
export const startGoalsSyncBridge = createSnapshotPushBridge(
  useGoalsStore,
  snapshot,
  equal,
  pushGoalsPatch,
);
