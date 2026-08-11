# Evidence: port-animation-skill (evolve-employee)

## Summary
- Issue/ledger item: `port-animation-skill` (delegated by MANdy, `fully-delegate` job, `evolve-employee`)
- Workflow type: FRAIM `evolve-employee`, mode `teach` (net-new capability)
- Description: Ported 13 installed Claude Code animation/motion skills (plus the
  motion sections of `apple-design`) into a single new repo-level FRAIM skill
  scoped to this project's two real motion surfaces — the plain HTML/CSS/JS
  marketing website and the Expo React Native companion app.

## Work Completed
- **File created**: `fraim/personalized-employee/skills/ux-design/motion-and-animation.md`
  (280 lines, net-new — no existing file touched or overwritten).
- **Format**: Matches the `3d-modelling-consultant.md` precedent exactly — no
  JSON frontmatter, title + intro paragraph, a "Surfaces & Tooling" reference
  table, then the four canonical Skill blocks (`### Skill Input`,
  `### Skill Output`, `### Skill Steps`, `### Skill Guardrails`) contiguous and
  correctly leveled.
- **Sources merged**: `animate` (should-it-animate gate, purpose naming, tool
  ladder, properties, easing/duration tables, interruption/exit, reduced
  motion), `find-animation-opportunities` (frequency/purpose/speed/function
  gate, reused for the lightweight audit step), `improve-animations` (audit
  table format and leverage ordering only, not its multi-phase subagent
  workflow), `review-animations` (its ten standards folded into guardrails),
  8 `gsap-*` skills (core/timeline/scrolltrigger/plugins/react/frameworks/
  performance/utils) deduplicated into one "GSAP Quick Reference" section,
  and `apple-design` (interruptibility, velocity handoff, momentum
  projection, rubber-banding, reduced motion — referenced and partially
  inlined, not duplicated wholesale).
- **Deliberately excluded**: `animation-vocabulary` (pure naming glossary,
  no operational content), `gsap-react` and `gsap-frameworks` (inapplicable —
  the website has no JS framework), the full `review-animations` rubric and
  full `improve-animations` multi-phase workflow (folded into one lightweight
  single-pass audit step sized to this project instead).
- **Grounding verification performed before writing**: confirmed via
  `app/package.json` and a grep of `app/src` that the Expo app has no
  `react-native-reanimated` dependency and already uses RN core `Animated`
  (`app/src/ui/AnimatedPressable.tsx`), and confirmed via directory listing
  that `website/` is plain HTML/CSS/JS with no `package.json`, bundler, or
  GSAP dependency — so the skill frames Reanimated as a proposed addition
  and GSAP as CDN-`<script>`-tag usage, not assumed tooling.
- **Grep-before-authoring check**: grepped `fraim/` for
  `animat|motion|gsap|reanimated` (case-insensitive) — only one prose mention
  in `project_context.md`, no existing skill/job/rule owns this workflow.
  Also globbed `fraim/ai-employee/skills/ux-design/` and
  `fraim/ai-employee/skills/web/` (read-only synced dirs) — neither contains
  motion content.
- **No files touched under `fraim/ai-employee/**`** (read-only synced tree) —
  confirmed by listing every file this session wrote or edited: only the new
  skill file and this evidence document.

## Feedback History
No feedback file exists yet for this issue.

## Validation
- Ran the FRAIM `evolve-employee` job's `diagnose-evolution` and
  `validate-evolution` phases via `seekMentoring`.
- Format self-check caught and fixed two issues before this evidence was
  written: `## Skill Guardrails` was at the wrong heading level (`##` instead
  of `###`), and the GSAP reference section was interrupting the four
  canonical Skill blocks. Both were corrected so the four blocks are
  contiguous and at the `###` level, matching the Skill-family format
  contract exactly (no `Intent`/`Outcome`/`Phases` anywhere — this is a
  Skill, not a Job).
- Grepped the final file for manager-specific values
  (`emah|C:\Users\|kitchenlab|token|secret|api[_-]key|password`,
  case-insensitive): no real hits (only a benign match on the word "tokens"
  in a sentence about design tokens). Confirms the project-level placement
  was correct — no de-personalization needed.
- Verified line count (280) is well under this repo's 500-line file cap.

## Quality Checks
- All six requested topics covered: whether/what to animate, tool choice per
  surface, sequencing/timelines, scroll- and gesture-driven motion,
  interruptibility, reduced-motion handling, lightweight audit method.
- GSAP plugin family heavily deduplicated into one practical reference
  section rather than restating each of the 8 `gsap-*` skills.
- Content correctly scoped to this project's two real motion surfaces
  (website vs. Expo app) rather than generic web-only advice.
- No `fraim/ai-employee/**` files modified.

## Phase Completion
- `intake-request`, `diagnose-evolution`, `confirm-evolution-plan`,
  `apply-evolution`, `validate-evolution` all completed this session via
  `seekMentoring`.
- Per the delegating manager's instruction, this repo's `fraim/config.json`
  mode is `conversational`: no git branch, commit, or pull request was
  created. This evidence document plus the new skill file are the complete
  deliverable for `submit`.
