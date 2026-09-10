# Phone Box

A physical lockbox that holds your phone for the length of a focus session. A
touchscreen on the box runs the countdown, a servo holds the lid, and a
companion iOS app shows live status and session history over BLE.

**Live site:** https://phonebox-d14b7.web.app

The point is that the lock is real. A screen-time toggle can be disabled in two
taps; this can't. The design problem worth solving isn't "make a box that
closes" — it's the emergency override. Too rigid and you can't take a call that
matters, too loose and it's theater. So the override has tunable friction, and
incoming calls can light the screen while the box stays locked.

This is a personal project, built for my own use. It has never been sold and
there's nothing to buy.

---

## How it's put together

| Layer | Stack |
|---|---|
| Firmware | CircuitPython on an ESP32-S3 Reverse TFT Feather — servo lock state machine, AXS5106L touch driver, MAX1704x LiPo fuel gauge |
| App | React Native 0.86 / Expo 57, TypeScript, `react-native-ble-plx` over a custom GATT protocol |
| Backend | Firebase Auth + Firestore, Cloud Functions (Node 20) |
| Site | Static, Firebase Hosting |
| Enclosure | SolidWorks, FDM printed, two revisions |

```
Box-code/      CircuitPython firmware (lock_* modules, touch + fuel-gauge drivers)
app/           Expo iOS app, BLE client, Firestore sync
functions/     Cloud Functions
website/       Marketing site + web dashboard
docs/          RFCs and design notes
.claude/       Agent config: project skills and subagents
```

### Security

Firestore rules are owner-scoped with per-collection field allow-lists,
immutable `createdAt` pins, type and range checks, and a 200-char cap on
user-supplied topics. Session event-log fields are create-only — once written,
they can't be rewritten. There are six rules test suites including a
default-deny catchall, plus 71 test files across the app.

The `EXPO_PUBLIC_*` Firebase values are client config, not credentials — they
ship in every app bundle by design. Access control lives in the rules.

---

## Built with Claude Code

Worth being precise about, because it's most of the story: **Claude Code wrote
most of the code here.** I specified behaviour, tested on real hardware, and
debugged. Roughly 215 commits across a summer.

What that actually looked like in practice:

**Project skills** — I wrote two so agents could safely edit code that spans
the firmware/app boundary. `ble-protocol` encodes the GATT wire contract;
`native-module-scaffold` encodes the native-module pattern. Without these, an
agent changing a characteristic UUID on one side would silently break the
other.

**Subagents** — `security-reviewer` and `test-writer`, for the two review
passes I wanted run consistently rather than when I remembered to ask.

**MCP servers as a tooling decision** — I used a parametric-CAD MCP to screen
battery candidates against the enclosure envelope while putting the BOM
together, which is a genuinely good fit: the question "does this cell fit"
is geometric and an agent can check it faster than I can. I also cut a swarm
framework partway through. Its subagents lowered token cost but never reported
results back, so I was paying for parallelism and getting no signal from it.

Not everything in `.claude/` is mine — most of the skills and slash commands
there ship with claude-flow and the Firebase tooling.

### The parts that are mine

The hardware debugging, and the CAD. Some of what that involved:

- Calibrated the battery divider against a multimeter — the reported voltage
  was consistently off and the fix was empirical, not in a datasheet.
- Traced servo jitter to CPU frequency scaling shifting the PWM timer. This
  one took a while; the symptom looked like a mechanical problem.
- Diagnosed dropped frames from the touch controller.
- Two enclosure revisions in SolidWorks, with printed fit-test parts for the
  hinge, port, screen, switch, and locking tab before committing to a full
  assembly.

Hardware doesn't let you get away with a plausible-looking fix. The box either
locks or it doesn't.

---

## Status

Working prototype. V2 enclosure assembled, firmware and app running on real
hardware, iOS build in TestFlight for my own testing.

## Running it

```bash
# app
cd app && npm install && npx expo start

# firmware — copy to the CIRCUITPY volume
cp -r Box-code/* /Volumes/CIRCUITPY/
```

The app needs an `app/.env` with your own Firebase web config; see
`app/.env.example` if present, or Firebase console → Project settings → Your
apps → Web app.
