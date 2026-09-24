# iOS Call Greenlist (CallKit/PushKit) + Force-Quit-Resilient Usage Logging — Technical Design

> **Update (2026-08-09, later same day): §2 (Feature 1, call-greenlist Tier 2 via Twilio/VoIP) is
> CANCELLED per explicit human decision.** The human asked, in effect, whether a normal call from a
> contact already saved in their phone could unlock/notify without a relay — it can't; iOS gives zero
> caller-ID access to third-party apps on a normal cellular call, and that's true independent of
> whether the number is already in Contacts (§2.2 already established this; the human's condition for
> keeping Tier 2 is not satisfiable). Tier 1 (`CXCallObserver`, no identity, already shipped) is
> unaffected and stays as-is. **§1 (shared background-wake foundation) and §3 (Feature 2, force-quit-
> resilient logging, including the NVM/ack firmware fix) remain authoritative and are being
> implemented** — with §1's foundation simplified to drop the PushKit/VoIP plumbing that existed only to
> serve the now-cancelled §2, since nothing else needs it. A parallel, independently-produced RFC at
> `docs/rfcs/ios-background-wake-and-call-notification-architecture.md` covers the same ground with less
> firmware detail (missed the NVM/ack gap this document found) — that document now points back here for
> Feature B and is superseded for that scope.

**Date:** 2026-08-09
**Type:** RFC / technical design (pre-implementation)
**Prepared for:** Phone Box companion app, iOS-first
**Upstream context:** `docs/rfcs/companion-app-development-approach-technical-design.md` (§3.2 data-capture seam,
§5.3 iOS greenlist tiers, §8 risks). This document is the detailed design for two items on that roadmap:
roadmap item 5 (iOS greenlist calls, Tier 2) and a hardening pass on item 2/3 (usage logging must survive
the app being force-quit, not just backgrounded).
**Status:** draft, returned for review before implementation starts. No branch/PR opened for this
document (conversational design task).

---

## 0. Executive summary

Both features need the app to do something in the background on iOS. iOS gives exactly two ways to
relaunch an app that has stopped running, and which one is available depends on *why* the app stopped:

| The app stopped because... | Can iOS relaunch it? | Mechanism |
|---|---|---|
| User swiped it away in the App Switcher ("force-quit") | **Only for one thing:** a VoIP push | `PushKit` → `PKPushRegistry` |
| iOS killed it for memory/resources while suspended (no user action) | Yes | Core Bluetooth **state restoration** |
| Either of the above | **Never** | `BGTaskScheduler` / Background Fetch (Apple explicitly excludes force-quit) |

Neither mechanism is available to **both** features for free:
- **Greenlist calls (Tier 2)** naturally gets a real trigger: a greenlisted contact's call arrives *as a
  VoIP push* (that is the whole design — see §2), so PushKit relaunch is intrinsic to the feature and
  **does** survive force-quit.
- **Usage logging** has no equivalent natural trigger — the box has no internet connection and cannot
  itself originate a push. After a genuine user force-quit, **nothing can wake the app on the box's
  behalf.** The only thing that keeps usage logging from losing data in that window is the box's own
  session queue (today RAM-only, capped at 40, cleared without an ack — see §3.1 for why that is not
  actually lossless yet, and the fix).

**The honest ceiling (stated plainly, per the design brief):** after a user-initiated force-quit, usage
logging cannot be delivered in real time and greenlist calls cannot be *detected* any faster than the
next VoIP push arrives — but no usage data is lost, because it queues on the box until the app is next
opened (by the user, or incidentally by a Tier-2 call). 100% *real-time* survival is not achievable for
usage logging; 100% *data* survival is achievable and is what this design delivers.

