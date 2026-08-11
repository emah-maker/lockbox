# Feature Implementation Evidence — Deepen Apple fluid-interface UI rework (marketing website)

Issue: none (conversational-mode workstream, no issue tracker configured for this repo)
Tech Spec: none (delegated workstream continuing commit 844cb93's design direction)
PR: none (conversational mode — changes live on `master` in this working copy for manager review)

Written by MANdy (manager), not the delegated web-dev sub-agent, after that sub-agent
reported its work complete but never produced this file. The technical content below
was independently verified against the actual diff rather than taken on the sub-agent's
report alone; see `docs/retrospectives/emah@kitchenlab.org-session-2026-08-11-deepen-apple-fluid-interface-website.md`
for the sub-agent's own first-person account, which was read and found accurate.

## Work List

### Scope
- [x] `website/css/styles.css` / `website/js/script.js` — `.nav--scrolled` materials-depth state on scroll, rAF-throttled - Implemented
- [x] `website/css/styles.css` — 60ms-step stagger on `.cards`/`.steps`/`.adjust__grid` reveal groups - Implemented
- [x] `website/css/styles.css` / `website/index.html` — pricing page cost-comparison bars converted from static `width` to animated `scaleX` on scroll-reveal - Implemented
- [x] `website/css/styles.css` — reduced-motion block extended to zero `transition-delay` (previously only zeroed `transition-duration`) - Implemented
- [x] `website/css/dashboard.css` / `website/js/dashboard.js` — `.dash__breakdown-fill` converted from `width` to `transform: scaleX(var(--w))`, matching the sibling `.dash__trend-bar` convention in the same file - Implemented

### Validation Requirements
- `uiValidationRequired`: Yes — browser-verified for hero/pricing/nav-scroll behavior via the shared FRAIM browser (temporary local HTTP server, since `file://` is blocked there); confirmed cost-bars fill on reveal, nav gains/loses `nav--scrolled` on scroll, zero console errors. Live `prefers-reduced-motion` and mobile-breakpoint toggling were **not** browser-verified — the shared browser tab was taken over mid-session by a concurrent editor's own testing, and the sub-agent chose not to contest it. Substituted with source-level verification instead (see below).
- `mobileValidationRequired`: N/A (this workstream did not build the mobile nav — see Concurrent Contribution below).
- Required suites/modes: no build/lint/test script exists for this static site; validation is browser + source inspection only.

### Decisions
- **Scope: extend past 844cb93's first pass, not re-audit it.** 844cb93 covered the FAQ accordion, waitlist hand-off, and dashboard calendar buttons. This pass targeted concrete gaps those left open: no scroll-response on the nav, ungrouped/simultaneous reveal-group entrances, static pricing bars despite the codebase's own established transform convention, an incomplete reduced-motion gate, and one file-internal DRY violation (`dashboard.js`'s breakdown bar animating `width` next to a sibling that correctly uses `transform`).
- **Stagger value grounded in the skill, not invented**: 60ms sits inside `motion-and-animation.md`'s documented 30–80ms stagger-step guidance.
- **Reused existing easing tokens** (`--ease`, `--ease-snap`) rather than forking new curves for any of the five changes.
- **No new dependency, no bundler introduced** — the site remains plain CDN-script JS, consistent with `motion-and-animation.md`'s documented constraint for this project.
- **Did not build a mobile hamburger nav**, despite noticing the same gap (`.nav__links { display: none }` with no fallback at the 720px breakpoint) — a concurrent, unidentified editor was observed building exactly that live on the same files; building a second implementation would have collided. See Concurrent Contribution below.

### Concurrent Contribution (discovered mid-session, not this workstream's own work)
Partway through, `website/index.html`, `styles.css`, `dashboard.css`, and `dashboard.js` received substantive concurrent edits from an unidentified source. The sub-agent re-read each affected file after every such change and confirmed its own edits were never clobbered and never conflicted. That contribution — now present in the working tree — added:
- `website/js/nav.js` (new file) and matching markup/CSS: a complete mobile hamburger-nav toggle (ARIA `aria-expanded` state, escape-key close, click-outside close, breakpoint reset), reusing the existing `.acc__panel` grid-rows collapse technique rather than forking a new one.
- A dashboard state-crossfade (`.dash__fade`/`is-in` in `dashboard.css`/`dashboard.js`): the five mutually-exclusive dashboard state containers (`notConfigured`/`signedOut`/`loading`/`error`/`content`) now fade/settle in via `showState()` instead of an instant `hidden`-attribute snap, reusing the same opacity/translateY pattern as the existing waitlist hand-off.

MANdy independently reviewed this contribution: it is well-implemented, adds no dependency, is wired correctly into both `index.html` and `dashboard.html`, and does not overlap the attributes this workstream touched. Its origin is most likely MANdy's own earlier duplicate Agent-tool spawn of this same task, which never reported back before the session that spawned it was interrupted (task-notification recorded it as "stopped, no completion record"). It is disclosed here for the audit trail rather than silently folded into this evidence file as if the web-dev workstream had authored it — **the human should decide whether to keep it**, since it was not part of the original delegation brief.

## Validation Results

| Validation Step | Validation Result | Failure Analysis |
|---|---|---|
| Browser check: hero countdown, pricing bars fill on scroll-reveal, nav scroll state, console errors | Pass (0 console errors) | — |
| `prefers-reduced-motion` live toggle | Not performed | Shared browser tab taken over mid-session by concurrent testing; see Concurrent Contribution |
| Mobile-breakpoint live check | Not performed | Same reason as above |
| MANdy independent re-verification: `git diff` inspection of all 5 claimed changes against `styles.css`/`script.js`/`dashboard.css`/`dashboard.js`/`index.html` | Pass — `.nav--scrolled` + scroll listener present; `:nth-child` stagger delays (0.06s/0.12s/0.18s/0.24s/0.3s) present; `.cost-bars__fill` uses `transform-origin:left; transform:scaleX(var(--w))`; reduced-motion block includes `transition-delay: 0s !important`; `.dash__breakdown-fill` uses `transform:scaleX(var(--w))` matching `.dash__trend-bar` | — |

### Diff Size
```
 website/css/dashboard.css | 15 +++++++-
 website/css/styles.css    | 97 ++++++++++++++++++++++++++++++++++++++++++-----
 website/dashboard.html    | 26 ++++++++-----
 website/index.html        | 35 ++++++++++-------
 website/js/dashboard.js   | 40 ++++++++++++++++++-
 website/js/script.js      | 68 +++++++++++++++++++++++++++++++--
 6 files changed, 242 insertions(+), 39 deletions(-)
```
(Includes both this workstream's changes and the concurrent contribution described above, since both landed in the same shared working tree with no per-workstream isolation in conversational mode.)

## Bug Bash Findings
- Grep-verified this workstream introduced no `react-native-reanimated`/build-step/new-dependency import.
- No overlap between this workstream's changed selectors/attributes and the concurrent contribution's (`nav.js`, `.dash__fade`) — confirmed by direct diff read, not assumed.
- 0 Critical/High issues found. 1 disclosed validation gap (live reduced-motion/mobile-breakpoint check), not a defect.

## Security Review
No new data collection, logging, or dependency. All changes are CSS/JS visual/motion wiring on a static marketing site with no user input handling in the touched code. 0 findings.

## Pre-Completion Reflection (MANdy, on behalf of this evidence file)
This file was written by the manager rather than the delegated sub-agent because the sub-agent's own report and retrospective were accurate and independently verifiable, but never produced the evidence file the job's `implement-submission` phase requires. All claims above were checked against the actual `git diff`, not taken from the report alone. The one open item (on-device/live reduced-motion check, and the human's decision on the concurrent hamburger-nav contribution) is carried forward to the parent `fully-delegate` synthesis rather than closed here.
