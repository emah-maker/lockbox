---
author: emah@kitchenlab.org
date: 2026-07-23
job: feature-implementation
synthesized:
---

# Postmortem: MAX17048 Fuel-Gauge Firmware Swap — Issue #local

**Date**: 2026-07-23
**Duration**: One conversational session
**Objective**: Replace the ADC voltage-divider + voltage-curve state-of-charge estimate in
`firmware/lib/lock_battery.py` with a read from the approved Adafruit MAX17048 (#5580) fuel gauge
over the shared touch I2C bus (0x36).
**Outcome**: success (approved round 1, no change requests)

## Executive Summary

Ran feature-implementation to swap the battery SoC source from the incumbent ADC divider/curve to
the MAX17048 ModelGauge over the existing touch I2C bus. Delivered a new minimal in-repo driver
(`max17048.py`), a rewritten `lock_battery.py` preserving the `BatteryReading` interface, config and
wiring changes injecting the shared bus, a 15-case host decode test, and an evidence doc. Host tests
30/30 pass; 0 security findings; on-device read left explicitly UNTESTED (no board). Manager approved
with no changes.

## Quick RCA Card

**What failed**: Nothing material.
**Impact**: n/a
**What should have happened**: n/a — approved as delivered.
**What changes next time**: Keep making the driver-vendoring call explicitly and flagging it, rather
than silently either vendoring a heavy stack or hand-rolling — the transparent "minimal driver, here's
why, easy to swap back" framing is what made the deviation from the named `adafruit_max1704x` library
land cleanly.
**Example**: The one real decision was building `max17048.py` (two register reads) instead of vendoring
`adafruit_max1704x` + `adafruit_bus_device` + `adafruit_register`; justified by the `axs5106l.py`
no-external-deps precedent and flagged for sign-off.

## Architectural Impact

**Has Architectural Impact**: Yes

**Sections Updated**: `fraim/personalized-employee/context/project_context.md` — module layout
(`lock_battery.py` description + new `max17048.py` entry) and the hardware "Power" bullet.
**Changes Made**: Battery SoC source moved from an internal ADC (GPIO12 divider) to an external
MAX17048 fuel gauge on the shared touch I2C bus; added a per-peripheral driver module; `Battery` now
receives the I2C bus by dependency injection (`code.py` → `LockController` → `Battery`).
**Rationale**: The gauge must reuse the touch controller's `busio.I2C` object (a second I2C on the
same pins conflicts), so the bus had to be threaded through the controller — the one genuinely new
structural pattern.
**Updated in PR**: n/a — local folder, no PR; changes applied in place and recorded in the evidence doc.

## Timeline of Events

### Phase 1: implement-scoping
- [done] Read project context/rules, the approved fuel-gauge shortlist, `lock_battery.py`,
  `lock_config.py`, and all `BatteryReading` consumers.
- [done] Confirmed the config battery symbols were imported only by `lock_battery.py` before removing.
- [done] Wrote Work List + decisions in the evidence doc; classified as a feature.

### Phase 2–3: implement-tests
- [done] Authored `max17048.py` (host-importable, no hardware imports) and a 15-case host test
  exercising real decode math, MSB-first assembly, register selection, and bus-lock discipline.

### Phase 4: implement-code
- [done] Rewrote `lock_battery.py`; swapped config tunables; injected the shared bus via controller +
  `code.py`. Simplified `present()` to an ACK probe after catching an unverifiable VERSION-bit assumption.

### Phase 5–7: validate / security / regression
- [done] 30/30 host tests, 13/13 modules compile, 0 security findings, bug bash 0 Crit/0 High/1 Low.
- [done] Corrected two stale ADC-specific UI diagnostic strings surfaced by the swap.

### Phase 8–12: quality / completeness / architecture / submission / feedback
- [done] Removed a dead constant found in quality review; traceability matrices; project_context update.
- [done] Submitted; approved round 1.

