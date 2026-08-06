---
author: emah@kitchenlab.org
date: 2026-07-23
job: feature-implementation
synthesized:
---

# Postmortem: Phone Box — Companion App Implementation

**Date**: 2026-07-23
**Objective**: Implement the approved companion-app RFC — start with firmware SD session-logging +
on-device stats (no app), then (mid-session, manager-directed) build the iOS call/stats app and the
on-board important-call notification UI.
**Outcome**: success (both rounds approved)

## Executive Summary

Two delivery rounds in one session. Round 1 implemented the RFC's "data foundation" (roadmap #1): a
guarded `lock_log.py` SD session-logger appending one CSV row at the `go_done` seam, plus an on-device
"Focus" stats view. Round 2 — a manager scope jump — pulled roadmap #2/#5 forward: the BLE layer
(`lock_ble.py` GATT peripheral), an on-board "INCOMING CALL" overlay, controller BLE hooks, and a
React Native + Expo + TypeScript app (`app/`) that detects calls via native `CXCallObserver` and shows
focus stats. All firmware compiles and the pure logic (Python stats 15/15; TS stats/protocol run via
`node --experimental-strip-types`) passes. Nothing app-side or BLE-side is built/run — no macOS/Xcode/
iPhone/board in this environment. Both rounds approved.

## What Went Right

1. **Verified the hardware fact instead of guessing.** Fetched the real SD pinout from the CircuitPython
   board definition (SDIO 4-bit, GPIO15/16/17/18/13/14) rather than inventing pins — matched the
   project's "13–18 SD" reservation exactly.
2. **Best-effort/guarded everywhere.** Both `lock_log.py` and `lock_ble.py` guard their hardware imports
   and ops, so a missing card or a CP build without `sdioio`/`adafruit_ble` degrades gracefully and never
   touches the seven core timer functions. This directly answers the RFC's top risk.
3. **State-machine reuse, not a rewrite.** BLE commands map onto existing `go_running`/`go_closed`/
   `go_done`; logging rides the existing `go_done` seam; BLE is serviced last in the loop so the
   run-loop ordering rule holds. `code.py` needed no change for round 1.
4. **One shared wire contract.** BLE UUIDs/payloads live once in `lock_config.py` and are mirrored in
   `app/src/ble/protocol.ts`, so firmware and app can't silently drift.
5. **Clean merge with a concurrent refactor.** The user swapped the battery to a MAX17048 fuel gauge
   mid-session; my BLE status read used the unchanged `BatteryReading` API, so the two streams merged
   without conflict.
6. **Honest about the platform boundary and the verification gap.** Stated plainly that iOS
   `CXCallObserver` can't identify the caller (so MVP = any-call alert-through), and that the whole app +
   BLE path is unverified without a Mac and a board — not dressed up as "done".

## What Went Wrong / Anti-patterns avoided

1. Risk of over-promising on a blind iOS build. Mitigated by shipping a clearly-labelled scaffold with a
   precise `README.md` build/provision path and an explicit "not built/run" banner, rather than implying
   a tested app.

## Lessons Learned

1. **This manager jumps the roadmap.** Approved SD-first, then immediately demanded the full iOS
   call+stats app and BLE — the RFC's "very hard / hire-out / real-iOS-dev" tier. Plan for scope pull-ins:
   keep each layer's contract explicit so a later layer can be built fast, and surface the
   hardware/toolchain verification gap up front.
2. **Keep the cross-device contract in exactly one authored place.** The UUID/payload lockstep between
   `lock_config.py` and `protocol.ts` was the single most important structural decision for a two-codebase
   feature.
3. **On Windows with no Mac/board, the honest deliverable is a verified-logic scaffold + a real build
   guide**, not a claim of a working app. Validate what is hardware-independent (ran the TS stats as real
   code), and name precisely what a human must do next.

## Agent Rule Updates

None required. Existing rules/preferences held (best-effort hardware guards, config as single source of
truth, on-device-only validation stated plainly, markdown-canonical evidence).
