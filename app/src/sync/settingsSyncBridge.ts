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
import { getFirebaseAuth } from '../auth/firebase';
import { pushSettingsPatch } from './firestoreSync';
import type { CustomLabel } from '../stats/customLabels';

let started = false;

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

/** Call once at app start, after initFirebaseAuth() has resolved. Idempotent. */
export function startSettingsSyncBridge(): void {
  if (started) return;
  started = true;
  let prev = snapshot(useSettingsStore.getState());
  useSettingsStore.subscribe((state) => {
    const next = snapshot(state);
    if (equal(prev, next)) return; // e.g. boxSettings/hydrated changed, not a synced field
    prev = next;
    let auth;
    try {
      auth = getFirebaseAuth();
    } catch {
      return; // Firebase Auth not initialized yet -- nothing to push to
    }
    if (!auth.currentUser) return; // signed out: local-only, nothing to push
    pushSettingsPatch().catch(() => {}); // best-effort; next successful sync catches up
  });
}
