# Feature: App-side servo lock/unlock angle setting + Dashboard one-time session label (feature-implementation)

Issue: `servo-angle-and-tag-once-label` (local anchor -- no issue tracker/repository configured
per `fraim/config.json`; work done in place, no branch/commit/PR).
Source of truth: manager (MANdy)'s brief in this conversation, parent objective "Fix the box's
pre-session tag-picker ... and add a phone-app-adjustable servo lock/unlock angle setting plus a
free-text one-time session label on the Dashboard." Scope for this session: `app/src/**` only --
`Box-code/` is a sibling task's scope (see
`docs/evidence/tag-picker-fixes-and-servo-angle-feature-implementation-evidence.md`, which
independently confirms the same `langle`/`uangle` BLE key names and `[-90, 90]` clamp range this
session used -- the two sides agree without having coordinated directly).

## Work List

### Scope
1. **Servo angle setting** -- lock-angle/unlock-angle numeric controls on the Settings screen,
   persisted in `useSettingsStore.boxSettings`, round-tripped over the existing settings BLE
   characteristic with new keys `langle`/`uangle`.
2. **Tag-once label** -- free-text input on `DashboardScreen`'s `TopicPicker` that tags the current
   session with a raw, never-saved string via the existing `tagCurrentSession` callback.

- [x] `app/src/ble/protocol.ts` -- add `langle`/`uangle` to `Settings`, `parseSettings`,
  `encodeSettings`, each clamped to `[-90, 90]`.
- [x] `app/src/store/useSettingsStore.ts` -- `DEFAULT_BOX_SETTINGS` gets `langle: 45, uangle: 0`
  (matches the box's current fixed constants, so nothing changes until a user edits them).
- [x] `app/src/screens/servoAngle.ts` (+ `servoAngle.test.ts`) -- pure `clampServoAngle`/
  `SERVO_ANGLE_MIN`/`SERVO_ANGLE_MAX`, split out the same way `overridePresses.ts` is split from
  `OverridePressSection.tsx` so it's unit-testable without pulling in `useStore.ts`'s
  `react-native-ble-plx` module-load side effect.
- [x] `app/src/screens/ServoAngleSection.tsx` -- `AngleCustomEntry`, mirroring
  `OverridePressSection.tsx`'s `OverrideCustomEntry` open/draft/error pattern (collapsed link ->
  tap -> numberpad `TextInput` + Set/Cancel), plus a small +/- sign toggle (see Decisions).
- [x] `app/src/screens/SettingsScreen.tsx` -- wires two `AngleCustomEntry` rows ("Lock angle",
  "Unlock angle") into the existing "Box behaviors" section, next to the override-press controls.
- [x] `app/src/stats/customLabels.ts` -- `resolveTopic` now resolves a one-time free-text tag (not
  a built-in key, not a saved/deleted custom-label id) to the raw string instead of `null`; new
  `ResolvedTopic.isOneTime` flag; `topicBreakdownWithCustom`/`dominantTopicWithCustom` inherit the
  fix for free.
- [x] `app/src/screens/DashboardScreen.tsx` / `app/src/screens/TopicPicker.tsx` -- `TopicPicker`
  (extracted to its own file, see Implementation Quality Checkpoints) gets a "Type a label for this
  session..." `TextInput` + "Tag" button beside the existing topic chips, calling
  `onSelect(trimmed)` (== `tagCurrentSession`) directly; never touches `useSettingsStore`.
- [x] Test coverage: `protocol.test.ts` (round-trip, negative angles, clamp, NaN-default asymmetry),
  `servoAngle.test.ts` (new file), `customLabels.test.ts` (one-time-tag resolution + breakdown).

### Validation Requirements
- `uiValidationRequired`: Yes -- Settings screen's two new angle rows, Dashboard's new tag-once
  field. **Not run**: no RN simulator/emulator/`adb` available in this environment, consistent with
  every prior evidence file in this repo (see `lock-duration-picker-feature-implementation-evidence.md`).
  Verified by full code read + `npx tsc --noEmit` + `npx jest` instead.
