// settingsSyncPlan.ts -- pure decision layer for firestoreSync.ts's
// syncSettingsTwoWay, the counterpart to goalsSyncPlan.ts and split out for
// exactly the reason that file's header gives: firestoreSync.ts imports
// `firebase/firestore`, so anything living in it -- or importing it -- cannot
// be reached by a test under this repo's jest config.
//
// The settings side was the last two-way merge still deciding inside the I/O
// wrapper. Its rule is simpler than the goals merge (whole-document
// last-write-wins on a client clock, rather than a per-goal union), but it is
// not trivial, and two of its three branches are the kind that fail quietly:
// picking the wrong side loses a preference the user just set, and getting
// the tie wrong writes on every sign-in forever. The sanitizing this composes
// is load-bearing too -- a themeMode this build has never heard of used to
// crash resolveTheme on the first render after sign-in.
import { normalizeAccent, normalizeThemeMode } from '../theme/theme';
import { sanitizeCustomLabels, sanitizeExcludedTopicKeys } from '../stats/customLabels';
import type { SyncableSettings } from '../store/useSettingsStore';

/** What the sync should do about settings/app, given both sides. */
export interface SettingsSyncPlan {
  /**
   * 'apply'      -- the remote document is newer; take it locally.
   * 'push'       -- this device is newer; write ours back.
   * 'none'       -- the two clocks agree, so both sides already hold the
   *                 same write and there is nothing to move in either
   *                 direction.
   */
  action: 'apply' | 'push' | 'none';
  /** Only meaningful when `action` is 'apply': the remote settings, already
   * normalized into values this build can actually render. */
  settings: SyncableSettings;
  /** Only meaningful when `action` is 'apply': the clock to store with them. */
  updatedAt: number;
}

/**
 * Any remote settings document -> values this build can render.
 *
 * The boundary this document never had. Its Firestore rule type-checks the
 * fields rather than enumerating accepted values -- deliberately, so that
 * adding an accent doesn't need a rules deploy -- which means the other
 * client can legitimately store a mode or accent this build has never heard
 * of, and `ACCENTS[mode][accent]` on an unknown mode is a TypeError from the
 * first themed render after sign-in.
 */
export function sanitizeRemoteSettings(remote: Partial<SyncableSettings> | undefined): SyncableSettings {
  return {
    themeMode: normalizeThemeMode(remote?.themeMode),
    accent: normalizeAccent(remote?.accent),
    callAlertsEnabled: !!remote?.callAlertsEnabled,
    customLabels: sanitizeCustomLabels(remote?.customLabels),
    excludedTopicKeys: sanitizeExcludedTopicKeys(remote?.excludedTopicKeys),
  };
}

/**
 * Which side of a settings sync wins.
 *
 * Whole-document last-write-wins on `updatedAt`, a client-side logical clock
 * (firestore.rules' settings/app block says the same). Deliberately NOT the
 * per-field union the goals merge does: these five fields are set together
 * from one screen, and a device that is behind is behind on all of them --
 * whereas two goals edited on two devices are genuinely independent facts.
 *
 * The tie is 'none' rather than 'push'. Equal clocks mean both sides already
 * hold the same write, so pushing would be a write on every single sign-in,
 * forever, for a document nothing had changed.
 */
export function planSettingsSync(
  localUpdatedAt: number,
  remote: (Partial<SyncableSettings> & { updatedAt?: number }) | undefined,
): SettingsSyncPlan {
  // A missing or non-numeric remote clock reads as "older than anything",
  // not as zero-equals-zero: a document written without one is a document
  // this device should overwrite, not tie with.
  const remoteUpdatedAt = typeof remote?.updatedAt === 'number' && Number.isFinite(remote.updatedAt)
    ? remote.updatedAt
    : -1;
  const local = typeof localUpdatedAt === 'number' && Number.isFinite(localUpdatedAt) ? localUpdatedAt : 0;

  if (remoteUpdatedAt > local) {
    return { action: 'apply', settings: sanitizeRemoteSettings(remote), updatedAt: remoteUpdatedAt };
  }
  if (local > remoteUpdatedAt) {
    return { action: 'push', settings: sanitizeRemoteSettings(remote), updatedAt: local };
  }
  return { action: 'none', settings: sanitizeRemoteSettings(remote), updatedAt: local };
}
