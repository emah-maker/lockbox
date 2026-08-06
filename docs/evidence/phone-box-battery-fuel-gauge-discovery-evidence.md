# Evidence — Supplier Discovery & Qualification: Phone Box Battery Fuel Gauge

## Summary
- **Job:** supplier-discovery-and-qualification
- **Objective:** Find a small board that measures battery percentage *accurately*,
  replacing the incumbent voltage-divider + curve estimate in
  `Box-code/lib/lock_battery.py` (inaccurate on a single LiPo due to the flat
  discharge curve and load sag from the servo/backlight).
- **Deliverable:** `docs/procurement/battery-fuel-gauge/02-fuel-gauge-longlist-and-shortlist-2026-07-23.md`
  (canonical markdown) + `.docx` render (project rule: documentation in Word).

## Work Completed
- Loaded strategy/requirements from `fraim/personalized-employee/context/project_context.md`,
  `rules/project_rules.md`, `docs/procurement/bom.md`, and the live firmware
  (`lock_battery.py`, `lock_config.py`).
- Confirmed the qualification-critical pin-map fact directly from
  `lock_config.py`: the AXS5106L touch runs on an I2C bus (GPIO41/42/47/48), so an
  I2C fuel gauge (MAX1704x @ 0x36) **shares that bus with zero new GPIO**.
- Ran a broad multi-channel supplier scan (first-party maker, resellers, competing
  maker, adjacent/education vendor, budget marketplace, component-level, and the
  incumbent/firmware path) via web research with source URLs.
- Built a 12-candidate longlist, a weighted shortlist scorecard, an exclusion
  list, and a risk register in the deliverable.

## Key Result
- **Primary recommendation: Adafruit MAX17048 (#5580), $5.95** — first-party
  `adafruit_max1704x` CircuitPython library, ModelGauge SoC (no sense resistor),
  STEMMA-QT plug, ~26×20 mm, in US stock, shares the touch I2C bus (no new GPIO).
- **Budget variant:** generic MAX17048/MAX17043 module (~$2–6) or 7Semi mini —
  same chip, same driver — verify it's a genuine Maxim IC first.
- **Honest alternative flagged (attack-the-objective):** the incumbent Waveshare
  board has no gauge IC; a firmware-only OCV/relaxation improvement is a $0 option
  that won't match a real gauge under load. Offered to prototype it first (free).
- **Recommended next step:** buy one Adafruit #5580 for a bench prototype;
  validate shared-bus read alongside touch and the `lock_battery.py` swap before
  committing to the BOM. No RFI/RFQ needed at ~$6 prototype qty.

## Validation
- Every price/spec claim backed by a source URL read live 2026-07-23 (Adafruit
  #5580 price/size, `adafruit_max1704x` covers MAX17048+MAX17043, LC709203F EOL,
  SparkFun MAX1704x accuracy/retirement, DFRobot DFR0563, 7Semi, HiLetgo).
- Pin-map claim validated against the actual `lock_config.py`, not assumed.
- Items without a clean price fetch are marked "unconf." and flagged as estimates.
- No CircuitPython support was invented: the gating must-have is a maintained CP
  library; BQ27441 (no CP lib) and LC709203F (dead chip) were excluded for it.

## Quality Checks
- Longlist separated by channel; 12 candidates (market supports it).
- Rejections documented with reasons so they are not re-litigated.
- Scorecard gates technical/CircuitPython must-haves before price.
- No firmware "tested" claim — no on-device run was performed this session.

## Phase Completion
load-strategy-and-requirements → research-supplier-market → build-longlist →
qualify-shortlist → document-exclusions-and-risks → submit. No blockers.
