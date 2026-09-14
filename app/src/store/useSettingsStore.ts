// useSettingsStore.ts -- pure local preferences: theme, the call-alert
// toggle, and the box-settings mirror (protocol.ts Settings). These load once
// via hydrate() (called from useStore.init) and persist through storage.ts.
// useStore is the only thing that talks to the box over BLE; it calls
// setBoxSettings() after a read/write so this mirror stays in sync (see
// useStore.ts afterConnected / pushBoxSettings).
import { create } from 'zustand';
import { setJSON } from '../storage/storage';
import { ThemeMode, AccentKey } from '../theme/theme';
import type { Settings } from '../ble/protocol';
import {
  CustomLabel,
  createCustomLabel,
  renameCustomLabel as renameCustomLabelIn,
  deleteCustomLabel as deleteCustomLabelIn,
  setLabelExcluded as setLabelExcludedIn,
  setTopicKeyExcluded as setTopicKeyExcludedIn,
} from '../stats/customLabels';
// What a settings field IS on disk -- its default, its sanitizer, and the
// one read that loads them all. See settingsPersistence.ts for why this file
// no longer holds any of that, and why the dependency only points one way.
import {
  DEFAULT_BOX_SETTINGS,
  SYNCABLE_SETTINGS_DEFAULTS,
  loadBoxSettings,
  loadPersistedSettings,
  type SyncableSettings,
} from './settingsPersistence';

// Re-exported unchanged: sync/firestoreSync.ts and sync/settingsSyncPlan.ts
// import this type from here, and where it is declared is not their concern.
export type { SyncableSettings };
import type { TopicKey } from '../stats/topics';
import type { RingBaselineWindow, RingSourceKind } from '../screens/home/idleRingState';
import type { NotificationPrefs } from '../goals/goalNotificationPlan';

