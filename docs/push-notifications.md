# Push notifications

Server-side delivery of **scheduled focus-session reminders**. A plan created
on either surface (the app's calendar, or the dashboard's) is written to
Firestore; a Cloud Function finds it when it comes due and pushes it to every
device that user has registered.

This is additive. The phone app still schedules its own **local**
notification for every plan it knows about — that path is exact, needs no
network at fire time, and keeps working if this backend is down. Push exists
to cover what a local notification structurally cannot:

- a session scheduled on the **dashboard**, which a browser tab cannot arm a
  local notification for hours in advance,
- a plan created on one device reaching **another** one,
- a reminder arriving on a phone whose app **hasn't been opened** since the
  plan was made.

---

## Architecture

```
   app (calendar)  ─┐                                    ┌─→ Expo push  ─→ phone
                    ├─→ users/{uid}/scheduledSessions ─→ sendDueReminders
   dashboard        ─┘        (one doc per plan)          └─→ FCM web    ─→ browser
                                                                  ▲
                              users/{uid}/pushTokens ─────────────┘
```

| Piece | Lives in |
| --- | --- |
| Scheduled job, delivery, token cleanup | `functions/src/index.ts` |
| Pure rules (who gets what, staleness) | `functions/src/reminders.ts` |
| Expo transport (phone) | `functions/src/expoPush.ts` |
| FCM transport (browser) | `functions/src/webPush.ts` |
| App token registration + local coverage | `app/src/push/pushRegistration.ts` |
| App ↔ Firestore sync of plans | `app/src/sync/scheduledSessionsSync.ts` |
| Dashboard plan CRUD | `website/js/scheduledSessions.js` |
| Dashboard web-push opt-in | `website/js/webPush.js`, `website/firebase-messaging-sw.js` |
| Rules | `app/firestore.rules` (`pushTokens`, `scheduledSessions`) |
| Index | `app/firestore.indexes.json` (collection-group on `scheduledSessions`) |

### Two transports, one queue

The phone app uses **Expo's push service**, not FCM. It runs on the Firebase
**JS** SDK, whose `firebase/messaging` is browser-only — getting an FCM
registration token there would mean adding `@react-native-firebase/messaging`
and a second native Firebase setup. `getExpoPushTokenAsync` needs neither.
The dashboard *is* a browser, so it uses FCM Web Push directly. Both token
kinds land in `users/{uid}/pushTokens` with a `transport` field.

### Why duplicates don't happen

Every device reports, on its token document, the plan ids it currently holds
as local notifications (`localReminderIds`, written by
`reportLocalCoverage`). The job skips any token that already covers the plan
it is about to send. A browser covers nothing, so it always receives — which
is exactly why a dashboard-created plan reaches somewhere.

The bias is deliberate: an unreported coverage list produces a *duplicate*
notification, never a missing one.

---

## Setup — required before any of this works

### 1. Upgrade the Firebase project to Blaze

Cloud Functions cannot be deployed on the Spark (free) plan. The workload
here is two scheduled jobs — one per-minute query and a daily cleanup — which
sits inside the free tier's monthly allowance, but the plan upgrade itself is
mandatory.

### 2. iOS: the push capability and an APNs key

**iOS push is currently OFF, on purpose.** `app/plugins/withoutPushEntitlement.js`
is active and strips `aps-environment`, so iOS builds sign against the
existing provisioning profile exactly as they always have, and the app's push
code stays dormant on that platform. Android is unaffected. Turning iOS push
on is the three steps below — do all three, in order.

**Step 2.1 — delete the plugin.** Remove `app/plugins/withoutPushEntitlement.js`
and its `"./plugins/withoutPushEntitlement"` entry from `app.json`'s `plugins`
array. expo-notifications' own config plugin then writes the entitlement back.
Confirm with:

```bash
cd app && npx expo config --type introspect
```

`ios.entitlements` should now contain `'aps-environment': 'development'`.

**Step 2.2 — set up an APNs key.** EAS syncs the App ID *capability* from those
entitlements automatically, but the push *key* is a separate credential:

```bash
eas credentials --platform ios
```

Pick the build profile → **Push Notifications: Manage your Apple Push
Notifications Key** → *Set up a new key*. One key is shared across your apps
and reused by later builds.

**Step 2.3 — regenerate the provisioning profile.** This is the step that is
easy to miss, and skipping it is what produces the codesign failure quoted at
the end of this section: EAS does **not** re-mint a profile it has already
cached, so a profile created before the capability existed still lacks
`aps-environment`. In the same `eas credentials` session: **Build Credentials**
→ *Set up a new provisioning profile* (or remove the existing one so the next
build regenerates it).

Then build:

```bash
eas build --profile development --platform ios
```

Log in with the Apple account that owns `com.emahmaker.phonebox` when asked.
If EAS offers to set up push notifications during the build, answer **yes** —
that covers 2.2, but *not* 2.3.

**The failure to expect if you skip 2.3:**

```
Provisioning profile "*[expo] com.emahmaker.phonebox AdHoc ..." doesn't support
the Push Notifications capability.
Provisioning profile "..." doesn't include the aps-environment entitlement.
```

This is a stale *profile*, not a missing key or an un-enabled capability — the
entitlement is in your binary and the cached profile predates it. Regenerate
the profile (2.3) and rebuild. Reverting 2.1 also clears it, which is the
quicker move if you aren't ready to finish the setup.

### 2b. Android: FCM credentials

Expo's push service delivers to Android through FCM, and that needs two
things this repo does not currently have. (Local notifications need neither,
which is why Android works today for everything except server-sent
reminders.)

