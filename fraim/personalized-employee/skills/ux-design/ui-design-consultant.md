# Skill - ui-design-consultant

Act as a design-taste consultant for Phone Box's two real UI surfaces: the
marketing **website** (`website/`) and the **Expo companion app** (`app/`).
This skill is the judgment layer — what looks generic vs. considered, what
layout/type/spacing choice to make, what to cross-check before shipping. It
does not replace the synced FRAIM ux-design skills; it feeds them:

- **`user-flow-mapping`** owns the flow/IA diagram itself — use this skill's
  IA rules to inform the flow, then hand the flow to that skill.
- **`ui-baseline-validation`** owns pass/fail verification against a design
  standard — this skill is how you decide what that standard should be
  before validation runs.
- **`usability-test-protocol`** owns testing with real participants — this
  skill is for the design decisions being tested, not the test itself.

For **native component patterns specific to the Expo app** (tab bars, sheets,
safe area, gesture/press feedback, platform differences), use the
`expo-react-native-dev` skill
(`fraim/personalized-employee/skills/mobile/expo-react-native-dev.md`)
instead of applying web patterns to native screens. That skill also owns the
"what libraries this app actually has" constraint (no `react-navigation`/
`reanimated`/`gesture-handler`/`expo-haptics` — deliberate, per `app/App.tsx`
and `app/src/ui/AnimatedPressable.tsx`).

This skill deliberately excludes motion: for any animation, transition,
or motion question on either surface — whether to animate at all, which
tool (CSS/GSAP on the website, `Animated`/Reanimated on the app), curve,
duration, or spring — use the sibling **`motion-and-animation`** skill in
this same directory instead. That skill owns the full duration/easing/
spring tables and the frequency-gate ("should this animate at all") logic;
this skill owns everything else (typography, color, layout, IA, anti-generic
audit, component taste).

## Read before designing

Before proposing anything, read what already exists — this project has a
committed direction, not a blank slate:

- `website/css/styles.css` and `website/index.html` / `dashboard.html` — the
  website's current visual system (recent direction: a "vault time-lock"
  aesthetic).
- `app/src/theme/tokens.ts` and `theme.ts` — spacing/radius/type-scale/
  elevation tokens already in use. New or touched styles reference these;
  don't invent a parallel scale.
- The installed **`apple-design`** skill — this project has already adopted
  Apple's fluid-interface principles (spring-based press feedback, size-
  specific tracking/leading, reduced-motion handling) across the website,
  app, and box UI (see recent commit history). Load it for the full
  motion/typography/materials rationale; this skill only adds the concrete
  checks and values layered on top for this project.

Never propose a new visual direction that competes with the committed one
without saying so explicitly and why.

## Anti-generic audit (run on any new or reviewed surface)

The fastest way to catch "looks AI-generated" before a user does. Check for:

**Typography** — browser-default fonts or Inter with no character; headlines
with loose tracking/leading (should be tight, size-specific — see
`apple-design`); body paragraphs wider than ~65 characters; only weights
400/700 used with nothing in between; all-caps subheaders everywhere; orphan
words on their own last line (`text-wrap: pretty`/`balance`); Title Case on
every header instead of sentence case.

**Color & surfaces** — pure `#000`/`#fff`; the purple/blue "AI gradient"
look; more than one accent color; generic flat `box-shadow` not tinted to the
surface hue; a lone dark section breaking an otherwise light page (or vice
versa) instead of a consistent tone shift.

**Layout** — three equal card columns as the default feature row; everything
centered/symmetrical; `height: 100vh` instead of `min-height: 100dvh` (iOS
Safari viewport jump); no max-width container on wide viewports; cards in a
row with misaligned CTAs/feature-list start positions; mathematically
centered elements that read as optically off (icon+text, text-in-button —
often need a 1–2px manual nudge).

**Interactivity** — no hover/press feedback; zero-duration transitions;
missing visible focus ring (accessibility requirement, not optional);
generic spinner instead of a skeleton matching the real layout shape; no
empty/error states; `window.alert()` for errors; dead `href="#"` links;
animating `top`/`left`/`width`/`height` instead of `transform`/`opacity`.

**Content** — Lorem Ipsum; "John Doe"/"Acme Corp"; suspiciously round numbers
(`50%`, `$100.00`); AI copywriting clichés ("Elevate", "Seamless", "Unleash",
"Next-Gen", "Delve", "In the world of…"); exclamation marks in success
messages; passive voice in error copy ("Mistakes were made" →
"We couldn't save your changes").

**Components & icons** — generic border+shadow+white card with no purpose
for the elevation; Lucide/Feather as the unexamined default (the app already
uses Feather via `@expo/vector-icons` — keep that consistent rather than
mixing icon sets, but don't add a second icon library to the website just
for novelty); rocketship-for-launch/shield-for-security cliché metaphors;
inconsistent stroke widths across an icon set.

## Numeric self-check (use, don't over-apply)

Three dials, each 1–10, to keep a surface intentional rather than randomly
loud or randomly flat. Pick values *per surface*, not one blanket number for
the whole project — the website (Persuade: visitor decides and acts) and the
in-hand app (Operate: visitor completes a task) warrant different settings:

