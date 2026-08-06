# Design Evidence — Companion App Development Approach (Technical Design)

**Date:** 2026-07-22
**RFC:** `docs/rfcs/companion-app-development-approach-technical-design.md` (+ `.docx`)
**Note:** No formal feature spec (`docs/feature-specs/`) or issue tracker exists — this is a local
project folder. Requirements were derived from the upstream feature-ideation doc
(`docs/brainstorming/phone-box-feature-ideation-2026-07-20.md`) and the firmware in `Box-code/`.
The matrix below traces those derived requirements to the RFC.

### Traceability Matrix

| Requirement (derived) | RFC section / component | Status |
|---|---|---|
| Companion app is the keystone premium feature; realize it | Exec summary; §3 architecture | Met |
| Add connectivity at $0 BOM using the unused radio | §3.1 (BLE, radio present); §4.1 | Met |
| See live box state + battery from phone | §4.2 `status` characteristic; §7 validation | Met |
| See focus history / streaks (the paywall dashboard) | §3.2 data seam; §4.2 `history`; §5.2 UI | Met |
| Start / configure a lock from the phone | §4.2 `command`; §4.3 (maps to `go_running`) | Met |
| Early unlock from phone (policy-gated) | §4.2 `command:unlock`; §8 risk mitigations | Met |
| Manage settings from phone | §4.2 `settings`; §4.3 (reuse `lock_settings.save()`) | Met |
| Wall-clock time (box has none) | §4.2 `time_sync`; §5.2 time | Met |
| Scheduled / recurring locks | §6 roadmap step 3; depends on time_sync | Met (roadmapped) |
| Accountability / family mode | §6 step 4; §3.1 B3 defer decision | Met (roadmapped) |
| Greenlist calls (iOS-first) | §5.3 (iOS CXCallObserver alert-through + VoIP/PushKit per-contact); §6 step 5 | Met (constraints documented) |
| Two build options (with/without Bluetooth), links | §2a BOM (Option A radio-free vs B original board) | Met |
| OTA updates | §6 step 6 | Met (roadmapped) |
| Choose a mobile framework | §5.1 (RN + react-native-ble-plx; alternatives table) | Met |
| Recommend a full mobile stack | §5.1a (RN+Expo+TS layered stack with packages; flip factors) | Met |
| Difficulty for a non-coder + build/outsource options | §6a (per-component difficulty, DIY-with-AI, cost ranges, light-coder path) | Met |
| Firmware library choice | §4.1 (adafruit_ble over _bleio) | Met |
| Preserve the 7 fixed product functions | §8a (adds interface, doesn't change functions) | Met |
| Respect CircuitPython + pin-map + run-loop rules | §2 constraints; §4.3; §8a | Met |
| Validation strategy (on-device only) | §7 validation plan (10 scenarios) | Met |

**Determination: PASS.** Every derived requirement maps to a concrete RFC section. No `Unmet` rows.

### Architectural gaps for user decision (from §8a)

1. **Connectivity vs. cost-down.** The design deliberately re-adds the radio the cost-down track aimed
   to remove. This is an up-market counter-bet and needs an explicit manager decision; if accepted,
   `project_context.md` should record connectivity as intentional.
2. **New remote early-release path + pairing/bonding security model** — no precedent in current
   firmware; needs acceptance and documentation.
3. **SD session-logging + phone-supplied wall-clock time** — new subsystems to record in architecture.

### Open verification items (top risk, blocking implementation not this review)

- Confirm the board's CircuitPython 10.2.1 build includes `_bleio`/`adafruit_ble` and `sdioio`/
  `sdcardio` (one on-device spike; RFC §10 step 1).
- No code was written or run; no firmware changed. This is a pre-implementation design.
