# Phone Box — Development Roadmap

> **DRAFT — Requires Human Approval**
> Date: 2026-07-24
> Owner: light-coder / solo maintainer. Planning artifact only — no source was changed to produce this.

**Where the product stands today.** The Phone Box is a CircuitPython touchscreen phone-lock box running on a Waveshare ESP32-S3-Touch-LCD-1.47 (board now **locked** — kept for its onboard LiPo charging and its BLE radio), paired with an unbuilt React Native + Expo companion app. The firmware is surprisingly complete: SD session logging, an on-device "Focus" stats view, a full 6-characteristic BLE GATT peripheral, controller command hooks, an incoming-call overlay, and a MAX17048 fuel-gauge driver are all written and wired into the run loop. The catch is that almost none of it is *verified*, and the whole BLE feature set silently self-disables because the `adafruit_ble` library is not vendored into the board. The app is mostly real (not mocks) but has never been compiled or run, and its whole on-device path is blocked behind an Apple toolchain the owner does not currently have. In short: **the code is far ahead of the verification.** This roadmap orders work to de-risk cheaply — confirm what already exists on local hardware before spending on the app track — and runs a parallel, low-risk cost-down effort that needs no new code.

---

## 1. Current-State Snapshot

### Firmware (`firmware/`)

| Feature | State | Notes |
|---|---|---|
| Timer / servo lock / physical override / power mgmt / NVM settings / brownout-safe boot | **Done (7 fixed functions)** | Must be preserved by any cost cut. |
| SD session logging (`lock_log.py`) + on-device Focus stats | **Built, unverified** | Wired into run loop; self-disables to "NO SD CARD" without a writable microSD + `sdioio` in the CP build. |
| BLE GATT peripheral (`lock_ble.py`, 6 chars) + command hooks + call overlay + time-sync | **Built, silently disabled** | ImportError on `adafruit_ble`/`_bleio` → whole peripheral early-returns `enabled=False`. One missing dependency kills all four features. |
| BLE security (pairing / bonding / encryption) | **Not started** | All 6 characteristics open read/write. Only mitigations: remote unlock off by default + 1s rate-limit. |
| MAX17048 fuel gauge (`max17048.py` + `lock_battery.py`) | **Built, unverified** | External Adafruit #5580 breakout on I2C 0x36; reads 0% / "unavailable" if not physically wired. Accuracy *upgrade*, not required. |
| `time_sync` UI consumer | **Dead end** | Value is stored but never displayed. Minor. |
| Host test suite | **None** | All firmware verification is on-device only. |

### Companion App (`app/`, React Native + Expo + TS)

| Feature | State | Notes |
|---|---|---|
| Protocol codec + focus-stats logic | **Real + unit-tested** | Runs on Windows via `npm test`. |
| BLE client (`PhoneBoxClient.ts`) — scan/connect/notify/read/write | **Real, never run** | Needs a real board advertising the service UUID. |
| zustand store, viewer dashboard | **Real, read-only** | `startLock` / `writeSettings` exist in store but **no UI wires them**. |
| Native iOS `CallObserverModule.swift` | **Real, won't compile** | **No `.podspec`** → autolinking/prebuild fails. iOS-only, no Android. |
| Tier-1 any-call "alert-through" | **Done (logic)** | Never run on device. |
| Tier-2 per-contact greenlist | **Stub** | `resolveLabel` returns `'Call'`; CXCallObserver cannot supply caller ID by design — needs VoIP/PushKit + a real iOS dev. |
| Session-history sync | **Not started (both sides)** | Box exposes aggregate stats only; no chunked per-session `history` characteristic exists on box or app. |
| Accountability / cloud tier | **Not started (greenfield)** | No backend, auth, or sync anywhere. |
| Build environment | **Windows-only blocker** | Only `npm test` + `npm run typecheck` run locally. On-device needs macOS + Xcode + paid Apple Dev + iPhone; no `eas.json` configured. |

### Cost / BOM

