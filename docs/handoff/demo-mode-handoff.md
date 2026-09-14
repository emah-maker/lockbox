# Handoff: a demonstration mode, so App Review can see the app work without a box

## Original ask (verbatim, for provenance)
> make a handoff file for another session to write the demo mode

## Where this came from

Phone Box's first public-TestFlight submission was rejected on **2026-09-13**:

> **Guideline 2.1(a) - Information Needed**
>
> We have started your beta app's review, but we were unable to successfully access all
> or part of the app.
>
> In order for us to continue the review, we need to have a way to verify all app features
> and functionality. Typically this is done by providing a demo account that has access to
> all features and functionality in your beta app. It is also acceptable to include a
> **demonstration mode** that exhibits the app's full features and functionality. Note that
> providing a demo video showing your beta app in use is not enough for us to continue the
> review.

**That rejection has a simpler proximate cause, and this task is not it.** The submitted
binary (`1.0.0 (5)`, built 2026-09-06 from `35a8d21`) predates `a57da94`, which added
email/password sign-in — verified with `git merge-base --is-ancestor a57da94 35a8d21`, which
reports it is not an ancestor, and `git ls-tree` at that commit, which has no
`EmailPasswordFields.tsx`. So the reviewer was handed credentials for a sign-in method that
build does not contain. **A rebuild from current `master` is the required fix and may well be
sufficient on its own.** See `docs/handoff/testflight-deploy-handoff.md`.

This task is the second-order problem, and it does not go away with a rebuild: Phone Box's
core feature is locking a phone inside a physical BLE box. A reviewer has no box. Signed into
even a fully seeded demo account they can see history, stats, goals and calendar, but Home
sits on "Connect your box" (`app/src/screens/home/FocusHero.tsx:176`) forever and they cannot
start a lock, watch a session run, or see a session land. "Verify **all** app features" is not
satisfiable by data alone. Apple names demonstration mode as the accepted remedy; this builds it.

Do the rebuild first. Build this before the *second* rejection rather than after, because each
review round trip costs days and a repeat 2.1(a) on the same app invites closer scrutiny.

## Improved task prompt (use this instead)

Add a demonstration mode to the Phone Box companion app (`app/`) that lets someone with no
hardware exercise the full lock-session lifecycle: connect, configure a duration, start a
lock, watch it run down, and have a finished session land in history, stats and the calendar
the same way a real one does.

Implement it by substituting the BLE client, not by special-casing the UI. Every screen should
be unaware it is in demo mode. Resolve "How it is reached" below before writing code — it is
the one decision that changes the shape of everything else.

Read `app/src/ble/PhoneBoxClient.ts` and `app/src/store/useStore.ts` before starting. This repo
comments the *why*; match that. Tests are expected — see the conventions note below.

## The one decision to make first: how it is reached

Apple sanctioned a demo mode, so it does **not** have to be reviewer-only, and it must **not**
be `__DEV__`-gated — the store build is the one the reviewer runs. (Same reasoning as the call
diagnostics panel in `app/src/screens/settings/AlertsSection.tsx`, which ships in release
builds deliberately.) Options, with the trade-off that actually differs:

| Option | For | Against |
|---|---|---|
| **Visible toggle in Settings** (recommended) | Reviewer finds it from a one-line note. Testers waiting on hardware can try the app, which is a real product win. Nothing hidden to explain. | Every tester can enter a fake-data mode; needs an unmistakable persistent indicator so nobody mistakes demo sessions for real ones. |
| Hidden gesture | Testers never stumble in. | The reviewer has to follow instructions precisely to find it; if they miss it, that is another 2.1(a). Apple dislikes functionality reachable only by secret. |
| Auto-on for the demo account's uid | Zero discoverability risk for testers. | Hard-codes an account identity into the binary, and means the reviewer provably sees different behaviour from users — the thing 2.1 scrutiny is about. |

Recommendation: **visible toggle**, Settings → a clearly-labelled "Demo mode" row, off by
default, with a persistent on-screen marker whenever it is on. Confirm with the human before
building something else; the review notes in `docs/app-store/testflight-external-testing.md`
must then name the exact path to it.

## Where things actually stand

Verified 2026-09-13 against current `master` (`e2bc391`).

