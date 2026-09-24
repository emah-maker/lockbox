---
author: <developer email>
date: 2026-07-24
job: fully-delegate
context: conversational-session
---

## What happened
Two sub-agent runs of `website-creation` were each cut off mid-task by a session limit before they could finish their own browser verification. Both had written files to `website/`, so on takeover the folder looked complete. In reality the runs had clobbered each other: `index.html` used one class/id system (`hero__grid`, `wrap`, `cards/card`, an `acc__item` accordion, form ids `email`/`formMsg`) while `styles.css` and `script.js` targeted a different one (`hero-grid`, `container`, `pillars-grid/pillar`, `faq-grid`, ids `wl-email`/`countdown`/`ringProgress`). None of the selectors matched, so the page rendered unstyled and the JS was inert. A separate bug also survived: the CSS set `display:flex` on `.waitlist__thanks`, which overrode the HTML `hidden` attribute and showed the "thank you" state on load.

## Why it happened
The delegation graph had no integration-verification gate that survives a partial/failed child run. The manager review map assumed "files exist on disk" was a proxy for "node is verified," but neither interrupted agent reached its own screenshot/console-check step, so nothing had ever confirmed HTML, CSS, and JS referenced the same contract. Re-running a fresh agent over a directory another agent already half-wrote is a silent merge with no reconciliation step.

## What was learned
A multi-file front-end deliverable is only "done" when it has been loaded and observed as an integrated whole; presence of files is not evidence, and an interrupted agent's partial output must be treated as unverified and possibly inconsistent with prior partial output.

## What will be done to recover
Reconciled by rewriting `styles.css` and `script.js` to match the single surviving high-quality `index.html`, fixed the asset paths (`css/`, `js/`) and the `[hidden]` override, then verified in the browser: zero console errors, CSS applied (bg #08090b, Inter), live countdown, accordion open/close, form to thank-you swap, and no horizontal overflow at 390px and 1280px.

## Systematic ways to avoid recurrence
- The `website-creation` verification phase should require an automated integration check before declaring done: load the page and assert (a) 0 console errors, (b) a known element has a non-default computed style (proves CSS linked), (c) every `href`/`src` resolves 200, (d) each interactive control changes state on activation.
- Manager review of any front-end node should not accept "artifacts exist" as a pass signal; the pass gate is a rendered-and-observed check.
- When taking over a directory left by a failed agent, treat every file as independently suspect and diff the class/id contract across HTML, CSS, and JS before trusting any of it.

## Ways to detect and recover quickly without manager guidance
- Detection signal: a full-page screenshot that looks unstyled, or `getComputedStyle(document.body).backgroundColor` returning the default; mismatched selector prefixes (`foo__bar` in HTML vs `foo-bar` in CSS) is a fast grep tell.
- Recovery path: pick the most complete, on-brief HTML as the source of truth, then regenerate CSS/JS to its exact contract rather than trying to salvage three divergent versions; re-verify in the browser.

## What the agent should have done
Built and verified the site as one integrated pass with an explicit render check, and on takeover of interrupted work, diffed the HTML/CSS/JS contract first instead of assuming the on-disk files were consistent.
