---
author: emah@kitchenlab.org
date: 2026-07-23
job: supplier-discovery-and-qualification
synthesized:
---

# Postmortem: Battery Fuel-Gauge Board Discovery — Phone Box

**Date**: 2026-07-23
**Duration**: One conversational session
**Objective**: Find a small board to accurately measure battery percentage.
**Outcome**: success (approved first round, no change requests)

## Executive Summary

Ran supplier-discovery-and-qualification to find a small board for accurate LiPo
state-of-charge, replacing the incumbent voltage-divider + curve estimate in
`lock_battery.py`. Delivered a 12-candidate longlist, weighted shortlist, and risk
register recommending the Adafruit MAX17048 (#5580, $5.95). Manager approved with
no changes.

## Quick RCA Card

**What failed**: Nothing material.
**Impact**: n/a
**What should have happened**: n/a — approved as delivered.
**What changes next time**: Keep leading hardware-sourcing recs with the
"shares the existing bus / no new GPIO" qualifier — it was the decisive point.
**Example**: The MAX17048 recommendation hinged on it sharing the AXS5106L touch
I2C bus (GPIO41/42/47/48) at addr 0x36, verified in `lock_config.py`.

## Architectural Impact

**Has Architectural Impact**: No

## Timeline of Events

### Phase 1: load-strategy-and-requirements
- [done] Read project context, rules, BOM, `lock_battery.py`, `lock_config.py`.
- [done] Framed the objective (accurate SoC) behind the literal ask (a board).

### Phase 2–3: research-supplier-market / build-longlist
- [done] Multi-channel scan; 12 candidates with source URLs.
- [done] Verified prices/specs from primary sources (Adafruit, SparkFun, etc.).

### Phase 4–5: qualify-shortlist / document-exclusions-and-risks
- [done] Weighted scorecard gating CircuitPython + technical fit before price.
- [done] Excluded EOL/retired/no-CP-lib parts with reasons; risk register.

### Phase 6–7: submit / address-feedback
- [done] Markdown deliverable + .docx render + evidence doc.
- [done] Approved round 1.

## Root Cause Analysis

### 1. **Primary Cause**
**Problem**: None — no errors this run.
**What drove it**: n/a
**Corpus conflict**: none
**Impact**: n/a

### 2. **Contributing Factors**
**Problem**: FRAIM MCP server disconnected twice mid-run (after submit, after
approval), forcing session reconnects.
**What drove it**: Environment/transport instability, not a decision error. Each
reconnect required a fresh `fraim_connect` and re-passing the sessionId.
**Impact**: Minor — added reconnect round-trips; no work lost because deliverables
were already written to disk before each disconnect.

## What Went Wrong

1. **Transport drops**: FRAIM disconnected between phases; handled by reconnecting
   and resuming with the known jobId. No content impact.

## What Went Right

1. **Objective reframing**: Treated "find a board" as "get accurate SoC," which
   surfaced the honest $0 firmware-only alternative alongside the board rec.
2. **Primary-source verification**: Prices/specs and CircuitPython-library support
   confirmed against vendor pages, not assumed.
3. **Pin-map check from source of truth**: Confirmed the shared-I2C-bus story from
   `lock_config.py` rather than assuming free GPIO — the decisive qualifier.
4. **Format**: Markdown canonical + .docx render matched the project's convention.

## What I Almost Did Wrong But Caught

1. **Near-miss**: Nearly recommended a fuel gauge without checking whether a free
   I2C bus / GPIO existed on the cramped board. Caught it by grepping
   `lock_config.py` for the touch I2C pins, confirming the gauge shares the touch
   bus (0x36 ≠ touch addr) with zero new GPIO — turning a caveat into a selling point.

## Where Past Learnings Actually Fired

1. **Pattern**: "Attack the objective behind the literal request" (validated-patterns)
   — fired on the literal "find a board" ask; I added the $0 firmware-only OCV
   option as the baseline to weigh the ~$6 part against.
2. **Pattern**: "Go to primary sources directly" / "verify the source of truth"
   (validated-patterns, mistake-patterns) — fired on the pin map; I read
   `lock_config.py` instead of assuming a free bus.
3. **Pattern**: "Deliverables default to plain markdown" (preferences) — delivered
   markdown; rendered .docx to match the project's Word-doc rule and prior artifacts.

## Lessons Learned

1. For hardware-sourcing on this board, the GPIO/bus budget is often the real
   constraint, not price or space — lead with it.
2. An I2C peripheral that shares an existing bus is a strong recommendation lever
   on pin-starved boards; check bus addresses for conflicts up front.

## Agent Rule Updates Made to avoid recurrence

1. None required — no rule gap exposed.

## Enforcement Updates Made to avoid recurrence

1. None required.
