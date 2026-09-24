# Feature: Deepen Apple fluid-interface UI rework — companion app
Issue: none (conversational-mode workstream, no issue tracker configured for this repo)
Tech Spec: none (delegated workstream continuing commit 844cb93's design direction)
PR: none (conversational mode — changes live on `master` in this working copy for manager review)

## Work List

### Scope
- [x] `app/src/ui/useReducedMotion.ts` - add `configureLayoutAnimation(reducedMotion)` helper wrapping `LayoutAnimation.configureNext` - Implemented
- [x] `app/App.tsx` - gate tab-switch `LayoutAnimation` through the new helper - Implemented
- [x] `app/src/screens/CalendarScreen.tsx` - gate month-nav/day-select `LayoutAnimation` through the helper; add directional slide+fade motion on month change - Implemented
- [x] `app/src/screens/StatsScreen.tsx` - gate advanced-stats-toggle `LayoutAnimation`, and gate the trend/topic bar-chart `Animated.timing` fills - Implemented
- [x] `app/src/screens/DashboardScreen.tsx` - gate the running-session meter `Animated.timing` and the topic-chip-row `LayoutAnimation` - Implemented
- [x] `app/src/screens/CustomLabelsSection.tsx` - gate the rename-row edit-toggle `LayoutAnimation` - Implemented

### Validation Requirements
- `uiValidationRequired`: Yes — no device/emulator available in this environment; validated via `tsc --noEmit` + `jest` + manual code review against the `motion-and-animation`/`ui-design-consultant`/`apple-design`/`expo-react-native-dev` skills. Visual/on-device confirmation (reduced-motion toggle on a real iOS/Android device, feel-check on the calendar slide) is **not performed** and is called out below as untested.
- `mobileValidationRequired`: Yes — same caveat as above.
- Required suites/modes: `npm run typecheck` (tsc --noEmit), `npm test` (jest, 8 suites), manual source review. No build/emulator run performed.

### Decisions
- **Scope: reduced-motion correctness over new visual flourishes.** The prior pass (844cb93) wired `useReducedMotion()` into `AnimatedPressable` and the calendar tag-picker sheet, but left every `LayoutAnimation.configureNext` call site (tab switch, month nav, day select, advanced-stats toggle, label rename toggle) and two `Animated.timing`-driven progress bars (dashboard session meter, stats trend/topic bars) unconditional — they kept animating regardless of the OS reduced-motion setting. `motion-and-animation.md` step 9 ("Reduced motion ships with the animation, every time") makes this a real, closable gap rather than a style preference, so it's the primary fix in this pass.
- **One shared helper, not six inline checks.** Added `configureLayoutAnimation(reducedMotion)` to `useReducedMotion.ts` (co-located with the hook itself, following this app's existing pattern of small dedicated files) rather than repeating `if (reducedMotion) return; LayoutAnimation.configureNext(...)` at each of the 6 call sites — DRY per `rules/engineering/architecture-standards.md`.
- **Bar-chart/meter fills now `setValue` directly under reduced motion** (matching the existing `useDisabledFade` pattern in `DashboardScreen.tsx`) instead of skipping the update — the data itself must still reach its correct end value, only the animated ramp is dropped.
- **Added one genuinely new motion, not just gating**: `CalendarScreen`'s month navigation now slides+fades the grid in the direction of travel (next → enters from the right, prev → from the left) instead of popping in place. This is grounded in `motion-and-animation.md`'s tables, not invented: "Entering/exiting" → `Easing.out(Easing.cubic)`, "Dropdowns, cards, sheet reveals" duration tier → 220ms, purpose = spatial consistency (an explicitly named allowed purpose), frequency = occasional (month nav) → standard animation per the frequency gate. Used `Animated.timing`, not `.spring`, since this is a tap-triggered entrance with no gesture/velocity to hand off (springs are reserved for drag/momentum per the skill).
- **Did not touch the website or box UI** — this workstream is scoped to the companion app (`app/`) only; the parent objective's website/box-UI scope belongs to sibling workstreams.
- **Did not add a toast library or new dependency.** `expo-react-native-dev.md` §6 flags toast-style feedback as a real gap (BLE drops, sync failures) but explicitly requires flagging it as a dependency/pattern decision for the manager rather than a silent addition — noted as a follow-up recommendation, not implemented in this pass.

### Deferrals
- Toast/transient-feedback UI (BLE connection drops, settings-write failures, sync failures) — flagged, not implemented. Reason: `expo-react-native-dev.md` requires this be a manager-level dependency decision (new library vs. hand-rolled `Animated`-based component), not a silent addition during a motion-pass workstream.
- Android `android_ripple` parity for `AnimatedPressable` — explicitly called out in `expo-react-native-dev.md` as "don't add it speculatively"; not implemented since no Android-parity ask exists.
- On-device/emulator visual confirmation of the reduced-motion gating and the calendar slide feel — no device/emulator available in this environment. Recommended next step for the manager or a validation-capable agent: toggle the OS "Reduce Motion" setting and confirm (a) tab switches / month nav / day select / advanced-stats toggle / label rename all snap instantly with no motion, and (b) the dashboard meter and stats bars still reach the correct value with no animated ramp.

## Spec and Design Completeness

**Feature Requirements Source**: Manager directive (conversational, this session) — "Deepen the Apple fluid-interface UI rework... across the companion app... going beyond that first pass rather than just auditing it," scoped to `app/` for this workstream.
**Technical Design Source**: `fraim/personalized-employee/skills/ux-design/motion-and-animation.md`, `fraim/personalized-employee/skills/ux-design/ui-design-consultant.md`, `fraim/personalized-employee/skills/mobile/expo-react-native-dev.md`, and the installed `apple-design` skill.

### Implementation Checklist

#### Part 1: Reduced-motion correctness (systemic gap closure)
- [x] File: `app/src/ui/useReducedMotion.ts` - add `configureLayoutAnimation()` helper - ✅ Implemented
- [x] File: `app/App.tsx` - gate tab-switch layout animation - ✅ Implemented
- [x] File: `app/src/screens/CalendarScreen.tsx` - gate month-nav ×2 and day-select layout animations - ✅ Implemented
- [x] File: `app/src/screens/StatsScreen.tsx` - gate advanced-stats toggle layout animation; gate `AnimatedFill`'s `Animated.timing` - ✅ Implemented
- [x] File: `app/src/screens/DashboardScreen.tsx` - gate topic-chip-row layout animation; gate `meterAnim`'s `Animated.timing` - ✅ Implemented
- [x] File: `app/src/screens/CustomLabelsSection.tsx` - gate label-rename edit-toggle layout animation - ✅ Implemented

#### Part 2: New motion — calendar month-nav directional transition
- [x] File: `app/src/screens/CalendarScreen.tsx` - `animateMonthChange()`, wraps the day grid in an `Animated.View` driven by `monthSlideX`/`monthOpacity` - ✅ Implemented

**Feature Requirements Completeness Summary**:
- Implemented: 7/7 identified gaps (100%)
- Deferred: 3 items (toast UI, Android ripple parity, on-device feel-check) — all explicitly out of this pass's authorized scope per the consulted skills, not follow-up issues (no issue tracker in this repo)
- Missing: 0

**Technical Design Completeness Summary**:
- Implemented: 100% of the motion-and-animation/ui-design-consultant/expo-react-native-dev guidance applicable to the identified gaps
- Deferred: 0
- Missing: 0

**Scope Changes from Spec / Design**:
- None — the manager directive was open-ended ("deepen... going beyond auditing"); scope was self-determined by auditing the current `app/` state against the three consulted skills and picking the highest-leverage, lowest-risk concrete gap (reduced-motion correctness) plus one new, skill-grounded motion addition (calendar month transition), rather than a broad restyle.

## Completeness Evidence
- All phases of tech spec complete: N/A (no formal tech spec; self-scoped per manager directive)
- Issue tagged with label `phase:impl`: N/A (no issue tracker configured for this repo — `fraim/config.json` has no `repository`/issue-tracking block; project context confirms conversational mode)
- Issue tagged with label `status:needs-review`: N/A
- All files committed/synced to branch: No — conversational mode, changes are in the working tree on `master` for the manager to review/commit

### Feature Requirement Traceability Matrix
Source of truth: manager directive (conversational, this session) — "deepen the Apple fluid-interface UI rework in the companion app, going beyond the first pass rather than just auditing it." No formal feature spec exists; requirements below were self-scoped by auditing `app/src` against the consulted skills, per this repo's conversational mode.

| Requirement/Acceptance Criteria | Implemented File/Function | Proof | Status |
|---|---|---|---|
| Every implicit `LayoutAnimation` transition must respect the OS reduced-motion setting | `app/src/ui/useReducedMotion.ts` (`configureLayoutAnimation`); called from `App.tsx` (`selectTab`), `CalendarScreen.tsx` (month-prev, month-next, day-select), `StatsScreen.tsx` (`toggleAdvancedStats`), `CustomLabelsSection.tsx` (`toggleEditing`) | Repo-wide grep confirms 0 remaining unguarded `LayoutAnimation.configureNext` calls under `app/`; `npm run typecheck` + `npm test` pass (8/8 suites, 60/60 tests) | Met |
| Every progress/fill `Animated.timing` must respect the OS reduced-motion setting | `DashboardScreen.tsx` (`meterAnim` effect), `StatsScreen.tsx` (`AnimatedFill`) | Source inspection: both branch on `reducedMotion` and call `.setValue(toValue)` directly instead of animating, matching the pre-existing `useDisabledFade` pattern in the same file; `npm test` green | Met |
| Deepen the rework with genuinely new motion, not just an audit/gating pass | `CalendarScreen.tsx` (`animateMonthChange`, wraps the day grid in `Animated.View`) | Source inspection: directional slide (`monthSlideX`) + fade (`monthOpacity`) on month nav, values traceable to `motion-and-animation.md`'s tables, not invented; `npm run typecheck` passes | Met |
| Scope limited to the companion app (`app/`) — website/box-UI belong to sibling workstreams | All changed files under `app/` | `git diff --stat` shows only `app/App.tsx` and 5 files under `app/src/` touched by this workstream; no `website/` or `firmware/` files modified | Met |
| No new dependency introduced | All changed files | `app/package.json` unmodified by this workstream; all motion built on RN core `Animated`/`LayoutAnimation` | Met |

### Technical Design Traceability Matrix
Source of truth: no RFC exists for this workstream. Alternate design source: `fraim/personalized-employee/skills/ux-design/motion-and-animation.md`, `ui-design-consultant.md`, and `fraim/personalized-employee/skills/mobile/expo-react-native-dev.md` — this project's rules require consulting these for any app motion/UI work, making their guidance the applicable named design callouts.

| Requirement/Acceptance Criteria (named design callout) | Implemented File/Function | Proof | Status |
|---|---|---|---|
| Reduced motion must gate the animation call itself (motion-and-animation.md §9), not just exist as a hook | `useReducedMotion.ts`, all 6 call sites listed above | Each call site branches on `reducedMotion` before invoking the animation API, verified by direct read of each diff hunk | Met |
| Extend the app's existing `Animated`/`LayoutAnimation` primitives — do not introduce Reanimated/gesture-handler (expo-react-native-dev.md §3, motion-and-animation.md surface table) | All changed files | `app/package.json` unmodified; no new import of `react-native-reanimated`/`react-native-gesture-handler` anywhere in the diff | Met |
| Duration/easing values must come from motion-and-animation.md's tables, never invented (Skill Guardrails) | `CalendarScreen.tsx` `animateMonthChange` (`Easing.out(Easing.cubic)`, 220ms) | Values match the skill's "Entering/exiting" row and "Dropdowns, cards, sheet reveals" (150–250ms) duration tier exactly; cited in the file's own comment | Met |
| Springs reserved for drag/momentum, not tap-triggered entrances (motion-and-animation.md §5) | `CalendarScreen.tsx` `animateMonthChange` | Uses `Animated.timing`, not `.spring`, since this is a tap-triggered entrance with no gesture velocity to hand off | Met |
| Toast/feedback UI gap named in expo-react-native-dev.md §6 must be flagged to the manager, not silently added or silently ignored | N/A (deferred, not implemented) | Explicitly recorded under `## Work List` → `### Deferrals` in this evidence file | Met (as a disclosed deferral) |
| Android ripple parity for `AnimatedPressable` explicitly named as "don't add speculatively" (expo-react-native-dev.md §3) | N/A (correctly not implemented) | No `android_ripple`/`Platform.select` branching added; `AnimatedPressable.tsx` left untouched by this workstream | Met (correct non-action) |

## Implementation Quality Checkpoints
- [x] Code complexity reviewed (no overengineering) — one shared helper function, no new abstraction layers, no new dependencies — RESOLVED (n/a, no issue found)
- [x] No resource waste (excessive retries, delays, workarounds) — RESOLVED (n/a, no issue found)
- [x] Solution based on proven prototype from design phase — extends 844cb93's existing `useReducedMotion`/`AnimatedPressable` patterns rather than inventing new ones — RESOLVED (n/a, no issue found)
- [x] All new files/functions are actually used — `configureLayoutAnimation` is called from all 7 sites it replaces (6 originally-unguarded call sites plus itself is exported once); no dead code — RESOLVED (n/a, no issue found)
- [x] Hardcoded values check — `MONTH_SLIDE_DISTANCE`/`MONTH_SLIDE_DURATION` are named module-scope constants (not magic numbers inline), matching the file's existing `SHEET_TRAVEL`/`BACKDROP_OPACITY`/`SHEET_SPRING` convention — RESOLVED (n/a, no issue found)
- [x] Duplicate code check — this change *removes* duplication (6 copies of the same 2-line `LayoutAnimation.configureNext` guard collapsed into one `configureLayoutAnimation` helper) rather than introducing any — RESOLVED (n/a, no issue found)
- [x] File size check — largest touched file (`CalendarScreen.tsx`) is 433 lines after this change, under the project's 500-line guideline; all other touched files are 39–374 lines — RESOLVED (n/a, no issue found)
- [x] Function size/complexity check — `animateMonthChange` (CalendarScreen) is ~15 lines, one `if` guard, no nested conditionals beyond depth 1; no function added or modified exceeds 50 lines — RESOLVED (n/a, no issue found)

## Validation Results
- Complete validation performed as suggested in tech spec: Partial — automated checks (typecheck, unit tests) pass; on-device/emulator visual validation not performed (no device/emulator available in this environment)

| Validation Step | Validation Result | Failure Analysis |
|---|---|---|
| `npm run typecheck` (tsc --noEmit) in `app/` | Pass | — |
| `npm test` (jest) in `app/` | Pass — 8 suites, 60 tests | — |
| Manual source review against `motion-and-animation.md` §5/§9 tables (durations/easings not invented) | Pass | — |
| Re-run of typecheck + jest after a concurrent sibling workstream edited the same shared working tree (see note below) | Pass — 8 suites, 60 tests, 0 typecheck errors | — |
| On-device Reduce Motion toggle feel-check | Not performed | No device/emulator available in this environment; recommended as the next validation step |

**Concurrency note**: this repo runs in conversational mode (no per-issue worktree isolation), and a sibling workstream was observed actively editing `app/App.tsx`, `app/src/screens/CalendarScreen.tsx`, `app/src/screens/SettingsScreen.tsx`, and `app/src/theme/tokens.ts` (adding a `springs` token, Feather chevron icons for calendar nav, and a `typeScale`-based label style) in the same shared working tree while this workstream was in progress. No lines this workstream touched were clobbered — confirmed by re-reading the affected files and re-running typecheck/tests after the sibling's edits landed — but this is a real process risk worth the manager's attention: two agents writing the same files with no lock or isolation could silently drop one side's edit if they ever touch the same lines at the same time.

### Full Test Output
```
> phonebox-app@0.1.0 typecheck
> tsc --noEmit

> phonebox-app@0.1.0 test
> jest --watchAll=false

PASS src/stats/trend.test.ts
PASS src/stats/customLabels.test.ts
PASS src/stats/stats.test.ts
PASS src/sync/sessionMerge.test.ts
PASS src/stats/topics.test.ts
PASS src/stats/comparisons.test.ts
PASS src/stats/sessionHistory.test.ts
PASS src/ble/protocol.test.ts

Test Suites: 8 passed, 8 total
Tests:       60 passed, 60 total
Snapshots:   0 total
```

## Bug Bash Findings
Edge cases and adjacent flows checked beyond the direct changes:
- Rapid double-tap on month-nav arrows: `animateMonthChange` re-`setValue`s the start position and restarts `Animated.parallel` on every press, so a second tap before the first 220ms settle finishes just retargets cleanly (no stacked/competing animations, no crash) — verified by reading the implementation, not a device run.
- `useReducedMotion()` value flips mid-interaction (OS setting toggled while an animation is in flight): each gated call re-reads `reducedMotion` fresh on the next invocation (it's a hook value read at render time, not captured once), so a mid-flight animation isn't retroactively cancelled but the *next* triggered animation correctly respects the new setting — matches how `AnimatedPressable`/`useDisabledFade` already behave, no new inconsistency introduced.
- `AnimatedFill` (stats bars) reduced-motion branch calls `anim.setValue(toValue)` then `return`s before starting the `Animated.timing` — confirmed the early return means no orphaned animation keeps running in the background.
- Grep-verified zero remaining unguarded `LayoutAnimation.configureNext` or bar/meter `Animated.timing` calls anywhere under `app/src/` after the change (see Decisions section) — not just the sites planned at scoping time.
- 0 Critical/High issues found. 0 Medium/Low issues found beyond the already-disclosed on-device validation gap.

## Security Review

### Executive Summary
0 Critical, 0 High, 0 Medium, 0 Low findings. No escalation items. No remediation needed.

### Review Scope
- `reviewType`: embedded-diff-review
- `reviewScope`: diff
- `surfaceAreaPaths`: `app/App.tsx`, `app/src/ui/useReducedMotion.ts`, `app/src/screens/CalendarScreen.tsx`, `app/src/screens/CustomLabelsSection.tsx`, `app/src/screens/DashboardScreen.tsx`, `app/src/screens/StatsScreen.tsx`, `docs/evidence/apple-fluid-interface-companion-app-feature-implementation-evidence.md` (this file, referenced not reviewed as a threat surface)

### Threat Surface Summary
No surface from the closed set `{web, api, llm-app, data-pipeline, mobile, capability-authoring, docs-only}` matched. Rationale: every changed non-doc file is a React Native/TypeScript client UI file under `app/src/screens/`, `app/src/ui/`, or `app/App.tsx` — none touch `ios/**`/`android/**`/`.swift`/`.kt` (the `mobile` heuristic is native-project-file-specific, not RN/TS source), none define HTTP routes or handlers (`api`), none render to a DOM/`public/**` (`web`), none call an LLM SDK (`llm-app`), none touch a database/pipeline (`data-pipeline`), and the one `.md` file changed is evidence output in `docs/evidence/`, not a skill/job/rule/template/retrospective (`capability-authoring`). Because a non-doc file is present, `docs-only` is also correctly not emitted per the classification skill's special case. `surfaces: []`.
- Per the phase's on-demand loading rule, `secrets-in-code-check` and `privacy-and-pii-review` still apply (required for every non-`docs-only` review) and were run manually against the diff below; no OWASP web/api/llm/capability-authoring playbook applies since none of those surfaces matched.

### Coverage Matrix
| Category | Result |
|---|---|
| OWASP Top 10 (web) | N/A — no `web` surface |
| OWASP API Top 10 | N/A — no `api` surface |
| OWASP LLM Top 10 | N/A — no `llm-app` surface |
| Capability-authoring review | N/A — no `capability-authoring` surface |
| Secrets-in-code check | Pass — diff introduces only animation constants (`MONTH_SLIDE_DISTANCE`, `MONTH_SLIDE_DURATION`), a boolean-gated helper function, and hook wiring; no credentials, tokens, or connection strings |
| Privacy/PII review | Pass — no new data collection, logging, or persistence; the changed code only reads the existing `AccessibilityInfo.isReduceMotionEnabled()` OS setting (already read pre-existing by `useReducedMotion`) and drives local `Animated.Value`s |

### Findings
None.

### Prioritized Remediation Queue
Empty — no findings to remediate.

### Verification Evidence
N/A — no findings required fix verification. General correctness verification (typecheck, tests) is recorded in `## Validation Results` above.

### Applied Fixes and Filed Work Items
None.

### Accepted / Deferred / Blocked
None.

### Compliance Control Mapping
N/A — no active compliance framework configured for this repo (`fraim/config.json` has no compliance/regulation block).

### Run Metadata
- Run date: 2026-08-11
- Commit SHA: working tree on `master` (conversational mode, not yet committed)
- Skill errors: none
- Caps hit: none (0 findings, auto-fix cap of 10 not approached)
- Environment notes: reviewed by direct diff inspection (small, self-contained diff across 6 files); no automated SAST tool invoked given the diff's scope and the absence of any matching threat surface

## New Files/Functions Created
| File/Function | Purpose | Who is using/importing/calling it | Actually used? |
|---|---|---|---|
| `configureLayoutAnimation()` in `app/src/ui/useReducedMotion.ts` | Reduced-motion-aware wrapper around `LayoutAnimation.configureNext` | `App.tsx`, `CalendarScreen.tsx` (×3), `StatsScreen.tsx`, `DashboardScreen.tsx`, `CustomLabelsSection.tsx` | Yes |
| `animateMonthChange()` in `app/src/screens/CalendarScreen.tsx` | Directional slide+fade for month navigation | The two month-nav `AnimatedPressable` handlers in the same file | Yes |

## New Tests Added
- Added all tests suggested in tech spec: N/A — this pass is UI-motion/accessibility-correctness code with no new business logic; existing `jest` suites cover `stats/`, `ble/`, `sync/` pure logic and were unaffected. No new pure-logic units were introduced that need unit coverage; the changed code is React Native `Animated`/`LayoutAnimation` wiring, which this app's existing test suite does not (and does not attempt to) cover — visual/behavioral confirmation is the correct validation mode here, not a unit test, consistent with how `AnimatedPressable`/`useReducedMotion` shipped in 844cb93 without dedicated tests.

## Regression Run (implement-regression phase)
Full project regression suite re-run at the start of this phase: `npm run typecheck` (0 errors) and `npm test -- --watchAll=false` (8/8 suites, 60/60 tests, ~0.8s) in `app/`. No failures to triage. `fraim/config.json` has no `customizations.validation.testSuiteCommand` configured; `app/package.json`'s own `typecheck`/`test` scripts are this project's only defined regression commands (per project rules, `firmware/` has no host-runnable build/test — firmware only runs on-device).

## Existing Test Suites Run
| Test Suite | Was it Run | Failing Tests | Failure Analysis |
|---|---|---|---|
| `app/` jest suite (8 files, 60 tests: stats, ble/protocol, sync/sessionMerge) | Yes | 0 | — |
| `app/` tsc --noEmit | Yes | 0 | — |
| firmware (CircuitPython firmware) | Not run | N/A | No files under `firmware/` touched by this workstream |
| website/ | Not run | N/A | No files under `website/` touched by this workstream |

## Pre-Completion Reflection

✅ Reflection Phase 1 (Claim Verification): YES — every claim above (typecheck pass, test pass, exact call sites fixed) was verified by running the actual commands and grepping for remaining unguarded `LayoutAnimation.configureNext`/`Animated.timing` call sites after the edits, not assumed.
✅ Reflection Phase 2 (Risk Analysis): YES — main risk was missing a call site; a repo-wide grep after the initial pass caught one missed site (`CustomLabelsSection.tsx`), which was then fixed and re-verified. Remaining risk: the calendar slide's feel (duration/easing) is grounded in the skill's tables but unverified on a real device.
✅ Reflection Phase 3 (Validation Plan Check): YES — validation plan (typecheck + tests + source-level grep audit) matches what's actually achievable in this environment; the plan explicitly does not claim device validation that wasn't performed.
✅ Reflection Phase 4 (Self-Audit): YES — confirmed no new dependencies were added, no existing test was modified to force a pass, no placeholder/TODO left in changed files.
✅ All blockers from reflection addressed: YES
✅ Confidence level: 92%

**Reflection Summary:** The reduced-motion gating fix is verified by direct code inspection (every `LayoutAnimation.configureNext` and animated-fill `Animated.timing` call in `app/src/**` now routes through a reduced-motion check) plus passing typecheck/tests. The one open gap is on-device feel confirmation, which is explicitly disclosed rather than claimed.

## Continous Learning
| Learning | Agent Rule Update |
|---|---|
| `LayoutAnimation.configureNext` has no built-in reduced-motion opt-out, unlike `Animated.timing`/`.spring` — a codebase can adopt `useReducedMotion()` for press/sheet feedback and still leave every implicit-layout transition unguarded. Worth checking for on any future motion audit of this app. | Not written back to a rule file this pass (no explicit user correction to record) — noted here for the next agent auditing `app/` motion. |
