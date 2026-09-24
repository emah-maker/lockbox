# Evidence — Supplier Discovery & Qualification: Phone Box Board Alternative

## Summary
- **Job:** supplier-discovery-and-qualification
- **Objective:** Find a cheaper board to replace the ~$25 Waveshare ESP32-S3
  Touch LCD 1.47" (~62% of the $40.77 BOM) without dropping any of the 7
  functions and while staying on CircuitPython.
- **Deliverable:** `docs/procurement/board-cost-reduction/02-supplier-longlist-and-shortlist-2026-07-19.md`
  (markdown per the user's standing deliverable-format preference; no .pptx).

## Work Completed
- Loaded requirements from `fraim/personalized-employee/context/project_context.md`
  and `rules/project_rules.md`, plus the onboarding retrospective (L0).
- Ran a broad multi-channel supplier scan (OEM-direct Waveshare, LILYGO,
  budget vendors Sunton/Guition/Elecrow/VIEWE, Adafruit first-party, radio-free
  RP2040/RP2350/SAMD51) via four parallel web-research passes with source URLs.
- Built a 14-candidate longlist, a weighted shortlist scorecard, an exclusion
  list, and a risk register. All in the deliverable above.

## Key Result
- **Primary recommendation: Sunton ESP32-2432S024C (~$15)** — official
  CircuitPython build, CST820 capacitive touch, 240×320 rectangular screen
  (larger than incumbent), free PWM GPIO. Net saving ≈ **$8–9/unit (~20% of BOM)**
  after adding an external TP4056 charger + voltage divider (~$1.50).
- **Recommended next step:** buy one unit for a bench prototype to confirm free
  GPIO count, `displayio` + CST820 bring-up, and the battery add-on before
  switching the design.

## Feedback History
### Round 1 (2026-07-19) — ADDRESSED
- **Item 1 — purchase links:** Added a verified "Purchase links" table to the
  deliverable. New finding: the incumbent board is **£14.40 (~$18–19) at The Pi
  Hut** vs. ~$25 Amazon (~$6/unit saving, no redesign). LILYGO T-Display-S3 Touch
  confirmed ~$37 and sold out at lilygo US → **dropped** from shortlist.
- **Item 2 — CAD battery fit:** Parsed `hardware/cad/main-case.step` / `hardware/cad/lid.step` (mm). Main
  Case ≈ 196×195 mm footprint, ~27 mm walls (usable depth ~20–25 mm). Space is not
  the constraint; a 2000–5000 mAh cell fits. Added a "CAD check" section.
- Full record: `docs/evidence/phone-box-board-alt-supplier-discovery-feedback.md`.

## Validation
- Every price/spec claim is backed by a source URL in the deliverable.
- CircuitPython support confirmed against circuitpython.org board pages.
- Honest flags recorded: budget-vendor GPIO scarcity, no onboard battery on
  Sunton, touch-driver port, UI re-layout, and price volatility / fetch blocks.

## Quality Checks
- Longlist separated by channel; ≥10 candidates.
- Rejections documented with reasons so they are not re-litigated.
- No supplier capabilities invented; unconfirmed items marked "unconfirmed".

## Phase Completion
load-strategy-and-requirements → research-supplier-market → build-longlist →
qualify-shortlist → document-exclusions-and-risks → submit. No blockers.