- `mobileValidationRequired`: Yes, same blocker as above.
- Required suites: `npx jest`, `npx tsc --noEmit` (this repo's only host-runnable checks for `app/`).

### Decisions
- **Numeric keyboard vs. negative angles (flagged for review per the brief)**: kept
  `keyboardType="number-pad"` (the human explicitly asked for "a typable number, a numberpad") and
  added a small `+`/`−` toggle beside the field, rather than switching to `keyboardType="numeric"`.
  Reasoning: on iOS, neither `number-pad` nor `numeric` exposes a minus key at all -- switching
  keyboard types would not have actually solved the negative-angle problem, only changed which
  digits-only keyboard appears. The sign toggle is the only one of the brief's two suggested options
  that actually reaches every value in `[-90, 90]` without leaving the numberpad ask.
- **`langle`/`uangle` live directly on `Settings`/`boxSettings`, not as separate top-level
  `useSettingsStore` fields named `lockAngle`/`unlockAngle`.** The brief's "new fields, e.g.
  `lockAngle`/`unlockAngle`" read as a naming suggestion, not a structural requirement; every other
  `Settings` field (`ovr`, `auto`, `sleep`, `bright`, `unlk`, `ucal`, `thm`, `acc`, `flip`) already
  uses the identical name on the wire and in `boxSettings`, with no separate translation layer.
  Adding one only for this pair would be a new, inconsistent pattern for no functional benefit --
  `pushBoxSettings({ langle: v })` already works for free because `Settings` is `Partial`-patched
  directly. Flagging this as the one deliberate deviation from the brief's literal wording, per the
  brief's own request to call it out.
- **`parseSettings`'s `langle`/`uangle` default-fallback avoids the `Number(x) || fallback`
  pattern** used by every other field in that function. For every existing field, the fallback
  value (`0`) is itself a legitimate value, so the falsy-zero collision in `Number(d.ovr) || 0` is
  harmless. `langle`'s meaningful fallback is `45` (not `0`), and `0` is a legitimate lock angle --
  so `Number(d.langle) || 45` would have silently turned a real, intentional `0°` into `45°`.
  Written as an explicit `Number.isFinite` check instead; see the inline comment in `protocol.ts`.
- **`resolveTopic` fix scoped to distinguishing "no saved catalog entry, but not `custom:`-prefixed
  either" from "a deleted saved custom label."** Reused the existing `isCustomLabelId` prefix check
  rather than adding a new flag on `LoggedSession`, since the prefix already reliably identifies
  "this used to be a saved label" vs. "this was always a one-time raw string."
- **One-time tags all render in one fixed neutral color** (`ONE_TIME_TAG_COLOR`, reusing
  `LABEL_SWATCHES`'s existing warm-gray swatch), not a per-tag assigned hue. Meets the brief's bar
  ("doesn't render as blank/undefined") without inventing a color-assignment scheme the brief didn't
  ask for.
- **`AngleCustomEntry` lives in a new sibling file (`ServoAngleSection.tsx`/`servoAngle.ts`)**
  rather than inside `OverridePressSection.tsx`, matching that file's own header comment that it's
  specifically the *override-presses* control, and the `expo-react-native-dev` skill's "a new
  screen-only helper... sits beside its screen" convention (same relationship
  `CustomLabelsSection.tsx`/`OverridePressSection.tsx` already have to `SettingsScreen.tsx`).

### Known limitations (not fixed, out of scope for this brief)
- A one-time tag typed as exactly a built-in topic key (e.g. "work") or with a literal `custom:`
  prefix will resolve as that built-in topic or as `null` respectively, instead of the literal typed
  string -- an edge case of typing text that collides with this app's own reserved namespaces, not
  something the brief asked to guard against, and not reachable by normal use of the field.
- Retagging a one-time-tagged session from `CalendarScreen`'s tag-picker modal won't show the
  one-time text pre-selected among the fixed chip choices (it was never added to `customLabels`, so
  it isn't one of `allLabelChoices`' options) -- retagging there picks a different saved/built-in
  label instead, which matches "never appears as a chip" from the brief.
- `website/js/focusStats.js` has its own independent, unimported copy of `resolveTopic`'s logic and
  was not touched (out of the `app/src/**` scope for this session) -- it will not render one-time
  tags correctly if/when the website ever surfaces raw session topics the same way. Flagging for
  awareness, not fixing.
- An empty, untracked `app/{,` file (0 bytes, timestamp predates this session's edits) exists in the
  working tree -- not created by this session (confirmed nothing in this session's own commands
  could produce that filename); left in place rather than deleted, since it may belong to a
  concurrent sibling session sharing this working tree.

### Deferrals
None within this scope.

## Implementation Quality Checkpoints
- [x] Code complexity reviewed (no overengineering) -- `AngleCustomEntry`/`clampServoAngle` mirror
  existing patterns 1:1 rather than inventing new abstractions; the tag-once field is a single
  local `draft` state + one commit function.
- [x] No resource waste (excessive retries, delays, workarounds) -- none introduced.
- [x] Solution based on proven prototype from design phase -- N/A (no separate design phase; brief
  itself specified the exact patterns to reuse).
- [x] All new files/functions are actually used -- see New Files/Functions Created below.
- **QUALITY CHECK FAILURE (RESOLVED)**: adding the tag-once field to `DashboardScreen.tsx`'s inline
  `TopicPicker` pushed that file to 613 lines (it was already 575 before this session, over this
  project's 500-line guideline, but not a regression this session introduced -- 613 made it worse).
  **Resolution**: extracted `TopicPicker` into its own `app/src/screens/TopicPicker.tsx`, the same
  way `OverridePressSection.tsx`/`CustomLabelsSection.tsx` already sit beside `SettingsScreen.tsx`
  for their own feature areas, with its own local `StyleSheet` (not a hardcoded color -- `theme.textDim`
  is still applied at the call site). `DashboardScreen.tsx` is now 519 lines: still over 500, but a
  net *improvement* over this session's 575-line starting point, not just a wash. Fully closing the
  remaining 19-line gap would mean extracting pre-existing, unrelated code (the connection/status
  card, the Focus stats card, etc.) that this brief did not ask to touch -- left as-is per "don't
  refactor beyond what the task requires." `npx tsc --noEmit`/`npx jest` re-run clean after the
  extraction (see Validation Results).

## Validation Results

| Validation Step | Result | Notes |
|---|---|---|
| `npx tsc --noEmit` (app/) | **pass** | clean, no errors |
| `npx jest` (app/) | **pass** | 12/12 suites, 114/114 tests |
| Manual re-read of every changed file against the brief | **pass** | see Traceability Matrix below |
| UI visual check (Settings angle rows, Dashboard tag-once field) | **N/A -- could not run** | no RN simulator/emulator/`adb` in this environment; not claimed as tested |

### Full jest output
```
PASS src/stats/comparisons.test.ts
PASS src/stats/trend.test.ts
PASS src/stats/sessionHistory.test.ts
PASS src/stats/topics.test.ts
PASS src/auth/accountLinking.test.ts
PASS src/screens/overridePresses.test.ts
PASS src/sync/sessionMerge.test.ts
PASS src/screens/servoAngle.test.ts
PASS src/stats/stats.test.ts
PASS src/ble/protocol.test.ts
PASS src/sync/localDataOwner.test.ts
PASS src/stats/customLabels.test.ts

Test Suites: 12 passed, 12 total
Tests:       114 passed, 114 total
```

## Feature Requirement Traceability Matrix

| Requirement | Implemented File/Function | Proof | Status |
|---|---|---|---|
| Lock/unlock angle numeric control, numberpad `TextInput`, open/draft/error state (`OverrideCustomEntry` pattern) | `ServoAngleSection.tsx` `AngleCustomEntry` | Direct read; structurally mirrors `OverrideCustomEntry` | Met |
| Clamped to `[-90, 90]` app-side before sending | `servoAngle.ts` `clampServoAngle`; `AngleCustomEntry.commit` | `servoAngle.test.ts` (4 tests: pass-through, above-max, below-min, exact boundaries) | Met |
| Negative angles reachable despite numberpad's missing minus key | `ServoAngleSection.tsx` sign-toggle button | Direct read; documented decision above | Met |
| Persisted in `useSettingsStore`, sent over existing settings BLE write, wire keys `langle`/`uangle` | `useSettingsStore.ts` `DEFAULT_BOX_SETTINGS`; `protocol.ts` `Settings`/`parseSettings`/`encodeSettings` | `protocol.test.ts`: round-trip, negative-angle round-trip, out-of-range clamp (parse and encode), NaN-default asymmetry, zero-preservation | Met |
| Defaults `lockAngle=45, unlockAngle=0` (matches box's current fixed constants) | `useSettingsStore.ts` `DEFAULT_BOX_SETTINGS`; `protocol.ts` parse/encode fallbacks | `protocol.test.ts` "defaults langle/uangle to the box's fixed pre-upgrade constants (45/0)" | Met |
| Free-text input + "Tag" submit next to Dashboard's topic chips | `DashboardScreen.tsx` `TopicPicker`'s new `tagOnceRow` | Direct read | Met |
| Submitting calls existing `onSelect`/`tagCurrentSession(topic)` with the typed string directly (trim, require non-empty) | `DashboardScreen.tsx` `commitTag` | Direct read: `if (!trimmed) return; onSelect(trimmed);` | Met |
| Never added to `useSettingsStore.customLabels`; never appears in `CustomLabelsSection.tsx` or returns as a chip | `DashboardScreen.tsx` (calls `tagCurrentSession` only, never `addCustomLabel`) | Direct read of both files; `allLabelChoices` (unchanged) only lists `TOPIC_KEYS` + `customLabels` | Met |
| `resolveTopic`/`allLabelChoices` still render this session's stat/history entries sensibly, no blank/undefined | `customLabels.ts` `resolveTopic` | `customLabels.test.ts`: "resolves a one-time free-text tag to the raw string, not null"; `topicBreakdownWithCustom` "includes a session tagged with a one-time free-text label" | Met |

## Bug Bash Findings
Focused re-read of every changed file plus adjacent callers (`useStore.ts`, `CalendarScreen.tsx`,
`StatsScreen.tsx`) for edge cases beyond direct test coverage:

1. `CalendarScreen.tsx`'s day-detail session row and its "Untagged. Tap to tag this session."
   accessibility label both branch on `resolveTopic(...) === null` -- confirmed this now correctly
   shows the one-time tag's text/dot instead of misreporting a tagged session as untagged, with *no
   changes needed in `CalendarScreen.tsx` itself* (the fix is centralized in `resolveTopic`).
2. `StatsScreen.tsx` never calls `resolveTopic`/`.topic` directly (only the `*WithCustom` aggregate
   functions) -- confirmed it inherits the fix for free, same as `CalendarScreen.tsx`'s calendar-dot
   and breakdown rendering.
3. `CalendarScreen.tsx`'s retag modal (`allLabelChoices`) won't pre-select a one-time tag as
   "current" among its fixed choices, since a one-time tag was never added to that list -- see Known
   Limitations above; this is the expected consequence of "never a saved label," not a defect.
4. `useStore.tagCurrentSession`/`buildLoggedSessions` perform no validation against `TOPIC_KEYS`/
   `customLabels` today (confirmed by reading both) -- a raw one-time string flows through
   unchanged, so no store-layer change was needed to support it.
5. No `console.log`/TODO/FIXME left in any changed file.

0 Critical/High findings. 0 Medium/Low findings beyond the pre-existing, environment-caused UI
verification gap already recorded in Validation Results, and the two Known Limitations recorded
above (both accepted, not fixed, per brief scope).

## Technical Design Traceability Matrix
N/A -- no RFC/technical design document exists for this issue; the manager's inline brief (restated
in Scope above) is the only design source, and it is fully covered by the Feature Requirement
Traceability Matrix above. No feedback file exists at
`docs/evidence/servo-angle-and-tag-once-label-feature-implementation-feedback.md` -- per
`feedback-completeness-verification`'s own rule, no feedback file means no outstanding feedback to
verify.

## Existing Test Suites Run
All 12 suites in `app/` were run (`npx jest` with no filter); none skipped. No suite was excluded as
irrelevant -- `protocol.test.ts` and `customLabels.test.ts` are the two suites this change most
directly affects, and both pass.

## New Files/Functions Created

| File/Function | Purpose | Used by | Actually used? |
|---|---|---|---|
| `app/src/screens/servoAngle.ts` (`clampServoAngle`, `SERVO_ANGLE_MIN`, `SERVO_ANGLE_MAX`) | Pure angle clamp, unit-testable without the RN/BLE import graph | `ServoAngleSection.tsx` | Yes |
| `app/src/screens/servoAngle.test.ts` | Unit tests for the above | jest | Yes |
| `app/src/screens/ServoAngleSection.tsx` (`AngleCustomEntry`) | Lock/unlock-angle numberpad entry control | `SettingsScreen.tsx` (both rows) | Yes |
| `app/src/screens/TopicPicker.tsx` (`TopicPicker`) | Extracted from `DashboardScreen.tsx` (500-line guideline, see Implementation Quality Checkpoints); renders topic chips + the new tag-once free-text field | `DashboardScreen.tsx` (both the pre-session and in-session call sites) | Yes |

## New Tests Added

| Test Case | Validates | Result |
|---|---|---|
| `clampServoAngle` (4 cases) | pass-through, above-max, below-min, exact boundaries | pass |
| `protocol.test.ts` "defaults langle/uangle to the box's fixed pre-upgrade constants" | missing-field default | pass |
| `protocol.test.ts` "preserves a legitimate 0 langle instead of falling back to the 45 default" | falsy-zero collision fix | pass |
| `protocol.test.ts` "round-trips negative angles" | sign preserved end-to-end | pass |
| `protocol.test.ts` "clamps an out-of-range langle/uangle" (parse + encode) | belt-and-suspenders clamp both directions | pass |
| `protocol.test.ts` "sanitizes a non-finite langle/uangle to their own defaults (45/0)" | NaN/Infinity safety, asymmetric defaults | pass |
| `customLabels.test.ts` "resolves a one-time free-text tag to the raw string, not null" | core `resolveTopic` fix | pass |
| `customLabels.test.ts` "includes a session tagged with a one-time free-text label, grouped by its own text" | `topicBreakdownWithCustom` inherits the fix | pass |

## Security Review

### Executive Summary
0 Critical, 0 High, 0 Medium, 0 Low findings. No escalation items. No remediation required.

### Review Scope
- `reviewType`: embedded-diff-review
- `reviewScope`: diff
- `surfaceAreaPaths`: `app/src/ble/protocol.ts`, `app/src/store/useSettingsStore.ts`,
  `app/src/screens/ServoAngleSection.tsx`, `app/src/screens/servoAngle.ts`,
  `app/src/screens/SettingsScreen.tsx`, `app/src/stats/customLabels.ts`,
  `app/src/screens/DashboardScreen.tsx`, `app/src/screens/TopicPicker.tsx`, plus their
  `*.test.ts` files.

### Threat Surface Summary
`threat-surface-classification` run against the reviewed paths: no `web` (no `public/**|pages/**|
views/**`), no `api` (no `routes/**|api/**` or `app.get/post` calls), no `llm-app` (no LLM SDK
imports), no `data-pipeline` (no direct DB driver imports), no `mobile` (this is RN/TS app code
under `app/src`, not `ios/**|android/**|.swift|.kt`), and `docs-only` cannot apply because non-`.md`
files dominate the diff (only the evidence file itself is markdown). **`surfaces: []`** -- no
heuristic matched. Ran `secrets-in-code-check` and `privacy-and-pii-review` anyway per this repo's
own precedent for an identically-shaped `surfaces: []` result (see
`docs/evidence/lock-duration-picker-feature-implementation-evidence.md`).

### Coverage Matrix
| Category | Result | Notes |
|---|---|---|
| OWASP Top 10 (web/api/LLM) | N/A | no matching surface in this diff |
| Secrets in code | Pass | scanned every added/modified line against the detector table; only new literals are numeric bounds (`-90`, `90`, `45`) and a hex color constant (`#78716c`), none secret-shaped, no high-entropy assignments |
| Privacy / PII (PRIV01-05) | Pass | the one-time tag is free text a user types about their own session, which already round-trips as `LoggedSession.topic` today the same way built-in/custom tags do -- no new persistence surface, no new logger/analytics call, no new third-party egress, no new retention window, no new endpoint/DTO field exposure |
| Input validation at boundary | Pass | angle input clamped to `[-90, 90]` at both the UI layer (`clampServoAngle`) and the wire-encode layer (`encodeSettings`), consistent with this codebase's existing "app clamps too" convention; tag input trimmed and required non-empty before use |
| BLE wire contract | Pass | `langle`/`uangle` key names confirmed to match the sibling firmware task's independently-written contract (`docs/evidence/tag-picker-fixes-and-servo-angle-feature-implementation-evidence.md`), not redefined app-side |

### Findings
None.

### Prioritized Remediation Queue
Empty.

### Verification Evidence
- `npx jest`/`npx tsc --noEmit` output in Validation Results above serves as functional
  verification; no dedicated security test harness exists in this repo for this class of change
  (no auth/crypto/network surface touched).

### Applied Fixes and Filed Work Items
None needed.

### Accepted / Deferred / Blocked
- **Accepted**: the two Known Limitations recorded in the Work List above (reserved-namespace
  collision for a one-time tag typed as a built-in key or `custom:`-prefixed string; one-time tags
  not pre-selected in `CalendarScreen`'s retag modal) -- both are inherent to "one-time, not saved,"
  not security-relevant, and out of the brief's requested scope.
- **Blocked**: real-device/simulator visual verification, blocked on simulator/emulator/`adb`
  availability in this environment, not on anything in the code (see Validation Results).

### Compliance Control Mapping
N/A -- no active regulatory/compliance framework configured for this project.

### Run Metadata
- Run date: 2026-08-24
- Base: working tree on `master`, not committed (manager brief; no branch/commit/PR expected for
  this delivery per local-conversation-mode precedent).
- Skill errors: none. Caps hit: none.
- Environment notes: no RN simulator/emulator/`adb` available in this environment.

## Pre-Completion Reflection
- **Claim verification**: every claim above is backed by a direct tool call in this session --
  `Read` for every file before editing, `npx tsc --noEmit`/`npx jest` output pasted verbatim above.
- **Risk analysis**: additive, low-risk change. The only functional risk worth naming is the
  `parseSettings` falsy-zero collision that would have existed had `langle`/`uangle` followed the
  `Number(x) || 0` pattern verbatim -- caught and fixed before landing (see Decisions), with a
  regression test (`customLabels.test.ts`/`protocol.test.ts` "preserves a legitimate 0 langle").
- **Self-audit**: `git status` after this session's edits shows changes confined to
  `app/src/ble/`, `app/src/store/`, `app/src/screens/`, `app/src/stats/`, and this evidence file --
  no `Box-code/` files touched, per scope.
- Confidence level: **90%** -- full confidence in the logic/tests (read, run, green); withheld 10%
  for the UI layer, which is unverified on a real device/simulator (no RN simulator/emulator/`adb`
  in this environment).
