// useScheduleStore.ts -- local persistence for scheduled focus sessions
// (the calendar's "schedule a session" reminders). Modeled directly on
// useGoalsStore.ts: hydrate() once from App.tsx, persist every mutation
// through storage.ts, and delegate every piece of logic to the pure module
// (schedule/scheduledSessions.ts) rather than re-implementing validation,
// id generation, or pruning here.
//
// Synced, per document, through sync/scheduledSessionsSync.ts -- see that
// module for the merge rule and for why these live as individual Firestore
// documents rather than one array field the way goals do.
//
// DELETION IS A TOMBSTONE (`deletedIds`), not just a removal. A plain delete
// would be invisible to a device that was offline when it happened: that
// device still holds the plan, pushes it back on its next sync, and the plan
// -- and its reminder -- silently returns. The tombstone is what lets the
// deletion win that race. Tombstones are pruned on the same 30-day schedule
// as the plans themselves, which is long enough for any device that was away
// to have come back and observed one.
//
// Every mutation does three fire-and-forget things: re-reconcile the OS's
// pending local reminders, tell the push backend what this device now covers
// locally (push/pushRegistration.ts -- this is what stops the server sending
// a second copy of a reminder the phone will show anyway), and let the sync
// bridge push the change up. None of them is ever awaited or gated on: a
// plan's local persistence must not fail because a scheduler or a network
// call did.
import { create } from 'zustand';
import { getJSON, setJSON } from '../storage/storage';
import { readNotificationPrefs, watchSettingsKey } from './useSettingsStore';
import { createDebouncer } from '../util/debounce';
import {
  SCHEDULED_PRUNE_MS,
  ScheduledSession,
  ScheduledSessionInput,
  createScheduledSession as createIn,
  updateScheduledSession as updateIn,
  deleteScheduledSession as deleteIn,
  setScheduledSessionDone as setDoneIn,
  pruneScheduledSessions,
} from '../schedule/scheduledSessions';
import { syncSessionReminders } from '../schedule/sessionReminders';
import { reportLocalCoverage } from '../push/pushRegistration';

const SCHEDULE_KEY = 'scheduledSessions';
const DELETED_KEY = 'scheduledSessionsDeleted';

// Coalesces bursts into one reconcile -- the same debounce (and the same
// reasoning) goalNotificationBridge.ts applies: a settings change can emit
// several times in a tick, and each would otherwise trigger a full
// cancel-and-reschedule pass against the OS.
const RESYNC_DEBOUNCE_MS = 400;
const resync = createDebouncer(() => useScheduleStore.getState().resyncReminders(), RESYNC_DEBOUNCE_MS);

interface ScheduleState {
  hydrated: boolean;
  scheduled: ScheduledSession[];
  /** Deletion tombstones: plan id -> when it was deleted (epoch ms). Read by
   * sync/scheduledSessionsSync.ts, which uses them both to suppress a remote
   * copy of a deleted plan and to retry the remote delete. See this file's
   * header for why a plain removal isn't enough. */
  deletedIds: Record<string, number>;
  /**
   * Counts LOCAL mutations only -- add/edit/remove/setDone. Not hydration,
   * not a remote merge being applied, not a reminder resync.
   *
   * Exists because sync/scheduledSessionsSyncBridge.ts cannot tell those
   * apart from the plan array alone, and the difference is not cosmetic. Its
   * push rewrites whole documents including `notifiedAt: null`, the field the
   * REMINDER JOB writes to record that it has already sent a reminder
   * (functions/src/index.ts). Rewriting an unchanged plan therefore re-arms
   * it: the reminder that fired at 08:50 was pushed a second time because the
   * app was opened at 08:55 and hydration looked like a change. A remote
   * merge echoed the same way, pushing back the very documents it had just
   * pulled and clearing the mark on each.
   */
  localWrites: number;

