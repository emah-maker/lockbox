// settingsSyncBridge.ts -- wires useSettingsStore mutations to a best-effort
// Firestore push, mirroring useStore.ts's existing "optimistic local write,
// best-effort remote sync" pattern for box settings (pushBoxSettings). See
// docs/rfcs/google-signin-cross-device-sync-architecture.md §4.3.
//
// Lives outside both useSettingsStore.ts and firestoreSync.ts (rather than
// having either import the other) to avoid a circular dependency:
// firestoreSync.ts already reads useSettingsStore for the migration/LWW
// logic, so useSettingsStore itself stays free of any Firebase import.
import { useSettingsStore } from '../store/useSettingsStore';
import { pushSettingsPatch } from './firestoreSync';
import { createSnapshotPushBridge } from './syncCommon';
import type { CustomLabel } from '../stats/customLabels';

interface Snapshot {
  themeMode: string;
  accent: string;
  callAlertsEnabled: boolean;
  customLabels: CustomLabel[];
  excludedTopicKeys: string[];
}

function snapshot(state: ReturnType<typeof useSettingsStore.getState>): Snapshot {
  return {
    themeMode: state.themeMode,
    accent: state.accent,
    callAlertsEnabled: state.callAlertsEnabled,
    customLabels: state.customLabels,
    excludedTopicKeys: state.excludedTopicKeys,
  };
}

function equal(a: Snapshot, b: Snapshot): boolean {
  return (
    a.themeMode === b.themeMode &&
    a.accent === b.accent &&
    a.callAlertsEnabled === b.callAlertsEnabled &&
    // customLabels is replaced with a new array on every CRUD op (see
    // useSettingsStore's addCustomLabel/renameCustomLabel/removeCustomLabel),
    // so a reference check alone would miss nothing here -- JSON compare is
    // just belt-and-suspenders against a future caller that mutates in place.
    JSON.stringify(a.customLabels) === JSON.stringify(b.customLabels) &&
    // Same treatment as customLabels just above, for excludedTopicKeys --
    // setTopicKeyExcluded also replaces the array on every toggle, so this
    // is likewise belt-and-suspenders rather than load-bearing.
    JSON.stringify(a.excludedTopicKeys) === JSON.stringify(b.excludedTopicKeys)
  );
}

/** Call once at app start, after initFirebaseAuth() has resolved. Idempotent.
 * The start flag, the signed-out early-out and the best-effort push all live
 * in createSnapshotPushBridge (syncCommon.ts); the `equal` above is the only
 * part specific to this store -- an emission for boxSettings or hydrated is
 * not a synced-field change. */
export const startSettingsSyncBridge = createSnapshotPushBridge(
  useSettingsStore,
  snapshot,
  equal,
  pushSettingsPatch,
);
