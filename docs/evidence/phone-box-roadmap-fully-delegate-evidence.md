# Evidence — Phone Box Development Roadmap (fully-delegate)

**Issue:** phone-box-roadmap
**Job:** fully-delegate (manager)
**Date:** 2026-07-24
**Status:** DRAFT — Requires Human Approval

## Summary

Produced a full Phone Box development roadmap with the current blocker at each step,
delivered as a Word document for review. The roadmap spans all product tracks (cost-down,
connectivity/companion-app, battery accuracy, enclosure) and grounds every "current blocker"
in an actual code audit rather than restating prior planning docs.

## Work Completed

Delegated the work as a dependency-aware graph and coached each node to a verified pass:

| Task | Persona | Job | Iterations | Verdict |
|------|---------|-----|-----------|---------|
| firmware-state-audit | researcher | codebase-analysis-and-ideation | 1 | pass |
| app-state-audit | mobile-dev | codebase-analysis-and-ideation | 1 | pass |
| roadmap-synthesis | planner | project-plan-creation | 1 | pass |

Group 1 (the two audits) ran in parallel; Group 2 (synthesis) ran after both passed review.

### Deliverables
- `docs/roadmaps/phone-box-development-roadmap-2026-07-24.md` (canonical markdown source)
- `docs/roadmaps/phone-box-development-roadmap-2026-07-24.docx` (review surface, rendered via `scripts/md_to_docx.py`)

### Key findings carried into the roadmap
- Firmware is far ahead of verification: SD logging, a 6-characteristic BLE GATT peripheral,
  controller command hooks, an incoming-call overlay, and a MAX17048 fuel-gauge driver are all
  written and wired into the run loop, but almost none is verified on hardware.
- The single highest-leverage blocker is **B1**: `adafruit_ble` / `_bleio` is not vendored in
  `Box-code/lib/` and is unconfirmed in the board's CircuitPython 10.2.1 build, so the BLE
  peripheral silently self-disables and takes four features with it. B1 gates eight downstream steps.
- The app is mostly real source (not mocks) but has never been compiled or run; the whole
  on-device path is walled behind an Apple toolchain (macOS + Xcode + paid Apple Developer + iPhone)
  the owner does not currently have (blocker B2), plus a missing native-module `.podspec` (B4).
- Cost-down: as-built ~$43.77 retail, no-redesign floor ~$28/unit; board locked to the ESP32-S3.

## Validation

- Both audits returned file:line evidence for every claim (e.g. `lock_ble.py:33-34`, `:89-90`
  for the BLE self-disable guard; missing `.podspec` in `app/modules/call-observer/`).
- Roadmap synthesis cross-checked against the audits and the approved RFC/ideation/BOM docs; no contradictions.
- `.docx` render confirmed: `Wrote docs/roadmaps/phone-box-development-roadmap-2026-07-24.docx` (42,448 bytes).
- No source files were modified; this is a planning deliverable only.

## Quality Checks
- All three delegated nodes verified-complete, zero corrections, zero escalations → confidence HIGH.
- Deliverable carries the DRAFT — Requires Human Approval banner.
- Every roadmap step has an explicit "Current blocker" line; blocker register ranked by downstream gating.

## Human Approval Checklist
1. Approve the roadmap phase ordering (de-risk-first sequencing).
2. Confirm scope = all product tracks matches intent (assumed from "full development roadmap").
3. Decide whether to fund the Apple toolchain (Mac/EAS + $99/yr Apple Dev + iPhone) — gates the entire app track (B2).
4. Confirm the 1000 mAh battery cost-cut should stay gated on measured runtime (a judgment call MANdy made).
5. Approve treating BLE security (Phase 9) as a hard gate before any remote-unlock ship.