- As-built prototype ≈ **$43.77** retail. No-redesign cost-down floor ≈ **$28/unit**.
- Board **locked** to the Waveshare ESP32-S3-Touch-LCD-1.47.

---

## 2. Phased Roadmap

Ordered to de-risk: cheap, local, verifiable work first; expensive Apple-toolchain and greenfield work last. The cost-down track (Phase 5) runs in parallel and depends on nothing.

### Phase 1 — Verify SD logging + on-device Focus stats
- **Goal:** Confirm the already-built logging + stats path actually writes and reads on real hardware.
- **Builds on / depends on:** Existing `lock_log.py`; nothing upstream.
- **Effort & cost:** ~0.5 day. ~$8–12 for a microSD card (may already be on hand).
- **Current blocker:** Need an inserted, **writable** microSD card **and** `sdioio` present in the board's CircuitPython 10.2.1 build. Without both, the feature silently degrades to "NO SD CARD" and you'll never know it works. (Blocker **B3**.)

### Phase 2 — Bring the BLE stack online (THE gate)
- **Goal:** Get `lock_ble.py` to initialize with `enabled=True`, unlocking BLE + command hooks + time-sync + call overlay in one move.
- **Builds on / depends on:** Nothing upstream, but gates almost everything downstream.
- **Effort & cost:** ~0.5–1 day. $0 BOM (radio already on board).
- **Current blocker:** `adafruit_ble`/`_bleio` is **not vendored** in `firmware/lib/` and its presence in the board's CP 10.2.1 build is unconfirmed. On ImportError the whole peripheral early-returns disabled. **This single blocker kills four firmware features at once** — highest-leverage fix in the project. (Blocker **B1**.)

### Phase 3 — Verify MAX17048 battery gauge (optional accuracy upgrade)
- **Goal:** Confirm accurate battery % reporting via the fuel gauge.
- **Builds on / depends on:** Independent; nice-to-have, not on the critical path.
- **Effort & cost:** ~0.5 day. **+$2–6/unit** — this is an *upgrade*, not a cost cut. Basic battery display (one of the 7 fixed functions) does not require it.
- **Current blocker:** The Adafruit #5580 breakout must be physically wired to I2C 0x36; unwired it degrades to "unavailable" (reads 0%). (Blocker **B6**.)

### Phase 4 — Lock in the app's local verification baseline
- **Goal:** Keep the codec / focus-stats / store logic green as a regression net before any device work.
- **Builds on / depends on:** Existing unit tests.
- **Effort & cost:** ~0.25 day. $0 — runs on the current Windows machine.
- **Current blocker:** **None — ready to build.** `npm test` + `npm run typecheck` already run on Windows.

### Phase 5 — Execute the no-redesign cost-down (parallel track)
- **Goal:** Drive as-built ~$43.77 toward the ~$28/unit floor without touching the 7 fixed functions.
- **Builds on / depends on:** BOM ground truth; independent of all app/firmware verification.
- **Effort & cost:** ~1 day sourcing + one print-profile tweak + one minor UI change. **Net savings target ≈ $15/unit.**

| Lever | Saving | Redesign? |
|---|---|---|
| Buy same board from The Pi Hut (~$18.50 vs $24.99 Amazon) | ~$6.49 | No |
| Bulk-source estimated lines | ~$6 | No |
| Optimize the print | ~$1.20 | No |
| Move lock button on-screen (drop a switch + cutout; **keep physical override**) | one switch + cutout | Minor firmware/UI |
| Battery 2000mAh → 1000mAh (~$3.50) | ~$7 | Only if measured runtime allows |

- **Current blocker:** **None to start** on sourcing/print levers. The 1000mAh battery swap is gated on measured runtime data (produce it during Phase 1/3 bench testing).

