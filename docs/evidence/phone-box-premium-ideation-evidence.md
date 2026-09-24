# Phone Box — Premium Feature Ideation (evidence + recommendation)

**Date:** 2026-07-19
**Job:** codebase-analysis-and-ideation
**Question:** What functionalities could be added to improve the product to validate a
higher price on the market?
**Method:** Bottom-up codebase analysis (what the hardware/firmware actually supports)
crossed with competitor pricing/feature research. Every "currently exists" claim traces
to a file; every suggestion names a concrete integration point.

---

## Bottom line

The Phone Box hardware is already **ahead** of most competitors (touchscreen, servo
latch, emergency override, LiPo + battery display) — features cheap boxes lack. In this
category the premium gap is **software, not hardware**: the products that command $59+
(Brick, Unpluq) win on app connectivity, scheduling, analytics, and accountability.

The pivotal technical fact: **the ESP32-S3's Wi-Fi + BLE radio is already in the BOM but
completely unused** — a repo-wide grep finds zero `wifi` / `bleio` / `socketpool` /
`adafruit_requests` usage. That means the highest-value premium features add **software
cost only, no BOM increase** — the highest-margin way to move upmarket.

**Target:** a credible retail move from a "dumb box" band (~$20–35) into the connected/
branded band (**$59–$89**), with an optional **family/accountability subscription**
(~$60–100/yr) as the only market-validated recurring-revenue path.

---

## 1. Currently exists (traced to code)

| Capability | Evidence |
|---|---|
| Timed physical lock; idle/closed/running/done state machine | `firmware/lib/lock_controller.py` |
| Servo-driven latch (PWM re-assert, hold-then-relax) | `firmware/lib/lock_servo.py` |
| Touchscreen H:M:S timer set by swipes; 3 countdown styles | `firmware/lib/lock_ui.py` |
| Emergency override by press-count (default 25, GPIO10) | `lock_controller.py`, `lock_config.py` (`OVERRIDE_PRESSES`, `BTN_OVERRIDE_PIN`) |
| LiPo voltage sense + % curve; **coarse** watt *estimate* | `firmware/lib/lock_battery.py`, `lock_config.py` (`BAT_*`) |
| USB/battery power policy + CPU scaling (240/80 MHz) | `firmware/code.py`, `firmware/lib/lock_power.py` |
| User settings persisted in NVM (override, sleep, brightness, auto-open) | `firmware/lib/lock_settings.py` (`_MAGIC=0x5D`) |
| Brownout-safe boot recovery | `firmware/safemode.py` |

## 2. Architectural patterns (why premium features slot in cleanly)

- **Config as single source of truth** — `lock_config.py` holds all pins/tunables. New
  peripherals add constants in one place.
- **Per-peripheral driver modules** — `lock_servo` / `lock_battery` / `lock_power` /
  `axs5106l` each wrap one device. Connectivity, RTC, and a current sensor each drop in as
  a **new sibling module**, no rewrite.
- **Explicit state machine** — transitions in `lock_controller.py` are a ready-made
  **event source** for usage analytics and accountability logging.
- **View/scene rendering with hit-testing** — `lock_ui.py` `VIEWS` tuple. New premium
  screens (stats, schedule, pairing/QR) add as new views in the swipe set.
- **Versioned NVM persistence** — `lock_settings.py` `_MAGIC` byte. Profiles/modes extend
  the existing layout with a magic bump.

## 3. Unused hardware = premium runway

| Asset | State | Enables |
|---|---|---|
| **Wi-Fi + BLE radio** (ESP32-S3) | In BOM, **zero code uses it** (grep-verified) | Companion app, scheduling, accountability, OTA — **no BOM cost** |
| **SD-card interface** (GPIO13–18) | Reserved, unused (noted in `lock_config.py`) | Local session history for analytics |
| **Free I²C bus @ 0x40** | Unused (per `docs/handoff/firmware-ai-context.md` §7) | INA219/INA226 → real current/power vs. today's estimate |
| **Wall-clock time (RTC/NTP)** | None (countdown only) | Scheduled/recurring locks (ESP32-S3 internal RTC + NTP over Wi-Fi) |

---

## 4. Market context (competitor research, 2026-07-19)

**Price bands**
- Budget "dumb" electronic boxes (ySky, generic Amazon): **$20–35**
- Mid-tier hardware upsell (Habit Control, charge-through): **~$34**
- Branded / connected premium (Brick $59, kSafe $59–79): **$59–79**
- Self-contained ceiling: **~$79**; above that needs craft-object positioning or a subscription
- Family/accountability subscription (Unpluq Family): **$99.95/yr**

**What commands a premium** (ranked, evidence-backed): (1) app connectivity with modes &
scheduling, (2) usage analytics/dashboards, (3) recurring/scheduled locks (start **and**
end times), (4) accountability / family / multi-device management, (5) charge-through
(lock while charging), (6) tamper resistance / "no override" integrity, (7) build quality /
design-as-object.

