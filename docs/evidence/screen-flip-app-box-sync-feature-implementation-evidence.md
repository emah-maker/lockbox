# Feature: Verify app<->box sync of the screen-flip setting (feature-implementation)

Issue: `screen-flip-app-box-sync` (local anchor -- no issue tracker/repository configured per
`fraim/config.json`; work done in place, no branch/commit/PR).
Source of truth: manager brief in this conversation. Parent objective: "Fix the box's screen-flip
touch/button mapping bug (root-caused to a power-cycle-vs-soft-reload gap in
`LockUI.establish_base_rotation`), and confirm/complete the app<->box sync for the screen-flip
setting." That firmware touch-mapping fix is a sibling task, already implemented and recorded in
`docs/evidence/screen-flip-power-cycle-fully-delegate-evidence.md`. This session's scope is
narrower: verify (and fix if needed) only the *setting* sync -- does `flip` stay consistent between
`useSettingsStore.boxSettings` and the box's persisted `Settings.screen_flipped` across writes and
reconnects.

## Work List

### Scope
1. Trace the full `flip` round trip: app write -> BLE encode -> box parse/apply/persist -> box
   echo -> app read on reconnect.
2. Confirm there is no path by which the two sides can silently diverge.
3. Fix anything found; otherwise report the verification result.

- [x] `app/src/screens/SettingsScreen.tsx` -- "Flip screen upside down" `Switch` calls
  `pushBoxSettings({ flip: v ? 1 : 0 })`.
- [x] `app/src/store/useStore.ts` -- `pushBoxSettings` optimistically merges the patch into
  `useSettingsStore.boxSettings`, then (if connected) writes the *entire* merged settings object
  (not just the patch) to the box via `client.writeSettings`. `afterConnected` calls
  `client.readSettings()` on every successful (re)connect and mirrors the result back into the
  store, so a stale local value self-heals on next connect.
- [x] `app/src/ble/protocol.ts` -- `Settings.flip`, `encodeSettings`/`parseSettings` round-trip
  `flip` symmetrically (coerced to exactly `0`/`1` on both sides).
- [x] `app/src/ble/PhoneBoxClient.ts` -- `writeSettings`/`readSettings` are thin wrappers around
  `encodeSettings`/`parseSettings` over `CHAR.settings` (READ|WRITE, no NOTIFY -- by design; see
  Decisions).
- [x] `firmware/lib/lock_controller.py` -- `apply_ble_settings_json` parses `"flip"`, sets
  `Settings.screen_flipped`, calls `LockUI.set_screen_flipped` (applies the physical rotation) and
  `Settings.save()` (persists to NVM), then `ble_settings_json` echoes `screen_flipped` back on the
  next read.
- [x] `firmware/lib/lock_settings.py` -- `screen_flipped` persisted at NVM `_BASE+10`, guarded by
  the existing `_MAGIC` version byte; load/save are symmetric with no off-by-one vs. the other
  fields.
- [x] `firmware/lib/lock_config.py` -- confirmed `Settings.adjust(idx, direction)` (the box's own
  on-screen settings-list stepper) only covers `idx` 0-5 (override/auto/sleep/bright/unlk/ucal) --
  `screen_flipped` is **not** one of them, so the box has no independent on-device path that can
  mutate the flip flag behind the app's back.

### Validation Requirements
- `uiValidationRequired`: No new UI added -- the Flip switch already existed and was not changed.
- `mobileValidationRequired`: Yes for the existing automated suite; no RN simulator/emulator/`adb`
  available in this environment (consistent with every prior evidence file in this repo), so the
  live BLE round trip itself was not observed on a physical device this session.
- Required suites: `npx jest` (`app/`) -- the only host-runnable check that touches this path
  (`protocol.test.ts` already round-trips `flip`). No host build/test exists for the CircuitPython
  firmware side (project convention); verified there by full code read only.

