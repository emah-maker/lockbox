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

let started = false;

interface Snapshot {
  themeMode: string;
  accent: string;
  callAlertsEnabled: boolean;
  advancedStatsEnabled: boolean;
}

function snapshot(state: ReturnType<typeof useSettingsStore.getState>): Snapshot {
  return {
    themeMode: state.themeMode,
    accent: state.accent,
    callAlertsEnabled: state.callAlertsEnabled,
    advancedStatsEnabled: state.advancedStatsEnabled,
  };
}

function equal(a: Snapshot, b: Snapshot): boolean {
  return (
    a.themeMode === b.themeMode &&
    a.accent === b.accent &&
    a.callAlertsEnabled === b.callAlertsEnabled &&
    a.advancedStatsEnabled === b.advancedStatsEnabled
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
