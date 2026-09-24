# DRAFT - Requires Human Approval
## INTERNAL

# Phone Box: BOM-derived feature ideas and iOS notification access, addendum

**Date:** 2026-07-24
**Purpose:** Two independent research threads requested directly: (A) additional product features derivable from components already in the current BOM, beyond what `docs/brainstorming/phone-box-feature-ideation-2026-07-20.md` already covers; (B) whether there is another way to surface iOS notifications through the box, beyond what that same document's Deep-dive B already covers.
**Status:** Parts A and B approved by the human on 2026-07-24. Part A2 (a third, independent BOM-ideation pass, requested after approval) is appended below and is itself DRAFT, pending approval. Nothing in this document has been built, costed for the BOM, or promised in marketing. Idea 4 in Part A, and ideas 1 and 2 in Part A2, describe existing gaps in shipped code and should be triaged regardless of what else in this document is approved.

---

## Executive summary

All three research threads are complete and grounded in the actual BOM (`docs/procurement/bom.md`) and firmware (`firmware/lib/lock_*.py`), not hypothetical hardware.

**Part A** found 9 net-new feature ideas that use only components already in the BOM: the servo's analog range, the fuel gauge's voltage signal, the two buttons, the touchscreen, the BLE radio's advertising and scanning modes, and the SD card slot, which is wired but has no driver in firmware today. One of these (idea 4) is not really an "idea" so much as a currently open security gap: the on-screen Settings view has no access control, so anyone can defeat the lock by lowering the override-press count.

**Part A2** is a third, independent ideation pass run after Part A and B were approved, explicitly barred from repeating anything in Part A or the original 2026-07-20 document. It found 7 more ideas, and again surfaced real gaps in shipped behavior rather than pure feature proposals: a brownout or reset during an active lock currently unlocks the phone early with no record of it happening (idea 1), and there is no safety-net release when the battery hits a critical level mid-lock, only the preflight check from Part A (idea 2).

**Part B** found one significant new finding: **ANCS (Apple Notification Center Service)**, a BLE mechanism iOS has exposed to paired accessories since iOS 7 (it is how Pebble, Garmin, and Fitbit watches show notifications with no companion app installed). This changes the prior conclusion that iOS is "restricted by design." ANCS delivers full notification content (app identifier, title, subtitle, message body, category) to any bonded BLE accessory, with no app required, no MFi certification required, and no EU or OS-version gating. The catch: iOS only exposes a single global show/hide toggle per paired accessory, so per-app or per-contact filtering has to happen in box firmware, and it is not yet confirmed that this board's CircuitPython BLE stack can run the Central role (needed to receive ANCS) at the same time as the Peripheral role it already uses for the planned companion app.

**Confidence: medium.** All three research nodes reached a verified pass. The original Part A node needed a retry after an infrastructure failure (a session quota limit, not a quality problem) and returned a stronger, more firmware-grounded result on the second pass; Part A2 and Part B both passed on the first attempt. No human escalation occurred. The flagged risk areas below are all "confirm on hardware" or "triage this gap" items, not reasons to doubt the research.

---

## Part A: BOM-derived feature ideas

Grounded in the current BOM (`docs/procurement/bom.md`): Waveshare ESP32-S3-Touch-LCD-1.47 (touchscreen, BLE radio, onboard LiPo charging, SD-capable), MAX17048 fuel gauge, SG90-class servo on GPIO5, two momentary buttons (GPIO1 lock, GPIO10 override), 3D-printed enclosure. Cross-checked against both the existing ideation document and the actual firmware in `firmware/lib/`, so nothing already built or already proposed is repeated.

1. **Progressive "crack-open" countdown reveal.** Builds on the servo's full analog range, which today is only ever driven to two fixed angles. In the final few minutes of a countdown, interpolate the servo angle so the lid visibly creeps open as time runs out, releasing fully at zero. Low effort (a firmware interpolation, no new parts). Turns a binary latch into a physical countdown cue; no competitor design does this.

2. **Forced-open detection via voltage-sag signature.** Builds on the MAX17048 fuel gauge (already read every frame) plus the servo. A sudden voltage dip while locked can indicate the servo stalling under mechanical force, i.e. a pry attempt, detectable in firmware alone. Medium effort (needs on-hardware characterization of a real pry signature versus noise). Zero BOM cost, versus the existing document's tamper idea which needs a new reed/hall switch.

3. **Runtime-sufficiency preflight check.** Builds on the fuel gauge's state-of-charge and discharge-trend data, checked against the requested lock duration before the user commits. Warns if the battery is likely to die before time is up, since a dead battery means the servo loses power and the phone becomes accessible early. Low effort (arithmetic only). Addresses a real safety/product edge case nobody had flagged.

