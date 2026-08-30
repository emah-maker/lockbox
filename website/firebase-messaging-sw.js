/* =========================================================================
   firebase-messaging-sw.js -- the service worker that shows a session
   reminder when no dashboard tab is focused (or none is open at all).

   Must live at the site ROOT and carry exactly this filename: Firebase
   Messaging looks for /firebase-messaging-sw.js by default, and a service
   worker's scope can never be broader than its own path, so anywhere else
   would leave pages it can't serve. js/webPush.js registers it explicitly and
   hands the registration to getToken().

   DELIBERATELY NOT USING THE FIREBASE SDK. The usual recipe importScripts()
   the compat SDK and calls firebase.initializeApp({...}) with the project
   config inlined -- which this repo can't do, because the config is fetched
   from Hosting's /__/firebase/init.json at runtime rather than committed
   (js/firebaseConfig.js's header explains why). Fetching it inside a worker
   would make initialization asynchronous, and a push event can wake a
   stopped worker at any moment -- including before that fetch resolves, which
   would drop the very notification the worker exists to show.

   A raw `push` listener has none of that problem: it needs no config, no
   network, and no initialization, because everything it needs is in the event
   itself. The cost is that this file parses FCM's payload shape by hand
   rather than letting the SDK do it -- hence the defensive reads below.
   ========================================================================= */

/** Where a tapped reminder should land. Same page the backend puts in
   `fcmOptions.link`; used as the fallback when the payload carries no link
   of its own. */
const DASHBOARD_PATH = '/dashboard.html';

/** Collapses repeat reminders into one tray entry instead of stacking a
   tower of them. Matches the `tag` the backend sends. */
const NOTIFICATION_TAG = 'phonebox-session-reminder';

self.addEventListener('install', () => {
  // Take over immediately rather than waiting for every existing tab to
  // close -- a user who just clicked "Enable browser reminders" should be
  // covered by this worker for the reminder they are about to schedule, not
  // by whatever version was installed last week.
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('push', (event) => {
  if (!event.data) return;

  let payload = {};
  try {
    payload = event.data.json();
  } catch {
    // Not JSON at all -- nothing this worker knows how to present.
    return;
  }

  // FCM delivers a `notification` object for a notification-type message and
  // a `data` object for a data-only one. Reading both means a future change
  // on the sending side (functions/src/webPush.ts) to data-only messages
  // doesn't silently stop showing anything.
  const source = payload.notification || payload.data || {};
  const title = source.title;
  if (!title) return;

  const link = (payload.fcmOptions && payload.fcmOptions.link) || source.link || DASHBOARD_PATH;

  event.waitUntil(
    self.registration.showNotification(title, {
      body: source.body || '',
      tag: NOTIFICATION_TAG,
      // The tag alone would silently REPLACE an earlier reminder without
      // re-alerting; a second session coming up is worth a second buzz.
      renotify: true,
      data: { link },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const link = (event.notification.data && event.notification.data.link) || DASHBOARD_PATH;

  event.waitUntil(
    (async () => {
      const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      // Focus an already-open dashboard rather than opening a second copy --
      // a user who has the dashboard open in another window means to be taken
      // to it, not given a duplicate tab.
      for (const client of all) {
        if (client.url.includes(DASHBOARD_PATH) && 'focus' in client) return client.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow(link);
      return undefined;
    })(),
  );
});