interface SettingsState {
  hydrated: boolean;
  themeMode: ThemeMode;
  accent: AccentKey;
  callAlertsEnabled: boolean;
  customLabels: CustomLabel[];
  /** See SyncableSettings.excludedTopicKeys's own comment. */
  excludedTopicKeys: string[];
  boxSettings: Settings;
  // Epoch ms of the last local change to any of the SyncableSettings
  // fields -- compared against Firestore's settings/app.updatedAt for the
  // two-way last-write-wins merge (sync/firestoreSync.ts).
  settingsUpdatedAt: number;
  // Local-only per-device preference (Account page §3): whether
  // useAuthStore.init's onAuthStateChanged handler should auto-trigger
  // syncNow() on sign-in/auth-state change. Deliberately NOT a
  // SyncableSettings field and NOT touched by resetSyncableSettings below --
  // unlike themeMode/accent/etc. (which represent "what the user wants
  // right now" and should follow them to every device), whether THIS device
  // should auto-sync is closer in nature to boxSettings' per-physical-device
  // scoping (§3.1's "deliberate scoping decision", extended here to a
  // per-installation UI preference rather than a per-box one): switching or
  // signing out of an account on this device must not silently flip a
  // preference the user set for this device back to its default. The
  // manual "Sync now" button is never gated by this -- see useAuthStore.
  autoSyncEnabled: boolean;
  // Local-only per-device preference: whether this installation talks to the
  // fake box (ble/DemoBoxClient.ts) instead of the radio. Off by default,
  // and deliberately NOT __DEV__-gated -- the whole point is that the store
  // build App Review runs is the build that has it (see
  // docs/handoff/demo-mode-handoff.md).
  //
  // Same category as autoSyncEnabled just above, and for a sharper version
  // of the same reason: "this phone is currently pretending to have a box"
  // is a fact about this device in this moment, not about the user's
  // account. Syncing it would turn demo mode on for a second phone that
  // does have a box sitting next to it. Explicitly NOT a SyncableSettings
  // field and NOT touched by resetSyncableSettings/applyRemoteSettings, so
  // signing in or out does not silently flip it either way -- which also
  // matters because demo mode has to work while signed out at all.
  demoModeEnabled: boolean;
  // Local-only per-device VIEW preference (Home ring, screens/home/
  // idleRingState.ts + settings/RingBaselineSection.tsx): which window's
  // best day the Home hero ring compares today's focus time against when no
  // daily goal is set. Same category as autoSyncEnabled just above -- and,
  // outside this settings-sync system entirely, StatsScreen's own
  // TIME_WINDOW_KEY (that screen's own comment makes the identical call for
  // its period selector) -- a device-local *display* choice, not an
  // account-level fact about the user, so it deliberately does NOT ride
  // along with themeMode/accent/etc. to every device the way those do.
  // Explicitly NOT a SyncableSettings field and NOT touched by
  // resetSyncableSettings/applyRemoteSettings below, for the same reason
  // autoSyncEnabled isn't: a sign-out/account-switch on this device must not
  // silently reset which baseline window this device's Home tab happens to
  // be showing.
  ringBaselineWindow: RingBaselineWindow;
  // Local-only per-device VIEW preference, same category and same reasoning
  // as ringBaselineWindow just above (this field's sibling, added alongside
  // it for the "more things you can put on the focus ring" extension --
  // see screens/home/idleRingState.ts's RingSourceKind): which of the ring's
  // five sources (auto/weeklyGoal/chosenGoal/rollingAverage/streak) the Home
  // hero ring shows. Explicitly NOT a SyncableSettings field and NOT touched
  // by resetSyncableSettings/applyRemoteSettings below, for the identical
  // reason ringBaselineWindow isn't -- a sign-out/account-switch on this
  // device must not silently reset which ring view this device's Home tab
  // happens to be showing.
  ringSourceKind: RingSourceKind;
  // Local-only per-device preference, paired with ringSourceKind above: the
  // id of the one goal the 'chosenGoal' ring source tracks, or null when
  // none has been picked yet (or the ring source isn't 'chosenGoal' at all).
  // Deliberately just a goal id, not a denormalized copy of the goal itself
  // -- useGoalsStore.goals is the only source of truth for what a goal
  // currently targets; DashboardScreen looks this id up fresh every render
  // (same "never cache a goal's own fields elsewhere" discipline
  // goalProgress.ts's own callers already follow). Same non-synced,
  // non-syncable-settings treatment as ringSourceKind/ringBaselineWindow --
  // a picked goal id is this device's own view choice, not account state.
  ringGoalId: string | null;
  // Local-only per-device VIEW preference, same category and reasoning as
  // ringSourceKind/ringGoalId above: whether the Home ring draws a second,
  // inner arc showing what today's focus time was actually spent ON (see
  // screens/home/idleRingState.ts's RingSegment). Independent of
  // ringSourceKind -- the mix answers a different question from whatever
  // the outer ring measures, so it can be shown alongside any source.
  ringShowTopicMix: boolean;
  // Local-only per-device NOTIFICATION preferences (goals/
  // goalNotificationPlan.ts's NotificationPrefs, surfaced in Settings >
  // Notifications). Same non-synced category as ringSourceKind/
  // ringBaselineWindow above and for a sharper version of the same reason:
  // whether THIS phone should buzz, and when it should stay quiet, is a
  // property of the device sitting on your nightstand, not of the account.
  // Syncing quiet hours to a tablet in another timezone would be actively
  // wrong. Explicitly NOT SyncableSettings fields and NOT touched by
  // resetSyncableSettings/applyRemoteSettings.
  //
  // notificationsEnabled is a MASTER switch over every goal's own `notify`:
  // off means nothing is scheduled at all, without editing (or losing) any
  // individual goal's reminder configuration.
  notificationsEnabled: boolean;
  quietHoursEnabled: boolean;
  /** 'HH:MM' local. The range may wrap past midnight (the usual case) --
   * goalNotificationPlan.ts's isInQuietHours owns that arithmetic. */
  quietStart: string;
  quietEnd: string;
  // Local-only per-device VIEW preference (Goal Streaks feature): which
  // goals' streaks CalendarScreen.tsx's month grid draws a dot for. Same
  // non-synced category as ringSourceKind/ringGoalId/ringBaselineWindow
  // above, and the same reasoning: which goals' streaks THIS device's
  // calendar happens to be showing is a display choice about this
  // installation, not a fact about the user's account that should follow
  // them to a tablet or a second phone -- localDataOwner.ts's own
  // clearLocalAccountData comment already anticipates exactly this category
  // ("view-only local prefs (time-window/best-streak selections)").
  //
  // `null` is the sentinel for "never customized" -- not the same as `[]`
  // (an explicit, deliberate "show none"). Read through
  // screens/calendar/monthGrid.ts's resolveCalendarStreakGoalIds, which
  // treats `null` as "every active goal" and always re-filters a real array
  // against useGoalsStore.goals live, so a goal that's since been deleted or
  // archived can never linger in the effective set even though it can still
  // linger in this raw preference array (deliberately not pruned here --
  // pruning would need this store to depend on useGoalsStore, and a stale id
  // sitting inertly in an array the resolver already filters costs nothing).
  calendarStreakGoalIds: string[] | null;

