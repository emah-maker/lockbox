# Feature: Firmware SD Session-Logging + On-Device Stats (companion-app roadmap #1)
Issue: #companion-app
Tech Spec: `docs/rfcs/companion-app-development-approach-technical-design.md` (approved RFC)
PR: N/A — local project folder, not a git repository (conversational mode; changes presented in place)

## Work List
Created at scoping; updated throughout the job.

### Scope
This job implements **only roadmap item #1** of the approved RFC (§3.2, §6, §10.2):
"Firmware SD logging + on-device stats view — captures real habit data, firmware only,
no app dependency, no FAT-corruption risk. *(This is the data foundation; do it first.)*"
The BLE viewer MVP and all app-side work are explicitly **out of scope** for this job
(they are the next roadmap items and are developer/hire-out work per RFC §6a).

- [ ] `firmware/lib/lock_config.py` — add SD/logging/stats tunables (pins, freq, paths, enable flag) — pending
- [ ] `firmware/lib/lock_log.py` (NEW) — SessionLog driver: mount external TF card, append session records, compute+cache stats; pure `compute_stats` for host validation — pending
- [ ] `firmware/lib/lock_controller.py` — create `SessionLog`; emit a record at the `go_done` seam (completed vs overridden, planned vs actual); add `"stats"` view — pending
- [ ] `firmware/lib/lock_ui.py` — build the stats/dashboard view + `update_stats()`; nav-hint updates — pending
- [ ] `firmware/code.py` — unchanged (SessionLog is created inside the controller, like Battery/Servo/Settings; the card is mounted at boot from code.py via the controller)

### Validation Requirements
- `uiValidationRequired`: Yes, but **on-device only** — there is no host display/test harness (project rule).
  The new stats view must be observed on the physical board.
