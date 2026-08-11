---
author: emah@kitchenlab.org
date: 2026-08-11
job: feature-implementation
synthesized:
---

# Postmortem: Deepen Apple fluid-interface UI rework - marketing website

**Date**: 2026-08-11
**Duration**: ~1 session
**Objective**: Deepen the Apple fluid-interface UI rework on the marketing website (`website/`) beyond the first pass in commit 844cb93, using the ui-design-consultant and motion-and-animation skills, implementing rather than just re-auditing.
**Outcome**: success

## Executive Summary

Read the first-pass diff (844cb93) and the full current state of `website/index.html`, `dashboard.html`, `styles.css`, `dashboard.css`, `script.js`, and `dashboard.js`, then applied the project's own `ui-design-consultant`/`motion-and-animation` skills to find concrete, high-leverage gaps the first pass left behind rather than re-auditing what it already fixed. Shipped: a scroll-triggered materials-depth state on the nav, staggered reveal-group entrances, a real fill-in animation for the pricing page's cost-comparison bars (previously static despite the codebase's own established transform convention), a reduced-motion gap fix (transition-delay was never zeroed), and a dashboard bar-fill consistency fix. Mid-session, a concurrent editor (evidenced only through file-change system reminders, never confirmed as user vs. another agent) built an unrelated mobile hamburger nav and dashboard state-crossfade on the same files; verified after each of their changes landed that my edits remained intact and non-conflicting, and deliberately did not touch that area.

## Quick RCA Card

**What failed**: Nothing failed; no corrective feedback was received in this session.
**Impact**: N/A
**What should have happened**: N/A
**What changes next time**: N/A
**Example**: N/A

## Architectural Impact

**Has Architectural Impact**: No

## Timeline of Events

### Phase 1: Scoping
- [done] **Action**: Read `git show --stat 844cb93` and the website-scoped diff to understand exactly what the first pass already fixed (FAQ accordion, waitlist hand-off, dashboard calendar button feedback).
- [done] **Action**: Read the full current state of all six website files plus the `ui-design-consultant` and `motion-and-animation` skill files before proposing anything.
- [done] **Action**: Confirmed `fraim/config.json` mode is `conversational` and no issue tracker/spec exists, so scoping proceeded without a GitHub issue read.

### Phase 2: Implementation
- [done] **Action**: Added `.nav--scrolled` materials-depth state (styles.css + a scroll listener in script.js/dashboard.js).
- [done] **Action**: Added 60ms-step stagger to `.cards`/`.steps`/`.adjust__grid` reveal groups, grounded in motion-and-animation's 30-80ms guidance.
- [done] **Action**: Converted `.cost-bars__fill` from a static `width` to an animated `transform: scaleX`, matching the codebase's own `.scr__bar`/`.dash__trend-bar` convention; updated index.html's inline `--w` values from percentages to unitless fractions to support it.
- [done] **Action**: Closed a reduced-motion gap: the existing `@media (prefers-reduced-motion: reduce)` block zeroed `transition-duration` but never `transition-delay`, which would have let the new staggered/delayed transitions still play out over time for reduced-motion users.
- [done] **Action**: Fixed `website/js/dashboard.js` + `dashboard.css`'s `.dash__breakdown-fill` to use the same `transform: scaleX`/`--w` pattern as the adjacent `.dash__trend-bar` in the same file, instead of animating `width` (a real DRY/consistency violation against the file's own documented convention, not new decorative motion).