  hydrate: () => Promise<void>;
  setThemeMode: (mode: ThemeMode) => void;
  setAccent: (accent: AccentKey) => void;
  setCallAlertsEnabled: (on: boolean) => void;
  /** `options.persist === false` mirrors the values for DISPLAY without
   * writing them to disk -- demo mode's simulated box (ble/DemoBoxClient.ts).
   * Its settings have to be visible (otherwise Home warns that Open will not
   * release a box the demo will happily open), but this mirror is the
   * per-physical-box record of the user's REAL box, and `unlk` in particular
   * ships off there deliberately. Overwriting it would leave someone who
   * tried demo mode and never reconnected hardware reading "allow open from
   * this phone" as ON for a box where it is OFF. */
  setBoxSettings: (patch: Partial<Settings>, options?: { persist?: boolean }) => void;
  /** Puts the real box's on-disk mirror back in front of the user -- called
   * when demo mode is switched off, since what is in memory at that point is
   * the simulated box's unpersisted copy. */
  reloadBoxSettings: () => Promise<void>;
  setAutoSyncEnabled: (on: boolean) => void;
  /** Persists the demo-mode flag. Swapping the actual BLE client over is
   * useStore's setDemoMode -- call that, not this, from UI: this store has
   * no way to tear a live connection down, and a flag that disagrees with
   * which client is installed is exactly the state neither side can
   * recover from. */
  setDemoModeEnabled: (on: boolean) => void;
  setRingBaselineWindow: (w: RingBaselineWindow) => void;
  setRingSourceKind: (k: RingSourceKind) => void;
  setRingGoalId: (id: string | null) => void;
  setRingShowTopicMix: (on: boolean) => void;
  setNotificationsEnabled: (on: boolean) => void;
  setQuietHoursEnabled: (on: boolean) => void;
  setQuietHours: (start: string, end: string) => void;
  setCalendarStreakGoalIds: (ids: string[] | null) => void;
  addCustomLabel: (name: string, color: string) => void;
  renameCustomLabel: (id: string, name: string) => void;
  removeCustomLabel: (id: string) => void;
  /** Flips whether sessions tagged with this label count toward focus
   * totals/goal progress/streaks/the calendar heat map (stats/
   * customLabels.ts's sessionCountsTowardTotals) -- same
   * mutate-then-persist-then-bump-clock shape as addCustomLabel/
   * renameCustomLabel/removeCustomLabel above, since this rides along on the
   * same synced `customLabels` array they do (see CustomLabel.excludeFromTotals's
   * own comment). */
  setLabelExcluded: (id: string, excluded: boolean) => void;
  /** setLabelExcluded's counterpart for a built-in topic (stats/topics.ts's
   * TopicKey) -- same mutate-then-persist-then-bump-clock shape, since this
   * rides along on the same synced `excludedTopicKeys` array (see
   * SyncableSettings.excludedTopicKeys's own comment). */
  setTopicKeyExcluded: (key: TopicKey, excluded: boolean) => void;
  /** Applied when a remote Firestore settings/app doc is newer than the
   * local copy (LWW pull) -- does not itself trigger a remote push.
   * `updatedAt` is the remote doc's own timestamp, preserved as-is so a
   * later comparison against another device's copy stays correct. */
  applyRemoteSettings: (remote: SyncableSettings, updatedAt: number) => void;
  /** Resets the five account-syncable fields to their defaults and zeroes
   * settingsUpdatedAt, so a signed-out device carries no prior account's
   * preferences into whichever account (or none) signs in next -- see
   * sync/localDataOwner.ts. Leaves boxSettings, autoSyncEnabled, and
   * hydrated untouched -- autoSyncEnabled is a per-device preference, not
   * account state (see its own field comment above), so a sign-out/
   * account-switch on this device must not silently re-enable (or disable)
   * it against the user's own choice for this installation. */
  resetSyncableSettings: () => void;
}