## Root Cause Analysis

### 1. **Primary Cause**
**Problem**: None — no errors this run.
**What drove it**: n/a
**Corpus conflict**: none
**Impact**: n/a

### 2. **Contributing Factors**
**Problem**: The FRAIM MCP server disconnected on session resume (after submit), requiring a reconnect
(`fraim_connect`) and re-passing the sessionId with the known jobId.
**What drove it**: Environment/transport instability, not a decision error — the same drop pattern the
discovery-job retrospective noted the day before.
**Impact**: Minor — one reconnect round-trip; no work lost (all artifacts were on disk).

## What Went Wrong

1. **Transport drop on resume**: FRAIM disconnected between submission and approval; handled by
   reconnecting and resuming with the retained jobId. No content impact.
2. **Minor self-introduced slip**: first draft of `max17048.py` gated presence on a hardcoded VERSION
   bit-pattern I couldn't verify against real silicon, and `lock_battery.py` briefly kept a dead
   `_VCELL_LSB_UV` constant. Both caught and fixed in-session (validate and quality phases respectively).

## What Went Right

1. **Interface-preserving swap**: keeping the `BatteryReading` shape meant zero change to `lock_ui`,
   `lock_controller` view logic, and every other consumer — the swap stayed invisible above `read()`.
2. **Precedent-driven design**: the minimal raw-`busio` driver mirrored `axs5106l.py` exactly
   (`try_lock`/`unlock`, no external deps), so it fit the codebase instead of importing a new pattern.
3. **Host-testable decode**: making the driver hardware-import-free let the real decode/assembly/lock
   logic run under CPython — genuine coverage on firmware that "can't be unit-tested on the PC."
4. **Honest hardware boundary**: every on-device claim marked UNTESTED; graceful `available=False`
   degradation means the untested path fails safe, not loud.

## What I Almost Did Wrong But Caught

1. **Near-miss (VERSION check)**: I nearly shipped a `present()` that required `VERSION & 0xFFF0 ==
   0x0010`. Signal: I could not confirm the exact silicon revision bits. Changed it to a plain
   address-ACK probe (what Adafruit's driver effectively does), so a working gauge can't be falsely
   disabled.
2. **Near-miss (scope creep)**: considered updating the UI to show real % while charging (now possible
   with a true gauge) and swapping the watts estimate for the gauge's CRATE register. Caught that both
   change behavior/UI beyond the stated swap; deferred them explicitly instead.

## Where Past Learnings Actually Fired

1. **Pattern**: "Verify the source of truth from `lock_config.py`, don't assume" (mistake-patterns /
   the discovery-job retro) — fired when I grepped every battery config symbol to confirm nothing else
   imported them before deleting, and confirmed the shared-bus/0x36 story in config.
2. **Pattern**: "Deliverables default to plain markdown; no doc conversion for review surfaces"
   (preferences) — fired at submission: kept the evidence doc as canonical markdown, did not render a
   .docx for a code-review artifact.
3. **Pattern**: "State plainly when a change is untested because no board run was performed"
   (project rules) — fired throughout the validation/traceability tables.

## Lessons Learned

1. On this firmware, the highest-leverage test surface is any decode/parse logic that can be made
   hardware-import-free — push chip math into pure functions and inject the bus, then it runs on the PC.
2. When an approved recommendation names a specific library for a *capability*, the capability is the
   commitment; substituting a minimal in-repo equivalent is fine if flagged, justified by an existing
   codebase precedent, and trivially reversible.
3. An interface-preserving swap (same value object) is the cheapest safe way to replace a hardware
   source — the blast radius stays inside the one module.

## Agent Rule Updates Made to avoid recurrence

1. None required — no rule gap exposed. Existing rules (single-source-of-truth config, CircuitPython-only,
   state-untested-plainly, respect-the-pin-map) all fired correctly.

## Enforcement Updates Made to avoid recurrence

1. None required.
