# iOS Background-Wake & Call-Notification Architecture

> **SUPERSEDED for Feature B (background logging).** An independently-produced, more thorough design
> for this same scope already existed at `docs/rfcs/ios-call-greenlist-and-force-quit-logging-technical-design.md`
> (found after this doc was written — duplicate work from an earlier, since-interrupted run of the same
> delegation). That document's §1/§3 are authoritative for the background-wake foundation and
> force-quit-resilient logging implementation, including a real firmware correctness gap
> (`lock_ble.py` clears the session queue on BLE notify, not on ack) this document missed. **Feature A
> (§4, call greenlist Tier 2) in both documents is CANCELLED** per the human's explicit decision
> (2026-08-09): true per-contact identity on a normal cellular call is not achievable on iOS regardless
> of a VoIP/Twilio relay's cost, because it requires the caller to dial a different number than the
> user's real one, which the human ruled out. Kept here for its risk/tradeoff analysis, which remains
> accurate background reading.

**Date:** 2026-08-09
**Type:** RFC / technical design (pre-implementation architecture)
**Prepared for:** Phone Box companion app (`app/`), iOS platform
**Upstream context:** `docs/rfcs/companion-app-development-approach-technical-design.md` §5.3
(greenlist calls, Tier 1/Tier 2) and `app/src/store/useStore.ts` (background BLE logging
rationale). **This document answers *how* to build the shared native plumbing** two
downstream features need, and specifies each feature's design on top of it.

---

## Executive summary

Two features — **per-contact call greenlisting** (Feature A) and **usage logging that
survives a force-quit** (Feature B) — both need the app to wake up from background or
termination on iOS. iOS only grants that wake-up through a small number of
system-driven exceptions, not through general-purpose background scheduling. Building
each feature's native plumbing independently would mean two implementation tasks
fighting over the same `AppDelegate`/native-module surface (PushKit registration, Core
Bluetooth restoration, launch-reason detection).

**The recommendation:** extract one small **shared foundation module**
(`app/modules/background-wake/`) that owns exactly two things — PushKit VoIP
registration/delegate wiring, and Core Bluetooth restoration launch detection — and
exposes a narrow contract both features consume without touching each other's files.
Feature A (CallKit + PushKit VoIP greenlisting) and Feature B (best-effort background
BLE log drain) are then two independent consumers of that foundation.

**The two honest platform truths that shape everything below:**
1. **iOS cannot tell a third-party app who is calling on a normal cellular call.**
   `CXCallObserver` sees state changes with no caller identity; `CallDirectory`/Live
   Caller ID extensions only label calls inside Apple's own Phone app. The *only* way to
   get real per-contact identity is to have the greenlisted contact's call arrive
   **as a VoIP call routed through the app** (PushKit + CallKit) — which in turn requires
   a small backend capable of sending an APNs VoIP push, because nothing can trigger a
   PushKit push without a server holding the VoIP push credential. This is a real
   scope/cost expansion beyond the base RFC's "$0 backend" principle, flagged in Risks.
2. **Standard background mechanisms do not relaunch a user-force-quit app.**
   `BGTaskScheduler`/background-fetch never resume a terminated app. Only two documented
   exceptions can relaunch a *terminated* process at all: CallKit/PushKit VoIP push
   delivery, and Core Bluetooth central-manager **state restoration**
   (`CBCentralManagerOptionRestoreIdentifierKey` + `didFinishLaunchingWithOptions`) when
   a BLE peripheral event occurs. Apple's own documentation distinguishes
   **system-initiated termination** (state restoration is designed for this) from
   **user-initiated termination** (swiping the app away in the switcher) — and is
   explicit that the latter is not guaranteed to be revived by either mechanism. This
   design does not promise it will be. The box's own RAM session queue
   (`Box-code/lib/lock_log.py`) is the only truly lossless component: it holds every
   finished session until the *next* BLE connection, however that connection happens,
   including the user simply reopening the app by hand.

---

## 1. Background — why these two features share a foundation

