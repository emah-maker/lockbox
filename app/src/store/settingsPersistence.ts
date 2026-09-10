// settingsPersistence.ts -- the on-disk half of useSettingsStore: what the
// account-syncable fields are, what every field falls back to, and how the
// whole set is read back out of storage.
//
// Split out of useSettingsStore.ts, which the hydration table pushed past this
// project's 500-line cap. The seam is a real one rather than a size-driven
// cut: nothing here knows the store exists. loadPersistedSettings() RETURNS
// the loaded values instead of calling `set` itself, which is what keeps the
// dependency one-directional -- the store imports this module, this module
// imports nothing from the store, and there is no cycle to reason about.
import { getJSON } from '../storage/storage';
import { ThemeMode, AccentKey } from '../theme/theme';
import type { Settings } from '../ble/protocol';
import { CustomLabel, sanitizeCustomLabels, sanitizeExcludedTopicKeys } from '../stats/customLabels';
import type { RingBaselineWindow, RingSourceKind } from '../screens/home/idleRingState';

// Mirrors the firmware's own defaults (Box-code/lib/lock_config.py /
// lock_settings.py) so the Settings screen shows sane values before the
// first successful connection.
export const DEFAULT_BOX_SETTINGS: Settings = { ovr: 25, auto: 1, sleep: 20, bright: 50, unlk: 0, ucal: 0, thm: 0, acc: 0, flip: 0, langle: 45, uangle: 0, ovrt: 10 };

// The account-syncable fields, per
// docs/rfcs/google-signin-cross-device-sync-architecture.md §3.1/§4.2 --
// cross-device last-write-wins settings, distinct from boxSettings (the
// per-physical-box BLE mirror, which is never account state -- see §3.1's
// "deliberate scoping decision"). customLabels joined this set so a user's
// custom focus-label catalog follows them to a new device the same way
// their theme/accent/toggles already do.
export interface SyncableSettings {
  themeMode: ThemeMode;
  accent: AccentKey;
  callAlertsEnabled: boolean;
  customLabels: CustomLabel[];
  /** The built-in topics (stats/topics.ts's TopicKey) a user has switched off
   * from counting toward totals/goals/streaks -- customLabels' own
   * excludeFromTotals field extended to the six built-ins, which have no
   * catalog entry of their own to carry a boolean flag on (see
   * customLabels.ts's setTopicKeyExcluded for the full reasoning). Joined
   * SyncableSettings alongside customLabels, not boxSettings/autoSyncEnabled,
   * for the same reason customLabels itself did: this is the identical
   * user-facing "doesn't count" switch, just for a built-in topic instead of
   * a saved custom label, and a user would find it surprising if one kind of
   * label's exclusion followed them to a new device while the other didn't. */
  excludedTopicKeys: string[];
}

// Defaults for the five account-syncable fields -- what a signed-out device
// (or a brand-new account) should show, and what sync/localDataOwner.ts
// resets local storage to on sign-out/account-switch so no prior account's
// preferences linger on the device.
export const SYNCABLE_SETTINGS_DEFAULTS: SyncableSettings = {
  themeMode: 'dark',
  accent: 'mint',
  callAlertsEnabled: true,
  customLabels: [],
  excludedTopicKeys: [],
};

/** `calendarStreakGoalIds`'s sanitize-on-the-way-out-of-storage step -- the
 * same belt-and-suspenders treatment customLabels/excludedTopicKeys get from
 * sanitizeCustomLabels/sanitizeExcludedTopicKeys, needed here for a sharper
 * reason: storage.ts's generic corrupt-value guard opts out entirely for a
 * nullable-default caller like this one (no shape to compare a `string |
 * null` against), but this field's non-null shape genuinely is a `string[]`,
 * and screens/calendar/monthGrid.ts's resolveCalendarStreakGoalIds calls
 * `.filter` on it unconditionally once it isn't `null`. An unsanitized
 * garbage value here would reach that `.filter` and crash the Calendar tab
 * instead of degrading to "no customization" like every other field does. */
function sanitizeCalendarStreakGoalIds(value: unknown): string[] | null {
  if (value === null) return null;
  if (!Array.isArray(value)) return null;
  return value.filter((v): v is string => typeof v === 'string');
}