4. **Settings PIN-lock via secret two-button combo (security gap, not just a feature).** The on-screen Settings view currently has no access control at all: anyone can open it and lower the override-press count to defeat the lock in a few taps. Requiring a held combo of both physical buttons to unlock Settings for editing closes this gap using hardware already present. Low effort. Recommend triaging this independent of the rest of this document, since it describes a live gap in shipped behavior, not a speculative feature.

5. **Button-tap duration presets ("quick-start").** Builds on the two buttons, usable with the screen off. A rapid tap count on the lock button while idle arms a preset duration and starts the countdown with no screen or app interaction. Low effort. A no-screen, no-app path, distinct from the existing document's on-screen settings profiles.

6. **"Note to future self" reveal.** Builds on the touchscreen (for a short preset-message picker) and existing settings/NVM storage. Before locking, the user records a short reason; it stays hidden during the countdown and is shown back at unlock as a personal commitment reminder. Low to medium effort. A per-session intent-capture mechanic, distinct from the existing document's aggregate usage stats and streaks.

7. **BLE glanceable status broadcast, no pairing required.** Builds on the BLE radio's advertising loop, which already runs for the planned companion app's GATT peripheral. Encoding locked/unlocked state, seconds remaining, and battery percent into the advertising packet's manufacturer-data field lets any generic BLE scanner, such as a smartwatch widget, read status with no pairing and no purpose-built app. Low effort. Ships useful status ahead of the full companion app, which remains an unbuilt scaffold today.

8. **Proximity-gated parent override via BLE RSSI.** Builds on the BLE radio's scanning capability (Central mode), not just its existing peripheral/advertising role. A registered second BLE device (a parent's phone or a keyfob) being physically nearby, judged by signal strength, can reveal a hidden "parent unlock" option. Medium effort; needs verification that this board's CircuitPython BLE stack can scan and advertise concurrently. A hardware-presence override with no app, cloud, or subscription, distinct from the existing document's software-based accountability feature.

9. **SD-stored "reason board" image or quote cycling.** Builds on the SD card slot, which is wired in hardware but has no driver anywhere in the current firmware, so it is genuinely unused today. A folder of images or short text cards on the card cycles as an additional clock-view style during the countdown, for motivation or personalization rather than data logging. Medium effort (bitmap decoding is straightforward in CircuitPython; recommend BMP only, since JPEG support would raise this to high effort). A different value proposition from the existing document's SD use case, which is exclusively session-history logging.

**Deliberately excluded** because the existing 2026-07-20 document already covers them: companion app over BLE/Wi-Fi, scheduled/recurring locks, usage tracking/streaks/gamification, notification greenlisting, accountability/partner visibility as a software channel, on-screen lock button, battery fuel-gauge accuracy, multiple lock profiles, OTA updates, charge-through, and lid-open tamper alarm via a new sensor.

---

## Part A2: BOM-derived feature ideas, third round

A third, independent ideation pass, run after Parts A and B were approved, explicitly instructed not to repeat anything in Part A, Part B, or the original 2026-07-20 document. Grounded in the same BOM and cross-checked against the live firmware in `firmware/lib/`.

1. **Session-persistence across brownout or reset (fail-safe resume, not fail-open).** Verified in the firmware: on a brownout during an active lock, the board resets and unconditionally releases the lock on boot, with no record that it happened. Persisting `{state, deadline}` to NVM on each transition would let a post-reset boot restore the countdown instead of defaulting to unlocked. Medium effort (NVM write cadence, wear budgeting, safe fallback when persisted data is stale). This is a real, currently-shipped accidental-early-unlock path, not a speculative feature; recommend triaging it alongside Part A idea 4.

2. **Critical-battery forced release during an active lock (reactive safety net).** Builds on the fuel gauge. If charge drops below a hard floor while a lock is actively running, force a controlled release regardless of the user's auto-open setting, since a dead battery means the servo loses holding power unpredictably rather than through a controlled release. Low effort (a threshold check in the existing per-frame update loop). Distinct from Part A idea 3, which only warns before the user commits to a duration; this is the runtime backstop for when that warning wasn't heeded or wasn't enough.

3. **Ambient "breathing" backlight while locked, screen otherwise asleep.** Builds on the existing backlight brightness control and inactivity-sleep logic. A very low-duty slow pulse while locked, instead of a hard on/off backlight, lets a glance in a dark room confirm "still locked" with no full wake. Low to medium effort. Solves the same "glanceable status" problem as Part A idea 7's BLE broadcast, but for a human eye, with zero radio and no pairing.