| | Feature A — call greenlist | Feature B — force-quit-durable logging |
|---|---|---|
| Trigger | Incoming call (real cellular or VoIP) | Any moment the box has unsynced sessions |
| Needs the app awake because | It must inspect/report the call to CallKit and (Tier 2) push an alert to the box before the caller gives up | It must open a BLE connection to drain `lock_log.py`'s RAM queue before it overflows (`_MAX_PENDING = 40`) |
| Wake mechanism available | PushKit VoIP push (reliable) | Core Bluetooth state restoration (best-effort) |
| Native surface touched | `PKPushRegistry`, `CXProvider`, `AppDelegate` launch options | `CBCentralManager` restoration, `AppDelegate` launch options |

Both land on the same two native seams: **`AppDelegate`-level launch-option
inspection** and **radio-subsystem delegate registration**. If each feature's
implementer edits `AppDelegate.swift` (or the Expo-generated equivalent) independently,
the second one to land will either silently break the first's registration or produce a
merge conflict on every future change. Extracting the shared plumbing once, behind a
narrow contract (§4), lets the two feature tasks proceed in parallel without touching
each other's files.

---

## 2. Platform constraints (verify before relying on any of this)

| Constraint | Detail | Design consequence |
|---|---|---|
| No caller identity on cellular calls | `CXCallObserver` reports state only; `CallDirectory`/Live Caller ID extensions feed only Apple's Phone app | Tier 1 stays identity-less ("someone is calling"); Tier 2 requires VoIP |
| VoIP push needs a backend | APNs VoIP pushes can only be *sent* by a server holding the app's VoIP push certificate/token — nothing on-device or over BLE can originate one | Tier 2 unavoidably reintroduces a backend component (§5, Risks) |
| `voip` background mode is reviewed strictly | Apple requires the mode be used for an app that "provides Voice-over-IP services"; apps that register for VoIP pushes without real VoIP calling risk rejection | Real risk, not cosmetic — see Risks §8 |
| BGTaskScheduler/background-fetch never relaunch a terminated app | Documented Apple behavior; this is *why* `useStore.ts` deliberately avoided `expo-task-manager` | Feature B must rely on the two exceptions below, not on task scheduling |
| CB state restoration relaunches a *system-terminated* app on a BLE event | Requires `CBCentralManagerOptionRestoreIdentifierKey` at manager creation + `didFinishLaunchingWithOptions[.bluetoothCentrals]` handling | Foundation must own this launch-time check once, centrally |
| User-initiated (swipe-away) termination is **not reliably reversed** by either exception | Apple's docs draw the system/user-initiated distinction but do not promise revival after user-initiated kill; developer reports are inconsistent across iOS versions | State this plainly to product/marketing; never promise "logging survives force-quit" without the box-side caveat |
| PushKit push delivery **must** report to CallKit synchronously | `pushRegistry(_:didReceiveIncomingPushFor:payload:completion:)` is required by Apple to result in a `CXProvider.reportNewIncomingCall` call before the method returns, or the OS may kill/penalize the app | Foundation's PushKit delegate calls a CallKit-reporting hook **directly in Swift**, before ever crossing the JS bridge — see §4.3 |

---

## 3. Shared background-wake foundation

### 3.1 What it owns

A new Expo native module, **`app/modules/background-wake/`**, following the existing
`app/modules/call-observer/` convention (Expo Modules API, thin Swift + `index.ts`).

It owns exactly:
1. **PushKit registration and delegate** (`PKPushRegistry`, VoIP push type) — token
   updates and payload receipt.
2. **Launch-reason detection** — inspecting `didFinishLaunchingWithOptions` for
   `.bluetoothCentrals` (Core Bluetooth restoration) vs. a normal user launch, and
   surfacing it to JS before any screen mounts.
