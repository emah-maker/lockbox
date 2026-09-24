---
author: <developer email>
date: 2026-07-20
job: codebase-analysis-and-ideation
synthesized:
---

# Postmortem: Phone Box — Premium Feature Ideation

**Date**: 2026-07-20
**Duration**: Single session, 4 additive feedback rounds
**Objective**: Research what functionalities could be added to Phone Box to validate a
higher price on the market.
**Outcome**: success (approved)

## Executive Summary

Ran a bottom-up codebase analysis crossed with competitor pricing research to identify
features that justify a premium. The pivotal finding — the ESP32-S3's Wi-Fi/BLE radio is
already in the BOM but completely unused — reframed the whole answer: the premium gap in
this category is software, not hardware, so connectivity-based features add margin at zero
BOM cost. Delivered a ranked feature set (Tier 1 software / Tier 2 cheap hardware) plus two
deep-dives (usage tracking app-vs-SD; greenlisting notifications to unlock), consolidated
on request into a single Word deliverable. Approved after four additive rounds.

## Quick RCA Card

**What failed**: Nothing broke; the only friction was repeated MCP (fraim) disconnects mid-
session and a couple of format-direction changes from the manager.
**Impact**: Some `seekMentoring` calls had to be retried after reloading the tool; no work
was lost.
**What should have happened**: Same substantive work; anticipate that "premium ideation"
for this project pairs naturally with a market/pricing lens and a possible Office-format
deliverable.
**What changes next time**: Lead product-ideation for a market-facing goal with the
competitor/pricing research in parallel from the start (done here), and expect the
deliverable format to firm up during review rather than at kickoff.
**Example**: The core thesis (unused radio → software is the premium lever) held from
round 0 through approval; all four feedback rounds were additive.

## Architectural Impact

**Has Architectural Impact**: No

(No firmware or product code was changed. All outputs are analysis/documentation under
`docs/`.)

## Timeline of Events

### Phase 1–2: codebase-analysis / categorized-analysis
- [done] Inventoried firmware from `docs/handoff/firmware-ai-context.md`, `project_context.md`, and
  `lock_config.py`; grep-verified the radio is unused.
- [done] Categorized exists vs. could-be-built; mapped premium features onto the modular
  driver/state-machine/NVM architecture.

### Phase 3–4: grounded-suggestions / verification
- [done] Ranked 9 suggestions (Tier 1 software, Tier 2 hardware), each with a file-level
  integration point.
- [done] Ran parallel competitor research (Brick/Unpluq/kSafe/Yondr/Habit Control) to
  anchor the pricing lens.

### Phase 5–6: submission / address-feedback (4 rounds)
- [done] R1: app-vs-SD tracking comparison (verified SDIO slot + CircuitPython support).
- [done] R2: greenlist-notifications feasibility (Android vs iOS platform limits).
- [done] R3: consolidated all suggestions into a `.docx` via `scripts/md_to_docx.py`.
- [done] R4: folded the standalone deep-dives into the single consolidated doc; removed the
  redundant files.

### Phase 7: retrospective
- [done] This document.

## Root Cause Analysis

### 1. Primary Cause
**Problem**: Several `seekMentoring` / FRAIM tool calls failed mid-session ("No such tool
available").
**What drove it**: The fraim MCP server disconnected and reconnected repeatedly during the
session (ambient infra behavior, not a decision). CircuitPython's known board flakiness is
unrelated; this was the MCP transport.
**Corpus conflict**: none.
**Impact**: A few retries after reloading the tool via `ToolSearch`; no lost work because
feedback and evidence were written to disk independently of the FRAIM calls.

### 2. Contributing Factors
**Problem**: Deliverable format shifted during review (markdown → docx → single folded doc).
**What drove it**: Applied the standing `deliverable-format-preference` (markdown +
conversation) as the default, which is correct; the manager then explicitly requested a
docx, which overrides it.
**Impact**: Two format-oriented rounds — expected and additive, not a miss.

## What Went Wrong

1. Repeated fraim MCP disconnects forced tool reloads and call retries.
2. Minor: the deliverable format was not settled until mid-review (inherent to the request,
   not an error).

## What Went Right

1. The grep-verified "unused radio" fact anchored a genuinely differentiated recommendation
   (software = premium at zero BOM cost) instead of a generic feature list.
2. Grounding every suggestion in a real file/integration point kept the ideation honest and
   actionable (no fabricated capabilities).
3. Parallel competitor research gave the pricing lens the manager's goal actually required
   ("validate a higher price"), not just a feature dump.
4. Verified platform constraints before answering the greenlist question (Android
   NotificationListenerService vs iOS restriction + EU-only iOS 26.3 forwarding) rather than
   assuming.
5. Reused the prior session's `scripts/md_to_docx.py` to satisfy the docx request cleanly,
   keeping markdown canonical.

## What I Almost Did Wrong But Caught

1. Nearly treated `deliverable-format-preference` (markdown-only) as absolute; caught that
   the prior board-alternative retrospective already flagged it as overridable on explicit
   request, and produced the docx without re-litigating.

## Where Past Learnings Actually Fired

1. **Pattern**: "solve the objective behind the literal request" (attack-objective success
   moment) — read "what features add" as "what features justify a higher price," so I ran
   competitor pricing in parallel rather than only listing features.
2. **Pattern**: `deliverable-format-preference` — defaulted to markdown, then honored the
   explicit docx request as an override.
3. **Pattern**: prior board-alternative session's `md_to_docx.py` converter — reused instead
   of rebuilding.

## Lessons Learned

1. For a market-facing "what should we build" question, pair the codebase ideation with
   competitor/pricing research from the start — the pricing lens is what makes the answer
   decision-grade.
2. Unused-but-paid-for hardware (here, the radio) is the highest-leverage premium finding on
   an embedded product; check for it explicitly.
3. When an MCP workflow server is flaky, keep the durable artifacts (feedback file, evidence,
   deliverable) on disk so progress survives disconnects independent of the workflow calls.

## Agent Rule Updates Made to avoid recurrence

1. None required — existing rules and preferences held. (`deliverable-format-preference`
   already noted as overridable; no corpus correction needed.)

## Enforcement Updates Made to avoid recurrence

1. None. The deterministic value here is behavioral: write deliverables/feedback to disk as
   the source of truth so FRAIM tool disconnects never risk work loss.
