# Evidence: port-ui-design-skill (evolve-employee)

## Summary
- **Issue/ledger item:** `port-ui-design-skill` (delegation ledger item under `evolve-employee`, jobId `evolve-employee`, run as part of MANdy's `fully-delegate` job)
- **Workflow type:** evolve-employee (mode: `teach` — net-new Skill, Project level)
- **Description:** Port the strongest, non-redundant design-taste/UI-craft guidance from ~19 installed Claude Code UI/design skills into one coherent repo-level FRAIM skill under `fraim/personalized-employee/skills/ux-design/`, complementing (not duplicating) the three existing synced FRAIM ux-design skills, scoped to this project's real UI surfaces (marketing website + Expo RN app).

## Work Completed
- **Key artifact:** `fraim/personalized-employee/skills/ux-design/ui-design-consultant.md`
- **Companion artifact (same directory, out of this task's direct scope but confirms the "small tightly-scoped set" framing):** `fraim/personalized-employee/skills/ux-design/motion-and-animation.md`
- **Approach:** Ran the full `evolve-employee` workflow (intake → diagnose → confirm plan → apply → validate). During `apply-evolution`, discovered the target artifact had already been authored by a concurrent sibling agent in the same `fully-delegate` swarm, moments before this agent reached the write step. Rather than duplicate the write, independently verified the existing artifact against the approved intervention plan and the `capability-architecture-composition-review` findings, found one real dedup gap (a "Motion — implementation values" section repeating tables already owned by the sibling `motion-and-animation.md` skill), attempted to trim it, and found the concurrent agent had already self-corrected the same gap moments earlier (confirmed via a "file modified since read" conflict, then a stability re-check).
- **No edits made to `fraim/ai-employee/`** (confirmed via `git status`).

## Validation
- **Format:** No JSON frontmatter; only the four canonical Skill blocks (`### Skill Input` / `### Skill Output` / `### Skill Steps` / `### Skill Guardrails`) plus prose context sections, mirroring the `cad/3d-modelling-consultant.md` precedent.
- **Cross-references:** Explicitly names and hands off to `user-flow-mapping`, `ui-baseline-validation`, and `usability-test-protocol` (the three synced FRAIM ux-design skills), plus local siblings `expo-native-ui-patterns` and `motion-and-animation`, each with a stated non-overlapping boundary.
- **Path integrity:** Every project file referenced was confirmed to exist on disk: `website/css/styles.css`, `website/index.html`, `website/dashboard.html`, `app/src/theme/tokens.ts`, `app/src/theme/theme.ts`, `app/src/ui/AnimatedPressable.tsx`, `app/App.tsx`.
- **Content-rule scan:** Grepped for manager-specific values (personal paths, handles, keys, tokens, secrets). Only matches were the literal string "token(s)" referring to the project's own design-token file — not a credential. Clean.
- **Scope:** Sole change lives under `fraim/personalized-employee/skills/ux-design/`, the approved Project-level destination.

## Quality Checks
- All deliverables complete (or independently verified complete).
- No `fraim/ai-employee/` (synced baseline) content touched.
- Skill is discoverable at its explicit path; no job or rule required a new reference to make it reachable (per `capability-architecture-composition-review`, standalone skill authoring has no wiring requirement at creation time).

## Phase Completion
All `evolve-employee` phases completed: `intake-request`, `diagnose-evolution`, `confirm-evolution-plan`, `apply-evolution`, `validate-evolution`. No feedback rounds — running in conversational mode per project config, submitting directly for the manager's/MANdy's review rather than opening a PR.
