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
import { getFirebaseAuth } from '../auth/firebase';
import { pushGoalsPatch } from './firestoreSync';
import type { Goal } from '../goals/goals';

let started = false;

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

/** Call once at app start, after initFirebaseAuth() has resolved. Idempotent. */
export function startGoalsSyncBridge(): void {
  if (started) return;
  started = true;
  let prev = snapshot(useGoalsStore.getState());
  useGoalsStore.subscribe((state) => {
    const next = snapshot(state);
    if (equal(prev, next)) return; // e.g. hydrated flipped with no actual goal change
    prev = next;
    let auth;
    try {
      auth = getFirebaseAuth();
    } catch {
      return; // Firebase Auth not initialized yet -- nothing to push to
    }
    if (!auth.currentUser) return; // signed out: local-only, nothing to push
    pushGoalsPatch().catch(() => {}); // best-effort; next successful sync catches up
  });
}