3. **A single Swift-level extension point** other native modules assign into — it does
   *not* implement CallKit reporting itself (that is Feature A's job), it just
   guarantees the synchronous call happens.

It explicitly does **not** own: the `CBCentralManager`/`BleManager` instance itself
(that stays in `app/src/ble/PhoneBoxClient.ts`, owned by Feature B), and does not own
`CXProvider`/call-answer UI (Feature A).

### 3.2 New/changed files (foundation task's exclusive territory)

| File | Status | Purpose |
|---|---|---|
| `app/modules/background-wake/ios/BackgroundWakeModule.swift` | new | Expo module; `PKPushRegistry` setup + delegate; launch-reason capture; exposes `voipCallReporter` closure slot |
| `app/modules/background-wake/index.ts` | new | JS surface: `getLaunchReason(): 'normal' \| 'ble-restoration' \| 'voip-push'`, `onVoIPToken`, `onVoIPPushPayload` events, `onBackgroundWake` event fired once per cold launch classified as a background wake |
| `app/modules/background-wake/expo-module.config.json` | new | mirrors `call-observer`'s config; note the `podspecPath` lesson already learned in `call-observer` (autolinking's fallback glob only checks one level of nesting — set it explicitly) |
| `app/app.json` | edited | add `"voip"` to `ios.infoPlist.UIBackgroundModes` (alongside the existing `"bluetooth-central"`); register the new module's config plugin |
| `app/src/ble/PhoneBoxClient.ts` | edited (small, additive) | `BleManager` constructor gains `restoreStateIdentifier: 'phonebox-central'` and a `restoreStateFunction` callback; `afterConnect` is reachable from a restoration event, not only from `connect()`/`connectById()` |

### 3.3 Contract both features build against

```ts
// app/modules/background-wake/index.ts (shape, not final code)
export type LaunchReason = 'normal' | 'ble-restoration' | 'voip-push';

export function getLaunchReason(): LaunchReason;

// Fired once, early, on a cold launch the OS performed for a background reason.
// Both features may subscribe; neither owns this event.
export function onBackgroundWake(cb: (reason: LaunchReason) => void): { remove(): void };

// PushKit — consumed by Feature A only, but the registration itself lives here so
// Feature B's file never has to know PushKit exists.
export function registerVoIPPush(): void;
export function onVoIPToken(cb: (token: string) => void): { remove(): void };
export function onVoIPPushPayload(cb: (payload: Record<string, unknown>) => void): { remove(): void };

// Swift-side only (not exposed to JS): Feature A's native CallKit module assigns
// BackgroundWakeModule.voipCallReporter = { payload in ... reportNewIncomingCall ... }
// exactly once, from its own file, at its own init. Foundation never calls into
// Feature A's Swift file by name -- it calls this closure.
```

The critical design point: **the foundation fires one generic `onBackgroundWake`
event on every qualifying cold launch, regardless of which feature caused it.** Feature
B's root app entry (`app/App.tsx` or equivalent) subscribes to it and opportunistically
triggers `useStore.getState().connect()` to drain any pending BLE history — even on a
launch that was actually caused by a VoIP push for Feature A. This is the one deliberate
cross-feature synergy: any wake, for any reason, is also a chance to drain the box's
session queue.

### 3.4 Launch sequence (both wake paths)

```
Cold launch (process was previously terminated)
        │
        ▼
AppDelegate.didFinishLaunchingWithOptions
        │
        ├─ launchOptions[.bluetoothCentrals] present?
        │        └─ yes → BackgroundWakeModule marks launchReason = 'ble-restoration'
        │
        ├─ PKPushRegistry already delivering a payload?
        │        └─ yes → launchReason = 'voip-push'
        │                  → payload handed synchronously to voipCallReporter
        │                    (CallKit sees the call before JS ever starts)
        │
        ▼
JS bundle boots → App.tsx reads getLaunchReason()
        │
        ├─ 'ble-restoration' or 'voip-push' → skip full UI mount; headless path:
        │        useStore.connect() (re-creates BleManager with the SAME
        │        restoreStateIdentifier so CoreBluetooth reattaches to the
        │        already-connecting/connected peripheral) → drain history →
        │        persist locally → let the process idle back to background
        │
        └─ 'normal' → ordinary UI mount, ordinary connect() as today
```

---

## 4. Feature A — per-contact call greenlist

### 4.1 Scope recap

