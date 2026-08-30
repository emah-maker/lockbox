/* =========================================================================
   webPush.js -- registers this browser to receive reminders from the backend
   (functions/src/index.ts), by minting an FCM Web Push registration token and
   storing it at users/{uid}/pushTokens/{tokenId}.

   The browser half of the same queue the phone app reads. The app registers
   an EXPO push token instead (app/src/push/pushRegistration.ts explains why
   it can't use FCM); both land in the same collection with a `transport`
   field, and the backend fans out to each with the right service.

   SETUP THIS FILE CANNOT DO FOR YOU. FCM Web Push needs a VAPID key pair,
   generated once in the Firebase console (Project settings -> Cloud Messaging
   -> Web configuration -> "Generate key pair"). The public key is not a
   secret -- it identifies the sender to the browser's push service -- but it
   is project-specific, so it is read from Hosting's own /__/firebase/init.json
   (via firebaseConfig.js) under `vapidKey` rather than hardcoded here, for
   exactly the reasons that file's header gives. Until it is present,
   enableWebPush() reports `unsupported` and this page's reminders simply
   arrive on the phone only. See docs/push-notifications.md.

   PERMISSION IS ALWAYS USER-INITIATED. Nothing here runs on page load: a
   notification prompt fired at a visitor who has just opened a dashboard is
   the prompt everyone declines, and once declined it cannot be asked again
   without the user digging through browser settings. enableWebPush() is
   called from a button click, and only then.
   ========================================================================= */
import { initializeApp, getApps } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js';
import {
  getMessaging,
  getToken,
  isSupported,
  onMessage,
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-messaging.js';
import { doc, setDoc, deleteDoc } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';

/** Served from the site root -- Firebase Messaging requires the worker at a
 * scope that covers the pages it serves, and the root is the one scope that
 * always does. */
const SW_PATH = '/firebase-messaging-sw.js';

/** Where this browser's token document lives. One per browser profile, keyed
 * by a value stored in localStorage rather than by the token itself: an FCM
 * token can be rotated by the browser, and keying on it would leave the old
 * document behind as a permanently-dead address. */
const TOKEN_ID_KEY = 'phonebox:webPushTokenId';

function browserTokenId() {
  let id = null;
  try {
    id = localStorage.getItem(TOKEN_ID_KEY);
  } catch {
    // Storage blocked (private mode, third-party restrictions). Falling
    // through to a fresh id means this browser may accumulate a second token
    // document, which the backend cleans up as soon as the first one comes
    // back unregistered -- better than failing to register at all.
  }
  if (id) return id;
  id = `web_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  try {
    localStorage.setItem(TOKEN_ID_KEY, id);
  } catch {
    /* see above */
  }
  return id;
}

/** Whether this browser could ever receive a web push. Safari before 16.4,
 * most in-app browsers, and any page not on HTTPS answer `false` -- the UI
 * uses this to hide the control entirely rather than offering a button that
 * can only fail. */
export async function webPushSupported() {
  try {
    return (await isSupported()) && 'serviceWorker' in navigator && 'Notification' in window;
  } catch {
    return false;
  }
}

/** 'granted' | 'denied' | 'default' | 'unsupported' -- what the UI shows
 * without prompting for anything. */
export async function webPushStatus() {
  if (!(await webPushSupported())) return 'unsupported';
  return Notification.permission;
}

/**
 * Asks for permission (if not already granted), mints a token, and stores it.
 * Resolves to a status string the caller can render:
 *
 *   'granted'      -- registered; reminders will arrive in this browser
 *   'denied'       -- the user said no, or had said no previously
 *   'unsupported'  -- this browser can't, or the project has no VAPID key
 *   'error'        -- something else went wrong; the message is logged
 *
 * Never throws: failing to enable an optional extra channel must not break
 * the dashboard, and the plan itself is already saved either way.
 */
export async function enableWebPush({ config, db, uid }) {
  if (!config?.vapidKey) return 'unsupported';
  if (!(await webPushSupported())) return 'unsupported';

  try {
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') return permission === 'denied' ? 'denied' : 'default';

    // Reuses the page's already-initialized app when there is one --
    // dashboard.js calls initializeApp before this module is ever reached, and
    // a second default app would throw.
    const app = getApps().length > 0 ? getApps()[0] : initializeApp(config);
    const registration = await navigator.serviceWorker.register(SW_PATH);
    const messaging = getMessaging(app);
    const token = await getToken(messaging, {
      vapidKey: config.vapidKey,
      serviceWorkerRegistration: registration,
    });
    if (!token) return 'error';

    const nowMs = Date.now();
    await setDoc(
      doc(db, 'users', uid, 'pushTokens', browserTokenId()),
      {
        transport: 'webpush',
        token,
        platform: 'web',
        // A browser schedules nothing locally, so it covers nothing -- which
        // is exactly why it always receives the push. Written explicitly
        // rather than left absent so the document's shape matches the app's.
        localReminderIds: [],
        createdAt: nowMs,
        updatedAt: nowMs,
      },
      { merge: true },
    );
    return 'granted';
  } catch (err) {
    console.warn('[webPush] could not enable browser reminders:', err?.message ?? err);
    return 'error';
  }
}

/**
 * Removes this browser's token document. Called on sign-out, while the user
 * is still authorized to delete it -- left behind, it would keep this browser
 * receiving the previous account's reminders.
 */
export async function disableWebPush({ db, uid }) {
  try {
    await deleteDoc(doc(db, 'users', uid, 'pushTokens', browserTokenId()));
  } catch {
    // Never registered, offline, or already signed out.
  }
}

/**
 * Shows a reminder that arrives while a dashboard tab is FOCUSED. The service
 * worker only handles background messages; a foreground one is delivered to
 * the page instead and would otherwise be silently dropped -- the browser
 * equivalent of the missing presentation handler documented in
 * app/src/goals/goalNotifications.ts.
 */
export function startForegroundWebPush({ config, onReminder }) {
  if (!config?.vapidKey) return;
  try {
    const app = getApps().length > 0 ? getApps()[0] : initializeApp(config);
    onMessage(getMessaging(app), (payload) => {
      const { title, body } = payload?.notification ?? {};
      if (title && onReminder) onReminder(title, body ?? '');
    });
  } catch {
    // Messaging unsupported here -- nothing to listen for.
  }
}
