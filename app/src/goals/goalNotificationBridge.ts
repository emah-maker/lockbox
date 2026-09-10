// goalNotificationBridge.ts -- the wiring that keeps scheduled goal
// reminders in step with everything they depend on. goalNotificationPlan.ts
// decides WHAT should be scheduled and goalNotifications.ts talks to the OS;
// this module is the only piece that knows which stores those inputs come
// from, and when they change.
//
// It exists because progress-aware reminders (Goal.notifyOnlyIfBehind) made
// the reminder set depend on more than the goals themselves. A reminder now
// has to be withdrawn the moment its goal's window is met -- which happens
// when a SESSION is logged, not when a goal is edited -- and the whole set
// has to be re-planned when the user changes the global switch or their
// quiet hours. Before this, useGoalsStore's own `void syncGoalNotifications(
// goals)` on every mutation was the only trigger, so a met goal kept nudging
// until the next time the user happened to edit something.
//
// Deliberately imports NEITHER useGoalsStore NOR useStore, even though goals
// and sessions are its two main inputs:
//   - useGoalsStore imports THIS module (to resync on every mutation), so
//     importing it back would be a module cycle.
//   - useStore constructs a BleManager at module scope, so importing it here
//     would drag BLE into useGoalsStore's import graph -- which breaks that
//     store's own unit tests, where no native BLE module is registered.
// Both inputs are therefore PUSHED in and cached here (`latestGoals`,
// `latestSessions`); goalNotificationWatch.ts is the one module that owns
// the useStore subscription feeding sessions in.
import { useSettingsStore, readNotificationPrefs, watchSettingsKey } from '../store/useSettingsStore';
import { createDebouncer } from '../util/debounce';
import { computeGoalProgress } from './goalProgress';
import { syncGoalNotifications, type GoalProgressSnapshot } from './goalNotifications';
import type { Goal } from './goals';
import type { LoggedSession } from '../stats/sessionHistory';

// The most recent goal array anyone handed us. Seeded empty (which plans
// nothing, the correct answer before hydrate) and replaced on every
// resyncGoalNotifications call that supplies one -- so a resync triggered by
// a session or a settings change still knows which goals to plan for without
// this module reaching into useGoalsStore.
let latestGoals: Goal[] = [];

// Likewise the most recent session log. Seeded empty, which reads as "no
// progress yet" -- a `notifyOnlyIfBehind` goal is then treated as behind
// (so it still schedules) until the first real array arrives, which is the
// safe direction: a reminder that fires once when it needn't have beats one
// that silently never fires.
let latestSessions: LoggedSession[] = [];

// Coalesces bursts into one reconcile. A drained box-history batch appends
// several sessions in quick succession, and each would otherwise trigger its
// own full cancel-and-reschedule pass against the OS. The delay is short
// enough to be invisible and long enough to collapse a batch.
const RESYNC_DEBOUNCE_MS = 400;

/** Current-window progress for every goal, in the minimal shape the planner
 * needs. goalProgress.ts's computeGoalProgress is the one authority on this
 * math -- never reimplemented here, same restriction useHomeGoalRing.ts
 * operates under. */
function readProgress(goals: Goal[]): Map<string, GoalProgressSnapshot> {
  // customLabels/excludedTopicKeys so an excludeFromTotals-tagged session (or
  // one tagged with an excluded built-in topic -- stats/customLabels.ts)
  // never counts as progress here either -- otherwise a notifyOnlyIfBehind
  // reminder for a goal could get silently withdrawn (or never fire) because
  // of time logged under a label/topic the user explicitly asked not to
  // count.
  const settings = useSettingsStore.getState();
  const results = computeGoalProgress(goals, latestSessions, Date.now(), settings.customLabels, settings.excludedTopicKeys);
  return new Map(results.map((r) => [r.goalId, { met: r.met, remainingS: r.remainingS }]));
}

/** Hands the current session log in and re-plans. Called by
 * goalNotificationWatch.ts whenever useStore.sessions changes -- a newly
 * logged session can push a goal over its target, which must withdraw that
 * goal's remaining progress-aware nudges. This is the trigger that didn't
 * exist before: goal mutations alone never observed a session landing. */