| Item | State |
|---|---|
| Any existing demo/simulation code | **None.** The only `simulat*` hits in `app/src` are notification-capability guards. |
| The seam to substitute | `const client = new PhoneBoxClient();` — `app/src/store/useStore.ts:114`, a module-level singleton |
| Is `client` reachable anywhere else? | No. It is closed over by `useStore` and handed to `CallMonitor` |
| Does the store inspect the BLE `Device` object? | **No** — `scanForBox()`'s return value is passed straight into `client.connect(device, cb)` (`useStore.ts:386-389`) and never read. It can be an opaque handle in an extracted interface. |
| Wire types the fake must satisfy | `Status`, `HistoryEntry`, `Settings`, `BoxState` — `app/src/ble/protocol.ts:22,81,102,109` |

### The surface a fake has to implement

Everything `useStore` and `CallMonitor` actually call. There is no interface today — extracting
one (`BoxClient`?) that both `PhoneBoxClient` and the demo client satisfy is part of this work,
and is what keeps the substitution honest rather than a cast.

- **Lifecycle**: `waitForPoweredOn()`, `scanForBox()`, `connect(device, cb, timeoutMs)`,
  `connectById(deviceId, cb, timeoutMs)`, `disconnect()`
- **Accessors**: `get deviceId(): string | null` (`PhoneBoxClient.ts:272`),
  `get connected()` (`:348`) — the latter is read by `CallMonitor.ts:165`
- **Commands**: `startLock(seconds)`, `setDuration(seconds)`, `lock()`, `unlock()`,
  `readSettings()`, `writeSettings(s)`, `syncTime()`, `alertCall(label)` (`CallMonitor.ts:176`),
  `ackHistory(seq)`, `setLabels(labels)`, `setPendingTopic(topicId)`
- **Callbacks it must drive** (`ClientCallbacks`, `PhoneBoxClient.ts:31`): `onStatus(Status)`,
  `onHistory(HistoryEntry[])`, `onDisconnect()`

### How a session actually completes

Worth tracing before writing the fake, because the demo has to reproduce it, not shortcut it:

1. The box pushes `Status` roughly once a second. `handleStatus` (`useStore.ts:218`) folds it
   into store state, and — since `a43101c` — calls `monitor.checkNow()` on every tick.
2. `st` walks `idle` → `closed` → `running` → `done`. `rem` counts down while `running`.
3. On finish the box emits a `HistoryEntry` batch. `handleHistory` (`useStore.ts:169`) runs it
   through `ble/historyIntake.ts`, which sets `sessions` and acks with `client.ackHistory(n)`.
4. From there the normal path takes over: local persistence, then `sync/sessionsSync.ts` to
   Firestore, then stats/calendar/goals recompute off the same store.

A demo client that ticks `Status` on a real timer and emits one `HistoryEntry` at the end gets
all of step 4 for free, which is the whole point of substituting at this layer.

## What still needs to be done

1. **Settle "how it is reached"** with the human.
2. **Extract a `BoxClient` interface** covering exactly the surface above. Type the device
   handle opaquely so a fake need not fabricate a `react-native-ble-plx` `Device`.
3. **Write the demo client.** Real timers, not instant completion — the reviewer should watch
   the ring move. Consider offering a short duration (a minute or two) so a session can finish
   inside a review session; a 25-minute demo lock is useless to them.
4. **Add the switch** at `useStore.ts:114`, so which client the store holds depends on the demo
   flag. Flipping it must cleanly tear down whichever client was live — see trap 3.
5. **Persist the flag** alongside the other device-local preferences in
   `store/useSettingsStore.ts`. Note `autoSyncEnabled`'s precedent there: a per-device
   preference that deliberately does **not** sync to other devices. Demo mode is the same kind.
6. **Make it unmistakable while on** — a persistent banner or status-strip treatment, not just
   a settings row. See trap 1 for why this is not cosmetic.
7. **Decide whether demo sessions reach Firestore** (trap 1).
8. **Tests.** `app/src/ble/` and `app/src/store/` both have suites; the demo client's state
   machine is pure timer-and-callback logic and should be tested with fake timers. Update the
   review notes in `docs/app-store/testflight-external-testing.md` with the exact path to the
   toggle.