- `mobileValidationRequired`: No (no app in this job).
- Required suites/modes:
  - **Host (PC):** run the pure `compute_stats`/`_parse_rows` aggregation against synthetic rows
    (the only firmware logic that is hardware-independent and CPython-runnable).
  - **On-device:** confirm `sdioio`/`storage` exist in the CP build, card mounts at `/sd`, a completed
    and an overridden session each append a correct row, and the stats view renders. **UNTESTED until a
    board run is performed** — no board available this session (RFC risk #1, High).

### Decisions
- **SD interface = 4-bit SDIO** via `sdioio.SDCard`. Verified the real board pinout from the CircuitPython
  board definition (`waveshare_esp32_s3_touch_lcd_1_47/pins.c`): `SD_CMD`=GPIO15, `SD_CLK`=GPIO16,
  `SD_D0`=GPIO17, `SD_D1`=GPIO18, `SD_D2`=GPIO13, `SD_D3`=GPIO14 — matches the "13–18 SD" pin-map note in
  project rules. Pins are resolved by **board attribute name** at runtime (same pattern as the battery
  sense pin), not hard-coded numbers.
- **Best-effort / graceful degradation.** All SD imports (`board`/`storage`/`sdioio`) and every SD op are
  guarded. If the module or card is missing, the seven core functions run unchanged and the stats view
  shows "NO SD CARD". This directly answers RFC risk #1 (build may lack `sdioio`).
- **External card mounted at `/sd`, never the internal flash.** No CIRCUITPY/FAT write conflict; the
  read-only-`D:` corruption failure mode is about internal flash and is not touched.
- **No wall clock yet** (box has no RTC; the phone supplies time later over BLE). So records store
  `planned_s, actual_s, outcome` only — **no dates**. Stats are aggregate + a **session-based streak**
  (consecutive completed sessions), not a day-streak. Day-based streaks are deferred to the app/time-sync
  phase, as the RFC intends (SD logging is the *data foundation* the app later dates).
- **CSV log** `/sd/sessions.csv`, header `planned_s,actual_s,outcome`. Human-readable, append-only,
  robust to partial/garbled lines.
- **Emit seam = `go_done`** (the RFC's single data-capture point). Only sessions that were actually
  `running` are logged (override-from-`closed`, which never started a countdown, is not a session).
- **Writes are event-time, not loop-time.** A record is appended only at `go_done` (once per session);
  stats are computed only when the stats view is opened. The touch/servo run-loop cadence is untouched,
  so the run-loop ordering rule is preserved and `code.py` needs no change.

### Deferrals
- BLE GATT peripheral (`lock_ble.py`), viewer MVP app, write-path, scheduling, greenlist, cloud — Deferred
  to later companion-app roadmap items (RFC §6). Reason: out of scope for roadmap item #1.
- Real timestamps / day-based streaks — Deferred to the app + `time_sync` phase. Reason: box has no RTC.

## Validation Results
Latest run only. No host build system or test runner exists for this firmware (project rule:
"There is no host build/test command"); the firmware runs only on the board. What *can* be checked
on the PC was checked; the rest is explicitly on-device-only and marked untested.

| Validation Step | Result | Notes / Failure Analysis |
|---|---|---|
| Host unit test — `python tests/test_lock_log_stats.py` (pure `parse_rows`/`compute_stats`) | **PASS** | 15 passed, 0 failed (full output below). Exercises the real production functions via guarded imports. |
| Static syntax check — `python -m py_compile` on all 7 firmware modules | **PASS** | `ALL COMPILE OK`. Catches syntax errors; cannot catch runtime `import board`/`sdioio` behavior. |
| On-device: `sdioio`/`storage` present in CP build, card mounts at `/sd` | **UNTESTED** | No board this session (RFC risk #1, High). Best-effort guards mean absence degrades to "NO SD CARD", not a crash. |
| On-device: completed + overridden session each append a correct CSV row | **UNTESTED** | Requires a board run per the §7 validation table. |
| On-device: stats view renders (dashboard + "NO SD CARD" fallback) | **UNTESTED** | displayio view, no browser/web surface. |
| Run-loop responsiveness with logging active | **N/A this session** | No new per-loop work added; writes are event-time only (`go_done`), stats compute on view-open. `code.py` unchanged. |
| UI polish check | **N/A — browser job not applicable** | The UI is an on-device 172×320 displayio view, not a web/browser surface, so the browser-based `ui-polish-validation` job does not apply. Visual polish must be verified on-device and is pending a board run. |

### Full host test output
```
PASS parse drops header/blank/malformed -> 3 rows
PASS parse first row values
PASS parse outcome normalized to overridden
PASS available True for parsed rows
PASS sessions counted
PASS completed counted
PASS overridden counted
PASS focus_s summed (300+120+900)
PASS longest_s is max actual
PASS streak = trailing completed only
PASS streak counts 3 trailing completed
PASS streak stops at the earlier override
PASS all overridden -> streak 0
PASS all overridden -> completed 0
PASS empty log available with zeros

15 passed, 0 failed
```

## Bug Bash Findings
Edge-case, boundary, and adjacent-flow review of the changed logic (on-device paths reasoned through,
since no board is available):

- **Elapsed math at `go_done`** — completed (`now ≥ deadline`) → `elapsed = set_seconds`; overridden
  (`now < deadline`) → `elapsed = set_seconds − remaining`. `record()` clamps `actual` to `[0, planned]`.
  Verified by inspection; no off-by-one. ✅
- **Override from `closed` state** (lid latched, LOCK never pressed → no countdown) is correctly **not**
  logged (`go_done` only emits when prior state was `running`). ✅
- **`VIEWS` grew from 4→5** — all consumers are index/`len`-based (`_handle_release`, `set_view`); no
  hard-coded count. ✅
- **Missing card / build without `sdioio`** — degrades to `Stats(available=False)` → "NO SD CARD";
  timer and all seven core functions unaffected. ✅
- **Malformed / partial CSV lines** — `parse_rows` drops header, blanks, non-int, and short rows without
  raising (covered by the host test). ✅
- **Empty log (card present, 0 sessions)** — `Stats(available=True)` with zeros → dashboard shows
  `0m / Sessions: 0`, not "NO SD". ✅
- **[LOW — known limitation] Soft-reload remount.** On a CircuitPython *soft* reload (Ctrl-D during dev),
  `storage.mount("/sd")` can raise if the volume is still mounted; the guard catches it and disables
  logging until the next *hard* reset. Production power-on is always a hard boot, so this only affects
  live-editing during development. Recorded, not blocking.

**Result: 0 Critical, 0 High. 1 Low (soft-reload remount, dev-only).** No blocking findings.

## Security Review

### Executive Summary
- **0 findings** (0 Critical, 0 High, 0 Medium, 0 Low). No escalations, no remediation queue.
- Diff is CircuitPython firmware + a host test + a markdown evidence doc. No auth, crypto, network,
  secrets, or PII surface is introduced by this change.

### Review Scope
- `reviewType`: embedded-diff-review · `reviewScope`: **diff**
- `surfaceAreaPaths`: `firmware/lib/lock_config.py`, `firmware/lib/lock_log.py` (new),
  `firmware/lib/lock_controller.py`, `firmware/lib/lock_ui.py`, `tests/test_lock_log_stats.py`,
  `docs/evidence/companion-app-feature-implementation-evidence.md`.

### Threat Surface Summary
- Detected surfaces: **[] (none)**. The OWASP surface heuristics (`web`, `api`, `llm-app`,
  `data-pipeline`, `mobile`, `capability-authoring`) match no reviewed file — this is embedded firmware.
  `docs-only` is not emitted because non-`.md` files are present. The surface set is intentionally
  firmware-agnostic, so category rows below are N/A except the always-run secrets/PII scans.

### Coverage Matrix
| Category | Result |
|---|---|
| OWASP Web Top 10 | N/A (no `web` surface) |
| OWASP API Top 10 | N/A (no `api` surface) |
| OWASP LLM Top 10 | N/A (no `llm-app` surface) |
| Capability-authoring review | N/A (evidence doc is `docs/evidence`, not agent instruction) |
| Secrets-in-code | **Pass** — no keys/tokens/passwords; config adds only pin names + clock frequency |
| Privacy / PII | **Pass** — log stores anonymous focus durations (`planned_s,actual_s,outcome`); no identity, contacts, or location |
| Untrusted-input handling (SD contents) | **Pass** — `parse_rows` drops malformed/short/non-int lines, `int()`-parses, normalizes `outcome` to a fixed constant; no `eval`, no format-string injection (fixed `.format` template) |

### Findings
None.

### Prioritized Remediation Queue
Empty.

### Verification Evidence
- Secrets/PII: manual inspection of the full diff; no sensitive tokens or personal data present.
- Untrusted-input: `parse_rows` hardening exercised by the host test (malformed/blank/non-int rows
  dropped) — see `## Validation Results`.

### Applied Fixes and Filed Work Items
None required.

### Accepted / Deferred / Blocked
- The BLE remote-unlock bypass, pairing/bonding, and privacy/accounts concerns called out in the RFC
  belong to later roadmap items (no BLE/network code in this diff) — deferred to those jobs, not blocked.

### Compliance Control Mapping
N/A — no compliance framework active for this project.

### Run Metadata
- Date: 2026-07-23 · Repo: local folder (no git SHA) · Skill errors: none · Auto-fix cap: not reached.

## Implementation Quality Checkpoints
- [x] Code complexity reviewed (no overengineering) — `compute_stats` is a single loop; `record`/`stats`
  are small and guarded; the `go_done` change is a 2-line emit. No nesting >3, no function >50 lines,
  no param list >4.
- [x] No resource waste — writes happen once per session (`go_done`); stats compute on view-open with a
  cache invalidated on append. No polling, retries, or per-loop work; `code.py` untouched.
- [x] Solution based on the approved design — implements RFC §3.2 data-capture seam + §6 roadmap item #1
  exactly; no scope creep into BLE/app.
- [x] All new files/functions are actually used — verified; removed a dead `SessionLog.available`
  property found in review (UI reads `Stats.available` instead). Re-ran tests + compile after removal.

**Quality findings:**
- `QUALITY CHECK FINDING` — **RESOLVED**: dead `SessionLog.available` property (unused) → removed.
- `QUALITY CHECK FINDING` — **ACCEPTED (not blocking)**: `lock_ui.py` exceeds the 500-line guideline
  (~681 lines before this change, ~740 after). This is a **pre-existing** architectural choice — the
  project keeps *all* display views in one `lock_ui` module (noted as "the largest module" in project
  context). Adding the stats view there is the consistent, lowest-risk option; splitting `lock_ui` is a
  separate refactor outside this feature's scope and would touch far more code. No new duplication or
  magic numbers introduced (all tunables live in `lock_config.py` per the single-source-of-truth rule;
  view coordinates follow the existing inline convention).

**Reuse check:** all tunables added to `lock_config.py` (not scattered); driver follows the
`lock_servo`/`lock_battery` per-peripheral pattern; guarded imports mirror `lock_battery`'s
`try: import microcontroller`; the UI receives a `Stats` value object exactly as `update_battery_view`
receives a `BatteryReading` (no `lock_ui`→`lock_log` coupling). New `_fmt_dur` is a compact "Xh Ym"
formatter, distinct from `fmt_hms` (H:MM:SS) which it does not duplicate.

## Completeness Review

**Feature Requirements Source**: RFC §6 roadmap item #1, §3.2, §6a (approved — no separate feature spec).
**Technical Design Source**: `docs/rfcs/companion-app-development-approach-technical-design.md` (approved).

### Feature Requirement Traceability Matrix
| Requirement (RFC §6 #1 / §3.2 / §6a) | Implemented File/Function | Proof | Status |
|---|---|---|---|
| Capture real habit data via session logging, firmware-only, **no app** | `lock_log.SessionLog.record` called from `lock_controller.go_done`; no BLE/app code | Host test (append schema exercised via `parse_rows`/`compute_stats`); on-device append UNTESTED (no board) | Met (code); on-device append deferred to board run |
| On-device stats view (the "it tracks your focus" story) | `lock_ui._build_stats`/`update_stats`; `"stats"` in `lock_controller.VIEWS`; refresh in `set_view` | `py_compile` OK; render is on-device-only | Met (code); on-device render deferred to board run |
| ~$3, firmware only, no app dependency / no BLE | Uses onboard TF slot + `sdioio`; zero app/BLE code added | Diff scope = firmware only | Met |
| No FAT-corruption risk (no internal-flash writes) | Mounts external card at `/sd` (`SD_MOUNT`), never CIRCUITPY | Code review; `SD_LOG_PATH="/sd/sessions.csv"` | Met |
| Preserve the seven core functions (fixed requirements) | No change to timer/servo/override/power/battery/settings/brownout paths; `code.py` unchanged; SD is best-effort | `py_compile` all 7 modules OK; degrade-to-"NO SD CARD" path | Met |

### Technical Design Traceability Matrix
| Commitment / named callout (RFC) | Implemented File/Function | Proof | Status |
|---|---|---|---|
| §3.2 — **one** session-record emit seam at the `go_done` transition | `lock_controller.go_done` emits only when prior state was `running` | Code review; bug-bash "override-from-closed not logged" | Met |
| §3.2 — SD sink via `sdioio`/`sdcardio`, external card mounted from `code.py`, no CIRCUITPY/FAT conflict | `lock_log.SessionLog._mount` (`sdioio.SDCard` → `storage.mount("/sd")`), created by controller (instantiated in `code.py`) | Code review | Met |
| §3.2 — SD-logging *first* so the app becomes a viewer over existing data | CSV schema `planned_s,actual_s,outcome` readable by a later reader | Host test parses/aggregates the schema | Met |
| §2 — CircuitPython only, no pip/CPython deps | Only `board`/`storage`/`sdioio` + builtins; all guarded | `py_compile` OK; guarded imports | Met |
| §2 / §8a — **named callout**: `lock_config.py` is the single source of truth for pins/tunables | SD pins, freq, paths, enable flag all in `lock_config.py` | Code review | Met |
| §2 — **named callout**: respect the pin map (13–18 SD) | `SD_*` pins resolved by board attribute name = GPIO15/16/17/18/13/14 (verified from board `pins.c`) | Board pin source fetched + matched to the "13–18 SD" note | Met |
| §2 / §4.3 — keep run loop responsive; servicing must not block/reorder touch | No per-loop work added; writes are event-time (`go_done`), stats compute on view-open; `code.py` unchanged | Code review; run-loop ordering untouched | Met |
| §8a — **named callout**: per-peripheral driver module (mirror `lock_servo`/`lock_battery`) | `lock_log.py` is a sibling driver owning the card | Code review | Met |
| §8a — state-machine reuse; no new lock mechanism | Records emitted from existing `go_done`; no new transitions | Code review | Met |
| §2 / §7 — no host build/test; validate on-device; state untested plainly | Documented throughout; host test limited to pure logic | This evidence doc | Met |
| Risk #1 / §10 step 1 — **verify `sdioio`/`sdcardio` present on the real board (capability spike)** | Best-effort guards degrade gracefully if absent; flagged UNTESTED | Cannot run (no board this session) | **Deferred (on-device) — documented**; blocked on hardware, this is the RFC's own deploy-time next step |

**Deviations:** none unintended. The only open item is the on-device capability spike (Risk #1), which is
inherently un-runnable without the physical board and is explicitly framed by the RFC as the first
deploy-time next step. Code is written to survive its two outcomes (module present → logs; absent →
"NO SD CARD", timer unaffected).

### Feedback Verification
Round 1 (SD logging + stats): **Approved** by the user, no changes requested.
Round 2 (BLE + iOS app + board call UI): **Approved** by the user, no changes requested.
`allFeedbackAddressed: true` (0 open items).

**Work List status:** all scope items closed (code + host test); deferrals (BLE/app, real timestamps,
on-device validation) explicitly recorded with rationale. Required validation modes recorded: host test
executed (pass); on-device modes consciously deferred to a board run.

## Round 2 — BLE link + iOS app + board call-notification UI (manager-directed scope expansion)

Manager pulled roadmap items #2/#5 forward: build the iOS app that checks for calls and tracks focus
stats, plus an on-board notification UI for important calls. This required first building the BLE layer
(the prerequisite the earlier round deferred).

### What changed
**Firmware (buildable + syntax-verified here):**
- `firmware/lib/lock_config.py` — BLE section: enable flag, device name, advertising policy, command
  rate-limit, `BLE_ALLOW_REMOTE_UNLOCK=False`, call-alert timeout, and the 128-bit service/characteristic
  UUIDs. (Note: the battery block in this file was concurrently refactored to a MAX17048 fuel gauge by
  the user; my BLE work is consistent with it — `_battery_pct` uses the unchanged `BatteryReading` API.)
- `firmware/lib/lock_ble.py` (new) — `PhoneBoxBLE`: an `adafruit_ble` GATT peripheral exposing
  `status`, `stats`, `command`, `settings`, `time_sync`, `alert`. Fully guarded (missing `adafruit_ble`/
  `_bleio` → BLE disabled, timer unaffected); non-blocking `service()`; advertising gated by policy.
- `firmware/lib/lock_controller.py` — BLE hooks: `ble_status_json`/`ble_stats_json`/`ble_settings_json`,
  `apply_ble_command` (maps onto existing `go_running`/`go_closed`/`go_done` — no new lock mechanism),
  `apply_ble_settings_json`, `set_wall_time`/`wall_time`, and `notify_call` (drives the on-screen alert).
- `firmware/lib/lock_ui.py` — a full-screen **incoming-call notification overlay** (`show_call_alert`/
  `hide_call_alert`): amber border, "INCOMING CALL", caller label; auto-dismisses.
- `firmware/code.py` — creates `PhoneBoxBLE` and services it **last** in the run loop (after touch +
  buttons + update), preserving the ordering rule; non-blocking.

**iOS app (`app/`, RN + Expo + TypeScript — the RFC §5.1a stack) — SOURCE SCAFFOLD, NOT BUILT/RUN:**
- `src/ble/protocol.ts` — the wire contract (UUIDs + codecs), kept in lockstep with `lock_config.py`.
- `src/ble/PhoneBoxClient.ts` — `react-native-ble-plx` scan/connect/subscribe/read/write.
- `modules/call-observer/` — native iOS `CXCallObserver` Expo module (Swift) + JS interface.
- `src/calls/CallMonitor.ts` — incoming call while locked → BLE alert-through (box never unlocks).
- `src/store/useStore.ts` (zustand), `src/stats/stats.ts` (+ `stats.test.ts`), `src/screens/DashboardScreen.tsx`,
  `App.tsx`, `app.json` (iOS background-BLE modes + permissions + ble-plx plugin), `package.json`,
  `tsconfig.json`, `babel.config.js`, `README.md`.

### Key decisions
- **Focus contract preserved.** BLE calls default to **alert-through** (screen lights up), never
  auto-unlock. `BLE_ALLOW_REMOTE_UNLOCK=False` by default; commands rate-limited; physical press-count
  override stays the true emergency path.
- **Honest iOS call boundary.** `CXCallObserver` detects that a call is ringing but **not who** is
  calling (Apple privacy). MVP = Tier 1 "any incoming call" alert-through. True per-contact greenlist
  (Tier 2) needs the call routed through the app as VoIP (PushKit/CallKit) — deferred, stubbed in
  `CallMonitor.resolveLabel`.
- **Single shared BLE contract** so the two codebases can't silently drift.

### Validation
| Step | Result | Notes |
|---|---|---|
| Firmware `py_compile` (merged with the concurrent battery refactor) | **PASS** | `FIRMWARE COMPILE OK` |
| Existing host stats test still green | **PASS** | 15/15 |
| App pure logic — `stats.ts` + `protocol.ts` run as real code via `node --experimental-strip-types` | **PASS** | "app stats/protocol checks: all passed" |
| App `npm test` (jest), typecheck, prebuild, iOS build/run | **NOT RUN** | needs macOS + Xcode + Apple Developer account + iPhone; none available here |
| On-device BLE (advertise, connect, notify, alert-through), board call overlay render | **UNTESTED** | needs the board (with `adafruit_ble` in its CP build) + a phone |

### Blockers / what I need
- **A Mac + Xcode + a paid Apple Developer account + an iPhone** to build, run, and test the app and the
  native call module. This is the RFC's flagged "very hard / real iOS dev" tier — the source is a
  faithful starting point but is entirely unverified on-device.
- **The board with a CircuitPython build that includes `adafruit_ble`/`_bleio`** to verify the BLE
  peripheral (RFC risk #1). If absent, BLE self-disables and the timer is unaffected.