- **Tier 1 (already stubbed, unchanged by this design):** `CXCallObserver` via
  `app/modules/call-observer/ios/CallObserverModule.swift` → `CallMonitor.ts` → any
  incoming call alerts the box (no identity).
  **CORRECTION (2026-09-10): the parenthetical below was wrong, and it was the reason
  Tier 1 never worked in real use.** `bluetooth-central` does not keep the app alive --
  it *wakes* the app per BLE event and lets iOS suspend it again in between. A suspended
  app receives no `CXCallObserver` delegate callback, and the missed transition is never
  replayed, so with the phone shut in the box (i.e. always) the ring was observed by
  nobody. Tier 1 now also polls `CXCallObserver.calls`, a snapshot rather than a
  transition, on every box status notify (~1/s) -- see `CallMonitor.checkNow` and
  `CallObserverModule.swift`'s header. Original claim, kept for the record: "it needs
  none of the foundation's new plumbing because `CXCallObserver` already fires in the
  background without a special wake path (the app just needs to be alive, which
  `bluetooth-central` background mode already keeps it, per the existing design)."
- **Tier 2 (new, this design):** true per-contact identity via VoIP/PushKit + CallKit.

### 4.2 Contact permission and greenlist storage

- **Permission UI:** new screen, e.g. `app/src/screens/GreenlistScreen.tsx` (sibling to
  the existing `SettingsScreen.tsx`), using **`expo-contacts`** to request
  `Contacts.requestPermissionsAsync()` and present a searchable picker.
- **Storage:** greenlist entries (contact identifier + display name + the phone
  number(s) that count as "this contact") persisted the same way every other
  app-local preference is — through `app/src/storage/storage.ts`'s `getJSON`/`setJSON`
  (`AsyncStorage`-backed), under a new key, e.g. `greenlistContacts`. Small, non-relational
  data — no need for the SQLite tier the base RFC reserves for session history.
