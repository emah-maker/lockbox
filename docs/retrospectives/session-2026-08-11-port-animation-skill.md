---
author: <developer email>
date: 2026-08-11
job: evolve-employee
synthesized:
---

# Postmortem: Port animation/motion skills into a repo-level FRAIM skill - Issue #port-animation-skill

**Date**: 2026-08-11
**Duration**: Single session, ~1 hour
**Objective**: Delegated by MANdy (`fully-delegate` job, ledger item `port-animation-skill`) to synthesize 13 installed Claude Code animation/motion skills plus the motion sections of `apple-design` into one new repo-level FRAIM skill, scoped to Phone Box's two real motion surfaces (marketing website, Expo RN app), following the `3d-modelling-consultant.md` precedent format.
**Outcome**: success

## Executive Summary

Ran the `evolve-employee` job end-to-end in `teach` mode to add a net-new FRAIM skill, `fraim/personalized-employee/skills/ux-design/motion-and-animation.md`, since no existing job/skill/rule anywhere in the repo covered motion or animation. The skill consolidates the `animate`, `animation-vocabulary` (partially), `find-animation-opportunities`, `improve-animations`, `review-animations`, eight `gsap-*` skills, and `apple-design`'s motion sections into one coherent, project-scoped reference — deliberately deduplicating the GSAP plugin family into a single section and grounding tool choice in the repo's actual state (website has no bundler/GSAP; the Expo app already uses RN core `Animated`, not Reanimated).

## Quick RCA Card

**What failed**: A self-caught formatting slip during authoring, not a task failure.
**Impact**: Would have made the artifact fail the Skill-family format contract if shipped as first drafted.
**What should have happened**: The four canonical Skill blocks (`### Skill Input/Output/Steps/Guardrails`) should be contiguous and uniformly at `###`, with all supplementary reference material placed before them.
**What changes next time**: When adding a supplementary reference section (like a "Quick Reference" or "Tooling" table) to a Skill file, place it immediately after the intro and before `### Skill Input`, never between two of the four canonical blocks, and grep the draft's own headers before calling `validate-evolution` complete rather than after.
**Example**: First draft placed "## GSAP Quick Reference" between `### Skill Steps` and a wrongly-leveled `## Skill Guardrails`; caught via a targeted grep of the file's headers during self-validation and corrected before evidence was written.

## Architectural Impact

**Has Architectural Impact**: No

## Timeline of Events

### Phase 1: Research
- [done] **Action**: Read the `3d-modelling-consultant.md` precedent to learn the required Skill format.
- [done] **Action**: Read all 13 target Claude Code skill files (`animate`, `animation-vocabulary`, `find-animation-opportunities`, `improve-animations`, `review-animations`, 8× `gsap-*`) plus `apple-design`'s SKILL.md.
- [done] **Action**: Confirmed via glob that `fraim/ai-employee/skills/ux-design/` and `/web/` (read-only synced) contain no motion content.

### Phase 2: FRAIM evolve-employee job
- [done] **Action**: `fraim_connect`, then walked `intake-request` → `diagnose-evolution` → `confirm-evolution-plan` → `apply-evolution` → `validate-evolution` → `submit` → `address-feedback` → `retrospective` via `seekMentoring`, per MANdy's brief that no separate human-approval checkpoint applied.
- [done] **Action**: Grounded the plan in the actual repo state before writing: checked `app/package.json` (no `react-native-reanimated`; RN core `Animated` already in use at `app/src/ui/AnimatedPressable.tsx`) and the `website/` directory (plain HTML/CSS/JS, no `package.json`, no bundler, no GSAP).
- [done] **Action**: Ran the "grep before authoring" check across `fraim/` for `animat|motion|gsap|reanimated` — only one prose mention in `project_context.md`; no peer artifact existed.
- [missed→caught] **Action**: First draft misplaced the GSAP reference section and mis-leveled the `Skill Guardrails` header; caught and fixed during self-run `validate-evolution` before evidence was written, not before.

### Phase 3: Delivery
- [done] **Action**: Wrote the evidence document at `docs/evidence/port-animation-skill-evolve-employee-evidence.md`.
- [done] **Action**: Respected the manager's explicit instruction that `fraim/config.json` mode is `conversational` — no git branch, commit, or PR was created; files were edited directly in place.
- [done] **Action**: Confirmed no file under `fraim/ai-employee/**` was touched at any point.

