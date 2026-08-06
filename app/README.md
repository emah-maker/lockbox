# Phone Box companion app (iOS-first)

React Native + Expo + TypeScript app (the stack the approved RFC selected, §5.1a).
It connects to the box over BLE to show **live status + focus stats**, and it
detects **incoming calls** so the box can light up its screen for important calls
while it stays locked.

> **Status: source scaffold, not yet built or run.** It was authored on Windows
> with no macOS/Xcode/iOS device and no box available, so **nothing here has been
> compiled, run, or tested on hardware.** The pure logic (`src/stats`, protocol
> parsers) has Jest tests; everything touching BLE, the native call module, and
> the box is unverified and needs a Mac + device to validate. Treat this as the
> developer starting point the RFC's §6a "hire-out the viewer MVP" step calls for.

## What it does (MVP)

- **Focus dashboard** (`src/screens/DashboardScreen.tsx`) — connection, live box
  status/battery, and the same focus aggregates the box shows on-device
  (total focus time, sessions, completed, streak, longest).
- **Call alert-through** (`src/calls/CallMonitor.ts` + `modules/call-observer/`) —
  while the box is locked, an incoming call makes the box light up its screen
  (over BLE). The box never unlocks — this preserves the focus contract.

## Architecture

```
Phone (this app)                         Box (CircuitPython, Box-code/)
─────────────────                        ─────────────────────────────
CallObserver (native, CXCallObserver) ─┐
  onCall: incoming                     │
CallMonitor ───────────────────────────┼─ alert("<nonce>|Call") ─▶ lock_ble.py
PhoneBoxClient (react-native-ble-plx) ──┤◀─ status / stats (notify) ─ lock_controller
  scan(SERVICE_UUID)→connect→subscribe  │   command / settings / time  (go_running…)
useStore (zustand)                      │
DashboardScreen ────────────────────────┘
```

The BLE wire contract lives in **`src/ble/protocol.ts`** and is shared verbatim
with the firmware **`Box-code/lib/lock_config.py`** (UUIDs) and
**`lock_ble.py` / `lock_controller.py`** (payloads). Change one side → change both.

### The honest iOS call boundary (verified in the RFC)
`CXCallObserver` tells the app *that a call is ringing* even in the background, but
**not who is calling** (Apple privacy). So the MVP alerts on **any** incoming call
("Tier 1 alert-through"). True **per-contact** greenlisting needs the caller to
reach you *through the app* as a VoIP call (PushKit + CallKit) — that is a later
phase; `CallMonitor.resolveLabel()` is where that identity slots in. Do not promise
per-contact filtering of ordinary cellular calls on iOS.

## Build & run (requires macOS + Xcode + a paid Apple Developer account)

BLE and the native call module **do not work in Expo Go** — you need a dev client.

```bash
cd app
npm install
npx expo prebuild --clean          # generates ios/ and links the local native module
npx expo run:ios --device          # build onto a real iPhone (BLE needs hardware)
npm test                           # jest: pure stats + protocol parsers
npm run typecheck                  # tsc --noEmit
```

Then: power on the box, open the app, tap **Connect** (grant Bluetooth), start a
lock, and place a call to the phone while locked to see the box light up.

## What's left (roadmap, from the RFC)

- **Pairing/bonding UI** + gate box `command` on a bonded connection (security).
- **Write path**: start/lock from the app, recurring **schedules**, profiles.
- **Full history sync** over BLE (today the box exposes aggregate stats only;
  add chunked `history` for per-session detail + charts).
- **Tier 2 per-contact greenlist** via VoIP/PushKit (real iOS dev; not a
  non-coder task).
- **Android** (NotificationListenerService can filter by contact/app directly).

## Files

| Path | Purpose |
|---|---|
| `src/ble/protocol.ts` | UUIDs + payload codecs (matches firmware) |
| `src/ble/PhoneBoxClient.ts` | ble-plx scan/connect/subscribe/read/write |
| `modules/call-observer/` | native iOS CXCallObserver Expo module (Swift) + JS |
| `src/calls/CallMonitor.ts` | incoming call → alert-through logic |
| `src/store/useStore.ts` | zustand app state; owns client + monitor |
| `src/stats/stats.ts` | pure focus-stat helpers (tested) |
| `src/screens/DashboardScreen.tsx` | the viewer MVP UI |
| `app.json` | iOS background-BLE modes + permissions + ble-plx plugin |