- **Store:** a new slice, e.g. `app/src/store/useGreenlistStore.ts` (mirrors
  `useSettingsStore.ts`'s shape) — `contacts: GreenlistEntry[]`, `add`, `remove`, hydrate
  on boot.

### 4.3 CallKit + PushKit integration

- New native module `app/modules/voip-call/ios/VoipCallModule.swift` (Feature A's
  exclusive file) wraps `react-native-callkeep`'s `CXProvider` setup and, at its own
  `OnCreate`, does:
  `BackgroundWakeModule.shared.voipCallReporter = { [weak self] payload in self?.reportIncomingCall(from: payload) }`
  — this is the one line of coupling to the foundation module, and it is Feature A's
  responsibility to write it, not the foundation's.
- `reportIncomingCall` extracts caller identity from the push payload (see §4.4) and
  calls `CXProvider.reportNewIncomingCall(update:completion:)` synchronously, satisfying
  Apple's requirement, before anything reaches JS.
- Once reported, JS learns of the call via a `CallEvent`-shaped event (extend
  `app/modules/call-observer/index.ts`'s `CallEvent` type or add a parallel
  `VoipCallEvent` with a `callerId` field) — this is what finally gives
  `CallMonitor.ts` something real to key off of.

### 4.4 Where the identity actually comes from — the backend gap, stated plainly

Per §2, nothing can *originate* a PushKit push without a server. Two concrete shapes,
both requiring a small backend (this is new scope vs. the base RFC's "$0 backend, BLE
only" principle):

| Option | Shape | Cost/complexity | UX cost |
|---|---|---|---|
| **4.4a — Telephony relay (e.g. Twilio Programmable Voice)** | Greenlisted contact dials a dedicated forwarding number (not the user's normal cell number); Twilio's webhook hits a small function that resolves the number against the user's greenlist and sends an APNs VoIP push with the caller's name in the payload | Ongoing telephony cost (per-minute/per-number); a real backend function to operate | Contact must know to call a *different* number than the user's normal cell number — a real adoption barrier |
| **4.4b — App-to-app "ring me"** | Both the caller and the user have the app; caller taps "ring me" in-app, which round-trips through a lightweight push-relay (no telephony, just a signaling function that sends the VoIP push) | Smaller backend (no telephony), but still a server | Only works between two app installs — does not cover "my greenlisted mom calls my normal cell number" at all |

**Neither option lets a greenlisted contact simply dial the user's existing cellular
number and get identified.** That capability does not exist on iOS for third-party apps,
full stop (§2). This must be communicated to product/marketing before Tier 2 is
scoped further; recommend 4.4a if the product commitment is "call my normal number and
still get through," since 4.4b cannot deliver that at all. Both require accepting an
ongoing backend, contradicting the base RFC's $0-backend B1 decision — treat Tier 2 as
a deliberate, scoped exception to that decision, not a free extension of it.

### 4.5 Replacing `resolveLabel()`

`app/src/calls/CallMonitor.ts`'s `resolveLabel()` (currently a hardcoded `'Call'` at
line 67) is extended, not replaced wholesale:

```ts
private resolveLabel(e: CallEvent): string {
  if (e.callerId) {
    const known = useGreenlistStore.getState().findByCallerId(e.callerId);
    if (known) return known.displayName;
  }
  return 'Call'; // Tier 1 fallback: identity-less alert, unchanged
}
```

`CallEvent` gains an optional `callerId?: string`, populated only on the VoIP path
(§4.3); the existing `CXCallObserver` path continues to omit it, so Tier 1 behavior is
untouched.

### 4.6 Reaching the existing BLE alert path

No change needed here — this is exactly why the base RFC's `alert` characteristic
(`protocol.ts` `CHAR.alert` / `encodeAlert`) and `lock_controller.py`'s `notify_call()`
already exist. `CallMonitor.handle()` already calls `client.alertCall(label)` for any
qualifying incoming-call event; Tier 2 only changes what `label` resolves to. The box
side needs **zero changes**: `notify_call()` already branches on
`settings.unlock_on_call` for alert-vs-unlock, independent of who called.

### 4.7 Info.plist / entitlements / permissions

| Requirement | Where |
|---|---|
| `NSContactsUsageDescription` | `app/app.json` → `ios.infoPlist` (new) |
| `voip` in `UIBackgroundModes` | `app/app.json` (added alongside existing `bluetooth-central`, §3.2) |
| `Push Notifications` capability + VoIP Services certificate | Apple Developer portal entitlement; `aps-environment` entitlement already implied by push capability |
| CallKit usage | No separate Info.plist key required, but App Store Connect app-review notes should proactively explain the VoIP usage (see Risks §8) |
| `react-native-callkeep` / `react-native-voip-push-notification` (or `expo-callkit-telecom`) | New native dependencies; Expo config plugins per package docs |

### 4.8 Data flow — Tier 2 call

```
Greenlisted contact          Backend relay             Phone (app, backgrounded         Box
(dials relay number)         (Twilio fn / signaling)   or terminated)                    (locked)
      │                            │                          │                          │
      ├── call/ring ──────────────▶│                          │                          │
      │                            ├── looks up greenlist ───▶│ (APNs VoIP push)         │
      │                            │                          │                          │
      │                            │        AppDelegate.pushRegistry(didReceiveIncomingPush)
      │                            │                          │  → CXProvider.reportNewIncomingCall
      │                            │                          │    (synchronous, native)  │
      │                            │                          │  → JS: CallEvent{callerId}│
      │                            │                          │  → CallMonitor.resolveLabel
      │                            │                          │  → client.alertCall(label)│
      │                            │                          ├── BLE write: CHAR.alert ─▶│
      │                            │                          │                          ├─ notify_call()
      │                            │                          │                          │  alert-through
      │                            │                          │                          │  (or unlock, if
      │                            │                          │                          │   ucal is on)
```

---

## 5. Feature B — usage logging that survives force-quit

### 5.1 What persists, when, via what mechanism

| Layer | What | When | Mechanism | Loss characteristics |
|---|---|---|---|---|
| **Box** | Every finished session (`planned_s`, `actual_s`, `completed`, `epoch`) | Unconditionally at every `go_done()` transition | `Box-code/lib/lock_log.py` `SessionLog.record()` — RAM-only, no SD/NVM (explicit prior decision) | Bounded FIFO, `_MAX_PENDING = 40`; oldest dropped only if 40 sessions accumulate with *no* phone connection at all. This is the true backstop — it does not care what the phone did. |
| **Phone (existing, unchanged)** | Same session records, deduplicated | On every `history` characteristic notify, i.e. every successful BLE connect while the app process is alive | `useStore.ts` `handleHistory` → `appendSessions` → `app/src/storage/storage.ts` (AsyncStorage) | Works today whenever the app is foregrounded, or backgrounded-but-alive with a live connection (`UIBackgroundModes: bluetooth-central`) |
| **Phone (new, this design)** | Same, but reachable from a **terminated** process | On a CB-restoration-triggered cold launch | `BackgroundWakeModule` launch detection (§3) → `onBackgroundWake('ble-restoration')` → `useStore.connect()` reused verbatim (re-creates `BleManager` with the same `restoreStateIdentifier`) → same `handleHistory` path | **Best-effort.** Fires only when iOS chooses to relaunch for a *system-initiated* termination + a qualifying CoreBluetooth event. Never guaranteed; never fires after a user swipe-kill in the general case. |

No new persistence *format* is introduced — Feature B's job is entirely about
**reaching the existing drain path (`useStore.connect()` → `handleHistory`) from more
launch states**, not about inventing a new store.

### 5.2 What this cannot guarantee — say it plainly

> If the user swipes the app away in the app switcher, standard background-fetch
> mechanisms will not fire again until they manually reopen the app. The only two
> backstops that *might* relaunch the app before that — a VoIP push (Feature A's path,
> irrelevant unless a greenlisted call happens to come in) and Core Bluetooth state
> restoration (§3) — are both undocumented-as-guaranteed by Apple for a
> **user-initiated** termination, and in practice do not reliably fire after one. The
> box's own RAM queue is the only component that never loses data regardless of what
> the phone does: it simply holds every session (up to 40) until the next time *any*
> connection happens, including the mundane case of the user opening the app normally
> the next day.

This should be the exact framing used in user-facing copy/marketing review — do not let
"survives force-quit" ship as an unqualified claim.

### 5.3 Data flow — background/terminated drain

```
Box (locked, sessions finishing)          Phone
┌──────────────────────────┐              ┌───────────────────────────────────┐
│ go_done() × N              │             │ App alive, backgrounded            │
│  → SessionLog.record()     │             │  (bluetooth-central mode):         │
│  → RAM queue grows          │  BLE notify │  live drain on every completion,  │
│    (bounded, FIFO@40)       │◄───────────│  unchanged from today              │
└──────────────────────────┘              └───────────────────────────────────┘
        │ (time passes; iOS terminates phone process — system-initiated)
        ▼
┌──────────────────────────┐              ┌───────────────────────────────────┐
│ queue keeps growing        │             │ Process terminated                 │
│ (still bounded @40,        │             │                                     │
│  oldest dropped past that) │             │  ... a BLE-restoration-eligible     │
│                            │◄────────────┤  event occurs (peripheral seen) →  │
│                            │  reconnect  │  iOS cold-launches the app with     │
│                            │             │  launchOptions[.bluetoothCentrals]  │
│                            │             │  → BackgroundWakeModule detects it  │
│                            │             │  → useStore.connect() (headless)    │
│                            │─── history ▶│  → handleHistory → AsyncStorage     │
│ queue cleared               │             │  → process may suspend again        │
└──────────────────────────┘              └───────────────────────────────────┘
        │ (user swipes app away — user-initiated termination)
        ▼
┌──────────────────────────┐              ┌───────────────────────────────────┐
│ queue keeps growing        │             │ Process terminated                 │
│ (still bounded @40)        │             │  NO guaranteed relaunch path.      │
│                            │             │  App only resumes draining when    │
│                            │             │  the user manually reopens it.     │
└──────────────────────────┘              └───────────────────────────────────┘
```

---

## 6. Interface contract for the two downstream implementation tasks

To let a "Feature A: greenlist calls" task and a "Feature B: background logging" task
proceed **in parallel without conflicting**, ownership is split as follows. Neither task
edits a file it does not own; the only shared file either touches is
`app/app.json` (additive, different keys — `voip` mode is Feature A's line,
`bluetooth-central` already exists and is untouched).

| File / module | Owner | Notes |
|---|---|---|
| `app/modules/background-wake/**` | **Foundation** (do first, blocks both) | Neither feature task edits this after landing; extension points only |
| `app/src/ble/PhoneBoxClient.ts` (restoration wiring) | **Foundation** | One-time addition of `restoreStateIdentifier`/`restoreStateFunction` to the existing `BleManager` constructor call |
| `app/App.tsx` (or root entry) — `onBackgroundWake` subscription | **Foundation** (stub) → **Feature B** (fills in the drain call) | Foundation adds the subscription plumbing; Feature B is the one that calls `useStore.connect()` from it |
| `app/modules/call-observer/**` | **Feature A** (existing, Tier 1 — touch only if changing Tier 1) | Unchanged by this design |
| `app/modules/voip-call/**` (new) | **Feature A** | Owns `CXProvider`; assigns `BackgroundWakeModule.voipCallReporter` from its own init — never edits `BackgroundWakeModule.swift` itself |
| `app/src/calls/CallMonitor.ts` | **Feature A** | `resolveLabel()` extension (§4.5); no other file needs to change for this |
| `app/src/screens/GreenlistScreen.tsx`, `app/src/store/useGreenlistStore.ts` | **Feature A** | New, exclusive |
| `app/src/store/useStore.ts` | **Feature B** | `handleHistory`/`connect()` reused as-is; only touch if the headless-launch path needs a variant entry point |
| `Box-code/**` | **Neither** | No firmware changes required for either feature as designed |
| `app/app.json` | **Both, additive only** | Feature A adds `voip` to `UIBackgroundModes` + `NSContactsUsageDescription`; Foundation adds the background-wake config plugin; no line either task adds should require editing a line the other added |

**Sequencing implication:** the foundation module should land first (it is a
prerequisite import for both), but its surface is narrow enough that Feature A and
Feature B can be scoped, estimated, and implemented as fully parallel tickets once it
exists.

---

## 7. Risks & tradeoffs

| Risk | Sev | Mitigation |
|---|---|---|
| **App Store review rejection for `voip` background mode.** Apple's guidelines and review practice scrutinize apps that declare `UIBackgroundModes: voip` without offering actual VoIP calling as a user-facing feature; a "focus lockbox" app requesting VoIP background mode to power a call-greenlist alert is a plausible-but-not-guaranteed approval. This is a real approval risk, not just a technical one. | High | Frame the App Review notes explicitly: the app *does* place/receive VoIP-routed calls as part of Tier 2 greenlisting (4.4a/4.4b), which is a legitimate VoIP use case per Apple's own examples (call-relay apps). Prepare a demo account/video for review. Consider shipping Tier 1 (no `voip` mode needed) as a standalone release first, and gating Tier 2's submission separately so a rejection doesn't block the whole app. |
| **Tier 2 requires an ongoing backend**, contradicting the base RFC's $0-backend, no-account B1 decision. | High | Treat as a scoped, explicit exception for the greenlist tier only; do not let it creep into the viewer/logging path, which stays backend-free. Revisit whether Tier 2 is worth building at all before committing engineering time to the relay. |
| **CoreBluetooth state restoration is well-documented as unreliable** even for system-initiated termination, and near-useless for user-initiated termination. | High | Never message this as "guaranteed" anywhere in-app; the box's RAM queue is the actual sold guarantee (bounded to 40 sessions). |
| **PushKit's synchronous-report requirement is easy to violate accidentally** if the Swift delegate method does any async work (e.g. crossing to JS) before calling `reportNewIncomingCall`. Violating it repeatedly can get the app's VoIP push entitlement penalized by Apple. | Med | Keep the foundation's `pushRegistry(didReceiveIncomingPushFor:)` implementation synchronous and native-only for the CallKit report; JS only receives the payload *after* the report has already happened. |
| **Contact-permission prompt UX cost.** Asking for `NSContactsUsageDescription` access is a new, unavoidable permission prompt for a feature (greenlist) that is opt-in and possibly low-attach. | Med | Gate the prompt behind an explicit "Set up call greenlist" entry point in settings, never on first launch; make Tier 1 (no contacts permission needed) the default experience. |
| **Battery cost of `bluetooth-central` + `voip` background modes together.** Two always-on background capabilities compound battery drain complaints. | Med | Keep BLE central mode's existing behavior (already accepted cost); VoIP background mode itself is push-driven (no polling), so its marginal battery cost is low — but say so explicitly in review notes and any user-facing battery-usage explanation. |
| **Two features racing to configure the same `CBCentralManager`** if Feature B's restoration wiring and any hypothetical Feature-A-side BLE use aren't coordinated. | Low | Feature A does not need its own BLE connection (it uses `client.alertCall`, already owned by Feature B's `PhoneBoxClient`); this design keeps exactly one `BleManager` instance, owned by `PhoneBoxClient.ts`. |
| **`react-native-callkeep`/`react-native-voip-push-notification` version drift with Expo SDK.** These are community libraries with native config plugins that lag Expo SDK releases. | Low | Pin versions; validate against the project's current Expo SDK before starting Feature A implementation; this is a spike, not an assumption. |

---

## 8. Recommended sequencing

1. **Foundation module** (§3) — implement and land first; validate launch-reason
   detection and PushKit registration on a real device (no simulator VoIP push
   testing is reliable).
2. **Feature B** (§5) — smaller, no new UI, no App Store review risk, no backend.
   Ship first to get real-world data on how often CB-restoration wake actually fires in
   practice before committing to Feature A's backend cost.
3. **Feature A, Tier 1** (already shipped/stubbed) — no changes needed.
4. **Feature A, Tier 2** (§4) — the highest-cost, highest-review-risk piece; scope the
   backend relay (4.4a vs 4.4b) as its own decision point before writing any Swift,
   since it determines the whole shape of the feature.

---

## Sources

- Apple — [`PKPushRegistry` / PushKit](https://developer.apple.com/documentation/pushkit)
- Apple — [CallKit `CXProvider`](https://developer.apple.com/documentation/callkit/cxprovider)
- Apple — [`CXCallObserver`](https://developer.apple.com/documentation/callkit/cxcallobserver)
- Apple — [Core Bluetooth background processing / state preservation and restoration](https://developer.apple.com/library/archive/documentation/NetworkingInternetWeb/Conceptual/CoreBluetooth_concepts/CoreBluetoothBackgroundProcessingForIOSApps/PerformingTasksWhileYourAppIsInTheBackground.html)
- Apple — [About the Background Execution Sequence / app states](https://developer.apple.com/documentation/uikit/app-and-environment/managing-your-app-s-life-cycle) (system- vs. user-initiated termination distinction)
- `react-native-callkeep`: https://github.com/react-native-webrtc/react-native-callkeep
- `react-native-voip-push-notification`: https://github.com/react-native-webrtc/react-native-voip-push-notification
- `expo-contacts`: https://docs.expo.dev/versions/latest/sdk/contacts/
- Expo Modules API / AppDelegate subscribers: https://docs.expo.dev/modules/appdelegate-subscribers/
- Upstream design: `docs/rfcs/companion-app-development-approach-technical-design.md` §5.3, §8
- Current code read for this design: `app/modules/call-observer/ios/CallObserverModule.swift`,
  `app/modules/call-observer/index.ts`, `app/src/calls/CallMonitor.ts`,
  `app/src/store/useStore.ts`, `app/src/ble/PhoneBoxClient.ts`, `app/app.json`,
  `app/src/ble/protocol.ts`, `Box-code/lib/lock_controller.py`, `Box-code/lib/lock_log.py`
