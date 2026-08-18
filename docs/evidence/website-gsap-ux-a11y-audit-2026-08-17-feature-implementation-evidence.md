# Feature: Remediate all findings in website-gsap-ux-a11y-audit-2026-08-17.md
Issue: website-gsap-ux-a11y-audit-2026-08-17 (audit report, no GitHub issue -- conversational-mode job dispatched directly by manager)
Tech Spec: docs/quality-assurance/website-gsap-ux-a11y-audit-2026-08-17.md (source audit; this job implements its own remediation queue in order)
PR: N/A -- conversational mode (`fraim/config.json` -> `"mode": "conversational"`); changes are in the working tree for local review, no branch/PR created

## Work List

### Scope
- [x] `website/index.html` - add `<noscript>` forcing `.reveal{opacity:1;transform:none}` - done
- [x] `website/index.html` - add SRI `integrity`/`crossorigin` to the GSAP CDN `<script>` tag - done
- [x] `website/js/script.js` - add `setTimeout` safety-reveal fallback (~2s) for any un-revealed `.reveal` element - done
- [x] `website/css/dashboard.css` / `website/js/dashboard.js` - fix calendar "focus day" text contrast with a fixed, tested-contrast color - done
- [x] `website/js/dashboard.js` `renderCalendar()` - add `aria-pressed`, `aria-current="date"`, full-date `aria-label` to calendar day buttons - done
- [x] `website/js/dashboard.js` - make an explicit, documented call on the GSAP-vs-dashboard motion-language gap - done (documented restraint, no code beyond a comment)
- [x] `website/js/nav.js` / `website/js/script.js` / `website/js/dashboard.js` - move nav-scroll-elevation into shared `nav.js`, remove duplication - done
- [x] `website/js/script.js` - gate the demo countdown `setInterval` behind Page Visibility + IntersectionObserver - done
- [x] `website/css/dashboard.css` - fix the 5-tile dashboard summary grid orphaning at tablet widths - done

### Validation Requirements
- `uiValidationRequired`: Yes (touches `index.html`, `dashboard.html`'s calendar/summary grid, and both pages' nav)
- `mobileValidationRequired`: No (no native app changes; tablet/mobile web breakpoints covered below)
- Required suites/modes: no build step and no automated test suite exist for `website/` (static HTML/CSS/vanilla JS, file://-friendly). Validation performed by: (1) re-reading every changed file in full for internal consistency, (2) a real browser pass via the FRAIM shared browser against a local static server (`python -m http.server`, since `file://` navigation is blocked in that browser), covering console errors, the reveal safety-net, the countdown visibility gating, the nav elevation consolidation, the SRI hash, in-browser WCAG contrast math against the live CSS custom properties, and a tablet-width (800px) screenshot of the summary-grid fix.

### Decisions
- **Finding 2 (calendar contrast)**: The audit's own recommendation ("fixed, tested-contrast text color regardless of intensity") cannot be satisfied by a text-color change alone under the *existing* background formula. `dashboard.js` scales background opacity from 0.25 to 1.0 over `rgba(0, 192, 64, intensity)` (the bright `--unlocked` mint); at intensity 1.0 (any month's single highest-focus day) the cell is that color at full opacity with luminance ≈0.38, and at low intensity the cell luminance is ≈0.02-0.10. No single fixed text-luminance value clears WCAG AA 4.5:1 against both ends of that specific range (verified by hand and in-browser, see Validation Results). Fix: darken the base fill from `rgb(0,192,64)` to `rgb(0,120,45)` in `dashboard.js` (same opacity scaling, same visual "intensity" concept, just a muted shade) so the worst case (intensity 1.0) luminance drops to ≈0.14 -- then `.dash__cal-cell--focus .dash__cal-daynum` in `dashboard.css` gets one fixed color, `var(--text)`, which now clears 4.5:1 at every intensity (measured 5.06:1 at worst, up to 13.75:1 at best). This is a minimal extension of the existing token-reuse convention (`var(--text)` is one of the site's three text tokens), not a new color system.
- **Finding 4 (motion-language gap)**: Chose "document the restraint" over "add a `back.out` pop," per the project's own `motion-and-animation` skill frequency gate (already cited in `script.js`'s header comment) and the project rule that motion questions must gate on frequency/purpose before writing anything. The dashboard is a data/utility surface a user returns to repeatedly; a repeated overshoot beat reads as noise there, unlike the marketing page's one-time persuade moments. Adding GSAP to `dashboard.html` would also mean loading a new CDN dependency on a page that currently has zero GSAP references, for one micro-interaction. Documented as a comment block at the top of `dashboard.js` rather than a separate report, per the audit's own ask to "note the decision."
- **Finding 5 (nav duplication)**: consolidated into `nav.js` (already documented as the shared file for both pages) rather than a new shared module, since both `index.html` and `dashboard.html` already load `nav.js` ahead of their page-specific script.
- **Finding 8 (tablet grid orphan)**: chose "5th tile spans both columns" over "drop to 1 column" or "horizontal scroll," since it needs no extra markup/JS, keeps 4 tiles at full information density, and reads as an intentional full-width closer tile rather than a leftover.