Both features touch the same native surface (AppDelegate launch-options handling, PushKit registration,
the BLE central manager's restoration identifier). §1 defines one shared module so the two downstream
implementation tasks don't edit the same native files independently.

---

## 1. Shared background-wake foundation (build this first, once)

### 1.1 Why a shared module

Today `app/src/store/useStore.ts` constructs a single module-level `PhoneBoxClient` (which owns a
`BleManager`) and relies entirely on iOS's passive "keep a connected peripheral's notifications flowing
while backgrounded" behavior (`app/app.json` → `UIBackgroundModes: ["bluetooth-central"]` +
`react-native-ble-plx`'s `isBackgroundEnabled`). There is no `AppDelegate` customization yet, no PushKit,
no restoration identifier. Both features need to add exactly that kind of native launch/wake plumbing.
If the greenlist task and the usage-logging task each add their own `AppDelegate` subscriber, their own
`PKPushRegistry`, or their own `BleManager` restoration options independently, they will collide (Expo's
generated `AppDelegate.swift` is a single file; two independent `didFinishLaunchingWithOptions` hooks or
two central-manager instances is exactly the kind of thing that produces silent, hard-to-debug
double-registration bugs).

### 1.2 The module: `app/modules/background-wake/`

A new Expo native module, sibling to `app/modules/call-observer/`, following the same conventions
(`expo-module.config.json`, `ios/…Module.swift`, a thin `index.ts`). It is the **only** place that:

- Registers an `ExpoAppDelegateSubscriber` to observe `application(_:didFinishLaunchingWithOptions:)`
  — Expo modules can subscribe to AppDelegate lifecycle callbacks without editing the generated
  `AppDelegate.swift` file at all, which is what keeps this additive instead of a shared-file conflict.
  It inspects `launchOptions` for:
  - `UIApplicationLaunchOptionsBluetoothCentralsKey` — the app was relaunched to restore a Core
    Bluetooth central manager (state restoration; only happens for OS-initiated termination).
  - Nothing to inspect for the PushKit case — `PKPushRegistryDelegate.pushRegistry(_:didReceiveIncomingPushWith:for:completion:)`
    fires independently of `didFinishLaunchingWithOptions` and is *itself* the relaunch signal.
- Owns the one `PKPushRegistry` instance (VoIP push type only) and its delegate methods
  (`didUpdatePushCredentials`, `didReceiveIncomingPushWith:completion:`, `didInvalidatePushTokenFor`).
  It does **not** call CallKit's `reportNewIncomingCall` itself — that stays in the greenlist feature's
  own code (§2.3), so this module has no CallKit/audio dependency and Feature 2 doesn't pull in CallKit
  transitively.
- Exposes one JS event:

  ```ts
  // app/modules/background-wake/index.ts
  export type WakeReason = 'voip-push' | 'ble-restore' | 'foreground-launch';
  export interface WakeEvent { reason: WakeReason; payload?: Record<string, unknown> }
  export function addBackgroundWakeListener(fn: (e: WakeEvent) => void): EventSubscription;
  ```

  Feature 1's call handling and Feature 2's history-sync both subscribe to this **one** stream instead of
  touching native code themselves.

### 1.3 The one existing file both features must coordinate on

`app/src/ble/PhoneBoxClient.ts` constructs `new BleManager()` with no options today. Core Bluetooth state
restoration requires the central manager to be constructed with a `restoreStateIdentifier` — and,
per `react-native-ble-plx`'s background-mode guidance (already cited in the upstream RFC's Sources),
that manager must be a long-lived singleton created at JS-module-evaluation time, not lazily on first
`connect()`. **This already holds** — `useStore.ts` does `const client = new PhoneBoxClient()` at module
scope — so the only change needed is:

```ts
// PhoneBoxClient.ts constructor
this.manager = new BleManager({ restoreStateIdentifier: 'phonebox-central', restoreStateFunction: (restoredState) => { ... } });
```

**Ownership rule:** this one line (and the `restoreStateFunction` callback wiring) belongs to whichever
task implements usage-logging (§3), since it's in service of history sync. The greenlist task must not
also touch `PhoneBoxClient`'s manager construction — it only needs BLE to *send* an alert/unlock once
awake (already exposed via `client.alertCall()` / `client.unlock()`), which is a normal `connect()` call
made from its own wake handler, not a change to how the manager itself is constructed.

### 1.4 Contract summary for the two downstream tasks

