# Fully Delegate: Port UI and Animation Skills into FRAIM, Add Mobile Dev Skills

**Status: Approved (2026-08-11)**

## Executive Summary

Goal: port the installed Claude Code UI design and animation skills into this
project's FRAIM personalized layer, merging with existing FRAIM UI skill
content where it overlaps, and add FRAIM skills for Expo and React Native
mobile development to close a gap versus the existing ios, android, and
mobile skills (which cover store compliance and post build validation, not
day to day UI build work).

Manager coaching resolved the initial scope question toward breadth and
merge: port broadly rather than narrowly, and favor the richer Claude skill
content over FRAIM's thinner native stubs.

The work was decomposed into three independent tasks, all run through the
`evolve-employee` FRAIM job (the catalog job whose intent matches authoring
new or updated employee capability artifacts), and executed in one fully
parallel layer since each touches a disjoint set of files. The repo is in
FRAIM conversational mode (`fraim/config.json`), so no branch, commit, or
pull request was created for any task; all review happened in this thread
against the files directly.

Overall confidence: medium. Two of three tasks passed manager review on the
first iteration. The third required one correction round after independent
review (not the sub agent's own report) found a dangling cross reference and
an out of scope edit to a shared rules file; the correction was verified
independently afterward and passed.

## Delegation Ledger

Orchestrator: MANdy, running `fully-delegate`.

| Task ID | Job | Depends On | Result |
| --- | --- | --- | --- |
| `port-ui-design-skill` | `evolve-employee` | none | verified complete, iteration 2 |
| `port-animation-skill` | `evolve-employee` | none | verified complete, iteration 1 |
| `add-mobile-dev-skill` | `evolve-employee` | none | verified complete, iteration 1 |

## Sub-Agent Outputs

### port-ui-design-skill

- Artifact: `fraim/personalized-employee/skills/ux-design/ui-design-consultant.md`
- Sub-agent evidence file: `docs/evidence/port-ui-design-skill-evolve-employee-evidence.md`
- Sub-agent retrospective: `docs/retrospectives/session-2026-08-11-port-ui-design-skill.md`
- Pull request: none (conversational mode)
- Iterations: 2
- Manager verdict: accepted on iteration 2

Merged nineteen Claude Code UI and design skills (apple-design, impeccable,
ui-styling, design, redesign-skill, minimalist-skill, brutalist-skill,
soft-skill, taste-skill, taste-skill-v1, emil-design-eng, stitch-skill,
gpt-tasteskill, ui-ux-pro-max, mobile-app-ui-design, pick-ui-library,
prototype, and the two imagegen skills where in scope) into one design taste
consultant skill, scoped to this project's two real UI surfaces: the
marketing website and the Expo companion app. It cross-references the three
existing synced FRAIM ux-design skills by name instead of duplicating them.

**Risk area, iteration 1 failure.** Manager review (not the sub agent's own
report) found two defects before acceptance:

1. A dangling cross reference: the skill pointed to a sibling skill named
   `expo-native-ui-patterns`, which was never created. The real file, created
   by the sibling mobile task, is `expo-react-native-dev.md`.
2. An out of scope edit: the same sub agent's diff to the shared
   `fraim/personalized-employee/rules/project_rules.md` added a large,
   unrequested policy bullet about using `graphify` before every phase of
   every future FRAIM job. That was never part of this delegation's brief and
   is a repository wide instruction change well beyond porting three skills.

A targeted correction naming both defects precisely was sent to the same sub
agent rather than a fresh run. The correction was verified independently by
the manager with a direct search of the files (not by trusting the sub
agent's report): zero remaining references to `expo-native-ui-patterns`
anywhere under `fraim/personalized-employee/`, and zero mentions of
`graphify` in `project_rules.md`. The three legitimate skill wiring bullets
and the Ruflo clarification bullet remained intact. Iteration 2 accepted.

**What the human should scrutinize:** confirm the removed `graphify` bullet
was correctly out of scope for this delegation. If the graphify usage policy
is actually wanted, it should be requested and delegated as its own task
rather than reintroduced silently.

### port-animation-skill

- Artifact: `fraim/personalized-employee/skills/ux-design/motion-and-animation.md`
- Sub-agent evidence file: `docs/evidence/port-animation-skill-evolve-employee-evidence.md`
- Sub-agent retrospective: `docs/retrospectives/session-2026-08-11-port-animation-skill.md`
- Pull request: none (conversational mode)
- Iterations: 1
- Manager verdict: accepted on iteration 1

Merged thirteen Claude Code animation and GSAP skills (animate,
find-animation-opportunities, improve-animations, review-animations, the
eight gsap-* skills, and apple-design's motion sections) into one motion and
animation skill. There was no existing FRAIM animation skill to merge into,
so this is a net new artifact. The manager independently read the full file
and confirmed it is scoped to the two real motion surfaces after checking
actual repository state: the website has no bundler or GSAP dependency
(framed as CDN script tag usage), and the Expo app uses React Native core
`Animated`, not `react-native-reanimated` (framed as a proposed addition,
not assumed present). Deliberately excluded `animation-vocabulary` (a naming
glossary with no operational content) and the React specific GSAP variants
(inapplicable, no JS framework on the website).

### add-mobile-dev-skill

- Artifact: `fraim/personalized-employee/skills/mobile/expo-react-native-dev.md`
- Sub-agent evidence file: `docs/evidence/add-mobile-dev-skill-evolve-employee-evidence.md`
- Sub-agent retrospective: `docs/retrospectives/session-2026-08-11-add-mobile-dev-skill.md`
- Pull request: none (conversational mode)
- Iterations: 1
- Manager verdict: accepted on iteration 1

Merged relevant Claude Code Expo skills (expo-router, expo-native-ui,
expo-ui, expo-data-fetching, expo-project-structure, expo-dom, ask-sonner;
expo-tailwind-setup was checked and excluded) into a new skill anchored to
this app's actual code rather than generic Expo guidance. The manager
independently read the full file and confirmed it correctly documents the
app's real, deliberately dependency light conventions (hand rolled tab
switcher in `App.tsx`, `AnimatedPressable`, `theme/tokens.ts`, Firestore sync
and the BLE protocol client as the app's real data channels) and hands off
cleanly to the existing synced validation skill instead of duplicating it.
It also surfaced one genuine inconsistency found in the code, a legacy
shadow prop usage against current Expo guidance, and documented it rather
than silently rewriting it.

## Missing Evidence

None. All three sub-agent evidence files and retrospectives exist and are
non-empty.

## Files Changed

- `fraim/personalized-employee/skills/ux-design/ui-design-consultant.md` (new)
- `fraim/personalized-employee/skills/ux-design/motion-and-animation.md` (new)
- `fraim/personalized-employee/skills/mobile/expo-react-native-dev.md` (new)
- `fraim/personalized-employee/rules/project_rules.md` (modified: three
  skill wiring bullets and a Ruflo clarification added; the graphify usage
  bullet was removed as out of scope during iteration 2 review, then
  restored on explicit manager coaching after submission, see checklist below)

No file under `fraim/ai-employee/` was touched by any sub agent, confirmed by
the manager independently, not only by sub agent assertion.

## Catalog Job Coverage

`evolve-employee` fully covered all three tasks. No gap in the FRAIM job
catalog was exposed by this run. This signal, and the one correction round,
are left for `sleep-on-learnings` to evaluate in aggregate rather than acted
on directly here.

## Human Approval Checklist

- [x] Approve the new skill `ui-design-consultant.md` and its wiring into
  `project_rules.md`. Approved 2026-08-11.
- [x] Approve the new skill `motion-and-animation.md` and its wiring into
  `project_rules.md`. Approved 2026-08-11.
- [x] Approve the new skill `expo-react-native-dev.md` and its wiring into
  `project_rules.md`. Approved 2026-08-11.
- [x] Graphify usage policy bullet: manager reviewed this as out of scope for
  the skill-porting brief and removed it during iteration 2. The human
  overrode that judgment with explicit coaching ("graphify needs to be in
  project rules keep it"), so the bullet has been restored verbatim in
  `project_rules.md`. No further action needed; noted here as a resolved
  disagreement between manager judgment and human intent, for
  `sleep-on-learnings` to consider (the manager's scope read differed from
  what the human actually wanted).
- [x] Decided 2026-08-11: keep the three skills local to this project only.
  `contribute-to-fraim` was run; at the confirm-contribution-package step the
  human was asked whether to contribute as-is, generalize first, or skip, since
  all three skills are heavily anchored to Phone Box specifics (file paths,
  product decisions) that would not generalize cleanly to a shared catalog
  entry. Human chose to skip. No GitHub issue was filed.