  hydrate: () => Promise<void>;
  addScheduledSession: (input: ScheduledSessionInput) => void;
  editScheduledSession: (id: string, input: ScheduledSessionInput) => void;
  removeScheduledSession: (id: string) => void;
  /** Replaces the local set with the result of a remote merge
   * (sync/scheduledSessionsSync.ts). Mirrors useGoalsStore's
   * applyRemoteGoals: the merge itself happens in sync/, this only commits
   * it -- so pruning, persistence, rescheduling and coverage reporting all
   * still funnel through the one write path below. */
  applyRemoteScheduledSessions: (plans: ScheduledSession[]) => void;
  setDone: (id: string, done: boolean) => void;
  /** Re-plans against the CURRENT time and prefs without any data change --
   * called by the prefs watch below, and worth calling on app foreground if
   * that ever exists, since a one-off reminder's eligibility changes purely
   * with the passage of time (see sessionReminderPlan.ts). */
  resyncReminders: () => void;
  /** Clears every plan -- called from sync/localDataOwner.ts's
   * clearLocalAccountData on sign-out/account-deletion/account-switch,
   * alongside useGoalsStore's resetGoals. A plan names what someone intends
   * to work on; it has no business surviving into another account's session
   * on a shared or resold device. */
  resetScheduledSessions: () => void;
}

/** The one write path: prunes aged-out plans, commits to state + storage,
 * then reconciles the OS. Every mutation funnels through here so pruning and
 * rescheduling each happen exactly once per write -- the same choke-point
 * shape useGoalsStore's own `persist` uses. */
function persist(
  set: (partial: Partial<ScheduleState>) => void,
  items: ScheduledSession[],
  deletedIds: Record<string, number>,
  /** 'local' = the user changed something here and it should be mirrored to
   * Firestore. 'internal' = anything else that rewrites the array without
   * being an edit: a remote merge landing, an account wipe. See
   * ScheduleState.localWrites. */
  source: 'local' | 'internal',
  localWrites: number,
): void {
  const nowMs = Date.now();
  const pruned = pruneScheduledSessions(items, nowMs);
  const tombstones = pruneTombstones(deletedIds, nowMs);
  // `hydrated` here is not bookkeeping -- it is what stops hydrate() from
  // undoing this write; see hydrate()'s own comment, and useGoalsStore's
  // matching pair.
  set({
    hydrated: true,
    scheduled: pruned,
    deletedIds: tombstones,
    localWrites: source === 'local' ? localWrites + 1 : localWrites,
  });
  setJSON(SCHEDULE_KEY, pruned);
  setJSON(DELETED_KEY, tombstones);
  // The coverage report is chained off the reconcile rather than fired
  // beside it, because it has to describe what the OS ACTUALLY holds -- see
  // syncSessionReminders' own return-value comment for why reporting an
  // intention instead would silence the server's copy of a reminder the
  // phone then never shows.
  void syncSessionReminders(pruned, readNotificationPrefs()).then(reportLocalCoverage);
}

/** Drops tombstones older than the plans themselves are kept for. Same
 * window on purpose: a tombstone only has to outlive the plan it suppresses,
 * and one kept longer is just a row that can never do anything again. */
function pruneTombstones(deletedIds: Record<string, number>, nowMs: number): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [id, at] of Object.entries(deletedIds)) {
    if (nowMs - at <= SCHEDULED_PRUNE_MS) out[id] = at;
  }
  return out;
}

