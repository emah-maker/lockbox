// scheduledSessionsSyncBridge.ts -- wires useScheduleStore mutations to a
// best-effort Firestore push, and registers this device for server-sent
// reminders once someone is signed in. Mirrors goalsSyncBridge.ts's pattern
// (see that file's header for the full reasoning), with one addition it
// doesn't have: an auth-state subscription.
//
// The auth subscription is here because push registration has a precondition
// nothing else in this app does -- it needs BOTH a signed-in user AND granted
// notification permission, and those can arrive in either order and at any
// time (the user signs in on Tuesday and first grants notifications on
// Friday, or vice versa). Retrying at each of the moments either could have
// changed is cheaper and more reliable than trying to find one place that
// always happens after both.
//
// Lives outside useScheduleStore.ts for the same circular-dependency reason
// every other bridge does: sync/scheduledSessionsSync.ts already reads that
// store, so the store itself stays free of any Firebase import.
import { useScheduleStore } from '../store/useScheduleStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { getFirebaseAuth } from '../auth/firebase';
import { pushScheduledSessions, deleteRemoteScheduledSession } from './scheduledSessionsSync';
import { registerPushToken } from '../push/pushRegistration';
import { useAuthStore } from '../auth/useAuthStore';
import type { ScheduledSession } from '../schedule/scheduledSessions';

let started = false;

/** Ids present in `a` but not in `b` -- the plans deleted by this mutation,
 * which get their remote document removed immediately rather than waiting
 * for the next full sync. The store's own tombstone is what guarantees the
 * deletion eventually sticks if this push fails; this is just the fast path
 * for the ordinary online case. */
function removedIds(a: ScheduledSession[], b: ScheduledSession[]): string[] {
  const after = new Set(b.map((p) => p.id));
  return a.filter((p) => !after.has(p.id)).map((p) => p.id);
}

function signedIn(): boolean {
  try {
    return !!getFirebaseAuth().currentUser;
  } catch {
    return false; // Firebase Auth not initialized yet -- nothing to push to
  }
}

/** Call once at app start, after initFirebaseAuth() has resolved. Idempotent. */
export function startScheduledSessionsSyncBridge(): void {
  if (started) return;
  started = true;

  let prev = useScheduleStore.getState().scheduled;
  useScheduleStore.subscribe((state) => {
    const next = state.scheduled;
    // Reference compare only: the store replaces this array on every write
    // (its module-private persist()), so an in-place mutation this would miss
    // doesn't exist on that path -- the same reasoning
    // goalNotificationWatch.ts's own session subscription documents.
    if (next === prev) return;
    const gone = removedIds(prev, next);
    prev = next;
    if (!signedIn()) return; // local-only while signed out; the next sign-in's full sync catches up
    for (const id of gone) void deleteRemoteScheduledSession(id);
    pushScheduledSessions().catch(() => {}); // best-effort; the next full sync catches up
  });

  // Registration attempt 1: now. Covers the ordinary warm start, where the
  // user was already signed in and had already granted notifications on a
  // previous run.
  void registerPushToken();

  // Attempt 2: whenever the signed-in user changes. Subscribed to
  // useAuthStore rather than attaching a second onAuthStateChanged listener
  // -- that store already owns the one listener, and a second would be a
  // second source of truth for the same event.
  let prevUid = useAuthStore.getState().user?.uid ?? null;
  useAuthStore.subscribe((state) => {
    const uid = state.user?.uid ?? null;
    if (uid === prevUid) return;
    prevUid = uid;
    // Only on sign-IN. Sign-out's own teardown deletes this device's token
    // (useAuthStore.signOut, which has to do it while still authorized), so
    // there is nothing for this branch to do on the way out.
    if (uid) void registerPushToken();
  });

  // Attempt 3: when the notification master switch is turned on. That is the
  // single most likely moment OS permission gets granted for the first time,
  // and therefore the moment a push token first becomes obtainable at all --
  // registerPushToken only registers when permission is ALREADY granted (see
  // its own header), so without this a user who signs in first and enables
  // notifications later would never register until the next app start.
  let prevEnabled = useSettingsStore.getState().notificationsEnabled;
  useSettingsStore.subscribe((state) => {
    if (state.notificationsEnabled === prevEnabled) return;
    prevEnabled = state.notificationsEnabled;
    if (state.notificationsEnabled && signedIn()) void registerPushToken();
  });
}
