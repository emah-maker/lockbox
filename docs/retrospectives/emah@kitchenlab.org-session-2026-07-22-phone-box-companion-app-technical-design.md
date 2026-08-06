---
author: emah@kitchenlab.org
date: 2026-07-22
job: technical-design
synthesized:
---

# Postmortem: Phone Box — Companion App Development Approach (Technical Design)

**Date**: 2026-07-22
**Duration**: Single session, 3 additive feedback rounds
**Objective**: Research the best way to develop a companion app for Phone Box and deliver the findings
as a Word document.
**Outcome**: success (approved)

## Executive Summary

Produced a technical-design RFC for the Phone Box companion app, building on the prior feature-ideation
doc (which had already established the app as the keystone premium feature). The RFC recommends a
**BLE-first, offline** architecture: an `adafruit_ble` GATT peripheral on the box (reusing the existing
`go_running`/`release_lock`/`go_done` state-machine seams) and a **React Native + Expo + TypeScript**
cross-platform app, shipped as a read-only viewer MVP then a phased roadmap. Approved after three
additive feedback rounds: (1) a two-option BOM (radio-free vs. original board) plus an iOS-first
greenlisting-calls reframe, (2) a concrete full mobile-stack recommendation, and (3) an honest
non-coder difficulty/effort assessment. Delivered as markdown (canonical) + `.docx` via
`scripts/md_to_docx.py`, with an evidence/traceability file and a feedback log.

## Quick RCA Card

**What failed**: Nothing substantive. Two recurring frictions: the FRAIM MCP server disconnected/
reconnected repeatedly (forcing `seekMentoring` tool reloads), and the deliverable `.docx` was held
open in Word during the last rounds, which blocked re-rendering (`PermissionError [Errno 13]`).
**Impact**: Tool reloads only; no lost work (durable artifacts written to disk independent of FRAIM).
The final `.docx` render (adding §5.1a stack + §6a difficulty) is pending the user closing Word.
**What should have happened**: Same substantive work; anticipate that the file-lock on an actively
reviewed Office artifact will block in-place re-render, and keep markdown canonical so no content is at
risk.
**What changes next time**: When a docx is under active review, expect render blocks and surface the
"close the file" ask early rather than after a failed write.

## Architectural Impact

**Has Architectural Impact**: No (design only; no firmware/product code changed). The RFC *proposes*
new architecture (radio/BLE connectivity, a `lock_ble.py` driver, SD logging, a remote release path,
and an app-side native-module boundary) and records these as gaps needing a manager decision — but
nothing was implemented.

## Timeline of Events

### Phase 1–2: requirements-analysis / design-authoring
- [done] Grounded in firmware (`lock_controller.py`, `lock_servo.py`, `lock_settings.py`) + prior
  ideation + project context; researched CircuitPython `_bleio`/`adafruit_ble`, RN vs Flutter vs native
  BLE, and iOS/Android background limits.
- [done] Wrote the RFC (architecture, firmware GATT design, framework selection, MVP + roadmap,
  validation plan, risks, confidence 75/100). No code spike (no board available this session; logged as
  the top blocking risk).

### Phase 3–5: architecture-gap-review / completeness-review
- [done] Added Architecture Analysis (§8a) vs. project_context/rules; traceability matrix (all Met,
  PASS) in the evidence file.

### Phase 6–7: submission / address-feedback (3 rounds)
- [done] R1: two-option BOM (§2a, radio-free vs original board, with links) + iOS-first greenlisting
  calls reframe (§5.3, `CXCallObserver` alert-through + VoIP/PushKit per-contact).
- [done] R2: concrete mobile stack (§5.1a, RN+Expo+TS layered table with packages + flip factors);
  verified the RN CallKit/PushKit ecosystem is current.
- [done] R3: non-coder difficulty/effort assessment (§6a) with DIY-with-AI feasibility, outsource cost
  ranges, and a light-coder recommended path.
- [done] Approved.

### Phase 8: retrospective
- [done] This document.

## Root Cause Analysis

### 1. Primary friction
**Problem**: `.docx` re-render failed with `PermissionError` across the last three turns.
**What drove it**: The deliverable was open in Word during review; Windows locks the file for writing.
Not a decision error — an environmental constraint.
**Corpus conflict**: none.
**Impact**: The approved `.docx` currently lags the markdown by two sections (§5.1a, §6a); a single
re-render after the file is closed resolves it. Markdown remained canonical throughout, so no content
was lost.

### 2. Contributing factor
**Problem**: Repeated FRAIM MCP disconnects between turns.
**What drove it**: Ambient MCP transport behavior (same as the prior premium-ideation session).
**Impact**: `seekMentoring` had to be reloaded via `ToolSearch` each turn; no work lost.

## What Went Right

1. **Read "develop a companion app" as "how do we actually build it, for *this* team/product"** — not a
   generic tech survey. This is why the answer held up as the manager's questions narrowed (stack →
   non-coder difficulty): the framing anticipated the decision the manager was really making.
2. **Grounded every box-side claim in real firmware seams** (`go_running`/`release_lock`/`go_done`,
   NVM settings), so the design is an additive second interface, not a rewrite.
3. **Verified platform reality before asserting it** — CircuitPython GATT support, the RN VoIP/CallKit
   package ecosystem, and the exact iOS call-identity boundary (`CXCallObserver` sees a call but not the
   caller; per-contact needs VoIP/PushKit). Prevented over-promising on iOS.
4. **Turned the BOM ask into a decision, not a table**: surfaced that radio-free is *dearer* at
   prototype quantity and kills the app, so "keep the original board, app = $0 hardware" is the honest
   recommendation.
5. **Honest non-coder guidance**: named the least-code, highest-certainty win (firmware SD-logging + on-
   device stats, no app) and scoped the app as hire-out/AI-assisted with this RFC as the brief.
6. **Kept durable artifacts on disk** (RFC md, docx when unlocked, evidence, feedback), so FRAIM
   disconnects and the file lock never risked the work.

## What Went Wrong / Anti-patterns to avoid

1. Attempting the in-place `.docx` render while it was under active review — predictable lock. Surface
   the "close the file" ask *before* the write when a docx is being reviewed.

## Where Past Learnings Fired

1. **`deliverable-format-preference`** — defaulted to markdown-canonical, produced docx via the existing
   `md_to_docx.py` (reused, not rebuilt), matching the project's Word-doc rule.
2. **"Solve the objective behind the literal request"** (attack-objective success moment) — read each
   round's question for the real decision (build-vs-buy, non-coder feasibility) rather than answering
   literally.
3. **"Keep durable artifacts on disk when FRAIM is flaky"** (prior premium-ideation retro) — held here.

## Lessons Learned

1. For "how do we build X" on this project, lead with the **team/skill reality** (who codes, how much) —
   it changes the recommendation more than the tech does. The non-coder round would have been worth
   pre-empting at kickoff.
2. On embedded + mobile designs, the **hard, honest constraints live on the phone platform** (iOS call
   identity, background execution), not the device — verify those first; they shape scope and marketing.
3. When a deliverable is an actively-reviewed Office file, **expect write locks** and keep markdown the
   single source of truth so re-renders are cheap and safe.

## Agent Rule Updates

None required — existing rules and preferences held. (Behavioral note recorded above about docx file
locks during review.)