**Willingness-to-pay signals:** buyers explicitly pay for **physical friction** (app-only
blockers fail because they're "one tap" to bypass) — which validates a hardware box.
$59 is framed as a "cheap experiment" for people who already failed with free Screen Time.
Complaints about cheap versions: flimsy build, weak tamper resistance, easily defeated,
no scheduling.

**Recurring revenue:** one-time premium price is the safe default (Brick markets "no
subscription, ever" as a feature); a **family/accountability tier** is the only validated
recurring-revenue model in the category (Unpluq).

---

## 5. Actionable suggestions (ranked by margin × market-validated premium)

### Tier 1 — Software only, no BOM increase (highest margin)

1. **Companion app over BLE/Wi-Fi.** *Builds on:* unused ESP32-S3 radio; new sibling
   driver module + new `VIEWS` entry + pairing screen in `lock_ui.py`. *Why premium:* this
   is the entire $59 Brick / Unpluq value prop; it unlocks #2, #3, #4, #7. *Effort:* high.
2. **Scheduled / recurring locks.** *Builds on:* state machine + `lock_settings.py`; needs
   RTC (ESP32-S3 internal RTC + NTP once Wi-Fi exists). *Why premium:* named premium
   feature vs. single manual countdown. *Effort:* medium.
3. **Usage analytics / focus streaks.** *Builds on:* `lock_controller.py` transitions as
   the event source; store to reserved SD (GPIO13–18) or flash; new stats view. *Why
   premium:* Brick markets its dashboard as a differentiator. *Effort:* medium.
4. **Accountability / partner / family mode.** *Builds on:* existing override logic +
   connectivity (#1). *Why premium:* the clearest willingness-to-pay-more lever and the
   only validated subscription path (Unpluq Family $99.95/yr). *Effort:* high.
5. **Multiple lock profiles / modes.** *Builds on:* versioned NVM layout in
   `lock_settings.py` (`_MAGIC` bump) + existing settings-detail UI. *Why premium:*
   household / multi-use-case value. *Effort:* low.
6. **OTA firmware updates.** *Builds on:* connectivity (#1). *Why premium:* post-purchase
   feature delivery → recurring-value / subscription story. *Effort:* high.

### Tier 2 — Low-cost hardware adds ($1–3 BOM) with a clear "quality/security" story

7. **Charge-through (lock the phone while it charges).** *Builds on:* enclosure + a
   pass-through USB port; no firmware dependency. *Why premium:* this is the exact
   $20→$34 upsell in the market (Habit Control). *BOM:* ~$1–3.
8. **Real current/power metering.** *Builds on:* free I²C @0x40 for INA219/INA226; mirrors
   the `lock_battery.py` module pattern; replaces the coarse estimate with true
   runtime-remaining. *BOM:* ~$1–3.
9. **Tamper / lid-open detection + alarm.** *Builds on:* existing sense-button pattern
   (`BTN_LOCK_PIN`); add reed/hall switch + buzzer on a free GPIO. *Why premium:* directly
   answers the "easily defeated" complaint that penalizes cheap boxes. *BOM:* ~$1.

### Sequencing

Connectivity (#1) is the keystone — #2/#3/#4/#6 all depend on it. Recommended order:
**#1 → #2 + #3 → #4 (unlock subscription) → #6**, with the Tier-2 hardware adds (#7–#9)
folded into the next enclosure revision independently.

---

## 6. Accuracy / verification notes

- "Currently exists" claims each cite a file. Unused-radio claim is grep-verified
  (no `wifi`/`bleio`/`socketpool`/`adafruit_requests` in `firmware/`).
- I²C @0x40 and SD interface are **capabilities, not current code** — listed under
  "could be built," not "exists."
- Competitor prices: kSafe exact 2026 pricing and Kairos Kickstarter tiers were not
  live-readable (secondary/403 sources) and are approximate; the $20–35 budget band and
  $59–79 premium band are well corroborated across multiple listings.
- No firmware was changed. There is no host build/test suite; on-device verification would
  be required for any implementation.

---

## Feedback history

### Round 1 (2026-07-20) — ADDRESSED
Manager: "look into methods for tracking with an app or tracking with sd card and compare,
document this in a doc." → Delivered
`docs/brainstorming/tracking-app-vs-sd-comparison-2026-07-20.md`. Verified both are feasible
on this hardware/CircuitPython 10.2.1: SD via the onboard 4-bit SDIO slot (GPIO13–18,
`sdioio`/`sdcardio`, ~$3 card, firmware-only, avoids CIRCUITPY FAT corruption); app via the
unused radio (native `_bleio`, plus Wi-Fi) in three shapes (BLE-local, Wi-Fi-local,
Wi-Fi+cloud). Both share the existing `lock_controller.py` state-transition event source.
Recommendation: SD first (capture layer), then BLE app (presentation/monetization), cloud
only for a subscription tier; optional ~$1–2 I²C RTC for dated timestamps. Full feedback
record: `docs/evidence/phone-box-premium-ideation-feedback.md`.

### Round 2 (2026-07-20) — ADDRESSED
Manager: "would it be possible to greenlist certain notifications to unlock the box?" →
Delivered `docs/brainstorming/greenlist-notifications-unlock-feasibility-2026-07-20.md`.
Verdict: feasible as an extension of the companion-app/BLE track (not standalone). Box side
is trivial — early release already exists (`release_lock()` in `lock_servo.py`, `go_done` in
`lock_controller.py`); the touchscreen enables an "alert-through" mode. The phone keeps its
radios while sealed inside, so a companion app can signal the box. Android: fully feasible
(NotificationListenerService, filter by app/contact). iOS: restricted — reliable path is a
contact's *calls* (CallKit); full notification forwarding only for EU users on iOS 26.3+
(DMA). Recommend alert-through as the focus-preserving default + opt-in auto-unlock,
Android-first, rate-limited, with the press-count override kept as the true emergency path.