## Root Cause Analysis

### 1. **Primary Cause**
**Problem**: The first draft of the new skill file placed the "GSAP Quick Reference" section between `### Skill Steps` and `### Skill Guardrails`, and wrote the guardrails header as `##` instead of `###`.
**What drove it**: The precedent file (`3d-modelling-consultant.md`) has its one extra section (`## Tooling`) before all four canonical blocks, but I added a second extra section later in the document without re-checking that placement rule, and typed the final header at the wrong level out of habit from the `##` sections above it.
**Corpus conflict**: none — this was a self-authored slip, not guidance from an existing learning-file entry endorsing the wrong structure.
**Impact**: Would have failed the `evolve-employee` job's own `apply-asset-format` Skill format contract ("body MUST ONLY use the structural blocks... in the exact format") if it had reached `validate-evolution` unchecked.

### 2. **Contributing Factors**
**Problem**: None beyond the above — the rest of the session (research breadth, grounding checks, scope discipline) went as planned.
**What drove it**: n/a
**Impact**: n/a

## What Went Wrong

1. **Header placement/level slip**: Described above; self-caught during the `validate-evolution` phase's own format-validation step, before it reached the manager.

## What Went Right

1. **Grounding before writing**: Checked `app/package.json` and the `website/` directory structure before claiming what tooling exists on each surface, rather than assuming the manager's brief's "Reanimated-class" framing meant Reanimated was already a dependency. This produced a more accurate skill (Reanimated framed as a proposed addition, GSAP framed as CDN-script usage) than a purely brief-driven draft would have.
2. **Deduplication discipline**: Consolidated 8 `gsap-*` skills into one ~50-line reference section instead of restating each, as explicitly requested — kept the file to 280 lines, under the repo's 500-line cap.
3. **Scope discipline**: Explicitly excluded `animation-vocabulary` (pure glossary, no operational content) and `gsap-react`/`gsap-frameworks` (inapplicable — no JS framework on the website) rather than including them for completeness.
4. **Followed FRAIM process properly** rather than freeform-editing: ran every phase of `evolve-employee` through `seekMentoring`, including the diagnosis/placement reasoning (family=Skill, level=project, mode=teach) before writing anything.

## What I Almost Did Wrong But Caught

1. **Near-miss**: Was about to submit `apply-evolution` as complete with the GSAP reference section sitting between `Skill Steps` and a `##`-level `Skill Guardrails`. The signal that caught it was re-reading the `apply-asset-format` skill's exact Skill-format contract text during the `apply-evolution` phase's served instructions, then explicitly grepping the draft's own headers before considering the phase done. Fixed both issues (moved the section, corrected the header level) before writing the evidence document or calling `validate-evolution` complete.

## Where Past Learnings Actually Fired

- None. No offered entry changed an action in this job. (No specific `validated-patterns`/`mistake-patterns`/`preferences` corpus entries were surfaced into this session's context during the `evolve-employee` phases beyond the generic pending-L0-file listing in the job's Learning Context banner, which is a backlog notice rather than an offered entry for this specific task.)

## Lessons Learned

1. **Skill format is a hard contract, not a style preference**: The `apply-asset-format` skill is explicit that a Skill "must NOT contain Intent, Outcome, or Phases" and must use only the four canonical `###` blocks — any supplementary section must sit outside that contiguous run, not inside it. Worth grepping `^#` headers on any newly-authored Skill file before calling `validate-evolution` complete, every time, rather than trusting the draft.
2. **Ground tool-choice claims in repo state, not brief wording alone**: The manager's brief said "Reanimated-class" for native, but the app doesn't have Reanimated installed — checking `package.json` and actual source (`AnimatedPressable.tsx`) before writing avoided shipping a skill that assumed a dependency the project doesn't have.
3. **A 25-item pending-L0-learnings backlog notice in a job's Learning Context is not automatically in scope for every task run under that job** — for a narrowly delegated sub-task like this one, synthesizing the whole backlog would have been scope creep; it's better handled by a dedicated `sleep-on-learnings` run at the manager's discretion.

## Agent Rule Updates Made to avoid recurrence

1. **None proposed** — this was a single self-caught authoring slip within one session, not a recurring pattern that warrants a new rule yet.

## Enforcement Updates Made to avoid recurrence

1. **None proposed** — the existing `validate-evolution` phase's format-validation step already caught this class of error; no gap in the workflow itself was found.
