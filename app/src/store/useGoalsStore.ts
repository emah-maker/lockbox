// useGoalsStore.ts -- pure local persistence for focus-time goals. Modeled
// closely on useSettingsStore.ts: loads once via hydrate() (called from
// App.tsx, alongside useStore.init()/useSettingsStore's own hydrate -- see
// App.tsx's comment on required init ordering) and persists every mutation
// through storage.ts. This store holds/persists state and stamps a client
// logical clock on every mutation -- it deliberately does NOT re-implement
// any of goals.ts's validation, id generation, or tombstone semantics; every
// CRUD action here is a thin wrapper delegating straight to goals.ts's pure
// helpers (createGoal/updateGoal/archiveGoal), the same division of labor
// useSettingsStore.ts has with customLabels.ts's createCustomLabel/
// renameCustomLabel/deleteCustomLabel.
//
// Deliberately has no Firebase import, for the same reason useSettingsStore.ts
// doesn't: sync/goalsSyncBridge.ts and sync/firestoreSync.ts are the only
// things that know Firestore exists (see settingsSyncBridge.ts's header for
// why that separation matters -- firestoreSync.ts already reads this store
// for the migration/merge logic, so a Firebase import here would create a
// circular dependency).
// Also fires syncGoalNotifications (goalNotifications.ts) after hydrate and
// after every mutation, per that module's own "call this from useGoalsStore"
// contract -- fire-and-forget, same as this file's own pre-existing
// hydrate()/init() calls in App.tsx: a goal's local persistence must never
// be gated on, or fail because of, whatever the OS's notification
// scheduler does with the result (goalNotifications.ts's own header goes
// into why that call chain never throws in the first place).
import { create } from 'zustand';
import { getJSON, setJSON } from '../storage/storage';
import {
  Goal,
  GoalPeriod,
  GoalPatch,
  GoalCreateExtras,
  createGoal as createGoalIn,
  updateGoal as updateGoalIn,
  archiveGoal as archiveGoalIn,
  pruneArchivedGoals,
} from '../goals/goals';
import { syncGoalNotifications } from '../goals/goalNotifications';

const GOALS_KEY = 'focusGoals';
const GOALS_UPDATED_AT_KEY = 'goalsUpdatedAt';

interface GoalsState {
  hydrated: boolean;
  goals: Goal[];
  // Epoch ms doc-level logical clock, stamped on every local mutation --
  // compared against Firestore's goals/config.updatedAt for the two-way
  // merge sync (sync/firestoreSync.ts's syncGoalsTwoWay), exactly the way
  // useSettingsStore's settingsUpdatedAt is compared by syncSettingsTwoWay.
  // Distinct from each individual Goal's own per-item `updatedAt` (the
  // per-goal LWW clock goalMerge.ts's mergeGoals compares) -- see
  // goalMerge.ts's mergedGoalsDocUpdatedAt for how the two combine.
  goalsUpdatedAt: number;

  hydrate: () => Promise<void>;
  addGoal: (topic: string | null, period: GoalPeriod, targetS: number, extra?: GoalCreateExtras) => void;
  updateGoal: (id: string, patch: GoalPatch) => void;
  archiveGoal: (id: string) => void;
  /** Applied when a Firestore goals/config doc (already merged with the
   * local copy by sync/firestoreSync.ts's syncGoalsTwoWay, via
   * goalMerge.ts's mergeGoals) supersedes what's stored locally --
   * mirrors useSettingsStore's applyRemoteSettings. `updatedAt` is the
   * merge's own doc-level clock (goalMerge.ts's mergedGoalsDocUpdatedAt),
   * preserved as-is so a later comparison against another device's copy
   * stays correct. */
  applyRemoteGoals: (goals: Goal[], updatedAt: number) => void;
  /** Resets to no goals and zeroes goalsUpdatedAt -- called from
   * sync/localDataOwner.ts's clearLocalAccountData on sign-out/account
   * deletion/account-switch, the same call site (and reasoning) as
   * useSettingsStore's resetSyncableSettings, so no prior account's goals
   * linger on a shared/reset/resold device. */
  resetGoals: () => void;
}

/** Commits `goals` to state + storage, pruning aged-out archived tombstones
 * first (contract: "Archived tombstones older than 30 days are pruned
 * client-side on write") -- every mutation below funnels through this one
 * spot so pruning happens exactly once on the local write path (not on every
 * read/render), regardless of whether the write originated from a CRUD
 * action or an applied remote merge. Same choke-point reasoning as
 * sessionHistory.ts's loadSessions healing sub-minute records in one place
 * rather than expecting every caller to re-check. Module-private: nothing
 * outside this file should be committing to `goals` storage directly. */
function persist(set: (partial: Partial<GoalsState>) => void, goals: Goal[], updatedAt: number): void {
  const pruned = pruneArchivedGoals(goals);
  set({ goals: pruned, goalsUpdatedAt: updatedAt });
  setJSON(GOALS_KEY, pruned);
  setJSON(GOALS_UPDATED_AT_KEY, updatedAt);
  // Fire-and-forget: syncGoalNotifications never throws (see its own
  // header), but `void` makes it explicit at every call site that nothing
  // here awaits or otherwise gates on the OS's notification scheduler.
  void syncGoalNotifications(pruned);
}

export const useGoalsStore = create<GoalsState>((set, get) => ({
  hydrated: false,
  goals: [],
  goalsUpdatedAt: 0,

  hydrate: async () => {
    if (get().hydrated) return;
    const [goals, goalsUpdatedAt] = await Promise.all([
      getJSON<Goal[]>(GOALS_KEY, []),
      getJSON<number>(GOALS_UPDATED_AT_KEY, 0),
    ]);
    set({ hydrated: true, goals, goalsUpdatedAt });
    void syncGoalNotifications(goals);
  },

  addGoal: (topic, period, targetS, extra) => {
    // One nowMs shared by the pure helper's own createdAt/updatedAt stamp
    // and this store's doc-level clock, so the two never drift apart by the
    // few ms between two separate Date.now() calls (same reasoning
    // useSettingsStore's actions capture settingsUpdatedAt once and reuse
    // it across both the field write and the clock write).
    const nowMs = Date.now();
    const goals = createGoalIn(get().goals, topic, period, targetS, nowMs, extra);
    persist(set, goals, nowMs);
  },

  updateGoal: (id, patch) => {
    const nowMs = Date.now();
    const goals = updateGoalIn(get().goals, id, patch, nowMs);
    persist(set, goals, nowMs);
  },

  archiveGoal: (id) => {
    const nowMs = Date.now();
    const goals = archiveGoalIn(get().goals, id, nowMs);
    persist(set, goals, nowMs);
  },

  applyRemoteGoals: (goals, updatedAt) => {
    persist(set, goals, updatedAt);
  },

  resetGoals: () => {
    persist(set, [], 0);
  },
}));