### Phase 6 — BLE read-only Viewer MVP (app track begins)
- **Goal:** Ship the RFC's Step-2 MVP — app scans, connects, and displays live stats from the box.
- **Builds on / depends on:** Phase 2 (BLE live), Phase 4 (green tests). Matches approved RFC Step 2.
- **Effort & cost:** If hired out, **≈ $5k–20k / 5–10 weeks**. DIY is cheaper but gated on tooling below.
- **Current blocker:** Windows-only environment cannot build iOS. Needs **macOS + Xcode + paid Apple Developer account + physical iPhone** (**B2**), the **missing `.podspec`** fixed so the native module autolinks (**B4**), and a real board advertising the service UUID (**B1**, cleared in Phase 2). Workaround for the macOS gap: configure **`eas.json`** for EAS cloud-macOS builds (**B9**).

### Phase 7 — Add session-history sync (both sides)
- **Goal:** Give the viewer a real per-session history dashboard, not just aggregates.
- **Builds on / depends on:** Phase 2 + Phase 6; Phase 1 (SD is the history data source).
- **Effort & cost:** ~1–2 weeks (firmware chunked characteristic + app consumer + tests).
- **Current blocker:** No chunked per-session **`history` characteristic exists on either side** — must be designed and added to the box GATT table and the app client. (Blocker **B7**.)

### Phase 8 — Write path: remote lock, scheduled/recurring locks, profiles
- **Goal:** Wire the existing `startLock` / `writeSettings` store actions to UI; add scheduling + profiles. (RFC Step 3.)
- **Builds on / depends on:** Phase 6 (viewer), Phase 2 (command hooks live).
- **Effort & cost:** ~2–4 weeks app + minor firmware.
- **Current blocker:** Store actions exist but **no UI wires them** — and shipping a write path over an **unauthenticated** BLE link is unsafe, so Phase 9 must land before broad release. (Blockers **B5** gating safe ship.)

### Phase 9 — BLE security: pairing / bonding / encryption
- **Goal:** Close the open read/write surface before remote unlock ships to anyone but the owner.
- **Builds on / depends on:** Phase 2. Gates safe shipping of Phase 8 and Phase 10.
- **Effort & cost:** ~1–2 weeks firmware + app; depends on what CP `_bleio` bonding supports on this chip (verify during Phase 2).
- **Current blocker:** **No pairing/bonding/encryption at all** — any BLE client can read stats and write commands/settings/alerts. Current-only mitigations (remote unlock off by default + 1s rate-limit) are not sufficient for a shipped write path. (Blocker **B5**.)

### Phase 10 — Accountability / family mode (+ optional cloud backend)
- **Goal:** RFC Step 4 — multi-user accountability, possibly pulling in a cloud backend (RFC "B3").
- **Builds on / depends on:** Phase 8 (write path), Phase 9 (security).
- **Effort & cost:** Large. Greenfield backend, auth, sync — needs a real dev; multi-week to multi-month.
- **Current blocker:** **Not started anywhere** — no backend, auth, or sync exists. (Greenfield.)

### Phase 11 — Greenlist calls (iOS-first)
- **Goal:** RFC Step 5. Tier 1 = any-call "alert-through"; Tier 2 = per-contact greenlist; Android later.
- **Builds on / depends on:** Phase 6 (device build working), Phase 2 (call overlay live on box).
- **Effort & cost:** Tier 1 is mostly done in logic. Tier 2 is a research-grade spike (VoIP/PushKit) needing a real iOS dev.
- **Current blocker:** Tier-2 per-contact is a **stub** (`resolveLabel` → `'Call'`); **CXCallObserver cannot supply caller ID by design** — Tier 2 requires VoIP/PushKit + a real iOS developer. Also gated by the Apple toolchain (**B2/B4**). (Blocker **B8**.)

### Phase 12 — OTA firmware updates over BLE
- **Goal:** RFC Step 6 — push firmware to the box over BLE.
- **Builds on / depends on:** Phase 2 (BLE), Phase 9 (security — do not ship unauthenticated OTA).
- **Effort & cost:** Large, high-risk (bricking). Last for a reason.
- **Current blocker:** Depends on secured BLE (Phase 9); no OTA transport designed yet.

---

## 3. Consolidated Blocker Register

Ranked by how many downstream roadmap steps each blocker gates (most-gating first).

