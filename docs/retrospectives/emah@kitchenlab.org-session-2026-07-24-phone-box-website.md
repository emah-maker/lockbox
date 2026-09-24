---
author: emah@kitchenlab.org
date: 2026-07-24
job: fully-delegate
synthesized:
---

# Retrospective: Phone Box Marketing Website

## Context
Goal: create a visually appealing marketing website for Phone Box. Delivered a self-contained static site under `website/`, positioned as "the smart focus lockbox," with a recommended price added mid-run per manager coaching. Approved by the manager with no change requests.

## What went well
- **Positioning was already solved.** The existing `competitive-analysis-2026-07-19.md` gave a ready, defensible frame ("smart focus lockbox"), four pillars, objection handling, and a competitor matrix. Reusing it meant the copy did not have to be invented and stayed truthful.
- **Authentic product visual without photography.** Pulling the real palette and UI facts from `firmware/lib/lock_config.py` (green #00C040, amber, red, H:M:S, override count) produced a CSS/SVG device mockup that looks like the actual product rather than a stock placeholder.
- **In-browser verification caught a real defect.** Loading the page and probing computed styles surfaced the `[hidden]` override bug (thank-you state showing on load) that a file-only review would have missed.
- **Pricing recommendation was grounded.** The $99/$79 anchor was derived from the BOM and the competitor price ladder in the analysis, and presented as a judgment call needing sign-off rather than a fact. It was approved as-is.

## What went poorly
- **Two delegated sub-agent runs were killed by session limits mid-task**, each before reaching its own verification step. This was an infrastructure interruption, not a quality failure, but it had a real consequence below.
- **The interrupted runs clobbered each other into three mismatched files.** `index.html` used one class/id contract; `styles.css` and `script.js` targeted a different one. The page rendered unstyled and the JS was inert, and the on-disk fileset looked complete despite being broken.

## Root cause analysis
- *What happened:* On manager takeover, the `website/` folder had a complete-looking set of files that did not actually work together.
- *What drove it:* The delegation plan treated "child finished and files exist" as the pass proxy, but neither child finished. Re-running a second builder over the same directory a first builder had half-written performed a silent merge with no reconciliation gate. There was no integration check that survives a partial child run.
- *Corpus/rule conflict:* None. No existing learning endorsed this; the gap is a missing control, not a bad rule. Captured as a raw coaching moment (`...-verify-delegated-web-artifacts-integrate.md`) proposing that front-end verification assert an integrated render (0 console errors, a non-default computed style, all `href`/`src` resolve, interactive controls change state) before "done."

## Decision analysis
- **Took the work over instead of re-delegating a third time.** With two consecutive session-limit deaths, another background sub-agent risked the same interruption. Direct completion was the reliable path and the failures were infrastructural, so this did not undermine the delegate-and-verify model.
- **Kept the surviving `index.html` as source of truth** and regenerated CSS/JS to its exact contract, rather than trying to reconcile three divergent versions. Faster and less error-prone.
- **Added a price rather than staying waitlist-only** once the manager asked, and framed it for explicit sign-off.

## Key learnings
- A multi-file front-end deliverable is "done" only when loaded and observed as an integrated whole; file presence is not evidence.
- Partial output from an interrupted agent must be treated as unverified and possibly inconsistent with any prior partial output; diff the HTML/CSS/JS contract before trusting it.
- `display` on an element defeats the HTML `hidden` attribute; a global `[hidden]{display:none!important}` guard prevents that class of bug.

## Prevention measures
- For `website-creation` and similar, add an automated integration assertion to the verification step (console clean, CSS linked via computed-style probe, assets resolve, interactions toggle state).
- When taking over a failed agent's directory, run a selector/contract diff across HTML, CSS, and JS first.
- These are proposals for `sleep-on-learnings` to weigh, not direct rule changes.

## Follow-on jobs
- `pricing-strategy-definition`: the $99/$79 price is a positioning estimate, not validated against willingness-to-pay. This is the natural next step before a real launch, and the competitive analysis already recommended it.
