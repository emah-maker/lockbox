# Feedback for phone-box-board-alt — Supplier Discovery & Qualification

## Round 1 Feedback
*Received: 2026-07-19*

### Item 1 — ADDRESSED
- **Feedback**: Find (purchase) links for the potential alternatives.
- **Action**: Added a "Purchase links" table to the deliverable with verified
  retail URLs (Amazon US DIYmalls for both Sunton boards, The Pi Hut + Waveshare
  for the RP2350/RP2040 round boards, ProtoSupplies for LILYGO, Pi Hut + Amazon
  for the incumbent). Live-readable prices marked exact; scrape-blocked ones noted.
- **New finding**: The incumbent Waveshare ESP32-S3-Touch-LCD-1.47 is **£14.40
  (~$18–19) at The Pi Hut** vs. ~$25 on Amazon — a ~$6/unit saving with no
  redesign. LILYGO T-Display-S3 Touch is ~$37 and sold out at lilygo US, so it was
  **dropped** from the shortlist (not a cost win).
- **Status**: ADDRESSED

### Item 2 (round 1) — ADDRESSED
- **Feedback**: Read the CAD files to see if a larger battery could fit in the box.
- **Action**: Parsed `hardware/cad/main-case.step` and `hardware/cad/lid.step` (units = mm) and computed
  part bounding boxes. Main Case ≈ 196×195 mm footprint, ~27 mm wall height
  (usable interior depth ~20–25 mm); interior footprint ~190×190 mm after walls.
- **Conclusion**: Space is not the constraint. The 1000 mAh cell (~50×34×5 mm)
  uses a small fraction of the floor; a much larger LiPo (~2000–5000 mAh) fits on
  space alone — thickness (~6–12 mm) is the only tight axis vs. ~15–20 mm usable
  depth. Real limits become charge current, cost, and weight. Added a "CAD check"
  section with the measurements and a caveat that exact internal pocket/servo
  clearance needs SolidWorks confirmation.
- **Status**: ADDRESSED

## Round 2 Feedback
*Received: 2026-07-19*

### Item 1 — ADDRESSED
- **Feedback**: "give this to me in a word file."
- **Action**: Generated a formatted Word version of the deliverable at
  `docs/procurement/board-cost-reduction/02-supplier-longlist-and-shortlist-2026-07-19.docx`
  from the canonical markdown (headings, all 4 tables, bullets, blockquote, and
  clickable hyperlinks preserved). Markdown remains the canonical source; the
  .docx is the review surface.
- **Note**: This overrides the standing "plain markdown" deliverable preference
  for this specific artifact, at the manager's explicit request.
- **Status**: ADDRESSED