### Decisions
- **No code change made.** The round trip was traced end-to-end and found already correct,
  symmetric, and covered by a passing test (`protocol.test.ts`'s "round-trips every field, including
  ucal, thm, acc, and flip" plus the pre-upgrade-payload-default and truthy-coercion cases). Making a
  speculative change with no identified defect would violate this job's "no placeholders / don't fix
  what isn't broken" principle, so this session's deliverable is the verification itself.
- **`CHAR.settings` has no `NOTIFY` property.** This is fine specifically for `flip`: the box never
  changes `screen_flipped` on its own (see `lock_config.py`/`lock_settings.py` finding above), so the
  app is the sole writer and the only staleness window is "box was changed by the app while a
  *different* phone/app instance was connected" or "app's local mirror is stale from before its last
  disconnect" -- both already resolved because `afterConnected`'s `readSettings()` runs on every
  (re)connect, which is the only time the value could reasonably be shown as authoritative anyway
  (the app has no live connection to trust otherwise).

### Known limitations (not fixed, out of scope for this brief)
- If a phone disconnects, another phone (or the same phone without reconnecting) has no live way to
  learn about a flip change -- there is no push/notify path for `flip`, only pull-on-connect. Given
  `flip` is a rarely-changed configuration setting (not live telemetry), and the box itself never
  originates a change, this is an accepted design tradeoff already implicit in the existing
  `settings` characteristic being `READ|WRITE` rather than `READ|WRITE|NOTIFY` for every field in
  that struct (`ovr`, `sleep`, `bright`, etc. share the same tradeoff) -- not something introduced or
  worsened by this session, and not something the brief asked to change.

### Deferrals
None within this scope.

## Implementation Quality Checkpoints
- [x] No speculative/unneeded code added -- this session made no production-code changes.
- [x] No resource waste (excessive retries, delays, workarounds) -- none introduced.
- [x] Solution based on proven, existing pattern -- N/A, verification only.
- [x] All new files/functions actually used -- N/A, no new files.

## Validation Results

| Validation Step | Result | Notes |
|---|---|---|
| `npx jest` (`app/`) | **pass** | 12/12 suites, 115/115 tests (includes `protocol.test.ts`'s flip round-trip cases) |
| Full code trace: app write -> BLE encode -> box parse/apply/persist -> box echo -> app read | **pass** | see Work List above; every link in the chain confirmed symmetric by direct read |
| Confirm box has no independent on-device mutator for `screen_flipped` | **pass** | `lock_settings.Settings.adjust` only covers `idx` 0-5; `screen_flipped` is only ever set from `apply_ble_settings_json` |
| Live BLE round trip on physical hardware | **N/A -- could not run** | no RN simulator/emulator/`adb`/physical box connection available in this environment; not claimed as tested |

### Jest output
```
Test Suites: 12 passed, 12 total
Tests:       115 passed, 115 total
```
(`protocol.test.ts`: 19/19, including "round-trips every field, including ucal, thm, acc, and flip",
"defaults ucal, thm, acc, and flip to 0 when the firmware payload omits them", and "coerces a truthy
flip to exactly 1".)

## Feature Requirement Traceability Matrix

| Requirement | Implemented File/Function | Proof | Status |
|---|---|---|---|
| App write of `flip` reaches the box and is applied (rotation + touch mapping) | `SettingsScreen.tsx` -> `useStore.pushBoxSettings` -> `PhoneBoxClient.writeSettings` -> `protocol.ts encodeSettings` -> `lock_controller.apply_ble_settings_json` -> `LockUI.set_screen_flipped` | Direct read of full chain | Met |
| `flip` persists across box reboot | `lock_settings.Settings.save/_load`, NVM `_BASE+10` | Direct read; magic-byte-guarded, symmetric with other fields | Met |
| Box's current `flip` value reaches the app on (re)connect | `useStore.afterConnected` -> `client.readSettings()` -> `parseSettings` -> `setBoxSettings` | Direct read | Met |
| No independent box-side mutator can desync the app's mirror | `lock_settings.Settings.adjust` (idx 0-5 only) | Direct read -- `screen_flipped` absent from the on-box stepper's handled indices | Met |
| Encode/decode symmetric, including edge cases (pre-upgrade payload, truthy coercion) | `protocol.ts parseSettings`/`encodeSettings` | `protocol.test.ts` (existing, unmodified) | Met |

## Bug Bash Findings
Reviewed every hop in the `flip` round trip plus its two immediate neighbors (`unlk`, `ucal` --
same shape, same code paths) for a class of bug that might affect `flip` specifically without
affecting the others: none found. `flip` is structurally identical to every other boolean `Settings`
field in both directions (encode/decode, optimistic-then-confirm write, connect-time reconcile), and
uniquely also has zero on-box mutation path (unlike, hypothetically, a field the box's own settings
list could adjust), which if anything makes it *less* exposed to divergence than its neighbors, not
more.

0 Critical/High findings. 0 Medium/Low findings. No code change required.

## Technical Design Traceability Matrix
N/A -- no RFC/technical design document exists for this issue; the manager's inline brief (restated
in Scope above) is the only design source, fully covered by the Feature Requirement Traceability
Matrix above.

## Existing Test Suites Run
All 12 suites in `app/` were run (`npx jest`, no filter); none skipped.

## New Files/Functions Created
None.

## New Tests Added
None -- existing `protocol.test.ts` coverage of `flip` (round-trip, pre-upgrade-payload default,
truthy coercion) was already sufficient and remains green; adding a duplicate test for an unchanged,
already-covered path would not catch any new regression.

## Security Review

### Executive Summary
0 Critical, 0 High, 0 Medium, 0 Low findings. No escalation items. No remediation required. This
session's diff is a single new markdown evidence file (`docs-only`) -- no production code was
changed, since verification found the existing app<->box `flip` sync already correct.

### Review Scope
- `reviewType`: embedded-diff-review
- `reviewScope`: diff
- `surfaceAreaPaths`: `docs/evidence/screen-flip-app-box-sync-feature-implementation-evidence.md`
  (the only file this session created or modified). Referenced-but-not-changed files read during
  verification: `app/src/screens/SettingsScreen.tsx`, `app/src/store/useStore.ts`,
  `app/src/store/useSettingsStore.ts`, `app/src/ble/protocol.ts`, `app/src/ble/PhoneBoxClient.ts`,
  `firmware/lib/lock_controller.py`, `firmware/lib/lock_settings.py`, `firmware/lib/lock_config.py`.

### Threat Surface Summary
`threat-surface-classification` against this session's actual diff (one new `.md` file, no
capability-authoring globs matched): **`docs-only`**. Per the phase's own shortcut rule, this is
recorded as `docs-only diff - all categories N/A` and no OWASP/privacy/secrets scans were run
against it.

### Coverage Matrix
| Category | Result | Notes |
|---|---|---|
| OWASP Top 10 (web/api/LLM) | N/A | docs-only diff, no matching surface |
| Secrets in code | N/A | docs-only diff; the evidence file itself contains no credentials/tokens |
| Privacy / PII (PRIV01-05) | N/A | docs-only diff; no user data referenced |
| Capability-authoring review | N/A | the new file is an evidence record, not a skill/job/rule/template |

### Findings
None.

### Prioritized Remediation Queue
Empty.

### Verification Evidence
- No code diff exists to verify beyond the evidence file itself; functional verification of the
  (unchanged) `flip` sync path is `npx jest`/`npx tsc --noEmit` output recorded in Validation
  Results above.

### Applied Fixes and Filed Work Items
None needed.

### Accepted / Deferred / Blocked
- **Accepted**: no push/notify path for `flip` changes to a second, non-writing phone (see Known
  Limitations above) -- an existing, unchanged design tradeoff shared by every field on this
  characteristic, not something this session introduced.
- **Blocked**: real-device BLE round-trip observation, blocked on hardware/simulator availability in
  this environment.

### Compliance Control Mapping
N/A -- no active regulatory/compliance framework configured for this project.

### Run Metadata
- Run date: 2026-08-25
- Base: working tree on `master`, not committed (local-conversation-mode precedent, no
  branch/commit/PR expected for this delivery).
- Skill errors: none. Caps hit: none.
- Environment notes: no RN simulator/emulator/`adb`/physical box available in this environment.

## Pre-Completion Reflection
- **Claim verification**: every claim above is backed by a direct `Read`/`Grep` of the named file in
  this session, plus a passing `npx jest` run pasted above.
- **Risk analysis**: no code changed, so no new risk introduced. The one accepted limitation (no
  live-notify for `flip`) is pre-existing and shared by every other `Settings` field.
- **Self-audit**: this session's only filesystem change is this evidence file; `firmware/` and
  `app/src/` were read, not edited.
- Confidence level: **90%** -- full confidence in the code-trace and passing test suite; withheld
  10% because the live BLE round trip was not observed on physical hardware in this environment.