| ID | Blocker | Gates (steps) | How to clear it |
|---|---|---|---|
| **B1** | `adafruit_ble`/`_bleio` not vendored in `firmware/lib/`; unconfirmed in CP 10.2.1 build → BLE peripheral early-returns disabled | 2, 6, 7, 8, 9, 10, 11, 12 | On-board REPL: `import _bleio` to confirm native support; if missing/incomplete, vendor the matching `adafruit_ble` bundle for CP 10.x into `firmware/lib/` and re-run. Verify `lock_ble.py` reports `enabled=True`. |
| **B2** | No Apple build toolchain (needs macOS + Xcode + paid Apple Dev account + physical iPhone) | 6, 7, 8, 10, 11 | Acquire macOS access (Mac, or EAS cloud-macOS via B9) + enroll in Apple Developer Program ($99/yr) + have a test iPhone. |
| **B4** | Missing `.podspec` for `CallObserverModule.swift` → autolinking/prebuild won't compile the native module | 6, 11 | Author a `.podspec` for the Expo native module so prebuild/autolink picks it up; validate with a clean `expo prebuild`. |
| **B3** | No verified writable microSD + `sdioio` in build → logging silently disabled | 1, 7 (history data source) | Insert a known-good, writable microSD; confirm `sdioio` in the CP build; verify a session row is written and read back. |
| **B7** | No chunked per-session `history` characteristic on box or app | 7 | Design a chunked `history` GATT characteristic; implement on the box, add the consumer to `PhoneBoxClient.ts` + store; unit-test the codec. |
| **B5** | No BLE pairing/bonding/encryption; all 6 chars open read/write | 8 (safe ship), 9, 10, 12 | Implement bonding/encryption via CP `_bleio` (verify support during B1); until then keep remote unlock off by default + rate-limit. |
| **B9** | No `eas.json` configured | 6 (workaround for B2) | Add `eas.json`; use EAS cloud macOS builds to sidestep needing a local Mac. |
| **B6** | MAX17048 #5580 breakout not wired → reads 0% | 3 | Physically wire the breakout to I2C 0x36 and verify a live % reading. (Upgrade only — not on critical path.) |
| **B8** | CXCallObserver can't supply caller ID by design; Tier-2 greenlist stubbed | 11 (Tier 2 only) | Prototype VoIP/PushKit-based caller identification with a real iOS dev; Tier 1 (any-call alert-through) ships without this. |

---

## 4. Critical Path & Recommended Next 3 Actions

**Critical path (up-market / connectivity bet):**
`B1 (BLE online)` → `Phase 2` → `B2/B4/B9 (Apple toolchain)` → `Phase 6 (Viewer MVP)` → `Phase 7 (history)` → `Phase 8 (write path)` → `Phase 9 (security)` → Phases 10–12.
The single highest-leverage node is **B1** — it gates eight downstream steps and costs $0 in BOM. The app track's realistic wall is the **Apple toolchain (B2)**, which is a spending/logistics decision, not a coding one.

**Recommended next 3 actions (all cheap, local, and de-risking):**

1. **Clear B1 today.** On the board's REPL, test `import _bleio`; if unsupported, vendor the CP-10.x `adafruit_ble` bundle into `firmware/lib/` and confirm `lock_ble.py` comes up `enabled=True`. This alone revives BLE, command hooks, time-sync, and the call overlay.
2. **Run Phase 1 + Phase 4 on the bench.** Insert a writable microSD, confirm `sdioio`, verify a logged session round-trips, and re-run `npm test` + `npm run typecheck`. This proves the two "built-but-unverified" pillars and produces the runtime data needed to decide the 1000mAh battery cost cut.
3. **Kick off the parallel cost-down (Phase 5).** Switch board sourcing to The Pi Hut and start bulk-sourcing quotes — ~$12+/unit of savings with zero code risk while the firmware verification proceeds.

**Decision the owner must make before committing to the app track:** whether to fund the Apple toolchain (Mac/EAS + $99/yr Apple Dev + test iPhone) and the `.podspec` fix. Until that is settled, keep all effort on the firmware and cost-down tracks, which need none of it.