export function noteSessionsChanged(sessions: LoggedSession[]): void {
  latestSessions = sessions;
  resync.run();
}

/**
 * Re-plan and re-schedule every goal reminder. Pass `goals` from a store
 * mutation that already has the fresh array; omit it for a resync triggered
 * by something else (a new session, a prefs change), which reuses the last
 * array it was given.
 *
 * Fire-and-forget by design: syncGoalNotifications never throws (see its own
 * header), and nothing in the app should gate on the OS scheduler.
 */
export function resyncGoalNotifications(goals?: Goal[]): void {
  if (goals) latestGoals = goals;
  const planned = latestGoals;
  // The label catalog is read here, alongside prefs, rather than cached like
  // goals/sessions: it lives in useSettingsStore, which this module already
  // reads for prefs, so there is nothing to push in. Without it every
  // reminder for a custom-label goal named that label by its internal id.
  void syncGoalNotifications(
    planned,
    readNotificationPrefs(),
    readProgress(planned),
    useSettingsStore.getState().customLabels,
  );
}

/** Debounced variant for the subscription paths, where several changes can
 * land in the same tick. */
const resync = createDebouncer(() => resyncGoalNotifications(), RESYNC_DEBOUNCE_MS);

/**
 * Subscribes to the notification PREFS half of the plan's inputs and
 * returns an unsubscribe. The sessions half is pushed in via
 * noteSessionsChanged (see this file's header for why the useStore
 * subscription can't live here). Started from goalNotificationWatch.ts,
 * which App.tsx calls alongside the other bridges.
 *
 * The listener does its own change detection against a cached snapshot
 * (zustand v5's `subscribe` takes a whole-state listener, so this is the
 * same idiom sync/settingsSyncBridge.ts and battery/batterySamplingBridge.ts
 * already use) -- unrelated store emissions (theme, box settings) cost one
 * string compare and nothing more.
 *
 * Also watches customLabels/excludedTopicKeys, not just the four notify
 * prefs the function's own name refers to -- readProgress above folds both
 * into every goal's `met` snapshot, specifically so a notifyOnlyIfBehind
 * reminder reacts to a label/topic exclusion. That only works if toggling
 * CustomLabelsSection.tsx's "Counts toward totals" switch actually triggers
 * a resync: before this, flipping it changed nothing this watch compared,
 * so a reminder already scheduled off the OLD (pre-exclusion) progress kept
 * running -- or a goal that just became newly-behind because its counted
 * time dropped stayed silent -- until some unrelated trigger (a new
 * session, a goal edit, or an actual prefs change) happened to resync next.
 *
 * Idempotent: a second call while already started returns the existing
 * teardown rather than double-subscribing.
 */
export function startGoalNotificationPrefsWatch(): () => void {
  if (teardown) return teardown;

  const unsubPrefs = watchSettingsKey(watchedKey, resync.run);

  teardown = () => {
    teardown = null;
    resync.cancel(); // must not fire against a torn-down subscription
    unsubPrefs();
  };
  return teardown;
}

/** The four notification prefs, plus everything readProgress reads to
 * decide `met` (customLabels/excludedTopicKeys), flattened into one
 * comparable string -- the same "snapshot then compare" shape
 * settingsSyncBridge.ts uses, small enough that a string beats a structural
 * compare. customLabels is JSON.stringify'd rather than pulled apart into
 * just the ids/excludeFromTotals bits that actually matter to progress --
 * same "compare the whole synced array" convention settingsSyncBridge.ts's
 * own change-detection already uses for this exact field, and a false
 * positive here (a rename/color edit that doesn't change any exclusion)
 * costs one extra harmless resync, not a wrong schedule. */
function watchedKey(): string {
  const s = useSettingsStore.getState();
  return `${s.notificationsEnabled}|${s.quietHoursEnabled}|${s.quietStart}|${s.quietEnd}|${JSON.stringify(s.customLabels)}|${JSON.stringify(s.excludedTopicKeys)}`;
}

let teardown: (() => void) | null = null;
