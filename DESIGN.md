# Design

<!-- impeccable:design-schema 1 -->

## Surface

`website/index.html` (Persuade) and `website/dashboard.html` (Operate, inherits
the same tokens). Static HTML/CSS/JS, no build step. The companion app's icon
(`app/assets/icon.png` / `app/assets/adaptive-icon.png`) shares this same
world by explicit user request — one unified identity across the marketing
site and the app icon, not two independent decisions.

## World

**Checkpoint Claim-Ticket.** Phone Box's precommitment mechanism is framed as
a security-checkpoint surrender-and-reclaim ritual: you hand a restricted
item into a stainless tray, it's tagged with a claim ticket, and the only way
it comes back is through that ticket's own rules (a countdown, a tunable
override). The site's chrome — never the actual 3D-printed product, which
stays honestly depicted — borrows brushed-stainless-steel, thermal-receipt
paper, rubber ink-stamp, and barcode-manifest language to carry that idea.

This is a full replacement of the previous "vault time-lock" world (brass
plates, rivets, engraved eyebrows), which the user explicitly asked to
replace rather than refine, treating the old look as evidence/anti-reference
only. Chosen via the skill's direction-roll ritual against seven grounded
real-world precommitment rituals (casino self-exclusion, industrial
lockout/tagout, an ignition interlock, a pharmacy tamper-seal, the Ulysses
myth, a security-checkpoint claim ticket, a gym day-locker); seed key
`dc54e762`, assigned index 6 (the checkpoint claim-ticket candidate). Raised
past six dealt challengers (an Alan Fletcher wit-poster, a torn-flyer club
wall, a particle-detector event display, a hand-drawn zine explainer, a
memory-quilt atlas, and raku-ceramics smoke-flash) — each declined on
audience identification or product clarity, but each donated one discipline
into the built direction: a bold pictorial device leading each major section,
a permanent stamped record of every session/override that is never quietly
reset, and stats rendered as bold graphic marks rather than soft numerals.

## Palette

Status colors are unchanged real product truth, pulled directly from the
firmware theme (`Box-code/lib/lock_config.py`) exactly as before — this
redesign restyles the chrome around them, never the status semantics
themselves.