4. **Owner-facing servo lock/unlock angle calibration screen.** Builds on the servo and the existing settings/NVM pattern. SG90-class servos and 3D-printed linkages carry real per-unit mechanical tolerance; a live-preview calibration flow for the two fixed lock/unlock angles gives an on-device fix for a unit that binds or doesn't fully latch, where today those angles are fixed constants with no on-device correction. Low to medium effort. Distinct from Part A idea 1, which animates the angle for a countdown reveal; this calibrates the two fixed endpoints for mechanical fit.

5. **Factory or QA self-test mode via a hidden boot-time button combo.** Holding both buttons at boot enters a diagnostic screen that sweeps the servo, confirms the fuel gauge responds, checks all touch corners register, and probes for SD-card presence, a fast go/no-go check for end-of-line testing with no extra hardware. Medium effort. A one-time production/QA gate, distinct from Part A idea 4's everyday Settings access control.

6. **Touch-and-hold accelerating duration adjustment (dexterity accessibility).** Builds on the touchscreen. An alternative to the existing swipe-only duration adjustment: tap and hold to auto-repeat and accelerate, for users with tremor, limited reach, or one-handed use who find repeated small swipes difficult. Low effort. An accessibility angle on the existing input method, distinct from Part A idea 5's physical-button, screen-off shortcut.

7. **High-contrast, large-print clock style for low vision.** Builds on the existing multi-style clock architecture, which already supports several visual styles reachable by swipe. A fourth style using maximum font scale and a high-contrast color pairing, reachable through the same existing cycling mechanism. Low effort. A pure accessibility angle; none of the existing clock styles were designed for low vision.

**Deliberately excluded** because Part A, Part B, or the 2026-07-20 document already cover them: any vibration/buzz alert (no motor in the BOM for it), a second reed/hall-switch tamper mechanism (Part A's voltage-sag idea is the BOM-only alternative already covering this), a second SD-based logging variant (already the 2026-07-20 document's Deep-dive A), and a second RTC/time-sync idea (both prior passes already treat wall-clock time as a known gap tied to BLE/app sync).

---

## Part B: iOS notification access, beyond the existing Deep-dive B

The existing document already covers: Android via `NotificationListenerService` (fully feasible), iOS via CallKit/PushKit for call-only greenlisting, iOS 26.3's third-party notification forwarding (EU-only per the Digital Markets Act), and a Twilio relay workaround. This section covers what else exists.

### ANCS (Apple Notification Center Service): the main new finding

**Verdict: works today, no companion app required, no MFi certification required, no EU or OS-version gate.**

ANCS is a public BLE GATT service iOS has exposed to any paired, bonded accessory since iOS 7. It is the actual mechanism third-party smartwatches (Pebble, Garmin, Fitbit) have used for a decade to show notifications with zero iOS app installed. The box would act as a BLE Central connecting directly to the iPhone's ANCS server, no phone-side app involved at all.

Data available per notification, per Apple's own specification: app identifier (bundle ID), title, subtitle, message body, date, action labels, and a category (including Incoming Call, Missed Call, Voicemail, Social, Schedule, Email, and others). This is full notification content, not just calls, so both "greenlist a specific app" and "greenlist a specific contact's call" (matched against the title field) are feasible.

No MFi coprocessor or licensing is required, unlike Apple's separate iAP2/External Accessory protocol. This is corroborated by ANCS being implemented in commodity BLE SDKs (Nordic, Silicon Labs, TI) and by an existing official Adafruit CircuitPython library for it, originally built for Adafruit's own Bluefruit hardware.

Connecting requires a one-time standard Bluetooth pairing prompt, the same as pairing headphones. After that, delivery is passive and runs in the background.