export const useScheduleStore = create<ScheduleState>((set, get) => ({
  hydrated: false,
  scheduled: [],
  deletedIds: {},
  localWrites: 0,

  hydrate: async () => {
    if (get().hydrated) return;
    const [scheduled, deletedIds] = await Promise.all([
      getJSON<ScheduledSession[]>(SCHEDULE_KEY, []),
      getJSON<Record<string, number>>(DELETED_KEY, {}),
    ]);
    // Pruned on hydrate as well as on write: an app reopened after weeks
    // away has plans that aged out while nothing was running to prune them,
    // and those must not be handed to the reconcile below.
    const nowMs = Date.now();
    const pruned = pruneScheduledSessions(scheduled, nowMs);
    const tombstones = pruneTombstones(deletedIds, nowMs);
    // Re-check AFTER the awaits, not just before them. App.tsx fires this
    // hydrate independently of useAuthStore.init(), and for an already
    // signed-in user the sign-in sync can reach applyRemoteScheduledSessions
    // -> persist() while the two reads above are still in flight. persist()
    // writes through to storage, so what we read is then a snapshot of the
    // pre-sync past; committing it anyway reverted the just-merged plans (and
    // the session reminders reconciled from them) to the stale local list.
    // Whoever wrote last wins, and a write always beats a read that started
    // earlier.
    if (get().hydrated) return;
    set({ hydrated: true, scheduled: pruned, deletedIds: tombstones });
    if (pruned.length !== scheduled.length) setJSON(SCHEDULE_KEY, pruned);
    void syncSessionReminders(pruned, readNotificationPrefs()).then(reportLocalCoverage);
  },

  addScheduledSession: (input) => {
    persist(set, createIn(get().scheduled, input), get().deletedIds, 'local', get().localWrites);
  },

  editScheduledSession: (id, input) => {
    persist(set, updateIn(get().scheduled, id, input), get().deletedIds, 'local', get().localWrites);
  },

  removeScheduledSession: (id) => {
    // The tombstone is written even when the id isn't present locally --
    // deleteIn no-ops on an unknown id, but a plan this device has already
    // pruned may still exist remotely, and suppressing it is exactly what
    // the tombstone is for.
    persist(set, deleteIn(get().scheduled, id), { ...get().deletedIds, [id]: Date.now() }, 'local', get().localWrites);
  },

  setDone: (id, done) => {
    persist(set, setDoneIn(get().scheduled, id, done), get().deletedIds, 'local', get().localWrites);
  },

  applyRemoteScheduledSessions: (plans) => {
    // 'internal': the sync that produced `plans` has already reconciled both
    // sides and pushed whatever the server was missing. Counting this as a
    // local write would send it all straight back -- see localWrites.
    persist(set, plans, get().deletedIds, 'internal', get().localWrites);
  },

  resyncReminders: () => {
    void syncSessionReminders(get().scheduled, readNotificationPrefs()).then(reportLocalCoverage);
  },

  resetScheduledSessions: () => {
    // Tombstones go too. They exist to suppress the PREVIOUS account's plans
    // coming back from Firestore, and after a sign-out there is no such
    // account to suppress -- carrying them into the next account would mean
    // silently swallowing a plan of theirs that happened to share an id.
    // 'internal': a wipe is not an edit to propagate. The account this data
    // belonged to is being left behind (sync/localDataOwner.ts), and pushing
    // on the way out is the exact shape of the sign-out bug that file exists
    // to prevent.
    persist(set, [], {}, 'internal', get().localWrites);
  },
}));

/** The four notification prefs flattened into one comparable string -- the
 * same "snapshot then compare" shape settingsSyncBridge.ts and
 * goalNotificationBridge.ts both use, small enough that a string beats a
 * structural compare. */
// Derived from readNotificationPrefs() rather than re-reading the four
// store fields a second time -- one place names them, so a fifth pref
// cannot be added to the projection and missed by this watch's key.
function prefsKey(): string {
  const p = readNotificationPrefs();
  return `${p.enabled}|${p.quietHoursEnabled}|${p.quietStart}|${p.quietEnd}`;
}

let teardown: (() => void) | null = null;

/**
 * Keeps pending session reminders in step with the GLOBAL notification prefs
 * (master switch, quiet hours), which the mutations above can't observe.
 * Started once from App.tsx alongside the other bridges; idempotent -- a
 * second call returns the existing teardown rather than double-subscribing.
 *
 * Lives in this file rather than a separate bridge module (goals needed one
 * only because useGoalsStore is imported BY the bridge, and because the goal
 * plan also depends on the session log, which lives in the BLE-importing
 * useStore -- see goalNotificationBridge.ts's header). Neither constraint
 * applies here: this store's inputs are itself and useSettingsStore, and
 * useSettingsStore does not import it, so there is no cycle to route around.
 */
export function startSessionReminderWatch(): () => void {
  if (teardown) return teardown;

  const unsub = watchSettingsKey(prefsKey, resync.run);

  teardown = () => {
    teardown = null;
    resync.cancel(); // must not fire against a torn-down subscription
    unsub();
  };
  return teardown;
}
