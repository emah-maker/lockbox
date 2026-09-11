# Phone Box Companion App — Development Approach (Technical Design)

**Date:** 2026-07-22
**Type:** RFC / technical design (research-grade recommendation, pre-implementation)
**Prepared for:** Phone Box (CircuitPython touchscreen phone-lock box, Waveshare ESP32-S3-Touch-LCD-1.47)
**Upstream context:** `docs/brainstorming/phone-box-feature-ideation-2026-07-20.md` — established the companion
app as the **keystone premium feature** (the ESP32-S3 radio is in the BOM but unused). That document
answered *what* to build and *why*. **This document answers *how* to build it**: connectivity shape,
firmware GATT design, mobile framework selection, MVP scope, validation, and risks.

---

## Executive summary — the recommendation

Build the companion app as a **BLE-first, offline, local app**, with a **cross-platform React Native
codebase** on the phone and a **`adafruit_ble` GATT peripheral** in the firmware. Ship a **read-only
"viewer" MVP** (status + session history + basic settings) before adding write-path features
(scheduling, greenlist unlock, accountability). Defer any Wi-Fi/cloud backend until the
accountability/subscription tier is actually validated — it is the only part that carries permanent
cost and privacy liability.

Three decisions drive everything below:

1. **Transport: BLE, not Wi-Fi/cloud (at first).** BLE needs zero backend, works offline, is private,
   and the phone supplies real timestamps. It maps cleanly onto the box's existing local-only,
   no-account model and adds **$0 BOM** (radio already present).
2. **Firmware: `adafruit_ble` over raw `_bleio`.** Adafruit explicitly recommends the higher-level
   library; the ESP32-S3 has native BLE and CircuitPython 10.2.1 supports full GATT peripheral/server
   with custom services and read/write/notify characteristics.
3. **App: React Native + `react-native-ble-plx`.** The box's interaction is exactly the pattern
   cross-platform BLE libraries handle best — *connect, read, write, subscribe-to-notify* — so one
   codebase serves iOS and Android. The one feature that genuinely needs native code (greenlist call
   unlock) needs native code in *any* framework, so it is not a reason to go fully native for the whole
   app.
4. **Greenlist is iOS-first, via calls (per manager direction).** The prioritized greenlist behavior is
   *a whitelisted contact's call reaches through the locked box*. iOS is now the lead platform for it —
   see §5.3 for exactly what iOS allows (an any-call "someone's calling" alert via `CXCallObserver`, and
   true per-contact greenlisting when the call routes through the app as **VoIP/PushKit**, which also
   gives iOS a *reliable* background wake — better than CoreBluetooth state restoration).
5. **Two build options (BOM, §2a).** Because the radio is already on the original board, the app adds
   **$0 hardware**. A "without Bluetooth" (radio-free, no-app) build does **not** save money at prototype
   quantity — the cheapest radio-free CircuitPython touch boards are *dearer* than the original board and
   have a worse screen. Keeping the original board is both cheaper **and** app-capable.

**Confidence: 75/100** that this approach ships the viewer MVP successfully. The uncertainty is not the
architecture (well-trodden) but two unverified board facts and the platform limits on iOS call
greenlisting — both scoped in §5.3 and the risks below.

---

## 1. Customer & problem

**Customer:** buyers who already failed with free Screen Time / app blockers and are paying $59+ for
*physical* friction, plus the accountability/family segment (the only validated recurring-revenue tier
in this category, per the ideation doc's competitor research).

**Problem the app solves:** today the box captures no data a user can see, offers only a single manual
countdown, and has no remote/scheduled/accountability behavior. Competitors (Brick, Unpluq, kSafe) win
on exactly these software capabilities. The box hardware already exceeds them; the gap is software.

**What the app must let a user do (in eventual scope):**
- See the box's live state and battery, and their focus history / streaks (the dashboard that justifies
  the price band).
- Start / configure a lock and set **recurring schedules** (e.g. 10pm–7am nightly).
- Manage settings from the phone instead of the tiny on-device UI.
- (Later) accountability: a partner/family member can see sessions and gate the override.
- (Later) greenlist: a whitelisted call/notification can alert-through or release the box.

---

## 2. Requirements grounded in the current firmware

The app is a **second interface onto the existing state machine**, not a rewrite. The integration
seams already exist:

| Need | Existing firmware anchor (`Box-code/lib/…`) |
|---|---|
| Box state to report | `lock_controller.py` state = `idle` / `closed` / `running` / `done`; `deadline`, `set_seconds` |
| Start a lock from the app | `go_running(now)` (same path the on-screen LOCK button calls) |
| Release early from the app | `release_lock()` + `go_done(now)` (same path the override button reaches) |
| Session record to log/stream | the `go_done` transition is the natural emit point (`completed` vs `overridden`, `set_seconds`, override count) |
| Settings to read/write | `lock_settings.py` — `override_presses`, `auto_open`, `sleep_s`, `bright_pct`, persisted in NVM |
| Battery to report | `lock_battery.py` `Battery.read(now)` |
| Wall-clock time (box has none) | phone pushes time over BLE; box has countdown only (no RTC, resets on power loss) |

