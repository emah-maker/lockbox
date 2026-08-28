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

**Unified to the app palette (2026-08-28, user decision).** The Persuade
surface's bespoke Checkpoint palette (charcoal `--bg`, coral-red
`--accent`/committed-brand color) described below as a considered choice has
been superseded: `website/css/styles.css`'s `:root` now ports
`app/src/theme/theme.ts`'s `MODES.dark` + `ACCENTS.dark.mint` token values
verbatim — the same values `dashboard.css` already used for
dashboard.html/login.html — so the marketing site, dashboard, and app read as
one product instead of two palettes. The WORLD itself (Checkpoint
Claim-Ticket framing, stainless tray, thermal ticket paper, rubber
ink-stamp, steel structural chrome, the Bebas Neue/Archivo/Courier
Prime/VT323 type system below) is unchanged — only the color roles are.
Status colors still map to the real firmware theme
(`Box-code/lib/lock_config.py`) exactly as before, just re-expressed through
the app's own `danger`/`warn`/`success` roles (whose hex values already read
as close kin to the old coral/amber/mint). The one deliberate semantic
change: the page's primary brand accent (buttons, focus rings, selection,
the price/waitlist emphasis borders) moved off status-red onto the app's
own accent role (mint, `#22C55E`) instead of coincidentally reusing the
locked-status color the way the original build did. Current table:

| Token | Value | Role |
|---|---|---|
| `--locked` / `--locked-2` | `#EF4444` / `#F87171` | app `danger` — "locked"/SEIZED status only (was `#EF5350`/`#FF8783`) |
| `--closed` | `#F2B84B` | app `warn` — "closed"/HOLDING/transitional status only (unchanged) |
| `--unlocked` / `--unlocked-2` | `#22C55E` / `#4ADE80` | app `success` — "unlocked"/CLEARED status only (was `#35D07F`/`#6EE6AB`) |
| `--accent` / `--accent-text` | `#22C55E` / `#04210F` | app `accent` (mint) — the page's brand accent: primary CTAs, focus rings, selection, emphasis borders (was the same value as `--locked`, i.e. coral) |
| `--bg` / `--bg-2` | `#0B0B0C` / `#08080A` | app `bg` (was `#1A1A1C`/`#131314` charcoal); `--bg-2` stays a hair darker than `--bg` (dashboard.css sets both flat) purely so the page's own ambient depth-wash still has two shades to gradient between |
| `--surface` / `--card` / `--card-2` | `#17181B` / `#17181B` / `#17181B` | app `surface` (was `#212123`/`#242426`/`#2A2A2D`) |
| `--text` / `--text-2` / `--text-3` | `#FFFFFF` / `#9AA0A6` / `#9AA0A6` | app `text`/`textDim` (was `#F2F1EC`/`#B2AFA5`/`#8F8C82`); the app has no third text tier, so `--text-3` now aliases `--text-2` instead of inventing a hue the app palette doesn't have |
| `--steel` / `--steel-dim` / `--steel-ink` | `#C9CBCE` / `#83868A` / `#17181A` | **structural chrome, replaces brass.** Not an app theme role — unaffected by the unification, still deliberately achromatic. |
| `--paper` / `--paper-dim` / `--paper-ink` | `#ECE6D6` / `#C8C1A8` / `#201E18` | thermal claim-ticket paper. Not an app theme role — unaffected, still a material color, not a theme hue. |

**Rule enforced throughout:** red/amber/green are status semantics inherited
from the real product (locked=red/SEIZED, closed=amber/HOLDING,
unlocked=green/CLEARED; extended to the comparison table's yes/mid/no
stamps). Steel is structural only and never carries status meaning.