### Deferrals
- None. All 8 findings (1 HIGH, 3 MEDIUM, 4 LOW) from the audit's remediation queue are addressed in this pass, in the queue's own order.

## Spec and Design Completeness

**Feature Requirements Source**: `docs/quality-assurance/website-gsap-ux-a11y-audit-2026-08-17.md` (Findings 1-8 + Coaching Plan)
**Technical Design Source**: N/A -- this is a findings-remediation job, not a new-feature RFC; the audit's own "Recommendation" line per finding is the design source.

### Implementation Checklist

#### Part 1: [HIGH] Reveal single point of failure (Finding 1)
- [x] File: `website/index.html` - `<noscript>` block forcing `.reveal{opacity:1 !important;transform:none !important}` in `<head>` - ✅ Implemented
- [x] File: `website/js/script.js` - 2s `setTimeout` safety-reveal fallback inside the `IntersectionObserver` branch - ✅ Implemented

#### Part 2: [MEDIUM] Calendar contrast (Finding 2)
- [x] File: `website/js/dashboard.js` - darkened base fill `rgba(0, 120, 45, intensity)` - ✅ Implemented
- [x] File: `website/css/dashboard.css` - fixed `color: var(--text)` on `.dash__cal-cell--focus .dash__cal-daynum` - ✅ Implemented

#### Part 3: [MEDIUM] Calendar ARIA state (Finding 3)
- [x] File: `website/js/dashboard.js` `renderCalendar()` - `aria-pressed`, `aria-current="date"`, full-date `aria-label` (with focused-minutes when present) - ✅ Implemented

#### Part 4: [MEDIUM] GSAP-vs-dashboard motion gap (Finding 4)
- [x] File: `website/js/dashboard.js` - header-comment documenting the restraint decision - ✅ Implemented (decision: document, not extend)

#### Part 5: [LOW x4] Cleanup batch (Finding 5-8)
- [x] File: `website/js/nav.js` - nav-scroll-elevation logic moved in - ✅ Implemented
- [x] File: `website/js/script.js` - duplicate nav-scroll-elevation block removed - ✅ Implemented
- [x] File: `website/js/dashboard.js` - duplicate nav-scroll-elevation IIFE removed - ✅ Implemented
- [x] File: `website/index.html` - `integrity`/`crossorigin` added to the GSAP CDN `<script>` tag - ✅ Implemented
- [x] File: `website/js/script.js` - countdown `setInterval` gated behind `document.visibilityState` + `IntersectionObserver` on `.hero__device` - ✅ Implemented
- [x] File: `website/css/dashboard.css` - `.dash__tile:last-child { grid-column: 1 / -1; }` inside the 860px media query - ✅ Implemented

**Feature Requirements Completeness Summary**:
- Implemented: 8/8 findings (100%)
- Deferred: 0
- Missing: 0

**Scope Changes from Audit Recommendation**:
- Finding 2's fix touches `dashboard.js`'s fill color in addition to `dashboard.css`'s text color (see Decisions above) -- the audit's literal wording ("fixed text color") undersold what's needed; a fixed color alone does not pass contrast against the *existing* bright-green/full-opacity worst case, so the base color also had to change. This is the smallest change that makes "one fixed text color, every intensity" actually true rather than only nominally true.

