# Phone Box — Feature & Ideation Suggestions

**Date:** 2026-07-20
**Prepared for:** Phone Box (CircuitPython touchscreen phone-lock box)
**Purpose:** Single consolidated reference for every feature idea and ideation output from
the working session — the premium-feature analysis plus the two deep-dives (usage tracking,
and greenlisting notifications). Focus: which additions would justify a higher retail price,
grounded in what the hardware actually supports. *This document supersedes the earlier
standalone deep-dive notes; the full content of both is folded into Deep-dive A and B below.*

---

## Executive summary

Phone Box is already **more capable** than most competitors — it has a touchscreen, a
servo latch, an emergency override, and a rechargeable battery with a level display, which
cheap boxes ($20–35) lack. In this category the premium gap is **software, not hardware**:
the products that sell for $59+ (Brick, kSafe, Unpluq) win on app connectivity, scheduling,
analytics, and accountability.

The pivotal fact: the **ESP32-S3's Wi-Fi + BLE radio is already in the bill of materials but
completely unused** (the firmware contains zero networking code). So the highest-value
premium features add **software cost only, no BOM increase** — the highest-margin way to
move upmarket.

**Target:** a credible move from the "dumb box" band (~$20–35) into the connected/branded
band (**$59–89** one-time), with an optional **family/accountability subscription**
(~$60–100/yr) as the only market-validated recurring-revenue path.

---

## Market context (competitor research, 2026)

Price bands observed:

| Segment | Example | Price |
|---|---|---|
| Budget "dumb" electronic boxes | ySky, generic Amazon | $20–35 |
| Mid-tier hardware upsell (charge-through) | Habit Control | ~$34 |
| Branded / connected premium | Brick ($59), kSafe | $59–79 |
| Self-contained ceiling | kSafe XL, Unpluq bundle | ~$79 |
| Family/accountability subscription | Unpluq Family | $99.95/yr |

**What commands a premium** (ranked, evidence-backed): (1) app connectivity with modes &
scheduling, (2) usage analytics / dashboards, (3) recurring/scheduled locks (start **and**
end times), (4) accountability / family / multi-device management, (5) charge-through (lock
while charging), (6) tamper resistance / "no override" integrity, (7) build quality /
design-as-object.

**Willingness-to-pay signals:** buyers explicitly pay for **physical friction** — app-only
blockers fail because they're "one tap" to bypass, which validates a hardware box. $59 is
framed as a low-risk "experiment" for people who already failed with free Screen Time.
Complaints about cheap boxes: flimsy build, weak tamper resistance, easily defeated, no
scheduling.

