// firestoreSync.ts -- migration (first sign-in) + ongoing merge sync between
// local storage and Firestore. See
// docs/rfcs/google-signin-cross-device-sync-architecture.md §4.
//
// Every Firestore path here is built from the *signed-in* user's own uid
// (requireUid below asserts this) -- never a client-supplied uid parameter
// (design doc §5 checklist item 15).
import {
  doc,
  getDoc,
  setDoc,
  deleteDoc,
  collection,
  getDocs,
  query,
  orderBy,
  writeBatch,
  serverTimestamp,
} from 'firebase/firestore';
import { getDb, getFirebaseAuth } from '../auth/firebase';
import { loadSessions, replaceSessions, type LoggedSession } from '../stats/sessionHistory';
import { useSettingsStore, type SyncableSettings } from '../store/useSettingsStore';
import { getJSON } from '../storage/storage';

const LAST_DEVICE_KEY = 'lastDeviceId'; // mirrors useStore.ts's own AsyncStorage key
const BATCH_LIMIT = 500; // Firestore's per-batch write limit

interface RemoteSession {
  startedAt: number;
  plannedS: number;
  actualS: number;
  outcome: 'completed' | 'overridden';
  topic?: string;
}

interface RemoteSettings extends SyncableSettings {
  updatedAt: number;
}

function requireUid(uid: string): string {
  const auth = getFirebaseAuth();
  if (!auth.currentUser || auth.currentUser.uid !== uid) {
    throw new Error('Sync uid does not match the current signed-in Firebase user.');
  }
  return uid;
}

// Best-effort: the box's own BLE peripheral id, as last recorded by
// useStore.ts on connect. Local session records don't currently carry a
// per-session deviceId of their own, so this uses the most-recently-known
// box id as the deviceId component of every session's deterministic doc ID
// -- see this implementation's report for the noted limitation (multi-box
// accounts could, in principle, attribute an old session to whichever box
// most recently connected).
async function currentDeviceId(): Promise<string> {
  return (await getJSON<string | null>(LAST_DEVICE_KEY, null)) ?? 'unknown-device';
}

function sessionDocId(deviceId: string, s: Pick<LoggedSession, 'startedAt' | 'actualS'>): string {
  return `${deviceId}_${s.startedAt}_${s.actualS}`;
}

/**
 * Runs on every successful sign-in (first device ever, or an Nth device --
 * §4.1/§4.2 collapse into the same merge logic here). Creates the account
 * profile doc if this is genuinely the first device, then reconciles
 * sessions (additive union) and settings (last-write-wins).
 */