Recaptured 2026-08-28 against the live mint palette: the three marketing
renders at the repo root (`hero-top.png`, `pricing-costbars.png`,
`pricing-revealed.png`) were re-shot at their original viewport sizes, same
framing as before, so the filenames' established meanings hold even though
two of them describe their contents poorly. `hero-top.png` (1041x835,
desktop) is the untouched hero section at the top of the page — nav bar,
"The smart focus lockbox." heading, device mock. `pricing-costbars.png`
(389x842, mobile) is **not** a pricing cost breakdown — it's the mobile nav
menu open, scrolled down far enough that only a sliver of the hero device,
the claim-ticket graphic, and the top edge of the hero heading peek out
below the menu panel. `pricing-revealed.png` (389x842, mobile) is the one
that actually matches its name: the `#pricing` section scrolled to the top,
showing the "Pay once. Focus for years." heading and the full $79/$99
price card. `hero.png` / `phonebox-hero.png` predate even the coral palette
(different nav/copy entirely) and `phonebox-desktop-1280.png` happens to
already be mint-toned but is likewise stale content-wise — none of those
three were touched by this pass; whether to replace them is a separate,
human call.

---

The design history below (world selection, prior palette rationale) is kept
for the record; the palette values in it are superseded by the table above.

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
- **Manage labels panel** (`.dash__labels-list`, `.dash__label-add`,
  dashboard.html's "Manage labels" card): catalog CRUD for the dashboard's
  custom labels -- add via the same 12-swatch `LABEL_SWATCHES` set as the
  app's own `CustomLabelsSection.tsx` `ColorSwatchRow`, inline rename, a
  compact per-row recolor popover (`.dash__swatch-pop`) rather than a full
  form, and an inline delete confirmation (`.dash__labels-confirm`) that
  swaps in for the row instead of a `window.confirm` dialog -- a visible,
  in-place record of the action rather than a silent native prompt.
- **Session relabel chip↔picker** (`.dash__label-picker`, `.dash__chip-btn`,
  `.dash__chip-select`): the sessions table and calendar day list's label
  cell is now a click target -- a `.dash__chip` pill (resolved label,
  one-time typed tag shown dashed, or dashed "Untagged") swaps for a native
  `<select>` on click; Escape reverts without committing. Reuses `.dash__chip`'s
  existing pill shape unchanged; only adds the caret affordance and the swap.
- **Save/error flash** (`.dash__save-flash`, `.dash__save-flash--err`): a
  one-shot `--unlocked`/`--locked` outline ring on a control once its write
  settles -- fire-and-forget, not a persistent state, and still covered by
  styles.css's existing `prefers-reduced-motion` rule rather than a new
  exception to it.

## Motion

- Reveal-on-scroll and button-press mechanics are unchanged from the prior
  build (`--ease-snap` cubic-bezier, transform-based bars, no `width`/`height`
  animation) — this redesign restyled materials and components, not the
  site's existing motion grammar.
- Perforation dividers (`.tear`, and the manifest's per-row `::before`) are
  static punch-hole cuts, not animated; the world's motion budget stays
  spent on the reveal/press mechanics rather than a new signature move.
- The dashboard's label-management pass added two more `.dash__fade`
  siblings, scaled for smaller swaps rather than a whole panel:
  `.dash__msg` (inline status-message fade) and `.dash__pick-fade`
  (chip↔picker, swatch-popover, and add-form↔cap-message swaps). Same curve
  and technique as `.dash__fade`, not a new idiom. The one actually new
  technique is the save/error flash (`.dash__save-flash` /
  `.dash__save-flash--err`, see Signature components): a fire-and-forget
  `@keyframes` ring instead of a transition+class-removal pair, since there
  is no persistent "flashed" end state to hold open or reverse.

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
- **No visual confirmation exists for the dashboard label-management pass.**
  Zero screenshots were captured — the Browser pane did not composite frames
  in this environment (reproduced independently; an environment limit, not
  an agent failure). Every check on the new "Manage labels" panel, the
  swatch picker, and the session relabel chip↔picker used `read_page`
  (accessibility tree), computed-style inspection, and real keyboard events
  against the shipped modules loaded live — never a rendered capture. That
  establishes structure and behavior, not appearance. Accepted because the
  environment could not produce the missing evidence this session; treat
  this UI as visually unconfirmed until someone recaptures it where the pane
  composites.
- **The write-success path was never exercised.** Signing in is prohibited
  for these agents (no entering credentials), so every relabel/recolor/
  rename/delete/add write this pass ran against injected mock data with no
  live Firestore behind it — confirming the error path (the red
  `.dash__save-flash--err` ring, the write-error banner) but not the success
  path (the green `.dash__save-flash` ring, the real post-write rerender).
  The backend (firestore.rules' write shapes) was proved separately and is
  already deployed, which narrows the risk, but "this UI successfully
  writes to Firestore" is not something this pass established. Accepted
  because live sign-in is out of reach for this pipeline; verify manually
  with a real account before relying on the success path.
- **`website/js/focusStats.js` was NOT modified by this pass.** An earlier
  draft of this review recorded it as an off-limits-file violation; that was
  wrong, and the finding is retracted here rather than deleted, so the
  correction is on the record. The `+58` lines the diff shows
  (`createCustomLabel`/`renameCustomLabel`/`recolorCustomLabel`/
  `deleteCustomLabel`, `LABEL_SWATCHES`, `MAX_CUSTOM_LABELS`,
  `MAX_LABEL_NAME_LENGTH`, `allLabelChoices`) are uncommitted work from the
  *preceding backend pass*, which ported them from
  `app/src/stats/customLabels.ts` and explicitly handed them to this build to
  consume. `labelsPanel.js` and `sessionLabelPicker.js` import them, as
  intended. The mistake was measuring the diff against `HEAD` instead of
  against the working tree as it stood when this pass began — this tree
  carries uncommitted work from more than one pass, so a HEAD-relative diff
  cannot tell them apart. Worth remembering for the next review.
- **The `.dash :focus-visible` change is a deliberate palette choice, not a
  bug fix.** `--steel` (styles.css's global focus-ring color) resolves
  correctly on the dashboard too — it's set unconditionally in styles.css's
  `:root`, which dashboard.html loads before dashboard.css — so focus rings
  here were never actually broken. This pass scopes the dashboard's focus
  color to `--unlocked` instead, to keep it visually distinct from the
  `--locked` save/error flash introduced in this same pass, not to repair an
  undefined-token defect. An earlier in-progress code comment stated the
  inaccurate "undefined token" framing; corrected during this review
  (dashboard.css, near the `:focus-visible` rule).
- **`dashboard.js`'s line count (683) is over the ~500-line convention**,
  including net of an unrelated, concurrent "focus goals" feature threaded
  through it (`goals.js`; roughly 60 of those lines) that is not part of
  this task's scope and is not further described here. To be accurate about
  direction of travel: this pass *reduced* the file, 763 → 683, while moving
  641 lines into three new focused modules. It did not bloat it. (An earlier
  draft cited "+155 vs. 528", measured from `HEAD` — that span includes the
  preceding backend pass and the concurrent goals work, not this build.) The
  file is nonetheless still over budget after this pass's own contribution —
  the ctx/getter wiring for the two extracted modules, the `els` additions,
  `currentSettings` tracking, the `mountLabelsPanel` call, the table/calendar
  integration points, plus an unrelated load-timeout robustness fix. The bulk of
  the new logic was properly split into three new focused files
  (`labelsPanel.js`, 379 lines; `sessionLabelPicker.js`, 198 lines;
  `dashMessage.js`, 64 lines); `dashboard.js` itself would benefit from a
  further extraction in a follow-up pass (the calendar-rendering block is
  the largest remaining candidate).

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

A later pass added the dashboard's label-management feature (Manage labels
panel, session relabel chip↔picker) through the same four-agent pipeline
(designer → implementer → verifier → finisher), each a fresh subagent
substituting for the harness's own unregistered named roles, disclosed here
on the same basis as above. Two evidence gaps carry across every stage of
that pipeline into this review and must not be read past: **no screenshot of
this feature exists** (the Browser pane would not composite frames in this
environment; verification instead used the accessibility tree, computed
styles, and real keyboard events against the live modules), and **the
Firestore write-success path was never exercised** (sign-in is off-limits to
these agents, so every write ran against injected mock data and only the
error path is proven). Both are recorded in full under Known accepted
findings above. The verdict for this pass is ship with noted findings, not a
clean ship — the checklist above is clean, but it is not a substitute for
someone actually looking at the rendered page and signing in as a real user.