**Hard constraints (from `project_context.md` / `project_rules.md`):**
- CircuitPython only — no CPython/pip deps; only modules in the CP 10.2.1 runtime + vendored libs.
- `lock_config.py` is the single source of truth for pins/tunables; respect the pin map (avoid
  strapping pins, and GPIO12 battery, 41/42/47/48 touch, 13–18 SD, LCD pins).
- Keep the run loop responsive: **touch is read before the heavier redraw**; BLE servicing must not
  block or reorder that. CPU-frequency scaling must not interrupt an active touch/servo interaction.
- **No host build/test** — validation is on-device only. Deploy = batch-write all files then sync;
  a read-only `D:` means FAT corruption.
- **Deliverables are Word docs.**

---

## 2a. Build options & BOM — connectivity vs. radio-free

The manager asked for two costed build options: **(A) without Bluetooth** and **(B) the original
board**. The decisive fact from the prior board-cost work: the app **needs** the ESP32-S3 radio, and
that radio is *already on the original board* — so the app is **$0 additional hardware**. Going
radio-free is a *different product* (no app is possible) **and** it is not cheaper at prototype quantity.

Both BOMs share the same non-board lines (from `docs/procurement/bom.md`, prototype qty, USD; `(est.)`
lines are engineering estimates, not quotes): 1000 mAh LiPo $7.95, servo $3.49, buttons ×2 $0.99,
enclosure $2.53, wiring/fasteners $0.82 → **$15.78 shared**.

### Option A — Without Bluetooth (radio-free, **app not possible**)

No off-the-shelf radio-free CircuitPython capacitive-touch board beats the original at prototype
quantity. The closest are Waveshare's RP2040/RP2350-Touch boards — but they are **more expensive** and
use a **1.28" round** screen that does not fit the swipe-to-set UI (a UI-moat risk flagged in the board
shortlist).