export async function runMigrationAndSync(uid: string): Promise<void> {
  requireUid(uid);
  const db = getDb();
  const auth = getFirebaseAuth();
  const user = auth.currentUser!;
  const userRef = doc(db, 'users', uid);
  const userSnap = await getDoc(userRef);

  if (!userSnap.exists()) {
    await setDoc(userRef, {
      email: user.email ?? null,
      displayName: user.displayName ?? null,
      photoURL: user.photoURL ?? null,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  }

  await syncSessions(uid);
  await syncSettingsTwoWay(uid);
}

/** Additive-union merge of session history, deduped by deterministic doc ID (§4.2). */
async function syncSessions(uid: string): Promise<void> {
  const db = getDb();
  const deviceId = await currentDeviceId();
  const [localSessions, remoteSnap] = await Promise.all([
    loadSessions(),
    getDocs(query(collection(db, 'users', uid, 'sessions'), orderBy('startedAt'))),
  ]);

  const merged = new Map<string, LoggedSession>();
  const remoteIds = new Set<string>();
  remoteSnap.forEach((d) => {
    remoteIds.add(d.id);
    const data = d.data() as RemoteSession;
    merged.set(d.id, {
      startedAt: data.startedAt,
      plannedS: data.plannedS,
      actualS: data.actualS,
      outcome: data.outcome,
      topic: data.topic,
    });
  });

  const toUpload: { id: string; session: LoggedSession }[] = [];
  for (const s of localSessions) {
    const id = sessionDocId(deviceId, s);
    if (!merged.has(id)) merged.set(id, s);
    if (!remoteIds.has(id)) toUpload.push({ id, session: s });
  }

  // Write the full reconciled set back to local storage (replace, not
  // append -- appendSessions would double-count sessions already present).
  const mergedList = Array.from(merged.values()).sort((a, b) => a.startedAt - b.startedAt);
  await replaceSessions(mergedList);

  // Idempotent set() at each deterministic ID -- re-running after a crash or
  // retry never creates a duplicate. Chunked to Firestore's batch limit.
  for (let i = 0; i < toUpload.length; i += BATCH_LIMIT) {
    const batch = writeBatch(db);
    for (const { id, session } of toUpload.slice(i, i + BATCH_LIMIT)) {
      batch.set(doc(db, 'users', uid, 'sessions', id), sessionPayload(session));
    }
    await batch.commit();
  }
}

function sessionPayload(s: LoggedSession) {
  return {
    startedAt: s.startedAt,
    plannedS: s.plannedS,
    actualS: s.actualS,
    outcome: s.outcome,
    ...(s.topic ? { topic: s.topic } : {}),
  };
}

/** Two-way last-write-wins merge for the four account-level settings fields (§4.2). */
async function syncSettingsTwoWay(uid: string): Promise<void> {
  const db = getDb();
  const ref = doc(db, 'users', uid, 'settings', 'app');
  const snap = await getDoc(ref);
  const local = useSettingsStore.getState();

  if (!snap.exists()) {
    await setDoc(ref, localSettingsPayload(local));
    return;
  }

  const remote = snap.data() as RemoteSettings;
  if (remote.updatedAt > local.settingsUpdatedAt) {
    useSettingsStore.getState().applyRemoteSettings(
      {
        themeMode: remote.themeMode,
        accent: remote.accent,
        callAlertsEnabled: remote.callAlertsEnabled,
        advancedStatsEnabled: remote.advancedStatsEnabled,
        customLabels: remote.customLabels ?? [],
      },
      remote.updatedAt,
    );
  } else if (local.settingsUpdatedAt > remote.updatedAt) {
    await setDoc(ref, localSettingsPayload(local));
  }
  // Equal timestamps: already in sync, nothing to do.
}

function localSettingsPayload(local: ReturnType<typeof useSettingsStore.getState>) {
  return {
    themeMode: local.themeMode,
    accent: local.accent,
    callAlertsEnabled: local.callAlertsEnabled,
    advancedStatsEnabled: local.advancedStatsEnabled,
    customLabels: local.customLabels,
    updatedAt: local.settingsUpdatedAt,
  };
}

/**
 * Incremental push for newly-logged sessions (called from useStore.ts's
 * handleHistory right after a local appendSessions -- §4.3). No-op if
 * signed out. Best-effort: a failure here just means the next full sync
 * (syncSessions, run on the next sign-in/syncNow) catches up.
 */
export async function pushNewSessions(sessions: LoggedSession[]): Promise<void> {
  if (!sessions.length) return;
  const auth = getFirebaseAuth();
  const user = auth.currentUser;
  if (!user) return;
  const db = getDb();
  const deviceId = await currentDeviceId();
  const batch = writeBatch(db);
  for (const s of sessions) {
    batch.set(doc(db, 'users', user.uid, 'sessions', sessionDocId(deviceId, s)), sessionPayload(s));
  }
  await batch.commit();
}

/**
 * Incremental push for a local settings change (called from
 * sync/settingsSyncBridge.ts, which subscribes to useSettingsStore -- §4.3).
 * No-op if signed out. Mirrors useStore.ts's existing "optimistic local
 * write, best-effort remote sync" pattern for box settings (pushBoxSettings).
 */
export async function pushSettingsPatch(): Promise<void> {
  const auth = getFirebaseAuth();
  const user = auth.currentUser;
  if (!user) return;
  const db = getDb();
  const local = useSettingsStore.getState();
  await setDoc(doc(db, 'users', user.uid, 'settings', 'app'), localSettingsPayload(local));
}

/**
 * Deletes what firestore.rules actually permits a client to delete under
 * users/{uid} -- the settings and devices subcollections, then the parent
 * user doc itself (design doc §4.3, §5 checklist item 12). Firestore has no
 * automatic cascade-delete for subcollections, so each is enumerated and
 * deleted explicitly.
 *
 * Deliberately does NOT attempt to delete `sessions`: firestore.rules (§3.2)
 * makes session docs `allow update, delete: if false` for every client,
 * including the owner -- a deliberate integrity property (a compromised
 * client token can't retroactively erase real history) that this deletion
 * path must not weaken. Those documents are orphaned, not purged, by account
 * deletion. This still satisfies checklist item 12's actual bar ("no
 * orphaned data remains READABLE under that uid"): once the parent
 * users/{uid} doc and the Auth user are both gone, `isOwner(uid)` can never
 * be satisfied again by anyone -- Firebase Auth never re-issues a deleted
 * uid, so a re-registration with the same Google account gets a brand-new
 * uid and starts from an empty users/{uid}, exactly as the checklist
 * requires. Physically purging the orphaned session docs would need a
 * privileged Cloud Function (Admin SDK bypasses rules) -- out of scope for
 * this client-only, no-backend design; flagged as a known follow-up, not a
 * silent gap.
 *
 * MUST be called (and awaited) BEFORE googleAuth.deleteAccountFully() removes
 * the Firebase Auth user -- every delete below is authorized by
 * `isOwner(uid)`, which requires the caller to still be signed in as that
 * uid. Deleting the auth user first would make even these permitted deletes
 * impossible (denied by the rules, not just inconvenient).
 */
export async function deleteAllUserData(uid: string): Promise<void> {
  requireUid(uid);
  const db = getDb();
  const subcollections = ['settings', 'devices'] as const;
  for (const sub of subcollections) {
    const snap = await getDocs(collection(db, 'users', uid, sub));
    // Firestore batches cap at 500 writes; chunk defensively even though a
    // single user's data is expected to stay well under that.
    let batch = writeBatch(db);
    let count = 0;
    for (const d of snap.docs) {
      batch.delete(d.ref);
      count += 1;
      if (count === BATCH_LIMIT) {
        await batch.commit();
        batch = writeBatch(db);
        count = 0;
      }
    }
    if (count > 0) await batch.commit();
  }
  await deleteDoc(doc(db, 'users', uid));
}
