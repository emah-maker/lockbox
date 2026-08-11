# Evidence: add-mobile-dev-skill (evolve-employee)

## Summary
- Issue/task: `add-mobile-dev-skill` (delegation ledger, jobId `evolve-employee`)
- Workflow type: FRAIM `evolve-employee` (evolution mode: `teach`)
- Description: Added a new repo-level FRAIM skill teaching Claude Code how to
  build the `app/` Expo/React Native companion app's UI day-to-day — a
  capability gap not covered by any existing synced skill (which only cover
  store compliance, native module architecture, and post-build validation).

## Work Completed
- Created `fraim/personalized-employee/skills/mobile/expo-react-native-dev.md`
  (new file; the `mobile/` subfolder did not previously exist under
  `fraim/personalized-employee/skills/`, only `cad/` and `ux-design/` did).
- Format matches the existing local precedent
  (`fraim/personalized-employee/skills/cad/3d-modelling-consultant.md`): plain
  markdown, no frontmatter, `### Skill Input` / `### Skill Output` /
  `### Skill Steps` / `### Skill Guardrails` only.
- Content covers: navigation-as-actually-implemented (hand-rolled tab
  switcher, honest guidance on Expo Router only for if/when routing needs
  grow), native-feeling UI composition anchored to the app's real
  `theme/tokens.ts` + `AnimatedPressable` + `SettingsPrimitives` patterns, the
  app's real data patterns (Firestore sync bridges + the BLE protocol client,
  not a generic REST client), the existing `app/src` layout documented as
  convention (not a restructuring template), and toast/feedback UI (Sonner)
  flagged as a not-yet-adopted option with a concrete recommendation.
- Explicitly excluded Tailwind/NativeWind setup content: `app/package.json`
  has zero tailwind/nativewind/react-native-css dependencies; the app styles
  entirely with inline styles + `StyleSheet.create` + `theme/tokens.ts`.
- No files under `fraim/ai-employee/skills/` (synced, read-only) were touched.
- No git branch, commit, or PR created — `fraim/config.json` has
  `"mode": "conversational"` in this repo, so the file was edited directly in
  place per that mode's convention.

## Validation
- Ran the FRAIM `evolve-employee` job through all phases (`intake-request` →
  `diagnose-evolution` → `confirm-evolution-plan` → `apply-evolution` →
  `validate-evolution`) via `seekMentoring`.
- `rules/engineering/grep-peer-artifacts-first.md` applied before authoring:
  read the format precedent and the real peer source files in `app/src/`
  (theme, ui, screens, store, ble, sync, auth) rather than writing generic
  Expo advice.
- `skills/fraim/capability-architecture-composition-review.md` checked (via
  subagent extraction of the full ~1710-line doc): single new local Skill
  file has no blocking findings; job-scoped gates don't apply since no job
  changed.
- `skills/fraim/apply-asset-format.md` checked (via subagent extraction of the
  full ~2177-line doc): confirmed Skill format contract (no frontmatter, four
  canonical blocks only) and that "conversational" mode doesn't change
  skill-writing mechanics — it only affects Job-level PR/branch steps, which
  don't apply here.
- Format validated directly:
  - `grep -n "^#"` on the file shows exactly the title plus the four
    canonical `### Skill ...` headings, in order, with no other headers.
  - File starts with `# Skill` (no `---` frontmatter block).
  - 188 lines total (well under the repo's 500-line-per-file guideline).
- Content-rule scan: `grep -niE "emah|kitchenlab|C:\\Users|/Users/emah|northeastern|OneDrive"`
  against the written file returned no hits — no manager-specific paths,
  accounts, or machine-local values in a Project-level artifact.
- Confirmed `fraim/ai-employee/` shows no changes (`git status --porcelain
  fraim/ai-employee/` returned blank).

## Quality Checks
- All deliverables complete: one new skill file at the planned path.
- Every file path and skill name referenced inside the new skill body was
  itself read or confirmed to exist during this session (not asserted from
  memory).
- Complements, does not duplicate,
  `fraim/ai-employee/skills/mobile/expo-react-native-mobile-dev-validation.md`
  (Metro/emulator/EAS validation only — untouched, and the new skill's
  guardrails explicitly hand off to it rather than re-describing it).

## Phase Completion
All `evolve-employee` phases through `validate-evolution` completed with no
blocking findings. Proceeding to `submit` as a direct artifact handoff (no PR
— conversational mode).
