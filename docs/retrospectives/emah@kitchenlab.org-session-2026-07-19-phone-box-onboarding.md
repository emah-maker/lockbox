---
author: emah@kitchenlab.org
date: 2026-07-19
job: project-onboarding
synthesized:
---

# Postmortem: Phone Box — Project Onboarding

**Date**: 2026-07-19
**Duration**: Single session, 1 feedback round
**Objective**: Onboard the Phone Box project into a FRAIM-ready state and
establish a cost baseline for the "minimize unit cost, same functions" goal.
**Outcome**: success

## Executive Summary
Onboarded Phone Box — a CircuitPython-based phone-lockbox hardware product — from
a bare folder (no `fraim/`, not a git repo) into a validated FRAIM workspace:
config, durable project context, and project rules. Established a per-prototype
BOM cost baseline (~$40.77) and identified the $25 Waveshare ESP32-S3 board (with
unused Wi-Fi/BLE) as the dominant ~61% cost-down lever. Approved after one
feedback round that added a mechanical override switch to the BOM.

## Quick RCA Card
**What failed**: Nothing broke; two minor course-corrections. (1) Initial config
included empty `customizations.validation.*` commands, which the validator
rejects. (2) The first BOM omitted a mechanical override switch.
**Impact**: One extra validation run; one feedback round.
**What should have happened**: Omit the validation block entirely when no host
build/test exists; enumerate every physical input from the firmware pin map when
building the BOM.
**What changes next time**: Only write `customizations.validation` keys when real
commands exist; cross-check the BOM against `lock_config.py` button/switch pins.
**Example**: `BTN_OVERRIDE_PIN = "GPIO10"` implies a physical override switch that
the first BOM draft did not cost.

## Architectural Impact
**Has Architectural Impact**: No

## Timeline of Events

### Phase 1: sync
- [done] Detected missing `fraim/config.json`, non-git folder.
- [done] Ran `npx fraim init-project` to scaffold FRAIM content.

### Phase 2: scope
- [done] Read firmware (`code.py`, `lock_config.py`) and inventoried CAD + hardware.
- [done] Presented three-bucket scope; asked the 3 high-value questions.
- [done] Received cost figures, prototype volume, negotiable-functions answers.

### Phase 3: write
- [done] Wrote config.json, project_context.md (incl. BOM table), project_rules.md.

### Phase 4: validate
- [missed→fixed] First validate failed on empty validation commands; removed the
  block and re-validated clean.

### Phase 5: submit / address-feedback
- [done] Submitted artifact set; manager added override switch; updated BOM to
  ~$40.77 and re-validated.
- [done] Approved.

## Root Cause Analysis

### 1. Primary Cause
**Problem**: `npx fraim workspace-config validate` failed on first run.
**What drove it**: I scaffolded `customizations.validation` with empty-string
commands as placeholders, assuming empty was acceptable for a project with no
host tests. The contract requires the three commands to be non-empty *if the
block is present*.
**Corpus conflict**: none.
**Impact**: One extra edit + validation cycle.

### 2. Contributing Factors
**Problem**: BOM omitted the mechanical override switch.
**What drove it**: I mapped visible firmware buttons (lock/sense, override) to
existing price categories but treated the override input as one of the generic
tactile buttons rather than a distinct mounted mechanical switch.
**Impact**: One feedback round.

## What Went Wrong
1. Empty validation placeholders tripped the schema validator.
2. First BOM draft under-counted the override switch as a physical part.

## What Went Right
1. Reading `lock_config.py` first gave an accurate, evidence-based hardware
   inventory and pin map, making context/rules concrete.
2. The BOM baseline immediately surfaced the real cost lever (the $25 board /
   unused radio), directly serving the manager's cost-minimization goal.
3. Clean split of context ("what is true") vs. rules ("how to behave").

## What I Almost Did Wrong But Caught
1. Nearly fabricated placeholder build/test commands to satisfy the validator;
   caught that on-device firmware has no host build/test and removed the block
   instead of inventing commands.

## Where Past Learnings Actually Fired
1. **Pattern**: prior deploy-routine memory (batch-write + sync, no replug; D:
   read-only = FAT corruption) — folded directly into project_rules.md so future
   agents inherit it.

## Lessons Learned
1. For embedded/on-device projects, leave FRAIM validation commands unset rather
   than empty; the contract treats an empty command as invalid, not as "none."
2. Build hardware BOMs by enumerating every pin/actuator in the firmware config,
   not by pattern-matching to price buckets — physical switches are distinct SKUs.

## Agent Rule Updates Made to avoid recurrence
1. project_rules.md now states there is no host build/test and firmware is
   verified on-device — future agents won't expect or fabricate test commands.
2. project_rules.md requires board/part substitutions to preserve the enumerated
   functions and confirm support for the two buttons + override switch.

## Enforcement Updates Made to avoid recurrence
1. Deterministic `workspace-config validate` remains the gate; the fix (omit
   empty validation block) is documented in the evidence file.
