# Fully Delegate: Deepen the Apple Fluid-Interface UI Rework (App, Website, Box)

**Status: DRAFT - Requires Human Approval**

## Executive Summary

Goal: go beyond commit `844cb93`'s first Apple fluid-interface pass across all three UI
surfaces (companion app, marketing website, on-device box) using the newly-integrated
`ui-design-consultant`/`motion-and-animation`/`expo-react-native-dev` skills, per
explicit manager coaching to deepen rather than just audit that first pass.

The work was decomposed into three independent `feature-implementation` tasks (one per
surface, disjoint files, no dependency edges) and run in one parallel layer. The repo is
in FRAIM conversational mode, so no branch, commit, or pull request exists for any
task; all review happened in this thread against the working tree directly.

Overall confidence: **medium**. All three surfaces shipped real, verifiable
improvements and every technical claim was independently checked against the actual
diff (not taken on any sub-agent's report alone). The medium rating, not high, is
because of a genuine process fault during execution: MANdy spawned a duplicate,
unbriefed set of Agent-tool sub-agents on top of the Hub's own real orchestration of the
same ledger, causing three-way file collisions on every surface. All collisions were
verified non-destructive, but one duplicate agent's output (a complete, unclaimed mobile
hamburger-nav and dashboard state-crossfade) was never attributed or evidenced by any
reviewed workstream and needs an explicit human keep/remove decision. See `docs/retrospectives/`
for this run and `fraim/personalized-employee/learnings/raw/emah@kitchenlab.org-2026-08-11T20-00-00-avoid-duplicate-subagent-spawn-in-fully-delegate.md`
for the full root-cause writeup.

## Delegation Ledger

Orchestrator: MANdy, running `fully-delegate`.

| Task ID | Job | Persona | Depends On | Result | Iterations |
| --- | --- | --- | --- | --- | --- |
| `app-ui-rework` | `feature-implementation` | mobile-dev | none | verified complete | 1 |
| `website-ui-rework` | `feature-implementation` | web-dev | none | verified complete | 2 (manager wrote the missing evidence file after non-resubmission) |
| `box-ui-rework` | `feature-implementation` | firmware-dev | none | verified complete, pending human hardware validation | 1 |

## Sub-Agent Outputs

### app-ui-rework

- Files changed: `app/App.tsx`, `app/src/ui/useReducedMotion.ts`, `app/src/screens/CalendarScreen.tsx`, `app/src/screens/CustomLabelsSection.tsx`, `app/src/screens/DashboardScreen.tsx`, `app/src/screens/StatsScreen.tsx`
- Evidence: `docs/evidence/apple-fluid-interface-companion-app-feature-implementation-evidence.md`
- Retrospective: `docs/retrospectives/emah@kitchenlab.org-session-2026-08-11-deepen-apple-fluid-ui-companion-app.md`
- Pull request: none (conversational mode)
- Manager verdict: accepted, iteration 1

Closed a real accessibility gap: 6 `LayoutAnimation` call sites and 2 progress-fill
`Animated.timing` animations were ignoring the OS reduced-motion setting despite
844cb93 wiring `useReducedMotion()` into press feedback elsewhere. Added one shared
`configureLayoutAnimation()` helper instead of six inline checks, and added one new,
skill-grounded motion (directional slide+fade on calendar month navigation).
Independently verified by MANdy: `tsc --noEmit` clean, jest 8/8 suites (60/60 tests)
passing, and a repo-wide grep confirming zero remaining unguarded
`LayoutAnimation.configureNext` calls outside the new helper.

**Risk area**: this workstream's own evidence file discloses that a sibling workstream
was editing the same shared `app/` files concurrently (App.tsx, CalendarScreen.tsx,
SettingsScreen.tsx, tokens.ts). Verified non-destructive by re-running typecheck/tests
after the collision; see Duplicate Spawn Collision below for the root cause.

### website-ui-rework

