---
author: <developer email>
date: 2026-08-11
job: evolve-employee
synthesized:
---

# Postmortem: Add mobile-dev skill for the app/ companion app - add-mobile-dev-skill

**Date**: 2026-08-11
**Duration**: single session
**Objective**: Close a capability gap: FRAIM's synced mobile/ios/android skills cover store compliance, native module architecture, and post-build validation, but nothing teaches the day-to-day workflow of actually building the `app/` Expo/React Native companion app's UI. Add a new repo-level skill for that.
**Outcome**: success

## Executive Summary

Ran the FRAIM `evolve-employee` job end-to-end (teach mode) and created
`fraim/personalized-employee/skills/mobile/expo-react-native-dev.md`, a
repo-anchored skill covering navigation-as-implemented, native UI
composition, data/sync patterns, project structure, and toast feedback for
the `app/` companion app. Content was grounded in the app's real source
(theme tokens, `AnimatedPressable`, Firestore sync bridges, the BLE protocol
client) rather than generic Expo advice, and Tailwind guidance was excluded
outright since the app has no Tailwind dependency. No synced skills or job
files were touched; no git branch/PR was created (conversational mode).

## Quick RCA Card

**What failed**: N/A - no failure; delivered as scoped.
**Impact**: N/A
**What should have happened**: N/A
**What changes next time**: N/A
**Example**: N/A

## Architectural Impact

**Has Architectural Impact**: No

## Timeline of Events

### Phase 1: intake-request
- [done] **Action**: Captured the manager's (MANdy's) brief as the seed - a plain-language description of the capability gap, already fully specified (target skill topics, exclusions like Tailwind, precedent file, list of installed skills to draw from).

### Phase 2: diagnose-evolution
- [done] **Action**: Classified as `teach` (net-new capability, no matching job/skill owns the workflow).
- [done] **Action**: Ran candidate discovery against `fraim/ai-employee/skills/mobile,ios,android` (synced) and `fraim/personalized-employee/skills/**` (local) - confirmed net-new gap.
- [done] **Action**: Ran the `capability-architecture-composition-review` checklist (via a subagent reading the full ~1710-line doc) against "single new local Skill file" - no blocking findings.
- [done] **Action**: Decided placement: family `Skill`, level `Project` (repo-bound content), reachability via the same ambient-discovery mechanism as the existing `cad/3d-modelling-consultant.md` precedent (no job needs to include it).

### Phase 3: confirm-evolution-plan
- [done] **Action**: Restated the plan in manager language; no scope ambiguity, proceeded directly to `apply-evolution` per this job's Principle 7 (single review pause, not a per-phase gate).

