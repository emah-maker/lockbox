# Phone Box Marketing Website

**DRAFT - Requires Human Approval**
**INTERNAL**

**Date:** 2026-07-24
**Objective:** Create a visually appealing marketing website for Phone Box, positioned as "the smart focus lockbox," delivered as a self-contained static site with a recommended market price.

## Executive summary
A single-page marketing website was built and verified under `website/`. It positions Phone Box as the smart focus lockbox, leads with the four differentiation pillars from the competitive analysis, states a recommended price, compares the product honestly against five competitors, answers the main buyer objections, and closes with a founding pre-order waitlist. The site is a self-contained static build (HTML, CSS, vanilla JS, no build step, no framework) with a dark focus theme and an animated on-screen device mockup that mirrors the real firmware palette.

**Confidence: medium.** The deliverable is verified working in the browser, but the delegated build required manager correction (see Risk areas). The pricing figure is a judgment call that needs sign-off.

## What was built
- `website/index.html`: full single-page site.
- `website/css/styles.css`: dark theme, on-device green accent (#00C040), responsive and reduced-motion aware.
- `website/js/script.js`: reveal-on-scroll, FAQ accordion, live countdown on the device mockup, waitlist form to thank-you swap (client-side only, no backend).
- `website/assets/icons/favicon.svg` — since superseded by an inline `data:image/svg+xml` favicon in each page's `<head>` (redesigned alongside the site multiple times over) and deleted as dead weight; still recoverable via `git log --follow -- website/assets/icons/favicon.svg`.

Sections: sticky nav, hero with animated device mockup, "your phone always wins" problem, four feature pillars, four-step how-it-works, honest comparison table (Phone Box vs kSafe, generic Amazon boxes, Brick, Opal, GoAro), pricing, FAQ accordion, waitlist call to action, footer.

## Pricing recommendation (needs sign-off)
- **Anchor price: $99, one-time, no subscription.**
- **Founding / pre-order price: $79** (tied to the waitlist).
- Rationale: BOM is roughly $35 to $41. Commodity boxes sit at $20 to $60 and Phone Box cannot win on raw price, so it is positioned as premium. $99 sits above the commodity floor, near Brick ($59 one-time) but justified by true physical lockaway plus a touchscreen, and far below the subscription rivals over time (Opal about $99/yr, GoAro about $199 plus $99/yr). The site reinforces this with a first-year cost comparison.
- This is a positioning estimate, not a validated price. The competitive analysis recommends a dedicated `pricing-strategy-definition` job to set it against willingness-to-pay anchors.

## Execution trace
| Task | Job | Persona | Iterations | Corrected | Artifact |
|---|---|---|---|---|---|
| Phone Box website | website-creation | coder (delegated), then manager takeover | 3 | Yes | `website/` |

- Iteration 1: sub-agent build, cut off by session limit mid-verification.
- Iteration 2: sub-agent build (added pricing), cut off by session limit mid-verification. Left a complete `index.html` but clobbered CSS/JS from the prior run.
- Iteration 3: manager takeover. Reconciled the three mismatched versions, fixed two real bugs, verified in-browser.

## Risk areas (scrutinize on review)
1. **Delegated build needed correction.** The two interrupted runs left `index.html` on one class/id system and `styles.css`/`script.js` on a different one, so the page was unstyled and the JS inert. Manager rewrote CSS and JS to match the surviving HTML and fixed the asset paths. Review: confirm the copy in `index.html` still reads as intended, since it came from an interrupted run.
2. **`hidden` override bug (fixed).** CSS `display:flex` on the thank-you block was defeating the HTML `hidden` attribute, showing the confirmation on load. Fixed with a global `[hidden]{display:none!important}` and verified.
3. **Pricing is a judgment call**, not market-tested (see above).

## Content accuracy notes
- All product claims trace to `project_context.md`, `Box-code/lib/lock_config.py`, and the competitive analysis.
- No product photography exists; the device is rendered in pure CSS/SVG using the real firmware colors.
- The companion app is described as optional and on the roadmap, and explicitly does not auto-unlock (matches `BLE_ALLOW_REMOTE_UNLOCK = False`).
- Competitor prices are July 2026 snapshots from the competitive analysis.

## Verification performed
Served locally and loaded in the browser: 0 console errors; CSS confirmed applied (body background #08090b, Inter font); live countdown running; FAQ accordion opens and closes; waitlist form swaps to the thank-you state on a valid email; no horizontal overflow at 390px or 1280px; full-page screenshots reviewed at both widths. Note: the site uses relative paths and works from `file://` or any static host; Google Fonts loads over HTTPS and degrades to system fonts offline.

## Human approval checklist
1. Approve the **$99 anchor / $79 founding** price, or set a different figure (I will update the hero, pricing card, comparison row, waitlist copy, and meta description).
2. Approve the product name shown as **"Phone Box"** (no separate brand name exists yet).
3. Approve the **waitlist / pre-order** framing (site states it is not yet shipping and takes no payment).
4. Confirm the **competitor claims and prices** are acceptable to publish.
5. Decide on **hosting / deployment** (nothing has been deployed; this is a local draft).
6. Optional: commission `pricing-strategy-definition` to validate the price before launch.

Nothing has been published or deployed. Awaiting sign-off per item.