1. **`google-services.json`** from the Firebase console (Project settings →
   Your apps → Android app for `com.phonebox.app`; register the package if it
   isn't there yet). Put it in `app/`, then point `app.json` at it:

   ```json
   "android": {
     "googleServicesFile": "./google-services.json",
     "package": "com.phonebox.app",
     ...
   }
   ```

   Deliberately **not** added to `app.json` ahead of time: a reference to a
   file that isn't there fails `expo prebuild` outright, which would break the
   Android builds that work fine today.

2. **A Google service-account key**, uploaded to EAS so Expo may send on your
   behalf. Firebase console → Project settings → Service accounts → Generate
   new private key, then `eas credentials --platform android` → Push
   Notifications: FCM V1 → upload that JSON. The service account needs the
   **Firebase Cloud Messaging API Admin** role in Google Cloud IAM.

Add `app/google-services.json` to `.gitignore` — it identifies the project and
does not belong in version control.

### 3. Web push: generate a VAPID key pair

Firebase console → **Project settings → Cloud Messaging → Web configuration →
Generate key pair**. Copy the public key.

The dashboard reads it from Hosting's auto-served
`/__/firebase/init.json` under `vapidKey` (see `website/js/firebaseConfig.js`
for why no config is committed). That file is generated by Hosting and does
**not** include `vapidKey` by default, so add it:

- Firebase console → Hosting → your site → **Add a custom key to the SDK auto-configuration**,

or, if that surface isn't available, replace `firebaseConfig.js`'s fetch with a
committed `vapidKey` constant — it is a public identifier, not a secret.

Until the key is present, `enableWebPush()` reports `unsupported`, the
"Enable browser reminders" row stays hidden, and reminders simply go to the
phone only. Nothing else is affected.

### 4. Deploy

```bash
firebase deploy --only firestore:rules,firestore:indexes,functions,hosting --project phonebox-d14b7
```

The `--project` flag is not optional — `.firebaserc` has no default alias.

The composite index takes a few minutes to build. Until it exists,
`sendDueReminders` logs a `FAILED_PRECONDITION` with a link to create it.

### 5. Verify

```bash
firebase functions:log --only sendDueReminders --project phonebox-d14b7
```

Schedule a session a couple of minutes out from the app or the dashboard, then
watch for `sendDueReminders finished { due: 1, delivered: 1, skipped: 0 }`.

- `delivered: 0, skipped: 1` means the plan was found but no token wanted it —
  either no device is registered, or the only registered device already covers
  it locally (the expected result when you scheduled it on the phone you're
  watching).
- Nothing at all means the query found nothing: check the document has
  `notifiedAt: null`, `done: false`, and a `fireAtMs` in the past minute.

---

## Operational notes

**Timing.** The job runs every minute, so a reminder can arrive up to ~60s
late. Local notifications on the phone are exact; push is not, and the lead
times on offer (5–60 minutes) are coarse enough that a minute doesn't matter.

**Staleness.** A reminder more than 2 hours late (`GRACE_MS`) is marked
handled without being sent — after an outage, a nudge about a session that
already came and went has nothing useful to say.

**At-most-once.** A reminder is marked `notifiedAt` after the send attempt
whether or not anything was delivered, and `maxInstances: 1` stops two runs
racing over the same documents. Delivery is best-effort by design; the phone's
local notification is the path that carries a real guarantee.

**iOS pending-notification cap.** iOS allows 64 pending local notifications
per app, shared between goal reminders and session reminders. The planner caps
what it hands the OS (`MAX_SESSION_REMINDERS = 24`) and takes the soonest.
Goal reminders have no equivalent cap today — `MAX_GOALS × MAX_NOTIFY_TIMES ×
7` can exceed 64 on its own, which is a pre-existing gap this work did not
change.

**Timezones.** `fireAtMs` is computed by the client that created the plan,
from its own local calendar day and clock. A user who changes timezone
between scheduling and firing gets the reminder at the absolute moment that
was correct when they scheduled it, not the same wall-clock time in the new
zone. The clients' local notifications behave identically (an
expo-notifications `DATE` trigger is likewise absolute), so the two agree.
`tz` is stored on each document to make a mis-fire debuggable after the fact.

**Cost shape.** One collection-group query per minute (~43k reads/month even
with zero due reminders is *not* what happens — the query is indexed and
returns only due documents, so an idle project reads ~0 documents), plus one
token read and one write per delivered reminder.

---

## Testing

| Suite | Command | Notes |
| --- | --- | --- |
| Backend rules | `npm --prefix functions test` | Pure logic; no emulator needed. |
| App | `npm --prefix app test` | |
| Firestore rules | `firebase emulators:exec --only firestore --project phonebox-d14b7 "npm --prefix app test -- --selectProjects firestore-rules"` | **Needs Java** on PATH. |

The rules suite is the one that needs a JVM: the Firestore emulator is a JAR,
and `emulators:exec` aborts with "Could not spawn `java -version`" without
one. A full JDK is not required -- a JRE is enough, and there may already be
one installed but absent from PATH (check `C:\Program Files\Eclipse Adoptium`
and `C:\Program Files\Java` before installing anything). Prepend its `bin`
to PATH for the length of the run rather than changing it globally:

```bash
PATH="/c/Program Files/Eclipse Adoptium/<jre-dir>/bin:$PATH" npx firebase-tools@latest emulators:exec --only firestore --project phonebox-d14b7 "npm --prefix app test -- --selectProjects firestore-rules"
```

Running this also compiles `app/firestore.rules`, so it doubles as the syntax
check that `firebase deploy --dry-run` would give you (that one needs valid
CLI credentials; this doesn't).

The Firestore-rules suite (`app/tests/firestore-rules/pushReminders.test.ts`)
covers the cross-account cases that matter most here: a push token is an
address the server will send to, so a rule that let one user write into
another's path would let them aim notifications at a stranger's phone.
