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
import { pushScheduledSessions, deleteRemoteScheduledSession } from './scheduledSessionsSync';
import { isSignedIn } from './syncCommon';
import { registerPushToken, unregisterPushToken } from '../push/pushRegistration';
import { useAuthStore } from '../auth/useAuthStore';
import type { ScheduledSession } from '../schedule/scheduledSessions';

let started = false;

/** Plan ids whose push failed and have not landed since -- carried into the
 * next push. In-memory only: a cold start re-syncs everything anyway. */
const unpushed = new Set<string>();

/** Ids present in `a` but not in `b` -- the plans deleted by this mutation,
 * which get their remote document removed immediately rather than waiting
 * for the next full sync. The store's own tombstone is what guarantees the
 * deletion eventually sticks if this push fails; this is just the fast path
 * for the ordinary online case. */
function removedIds(a: ScheduledSession[], b: ScheduledSession[]): string[] {
  const after = new Set(b.map((p) => p.id));
  return a.filter((p) => !after.has(p.id)).map((p) => p.id);
}

/** The plans that are new in `b`, whose content differs from their copy in
 * `a`, or that a previous push left outstanding. Compared by value rather
 * than by `updatedAt` alone: a write that changes a field without advancing
 * the clock is a bug elsewhere, but it should still reach Firestore rather
 * than being silently dropped here. */
function changedPlans(
  a: ScheduledSession[],
  b: ScheduledSession[],
  outstanding: Set<string>,
): ScheduledSession[] {
  const before = new Map(a.map((p) => [p.id, JSON.stringify(p)]));
  return b.filter((p) => outstanding.has(p.id) || before.get(p.id) !== JSON.stringify(p));
}

/** Call once at app start, after initFirebaseAuth() has resolved. Idempotent. */
export function startScheduledSessionsSyncBridge(): void {
  if (started) return;
  started = true;

  let prev = useScheduleStore.getState().scheduled;
  let prevWrites = useScheduleStore.getState().localWrites;
  useScheduleStore.subscribe((state) => {
    const next = state.scheduled;
    // Reference compare only: the store replaces this array on every write
    // (its module-private persist()), so an in-place mutation this would miss
    // doesn't exist on that path -- the same reasoning
    // goalNotificationWatch.ts's own session subscription documents.
    if (next === prev) return;
    const gone = removedIds(prev, next);
    const before = prev;
    prev = next;

    // Only a real edit is mirrored. Hydration, a remote merge landing, and an
    // account wipe all replace this array without anything having been
    // changed HERE, and pushing on those is not merely redundant: the push
    // rewrites whole documents including `notifiedAt: null`, which un-marks
    // any reminder the backend has already sent and gets it delivered again
    // (functions/src/index.ts). Opening the app five minutes after a reminder
    // arrived was enough to receive it twice.
    const writes = state.localWrites;
    if (writes === prevWrites) return;
    prevWrites = writes;

    if (!isSignedIn()) return; // local-only while signed out; the next sign-in's full sync catches up
    for (const id of gone) void deleteRemoteScheduledSession(id);
    // And only the plans that actually differ, for the same reason: editing
    // ONE plan used to rewrite all of them, re-arming every already-sent
    // reminder in the set. Plus anything a previous push failed to deliver:
    // pushing the whole set used to make every mutation an implicit retry of
    // the last failed one, and a plan created offline would otherwise sit
    // local-only until the next sign-in's full sync.
    const changed = changedPlans(before, next, unpushed);
    if (changed.length === 0) return;
    const attempted = changed.map((p) => p.id);
    for (const id of attempted) unpushed.delete(id);
    pushScheduledSessions(changed).catch(() => {
      // Best-effort, but remembered: offline, or a denied write. The next
      // local mutation carries these along, and the next full sync catches
      // whatever is still outstanding after that.
      for (const id of attempted) unpushed.add(id);
    });
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
  //
  // And the mirror image, which is not symmetry for its own sake: turning the
  // switch OFF has to delete the token, or it turns reminders ON. The
  // reconcile that follows cancels this device's local notifications and
  // reports covering nothing, and "covers nothing" is precisely what tells
  // sendDueReminders to deliver every due reminder here by push. Without this
  // branch, a user who switched reminders off kept receiving them -- as
  // pushes, which is the one form they can't silence from inside the app.
  // Also covers the startup ordering: settings hydrate asynchronously, so an
  // off switch arrives as a change from the default `true` shortly after the
  // registration attempt above.
  let prevEnabled = useSettingsStore.getState().notificationsEnabled;
  useSettingsStore.subscribe((state) => {
    if (state.notificationsEnabled === prevEnabled) return;
    prevEnabled = state.notificationsEnabled;
    if (!isSignedIn()) return;
    if (state.notificationsEnabled) {
      void registerPushToken();
      return;
    }
    const uid = useAuthStore.getState().user?.uid ?? null;
    if (uid) void unregisterPushToken(uid);
  });
}
