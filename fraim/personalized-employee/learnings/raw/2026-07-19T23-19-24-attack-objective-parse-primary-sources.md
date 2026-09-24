---
author: <developer email>
date: 2026-07-19
context: supplier-discovery-and-qualification
kind: success-moment
trigger: user-validation
---

# Success Moment: attack-objective-parse-primary-sources

## What happened

Tasked with "find a cheaper board" for Phone Box (the ~$25 Waveshare ESP32-S3
being ~62% of the $40.77 BOM), the agent did not stop at hunting for a
replacement part. It also priced the *incumbent* board across retail channels and
found the same Waveshare board at ~$18–19 (The Pi Hut) vs ~$25 (Amazon) — a
~$6/unit, zero-redesign saving — surfaced alongside the Sunton ESP32-2432S024C
(~$15) swap as the larger lever. It also answered "will a bigger battery fit?" by
parsing the raw STEP CAD files directly with a `CARTESIAN_POINT` regex (no
SolidWorks/CAD tool installed), yielding a measured enclosure envelope
(~196×195×27 mm). The manager approved; all three feedback rounds were additive
(more links, CAD depth, Word format), never corrective — the core recommendation
held from round 0 to approval.

## Why it was the right call

Solving the objective behind the literal request — "reduce board cost," not
"swap the board" — and reaching for primary sources directly (raw CAD text,
same-part cross-channel prices) uncovers the highest-ROI, lowest-risk wins that a
surface-literal search structurally misses.

## How to reproduce the win

In any sourcing/cost-down task, treat "find a cheaper X" as "reduce the cost of
X" and always add an *incumbent-across-channels* price row before recommending a
swap. When a question is gated on an unfamiliar data file (CAD/STEP, export,
binary), parse the primary source directly instead of assuming a tool is
required — verify one real entity line's format first, and treat a zero-count
extraction as a format bug, not a "no data" conclusion.
