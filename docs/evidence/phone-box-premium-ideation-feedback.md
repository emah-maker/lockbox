# Feedback for phone-box-premium-ideation — codebase-analysis-and-ideation

## Round 1 Feedback
*Received: 2026-07-20*

### Item 1 - ADDRESSED
- **Feedback**: "look into methods for tracking with an app or tracking with sd card and
  compare, document this in a doc."
- **Action**: Researched and verified the hardware/CircuitPython feasibility of both
  approaches, then wrote a comparison doc at
  `docs/brainstorming/tracking-app-vs-sd-comparison-2026-07-20.md`.
- **Key findings**:
  - SD path is real and cheap: onboard TF slot is 4-bit SDIO on GPIO13–18; CircuitPython
    `sdioio`/`sdcardio`; ~$3–5 card, firmware-only, and (crucially) an external SD card
    write does not touch CIRCUITPY flash so it avoids this board's known read-only/FAT
    corruption failure mode.
  - App path is real: ESP32-S3 has native `_bleio` in CircuitPython (box runs CP 10.2.1)
    plus Wi-Fi; three shapes compared (BLE-local, Wi-Fi-local, Wi-Fi+cloud).
  - Both share one event source that already exists: `lock_controller.py` state
    transitions.
  - Recommendation: build SD logging first (capture layer, low-risk), then a BLE app
    (presentation/monetization layer); Wi-Fi/cloud only if pursuing the subscription tier.
    Add a ~$1–2 I²C RTC if dated history is needed before the app exists.
- **Status**: ADDRESSED

## Round 2 Feedback
*Received: 2026-07-20*

### Item 1 - ADDRESSED
- **Feedback**: "would it be possible to greenlist certain notifications to unlock the box?"
- **Action**: Feasibility analysis written to
  `docs/brainstorming/greenlist-notifications-unlock-feasibility-2026-07-20.md`.
- **Key findings**:
  - Feasible; it's an extension of the companion-app/BLE track, not standalone. The box side
    is trivial — early release already exists (`release_lock()` in lock_servo.py, `go_done`
    in lock_controller.py); a BLE unlock command reuses it. The box screen enables an
    "alert-through" mode.
  - Enabling fact: the phone keeps cellular/Wi-Fi/BLE while sealed inside, so a companion
    app runs and signals the box.
  - Android: fully feasible via NotificationListenerService (filter by app/contact).
  - iOS: restricted — no general notification read for 3rd-party apps. Reliable path is
    greenlisting a contact's *calls* (CallKit); full notification forwarding only for EU
    users on iOS 26.3+ (DMA). Honest gap to flag.
  - Recommend two modes (alert-through default / auto-unlock opt-in), Android-first,
    rate-limited, with press-count override kept as the true emergency path (greenlist is a
    convenience layer + a potential self-deception loophole).
- **Status**: ADDRESSED

## Round 3 Feedback
*Received: 2026-07-20*

### Item 1 - ADDRESSED
- **Feedback**: "put all suggestions for features and ideation from the conversation into a
  docx."
- **Action**: Consolidated every feature idea and ideation output from the session
  (premium-feature analysis + tracking deep-dive + greenlist deep-dive) into one markdown
  source `docs/brainstorming/phone-box-feature-ideation-2026-07-20.md`, then rendered it to
  `docs/brainstorming/phone-box-feature-ideation-2026-07-20.docx` via
  `scripts/md_to_docx.py` (python-docx). Verified: 142 paragraphs, 3 tables.
- **Note**: explicit DOCX request overrides the standing markdown-only preference for this
  artifact; markdown source kept as canonical alongside the .docx.
- **Status**: ADDRESSED

## Round 4 Feedback
*Received: 2026-07-20*

### Item 1 - ADDRESSED
- **Feedback**: "fold into this one" (merge the two standalone deep-dive docs into the
  consolidated feature/ideation document).
- **Action**: Expanded Deep-dive A (tracking: app vs SD) and Deep-dive B (greenlist
  notifications) in `docs/brainstorming/phone-box-feature-ideation-2026-07-20.md` to carry
  the full content of the standalone notes; regenerated
  `phone-box-feature-ideation-2026-07-20.docx` (214 paragraphs, 3 tables); deleted the now-
  redundant `tracking-app-vs-sd-comparison-2026-07-20.md` and
  `greenlist-notifications-unlock-feasibility-2026-07-20.md`. One consolidated doc (md + docx)
  remains in `docs/brainstorming/`.
- **Status**: ADDRESSED
