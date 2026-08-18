---
reviewContext:
  subjectType: static-frontend-website
  subjectLabel: website/ (index.html, dashboard.html, css/, js/)
  reviewRef: master branch, website/ directory, 2026-08-17
  scopeSummary: >
    GSAP-animation-consistency, UX/polish, accessibility, and performance audit of the
    Phone Box marketing site and dashboard, dispatched via the production-readiness-review
    job template. That template's six infra dimensions (security posture, HA, backup/restore,
    observability, release safety, governance) do not apply to this static, backend-less
    frontend -- see Review Context below. Findings-only; no fixes applied.
  repoIdentifier: lockbox
  branchRef: master
---

# Website GSAP / UX / Accessibility / Performance Audit — 2026-08-17

## Executive Summary

GSAP has been added as a deliberately narrow progressive-enhancement layer on
`index.html` only (hero device boot-in, override-demo tick pops) — every call is
gated behind a `window.gsap` check with a plain-CSS fallback, and behind
`prefers-reduced-motion`. That scoping is intentional and documented in the code,
not an oversight, and it is a reasonable "frequency gate" choice per the
motion-and-animation skill. `dashboard.html`/`dashboard.js`/`nav.js` have zero
GSAP usage and don't even load the GSAP CDN script — this is consistent with the
GSAP layer being scoped to first-load marketing "delight" moments, not a partial
rollout of a site-wide motion system.

The one finding with real business/user impact is unrelated to GSAP: nearly all
of `index.html`'s content is gated behind a scroll-reveal animation
(`.reveal`) whose *only* code path to becoming visible is a JS
`IntersectionObserver`, with no `<noscript>` or timeout fallback. If that script
fails to run for any reason, the hero, all four feature cards, the four "how it
works" steps, all six "make it yours" settings, the comparison table, pricing,
and the waitlist CTA all stay permanently invisible. Everything else below is
accessibility/consistency/polish, not launch-blocking.