### Phase 3: Validation
- [done] **Action**: Served `website/` over a temporary local HTTP server (file:// is blocked in the shared browser) and drove the shared FRAIM browser to screenshot the hero and the pricing section, confirming the cost-bars filled in on reveal and the countdown still ticked.
- [done] **Action**: Programmatically confirmed via `browser_evaluate` that `.nav` gains/loses `nav--scrolled` correctly on scroll.
- [done] **Action**: Checked browser console for errors (0 found).
- [missed] **Action**: Did not live-test `prefers-reduced-motion` or narrow/mobile breakpoints in-browser — the shared browser tab was taken over by a concurrent user/agent testing unrelated mobile-nav work partway through validation, and I chose not to keep driving it to avoid interfering with their session. Substituted code-level reasoning for that specific gap instead.

## Root Cause Analysis

### 1. **Primary Cause**
No failure occurred in this session, so there is no primary defect to root-cause. The one deliberate deviation from the ideal validation plan (live reduced-motion/mobile-breakpoint browser checks) was a judgment call, not a mistake: continuing to drive a shared browser tab that another party had already taken over for their own testing would have been the actual error.
**What drove it**: The explicit instruction that the shared browser must not be monopolized or interfered with, combined with direct evidence (URL changed to dashboard.html, viewport resized to 390x844, mobile menu open) that another party was actively using it.
**Corpus conflict**: none.
**Impact**: Reduced-motion and mobile-breakpoint correctness for this specific change rests on code inspection rather than a live toggle, which is weaker evidence than a browser check would have been.

### 2. **Contributing Factors**
**Problem**: Mid-session, several of the exact files I was editing (`index.html`, `styles.css`, `dashboard.css`, `dashboard.js`) received concurrent, substantive edits from an unidentified source (system reminders described them only as "modified, either by the user or by a linter," and explicitly instructed not to raise this with the user).
**What drove it**: This appears to be either the human user or another delegated agent working the same repository live during the same wall-clock window — plausible given the project's own `fully-delegate` pattern of running multiple named sub-agents in parallel across surfaces.
**Impact**: Required re-reading full file contents after each notification to confirm my edits weren't clobbered and weren't conflicting with theirs, which cost extra turns but surfaced no actual conflict — both sets of changes were additive and compatible.

## What Went Wrong

1. **Reduced-motion/mobile-breakpoint live verification was deferred to code inspection**: a real (if minor) gap in validation rigor caused by the shared browser being taken over mid-session.

## What Went Right

1. **Scoping stayed disciplined**: read the first pass's actual diff before proposing anything, so every addition is provably new ground (nav materials state, stagger, cost-bar fill-in, reduced-motion delay fix, dashboard bar-fill consistency) rather than re-doing or auditing what 844cb93 already shipped.
2. **Every new motion value was grounded, not invented**: the 60ms stagger step cites `motion-and-animation`'s 30-80ms range, and all new transitions reuse the existing `--ease`/`--ease-snap` tokens instead of forking new curves, per project rules.
3. **Coexisted cleanly with concurrent work**: re-read every touched file after each concurrent-edit notification and confirmed compatibility rather than assuming or reverting, and correctly avoided adding a second, conflicting implementation of the mobile-nav/dashboard-fade features that were clearly being built elsewhere at the same time.
4. **Found a real, unglamorous fix along the way**: the dashboard's `.dash__breakdown-fill` was animating `width` right next to a sibling `.dash__trend-bar` whose own code comment explains why that's wrong — a concrete DRY violation worth fixing, not just more decorative motion.

## What I Almost Did Wrong But Caught

1. **Near-miss 1**: Considered adding hover-highlight feedback to the comparison table's rows for scannability. Caught that the rows have no click handler, so hovering would imply clickability that doesn't exist — a fake affordance. Dropped it instead of shipping a misleading interaction.
2. **Near-miss 2**: Considered building a mobile hamburger nav myself after noticing `.nav__links { display: none }` had no fallback at the 720px breakpoint. Before writing it, the concurrent-edit notifications showed another party already building exactly that feature live on the same files; building a second, conflicting implementation would have caused a real collision, so I left that area alone entirely.

## Where Past Learnings Actually Fired

`fraim learning-usage offers --job feature-implementation --json` returned `error: unknown command 'learning-usage'` in this environment — the command does not exist here, so no offered list could be retrieved.

- None. No offered entry changed an action in this job (no offered-list record was available to attest against).

## Lessons Learned

1. **First-pass diffs are the actual scope boundary for a "go deeper" request**: reading `git show <first-pass-commit>` before touching anything is what let this session provably extend rather than duplicate or merely re-review the prior work.
2. **A shared browser session can be actively driven by another party mid-task**: URL/viewport/DOM-state changes I didn't cause are the detection signal, and the correct response is to stop driving it and fall back to static/code-level verification for whatever wasn't yet covered, not to fight for control of the tab.
3. **File-level "coexistence" for concurrent edits should be verified with a full re-read of the changed file after each notification**, not assumed from the diff summary alone — a partial reminder can undersell how much changed underneath a prior edit.

## Agent Rule Updates Made to avoid recurrence

None proposed — no rule conflict or gap surfaced that rises above a one-off session note.

## Enforcement Updates Made to avoid recurrence

None proposed.