| Dial | Website (marketing, Persuade) | App (utility, Operate) |
|---|---|---|
| Design variance (how far from a stock layout) | 5–7 | 2–3 — consistency and predictability beat novelty in a tool used daily |
| Motion intensity | 4–6 | 2–4 — see `apple-design` §14 and the reduced-motion rules already wired via `useReducedMotion` |
| Visual density | 3–5 (let marketing copy breathe) | 5–7 (a dashboard-style app can be denser than a landing page) |

Micro-rules worth checking on any pass: a hero holds at most ~4 distinct text
elements; a CTA label is one line, ideally ≤3 words; a bento/grid's cell
count matches the actual content count (no empty filler cells); don't zig-zag
an image/text layout more than 2 rows in a row before varying it; a pull-quote
or testimonial caps at ~3 lines.

## Layout, typography, spacing — the rules behind the audit

- **Hierarchy from weight + size + leading together**, not size alone (per
  `apple-design` §15). Tighten tracking as text gets larger; loosen leading
  on body copy, tighten it on dense data UI.
- **Grouping mirrors function.** A control lives near what it affects; if a
  label is needed to explain *why* a control is where it is, the placement is
  wrong, not the label.
- **Direct, specific labels beat safe generic ones** — name a nav item for
  its contents ("Stats", "Calendar"), not a vague umbrella ("Home"). The app
  already does this (`DashboardScreen`, `StatsScreen`, `CalendarScreen`,
  `SettingsScreen`) — keep new screens consistent with that convention.
- **Every screen answers**: where am I, where can I go, what's here, how do
  I get out. Never trap the user — this matters more on the app's flat
  4-tab structure (no router, no back stack) than on the website, where
  browser back exists for free.
- **Spacing and radius come from `app/src/theme/tokens.ts`** on the app side
  (`spacing.xs`–`xxl`, `radius.sm`–`pill`) and from `website/css/styles.css`'s
  existing scale on the website side. A new one-off magic number is a smell;
  check the token file before adding one.

## Motion belongs to a sibling skill

Duration/easing/spring tables, the animate-or-not frequency gate, GSAP vs.
`Animated`/Reanimated tool selection, reduced-motion wiring, and
interruptibility/velocity-handoff mechanics all live in
`motion-and-animation.md` in this same directory. Load that skill for any of
it rather than approximating a duration or curve here.

### Skill Input
- A UI surface, screen, component, or full page on the website or in the
  Expo app that needs to be designed, redesigned, or reviewed for taste.
- Optional: a specific complaint ("this feels generic", "this looks flat",
  "does this match our direction?").

### Skill Output
- For new/changed UI: concrete typography, color, spacing, layout, and
  motion decisions, each traceable to a rule above or to the project's
  existing tokens/CSS — not vibes.
- For a review: a short list of anti-generic-audit findings (what's
  generic, why, and the specific fix), plus a recommended dial setting
  when the surface's intent (Persuade vs. Operate) is ambiguous.
- A pointer to `expo-react-native-dev` for any native-component question and
  to the three synced ux-design skills for flow-mapping/validation/testing
  follow-through.

### Skill Steps
1. **Read the existing surface first.** Load the relevant tokens/CSS file
   and at least one representative existing screen or page before proposing
   anything new. Say plainly when a proposed direction diverges from the
   committed one (vault time-lock website, Apple-fluid app) and why.
2. **Classify the surface's mode** (Persuade for marketing/landing content,
   Operate for the app's task-completion screens) and pick dial settings
   from the table above accordingly, rather than applying one aesthetic
   uniformly across both surfaces.
3. **Run the anti-generic audit** against the target. List every finding
   with the specific fix, not a category name.
4. **Ground every value in a rule or an existing token**, not intuition —
   cite the section above (or `apple-design`, or the token file) each value
   came from.
5. **Hand off, don't duplicate.** If the work also needs a flow diagram,
   baseline validation, or a usability test, name the matching synced skill
   rather than performing that work inline here.

### Skill Guardrails
- **The committed direction wins.** This project already has a visual
  identity in progress (vault time-lock website; Apple-fluid app and box
  UI). Do not import a competing prescribed aesthetic (e.g. Swiss-brutalist,
  warm-editorial-minimalist, glass/"agency" maximalism) as if it were a
  neutral default — those are different projects' visual languages, not
  this one's.
- **Don't re-litigate `apple-design` or `motion-and-animation`.** For
  motion/typography/materials *principles*, load and cite those skills
  rather than re-deriving or paraphrasing them here; this skill only owns
  the audit checklist, the dial self-check, and the project-specific token
  pointers.
- **Web patterns are not app patterns.** Do not apply this skill's
  web-oriented CSS/layout language (hover states, `backdrop-filter`,
  breakpoints) to the Expo app's native screens — use
  `expo-react-native-dev` there instead.
- **Consultant, not owner.** Recommend and, when asked, implement; always
  say which existing file/token a change touches so it's reviewable, and
  never silently introduce a new dependency (icon library, font, animation
  library) to satisfy a stylistic preference — flag it as a proposal first.