## Completeness Evidence
- All findings in the audit's remediation queue addressed, in queue order: Yes
- Issue tagged with label `phase:impl`: N/A (no issue tracker in this workflow -- audit-driven job, conversational mode, no GitHub issue)
- Issue tagged with label `status:needs-review`: N/A (same as above)
- All files committed/synced to branch: N/A (conversational mode -- changes are in the working tree, not committed; no branch was created per `set-up-workspace` skill's conversational-mode rule)

## Validation Results
No build step and no automated test suite exist for `website/`. All validation below was performed by direct code re-reading plus a real browser pass (FRAIM shared browser, CDP at 127.0.0.1:9222) against `python -m http.server` serving `website/` on a local port (`file://` is blocked in that browser).

| Validation Step | Result | Notes |
|---|---|---|
| Re-read every changed file in full (`index.html`, `script.js`, `nav.js`, `dashboard.js`, `dashboard.css`) | Pass | No leftover duplication, no dangling references, comments match the code they describe |
| `index.html` + `dashboard.html` console errors (browser_console_messages, level=warning) | Pass | 0 errors, 0 warnings on both pages |
| GSAP loads with the new SRI hash intact | Pass | `window.gsap` truthy after navigation; hash cross-checked against jsDelivr's own published sha256 for `gsap@3.12.5/dist/gsap.min.js` (`KAM+RJox68w5blvosTtjFSvwMJQoj7WGcDQyGSe84Ic=` matches a local `openssl dgst -sha256` of the downloaded file byte-for-byte) before deriving the sha384 SRI value actually used in the tag |
| Reveal: fresh load, no scroll | Pass | 2/29 `.reveal` elements `.in` immediately (only hero, via real intersection) |
| Reveal: fresh load, wait ~2.3s, no scroll | Pass | 29/29 `.reveal` elements `.in` -- confirms the `setTimeout` safety-reveal fires and does not depend on scrolling |
| Countdown pause/resume | Pass | `#mockTime` advances while `.hero__device` is in view; frozen for 3s while scrolled to `document.body.scrollHeight`; resumes advancing after scrolling back to top |
| Nav elevation consolidation | Pass | `.nav--scrolled` toggles correctly on both `index.html` and `dashboard.html` after the logic moved to `nav.js` |
| Calendar contrast (in-browser WCAG math against live `--text`/`--bg` custom properties, composited with the new `rgba(0,120,45,intensity)` fill) | Pass | Contrast ratio 13.75:1 at intensity 0.25 down to 5.06:1 at intensity 1.0 -- both ends and 3 midpoints all clear WCAG AA's 4.5:1 |
| Calendar ARIA attributes + fixed color (executed via the real `focusStats.js` helpers dynamically imported in-page, calling the verbatim `renderCalendar()` cell-construction snippet against a fake session) | Pass | Today's cell: `aria-pressed="true"`, `aria-current="date"`, `aria-label="August 17, 2026, 30m focused"`, `background: rgb(0, 120, 45)` |
| Tablet-width (800px) summary-grid orphan fix | Pass | Screenshot at 800px viewport shows 2-2-1(full-width) layout; no isolated half-width tile (verified visually, screenshot discarded after review per no-scratch-files convention) |
| UI polish check (`ui-polish-validation` job) | PASS (composite 9.8/10) | Full report: `docs/evidence/website-gsap-ux-a11y-audit-2026-08-17-ui-polish-validation.md`. Confirmed via rendered accessibility-tree snapshots, computed-style contrast math, and 4 screenshots: zero P0/P1/P2 defects in this batch's own changes; one pre-existing, out-of-scope 768px overflow (untouched `.hero__glow`/`.nav__menu`) documented but correctly left unfixed; one environment observation (shared browser tab lacked OS focus during one screenshot, causing GSAP's boot tween and the new visibility-gated countdown to correctly pause) documented and cross-checked against an earlier focused-window pass in this same session |
| Bug bash (edge cases/boundary/adjacent flows) | 0 issues found | Explicitly checked: 2-digit calendar dates (31) don't clip their 30px circle; today+selected states render distinct rings simultaneously; keyboard Tab/native button semantics preserved (no custom keydown code added or needed); no `outline: none` suppressing the native focus ring anywhere in `dashboard.css` |
| Full end-to-end Firebase auth/data flow | Not run | `website/js/firebaseConfig.js` ships placeholder (`REPLACE_ME_*`) values in this environment by design -- `isFirebaseConfigured()` is false, so the real sign-in -> Firestore -> `renderCalendar()` path can't be exercised without live project credentials. This is a pre-existing environment limitation, not something this job's changes could or should fix; the calendar logic itself was still exercised directly (see row above) using the real helper functions and the real code snippet |