/**
 * Every persisted settings field: how to read it, what it falls back to, and
 * -- where one exists -- the sanitizer applied on the way OUT of storage.
 *
 * A table rather than a destructured `Promise.all`, because that form named
 * all seventeen fields three times over (once in the destructure, once in the
 * array, once in the `set`), in three orders that had to stay aligned by
 * hand. Nothing caught a misalignment: swapping two same-typed entries (say
 * `quietStart`/`quietEnd`, or any two booleans) type-checked perfectly and
 * silently loaded each into the other's field.
 *
 * The storage key stays written out next to each property even where the two
 * strings match, and is deliberately NOT derived from the property name: it
 * is a persistence contract with every install already out there. Renaming
 * the field must not silently orphan the stored value.
 */
const SETTINGS_HYDRATORS = {
  themeMode: () => getJSON<ThemeMode>('themeMode', SYNCABLE_SETTINGS_DEFAULTS.themeMode),
  accent: () => getJSON<AccentKey>('accent', SYNCABLE_SETTINGS_DEFAULTS.accent),
  callAlertsEnabled: () => getJSON<boolean>('callAlertsEnabled', SYNCABLE_SETTINGS_DEFAULTS.callAlertsEnabled),
  // Sanitized on the way OUT of storage as well as on the way in from
  // Firestore, the same self-healing loadSessions() does for the session
  // log and for the same reason: applyRemoteSettings persists whatever the
  // remote merge produced, so a catalog entry that predates a tightening of
  // sanitizeCustomLabels is already sitting in local storage on existing
  // installs. Validating only at the sync boundary would leave those
  // installs broken until the next remote pull happened to rewrite the key.
  // themeMode/accent need no equivalent -- resolveTheme normalizes both on
  // every render already.
  customLabels: async () =>
    sanitizeCustomLabels(await getJSON<CustomLabel[]>('customLabels', SYNCABLE_SETTINGS_DEFAULTS.customLabels)),
  // Same self-healing sanitize-on-the-way-out-of-storage treatment as
  // customLabels just above, and for the identical reason -- a value
  // written before sanitizeExcludedTopicKeys existed (or before a tightened
  // version of it) is already sitting in local storage on existing installs.
  excludedTopicKeys: async () =>
    sanitizeExcludedTopicKeys(
      await getJSON<string[]>('excludedTopicKeys', SYNCABLE_SETTINGS_DEFAULTS.excludedTopicKeys),
    ),
  boxSettings: () => getJSON<Settings>('boxSettings', DEFAULT_BOX_SETTINGS),
  settingsUpdatedAt: () => getJSON<number>('settingsUpdatedAt', 0),
  autoSyncEnabled: () => getJSON<boolean>('autoSyncEnabled', true),
  ringBaselineWindow: () => getJSON<RingBaselineWindow>('ringBaselineWindow', 'week'),
  ringSourceKind: () => getJSON<RingSourceKind>('ringSourceKind', 'auto'),
  ringGoalId: () => getJSON<string | null>('ringGoalId', null),
  ringShowTopicMix: () => getJSON<boolean>('ringShowTopicMix', true),
  notificationsEnabled: () => getJSON<boolean>('notificationsEnabled', true),
  quietHoursEnabled: () => getJSON<boolean>('quietHoursEnabled', false),
  quietStart: () => getJSON<string>('quietStart', '22:00'),
  quietEnd: () => getJSON<string>('quietEnd', '07:00'),
  calendarStreakGoalIds: async () =>
    sanitizeCalendarStreakGoalIds(await getJSON<string[] | null>('calendarStreakGoalIds', null)),
};

export type PersistedSettings = {
  [K in keyof typeof SETTINGS_HYDRATORS]: Awaited<ReturnType<(typeof SETTINGS_HYDRATORS)[K]>>;
};

/**
 * Reads every persisted field in one parallel pass and returns them keyed by
 * field name. The caller spreads the result into its own `set`, which is
 * where the types get checked against the store's own shape: a field renamed
 * on one side and not the other fails to compile there.
 */
export async function loadPersistedSettings(): Promise<PersistedSettings> {
  // The keys array is what pairs each resolved value back to its own field,
  // so the pairing is positional in one place instead of three.
  const keys = Object.keys(SETTINGS_HYDRATORS) as (keyof typeof SETTINGS_HYDRATORS)[];
  const values = await Promise.all(keys.map((key) => SETTINGS_HYDRATORS[key]()));
  return Object.fromEntries(keys.map((key, i) => [key, values[i]])) as PersistedSettings;
}
