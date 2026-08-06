# Feedback for companion-app — Technical Design Workflow

## Round 1 Feedback
*Received: 2026-07-22*

### Item 1 - ADDRESSED
- **Feedback**: Focus on iOS with greenlisting calls.
- **Resolution**: Rewrote §5.3 as "Greenlisting calls — iOS-first." Documents the verified iOS
  boundary: `CXCallObserver` gives an any-call alert-through (no caller identity), and true per-contact
  greenlist is reliable only when the call routes through the app as VoIP (`PushKit` + `CallKit`), which
  also provides a dependable background wake (better than CoreBluetooth state restoration). Added a
  two-tier iOS design, updated exec-summary decision #4, roadmap step 5 (iOS-first), and the iOS risk
  rows. Android demoted to "also supported, after iOS." Added CallKit/PushKit sources.
- **Status**: ADDRESSED

### Item 2 - ADDRESSED
- **Feedback**: Change the BOM to offer two options — one without Bluetooth and one with the original
  board. Make sure links are included.
- **Resolution**: Added §2a "Build options & BOM — connectivity vs. radio-free" with two costed BOMs and
  live purchase links: Option A (radio-free Waveshare RP2350-Touch-LCD-1.28, ~$38.78, app impossible,
  1.28" round screen) vs Option B (original ESP32-S3 board, ~$34.28–40.77, app-capable at $0 added
  hardware). Grounded in `bom.md` + the board shortlist. Key finding surfaced: radio-free is *not*
  cheaper at prototype quantity and cannot run the app; recommendation is to keep the original board
  (Pi Hut sourcing) and treat the app as a software upgrade, not a new SKU. Added BOM source links.
- **Status**: ADDRESSED

### Item 3 - ADDRESSED
- **Feedback**: Make sure links are included.
- **Resolution**: All new claims carry inline links (BOM board listings + CircuitPython board pages;
  iOS CallKit/CXCallObserver/PushKit docs), and the Sources section gained iOS-call, BOM-original,
  BOM-radio-free, and BOM-detail entries.
- **Status**: ADDRESSED

## Round 2 Feedback
*Received: 2026-07-22*

### Item 1 - ADDRESSED
- **Feedback**: Help me recommend a mobile stack to develop this app.
- **Resolution**: Added §5.1a "Recommended mobile stack (concrete)" — a layered table (language,
  framework, BLE, state, storage, iOS/Android greenlist native modules, CI/distribution, testing) with a
  specific package per layer and links. Firm recommendation: **React Native + Expo + TypeScript**, with
  the single flip factor (team language expertise → Flutter if Dart team; fully native only if iOS call
  UX is the core product). Verified the RN VoIP/CallKit ecosystem is current (`react-native-callkeep` +
  `react-native-voip-push-notification`, or Expo-native `expo-callkit-telecom`). Updated next-steps
  step 3 to reflect the decided stack.
- **Status**: ADDRESSED

## Round 3 Feedback
*Received: 2026-07-22*

### Item 1 - ADDRESSED
- **Feedback**: How hard is this to do if I don't code that much?
- **Resolution**: Added §6a "How hard is this if you don't code much?" — an honest per-component
  difficulty table (skill needed / DIY-with-AI feasibility / rough outsource cost) and a recommended
  light-coder path: (1) ship firmware SD-logging + on-device stats yourself (no app, ~$3, pure
  CircuitPython you own — highest-certainty win); (2) hire out or AI-assist the viewer MVP (~$5k–20k,
  ~5–10 weeks) using this RFC as the brief; (3) treat iOS greenlist calls + accountability/cloud as
  later developer-led phases, not DIY. Anchored cost ranges with sources; added them to Sources.
- **Status**: ADDRESSED

