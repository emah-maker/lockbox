# Design

<!-- impeccable:design-schema 1 -->

## Surface

`website/index.html` (Persuade) and `website/dashboard.html` (Operate, inherits
the same tokens). Static HTML/CSS/JS, no build step.

## World

**Vault time-lock.** Phone Box's precommitment mechanism is the same one bank
vaults used mechanical time locks for: remove the ability to act against your
own earlier decision, even under pressure. The site's chrome (not the actual
3D-printed product, which stays honestly depicted) borrows brushed-steel and
engraved-brass plate language to carry that idea — mounting plates with
rivets, an engraved-plate eyebrow treatment, a spec/certification-plate
comparison table.

Replaces the previous world (near-black background, single neon-green
accent `#00c040`, glowing edges, Inter + Space Grotesk) — an instance of a
named AI-landing-page default, not a considered identity — under the user's
explicit "open to bolder redesign" direction.

## Palette

Not invented: pulled directly from the real firmware theme
(`Box-code/lib/lock_config.py`), which is itself a "calmer, less saturated"
palette by the firmware author's own comment.

| Token | Value | Real-world source | Role |
|---|---|---|---|
| `--bg` | `#0D1117` | `C_BG` | page background |
| `--surface` / `--card` | `#161B22` / `#171C24` | `C_SURFACE` | panels |
| `--text` | `#F0F3F6` | `C_WHITE` | ink |
| `--text-2/3` | `#A7AFB9` / `#7D8590` | `C_GREY` | secondary ink |
| `--locked` / `--locked-2` | `#EF5350` / `#FF8783` | `C_RED` | **committed accent.** Firmware's fixed "locked" state color. Used for the override mechanism, primary CTAs, the countdown while running. |
| `--closed` | `#F2B84B` | `C_AMBER` | "closed"/transitional/partial status only |
| `--unlocked` / `--unlocked-2` | `#35D07F` / `#6EE6AB` | `C_GREEN` | "unlocked"/success/positive-confirmation status only |
| `--brass` / `--brass-dim` | `#C9A876` / `#8A7355` | invented (plate/rivet material) | structural chrome — column emphasis, borders, icons, never a status signal |

Color strategy: Committed (coral-red carries the override/CTA story at
page scale), not Restrained or Drenched — a Persuade surface earns it, and
the brief explicitly asked for boldness.

**Rule enforced throughout:** red/amber/green are status semantics inherited
from the real product (locked=red, closed=amber, unlocked=green; extended
consistently to comparison-table yes/mid/no). Brass is structural only and
never carries status meaning — e.g. the comparison table highlights the
"Phone Box" column in brass, not red, so it doesn't collide with the "No"
cells' red.

## Type

- Display (`--font-display`): Big Shoulders — steel/ironwork lettering
  heritage, matches the plate/rivet material world. Replaces Space Grotesk.
- Body (`--font-body`): Overpass — DOT highway-signage heritage, reinforces
  the safety/signage register while staying highly legible. Replaces Inter.
- Numeric/technical (`--font-mono`): JetBrains Mono — every countdown,
  spec-plate figure, comparison-table number, and eyebrow label.

None of the three are on the "you stopped looking" default list (Fraunces,
Playfair, Space Grotesk, Space Mono, IBM Plex, Inter-as-display, DM Sans/Serif,
Outfit, Plus Jakarta Sans, Instrument Sans, etc.).

## Signature components

- **Device mounting plate** (`.device__mount`, hero): the 3D-printed
  enclosure stays an honest matte-plastic depiction (not metal, no invented
  dial) — the brass/rivet language lives in the plate it's mounted on, not
  the product itself. See `PRODUCT.md` Capabilities/Constraints for why.
- **Override press-demo** (`.override-demo`, "Make it yours" → Emergency
  override card): an interactive 25-tick counter the visitor can actually
  click through to "Released." Proves the tunable-override mechanism instead
  of only describing it.
- **Comparison table as spec plate**: monospace figures, brass column
  highlight, red/amber/green status semantics.

## Motion

- Reveal-on-scroll: shorter, snappier ease (`--ease-snap`,
  `cubic-bezier(0.5,0,0.15,1)`) and less travel (16px vs the old 22px) —
  reads as a plate settling into place, not a generic fade-up.
  `prefers-reduced-motion` still short-circuits it to instant.
- Buttons press physically: a 3px solid drop-shadow "ledge" that compresses
  on `:active`, instead of a soft translateY hover-only lift.
- All progress indicators (hero countdown bar, dashboard trend bars) animate
  via `transform: scaleX/scaleY`, never `width`/`height`, to avoid layout
  thrash (a craft-floor / detector finding, fixed during this build).

## Known accepted findings

- **Em-dash density** (detector: `em-dash-overuse`, advisory): the existing
  copy voice uses em-dashes throughout. Per the user's explicit instruction
  to keep copy/pricing claims as-is and restyle freely, the copy was not
  rewritten. Accepted, not fixed.
- The mechanical detector ran in degraded/regex-only mode this session (the
  optional `htmlparser2`/`css-select`/`css-tree`/`domutils` parser deps
  aren't installed) — contrast and full selector matching were not checked
  by tooling. Contrast was checked by eye across desktop + mobile screenshots
  captured in `.impeccable/review/`; nothing under review reads as
  low-contrast, but this is a manual check, not a computed one.

## Process note

This build skipped the skill's dice-roll concept-card ritual
(`concept-seed.mjs` + `serve-question.mjs` decision page): this session has
no image-generation tool and no way to serve/open the local decision page.
One grounded direction was proposed and confirmed with the user directly via
plain questions instead, disclosed at the time. The finish review and this
document were produced in-thread by the building agent rather than by the
shipped `impeccable-finish-reviewer` / `impeccable-documenter` subagents,
because those exact named agent types aren't registered in this harness;
disclosed here per the skill's own substitution-disclosure rule.