/** The one real read, extracted so hydrate() below can hold a single
 * in-flight promise for it and hand that same promise to every concurrent
 * caller. Nothing else should call this directly. */
let hydrating: Promise<void> | null = null;

/** Loads every persisted field (store/settingsPersistence.ts owns the
 * defaults, the sanitizers, and the read itself) and commits it in one
 * update. Spreading into set() is also the type check that every persisted
 * field still matches the store's own: set() takes Partial<SettingsState>,
 * so a field renamed on one side and not the other fails to compile here. */
async function hydrateOnce(set: (partial: Partial<SettingsState>) => void): Promise<void> {
  set({ hydrated: true, ...(await loadPersistedSettings()) });
}

/**
 * The four global notification prefs, in the shape the reminder planners take
 * (goals/goalNotificationPlan.ts's NotificationPrefs).
 *
 * Read straight off the store rather than threaded through, for the reason
 * both callers documented independently: no caller of a mutation has any
 * business knowing about quiet hours. It lives HERE, next to the fields it
 * projects, because goals/goalNotificationBridge.ts and
 * store/useScheduleStore.ts each had a byte-identical private copy -- and a
 * fifth pref added to only one of them would have been a silent behavior
 * split between goal reminders and session reminders.
 *
 * Type-only import of NotificationPrefs: goalNotificationPlan is the pure
 * planner and imports no store, so this cannot become a cycle.
 */
export function readNotificationPrefs(): NotificationPrefs {
  const s = useSettingsStore.getState();
  return {
    enabled: s.notificationsEnabled,
    quietHoursEnabled: s.quietHoursEnabled,
    quietStart: s.quietStart,
    quietEnd: s.quietEnd,
  };
}

/**
 * Subscribes to this store, invoking `onChange` only when `key()` actually
 * changes. Returns the unsubscribe.
 *
 * zustand v5's `subscribe` hands the whole state to every listener, so each
 * watcher has to do its own change detection or it fires on every unrelated
 * emission (a theme flip, a box-settings push). Flattening the fields that
 * matter into one comparable string and comparing that is the idiom every
 * watcher in this app already converged on -- sync/settingsSyncBridge.ts,
 * goals/goalNotificationBridge.ts, store/useScheduleStore.ts -- written out
 * once here instead of three times. What each watcher still owns is the only
 * part that differs: WHICH fields go into its key.
 */
