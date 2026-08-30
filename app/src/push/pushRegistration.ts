// pushRegistration.ts -- registers this device as somewhere the backend may
// send a reminder, and keeps the backend informed about what this device has
// already covered locally.
//
// Two responsibilities, both best-effort and neither ever throwing:
//
//   1. registerPushToken() -- mint an Expo push token and write it to
//      users/{uid}/pushTokens/{deviceId}. Expo's push service, not FCM
//      directly: the app uses the Firebase JS SDK, whose `firebase/messaging`
//      is browser-only, so obtaining an FCM registration token here would
//      mean adding @react-native-firebase/messaging and a second native
//      Firebase setup. functions/src/expoPush.ts's header has the full
//      reasoning; the dashboard's browser tokens do go through FCM.
//
//   2. reportLocalCoverage() -- tell the backend which plan ids this device
//      has ALREADY scheduled as local notifications, so it doesn't push a
//      second copy of something the phone is going to show anyway. This is
//      the entire duplicate-suppression mechanism; see
//      functions/src/reminders.ts's PushTokenDoc for the other half.
//
// Degrades to a silent no-op for every way this can be unavailable -- signed
// out, permission not granted, no native notifications module (Expo Go, a
// simulator), no network, a Firestore write denied. Same posture
// goals/goalNotifications.ts takes: a reminder is a nice-to-have layered on
// top of the plan, and the plan is saved and visible on the calendar either
// way.
//
// iOS BUILD REQUIREMENT: remote push needs the `aps-environment` entitlement,
// which app/plugins/withoutPushEntitlement.js used to strip (that plugin has
// been removed as part of adding this file). The Apple App ID must have the
// Push Notifications capability enabled and the provisioning profile
// regenerated -- see docs/push-notifications.md. Until that is done, iOS
// builds have no push capability and getExpoPushTokenAsync below simply
// fails, which this module treats like any other unavailability.
import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';
import { Platform } from 'react-native';
import { doc, setDoc, deleteDoc } from 'firebase/firestore';
import { getDb, getFirebaseAuth } from '../auth/firebase';
import { getJSON } from '../storage/storage';
import { getGoalNotificationPermission } from '../goals/goalNotifications';

// Same AsyncStorage key useStore.ts and firestoreSync.ts's currentDeviceId
// already use -- this device's token doc is keyed by the SAME id its session
// docs are namespaced under, so one physical device is one row here rather
// than accumulating a new token doc on every app start.
const LAST_DEVICE_KEY = 'lastDeviceId';
const FALLBACK_DEVICE_ID = 'unknown-device';

/** Mirrors the rules cap on pushTokens.localReminderIds (app/firestore.rules)
 * and sits at the same order of magnitude as the backend's own
 * MAX_SESSION_REMINDERS -- a device can't report covering more reminders
 * than it is allowed to schedule. */
const MAX_REPORTED_COVERAGE = 50;

/** The last coverage list actually written, so an unchanged reconcile (the
 * common case -- every settings change re-runs the scheduler) doesn't cost a
 * Firestore write. In-memory only; a fresh app run rewrites it once. */
let lastCoverageKey: string | null = null;

async function deviceId(): Promise<string> {
  return (await getJSON<string | null>(LAST_DEVICE_KEY, null)) ?? FALLBACK_DEVICE_ID;
}

/** The signed-in uid, or null. Never throws -- Firebase Auth may not be
 * initialized yet at the moment a reconcile fires. */
function currentUid(): string | null {
  try {
    return getFirebaseAuth().currentUser?.uid ?? null;
  } catch {
    return null;
  }
}

/** EAS project id, which getExpoPushTokenAsync requires in a bare/dev-client
 * build (it cannot be inferred the way it can inside Expo Go). Read from
 * app.json's `extra.eas.projectId` rather than hardcoded, so a project
 * re-link can't leave a stale literal here quietly minting tokens for the
 * wrong project. */
function easProjectId(): string | undefined {
  const extra = Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined;
  return extra?.eas?.projectId;
}

/**
 * Mints (or refreshes) this device's Expo push token and stores it under the
 * signed-in user.
 *
 * Deliberately does NOT prompt for notification permission: it only registers
 * when permission is ALREADY granted. Somewhere in the app has to ask, and
 * that somewhere should be the moment the user does something that wants a
 * notification (goalNotifications.ts's syncGoalNotifications, or scheduling a
 * session) -- not app startup, which is exactly the context-free prompt users
 * decline. A device that never grants permission simply never registers, and
 * the backend never has anywhere to push it.
 *
 * Safe to call repeatedly. Expo push tokens are stable for an install, so a
 * repeat call rewrites the same document at the same id.
 */
export async function registerPushToken(): Promise<void> {
  const uid = currentUid();
  if (!uid) return;

  try {
    if ((await getGoalNotificationPermission()) !== 'granted') return;

    const projectId = easProjectId();
    const { data: token } = await Notifications.getExpoPushTokenAsync(
      projectId ? { projectId } : undefined,
    );
    if (!token) return;

    const id = await deviceId();
    const nowMs = Date.now();
    await setDoc(
      doc(getDb(), 'users', uid, 'pushTokens', id),
      {
        transport: 'expo',
        token,
        platform: Platform.OS === 'ios' ? 'ios' : 'android',
        createdAt: nowMs,
        updatedAt: nowMs,
      },
      // merge, so a re-registration doesn't wipe the localReminderIds this
      // device may have already reported (they are written by a separate
      // call below, and the two must not clobber each other).
      { merge: true },
    );
  } catch {
    // No native module, permission revoked between the check and the call,
    // no push capability in this build, offline, or a denied write. Nothing
    // here is worth interrupting the app for.
  }
}

/**
 * Records which plan ids this device currently holds as local notifications.
 *
 * Called after every reminder reconcile (useScheduleStore's persist), with
 * exactly the ids that were handed to the OS -- so the backend's view can
 * never be more optimistic than reality. An empty list is meaningful and IS
 * written: it says "this device now covers nothing", which is what should
 * happen when the user turns notifications off, and it is what lets the
 * server take over delivery from that moment.
 */
export async function reportLocalCoverage(planIds: string[]): Promise<void> {
  const uid = currentUid();
  if (!uid) return;

  const capped = planIds.slice(0, MAX_REPORTED_COVERAGE);
  const key = capped.join('|');
  if (key === lastCoverageKey) return;

  try {
    const id = await deviceId();
    await setDoc(
      doc(getDb(), 'users', uid, 'pushTokens', id),
      { localReminderIds: capped, updatedAt: Date.now() },
      { merge: true },
    );
    lastCoverageKey = key;
  } catch {
    // Best-effort. A coverage report that doesn't land means the backend may
    // push something this device also shows locally -- a duplicate
    // notification, which is the failure mode this whole mechanism is
    // deliberately biased toward over a missing one.
  }
}

/**
 * Removes this device's token document. Called on sign-out, alongside the
 * rest of the local-account teardown (sync/localDataOwner.ts): a token left
 * behind would keep this phone receiving the previous account's reminders,
 * which on a shared or resold device is the worst possible leak this feature
 * could produce.
 */
export async function unregisterPushToken(uid: string): Promise<void> {
  try {
    const id = await deviceId();
    await deleteDoc(doc(getDb(), 'users', uid, 'pushTokens', id));
  } catch {
    // Signed out already, offline, or never registered.
  } finally {
    // Cleared unconditionally: whatever the remote state, this run should
    // re-report coverage from scratch after the next sign-in rather than
    // suppressing the write because the string happens to match.
    lastCoverageKey = null;
  }
}
