# Evidence: mobile-expo-rn-dev-skill (teach)

## Summary
- Issue: `mobile-expo-rn-dev-skill` (ad-hoc delegation, no tracked issue)
- Workflow type: teach (evolve-employee)
- The employee had FRAIM mobile skills for store compliance, native
  architecture/billing, and Metro/emulator/EAS validation, but nothing for
  day-to-day Expo/React Native UI-build workflow on this repo's real app
  (`app/`). This closes that gap with a new Project-level skill.

## Work Completed
- **New skill**: `fraim/personalized-employee/skills/mobile/expo-react-native-dev.md`
  — covers routing (this app's hand-rolled tab switcher vs. Expo Router
  escalation), native UI composition (theme tokens, `AnimatedPressable`,
  `SettingsPrimitives`, `@expo/ui` escalation), data fetching (Firebase/BLE
  reality vs. `fetch`/React Query escalation), project structure (this app's
  actual `src/` layout), and toast/feedback (flags web Sonner as
  incompatible with React Native, recommends `sonner-native` or a hand-rolled
  banner).
- **Reachability**: one bullet added to
  `fraim/personalized-employee/rules/project_rules.md` pointing agents at
  the new skill for any Expo/RN UI-build work on `app/`, mirroring the
  existing `3d-modelling-consultant` pointer already in that file.
- Both artifacts converged with a concurrent process working the sibling half
  of the same parent objective (porting UI-design/animation skills into
  `fraim/personalized-employee/skills/ux-design/`). See "Note" below.

## Approach Taken
Read the actual `app/` codebase (Expo SDK 52, no `expo-router`,
`@react-navigation`, `@expo/ui`, `NativeWind`, `react-query`, or
`Reanimated`/`gesture-handler` dependency) before adapting the 8 generic
installed Claude Code Expo skills, rather than porting their generic
defaults wholesale. Grounded every claim in a real file
(`theme.ts`, `tokens.ts`, `AnimatedPressable.tsx`, `SettingsPrimitives.tsx`,
`App.tsx`, `firestoreSync.ts`, `ble/protocol.ts`, etc.) read directly during
this session.

**Note on concurrency**: mid-task, a concurrent process was found actively
writing an equivalent, overlapping skill (plus a sibling `ux-design/` pair)
in the same directory. To avoid two competing, drifting skill sets, the
3-file split originally authored here was removed in favor of the
concurrent process's single consolidated file once it stabilized (confirmed
unchanged for 45+ seconds, then read in full and verified against the
manager's 5 requested topics, the composition-review contract, and this
repo's actual `app/` conventions).

## Validation
- Ran `capability-architecture-composition-review`: `pass`, no blocking
  findings.
- Ran `validate-evolution` checks: intent, format, scope, content-rule
  (grepped for manager-specific paths/secrets — none found), boundary, path
  integrity (every file path referenced in the skill confirmed to exist
  during this session) — all pass.
- No job, template, script, or synced baseline asset was touched.

## Quality Checks
- All 5 manager-requested topics present in the final artifact.
- Skill file format: no frontmatter, only the four canonical
  `### Skill Input/Output/Steps/Guardrails` blocks.
- No secrets, credentials, or manager-specific personal values in either
  changed file.
- Cross-references the existing `expo-react-native-mobile-dev-validation`
  (Metro/EAS-only) and sibling `ui-design-consultant`/`motion-and-animation`
  skills without duplicating them.

## Phase Completion
All `evolve-employee` phases completed: `intake-request`,
`diagnose-evolution`, `confirm-evolution-plan`, `apply-evolution`,
`validate-evolution`. No feedback file exists yet for this issue.