**Gate (informal, since infra dimensions don't apply):** flag — one high-severity
resilience gap in the reveal pattern, plus real accessibility issues on the
dashboard calendar.

## Review Context

- No backend or deploy pipeline is owned by this code: the marketing site is
  fully static/client-side (waitlist form has no backend — see `js/script.js`
  header comment), and `dashboard.html` only performs Firebase Google sign-in
  and **read-only** Firestore queries against documents the companion app
  writes.
- Because of the above, the production-readiness-review job's security
  posture / availability / backup-restore / observability / release-safety /
  governance dimensions are **not applicable** to this subject. This report
  substitutes the audit dimensions actually requested: GSAP/motion
  consistency, UX polish, accessibility, and performance.

## Findings

### 1. [HIGH] Nearly the entire homepage is invisible if the reveal script doesn't run
- **Where:** `website/css/styles.css:566-567` (`.reveal { opacity:0; transform:translateY(16px) }`), applied via the `reveal` class to hero copy/device, every section-head, all 4 pillar cards, all 4 "how it works" steps, all 6 "adjust" settings, the compare table, all pricing cards, and the waitlist section in `website/index.html`. The only path that reveals this content is `website/js/script.js:40-53` (the `IntersectionObserver` that adds `.in`).
- **Issue:** There is no `<noscript>` CSS override and no timeout-based safety reveal. If `js/script.js` is blocked, fails to load, or throws before line 40 runs, essentially the whole page — including every CTA and the price — stays permanently at `opacity:0`. This is a single point of failure for a marketing page whose entire job is to be read and convert.
- **Recommendation:** Add a `<noscript>` block that forces `.reveal{opacity:1;transform:none}`, and/or a short `setTimeout` fallback in `script.js` that adds `.in` to any `.reveal` element still un-revealed after ~2s.

### 2. [MEDIUM] Calendar "focus day" text fails contrast at low intensity
- **Where:** `website/css/dashboard.css:121` (`.dash__cal-cell--focus .dash__cal-daynum { color: #012a12; ... }`) combined with `website/js/dashboard.js:132-133`, which sets the cell background to `rgba(0, 192, 64, ${intensity})` where `intensity` ranges from `0.25` up.
- **Issue:** At low intensity (any day with only a little logged focus time), a near-black green background (`rgba(0,192,64,0.25)` over `--bg:#0d1117`) is painted with near-black-green text (`#012a12`) on top — well under WCAG AA's 4.5:1 body-text contrast ratio (roughly ~1.3:1 by calculation). Every lightly-used calendar day is effectively unreadable.
- **Recommendation:** Use a fixed, tested-contrast text color for `.dash__cal-cell--focus` regardless of intensity (e.g. keep the default `--text-2`/`--text` color and let only the background communicate intensity), or clamp intensity's minimum higher and re-check contrast against the darkest and lightest resulting backgrounds.

### 3. [MEDIUM] Calendar day buttons carry no accessible selection/date state
- **Where:** `website/js/dashboard.js` `renderCalendar()` (~lines 111-139); styling in `website/css/dashboard.css:112-121`.
- **Issue:** "Selected" and "today" are communicated only via a visual border (`.dash__cal-cell--selected`, `.dash__cal-cell--today`) with no `aria-pressed`/`aria-current`, and each button's accessible name is just the bare day number (e.g. `"15"`) with no month/year context. A screen-reader user navigating the grid can't tell which day is selected or which day is "today."
- **Recommendation:** Add `aria-pressed`/`aria-current="date"` as appropriate and set each button's `aria-label` to a full date (e.g. `"August 15, 2026, 42 minutes focused"`).

### 4. [MEDIUM] GSAP's motion language stops at the marketing page — dashboard has no equivalent "moment" feedback
- **Where:** GSAP calls only in `website/js/script.js:81-96, 161, 174` (hero boot stagger, override-tick pop, override-released pop with `back.out` overshoot easing). `website/dashboard.html` never loads the GSAP CDN script; `website/js/dashboard.js` and `website/js/nav.js` have zero GSAP references — the analogous "something just happened" moments (`dash__fade` state hand-off in `dashboard.css:30-31`, calendar cell repaint, trend/breakdown bar fill in `dashboard.css:58-64, 75-79`) all use flat CSS transitions with no overshoot/pop treatment.
- **Issue:** This isn't a bug — the scoping is deliberate and documented (`script.js:6-10`) — but it does mean the two surfaces speak different motion dialects: the marketing page rewards a successful action (override release) with a "juicy" pop, while the dashboard's own milestones (session synced, day selected, sign-in completing) get no equivalent beat. Worth a conscious call rather than accidental drift.
- **Recommendation:** Either document this restraint explicitly as intentional (data/utility surface vs. persuade surface, per the motion-and-animation skill's frequency gate), or pick one clear dashboard "moment" (e.g., first data load into `#dashContent`, or a newly-selected calendar cell) to receive the same lightweight `back.out` pop so the product feels like one system.

### 5. [LOW] Nav elevation-on-scroll logic duplicated instead of shared
- **Where:** `website/js/script.js:18-37` and `website/js/dashboard.js:393-409` — byte-for-byte equivalent logic toggling `.nav--scrolled` on `window.scrollY > 8`.
- **Issue:** `website/js/nav.js:1-8` explicitly describes itself as "shared... for index.html and dashboard.html," making it the natural home for this, but it doesn't contain this logic — both page scripts reimplement it independently, risking drift.
- **Recommendation:** Move the scroll-elevation listener into `nav.js` once.

### 6. [LOW] Missing Subresource Integrity on the GSAP CDN script
- **Where:** `website/index.html:596` — `<script src="https://cdn.jsdelivr.net/npm/gsap@3.12.5/dist/gsap.min.js"></script>`.
- **Issue:** No `integrity`/`crossorigin` attributes on a third-party CDN script. Since GSAP is already treated as an optional enhancement (every call site checks `window.gsap`), adding SRI is low-cost hardening against a compromised CDN with no functional downside if the hash ever mismatches (the existing fallback paths already handle "GSAP absent").
- **Recommendation:** Add an `integrity` hash (jsdelivr publishes these) and `crossorigin="anonymous"`.

### 7. [LOW] Countdown demo interval runs unconditionally forever
- **Where:** `website/js/script.js:127-136`.
- **Issue:** The 1-second `setInterval` driving the hero mockup's demo countdown keeps running for the life of the page view, with no `document.visibilityState`/`IntersectionObserver` gating to pause it when the tab is backgrounded or the hero has scrolled far out of view. Negligible cost for a single interval, but avoidable.
- **Recommendation:** Pause the interval via the Page Visibility API or an `IntersectionObserver` on `.hero__device`.

### 8. [LOW] Dashboard summary tiles orphan on tablet widths
- **Where:** `website/css/dashboard.css:36` (`.dash__summary { grid-template-columns: repeat(5, 1fr); }`) and the `:134` mobile override (`repeat(2, 1fr)`).
- **Issue:** 5 tiles in a 2-column grid at ≤860px leaves a single orphaned tile in the last row.
- **Recommendation:** Consider 1 column, or group into a layout that divides evenly (e.g. 2 rows of "2 + 3" intentionally, or drop to a horizontally-scrollable row).

## What Is Not a Finding

- `prefers-reduced-motion` is handled correctly and comprehensively: `website/css/styles.css:626-629` applies a global `!important` override that zeroes all transitions/animations (covering `dashboard.css` too, since `!important` wins regardless of load order), and every `gsap.*` call in `script.js` is additionally gated behind a JS-side `reduceMotion` check before it even runs.
- The mobile-nav breakpoint is consistent between CSS (`max-width: 720px`, `styles.css:595`) and JS (`min-width: 721px`, `nav.js:47`) — no gap or overlap.
- Calendar "selected"/"today" states do use a border in addition to color (not color-only), so that specific pattern is fine; the gap is the missing ARIA state (Finding 3), not color-only signaling.

## Coaching Plan (highest leverage first)

1. Fix the `.reveal` single-point-of-failure (Finding 1) — this is the only finding that can silently break the site's actual purpose (visitors seeing the pitch and CTAs at all).
2. Fix the calendar contrast bug (Finding 2) — concrete, easily verified WCAG failure affecting real user data.
3. Add ARIA state to calendar day buttons (Finding 3).
4. Make an explicit call on Finding 4 (document the restraint, or extend one dashboard moment) so it's a decision rather than drift.
5. Findings 5-8 are cheap cleanup, batchable together.

## Source Inventory

- `website/index.html`
- `website/dashboard.html`
- `website/js/script.js`
- `website/js/nav.js`
- `website/js/dashboard.js`
- `website/css/styles.css`
- `website/css/dashboard.css`
