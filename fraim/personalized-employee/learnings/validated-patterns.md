# Validated Patterns

Durable judgment calls and successful unusual-but-correct decisions worth reproducing.

## Pending Review - 2026-07-19

### Proposed new entry

#### [P-HIGH] Attack the objective behind the literal request

**Recommendation**: When given a narrow instruction, solve the goal behind it — treat "find a cheaper X" as "reduce the cost of X", which includes buying the same X for less.

**Why FRAIM is proposing this**: On the Phone Box cost-down work, the literal task was "find a cheaper board," but the highest-ROI result came from also pricing the *existing* board across retailers — a move a swap-only search would have structurally missed. Solving the objective rather than the literal framing surfaced a zero-risk win alongside the swap option.

**Example**: The incumbent Waveshare ESP32-S3 board was ~$25 on Amazon but ~$18–19 at The Pi Hut — a ~$6/unit saving with no redesign — found only because the search reframed "cheaper board" as "lower board cost" and added an incumbent-across-channels price comparison before recommending the Sunton (~$15) swap.

**If approved, future behavior changes**: In any sourcing/cost-down task, an "incumbent across channels" price check is included before recommending a part swap.

**Scope if approved**: Save for all projects on this machine.

**Applies to**: all jobs.

**Review action**: Approve as-is, edit, reject, or defer.

**Technical trace**: Score 8.0. Last seen 2026-07-19. Recurrences 1. First synthesized: (pending).

---

#### [P-HIGH] Go to primary sources directly

**Recommendation**: When a question depends on an unfamiliar data file, parse the primary source directly instead of assuming its native tool is required.

**Why FRAIM is proposing this**: A "will a bigger battery fit?" question was answered by parsing the raw STEP CAD text with a regex — no SolidWorks or CAD tool installed — turning a vague guess into a measured envelope. Reaching for the primary source is faster and more defensible than waiting on tooling.

**Example**: A `CARTESIAN_POINT` regex over the STEP files yielded the enclosure bounding box (~196×195×27 mm), confirming room for a 2000–5000 mAh battery, with no CAD software available.

**If approved, future behavior changes**: For questions gated on a data/export/CAD file, the agent parses the file directly rather than reporting "need the tool."

**Scope if approved**: Save for all projects on this machine.

**Applies to**: all jobs.

**Review action**: Approve as-is, edit, reject, or defer.

**Technical trace**: Score 8.0. Last seen 2026-07-19. Recurrences 1. First synthesized: (pending).

---

#### [P-HIGH] Represent "none" honestly — don't fabricate to satisfy a tool

**Recommendation**: When a tool or schema seems to want a value that doesn't truly exist, represent the absence honestly rather than inventing a placeholder.

**Why FRAIM is proposing this**: During onboarding the agent nearly invented placeholder build/test commands to get past a config validator, then caught that on-device firmware genuinely has no host build/test and omitted the block instead. Fabricating to satisfy tooling produces false state; representing "none" honestly is the correct call.

**Example**: The FRAIM `customizations.validation` block wanted three commands; rather than invent fake ones, the agent removed the block because the CircuitPython firmware has no host build/test — matching the project's real "verify on-device only" reality.

**If approved, future behavior changes**: The agent never fabricates commands, readings, or data to satisfy a schema/tool; it omits or reports the absence.

**Scope if approved**: Save for all projects on this machine.

**Applies to**: all jobs.

**Review action**: Approve as-is, edit, reject, or defer.

**Technical trace**: Score 8.0. Last seen 2026-07-19. Recurrences 1. First synthesized: (pending).