| Token | Value | Role |
|---|---|---|
| `--locked` / `--locked-2` | `#EF5350` / `#FF8783` | **committed accent.** Firmware's fixed "locked"/SEIZED state. Override mechanism, primary CTAs, countdown, ink-stamp marks. |
| `--closed` | `#F2B84B` | "closed"/HOLDING/transitional status only |
| `--unlocked` / `--unlocked-2` | `#35D07F` / `#6EE6AB` | "unlocked"/CLEARED/success status only |
| `--bg` / `--bg-2` | `#1A1A1C` / `#131314` | matte institutional charcoal (replaces the old blue-black slate) |
| `--surface` / `--card` / `--card-2` | `#212123` / `#242426` / `#2A2A2D` | panels |
| `--text` / `--text-2` / `--text-3` | `#F2F1EC` / `#B2AFA5` / `#8F8C82` | ink (`--text-3` lightened from an earlier `#7D7A70`, which measured ~4.04:1 on `--bg` — below the 4.5:1 floor it's actually used at for fine print/captions; now ~5.16:1) |
| `--steel` / `--steel-dim` / `--steel-ink` | `#C9CBCE` / `#83868A` / `#17181A` | **structural chrome, replaces brass.** Deliberately achromatic so it never collides with a status color — the comparison table highlights the "Phone Box" column with a steel barcode strip, not a status hue. |
| `--paper` / `--paper-dim` / `--paper-ink` | `#ECE6D6` / `#C8C1A8` / `#201E18` | thermal claim-ticket paper — used only on stub/tag/badge components, never the page ground, so the checkpoint counter and the ticket it hands you read as two distinct materials. |

Color strategy: Committed (coral-red carries the override/CTA/stamp story at
page scale) on the Persuade surface; the dashboard inherits the same tokens
without the Persuade flourishes.

**Rule enforced throughout:** red/amber/green are status semantics inherited
from the real product (locked=red/SEIZED, closed=amber/HOLDING,
unlocked=green/CLEARED; extended to the comparison table's yes/mid/no
stamps). Steel is structural only and never carries status meaning.

## Type

- Display (`--font-display`): Bebas Neue — checkpoint/hazard-signage
  stencil register. Replaces Big Shoulders.
- Body (`--font-body`): Archivo — a bureaucratic form-register workhorse
  grotesk. Replaces Overpass.
- Tabular/manifest (`--font-mono`): Courier Prime — carbon-copy manifest
  figures (comparison-table numbers, price figures, stamped badges, step
  tags). Replaces JetBrains Mono.
- Ticket readout (`--font-ticket`): VT323 — reserved narrowly for the hero's
  live countdown and the claim-tag's own ticket number, so its dot-matrix
  character stays a distinct, restrained signal rather than a general
  numeral face. (An earlier pass let it leak onto the pricing figure, step
  numerals, and two more components; all five were pulled back to
  Courier Prime during finish review so VT323 stays ticket-only.)

None of the four are on the "you stopped looking" default list (Fraunces,
Playfair, Space Grotesk, Space Mono, IBM Plex, Inter-as-display, DM Sans/
Serif, Outfit, Plus Jakarta Sans, Instrument Sans, etc.).

## Signature components

- **Checkpoint tray + claim tag** (`.checkpoint__tray`, `.claim-tag`, hero):
  the 3D-printed enclosure stays an honest matte-plastic depiction (not
  metal, no invented dial) — the stainless-tray and thermal-paper claim-tag
  language lives in the fixture it's presented in, not the product itself.
  The tag mirrors the device's own live countdown and SEIZED stamp, so it
  reads as the phone's real receipt, not a decorative sticker.
- **Manifest** (`.manifest`, Pillars section): four feature entries as a
  processed ledger — a small rotated steel case-number chip per entry,
  divided by a punch-hole perforation line (a CSS mask, not a background-
  color trick, so it holds over any surface behind it) — instead of four
  identical icon+heading+text cards, which the craft floor bans outright as
  the category's default scaffold.
- **Ledger strip** (`.ledger-strip`, Problem section): the three "phone
  always wins" figures as one unified barcode-topped strip rather than three
  isolated big-number/small-label cards (the craft floor's other banned
  default, the "hero-metric template").
- **Claim-stub step tags** (`.step__tag`, How-it-works): the four steps'
  numerals ride inside a small rotated paper claim-stub chip with a
  punch-hole dot, extending the checkpoint-tag material into a second
  section instead of a generic numeral badge.
- **Stamp** (`.stamp`, `.stamp--seized|holding|cleared|note`): a rotated
  rubber ink-stamp mark with a doubled outline, mapping directly to the
  firmware's real status words (SEIZED/HOLDING/CLEARED) — used on the
  comparison table's yes/mid/no cells and on marketing callouts, always
  status-colored when it names a status and steel/neutral when it doesn't.
- **Ticket badge** (`.ticket-badge`): a small paper claim-check chip with a
  punch-hole dot, used for marketing labels (pricing badge, hero pre-order
  tag) that are not a lock-state signal — kept visually distinct from
  `.stamp` so a status word and a marketing label never share one
  vocabulary.
- **Override press-demo** (`.override-demo`, "Make it yours" → Emergency
  override card): unchanged interactive 25-tick counter the visitor can
  press through to "Released," now framed by copy that ties it to the
  world's own promise — every release is logged, never quietly reset.
- **App icon** (`app/assets/icon.png` / `adaptive-icon.png`): the same box +
  touchscreen glyph as the nav brand mark, restyled in steel/charcoal, with a
  small torn claim-tag corner fold (bold shapes only, no fine barcode lines,
  so it survives down to a 16px launcher icon) tying the icon to the same
  world as the website.

## Motion

- Reveal-on-scroll and button-press mechanics are unchanged from the prior
  build (`--ease-snap` cubic-bezier, transform-based bars, no `width`/`height`
  animation) — this redesign restyled materials and components, not the
  site's existing motion grammar.
- Perforation dividers (`.tear`, and the manifest's per-row `::before`) are
  static punch-hole cuts, not animated; the world's motion budget stays
  spent on the reveal/press mechanics rather than a new signature move.

## Known accepted findings

- **Em-dash density** (detector: `em-dash-overuse`, advisory): pre-existing
  from the prior build; the user asked to keep copy/pricing claims as-is
  while restyling freely, so the copy text itself was not touched in this
  redesign. Accepted, not fixed.
- **Pictorial-device coverage is partial, not total.** The direction's FORM
  promise ("one pictorial device per section") is fully met in the hero,
  Pillars, Problem, and How-it-works; Adjust, Compare, and Pricing carry
  checkpoint-world material too (the override-demo proof, the barcode+stamp
  comparison table, the ticket-badge pricing card) but not a distinct
  illustrated device of their own, and FAQ/Waitlist stay purely functional.
  Flagged by finish review as a remaining open item; left as-is pending the
  user's call on whether it's worth a further pass.
- **`app/assets/adaptive-icon.png` ships with an opaque baked-in background
  instead of true alpha transparency.** This session had no SVG rasterizer
  and no image-generation tool; the PNG was produced by screenshotting the
  source SVG in a real browser, which could not preserve alpha through this
  tool chain. Both `icon-source.svg` and `adaptive-icon-source.svg` (in
  `app/assets/`) are the clean vector sources — re-export `adaptive-icon.png`
  with a proper alpha-preserving pipeline (Inkscape, ImageMagick, a
  browser's own "export as" with real alpha support, etc.) when available,
  so Android's adaptive-icon mask gets a genuinely transparent foreground
  layer instead of a same-color stand-in.
- The mechanical detector ran in degraded/regex-only mode this session (the
  optional `htmlparser2`/`css-select`/`css-tree`/`domutils` parser deps
  aren't installed) — full selector matching was not checked by tooling.
  Contrast was spot-checked by computation for `--text-3` (the one color
  actually near the floor) and by eye elsewhere across desktop + mobile
  screenshots in `.impeccable/review/`.

## Process note

This build had no image-generation tool available, so the direction round
ran through plain structured questions rather than the visual decision page,
and the execution contract was code-led by contract (no comp exists to hold
the build to, not even a critique-reference comp) — both disclosed to the
user at the time. The finish review and this document were produced by a
fresh general-purpose subagent carrying the shipped `impeccable-finish-
reviewer` role's exact instructions (that named agent type isn't registered
in this harness) rather than the harness's own named agent; disclosed here
per the skill's substitution-disclosure rule. The review ran two full rounds
(initial review → fix batch → recapture → verdict pass), per the skill's own
ceiling; the verdict's two remaining open items (pictorial-device coverage,
icon alpha) are recorded above under Known accepted findings rather than
spent on a third round.