## Traps

1. **A demo session that syncs is permanent.** `app/firestore.rules`' sessions block allows a
   delete only while `users/{uid}` is absent — a window only account deletion opens (see
   `sync/firestoreSync.ts`'s `deleteAllUserData`). So any fake session that reaches Firestore
   is in that account's stats forever and cannot be removed. This lands hardest on the demo
   account itself, which is seeded to show exactly one goal met and one in progress
   (`scripts/lib/demo-seed-data.js`); a reviewer running several demo locks could move a goal
   past its target and make the seeded story stop reading the way the notes describe it.
   **Decide deliberately**: keep demo sessions local-only (safest, and the recommendation), or
   let them sync and accept the pollution. If local-only, find the seam in
   `sync/sessionsSync.ts` rather than teaching every screen to filter.

2. **Do not let the demo client claim a `deviceId`.** `sync/sessionsSync.ts`'s
   `currentDeviceId()` falls back to `'unknown-device'`, and `sync/sessionMerge.ts` builds
   `sessionDocId` as `deviceId_startedAt_actualS`. The seeded demo data is written under
   exactly `unknown-device` on purpose (trap 2 of the deploy handoff). A demo client returning
   some other id changes the doc-id namespace for anything it produces; one returning `null`
   leaves `afterConnected`'s `if (client.deviceId)` guard to skip the `LAST_DEVICE_KEY` write,
   which is the behaviour you want. Returning `null` is correct — just do it knowingly.

3. **Toggling mid-session must not strand state.** `useStore` keeps `userDisconnected`,
   `reconnectTimer` and `reconnectAttempts` in a closure (`useStore.ts:126-134`), and
   `connect()` guards on `conn` being `connecting`/`connected`/`scanning` (`:343`) precisely
   because two overlapping attempts corrupt each other. Swapping clients while a real scan or a
   demo lock is in flight is the same hazard. Force a clean `disconnect()` through the outgoing
   client before the incoming one is installed, and make sure `scheduleReconnect()` cannot then
   drag the real BLE client back while demo mode is on.

4. **`CallMonitor` is wired to the client at construction** (`useStore.ts:117-122`) and reads
   `client.connected`. If the swap replaces the object the monitor closed over, call alerts
   silently stop working. Either give the monitor an accessor rather than a captured instance,
   or rebuild it on swap — and note `monitor.available` is read once into `callDetectionAvailable`.

5. **Do not `__DEV__`-gate it.** The reviewer runs the store build. This is the same trap the
   call diagnostics panel documents in `AlertsSection.tsx`, and getting it wrong here means
   shipping a build where the thing Apple asked for is compiled out.

6. **The demo must not need sign-in.** Sign-in is optional in normal use, and the point of demo
   mode is that it works regardless. If it only functions once signed in, it has not removed the
   dependency the rejection is about.

## What "done" looks like

- On a clean install with no box anywhere nearby, and without signing in: turn on demo mode,
  connect, set a short duration, start a lock, watch it count down, and see the finished session
  appear in Home's history, Stats, and the Calendar day cell.
- While demo mode is on, it is obvious from the screen — not only from the Settings row.
- Turning it off returns the app to real BLE behaviour with no leftover demo sessions in the
  live-sync path, no stuck `conn` state, and call alerts still working.
- `npx jest` green from `app/` (1067 tests at the time of writing), `tsc --noEmit` clean, and
  `npx expo export -p ios` still exits 0.
- `docs/app-store/testflight-external-testing.md`'s review notes tell the reviewer, in one
  sentence, exactly where the toggle is.

## Out of scope

- **The rebuild itself**, which is the actual fix for the 2026-09-13 rejection. That is
  `docs/handoff/testflight-deploy-handoff.md`, and it is a prerequisite, not part of this.
- **Faking the call alert-through path.** Detecting a real incoming call needs a real call; the
  instrumentation for that is `app/src/calls/callDiagnostics.ts` and is a separate question.
- **Relaxing `app/firestore.rules`** to make demo sessions deletable. The append-only rule is
  load-bearing; if demo sessions should not persist, keep them out of sync rather than making
  real sessions erasable.
- **Android.** The submission in question is iOS TestFlight.