| | Greenlist task (§2) | Usage-logging task (§3) |
|---|---|---|
| Creates `app/modules/background-wake/` | First one to land it (small, ships as its own prerequisite PR/commit before either feature's main work) | Consumes it |
| Adds to `background-wake` native module | PushKit registration + delegate | Nothing (CB restoration is handled inside `PhoneBoxClient`, not this module) |
| Touches `AppDelegate.swift` directly | No (via subscriber) | No (via subscriber) |
| Touches `app.json` | Adds `voip` to `ios.infoPlist.UIBackgroundModes`, adds push entitlement | No change needed (already has `bluetooth-central`) |
| Touches `PhoneBoxClient.ts` | No | Yes — adds `restoreStateIdentifier` |
| Subscribes to `onBackgroundWake` | Yes, for `voip-push` | Yes, for `ble-restore` (and opportunistically `voip-push`, see §3.3) |
| New JS module | `app/src/calls/VoipCallMonitor.ts` | `app/src/ble/HistorySync.ts` |

---

## 2. Feature 1 — iOS per-contact call greenlist

### 2.1 What already exists (don't rebuild it)

- `app/modules/call-observer/ios/CallObserverModule.swift` — `CXCallObserver`-based **Tier 1**: detects
  that *any* call is ringing while backgrounded, with **no caller identity** (Apple's documented privacy
  boundary — confirmed in the module's own header comment). This stays as-is; it is not a stub to
  "finish," it is a permanently-capped mechanism.
- `app/src/calls/CallMonitor.ts` — wires Tier 1 events to `client.alertCall(label)` while the box is
  locked and the user has call-alerts enabled. `resolveLabel()` (line 67) is hardcoded to return `'Call'`
  and is explicitly documented as the Tier-2 seam.
- Box side: `firmware/lib/lock_controller.py` `notify_call(label, now)` (line 336) already does the
  right thing with a label — alert-through by default, or `release_lock()` if
  `Settings.unlock_on_call` is on. **No firmware change is needed for Tier 2** — it already accepts an
  arbitrary label string over the existing `alert` characteristic (`BLE_UUID_ALERT`,
  `app/src/ble/protocol.ts` `encodeAlert`).

Tier 2 is therefore entirely an app-side + relay-side problem: get a real caller identity to the app,
in the background, even after force-quit, then reuse the exact same `client.alertCall()` /
`client.unlock()` path Tier 1 already uses.

### 2.2 The mechanism: route the call through the app as VoIP (per upstream RFC §5.3)

Per Apple's documented boundary (also already captured in the upstream RFC), there is no way to identify
an arbitrary cellular caller from a third-party app. The only way to get real per-contact identity is to
have the call arrive **as a VoIP call the app itself receives**, which sidesteps the cellular privacy
wall entirely (the app is told who is calling because the call is addressed to the app, not intercepted
from the carrier).

**Concrete design — one shared "priority line," not a per-contact allowlist sync:**

1. Provision **one Twilio phone number** per Phone Box account (a single number is sufficient — see
   below for why per-contact filtering doesn't need a server-side allowlist).
2. The user gives that number to whichever contacts they want to be able to reach through the box —
   e.g. saved in their own phone's Contacts as "Mom (Priority Line)". Authorization is implicit: only
   people who were given the number can ring it. This avoids building and syncing a server-side
   greenlist at all for v1.
3. Twilio's Voice webhook (a small stateless function — see §2.4) receives the inbound call, reads the
   caller's real number from the `From` param (Twilio gives you this even though the *app* could never
   get it from iOS directly), and responds with TwiML that dials the registered app "client" identity.
4. Twilio delivers the VoIP push (APNs, VoIP topic) to the phone. **This is the mechanism that survives
   force-quit** — Apple's PushKit contract guarantees delivery and relaunch even for a user-terminated
   app, which is precisely why this is the only viable trigger for Tier 2.
5. The app's `PKPushRegistryDelegate.didReceiveIncomingPushWith` fires (inside `background-wake`, §1.2),
   forwards `{ reason: 'voip-push', payload: { from: '+1…' } }` to JS.
6. `VoipCallMonitor` (new, `app/src/calls/VoipCallMonitor.ts`) resolves `from` against the phone's local
   Contacts (via `expo-contacts`) purely for a friendly label ("Mom is calling" vs a raw number) — this
   local lookup is not restricted by any iOS privacy API, since the number came from *our own* relay
   payload, not from `CXCallObserver`. It then applies per-contact policy (alert vs. auto-unlock — a
   local, app-side setting; no server-side policy needed) and calls `client.alertCall(label)` or
   `client.unlock()` over BLE, connecting first if not already connected.
7. Per Apple's PushKit rules, every VoIP push **must** result in a reported CallKit call
   (`CXProvider.reportNewIncomingCall`) or the app risks being flagged for VoIP misuse — so the user will
   see a native "incoming call" screen. That means Tier 2 is not just a silent signal relay; it is
   functionally a lightweight softphone for the priority line, with real two-way audio expected once
   answered. **This report must happen synchronously, natively, before control ever reaches JS** —
   `pushRegistry(_:didReceiveIncomingPushFor:payload:completion:)` is required to call
   `reportNewIncomingCall` before it returns; doing any async work (including crossing the JS bridge)
   first risks Apple penalizing/revoking the app's VoIP push entitlement. `background-wake` (§1.2) must
   therefore expose a **native Swift closure** for the greenlist module to assign into (called directly
   from the PushKit delegate method), not just a JS event — the JS `onBackgroundWake` event fires *after*
   the native report has already happened, for UI/state purposes only.

### 2.3 Recommended library: don't hand-roll PushKit+CallKit+WebRTC

Given the audio-bridging requirement in step 7, recommend the **Twilio Voice React Native SDK**
(`@twilio/voice-react-native-sdk`) rather than a hand-rolled native module. It already wraps PushKit
registration, `CXProvider`/CallKit reporting, and WebRTC audio in one package purpose-built for exactly
this "PSTN call relayed through Twilio to a VoIP client app" pattern — which is lower risk than the
project's usual hand-rolled-native-module convention (`call-observer` is ~70 lines because
`CXCallObserver` is a passive observer; a full VoIP stack is not comparable in scope). The
`background-wake` module (§1.2) still owns the *raw* PushKit registration/event-forwarding for
consistency with Feature 2's wake-event contract, but the SDK's own `CallInvite`/`CallKit` handling can
run alongside it — this needs a short spike to confirm they don't double-register the same `PKPushRegistry`
(see §6).

### 2.4 New infrastructure this feature introduces (breaks the "$0 backend" invariant — flag for Mandy)

The upstream RFC's B1 architecture decision was BLE-only, no backend, specifically to avoid "backend
forever" cost/liability (§3.1 of that doc). Tier 2 unavoidably needs:
- A Twilio phone number (small recurring cost) + a Voice webhook (can be a static Twilio Function, no
  database).
- A token-issuance endpoint: Twilio Access Tokens must be signed server-side (never with client-held
  credentials), so *some* minimal auth-adjacent endpoint is required regardless of how simple the
  webhook is.
- **Sequencing note:** the parent objective also includes Google sign-in + Firebase-backed sync. That
  work will already stand up an authenticated backend surface. Recommend Tier 2's token issuance piggy­
  back on that Firebase project (e.g. a Cloud Function) rather than standing up a second, unrelated
  auth mechanism just for Twilio. This is a sequencing recommendation, not a hard dependency — Tier 2
  could ship a throwaway single-purpose token endpoint first if Firebase lands later.

### 2.5 Permissions & entitlements (additive to `app/app.json`)

| Addition | Where | Why |
|---|---|---|
| `"voip"` in `ios.infoPlist.UIBackgroundModes` | `app.json` (currently only `["bluetooth-central"]`) | Required for PushKit VoIP delivery |
| Push Notifications capability + `aps-environment` entitlement | `app.json` `ios.entitlements` / EAS credentials | PushKit rides on APNs infrastructure even though it's VoIP-only |
| `NSMicrophoneUsageDescription` | `app.json` `ios.infoPlist` | Real two-way audio once a Tier-2 call is answered |
| `NSContactsUsageDescription` | `app.json` `ios.infoPlist` | Local number→name lookup for the alert label (via `expo-contacts`) |

No Android work is in scope here (per manager direction, iOS-first); Android's greenlist path
(`NotificationListenerService`, already scoped in the upstream RFC §5.3) is unaffected and can reuse the
same `client.alertCall()` box-side contract later.

---

## 3. Feature 2 — usage logging that survives force-quit

### 3.1 Current gap, precisely

`firmware/lib/lock_log.py` (`SessionLog`) is the box's queue of sessions finished while no phone was
connected. Two things make it *not* actually a lossless backstop today:

1. **RAM-only, cleared on power loss.** `_pending` is a plain Python list; a reboot/brownout (the box
   already has brownout-retry logic in `safemode.py`) wipes it. `lock_settings.py` shows the box already
   has a working NVM-persistence pattern (magic-byte-guarded byte layout, `_BASE = 8` for settings) —
   session records just don't use it yet.
2. **Cleared on notify, not on ack.** `lock_ble.py` `_push_outbound` (line 149) writes the `history`
   characteristic and then immediately calls `ctrl.log.clear()` (line 166) — a BLE notify has no
   delivery guarantee; if the app missed it (e.g. was busy, or the connection dropped mid-notify), the
   box has already discarded its only copy. This is a pre-existing correctness gap independent of
   force-quit, surfaced here because "lossless backstop" depends on fixing it.
3. **Bounded at 40 entries** (`_MAX_PENDING`), oldest-dropped-first. Fine for "typical daily use between
   phone connections" per the code's own comment, but a multi-day force-quit is exactly the scenario
   that can exceed it.

None of this matters while the app is alive (sessions are also picked up live from the `status`
characteristic per-transition — `useStore.ts` `handleHistory` comment, lines 101-113). It only matters
for the gap between "session finished" and "a phone was next connected," which is precisely the window a
force-quit stretches out.

### 3.2 Firmware fix (firmware, no new BLE characteristics needed)

- **Persist `_pending` to NVM**, following `lock_settings.py`'s exact pattern: a new magic-byte-guarded
  region in `microcontroller.nvm`, sized for the existing 40-entry cap. Each entry packs into 9 bytes
  (planned_s: 2 bytes, actual_s: 2 bytes, completed: 1 byte, epoch: 4 bytes) → 360 bytes for the full
  queue, well within typical ESP32-S3 NVM/NVS region size. Write on every `record()` call (a handful of
  times per day at most — negligible flash-write-endurance impact, consistent with how infrequently
  settings already write).
- **Clear on ack, not on notify.** Add a small sequence number to each `history` push; the app writes an
  ack (reusing the existing `command` characteristic with a new opcode, e.g. `historyAck:<seq>`, rather
  than adding a new UUID) once it has durably persisted the batch to `sessionHistory.ts`. `lock_ble.py`
  only calls `ctrl.log.clear()` once the acked sequence number is >= what it sent. If the app disappears
  mid-transfer (including a force-quit that happens to land exactly then), the box simply re-sends the
  same un-acked batch next connection — `appendSessions` in `sessionHistory.ts` would need de-duplication
  by (startedAt, plannedS) if this lands, since a resend could otherwise double-count (see §6, flagged as
  an implementation-time check, not a design blocker).
- **Raise `_MAX_PENDING`** from 40 to a value sized against realistic force-quit duration (e.g. 200 —
  still ~2KB in NVM, trivial) — this is a tuning knob in `lock_config.py`, not an architecture change.

### 3.3 App-side: opportunistic sync on any background wake

New `app/src/ble/HistorySync.ts` subscribes to `background-wake`'s `onBackgroundWake` event (§1.2) for
**both** `'ble-restore'` and `'voip-push'` reasons:
- `'ble-restore'`: iOS restored the central manager because it killed the app for resources (not the
  user) — reconnect if the box is in range, drain `history`, ack, disconnect/resuspend. This is the
  direct fix for "OS-terminated, not user-terminated."
- `'voip-push'`: this is Feature 1's trigger, not Feature 2's — but since PushKit relaunch means the
  process is running anyway, `HistorySync` opportunistically also attempts a quick BLE reconnect+drain
  as a bonus side effect. This does not make usage logging survive force-quit on its own (a user with
  call-alerts off, or who never receives a greenlisted call, gets no benefit) — it's a free win when
  both features happen to be in use together, not a substitute for §3.2's box-side fix.

No new native code is needed for this piece beyond what §1.3 already wires up in `PhoneBoxClient.ts`.

### 3.4 The honest ceiling (stated explicitly, per the design brief)

After a **user-initiated force-quit**, with call-alerts/Tier‑2 not in play:
- The app will **not** run again, by any mechanism, until the user manually reopens it. This is Apple's
  intended, documented behavior — `BGTaskScheduler`/Background Fetch explicitly exclude force-quit apps,
  and Core Bluetooth state restoration is explicitly for OS-initiated termination only, not user-swipe
  termination. There is no third mechanism. The box has no internet path to originate a push, so it
  cannot substitute for either.
- **What is guaranteed instead:** zero data loss, given §3.2's NVM persistence + raised cap + ack-based
  clear. Every session finished during the outage is queued on the box and delivered in full the next
  time the app opens and connects — just not in real time, and not while the app is dead.
- **What would make this untrue:** a force-quit period long enough to exceed the raised `_MAX_PENDING`
  (oldest sessions get dropped first) or a box power-cycle *combined with* an NVM write that never
  completed (extremely narrow window, same class of risk `lock_settings.py` already accepts for
  settings). Neither is a regression — both are strictly better than today's RAM-only, cleared-on-notify
  behavior.

State this ceiling in any user-facing copy/marketing the same way the upstream RFC insists on for Tier 1
call identity (§5.3): don't promise real-time sync after force-quit; promise no lost history.

---

## 4. Data flow

```
Feature 1 (greenlist, Tier 2)
Greenlisted contact --(dials priority number)--> Twilio number --(webhook)--> TwiML <Dial><Client>
                                                                         |
                                                                    VoIP push (APNs)
                                                                         v
                                            [background-wake] PKPushRegistry.didReceiveIncomingPushWith
                                                                         v
                                              VoipCallMonitor: resolve `from` -> Contacts label
                                                                         v
                                    CXProvider.reportNewIncomingCall (Twilio Voice SDK) -- user sees/answers call
                                                                         v
                                        client.alertCall(label) / client.unlock() over BLE
                                                                         v
                                     Box: lock_controller.notify_call(label, now) -- unchanged, existing path

Feature 2 (force-quit-resilient logging)
Box: go_done -> SessionLog.record() -> NVM-persisted _pending queue (new)
        |
        | (next BLE connection: live app open, OR opportunistic wake below)
        v
lock_ble._push_outbound -> history characteristic (with seq) -> app HistorySync
        |                                                              |
        |<---------------------- historyAck:<seq> via `command` ------|
        v
ctrl.log.clear() only once acked -> app: appendSessions() -> sessionHistory.ts (durable)

Background wake for Feature 2 alone:
iOS kills app (resources, not user) -> relaunch with BluetoothCentralsKey -> [background-wake]
        -> HistorySync reconnect+drain (opportunistic; user-force-quit case has no equivalent trigger)
```

---

## 5. Validation plan

| Scenario | Expected outcome | Method |
|---|---|---|
| Tier 1 (existing) regression | Any-call alert still fires while locked | On-device: existing `CallMonitor` path, unchanged |
| Priority-line call, app foregrounded | CallKit UI appears, `from` resolves to contact label, box alerts/unlocks per policy | On-device, real Twilio number, real second phone |
| Priority-line call, app backgrounded (not force-quit) | Same as above via passive BLE background mode | On-device |
| Priority-line call, app force-quit | PushKit relaunches app, CallKit UI appears, box still receives the alert | On-device: swipe-kill app, then call the priority number |
| OS kills app (simulate via Xcode "Debug > Simulate Memory Warning" while suspended) | Next box-in-range event triggers `ble-restore` wake, `HistorySync` drains pending history | On-device / simulator-assisted |
| Box accumulates sessions while phone is off entirely for >1 day | On next connect, full backlog (up to raised cap) arrives, no duplicates | On-device: leave phone off, run several sessions, reconnect |
| Ack round-trip interrupted mid-transfer (kill BLE connection manually) | Box re-sends the same un-acked batch next connection; app dedupes | On-device: toggle Bluetooth off on the box mid-sync |
| NVM persistence survives box power-cycle | Pending sessions still present after cold boot | On-device: record sessions with phone off, power-cycle box, reconnect |

No host build/test suite exists for the firmware side (project constraint, unchanged); every firmware
row above requires a physical board run, stated plainly per project rules.

---

## 6. Risks & open questions

| Risk | Sev | Mitigation / note |
|---|---|---|
| Twilio Voice SDK's own PushKit registration may conflict with `background-wake`'s raw `PKPushRegistry` (only one delegate can own the VoIP push type) | High | **Spike needed** (see §7) — likely resolution: let the SDK own PushKit entirely for the `voip-push` reason and have `background-wake` just forward the SDK's own callback into the shared JS event, rather than registering a second `PKPushRegistry` |
| Access Token issuance endpoint is new infra with real auth requirements | Med | Sequence behind or alongside the planned Firebase/Google-sign-in work (§2.4); don't build a bespoke one-off auth path if Firebase lands soon |
| History-ack redesign changes a wire contract shared verbatim between firmware and app (`protocol.ts` / `lock_config.py`) | Med | Both sides must ship together, same as any existing protocol change (per `protocol.ts`'s own header warning) |
| Resend-on-missed-ack can double-count a session if `sessionHistory.ts` doesn't dedupe | Med | Add a dedupe key (e.g. `startedAt` + `plannedS`) to `appendSessions`; flagged here so implementation doesn't skip it |
| Raising `_MAX_PENDING` to 200 costs ~2KB of NVM | Low | Confirm against actual available NVM region size on this board before committing to the exact number (quick on-device check) |
| CallKit's mandatory incoming-call UI for every VoIP push means Tier 2 is a real softphone feature, not a lightweight signal — bigger surface than Tier 1 | Med | Already flagged in the upstream RFC's own difficulty table (§6a: "Very hard... not a non-coder task"); this document doesn't reduce that scope, it specifies it precisely so implementation isn't surprised by it |
| **App Store review may reject `voip` in `UIBackgroundModes`** for an app whose primary function is a physical lockbox, not VoIP calling — Apple's guidelines scrutinize the `voip` background mode specifically for apps that declare it without offering real, user-facing VoIP calling | High | Frame Tier 2 honestly in App Review notes as a real VoIP-relay feature (which it is, per §2.2 step 7); provide a demo account/video. Consider shipping Tier 1 (no `voip` mode needed) as its own release first, so a Tier-2 rejection doesn't block the rest of the app |

---

## 7. Spike Findings — recommended pre-implementation spikes (not yet run)

This design cannot be spiked headlessly (it needs an Apple Developer account, a physical iOS device, and
a Twilio account/phone number, none of which are available in this environment). Per the spike-first
rule, these are the specific, scoped spikes to run **before** implementation, not generic "figure it out
during coding":

1. **PushKit ownership conflict** (the High-severity risk above): register `@twilio/voice-react-native-sdk`
   and confirm whether its `TwilioVoice.initialize()` needs to be the sole `PKPushRegistry` owner, or
   whether `background-wake`'s raw registration can coexist by forwarding tokens/pushes to it. One
   session, one throwaway app target. **Help needed:** an Apple Developer Program account with Push
   Notifications capability enabled, and a Twilio trial account + phone number.
2. **Force-quit relaunch confirmation on current iOS**: swipe-kill a minimal PushKit-registered app,
   send one VoIP push via `curl`/APNs, confirm relaunch. (Apple's behavior here has held for years but
   iOS version-specific regressions are exactly the kind of thing worth the 10 minutes to check on the
   actual target OS version before the whole design leans on it.)
3. **NVM region size on the ESP32-S3 board**: confirm `len(microcontroller.nvm)` at the CircuitPython
   REPL to size `_MAX_PENDING` and the new session-record NVM layout against real headroom, not an
   assumption.

None of these are architecture-invalidating risks — a negative result on #1 just means `background-wake`
forwards rather than owns PushKit for the greenlist path; a negative result on #3 just lowers the chosen
cap. They gate implementation *sequencing*, not the design.

---

## 8. Confidence level

**70/100.** The usage-logging half (§3) is low-risk — it's an incremental hardening of an existing,
working queue/ack pattern the firmware already uses elsewhere (`lock_settings.py`), plus one already-
compatible singleton (`PhoneBoxClient`). The greenlist half (§2) carries the real uncertainty: it
converts "detect a call" into "run a softphone," which is a legitimately hard native-iOS feature (as the
upstream RFC's own difficulty table already says), and the PushKit/CallKit ownership question (§6, §7) is
unresolved until spiked. The shared foundation (§1) is deliberately the lowest-risk part — it is
additive, uses Expo's subscriber pattern to avoid file conflicts, and doesn't itself depend on the
Twilio/CallKit uncertainty.

## 8a. Architecture analysis

This project has no standalone architecture document; `fraim/personalized-employee/context/project_context.md`
and `project_rules.md` are the de-facto architecture record (same basis the upstream companion-app RFC
used in its own §8a). Checked against them:

**Patterns correctly followed**
- **Per-peripheral/sibling native module** — `app/modules/background-wake/` mirrors
  `app/modules/call-observer/`'s Expo-module conventions (`expo-module.config.json`, `ios/…Module.swift`,
  thin `index.ts`).
- **`lock_config.py` as single source of truth** — the raised `_MAX_PENDING` and any new BLE ack timing
  tunables live there, not scattered, matching the existing `BLE_*` constant block.
- **Versioned NVM persistence** — the new session-queue persistence reuses `lock_settings.py`'s exact
  magic-byte-guarded layout convention rather than inventing a new one.
- **State-machine reuse** — `notify_call()` is unchanged; Tier 2 reaches it through the same `alert`
  characteristic Tier 1 already uses, no new lock mechanism.
- **Run-loop ordering rule** — no change to `lock_ble.service()`'s position in `code.py`'s loop.
- **On-device-only validation** — §5's validation plan is entirely on-device, no fabricated host tests.
- **Wire-contract lockstep discipline** — the ack/sequence-number extension is called out as a
  `protocol.ts` + `lock_config.py`/`lock_ble.py` joint change, per `protocol.ts`'s own header rule.
- **RFC delivered as markdown in `docs/rfcs/`** — `project_rules.md` defaults documentation deliverables
  to `.docx`, but every existing RFC in this repo (including the upstream companion-app doc this one
  builds on) is markdown-in-repo; this is a deliberate, precedented exception for versioned engineering
  RFCs specifically, not an oversight of the rule.

**Patterns missing from architecture (design introduces; needs a doc decision)**
- **External internet-dependent infrastructure (Twilio relay + token endpoint, §2.4).** `project_context.md`
  frames this as a local-only project with "no remote, issue tracker, or CI to integrate with," and the
  upstream RFC's own B1 decision was explicitly BLE-only/no-backend. Tier 2 unavoidably breaks that
  invariant. This is the single largest architectural departure in this document and needs an explicit
  accept/reject from Mandy (§9) before it's recorded as intended architecture rather than scope creep.
- **NVM-persisted session log** — extends the existing NVM pattern (previously settings-only) to a new
  domain (session history). Low risk given it reuses the proven mechanism, but it's a new *use* of NVM
  worth recording once accepted.
- **BLE ack/sequence-number handshake** — the current wire contract (`protocol.ts`/`lock_config.py`) is
  fire-and-forget notify; this adds the first request/ack pattern to it.
- **Expo `AppDelegate` subscriber + PushKit** — the first feature in this codebase to touch native
  app-launch lifecycle at all; `call-observer` never needed this. Should be recorded as the new pattern
  other future background-wake needs (e.g. a later Android path) should follow, rather than each feature
  re-solving it.
- **Contacts access (`expo-contacts`)** — a new permission/data domain (device Contacts) not used
  anywhere else in the app today.

**Patterns incorrectly followed**
- None identified. The design stays within the documented pin-map/module/config/NVM conventions on the
  firmware side, and the app-side additions are new modules alongside existing ones rather than
  modifications that fight the existing store/BLE-client structure.

## 9. Decisions needed from Mandy before implementation

1. Approve the "one shared priority-line number, no server-side allowlist" simplification for Tier 2
   (§2.2) vs. a per-contact-number or full-allowlist design.
2. Approve introducing Twilio (or name a preferred alternative) as new recurring infrastructure/cost,
   breaking the B1 "$0 backend" invariant — and confirm whether its auth should wait for the planned
   Firebase work (§2.4) or ship its own interim token endpoint.
3. Confirm the two downstream implementation tasks and their ownership split as scoped in §1.4 (who
   builds `background-wake` first).
