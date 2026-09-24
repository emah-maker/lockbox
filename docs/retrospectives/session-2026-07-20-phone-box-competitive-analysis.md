---
author: <developer email>
date: 2026-07-20
job: competitive-analysis
synthesized:
---

# Retrospective: Phone Box Competitive Analysis

**Date**: 2026-07-20
**Objective**: Analyze existing products in the phone-focus/lockbox market and define a way to set Phone Box apart.
**Outcome**: success (approved round 0; one additive round for a Word version)

## Executive Summary
Produced a source-backed competitive analysis (`docs/business-development/competitive-analysis-2026-07-19.md`) mapping five competitor groups (direct time-lock boxes, adjacent NFC/app friction devices, substitutes, minimalist phones, do-nothing) with a 9-dimension matrix, differentiation pillars, threat/opportunity ranking, and a 30/90/180-day action plan. Core recommendation: position Phone Box as "the smart focus lockbox" in the whitespace between commodity dumb boxes and expensive app-connected/minimalist alternatives, led by the tunable override, touchscreen UX, and no-subscription programmability. Manager approved, then requested a .docx.

## What Went Well
1. **Correct category framing early.** Reframed "set this apart" into a positioning decision (compete on UX/enforcement/no-subscription, not price), which held through approval with no corrective feedback.
2. **Broad, sourced competitor sweep.** Parallel searches covered direct, adjacent, substitute, and institutional segments quickly with primary pricing pages plus secondary reviews and access dates.
3. **Decision-grade output.** The tunable-override "middle path" (vs kSafe's no-override and cheap boxes' access holes) is a specific, defensible, ownable wedge rather than a generic adjective.

## What Went Poorly / Course-Corrections
1. **Skipped the docx and had to add it.** Delivered markdown only, citing the `deliverable-format-preference` memory. The manager then asked for a Word file, exactly as happened on the prior board-alternative job. Two consecutive jobs now show the same pattern: markdown delivered, docx requested.
2. **Tooling gap on docx generation.** The FRAIM `author-docx` script failed (missing `adm-zip`), and pandoc is not installed. Recovered with a python-docx converter saved to `scripts/md_to_docx.py`.

## Root Cause Analysis
- **Docx round**: *What happened* — delivered markdown, manager asked for Word. *What drove it* — applied the `deliverable-format-preference` memory ("plain markdown; no doc conversion") as a default and did not offer/produce a docx up front, despite the prior board-alt retrospective already noting the preference is "overridable on explicit request" and that a docx was requested last time. *Corpus conflict* — the standing preference is now contradicted by two consecutive real requests for docx on formal business-development deliverables. The preference should be narrowed: markdown remains canonical, but formal external-facing deliverables (business-development, procurement) should be offered or produced as docx by default.
- **Tooling**: *What happened* — author-docx script errored on a missing dependency. *What drove it* — environment lacks pandoc and the script's node deps. *Fix* — reusable `scripts/md_to_docx.py` (headings, native tables, bullets, code, hyperlinks) now exists.

## Key Learnings
1. For formal business deliverables here, produce the markdown as canonical AND generate a docx, or explicitly offer it, rather than waiting to be asked. The "markdown only" default fits internal/conversational work, not polished external artifacts.
2. `scripts/md_to_docx.py` is the working docx path in this environment (python-docx present; no pandoc). Reuse it; it renders GitHub tables as native Word tables.

## Prevention Measures
- Update the `deliverable-format-preference` memory to note that formal external-facing deliverables should default to (or proactively offer) docx.
- Default to `scripts/md_to_docx.py` for docx conversion here; do not rely on pandoc or the FRAIM node script without checking dependencies first.

## Feedback Analysis
One round, additive (format only). The analysis content and recommendation were accepted without change, indicating scope, competitor set, and positioning were right on the first pass.
