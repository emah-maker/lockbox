# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Self-improvement / productivity buyers: students, remote workers, and anyone
trying to break a phone/doomscrolling habit and get into deep work. They land
on the marketing site to decide whether a physical lockbox is worth buying
over a free app-based blocker.

## Product Purpose

Phone Box is a physical lockbox that locks a phone away for a set focus
session, with a touchscreen countdown on the box itself and a companion app
for live status, focus stats, and call alert-through. It exists so willpower
isn't the only thing standing between a user and their phone — the lock is
real, not just a screen-time toggle that can be disabled in two taps.

## Positioning

Not just "a box you can't get into" — the differentiator is the tunable
emergency override (adjustable friction/duration so it fits real emergencies
without being an escape hatch) combined with smart features: a touchscreen
countdown UI on the device itself, BLE-connected companion app with live
status and focus stats, and incoming-call alert-through so the box can light
up for an important call while staying locked. Software blockers (Forest,
Opal) can be uninstalled or permission-toggled in seconds; Phone Box can't.
Dumb lockboxes (Kitchen Safe-style) have no override tuning and no smart
integration.

## Operating Context

Visitor evaluates the product entirely through the marketing site (no
in-person trial). Purchase is one-time hardware, not a subscription signup.
The companion app (React Native/Expo, iOS-first) and the box firmware
(CircuitPython, touchscreen UI) are separate surfaces from this website but
share the same product story and BLE feature set (call alerts, live stats).

## Capabilities and Constraints

- One-time $99 price, no subscription, ever.
- True physical lockaway (hardware, not a software toggle).
- On-device touchscreen countdown.
- Tunable emergency override (adjustable so it isn't trivially easy, but real
  emergencies are still handled).
- Companion app: live box status/battery, focus stats (total focus time,
  sessions, completed, streak, longest), incoming-call alert-through over BLE.
- Site is static HTML/CSS/JS (no framework) — existing stack, not up for
  reconsideration.
- The enclosure is 3D-printed plastic, not machined metal, and has no
  mechanical/analog dial — the only physical controls are override buttons and
  a digital touchscreen. Any visual metaphor (vault, time-lock, etc.) must
  stay in the site's chrome/graphic language, never claim the physical box
  itself is metal or has a rotary dial.
- The firmware's real on-device palette (`Box-code/lib/lock_config.py`) is a
  muted slate dark theme (`#0D1117` bg / `#161B22` surface / `#F0F3F6` ink /
  `#7D8590` grey) with calmer mint/coral/amber accents (`#35D07F` /
  `#EF5350` / `#F2B84B`), deliberately less saturated than pure primaries.
  Status semantics are fixed regardless of theme: **locked = red, closed =
  amber, unlocked = green**. This is real product truth, not a website
  invention — a faithful redesign should use these actual colors/semantics
  rather than the current site's invented neon green (`#00c040`) and its
  "LOCKED" label rendered in green, which contradicts the firmware's own
  locked=red convention.

## Brand Commitments

- Product name "Phone Box" and the "$99, one-time, no subscription — ever"
  claim are fixed and must read clearly on the redesigned site.
- Existing visual identity (current colors/type/imagery) is NOT a locked
  brand commitment — it is evidence/anti-reference only. Full restyle is
  in scope; factual copy and pricing claims are not.

## Evidence on Hand

- Existing hero imagery: `hero.png`, `phonebox-hero.png`,
  `phonebox-desktop-1280.png` at the repo root — real product renders, usable
  as-is or replaced with better art direction, not fabricated claims.
- No testimonials, press, or case studies on hand — do not invent any.

## Product Principles

1. The lock has to feel real and unbreakable — copy and visuals should earn
   trust in the physical mechanism, not just describe a feature list.
2. Smart, not gimmicky — call alert-through and live stats support the focus
   goal, they are not the headline over the core lockaway promise.
3. No subscription, ever, is a structural advantage — make it legible without
   turning the whole page into a pricing pitch.
4. Override tuning is the "grown-up" answer to "what about emergencies?" —
   it should read as considered, not as a loophole.