### Cross-check: jsDelivr hash verification
```
$ curl -sL https://cdn.jsdelivr.net/npm/gsap@3.12.5/dist/gsap.min.js -o gsap.min.js
$ openssl dgst -sha384 -binary gsap.min.js | openssl base64 -A
g4NTh/Iv5PPU4xPyhEWqPcwtNXOvdaDI8LLnyYfyNZOjKJeYQyjzQ9X5275eBjpt
$ curl -sL "https://data.jsdelivr.com/v1/packages/npm/gsap@3.12.5?structure=flat" | jq '.files[] | select(.name=="/dist/gsap.min.js")'
{ "name": "/dist/gsap.min.js", "hash": "KAM+RJox68w5blvosTtjFSvwMJQoj7WGcDQyGSe84Ic=", "size": 72214 }
$ openssl dgst -sha256 -binary gsap.min.js | openssl base64 -A
KAM+RJox68w5blvosTtjFSvwMJQoj7WGcDQyGSe84Ic=   # matches jsDelivr's published hash exactly
```

### Contrast math (in-browser, live CSS custom properties)
```json
{
  "textHex": "#f0f3f6", "bgHex": "#0d1117",
  "results": [
    { "intensity": 0.25, "contrast": "13.75" },
    { "intensity": 0.4,  "contrast": "11.50" },
    { "intensity": 0.6,  "contrast": "8.79"  },
    { "intensity": 0.8,  "contrast": "6.65"  },
    { "intensity": 1.0,  "contrast": "5.06"  }
  ]
}
```

## New Files/Functions Created
None -- all changes are edits to existing files. No new files, functions, or abstractions were introduced.

## New Tests Added
None -- no test harness exists for `website/` (static, no build step, per project rules). Validation was manual/browser-based as detailed above.

## Existing Test Suites Run
| Test Suite | Was it Run | Failing Tests | Failure Analysis |
|---|---|---|---|
| N/A | N/A | N/A | `website/` has no automated test suite; this job's scope did not touch `app/` (Jest) or `Box-code/` (on-device only), so no existing suite in the repo applies |

## Pre-Completion Reflection

✅ Reflection Phase 1 (Claim Verification): YES -- every claim above (SRI hash match, contrast ratios, reveal timing, countdown pause/resume, ARIA output) was produced by an actual tool call against the running page or a direct hash/contrast computation, not asserted from reading code alone.
✅ Reflection Phase 2 (Risk Analysis): YES -- main risk identified was Finding 2's literal instruction ("fixed text color") being insufficient on its own; resolved by measuring the actual worst-case contrast and adjusting the one additional value (base fill RGB) needed to make the fixed-color claim true, and documenting why in both the CSS comment and this evidence file.
✅ Reflection Phase 3 (Validation Plan Check): YES -- validation plan recorded in the Work List before implementation (re-read all changed files + browser check, no build step) was followed exactly; the one item not run (full Firebase auth flow) is a pre-existing environment limitation, stated plainly rather than skipped silently.
✅ Reflection Phase 4 (Self-Audit): YES -- re-read every changed file in full after editing (not just the diffs) to confirm no leftover references to removed code (e.g., confirmed no other spot in `script.js`/`dashboard.js` still referenced the old inline nav-elevation IIFEs, confirmed `dashboard.js`'s `formatDuration` import already covered the new `aria-label` use, confirmed `nav.js` runs before both page scripts in both HTML files).
✅ All blockers from reflection addressed: YES
✅ Confidence level: 96%

**Reflection Summary:** All 8 findings from the audit are implemented, in the audit's own remediation-queue order, and each was validated against the running page (not just read back as source). The one deliberate deviation from the audit's literal wording (Finding 2 needed a fill-color change too, not text-color alone) is disclosed and justified with measured numbers, not silently substituted.

## Continuous Learning
| Learning | Agent Rule Update |
|---|---|
| A "fixed text color" recommendation in an audit can be numerically impossible against the *current* background formula; always compute the actual worst-case contrast before implementing a literal-sounding fix, and adjust the minimal additional value needed rather than shipping a color that still fails at one end of the range. | Not written to a rule file this pass -- scoped to this one contrast calculation; no existing project rule needed correction. |
