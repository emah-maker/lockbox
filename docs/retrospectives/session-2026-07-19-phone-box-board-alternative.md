---
author: <developer email>
date: 2026-07-19
job: supplier-discovery-and-qualification
synthesized:
---

# Postmortem: Phone Box — Board Alternative to Reduce Cost

**Date**: 2026-07-19
**Duration**: Single session, 3 feedback rounds (links/CAD, Word format, approval)
**Objective**: Find a cheaper board than the ~$25 Waveshare ESP32-S3-Touch-LCD-1.47
(~62% of the $40.77 BOM) while preserving all 7 functions and staying on CircuitPython.
**Outcome**: success (approved)

## Executive Summary
Ran a broad multi-channel supplier scan (Waveshare, LILYGO, budget vendors,
Adafruit, radio-free RP2xxx), produced a 14-candidate longlist, a weighted
shortlist scorecard, an exclusion list, and a risk register. Primary recommendation:
**Sunton ESP32-2432S024C (~$15)** — official CircuitPython, capacitive touch,
240×320 screen — saving ~$8–9/unit (~20% of BOM) after a ~$1.50 external battery
add-on. Two round-2 findings materially improved the answer: (1) the *same* incumbent
board is ~$18–19 at The Pi Hut vs. ~$25 on Amazon — a ~$6/unit saving with zero
redesign; (2) parsing the STEP CAD showed the enclosure (~196×195 mm, ~27 mm deep)
has ample room for a 2000–5000 mAh battery. Delivered as markdown, then re-rendered
to Word on request.

## Timeline
- **Round 0**: requirements → research → longlist → shortlist → exclusions/risks →
  submit (markdown deliverable).
- **Round 1** feedback: "find links" + "read CAD for larger battery." Added verified
  purchase-link table; parsed both STEP files for a battery-fit conclusion.
- **Round 2** feedback: "give this in a word file." Installed `python-docx`, wrote a
  markdown→docx converter (headings, tables, bullets, hyperlinks).
- **Round 3**: approved.

## What Went Well
1. **Parallel channel research** (4 concurrent researchers) covered OEM-direct,
   budget-vendor, first-party, and radio-free channels quickly, each returning
   sourced claims with CircuitPython-support verification.
2. **Correct decisive filter**: gating on *capacitive touch + working CircuitPython
   displayio + usable rectangular screen* immediately separated real options
   (Sunton capacitive CYD) from traps (QSPI Guition boards, resistive CYD, Arduino-
   only LILYGO variants).
3. **Direct STEP parsing** with a Python CARTESIAN_POINT regex gave defensible
   enclosure dimensions with no CAD tool installed — turned a vague "will it fit?"
   into a measured envelope answer.
4. **Cross-channel incumbent pricing** surfaced the highest-ROI, zero-risk lever
   (same board, cheaper retailer) that a spec-only search would have missed.

## What Went Poorly / Course-Corrections
1. **First STEP regex returned 0 points.** The pattern assumed `CARTESIAN_POINT('...'`
   with no spaces; the exporter writes `CARTESIAN_POINT ( 'NONE', ( ... ) )`. Fixed
   by allowing `\s*`. Minor, caught immediately by a zero-count sanity check.
2. **Initial deliverable format** was markdown per the standing preference; the
   manager wanted Word. Not a true miss (see corpus note) but added a round.

## Root Cause Analysis
- **STEP parse miss**: *What happened* — 0 points extracted. *What drove it* —
  assumed a compact STEP grammar without verifying the actual file's whitespace
  formatting. *Fix* — always grep one real entity line to confirm format before
  writing the extraction regex; a zero-count result must trigger a format re-check,
  not a "no data" conclusion.
- **Format round**: *What happened* — delivered markdown, manager asked for Word.
  *What drove it* — applied the `deliverable-format-preference` memory (markdown +
  conversation) as if absolute. *Corpus note* — that preference is a sensible
  default, not a hard rule; explicit per-artifact requests override it. No corpus
  correction needed, but the preference could note "overridable on explicit request."

## Key Learnings
1. **STEP/IGES files are ASCII and directly parseable.** A `CARTESIAN_POINT` regex +
   min/max gives a reliable external bounding box (and unit check via `LENGTH_UNIT`)
   with no SolidWorks/pandoc dependency — reusable for any "does it fit" question.
   Verify one real line for whitespace first; treat a zero-count as a format bug.
2. **Price the incumbent across retail channels before recommending a swap.** The
   cheapest saving here required no engineering at all — just a different store.
3. **Amazon/Waveshare/LILYGO block price scraping; scrapeable resellers (The Pi Hut,
   ProtoSupplies) give live prices.** Use them to anchor, and mark scrape-blocked
   figures as "typical / not live-readable" rather than guessing.
4. **`python-docx` (pip-installable) + a small markdown→docx converter** is a clean
   way to satisfy "give me a Word file" while keeping markdown canonical.

## Prevention Measures
- When extracting from an unfamiliar text/CAD format, grep one entity line and
  confirm the regex matches before trusting a full-file count; a zero count = re-check.
- In sourcing work, always include an "incumbent across channels" row in the price
  research — a same-part cheaper-channel option is a valid cost-down result.
- Treat deliverable-format preferences as overridable defaults; honor explicit
  per-artifact format requests without re-litigating.

## Feedback Analysis
All three rounds were additive (more links, CAD depth, format) rather than
corrective — the core analysis and recommendation held from round 0 through approval,
indicating the initial scope and filters were right.
