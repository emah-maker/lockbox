// localDataOwner.ts -- tracks which signed-in Firebase uid local session
// history/settings AsyncStorage currently belongs to, and clears that local
// state on sign-out/account-deletion or before merging in a different
// account's data. See
// docs/production-readiness/production-readiness-review-phone-box-companion-app-2026-08-17.md
// Critical #1 and docs/rfcs/google-signin-cross-device-sync-architecture.md.
//
// Deliberately has no Firebase dependency (unlike the rest of sync/) so this
// account-boundary bookkeeping is directly unit-testable.
import { getJSON, setJSON } from '../storage/storage';
import { clearSessions } from '../stats/sessionHistory';
import { useSettingsStore } from '../store/useSettingsStore';
import { useGoalsStore } from '../store/useGoalsStore';

export const LOCAL_DATA_OWNER_KEY = 'localDataOwnerUid';

/**
 * Clears the local session history, resets the four SyncableSettings fields
 * to their defaults, clears focus goals, and un-tags local storage's owner.
 * Call on sign-out/account-deletion (so no account's data lingers on a
 * shared, resold, or reset device) and from ensureLocalDataScopedTo below
 * (so a wrong-account or shared-device sign-in can't blend two accounts'
 * data). Deliberately does not touch boxSettings (per-physical-box, not
 * account state) or view-only local prefs (time-window/best-streak
 * selections). resetGoals mirrors resetSyncableSettings exactly -- focus
 * goals are account state (settable from the dashboard too), so they get
 * the same sign-out/account-switch treatment as themeMode/accent/
 * callAlertsEnabled/customLabels.
 */
export async function clearLocalAccountData(): Promise<void> {
  await clearSessions();
  useSettingsStore.getState().resetSyncableSettings();
  useGoalsStore.getState().resetGoals();
  await setJSON<string | null>(LOCAL_DATA_OWNER_KEY, null);
}

/**
 * Guards a newly-signed-in uid's first migration/merge: if local storage is
 * tagged with a different uid, or untagged (e.g. an install from before this
 * tagging existed), wipes it first so a wrong-account or shared-device
 * sign-in can't blend two people's data. Re-tags local storage as belonging
 * to `uid` either way. No-op (besides the tag) when storage already belongs
 * to `uid` -- the normal "same account, another sync" case.
 */
export async function ensureLocalDataScopedTo(uid: string): Promise<void> {
  const owner = await getJSON<string | null>(LOCAL_DATA_OWNER_KEY, null);
  if (owner !== uid) {
    await clearLocalAccountData();
  }
  await setJSON<string>(LOCAL_DATA_OWNER_KEY, uid);
}