**Filtering caveat:** iOS exposes only a single global per-accessory toggle (Settings, Bluetooth, the paired device's info screen, "Show Notifications"), not a per-app filter. All app-level or contact-level greenlisting has to happen in box firmware using the fields above, which is exactly what the original Deep-dive B design already assumed.

**Open item to confirm on hardware:** ANCS requires the box to act as BLE Central (initiating a connection to the phone), the reverse of the Peripheral role the box already uses for the planned companion app. Whether this board's CircuitPython BLE stack can run both roles at once, Central for ANCS and Peripheral for the companion app, is not yet confirmed for this specific board and needs a hardware spike before it is committed to the roadmap or promised in marketing.

### Other candidates considered and why they do not apply

- **iAP2/MFi External Accessory framework:** requires Apple's certified authentication coprocessor and MFi licensing. Not needed since ANCS already covers this use case without it; included only to contrast with ANCS.
- **iOS Shortcuts personal automation:** has no trigger for "a notification arrived from app X." Third-party bridges like Pushcut still require the source app's cooperation, so this does not remove the underlying restriction.
- **Focus Filters / Focus-status API:** shares only an on/off Focus-mode boolean with cooperating apps, no notification content, and requires the source app's participation. Not a notification-access path.
- **Apple Watch / watchOS companion:** still requires a paired iPhone app plus WatchConnectivity. Does not remove the need for an app, so it is not a distinct path.

### Net effect on the existing document

Recommend reframing Deep-dive B's iOS section from "restricted by design" to: full notification content is available via ANCS, app-optional, with app-level and contact-level filtering happening in box firmware. CallKit/PushKit and the iOS 26.3 EU-only forwarding path remain relevant only for narrower cases (deeper native call-UI integration, or the EU market specifically); ANCS covers the general case globally.

---

## Execution trace

| Task | Persona | Iterations | Outcome |
|---|---|---|---|
| BOM-derived feature ideation | researcher | 2 | Iteration 1 failed on a session quota limit (infrastructure, not a quality issue, no deliverable produced). Iteration 2 passed: read the BOM, the prior ideation document, and the actual firmware; returned 9 net-new ideas each tied to a real component and checked against existing coverage. |
| iOS notification access deep-dive, part 2 | researcher | 1 | Passed on first iteration: identified ANCS with a sourced feasibility verdict, correctly scoped the filtering caveat, flagged the one real open hardware question, and evaluated four other candidates with reasoning for why each was discarded. |
| BOM-derived feature ideation, third round (Part A2) | researcher | 1 | Passed on first iteration, run after Parts A and B were approved. Read Part A, Part B, the original ideation document, and the live firmware; returned 7 further net-new ideas, each checked against and explicitly differentiated from both prior passes. |

No files were written by any research node; all three were scoped to research only, per their briefs. This document is the first artifact produced from their findings.

---

## Risk flags

1. **BOM node required a retry.** The first attempt did not fail on content quality, it hit a session quota limit and returned nothing. The retry used the same brief unchanged and returned a stronger, more firmware-grounded result than an earlier informal pass. No content risk carried forward, flagging only because it is the one node that did not pass on the first try.
2. **ANCS Central-role support is unconfirmed on this board.** ANCS needs the box to run BLE Central at the same time it runs BLE Peripheral for the companion app. This is architecturally normal for BLE 4.1+ hardware in general, but has not been verified on this board's specific CircuitPython build. Do not promise ANCS-based notification greenlisting in marketing or the roadmap until a hardware spike confirms dual-role operation.
3. **Idea 4 describes a live security gap, not a proposal.** The Settings view currently has no access control, so the lock can be defeated by anyone who opens it. This should be triaged on its own merits regardless of the disposition of the rest of this document.
4. **Part A2 idea 1 describes a live reliability gap.** A brownout or reset during an active lock currently releases the phone early with no record it happened. This is a real accidental-early-unlock path in shipped code, not a speculative feature, and should be triaged on its own merits.
5. **Part A2 idea 2 has no safety-net today.** Part A's preflight check (idea 3) only warns before a lock starts; there is currently no runtime intervention if the battery still hits a critical level mid-lock. Treat these two ideas as a pair when scoping the fix.

---

## Human approval checklist

- [x] Idea 4 (Settings access-control gap): approved 2026-07-24, see Part A and B approval below.
- [x] Parts A and B: approved by the human on 2026-07-24.
- [ ] Confirm whether idea 4 (Settings access-control gap) should be triaged as a bug fix now, independent of this document's other ideas.
- [ ] Decide whether to greenlight a hardware spike to confirm CircuitPython BLE Central plus Peripheral dual-role operation on this ESP32-S3 board, which gates both ANCS (Part B) and the proximity-gated override idea (Part A, idea 8).
- [ ] Select which, if any, of the 9 Part A feature ideas, or the 7 Part A2 feature ideas, to carry into the product roadmap or the next ideation/technical-design pass.
- [ ] Decide whether to reframe the existing Deep-dive B document's iOS section to lead with ANCS, as recommended, or keep it as a separate addendum.
- [ ] Confirm whether Part A2 ideas 1 (brownout/reset resume) and 2 (critical-battery forced release) should be triaged as reliability fixes now, alongside idea 4.
- [ ] Approve or request changes on Part A2 (third-round ideas), which is still pending review.
- [ ] Confirm no further action is needed on the session-quota retry noted in the execution trace (informational only, no content risk).