- Files changed: `website/css/styles.css`, `website/js/script.js`, `website/css/dashboard.css`, `website/js/dashboard.js`, `website/index.html`, `website/dashboard.html`
- Evidence: `docs/evidence/deepen-apple-fluid-interface-website-feature-implementation-evidence.md` (**authored by MANdy**, not the delegated sub-agent - see below)
- Retrospective: `docs/retrospectives/emah@kitchenlab.org-session-2026-08-11-deepen-apple-fluid-interface-website.md`
- Pull request: none (conversational mode)
- Manager verdict: accepted, iteration 2

Shipped a scroll-triggered materials-depth nav state, a 60ms reveal-group stagger
(grounded in the motion skill's 30-80ms guidance), converted the pricing page's
cost-comparison bars from static `width` to animated `scaleX` (matching the codebase's
own established transform convention), closed a reduced-motion gap (`transition-delay`
was never zeroed, only `transition-duration`), and fixed a DRY violation where the
dashboard's breakdown bar animated `width` right next to a sibling that correctly used
`transform`. Every claim independently verified against the diff.

**Risk area / iteration 2**: the sub-agent's own report and retrospective were accurate,
but it never produced the evidence file `feature-implementation`'s `implement-submission`
phase requires. After one coaching round produced no resubmission, the human directed
MANdy to write the evidence file directly rather than continue waiting; MANdy did so
using the sub-agent's already-verified retrospective and its own independent diff
checks as the source, not fabricated content. **The human should scrutinize**: this
evidence file was manager-authored, not sub-agent-authored - a deviation from the normal
review flow, done only because the underlying technical claims were already
independently verified before the human's instruction.

### box-ui-rework

- Files changed: `firmware/lib/lock_config.py`, `firmware/lib/lock_controller.py`, `firmware/lib/lock_ui.py`, `firmware/lib/lock_motion.py` (new)
- Evidence: `docs/evidence/deepen-apple-fluid-ui-box-feature-implementation-evidence.md`
- Retrospective: `docs/retrospectives/emah@kitchenlab.org-session-2026-08-11-deepen-apple-fluid-ui-box.md`
- Pull request: none (conversational mode)
- Manager verdict: accepted, iteration 1, **pending human hardware validation**

Added a small critically-damped spring (`lock_motion.py`), spring-eased press-depth
feedback on the button and status-bar press rings, a springed "pop" on the `UNLOCKED`
success message, and a visible bump on every override-counter press (previously zero
motion on the most repetitive physical interaction on the device). Correctly declined
to build a cross-view slide transition (needs an unverified `displayio.Group.x/y` API
in the same run loop that polls the physical override button - a wrong guess there
risks the emergency-unlock path, not just a visual glitch) and settings ±-button press
feedback (deferred to keep the diff reviewable). Caught and fixed a real bug
(`Spring.set()` called a method that doesn't exist) before finishing. Independently
verified by MANdy: no stray broken call remains, all four touched/new files parse as
valid Python, and the run loop's touch-first/CPU-frequency-guard/BLE-last ordering is
untouched.

No physical board was available to any agent this session, consistent with this
project's rules (firmware only validates on-device). **Needed from the human**:
deploy to the physical board (batch-write all changed files, then sync, no
unplug/replug) and confirm the press feel, success pop, override bump, and the
concurrent color-transition-engine's eases (see below) all read as intended.

## Duplicate Spawn Collision (process risk, not a code defect)

After emitting the delegation ledger, MANdy also spawned three Agent-tool background
agents directly (named `app-ui-rework`, `website-ui-rework`, `box-ui-rework`), not
realizing the FRAIM Hub's own orchestration layer was independently spawning its own
real child agents (the `mobile-dev`/`web-dev`/`firmware-dev` personas reviewed above)
from that same ledger. This produced six agents, not three, editing the same three
surfaces concurrently with no worktree isolation (conversational mode). All three
duplicate collisions were independently verified as non-destructive:

- **App**: no lines were clobbered; typecheck/tests re-run and still pass.
- **Box**: the real `firmware-dev` workstream detected a concurrent "color-transition
  engine" on `lock_ui.py`/`lock_config.py`, paused, waited for it to settle, and verified
  attribute-disjointness (`.fill`/`.color` vs `.y`/`.anchored_position`) before merging.
  That contribution is now part of the accepted box diff and evidence file above.
- **Website**: the real `web-dev` workstream found a complete, unclaimed mobile
  hamburger-nav (`website/js/nav.js`, new file, plus matching markup/CSS in both HTML
  pages) and a dashboard state-crossfade (`.dash__fade`/`is-in`), neither built by any
  reviewed workstream. MANdy independently reviewed this code: it is well-implemented
  (proper ARIA state, escape/click-outside handling, breakpoint reset, no new
  dependency, reuses the existing accordion CSS technique) and does not overlap the
  reviewed workstream's own changes. **This is disclosed but not yet approved.**

MANdy's own three duplicate spawns were later reported by the harness as "stopped, no
completion record found" - consistent with them being the orphaned source of the
box color-transition engine and the website hamburger-nav/crossfade, both of which
landed in the shared working tree before their spawning agents died mid-session. Full
root-cause writeup: `fraim/personalized-employee/learnings/raw/emah@kitchenlab.org-2026-08-11T20-00-00-avoid-duplicate-subagent-spawn-in-fully-delegate.md`.

## Missing Evidence

None outstanding. `website-ui-rework`'s evidence file was missing at review time and
has since been written (by MANdy, disclosed above) rather than left absent.

## Files Changed (full set, this delegation)

- `app/App.tsx`, `app/src/ui/useReducedMotion.ts`, `app/src/screens/CalendarScreen.tsx`, `app/src/screens/CustomLabelsSection.tsx`, `app/src/screens/DashboardScreen.tsx`, `app/src/screens/StatsScreen.tsx`
- `website/css/styles.css`, `website/js/script.js`, `website/css/dashboard.css`, `website/js/dashboard.js`, `website/index.html`, `website/dashboard.html`, `website/js/nav.js` (new, unclaimed - see above)
- `firmware/lib/lock_config.py`, `firmware/lib/lock_controller.py`, `firmware/lib/lock_ui.py`, `firmware/lib/lock_motion.py` (new)

## Catalog Job Coverage

`feature-implementation` fully covered all three tasks. No gap in the FRAIM job catalog
was exposed. The real signal from this run is the duplicate-spawn process fault above,
captured as a coaching moment for `sleep-on-learnings` to evaluate, not a catalog gap.

## Human Approval Checklist

- [ ] Approve the app workstream's changes (reduced-motion gating + calendar month-nav
  transition). No open questions.
- [ ] Approve the website workstream's changes (nav scroll state, reveal stagger,
  pricing-bar animation, reduced-motion delay fix, dashboard bar-fill consistency fix).
  No open questions.
- [ ] **Decide the fate of the unclaimed mobile hamburger-nav + dashboard crossfade**
  (`website/js/nav.js` and related markup/CSS/JS) - keep it as a bonus fix to a real
  pre-existing mobile-nav gap, or remove it since it was never part of the original
  brief. MANdy's read: keep it (it is correct, complete, and closes a genuine gap), but
  this is the human's call since it bypassed normal review.
- [ ] Approve the box workstream's changes, **contingent on**: deploy to the physical
  board (batch-write all changed files, then sync, no unplug/replug) and confirm the
  press feel, success pop, override-counter bump, and the color-transition eases all
  read as intended. Nothing should be considered final for the box until this happens.
- [ ] Decide whether to also review/approve the box workstream's absorbed
  "color-transition engine" contribution (state-change color eases on the status bar
  and clock readout) - it is now part of the accepted box diff, same disclosure basis
  as the website hamburger-nav.
- [ ] (Unrelated to this delegation, previously flagged) The stray untracked
  garbage-named files sitting in the repo root and under `app/` - still un-cleaned;
  confirm whether to remove them.
