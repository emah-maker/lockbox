# Design Evidence — iOS Call Greenlist (CallKit/PushKit) + Force-Quit-Resilient Usage Logging

**Date:** 2026-08-09
**RFC:** `docs/rfcs/ios-call-greenlist-and-force-quit-logging-technical-design.md`
**Note:** No formal feature spec (`docs/feature-specs/`) or issue tracker item exists for this task — it
was assigned conversationally by the manager (Mandy) as a technical-design job with explicit requirements
in the task brief itself, grounded in the upstream `docs/rfcs/companion-app-development-approach-technical-design.md`
and specific existing source files. The matrix below traces the manager's stated requirements to the RFC.

## Completeness Evidence
- Issue tagged `phase:design` / `status:needs-review`: N/A — no issue tracker in this conversational task.
- All files committed/synced to branch: N/A — conversational mode, no branch/PR opened per manager
  instruction; RFC + this evidence file are returned directly for review.

### Traceability Matrix

| Requirement (from manager's brief) | RFC section | Status | Validation plan alignment |
|---|---|---|---|
| iOS per-contact call greenlist via CallKit + PushKit VoIP push | §2 (whole section) | Met | RFC §5 rows 2-4 (priority-line call, foregrounded/backgrounded/force-quit) |
| Usage logging that survives app force-quit | §3 (whole section) | Met | RFC §5 rows 5-8 (OS-kill restore, multi-day backlog, ack interruption, NVM survival) |
| Ground in upstream RFC's Tier 1/Tier 2 plan (§5.3) | §2.1 reuses Tier 1 as-is; §2.2 builds Tier 2 per upstream's "VoIP priority line / relay" recommendation | Met | — |
| Ground in `app/modules/call-observer/` + its documented caller-ID limitation | §2.1 cites the module's header comment directly; confirms Tier 1 stays untouched | Met | RFC §5 row 1 (Tier 1 regression) |
| Ground in `app/src/calls/CallMonitor.ts` `resolveLabel()` stub | §2.1 cites line 67; §2.2 step 6 replaces it via a *new* file (`VoipCallMonitor.ts`), not by filling in the stub | Met | — |
| Ground in `app/src/store/useStore.ts` background-mode rationale | §1.1, §1.3 cite the file's own header comment on why `expo-task-manager` isn't used and why the client is a module-level singleton | Met | — |
| Ground in `app/app.json` BLE background config | §1.3, §2.5 build on the existing `UIBackgroundModes: ["bluetooth-central"]` + `isBackgroundEnabled` config, adding `voip` alongside it | Met | — |
| Explicitly account for: BGTaskScheduler/BackgroundFetch never relaunches a force-quit app | §0 summary table; §3.4 | Met | — |
| Design around PushKit VoIP push relaunch | §1.2 (`background-wake` module), §2.2-2.3 | Met | RFC §5 row "priority-line call, app force-quit" |
| Design around Core Bluetooth central state restoration | §1.2, §1.3, §3.3 | Met | RFC §5 row "OS kills app... `ble-restore` wake" |
| Box's own on-device session queue as lossless backstop | §3.1 (names why it isn't lossless yet), §3.2 (the fix: NVM persistence + ack-based clear + raised cap) | Met | RFC §5 rows 6-8 |
| State plainly where 100% survival is not achievable | §0 summary + §3.4 ("The honest ceiling," stated as its own labeled subsection per the brief's explicit ask) | Met | — |
| Shared background-wake foundation so downstream tasks don't conflict on native files | §1 (whole section): one module, one event stream, an explicit ownership table (§1.4) | Met | — |
| Output names native module changes, permissions, data flow, shared foundation contract | Native modules: §1.2, §2.3; permissions: §2.5; data flow: §4; shared contract: §1.4 | Met | — |
| Return to Mandy for review before implementation starts | §9 (explicit decisions needed); no code/branch/PR created | Met | — |

**Determination: PASS.** Every requirement in the manager's brief maps to a concrete RFC section. No
`Unmet` rows.

## Due Diligence Evidence
- Reviewed all five grounding sources named in the brief in detail (not just skimmed): the upstream RFC in
  full, `call-observer`'s Swift + TS + config files, `CallMonitor.ts`, `useStore.ts`, `app.json`, plus
  `protocol.ts`, `PhoneBoxClient.ts`, `sessionHistory.ts`, `storage.ts`, `lock_log.py`, and the relevant
  slice of `lock_controller.py`/`lock_ble.py`/`lock_settings.py`/`lock_config.py` — needed to ground the
  firmware-side fix precisely (confirmed `_MAX_PENDING = 40`, RAM-only, clear-on-notify-not-ack; confirmed
  the exact NVM magic-byte pattern to reuse).
- Reviewed codebase in detail to find a real, pre-existing correctness gap (history cleared on notify
  without an ack, §3.1 point 2) that the manager's brief didn't explicitly ask about but that the
  "lossless backstop" requirement can't be honestly satisfied without fixing.
- Included detailed design, data flow diagrams, validation plan, and risk assessment in the RFC.

## Prototype & Validation Evidence
- [ ] Built simple proof-of-concept — **not done**; no Apple Developer account, physical iOS device, or
  Twilio account available in this headless environment. Named as explicit pre-implementation spikes in
  RFC §7 instead, per the spike-first rule (spikes that can't be run don't block a design phase — they
  gate implementation sequencing).
- [ ] Manually tested complete user flow — not applicable, same reason.
- [x] Verified the *existing* solution's behavior before designing on top of it — read the actual
  firmware queue/clear logic and BLE client code rather than assuming; this is what surfaced the
  clear-on-notify gap above.
- [x] Identified minimal viable implementation — single shared Twilio number instead of a per-contact
  server-side allowlist (RFC §2.2), reuse of the existing `alert` characteristic instead of new UUIDs.
- [x] Documented what's genuinely new infra vs. reuse — RFC §8a splits "correctly followed / missing from
  architecture" precisely so implementation doesn't mistake the Twilio relay for a small addition.

## Continuous Learning

| Learning | Agent rule update |
|---|---|
| `project_context.md` says the SD-card/session-logging subsystem was removed (2026-07-24), but `Box-code/lib/lock_log.py` and `lock_ble.py` are present and wired up in the current tree — the context doc is stale on this point. | Not updated here (out of scope for a design task); flagged so a future `project-onboarding`/context-refresh pass corrects it rather than a future agent trusting the stale claim. |