**Recurring revenue:** a one-time premium price is the safe default (Brick markets "no
subscription, ever" as a feature); a **family/accountability tier** is the only validated
recurring model in the category (Unpluq).

---

## Unused hardware = premium runway

| Asset | State | Enables |
|---|---|---|
| Wi-Fi + BLE radio (ESP32-S3) | In BOM, zero code uses it (grep-verified) | Companion app, scheduling, accountability, OTA — no BOM cost |
| microSD / TF slot (4-bit SDIO, GPIO13–18) | Present, unused | Local session history for analytics |
| Free I²C bus @ 0x40 | Unused | INA219/INA226 → real current/power metering |
| Wall-clock time (RTC / NTP) | None (countdown only) | Scheduled / recurring locks; dated history |

All feature ideas below build on the existing modular architecture: config-as-single-source
(`lock_config.py`), per-peripheral driver modules (`lock_servo.py`, `lock_battery.py`, …),
an explicit state machine (`lock_controller.py`), view/scene rendering (`lock_ui.py`), and
versioned NVM persistence (`lock_settings.py`). New peripherals slot in as sibling modules
and new screens — not rewrites.

---

## Feature suggestions, ranked

### Tier 1 — Software only, no BOM increase (highest margin)

1. **Companion app over BLE/Wi-Fi.** *Builds on:* the unused ESP32-S3 radio; a new sibling
   driver module + a new view in `lock_ui.py` + a pairing screen. *Why premium:* this is the
   entire $59 Brick / Unpluq value prop; it unlocks items 2, 3, 4, 6 and the notification
   greenlist feature. *Effort:* high. **This is the keystone — most other premium features
   depend on it.**
2. **Scheduled / recurring locks.** *Builds on:* the state machine + `lock_settings.py`;
   needs wall-clock time (ESP32-S3 internal RTC + NTP once Wi-Fi exists). *Why premium:* a
   named premium feature vs. a single manual countdown ("lock every night 10pm–7am").
   *Effort:* medium.
3. **Usage analytics / focus streaks.** *Builds on:* the state transitions in
   `lock_controller.py` as the event source; store to SD or flash; a new stats view. *Why
   premium:* Brick markets its dashboard as a differentiator. *Effort:* medium.
4. **Accountability / partner / family mode.** *Builds on:* the existing override logic +
   connectivity (item 1). *Why premium:* the clearest willingness-to-pay-more lever and the
   only validated subscription path (Unpluq Family ~$100/yr). *Effort:* high.
5. **Multiple lock profiles / modes.** *Builds on:* the versioned NVM layout in
   `lock_settings.py` (magic-byte bump) + the existing settings-detail UI. *Why premium:*
   household / multi-use-case value. *Effort:* low.
6. **OTA firmware updates.** *Builds on:* connectivity (item 1). *Why premium:* post-purchase
   feature delivery → recurring-value / subscription story. *Effort:* high.

### Tier 2 — Low-cost hardware adds ($1–3 BOM) with a quality/security story

7. **Charge-through (lock the phone while it charges).** *Builds on:* the enclosure + a
   pass-through USB port; no firmware dependency. *Why premium:* the exact $20→$34 upsell in
   the market (Habit Control). *BOM:* ~$1–3.
8. **Real current/power metering.** *Builds on:* the free I²C bus @0x40 for an INA219/INA226;
   mirrors the `lock_battery.py` module pattern; replaces today's coarse watt estimate with
   true runtime-remaining. *BOM:* ~$1–3.
9. **Tamper / lid-open detection + alarm.** *Builds on:* the existing sense-button pattern
   (`BTN_LOCK_PIN`); add a reed/hall switch + buzzer on a free GPIO. *Why premium:* directly
   answers the "easily defeated" complaint that penalizes cheap boxes. *BOM:* ~$1.

---

## Deep-dive A — Usage tracking: app vs. SD card

**Question:** how to log focus sessions (start, duration, completed vs. overridden, streaks)?

**TL;DR:** build **SD logging first, then add a BLE app that reads from it**. They are
complementary, not either/or. SD is the cheapest, most reliable way to *capture* data; the
app is how you *present and monetize* it. The event source for both already exists — the
state transitions in `lock_controller.py` (`idle → running → done`, plus override events).
Build the "emit a session record" seam once; SD and app are just two sinks for it.

**The data to capture (same for both methods).** Per session: `set_duration`,
`actual_locked_time`, `completed` vs `overridden`, `override_press_count`, and (if a time
source exists) `start_timestamp`. Small: ~30–60 bytes/session.

### Method A — SD card (local logging)

*How it works.* On each `done`/override transition, append a CSV/JSON-lines row to a file on
a microSD card. Read it later by removing the card or over USB.

*Hardware reality (verified).*
- The Waveshare ESP32-S3-Touch-LCD-1.47 has an onboard TF/microSD slot, wired as a **4-bit
  SDIO (SD/MMC) interface on GPIO13–18** (CLK, CMD, D0–D3) — consistent with the `13-18 SD`
  note in `lock_config.py`. The ESP32-S3 has a native SD/MMC host peripheral, so 4-bit SDIO
  is supported.
- CircuitPython path: `sdioio` for 4-bit SDIO (fastest), or `sdcardio` for SPI mode. Confirm
  they're compiled into this board's CP 10.2.1 build before relying on them.
- Cost: the slot is already on the board (no BOM change); a microSD card is ~$3–5.

*Key advantage — no CIRCUITPY conflict.* An external SD card mounted from `code.py` is
independent of the internal CIRCUITPY filesystem, so firmware can write to it freely at any
time, USB-connected or not. It does **not** hit the `storage.remount` / USB-vs-code write
conflict, and it does **not** risk the CIRCUITPY FAT corruption / read-only lockups that
already recur on this board.

*Weaknesses.* Presentation is manual (read a CSV over USB, or build an on-device stats view);
no absolute time without a clock (the ESP32-S3 internal RTC resets on power loss with no
backup cell, so logs are relative durations unless a ~$1–2 I²C RTC is added or time comes
from NTP/app); a card can be removed/lost, and write-during-power-loss can corrupt the last
row (mitigate with flush-per-record + append-only). *Effort:* low–medium, firmware only.

### Method B — Companion app (uses the currently-unused radio)

Three shapes, cheapest → richest:

- **B1 — BLE, phone app, no internet.** Box is a BLE peripheral exposing a GATT service;
  the phone app reads/subscribes to session records. CircuitPython has native `_bleio` on
  ESP32-S3 (full peripheral support, CP 9.1+; this box runs CP 10.2.1). *Pros:* offline,
  private, no backend/hosting; phone supplies real timestamps; rich UI. *Cons:* must build
  iOS **and** Android apps; BLE pairing/reconnect UX is fiddly.
- **B2 — Wi-Fi, local (no cloud).** Box hosts a tiny web server; phone browser views stats
  on the same network. *Pros:* no native app; NTP gives real time. *Cons:* user must join
  the box's AP / shared Wi-Fi; clunky; not a "product" feel.
- **B3 — Wi-Fi + cloud backend.** Box pushes records to a server; web/app dashboards,
  multi-device, remote accountability/family. *Pros:* richest; the only path to the validated
  recurring-revenue tier. *Cons:* highest cost/liability — backend, accounts, security,
  privacy, ongoing hosting cost.

*Cost:* no BOM change (radio present); real cost is software + maintenance. *Effort:* medium
(B1) to high (B3).

### Side-by-side

| Dimension | SD card | BLE app (B1) | Wi-Fi cloud (B3) |
|---|---|---|---|
| BOM cost | ~$3–5 card (slot exists) | $0 (radio exists) | $0 hardware |
| Ongoing cost | none | none | backend hosting, forever |
| Eng. effort | low (firmware only) | medium (2 apps + BLE) | high (apps + backend + accounts) |
| Data presentation | manual CSV / on-device screen | rich, on phone | rich, anywhere |
| Works offline | yes | yes (local) | no |
| Privacy | fully local | local | data leaves device |
| Real timestamps | needs RTC (~$1–2) or app | from phone | from NTP |
| Reliability | robust; no CIRCUITPY/FAT conflict | pairing drops | network + backend outages |
| Premium / monetization fit | weak alone | strong (Brick-tier) | strongest (subscription) |
| Depends on other features | none | connectivity work | connectivity + infra |

### Recommendation & sequencing

1. **Now — SD logging.** Add a session-record emit at the `lock_controller.py` transitions
   and an `sdioio`/`sdcardio` sink. Ships real habit data for ~$3, firmware only, no
   CIRCUITPY-corruption risk. Add a simple on-device stats view (`lock_ui.py`).
2. **Next — BLE app (B1).** Read the same records over BLE into a phone app for the
   dashboards/streaks that justify the $59–89 band. SD stays the local source-of-truth; the
   app is a viewer/sync layer, which de-risks the app work.
3. **Later, only for recurring revenue — Wi-Fi/cloud (B3).** For remote accountability/
   family, accepting the permanent backend cost and privacy burden.
4. **Timestamps:** add a ~$1–2 I²C RTC if dated history matters before the app exists;
   otherwise get time from the phone (B1) or NTP (B2/B3).

*Open items:* confirm this board's CP 10.2.1 build includes `sdioio`/`sdcardio` and `_bleio`;
confirm the TF slot's exact pin mode (SDIO 4-bit vs SPI) against the schematic; verify on
hardware. No firmware was changed for this analysis.

---

## Deep-dive B — Greenlisting notifications to unlock the box

**Question:** could certain whitelisted ("greenlisted") notifications — e.g. a call from a
specific person, or a chosen app — release the box early?

**Short answer: yes on Android (fully), partial on iOS.** It's an extension of the
companion-app / connectivity track, not standalone. The **box side is trivial**; the entire
difficulty is **phone-platform notification access**, which differs sharply by OS.

**Why it's possible at all.** The phone is sealed in the box, but plastic/wood doesn't block
RF — the phone keeps its cellular/Wi-Fi to the internet and its BLE link to the box. So a
companion app on the phone can keep running **while locked inside** and signal the box. Flow:
greenlisted notification arrives → app detects it → app signals the box over BLE → box either
(a) displays the alert on its screen / buzzes, or (b) releases the latch.

**Box side — already built.** Early release already exists: `release_lock()` in
`lock_servo.py` and the `go_done` transition in `lock_controller.py`. A BLE "unlock" command
just calls the existing path — no new mechanism. The box's touchscreen (`lock_ui.py`) makes
an "alert-through" overlay (show *"Call from Mom"* without unlocking) a natural addition.

**Phone side — the real constraint.**
- **Android — feasible.** `NotificationListenerService` (user grants "notification access")
  reads all notifications and filters by app package and/or sender, then signals the box.
  Supports greenlisting specific apps *or* contacts.
- **iOS — restricted by design.** Third-party apps cannot read other apps' notifications.
  Practical options, weakest constraint first: incoming **calls** from a greenlisted contact
  via CallKit/VoIP; the app's own push notifications only; **iOS 26.3 (2026) notification
  forwarding to third-party accessories** — a real path where the box could receive forwarded
  notifications, but **EU-only** (Digital Markets Act) and bound by strict use rules; or a
  **relay workaround** routing a chosen contact's calls/SMS through a service (e.g. Twilio)
  the app/box watches (clunky; adds infra). Net: on iOS, reliably do "greenlist a contact's
  calls," with full notification greenlisting only for EU users on iOS 26.3+. Be honest about
  this gap in marketing.

**Design recommendation.**
1. Two response modes, chosen per greenlist entry: *alert-through* (default — box stays
   locked, shows the alert on screen / buzzes; keeps the focus contract intact) and
   *auto-unlock* (releases the latch via `release_lock()`).
2. Greenlist config lives in the app (by app and/or contact).
3. Android-first; ship iOS as calls-via-CallKit + EU forwarding, clearly scoped.
4. Integrity caveats — this is a *new early-unlock path*: rate-limit it (a chatty app
   shouldn't pop the box open); it's also a self-deception loophole (whitelisting a junk app
   to cheat focus). Keep the existing press-count override as the true emergency path and
   treat greenlist as a convenience layer, defaulting to alert-through.

*Dependencies & effort:* depends on the companion-app/BLE feature (items 1/4). Effort medium
on Android (notification listener + BLE command + box handler + alert overlay); high for full
iOS parity.

---

## Recommended sequencing (roadmap)

1. **SD logging** (Deep-dive A) — cheap, low-risk, ships real habit data; adds an on-device
   stats view. ~$3 card, firmware only.
2. **Companion app over BLE** (item 1) — the keystone; turns the SD data into
   dashboards/streaks and enables everything below.
3. **Scheduled/recurring locks** (item 2) + **profiles** (item 5) — high value, moderate
   effort once connectivity + time exist.
4. **Accountability / family mode** (item 4) — turns on the validated subscription tier.
5. **Greenlist-to-unlock** (Deep-dive B) — layered on the app; alert-through first.
6. **OTA** (item 6) — supports ongoing feature delivery.
7. **Tier-2 hardware adds** (items 7–9) — charge-through, current sensor, tamper/alarm —
   folded into the next enclosure revision, independent of the software track.

**Strategic caveat:** the connectivity track re-introduces the radio that earlier cost-down
work aimed to remove. This is a deliberate up-market bet (higher price, higher margin via
software), the opposite direction from BOM reduction. The Tier-2 hardware adds are far
cheaper to ship if a smaller step is preferred.

---

## Evidence traceability

- Currently-exists claims trace to: `firmware/lib/lock_controller.py`, `lock_servo.py`,
  `lock_battery.py`, `lock_settings.py`, `lock_ui.py`, `lock_power.py`, `lock_config.py`,
  `firmware/code.py`, `firmware/safemode.py`.
- Unused-radio claim: grep of `firmware/` finds no `wifi` / `bleio` / `socketpool` /
  `adafruit_requests` usage.
- SD (`sdioio`/`sdcardio`) and BLE (`_bleio`) are capabilities to build and verify in this
  board's CircuitPython 10.2.1 build, not existing code.
- No firmware was changed. There is no host test suite; any implementation needs on-device
  verification.

## Sources

- Board / SD slot & BLE 5: [Waveshare ESP32-S3-Touch-LCD-1.47 product page](https://www.waveshare.com/esp32-s3-touch-lcd-1.47.htm)
- CircuitPython BLE on ESP32-S3: [_bleio docs](https://docs.circuitpython.org/en/latest/shared-bindings/_bleio/)
- CircuitPython SD interfaces: [sdioio docs](https://docs.circuitpython.org/en/latest/shared-bindings/sdioio/index.html), [sdcardio docs](https://docs.circuitpython.org/en/latest/shared-bindings/sdcardio/)
- ESP32-S3 native 4-bit SD/MMC host: [ESP-IDF SDMMC driver](https://docs.espressif.com/projects/esp-idf/en/v5.2/esp32s3/api-reference/storage/sdmmc.html)
- Android notification access: [NotificationListenerService (Android Developers)](https://developer.android.com/reference/android/service/notification/NotificationListenerService)
- iOS notification restriction + 2026 change: [Apple third-party notification access rules (9to5Mac)](https://9to5mac.com/2026/03/30/apple-introduces-privacy-rules-for-third-party-access-to-notifications-and-live-activities/), [iOS 26.3 notification forwarding (MacRumors)](https://forums.macrumors.com/threads/ios-26-3-adds-notification-forwarding-option-for-third-party-wearables.2474759/)
- Competitors: [Brick](https://getbrick.com/), [Unpluq](https://www.unpluq.com/products/unpluq-tag), [Unpluq Family](https://www.unpluq.com/pages/unpluq-family-subscription), [Kitchen Safe](https://www.thekitchensafe.com/pages/products), [Habit Control](https://habit-control.com/products/phone-lockable-box-with-a-timer)