export function watchSettingsKey(key: () => string, onChange: () => void): () => void {
  let prev = key();
  return useSettingsStore.subscribe(() => {
    const next = key();
    if (next === prev) return; // some other settings field changed
    prev = next;
    onChange();
  });
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  hydrated: false,
  ...SYNCABLE_SETTINGS_DEFAULTS,
  boxSettings: DEFAULT_BOX_SETTINGS,
  settingsUpdatedAt: 0,
  autoSyncEnabled: true,
  demoModeEnabled: false,
  ringBaselineWindow: 'week',
  ringSourceKind: 'auto',
  ringGoalId: null,
  ringShowTopicMix: true,
  notificationsEnabled: true,
  quietHoursEnabled: false,
  quietStart: '22:00',
  quietEnd: '07:00',
  calendarStreakGoalIds: null,

  hydrate: async () => {
    if (get().hydrated) return;
    // Two callers now reach this concurrently on a cold boot -- useStore's
    // own init() Promise.all, and runMigrationAndSync, which awaits the three
    // stores before merging (a signed-in user's persisted Firebase session
    // resolves onAuthStateChanged almost immediately). `hydrated` is only set
    // at the very END of the read below, so both would pass the guard above,
    // both would run their own set of ~15 storage reads, and both would
    // commit. Whichever finished LAST won -- and if a remote settings doc had
    // been applied in between, the straggler's unconditional `set` silently
    // reverted themeMode/accent/callAlertsEnabled/customLabels to the
    // pre-merge snapshot it had read before the merge ran.
    //
    // The goals and schedule stores close their equivalent hole by
    // re-checking `hydrated` after their awaits and bailing. That does not
    // work here: this store's state is far wider than what a remote-settings
    // write touches (boxSettings, autoSyncEnabled and the ring/notification
    // prefs are device-local and are not in a remote doc at all), so bailing
    // would drop them and leave those fields at their defaults. Collapsing
    // the callers onto ONE in-flight read fixes it without that cost: there
    // is only ever one `set`, and by the time runMigrationAndSync's await
    // returns, nothing is still pending that could land on top of the merge.
    if (hydrating) return hydrating;
    hydrating = hydrateOnce(set).finally(() => {
      hydrating = null;
    });
    return hydrating;
  },

  setThemeMode: (mode) => {
    const settingsUpdatedAt = Date.now();
    set({ themeMode: mode, settingsUpdatedAt });
    setJSON('themeMode', mode);
    setJSON('settingsUpdatedAt', settingsUpdatedAt);
  },

  setAccent: (accent) => {
    const settingsUpdatedAt = Date.now();
    set({ accent, settingsUpdatedAt });
    setJSON('accent', accent);
    setJSON('settingsUpdatedAt', settingsUpdatedAt);
  },

  setCallAlertsEnabled: (on) => {
    const settingsUpdatedAt = Date.now();
    set({ callAlertsEnabled: on, settingsUpdatedAt });
    setJSON('callAlertsEnabled', on);
    setJSON('settingsUpdatedAt', settingsUpdatedAt);
  },

  setBoxSettings: (patch, options) => {
    // Deliberately not part of settingsUpdatedAt/sync -- boxSettings is the
    // per-physical-box BLE mirror, not account-level state (§3.1).
    const next = { ...get().boxSettings, ...patch };
    set({ boxSettings: next });
    if (options?.persist === false) return; // see this action's own interface comment
    setJSON('boxSettings', next);
  },

  reloadBoxSettings: async () => {
    set({ boxSettings: await loadBoxSettings() });
  },

  setAutoSyncEnabled: (on) => {
    // Deliberately not part of settingsUpdatedAt/sync, same reasoning as
    // setBoxSettings above -- see this field's own interface comment.
    set({ autoSyncEnabled: on });
    setJSON('autoSyncEnabled', on);
  },

  setDemoModeEnabled: (on) => {
    // Deliberately not part of settingsUpdatedAt/sync, same reasoning as
    // setAutoSyncEnabled above -- see this field's own interface comment.
    set({ demoModeEnabled: on });
    setJSON('demoModeEnabled', on);
  },

  setRingBaselineWindow: (w) => {
    // Deliberately not part of settingsUpdatedAt/sync -- see this field's
    // own interface comment (same per-device-view-preference reasoning as
    // setAutoSyncEnabled above).
    set({ ringBaselineWindow: w });
    setJSON('ringBaselineWindow', w);
  },

  setRingSourceKind: (k) => {
    // Deliberately not part of settingsUpdatedAt/sync -- see this field's
    // own interface comment.
    set({ ringSourceKind: k });
    setJSON('ringSourceKind', k);
  },

  setRingGoalId: (id) => {
    // Deliberately not part of settingsUpdatedAt/sync -- see this field's
    // own interface comment.
    set({ ringGoalId: id });
    setJSON('ringGoalId', id);
  },

  setRingShowTopicMix: (on) => {
    // Deliberately not part of settingsUpdatedAt/sync -- see this field's
    // own interface comment.
    set({ ringShowTopicMix: on });
    setJSON('ringShowTopicMix', on);
  },

  setNotificationsEnabled: (on) => {
    // Deliberately not part of settingsUpdatedAt/sync -- see this field's
    // own interface comment.
    set({ notificationsEnabled: on });
    setJSON('notificationsEnabled', on);
  },

  setQuietHoursEnabled: (on) => {
    set({ quietHoursEnabled: on });
    setJSON('quietHoursEnabled', on);
  },

  setQuietHours: (start, end) => {
    // Written as a pair, never independently: a half-applied range (a new
    // start against the old end) is a real, reachable window that would
    // silence reminders the user never meant to silence.
    set({ quietStart: start, quietEnd: end });
    setJSON('quietStart', start);
    setJSON('quietEnd', end);
  },

  setCalendarStreakGoalIds: (ids) => {
    // Deliberately not part of settingsUpdatedAt/sync -- see this field's
    // own interface comment.
    set({ calendarStreakGoalIds: ids });
    setJSON('calendarStreakGoalIds', ids);
  },

  addCustomLabel: (name, color) => {
    const customLabels = createCustomLabel(get().customLabels, name, color);
    const settingsUpdatedAt = Date.now();
    set({ customLabels, settingsUpdatedAt });
    setJSON('customLabels', customLabels);
    setJSON('settingsUpdatedAt', settingsUpdatedAt);
  },

  renameCustomLabel: (id, name) => {
    const customLabels = renameCustomLabelIn(get().customLabels, id, name);
    const settingsUpdatedAt = Date.now();
    set({ customLabels, settingsUpdatedAt });
    setJSON('customLabels', customLabels);
    setJSON('settingsUpdatedAt', settingsUpdatedAt);
  },

  removeCustomLabel: (id) => {
    const customLabels = deleteCustomLabelIn(get().customLabels, id);
    const settingsUpdatedAt = Date.now();
    set({ customLabels, settingsUpdatedAt });
    setJSON('customLabels', customLabels);
    setJSON('settingsUpdatedAt', settingsUpdatedAt);
  },

  setLabelExcluded: (id, excluded) => {
    const customLabels = setLabelExcludedIn(get().customLabels, id, excluded);
    const settingsUpdatedAt = Date.now();
    set({ customLabels, settingsUpdatedAt });
    setJSON('customLabels', customLabels);
    setJSON('settingsUpdatedAt', settingsUpdatedAt);
  },

  setTopicKeyExcluded: (key, excluded) => {
    const excludedTopicKeys = setTopicKeyExcludedIn(get().excludedTopicKeys, key, excluded);
    const settingsUpdatedAt = Date.now();
    set({ excludedTopicKeys, settingsUpdatedAt });
    setJSON('excludedTopicKeys', excludedTopicKeys);
    setJSON('settingsUpdatedAt', settingsUpdatedAt);
  },

  applyRemoteSettings: (remote, updatedAt) => {
    set({ ...remote, settingsUpdatedAt: updatedAt });
    setJSON('themeMode', remote.themeMode);
    setJSON('accent', remote.accent);
    setJSON('callAlertsEnabled', remote.callAlertsEnabled);
    setJSON('customLabels', remote.customLabels);
    setJSON('excludedTopicKeys', remote.excludedTopicKeys);
    setJSON('settingsUpdatedAt', updatedAt);
  },

  resetSyncableSettings: () => {
    set({ ...SYNCABLE_SETTINGS_DEFAULTS, settingsUpdatedAt: 0 });
    setJSON('themeMode', SYNCABLE_SETTINGS_DEFAULTS.themeMode);
    setJSON('accent', SYNCABLE_SETTINGS_DEFAULTS.accent);
    setJSON('callAlertsEnabled', SYNCABLE_SETTINGS_DEFAULTS.callAlertsEnabled);
    setJSON('customLabels', SYNCABLE_SETTINGS_DEFAULTS.customLabels);
    setJSON('excludedTopicKeys', SYNCABLE_SETTINGS_DEFAULTS.excludedTopicKeys);
    setJSON('settingsUpdatedAt', 0);
  },
}));