### Phase 4: apply-evolution
- [done] **Action**: Applied `grep-peer-artifacts-first`: read the format precedent and the real peer source files in `app/src/` (theme, ui, screens, store, ble, sync, auth, App.tsx, package.json) before writing any guidance.
- [done] **Action**: Confirmed the Skill format contract (no frontmatter, four canonical `### Skill ...` blocks only) via a subagent reading the full ~2177-line `apply-asset-format` doc.
- [done] **Action**: Wrote `fraim/personalized-employee/skills/mobile/expo-react-native-dev.md` (created the `mobile/` subfolder, which didn't exist yet under `fraim/personalized-employee/skills/`).

### Phase 5: validate-evolution
- [done] **Action**: Format-validated by grepping the written file's headings (exactly title + 4 canonical blocks, no frontmatter).
- [done] **Action**: Content-rule-validated by grepping for manager-specific values (personal paths/accounts/tokens) - none found.
- [done] **Action**: Confirmed `fraim/ai-employee/` shows no git changes.

### Phase 6: submit
- [done] **Action**: Wrote an evidence document at `docs/evidence/add-mobile-dev-skill-evolve-employee-evidence.md` and emitted an `artifact_set` review handoff (no PR - conversational mode).

### Phase 7: address-feedback
- [done] **Action**: No review surface with feedback existed (conversational, no PR); per the delegating agent's explicit instruction, no separate human-approval checkpoint applied to this task, and no corrections were issued in-session. Marked approved with 0 feedback rounds.

### Phase 8: retrospective
- [done] **Action**: This document.

## Root Cause Analysis

### 1. **Primary Cause**
**Problem**: N/A - this run did not fail or produce a defect.
**What drove it**: N/A
**Corpus conflict**: none
**Impact**: N/A

### 2. **Contributing Factors**
**Problem**: N/A
**What drove it**: N/A
**Impact**: N/A

## What Went Wrong

1. **`de-personalise-artifact.md` lookup 404'd**: The `apply-evolution` phase's skill list named `skills/learning/de-personalise-artifact.md` as the content-rule tool for shared-level artifacts, but `get_fraim_file` returned "File not found" for that path. Substituted a manual grep for manager-specific value patterns (home-directory paths, personal accounts/handles, key-shaped strings) as an equivalent check, which passed clean, but the canonical tool itself could not be invoked as instructed.
2. **`fraim learning-usage offers --job evolve-employee --json` is not a recognized CLI command** in this environment (`error: unknown command 'learning-usage'`), so Step 1 of `attest-learning-firings` could not retrieve an offered-learnings list. Recorded "no offer record existed for this job" per that skill's own fallback instruction rather than fabricating one.

## What Went Right

1. **Anchored every claim in real source, not memory**: Every file path, dependency absence (no Tailwind/router/Reanimated/@expo/ui/toast library), and architectural comment cited in the new skill was read directly from `app/` in this session (via parallel `Read`/`Glob`/`Bash` calls) rather than assumed from generic Expo conventions - satisfying both the manager's explicit "anchor to what's really there" instruction and the `grep-peer-artifacts-first` rule.
2. **Delegated large-document review to subagents**: Two FRAIM reference docs (`capability-architecture-composition-review.md` at ~1710 lines, `apply-asset-format.md` at ~2177 lines) exceeded single-call token limits; spawning foreground subagents scoped to the exact question ("is a single new local Skill file sound under this checklist?") kept the main session's context small while still getting a grounded, quoted answer.
3. **Honest exclusion of inapplicable source material**: Followed the manager's explicit Tailwind-exclusion instruction as a template and applied the same judgment to `expo-router` (covered per instructions, but framed as "if/when," not "as already adopted"), `expo-dom` (excluded, no need identified), and `expo-ui`/`@expo/ui` (framed as a future option, not documented as current practice) - rather than uniformly forcing all eight installed skills' content in regardless of fit.

## What I Almost Did Wrong But Caught

1. **Near-miss**: Early in discovery, `app/src/theme/tokens.ts`'s `elevation.card` uses the legacy RN `shadowColor`/`shadowOffset`/`shadowOpacity`/`shadowRadius` shadow props, while the installed `expo-native-ui` skill explicitly says "NEVER use legacy React Native shadow or elevation styles" and prefers the CSS `boxShadow` prop. The signal that caught this before writing was reading the actual token file instead of only the installed skill's stated preference - the new skill states both facts (what the app does today, what the newer convention recommends) and explicitly does not instruct a drive-by rewrite of `elevation.card`, rather than silently telling future work to violate the installed skill's "never" rule or silently overriding this app's existing token with no callout.

## Where Past Learnings Actually Fired

- None. No offered entry changed an action in this job. (`fraim learning-usage offers` returned `unknown command` in this environment, so no offer record could be retrieved to attest against; this is reported per `attest-learning-firings`' own fallback instruction rather than inventing a firing record.)

## Lessons Learned

1. **A repo's real dependency graph is the fastest gap-finder for "which generic Expo skill applies."** Reading `app/package.json` once (no `expo-router`, `@react-navigation/*`, `@expo/ui`, `tailwindcss`/`nativewind`, `@tanstack/react-query`, `sonner`) immediately partitioned all eight installed generic Expo skills into "documents current practice," "forward-looking option, flag as not-yet-adopted," and "exclude entirely" - faster and more reliable than reasoning about each skill's applicability in the abstract.
2. **Large FRAIM reference docs (composition-review, apply-asset-format) are meant to be summarized on-demand via subagent, not read whole into the main thread.** Both blew past the tool's per-call token ceiling; the tool's own error message already names this pattern (`Read ... in chunks ... If the Agent tool is available, do this inside a subagent`), and following it kept the main session focused on the actual authoring task.
3. **When a job phase instructs use of a specific named tool/skill and it 404s or is unavailable, the correct move is a documented manual substitute plus an explicit note in the retrospective** - not silently skipping the check, and not blocking the whole job on a missing tool that has a reasonable manual equivalent (grep for personal-value patterns; standard file/heading checks for the format gate).

## Agent Rule Updates Made to avoid recurrence

1. **None proposed.** No corpus entry or rule conflicted with a correct action in this run; the two tool-availability gaps (§ "What Went Wrong") are environment/tooling facts to report upward, not a rule to add to this repo's `project_rules.md`.

## Enforcement Updates Made to avoid recurrence

1. **None applied in this session.** Flagging the two unavailable tool paths (`skills/learning/de-personalise-artifact.md`, `fraim learning-usage offers`) for the FRAIM maintainers is out of scope for this task; noted here so a future run of `evolve-employee` or `sleep-on-learnings` can decide whether to fix the reference or the runtime.
