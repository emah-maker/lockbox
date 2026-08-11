# Evidence: motion-and-animation-skill (evolve-employee)

## Summary
- Issue/task: `motion-and-animation-skill` (delegation ledger, jobId `evolve-employee`)
- Workflow type: FRAIM `evolve-employee` (evolution mode: `teach`)
- Description: Added a new repo-level FRAIM skill teaching motion/animation
  design, implementation, and lightweight review for Phone Box's two real
  motion surfaces — the marketing website and the Expo companion app — a
  capability gap not covered by any existing FRAIM `ux-design`/`web` skill.

## Work Completed
- Created `fraim/personalized-employee/skills/ux-design/motion-and-animation.md`
  (new file, co-located with the sibling UI-design skill in progress in the
  same directory for the parent porting effort).
- Format matches the existing local precedent
  (`fraim/personalized-employee/skills/cad/3d-modelling-consultant.md`): plain
  markdown, no frontmatter, an intro plus one context section before the four
  canonical blocks (`### Skill Input` / `### Skill Output` / `### Skill Steps`
  / `### Skill Guardrails`).
- Added one bullet to `fraim/personalized-employee/rules/project_rules.md`
  pointing to the new skill, mirroring the existing `3d-modelling-consultant`
  bullet's reachability pattern.
- Content consolidates 13 source Claude Code skills rather than porting them
  1:1:
  - `animate` + `review-animations` + `find-animation-opportunities` +
    `improve-animations` → condensed into the frequency/purpose build gate
    (Steps 1-2) plus one single-pass "lightweight audit" step (Step 10),
    since the full multi-subagent audit-and-plan workflow those tools use is
    oversized for a two-surface hobby-scale project.
  - `gsap-core`, `gsap-timeline`, `gsap-scrolltrigger`, `gsap-plugins`,
    `gsap-performance`, `gsap-utils` → consolidated into one "GSAP Quick
    Reference" section, explicitly scoped to the website surface only.
  - `apple-design`'s interruptibility/spring/momentum/reduced-motion sections
    → folded into Steps 5, 8, and 9 (spring damping/response tables, velocity
    handoff, rubber-banding, reduced-motion).
  - Excluded `animation-vocabulary` (a naming/glossary lookup tool, orthogonal
    to the build/review workflow scoped here; this project has no vocabulary
    page to keep it in sync with).
  - Excluded `gsap-react` and `gsap-frameworks` (no JS component framework on
    either surface — the website is plain HTML/CSS/JS with no bundler, and
    the Expo app has no DOM).
- Grounded every surface-specific claim in the real codebase rather than
  generic advice: verified `website/css/styles.css`'s existing `--ease`/
  `--ease-snap` tokens, `.reveal` scroll-entrance class, and
  `prefers-reduced-motion` block; verified `app/src/ui/AnimatedPressable.tsx`
  and `useReducedMotion.ts` show the app deliberately uses RN core `Animated`
  only, with no `react-native-reanimated`/`gesture-handler` dependency — the
  skill tells the employee to extend these conventions and flag Reanimated as
  a new dependency proposal rather than assuming it.
- No files under `fraim/ai-employee/skills/` (synced, read-only) were touched.
- No git branch, commit, or PR created — `fraim/config.json` has
  `"mode": "conversational"` in this repo, so both files were edited directly
  in place per that mode's convention.

## Validation
- Ran the FRAIM `evolve-employee` job through all phases (`intake-request` →
  `diagnose-evolution` → `confirm-evolution-plan` → `apply-evolution` →
  `validate-evolution`) via `seekMentoring`.
- Discovery before authoring: confirmed via `Glob`/`Grep` that no existing
  skill under `fraim/ai-employee/skills/ux-design/` (`ui-baseline-validation`,
  `usability-test-protocol`, `user-flow-mapping`) or `fraim/ai-employee/skills/web/`
  covers motion/animation, before creating a net-new skill.
- `skills/fraim/capability-architecture-composition-review.md` checked (via
  subagent extraction of the full ~1710-line doc): a standalone Skill
  addition with no job changes has no blocking gate; the one applicable rule
  (canonical Skill sections only, no job-phase headers) is satisfied.
- `apply-evolution`/`validate-evolution` phase text checked (via subagent
  extraction of the ~3510-line `seekMentoring` response): confirmed the
  Skill-format contract (no frontmatter, four canonical `### Skill ...`
  blocks) and that no `validate-job-structure`/config/security gate applies
  since no job or config file changed.
- Format validated directly: file starts with `# Skill` (no `---`
  frontmatter block); the four canonical headings are present at consistent
  `###` level. Corrected one heading-level drift (`Skill Guardrails` was
  briefly `##`/`####` during a concurrent edit to this same file by a
  sibling task) back to `###` for consistency with the template.
- Content-rule scan: grepped both changed files case-insensitively for
  `emah|kitchenlab|C:\Users|AppData|northeastern.edu` — zero hits in either
  file. No manager-specific paths, accounts, or secrets in a Project-level
  artifact.
- Confirmed `fraim/ai-employee/` was not touched (only `fraim/personalized-employee/`
  files changed).

## Quality Checks
- Deliverables complete: one new skill file plus one rules-file
  cross-reference, at the planned paths.
- Every path and pattern referenced inside the skill (`website/css/styles.css`
  tokens, `app/src/ui/AnimatedPressable.tsx`) was read and confirmed to exist
  during this session, not asserted from memory.
- Complements, does not duplicate, the sibling UI-design skill this task's
  parent effort is also placing in `fraim/personalized-employee/skills/ux-design/`:
  the motion skill explicitly defers layout/color/component styling to that
  sibling rather than re-describing it.

## Phase Completion
All `evolve-employee` phases through `validate-evolution` completed with no
blocking findings. Proceeding to `submit` as a direct artifact handoff (no PR
— conversational mode).