| Line | Part | Unit $ | Link |
|---|---|---|---|
| Board (radio-free) | Waveshare RP2350-Touch-LCD-1.28 (1.28" **round**, no radio) | ~23.00 | [The Pi Hut](https://thepihut.com/products/rp2350-mcu-board-with-1-28-round-touch-ips-lcd) · [Waveshare](https://www.waveshare.com/rp2350-touch-lcd-1.28.htm) · [CircuitPython](https://circuitpython.org/board/waveshare_rp2350_touch_lcd_1_28/) |
| Shared lines | battery + servo + buttons + enclosure + wiring | 15.78 | see `bom.md` |
| **Total** | | **≈ $38.78** | |

*Caveats:* round 172-equivalent area is smaller and non-rectangular (UI rework + moat risk); a
radio-free build **cannot run the companion app, scheduling, greenlist, accountability, or OTA**. The
alternative RP2040-Touch-LCD-1.28 is ~$28 ([Pi Hut](https://thepihut.com/products/rp2040-microcontroller-with-a-1-28-round-touch-lcd)),
i.e. still dearer. Radio-free only becomes a saving at **custom production volume** (spec a board without
the radio), not at prototype quantity.

### Option B — Original board (ESP32-S3, **app-capable, $0 app hardware**)

| Line | Part | Unit $ | Link |
|---|---|---|---|
| Board (has BLE) | Waveshare ESP32-S3-Touch-LCD-1.47 (172×320 cap touch, onboard LiPo charge + batt-sense) | 18.50 (Pi Hut) – 24.99 (Amazon) | [The Pi Hut ~£14.40/$18–19](https://thepihut.com/products/esp32-s3-1-47-touch-display-dev-board-with-sd-slot) · [Amazon $24.99](https://www.amazon.com/Waveshare-Development-Resolution-Dual-core-Processor/dp/B0F8B8JF74) · [CircuitPython](https://circuitpython.org/board/waveshare_esp32_s3_touch_lcd_1_47/) |
| Shared lines | battery + servo + buttons + enclosure + wiring | 15.78 | see `bom.md` |
| Companion app | uses onboard Wi-Fi/BLE — **no added part** | 0.00 | — |
| **Total** | | **≈ $34.28 (Pi Hut board) – $40.77 (Amazon board)** | |

### Comparison

| | A — Without Bluetooth | B — Original board |
|---|---|---|
| Board cost | ~$23 (RP2350) | $18.50–24.99 (ESP32-S3) |
| BOM total | **~$38.78** | **~$34.28–40.77** |
| Companion app / scheduling / greenlist / accountability / OTA | **impossible** | **enabled, $0 hardware** |
| Screen | 1.28" **round** (UI-moat risk) | 172×320 rectangular (current UI) |
| Redesign | firmware + enclosure rework | none |

**Recommendation:** keep the **original board (Option B)**, sourced from The Pi Hut (~$18.50) rather than
Amazon (~$24.99) for a ~$6/unit no-engineering saving. It is both **cheaper than the radio-free option
and the only one that can run the app**. Ship the app as a *software upgrade on the existing hardware*,
not a new SKU. (If a truly basic no-app SKU is ever wanted, get it by *not shipping the app* on the same
board — not by paying more for a radio-free board.)

---

## 3. Architecture overview

### 3.1 Transport options (decision: start at B1)

Reproduced and sharpened from the ideation doc's Deep-dive A, now as an architecture decision:

| Option | Shape | BOM | Ongoing cost | Effort | Offline | Real time | Monetization fit |
|---|---|---|---|---|---|---|---|
| **B1 (chosen for MVP)** | BLE peripheral ↔ phone app, no internet | $0 | none | medium | yes | from phone | strong (Brick-tier) |
| B2 | Wi-Fi, box hosts local web page | $0 | none | medium | LAN only | NTP | weak ("not a product") |
| B3 (defer) | Wi-Fi + cloud backend, accounts | $0 | **backend forever** | high | no | NTP | strongest (subscription) |

**Decision:** B1 for the MVP and the scheduling/greenlist tiers. B3 only when the accountability
subscription is validated enough to justify a permanent backend, accounts, security surface, and
privacy burden. B2 is skipped — it has B3's "join a network" friction without B3's payoff.

### 3.2 Data-capture seam (build once, feed both sinks)

Per the ideation doc's Deep-dive A recommendation, add **one** "emit a session record" seam at the
`lock_controller.py` `go_done` transition. Two independent sinks consume it:
- **SD log** (`sdioio`/`sdcardio`) — cheap, robust local source-of-truth; survives when the phone is
  absent; no CIRCUITPY/FAT write conflict (external card mounted from `code.py`).
- **BLE stream** — the app reads the same records live and/or backfills on connect.

Building SD logging *first* de-risks the app: the app becomes a *viewer/sync layer* over data that
already exists, rather than the thing responsible for capturing it.

### 3.3 End-to-end flow (MVP)

```
Box (ESP32-S3, CircuitPython)                     Phone (React Native app)
┌──────────────────────────────┐                 ┌───────────────────────────┐
│ code.py run loop             │                 │ BLE scan by service UUID  │
│  1 read touch                │   BLE GATT      │  → connect → discover     │
│  2 controller.update()       │◄──────notify────│  → subscribe (status,     │
│  3 controller.process()      │─────read/write─▶│     history)              │
│  4 service_ble()  ← new, nonblocking            │  → render dashboard       │
│ adafruit_ble Peripheral      │                 │  → write: time sync,      │
│  Service: PhoneBox           │                 │     start/config, settings│
└──────────────────────────────┘                 └───────────────────────────┘
```

---

## 4. Firmware design (box side)

### 4.1 Library choice

Use **`adafruit_ble`** (the supported wrapper) rather than raw `_bleio`. Confirm the board's CP 10.2.1
build includes `_bleio`/`adafruit_ble` before relying on it (see Risks). GATT server, custom services,
and read/write/notify are fully supported on ESP32-S3 native BLE; BLE 5 allows an ATT MTU up to ~247
bytes, comfortably above our per-record size (~30–60 bytes).

### 4.2 New module: `lock_ble.py` (sibling driver, matches existing pattern)

Following the project's per-peripheral driver convention (`lock_servo.py`, `lock_battery.py`, …), add a
single `lock_ble.py` that owns the radio and exposes a **non-blocking `service()`** called once per run
loop, after touch+update, so it never delays touch sampling.

**Proposed GATT service — `PhoneBox` (one custom 128-bit service UUID):**

| Characteristic | Props | Payload (packed bytes / short JSON) | Backed by |
|---|---|---|---|
| `status` | READ, NOTIFY | state enum, remaining_s, set_s, battery_pct, fw_ver | `controller.state`, `deadline`, `battery.read()` |
| `command` | WRITE | opcode + args: `start(duration)`, `unlock`, `lock`, `set_schedule(...)` | calls `go_running` / `release_lock`+`go_done` / `go_closed` |
| `history` | READ, NOTIFY | session records, newest-first, chunked | the `go_done` emit seam / SD log |
| `settings` | READ, WRITE | override_presses, auto_open, sleep_s, bright_pct | `lock_settings.Settings` (+ `save()`) |
| `time_sync` | WRITE | epoch seconds from phone | sets box wall-clock for dated history/schedules |

Notes:
- **`command` is policy-gated.** A BLE `unlock` is a *new early-release path*; rate-limit it and keep
  the physical press-count override as the true emergency path (mirrors the ideation doc's integrity
  caveat for greenlist). Default new remote paths to *alert-through*, not auto-unlock.
- **Pairing/bonding + a pairing screen** on the box (`lock_ui.py` gets one new view) so a random phone
  can't drive the latch. Bond so reconnect is silent.
- **Advertise the service UUID** so iOS background scanning can find it (iOS requires scanning by
  service UUID in the background).

### 4.3 Integration points (small, additive)

1. `code.py` run loop: add `ble.service()` as a new step **after** touch read + `controller.update()` +
   `controller.process()` — preserving the documented ordering rule.
2. `lock_controller.py` `go_done`: emit a session record (the one seam) → SD sink + BLE `history`
   notify.
3. `lock_controller.py`: a thin command dispatcher that maps BLE opcodes onto **existing** transitions
   (no new lock mechanism — reuse `go_running`, `release_lock`, `go_closed`).
4. `lock_settings.py`: already has `save()`; BLE `settings` writes call the same `adjust`/`save` path,
   and bump `_MAGIC` if the NVM layout changes.
5. `lock_config.py`: add BLE tunables (device name, service UUID, advertise interval, rate-limit)
   there, not scattered.

**Power note:** the radio adds current draw; gate advertising/connection by policy (e.g. advertise only
when idle/closed or when the screen is awake) so battery life and the brownout budget are respected —
the servo already must be powered from VBAT/VBUS with a bulk cap, and BLE TX peaks add to that budget.

---

## 5. App design (phone side)

### 5.1 Framework selection

**Recommendation: React Native (Expo dev build) + `react-native-ble-plx`.**

| Option | Pros | Cons | Verdict |
|---|---|---|---|
| **React Native + `react-native-ble-plx`** | One codebase iOS+Android; library is mature and covers exactly connect/read/write/notify + background modes + device filtering; largest RN BLE community; Expo config plugin exists | Background BLE + native notification access need native modules/config; RN BLE slightly less rock-solid than Flutter's | **Chosen** — best effort/coverage fit for this device's simple GATT |
| Flutter + `flutter_blue_plus` | BLE plugins generally *more stable*; single codebase; good perf | Team must be Dart-fluent; greenlist still needs platform channels to native | Strong alternative; pick if the team already does Flutter |
| Native (Swift + Kotlin) | Best BLE control & background reliability; required anyway for greenlist | ~2× the work (two apps); slowest to MVP | Only if background BLE reliability becomes the dominant risk |

Rationale: the box exposes a handful of characteristics with the canonical *connect → read → write →
subscribe* interaction — the case cross-platform BLE libraries handle well. Custom/proprietary GATT and
heavy background work are what push teams to native; our GATT is simple, and the one background-heavy
feature (greenlist) needs native code in every framework, so it doesn't justify making the *whole* app
native. Start cross-platform; drop to a native module only where the platform forces it.

### 5.1a Recommended mobile stack (concrete)

A full, opinionated stack for building the app. Everything below is a single cross-platform (iOS +
Android) codebase; the two native call/notification pieces are thin modules behind a JS interface.

| Layer | Recommendation | Package(s) | Why |
|---|---|---|---|
| Language | **TypeScript** | — | type-safe payload codecs; largest hiring pool |
| Framework | **React Native via Expo** (dev client + prebuild) | [`expo`](https://docs.expo.dev/), `expo-dev-client` | one codebase; config plugins let us add native BLE/CallKit libs; EAS build + OTA |
| BLE | **`react-native-ble-plx`** | [`react-native-ble-plx`](https://github.com/dotintent/react-native-ble-plx) + [`@config-plugins/react-native-ble-plx`](https://www.npmjs.com/package/@config-plugins/react-native-ble-plx) | mature; connect/read/write/notify + background modes; the box's exact pattern |
| App state | **Zustand** | [`zustand`](https://github.com/pmndrs/zustand) | minimal; fine for this app's scope |
| Fast KV / cache | **MMKV** | [`react-native-mmkv`](https://github.com/mrousavy/react-native-mmkv) | ~30× AsyncStorage; cache last-known status so the dashboard works before the box is in range |
| Session history (relational) | **SQLite (JSI)** | [`op-sqlite`](https://github.com/OP-Engineering/op-sqlite) (or [`expo-sqlite`](https://docs.expo.dev/versions/latest/sdk/sqlite/)) | store/query session records + streaks offline |
| Secrets (only if cloud tier added later) | **Expo SecureStore** | [`expo-secure-store`](https://docs.expo.dev/versions/latest/sdk/securestore/) | tokens if the B3 backend ever ships |
| iOS greenlist calls (Tier 2) | **CallKit + PushKit VoIP** | [`react-native-callkeep`](https://github.com/react-native-webrtc/react-native-callkeep) + [`react-native-voip-push-notification`](https://github.com/react-native-webrtc/react-native-voip-push-notification), or the newer [`expo-callkit-telecom`](https://github.com/mfairley/expo-callkit-telecom) | report the VoIP call to CallKit; PushKit wakes the app in background to signal the box |
| Android greenlist | **NotificationListener + ConnectionService** | [`react-native-android-notification-listener`](https://github.com/leandrosimoes/react-native-android-notification-listener) + `react-native-callkeep` | read/filter notifications by contact/app, then signal the box |
| Build / CI / distribution | **EAS** | [EAS Build + EAS Update](https://docs.expo.dev/eas/) | cloud iOS/Android builds; OTA JS updates; TestFlight / Play internal testing |
| Testing | **Jest + RN Testing Library**; **Maestro** E2E; on-device BLE manual | [`@testing-library/react-native`](https://callstack.github.io/react-native-testing-library/), [Maestro](https://maestro.mobile.dev/) | unit-test the codec/state logic; BLE + call paths verified on real hardware (§7) |

**Decision: React Native + Expo + TypeScript**, on the assumption of a JS/TS team (or hiring for one).

**The one factor that flips this — team language expertise:**
- **Already a Dart team →** use **Flutter + [`flutter_blue_plus`](https://pub.dev/packages/flutter_blue_plus)** instead; BLE is a touch more stable, and the greenlist still drops to platform channels for CallKit/PushKit/NotificationListener (same native work).
- **iOS is the overwhelming priority *and* you have Swift/Kotlin staff, or the VoIP call experience becomes the core product →** go **fully native (SwiftUI + Jetpack Compose)** for maximum control of the CallKit/PushKit UX. Cost is ~2× (two codebases) and the viewer MVP ships slower; only take this if the native call surface, not the dashboard, is the product.

Because most of the app (viewer, dashboard, settings, scheduling UI) is ordinary app surface and only the
call/notification hooks are native, **cross-platform is the right default**; going full-native pays for
control we don't need on the 90% that is standard UI.

### 5.2 App architecture

- **BLE service layer** (`react-native-ble-plx`): scan-by-service-UUID → connect → bond → characteristic
  read/write + notify subscriptions; auto-reconnect; a small typed codec for the packed payloads.
- **State/store**: cache last-known status + history locally (e.g. SQLite/MMKV) so the dashboard works
  before the box is in range; reconcile on connect.
- **UI**: dashboard (streaks/history), live status, lock/schedule controls, settings mirror, pairing
  flow. Use the generic UI baseline (no project design-system configured yet).
- **Time**: phone writes `time_sync` on every connect so the box has real time for dated history and
  schedules.

### 5.3 Greenlisting calls — iOS-first (per manager direction)

The prioritized behavior: **a whitelisted contact's phone call should reach through the locked box**
(alert-through by default; optional auto-unlock). Manager direction is to lead with **iOS**, focused on
**calls**. This is a platform problem, not a framework one, and iOS has a specific, honest boundary that
shapes the design.

**What iOS does and does not allow for calls (verified):**

| Capability | iOS reality | Use for greenlist |
|---|---|---|
| Detect that *a* call is ringing (no caller ID) | `CXCallObserver` reports call state (incoming/connected/ended) while the app is *running*, foreground or background -- **not while iOS has it suspended, which corrects the original "even in background" claim here** (see the correction note in `ios-background-wake-and-call-notification-architecture.md` §4.1; the app polls `CXCallObserver.calls` on each BLE wake instead). It does **not** expose the caller's number (privacy) | "Someone is calling" **alert-through** — buzz/screen on the box, no identity filter |
| Identify a specific incoming **cellular** caller | **Not available** to third-party apps. `CallDirectory`/`Live Caller ID Lookup` extensions only feed labels to Apple's Phone app; they are never told about a live call | ❌ cannot per-contact filter a normal cellular call |
| True per-contact greenlist | **Route the call through the app as VoIP** (`PushKit` + `CallKit`): the app places/receives the call, so it knows the caller and can act | ✅ reliable per-contact greenlist **and** a reliable background wake |
| Background wake to reach the box | `PushKit` VoIP push wakes the app reliably; far more dependable than CoreBluetooth **state restoration**, which is known to fire inconsistently | ✅ use PushKit as the trigger, then connect BLE to signal the box |

**iOS design (recommended):**
1. **Tier 1 — any-call alert-through (ship first):** while the box is locked, `CXCallObserver` detects an
   incoming call and the app signals the box over BLE to **alert-through** (screen + buzz), *without*
   knowing who is calling. Simple, reliable, no backend. Keeps the focus contract (box stays shut).
2. **Tier 2 — true per-contact greenlist via VoIP:** the greenlisted contact calls **through the app**
   (a VoIP "priority line", or a relay such as Twilio that rings the app). `PushKit` wakes the app in
   the background → the app confirms the caller → signals the box to alert-through or (opt-in)
   auto-unlock via `release_lock()`. This is the only reliable way to greenlist a *specific* contact on
   iOS, and PushKit doubles as the dependable background trigger BLE alone lacks.
3. **BLE background** still needs `UIBackgroundModes: bluetooth-central` + scan-by-service-UUID; but with
   PushKit as the primary wake, we do **not** depend on the flaky CoreBluetooth state restoration for the
   call path.

**Honesty for product/marketing:** iOS can reliably do (a) "your box lights up when *anyone* calls" and
(b) "greenlist a specific person **if their call comes through the app**." It **cannot** silently
identify an arbitrary normal cellular call by contact. Do not promise per-contact filtering of ordinary
cellular calls on iOS.

**Android (also supported, easier):** `CXCallObserver`'s equivalent plus full notification access via
`NotificationListenerService` (a native module) means Android can greenlist by **contact or app**
directly, including non-call notifications. Build it after the iOS call path, reusing the same box-side
BLE command and alert-through overlay.

**Native code either way:** call observation (`CallKit`/`PushKit` on iOS, `NotificationListenerService`
on Android) lives in **native modules** behind a small JS interface — this is true in React Native,
Flutter, or native, so it does not change the framework choice in §5.1. The box side is unchanged: a BLE
command reaches the existing `release_lock()` path; default to alert-through, rate-limit, keep the
physical press-count override as the true emergency path.

---

## 6. MVP scope & phased roadmap

Sequenced to de-risk (cheap/local first, expensive/liability last):

1. **Firmware SD logging + on-device stats view** — captures real habit data for ~$3, firmware only,
   no app dependency, no FAT-corruption risk. *(This is the data foundation; do it first.)*
2. **MVP app — BLE read-only viewer**: pair, live `status`, `history` dashboard/streaks, `settings`
   read. This alone justifies the $59–89 band and de-risks all BLE plumbing. *(Chosen MVP.)*
3. **Write path**: app-initiated start/lock + `time_sync`; then **scheduled/recurring locks** and
   **multiple profiles** (high value once connectivity + time exist).
4. **Accountability / family mode** — turns on the validated subscription tier; may pull in B3 cloud.
5. **Greenlist calls** — layered on the app; **iOS-first** (Tier 1 any-call alert-through via
   `CXCallObserver`; Tier 2 per-contact via VoIP/PushKit), then Android. Alert-through by default.
6. **OTA firmware updates** over BLE — supports ongoing feature delivery.

---

## 6a. How hard is this if you don't code much?

Honest answer: **the box (firmware) side is approachable; the app side is real mobile-app development.**
Difficulty is not uniform — it climbs steeply from left to right below. A light coder can ship genuine,
sellable value **without building an app at all**, and hand the app to a freelancer using this RFC as the
brief.

| Component | Difficulty for a light coder | DIY-with-AI realistic? | If hired out (rough, US) |
|---|---|---|---|
| **Firmware SD logging + on-device stats view** | **Medium** — CircuitPython you already own; the friction is on-device debugging, not the language | **Yes**, with AI help + patience | days of a freelancer |
| **Viewer MVP app** (RN + BLE) | **Hard** — Expo/native builds, BLE pairing, Apple/Google developer accounts + store submission | **Partly** — AI scaffolds the UI, but BLE + device builds + store review trip up non-coders | **~$5k–20k, ~5–10 weeks** (simple MVP) |
| **Scheduling / profiles** | Medium–hard (app + firmware) | incremental once the app exists | additive |
| **iOS greenlist calls** (CallKit/PushKit/VoIP) | **Very hard** — native iOS, background, VoIP; **not a non-coder task** | **No** | material extra $$$; needs a real iOS dev |
| **Accountability / cloud (B3)** | **Very hard** — backend, accounts, security, hosting | **No** | largest; plus ongoing hosting |

**Recommended path if you don't code much:**
1. **Do the no-app win yourself first.** Ship **firmware SD-logging + an on-device stats view**. It gives
   real habit data and a premium "it tracks your focus" story for ~$3, in pure CircuitPython you already
   own — **no app, no app store, no BLE**. Highest certainty, least code, and it's the data foundation the
   app later reads (§3.2). With an AI coding assistant this is a realistic solo project.
2. **Hire out (or AI-assist) the viewer MVP.** Budget **~$5k–20k / ~5–10 weeks** for a freelancer to
   build the React Native viewer against the GATT service in §4.2. **This RFC is the brief** — it already
   specifies the stack (§5.1a), the characteristics, and the validation plan, which is exactly what keeps
   a freelance quote tight.
3. **Treat iOS greenlist calls and accountability/cloud as later, developer-led phases** — budget a real
   iOS developer for the call/VoIP work; don't attempt it solo.

**Bottom line:** the connectivity vision is a genuine software product, and the non-coder difficulty
spikes at the *app*, not the box. You can deliver real value (SD logging + on-device stats) with light
coding and no app, then bring in a developer for the app with this document as the specification.

## 7. Validation plan (on-device — no host tests exist)

| User scenario | Expected outcome | Validation method |
|---|---|---|
| App scans and finds box | Box advertises `PhoneBox` service UUID; appears in app | On-device: run app + box, observe scan list |
| Pair/bond | One-time pairing screen on box; silent reconnect after | On-device: pair, kill app, reopen, confirm auto-reconnect |
| Live status | `status` notify updates remaining_s/battery as countdown runs | On-device: start lock, watch app track the on-screen timer |
| Start lock from app | `command:start` drives `go_running`; servo latches | On-device: observe latch + on-screen state = running |
| Early unlock from app | `command:unlock` (policy-gated) reaches `release_lock`/`go_done` | On-device: confirm latch releases; confirm rate-limit blocks spam |
| Session history | A completed/overridden session appears in app + SD log | On-device: finish a session, read app record vs SD CSV |
| Settings round-trip | App write updates NVM; persists across reboot | On-device: change override count in app, reboot box, confirm |
| Time sync | Box gets real time; dated history correct | On-device: connect, check a record's timestamp |
| Run-loop responsiveness | Touch/servo stay snappy with BLE active | On-device: swipe/latch while connected; no stutter |
| Power | Advertising/connection doesn't cause brownout | On-device: run on battery with servo cycling + BLE connected |

**No host build/test suite exists; every row above requires a physical board run.** State plainly in
any implementation PR when a change is untested because no board run was performed.

---

## 8. Risks & mitigations

| Risk | Sev | Mitigation |
|---|---|---|
| **CP 10.2.1 build may lack `_bleio`/`adafruit_ble` (or `sdioio`/`sdcardio`)** | High | Verify on-device before committing to BLE; if absent, this gates the whole track. First spike = import + advertise a trivial service on the real board. |
| **iOS CoreBluetooth state restoration is unreliable for background wake** | High | Use **PushKit VoIP** as the background trigger for the greenlist call path (dependable), not state restoration; keep a foreground-connected UX for the viewer. |
| **iOS can't identify an arbitrary cellular caller by contact** | High | Ship Tier 1 any-call alert-through (`CXCallObserver`, no identity); do true per-contact greenlist only via VoIP/PushKit (call routed through the app); never promise per-contact filtering of ordinary cellular calls on iOS. |
| **BLE `unlock` is a new bypass of the focus contract** | Med | Rate-limit; default alert-through not auto-unlock; keep physical press-count as the true emergency path. |
| **Radio power draw / brownout budget** | Med | Policy-gate advertising; bulk cap; test on battery with servo cycling; this is why cost-down aimed to *remove* the radio — connectivity is a deliberate opposite bet. |
| **BLE servicing stalls the run loop / reorders touch** | Med | `ble.service()` is non-blocking and runs *after* touch+update; never inside a touch/servo interaction. |
| **Pairing/security — a stranger's phone driving the latch** | Med | Require bonding + on-box pairing confirmation; gate `command` on a bonded connection. |
| **Two-tier effort creep (app becomes native anyway)** | Low | Keep RN core; isolate native code to the greenlist module behind a clean interface. |
| **Cross-platform BLE quirks vs. custom GATT** | Low | GATT is deliberately simple (5 characteristics, standard props); stays within library sweet spot. |

---

## 8a. Architecture analysis

This project has no standalone architecture document; `fraim/personalized-employee/context/project_context.md`
and `project_rules.md` are the de-facto architecture record. The design is checked against them:

**Patterns correctly followed**
- **Per-peripheral driver module** — `lock_ble.py` mirrors `lock_servo.py`/`lock_battery.py` as a
  sibling driver; the radio is owned by one module.
- **`lock_config.py` as single source of truth** — all BLE tunables (name, UUID, intervals,
  rate-limit) live there, not scattered.
- **State machine reuse** — BLE commands map onto existing `go_running`/`release_lock`/`go_done`; no new
  lock mechanism is introduced.
- **Versioned NVM persistence** — settings writes reuse `lock_settings.Settings.save()` and the magic-
  byte bump convention.
- **Run-loop ordering rule** — `ble.service()` is placed after touch read + update, non-blocking.
- **On-device-only validation** — the validation plan is entirely on-device; no fabricated host tests.
- **Word-doc deliverable** — RFC delivered as `.docx` via `md_to_docx.py`.

**Patterns missing from architecture (design introduces; needs a doc decision)**
- **Radio/connectivity is explicitly documented as unused** in project context. This design
  deliberately *adds* it — a stated counter-bet against the cost-down priority. If pursued, project
  context should be updated to record connectivity as an intentional up-market feature, not an
  oversight. *(User/manager decision required.)*
- **A new remote early-release path** (BLE `unlock`) and **pairing/bonding + security model** have no
  precedent in the current firmware; they need to be recorded as architecture once accepted.
- **SD session-logging** and a **wall-clock time source** (phone-supplied) are new subsystems not in
  the current architecture.
- **App-side native-module boundary** (iOS `CallKit`/`PushKit`, Android `NotificationListenerService`)
  for the greenlist call path — isolated behind a small JS interface; no box-firmware architecture
  impact, but a new component to record on the phone side once accepted.

**Patterns incorrectly followed**
- None identified. The design stays within the documented pin-map, module, config, and NVM conventions,
  and preserves the seven fixed product functions (it adds a second interface onto them rather than
  changing them).

## 9. Confidence level

**75/100** for shipping the **viewer MVP** on this approach. The architecture is well-trodden and every
box-side integration point already exists. The 25 points of doubt are: (a) two unverified board facts
(`_bleio`/`sdioio` in this CP build) that a one-hour on-device spike resolves, and (b) the genuinely
hard, platform-imposed background-BLE/greenlist behavior on iOS — which the MVP deliberately avoids.

---

## 10. Recommended immediate next steps

1. **Board capability spike (blocking):** on the real board, confirm `import _bleio` / `adafruit_ble`
   and `sdioio`/`sdcardio`, then advertise a trivial `PhoneBox` service and connect from a generic BLE
   scanner app (nRF Connect). One session; resolves the top risk.
2. **Firmware SD-logging seam:** add the `go_done` session-record emit + SD sink + on-device stats view.
3. **Stand up the recommended stack** (React Native + Expo + TypeScript, §5.1a — unless the team's
   language expertise flips it) and build the BLE service layer against the trivial service from step 1.
4. **Build the viewer MVP**, validate against the table in §7, then proceed down the roadmap.

---

## Sources

- Board / SD slot & BLE: [Waveshare ESP32-S3-Touch-LCD-1.47](https://www.waveshare.com/esp32-s3-touch-lcd-1.47.htm)
- CircuitPython BLE peripheral/GATT: [`_bleio` docs](https://docs.circuitpython.org/en/latest/shared-bindings/_bleio/index.html), [Adafruit `adafruit_ble` library](https://docs.circuitpython.org/projects/ble/en/latest/)
- CircuitPython SD interfaces: [`sdioio`](https://docs.circuitpython.org/en/latest/shared-bindings/sdioio/index.html), [`sdcardio`](https://docs.circuitpython.org/en/latest/shared-bindings/sdcardio/)
- RN BLE library: [`react-native-ble-plx` (dotintent)](https://github.com/dotintent/react-native-ble-plx), [Expo config plugin](https://www.npmjs.com/package/@config-plugins/react-native-ble-plx), [background mode (iOS) wiki](https://github.com/dotintent/react-native-ble-plx/wiki/Background-mode-(iOS))
- Cross-platform vs native BLE: [Novelbits — native vs cross-platform BLE](https://novelbits.io/native-vs-cross-platform-bluetooth-low-energy-mobile-app-platforms/), [LogRocket — comparing RN BLE libraries](https://blog.logrocket.com/comparing-react-native-ble-libraries/)
- Flutter BLE: [`flutter_blue_plus`](https://pub.dev/packages/flutter_blue_plus)
- iOS background BLE: [Apple — Core Bluetooth background processing](https://developer.apple.com/library/archive/documentation/NetworkingInternetWeb/Conceptual/CoreBluetooth_concepts/CoreBluetoothBackgroundProcessingForIOSApps/PerformingTasksWhileYourAppIsInTheBackground.html), [Punch Through — leveraging background Bluetooth](https://punchthrough.com/leveraging-background-bluetooth-for-a-great-user-experience/)
- iOS call greenlisting: [Apple — `CXCallObserver`](https://developer.apple.com/documentation/callkit/cxcallobserver), [Apple — Identifying and blocking calls](https://developer.apple.com/documentation/callkit/identifying-and-blocking-calls), [Apple — PushKit / VoIP](https://developer.apple.com/documentation/pushkit), [VideoSDK — CallKit VoIP guide](https://videosdk.live/developer-hub/voip/callkit)
- Android notification access (greenlist): [NotificationListenerService](https://developer.android.com/reference/android/service/notification/NotificationListenerService)
- BOM — original board: [The Pi Hut ESP32-S3-Touch-LCD-1.47](https://thepihut.com/products/esp32-s3-1-47-touch-display-dev-board-with-sd-slot), [Amazon B0F8B8JF74](https://www.amazon.com/Waveshare-Development-Resolution-Dual-core-Processor/dp/B0F8B8JF74), [CircuitPython board](https://circuitpython.org/board/waveshare_esp32_s3_touch_lcd_1_47/)
- BOM — radio-free option: [Waveshare RP2350-Touch-LCD-1.28 (Pi Hut)](https://thepihut.com/products/rp2350-mcu-board-with-1-28-round-touch-ips-lcd), [RP2040-Touch-LCD-1.28 (Pi Hut)](https://thepihut.com/products/rp2040-microcontroller-with-a-1-28-round-touch-lcd), [CircuitPython RP2350 board](https://circuitpython.org/board/waveshare_rp2350_touch_lcd_1_28/)
- App dev cost ranges (rough): [Mobiloud — cost to hire a React Native developer](https://www.mobiloud.com/blog/cost-to-hire-react-native-developer), [Moveo — MVP development cost 2026](https://www.moveoapps.com/blog/mvp-development-cost/)
- BOM detail & board shortlist: `docs/procurement/bom.md`, `docs/procurement/board-cost-reduction/02-supplier-longlist-and-shortlist-2026-07-19.md`
- Upstream feature context: `docs/brainstorming/phone-box-feature-ideation-2026-07-20.md`
