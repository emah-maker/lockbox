# Documentation

Design and process docs for Phone Box. Most were written during development
and are kept as a record, so dated documents reflect what was true on that date.

## Start here

| Doc | What it covers |
|---|---|
| [`rfcs/`](rfcs/) | Technical designs: companion-app approach, Firebase auth and sync, Google sign-in and cross-device sync, iOS background wake and call notifications, call greenlisting |
| [`push-notifications.md`](push-notifications.md) | How scheduled-session reminders flow from Firestore through Cloud Functions to Expo / Web Push |
| [`production-readiness/`](production-readiness/) | Readiness reviews for the box firmware and the companion app, plus the Firebase console hardening runbook |
| [`handoff/firmware-ai-context.md`](handoff/firmware-ai-context.md) | Deep firmware context: board, deploy workflow, state machine, views, power |

## Hardware and sourcing

| Doc | What it covers |
|---|---|
| [`procurement/bom.md`](procurement/bom.md) | Bill of materials and cost-down levers |
| [`procurement/board-cost-reduction/`](procurement/board-cost-reduction/) | Alternative-board supplier study (and why the original board stayed) |
| [`procurement/battery-fuel-gauge/`](procurement/battery-fuel-gauge/) | Fuel-gauge options and the MAX17043 choice |
| [`../hardware/`](../hardware/) | CAD files and the wiring diagram |

## Shipping

| Doc | What it covers |
|---|---|
| [`handoff/`](handoff/) | TestFlight deploy, demo account and demo mode handoffs |
| [`app-store/`](app-store/) | External TestFlight testing |
| [`quality-assurance/`](quality-assurance/) | Website UX and accessibility audit |

## Planning

| Doc | What it covers |
|---|---|
| [`roadmaps/`](roadmaps/) | Development roadmap |
| [`delivery-ops/`](delivery-ops/) | Project plan |
| [`brainstorming/`](brainstorming/) | Feature ideation, BOM features, iOS notification options |
| [`business-development/`](business-development/) | Competitive analysis and the website copy draft |

## AI-agent process records

The project was built with Claude Code using the FRAIM job framework. Each job
leaves a paper trail:

- [`evidence/`](evidence/): per-feature implementation evidence (what was changed, how it was verified)
- [`retrospectives/`](retrospectives/): per-session retrospectives

`.docx` files alongside some Markdown docs are generated copies made with
`scripts/md_to_docx.py`. The Markdown is the source.
