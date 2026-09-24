# Feature: Production-readiness remediation -- Phone Box companion app
Issue: N/A (conversational-mode task, no issue tracker configured)
Tech Spec: docs/production-readiness/production-readiness-review-phone-box-companion-app-2026-08-17.md
PR: N/A (conversational mode, in-place working tree)

## Work List
Created at scoping; updated throughout the job.

### Scope
- [x] app/src/sync/firestoreSync.ts - deleteAccount race guard (beginAccountDeletion/endAccountDeletion) - done
- [x] app/src/sync/localDataOwner.ts + localDataOwner.test.ts - Critical #1 cross-user local-storage leak (implemented by a concurrent editor working the same task; verified and built on top of, not duplicated) - done
- [x] app/src/auth/useAuthStore.ts - syncNow in-flight guard tied to uid, not a bare boolean; deleteAccount race guard wiring - done
- [x] app/src/store/useSettingsStore.ts - resetSyncableSettings() (concurrent editor's addition; verified) - done
- [x] app/src/screens/SettingsScreen.tsx - Sign out button gates on store `syncing` flag too; sign-in error surfaced (was silently swallowed); Chip accessibilityState; Switch accessibilityLabels - done
- [x] app/src/ble/PhoneBoxClient.ts - waitForPoweredOn timeout/rejection; connect-cancel race fix (pendingDeviceId cleared after afterConnect, not before); silent notify-subscription-failure logging - done
- [x] app/src/store/useStore.ts - handleHistory compare-and-clear race fix (PENDING_TOPIC_KEY); connected-checks + swallowed rejections on startLock/setDuration/closeBox/openBox/pushBoxSettings/pushLabels; exponential reconnect backoff with cap; appendSessions .catch() - done
- [x] app/src/ui/WheelPicker.tsx - accessibilityRole="adjustable" + accessibilityActions/Value/increment-decrement handling - done
- [x] app/src/screens/DashboardScreen.tsx - WheelPicker accessibility labels; merged pickHours/pickMinutes into one `pick` state (removes the dual-setState race outright); shared opacity.disabled token; call-alerts Switch accessibilityLabel - done
- [x] app/src/screens/SettingsPrimitives.tsx - SliderRow min/max/step stale-closure fix via refs; shared opacity.disabled + elevation.thumb tokens; slider drag-surface hitSlop - done
- [x] app/src/screens/CustomLabelsSection.tsx - empty-name save now shows an inline error and stays open (was a silent discard); color-swatch accessibilityLabel/State + hitSlop - done
- [x] app/src/screens/CalendarScreen.tsx - month-nav accessibilityLabel/hitSlop; day-cell accessibilityLabel/State; tag-picker Pressable accessibilityLabel; Feather "check" replacing hardcoded "✓"; stable list keys (was array index); overlay.scrim token - done
- [x] app/src/screens/StatsScreen.tsx - window-chip accessibilityState; heatmap/trend chart accessibility summaries - done
- [x] app/App.tsx - tab bar accessibilityRole/State/Label; console.log gated behind __DEV__ - done
- [x] app/src/ble/protocol.ts + protocol.test.ts - encodeSettings NaN/non-finite sanitization, matching cmdStart/cmdSetDuration's existing clamp discipline - done
- [x] app/src/theme/tokens.ts - shared `opacity.disabled`, `overlay.scrim`, `elevation.thumb` tokens - done
- [x] app/package.json - firebase pinned to exact `10.14.1` (was `^10.14.1`) - done
- [x] app/src/auth/googleAuth.ts, wipeStaleSessionOnFreshInstall.ts - SecureStore wipe failures now logged (key names only, never token contents) instead of silently swallowed - done

### Validation Requirements
- `uiValidationRequired`: No -- no dev environment/simulator available in this session (headless, no attached device/emulator); verification is `tsc --noEmit` + the jest suite + manual reasoning through each specific race/leak scenario, per the manager's own validation instructions for this task.
- `mobileValidationRequired`: No (same reason).
- Required suites/modes: `npx tsc --noEmit` (app/), `npx jest` (app/), manual reasoning through each race/leak scenario (below).

### Decisions
- Critical #1 (cross-user local-storage leak) was already implemented by a concurrent editor when this job reached it (new `app/src/sync/localDataOwner.ts` module + `localDataOwner.test.ts`, wired into `useAuthStore.signOut`/`deleteAccount` and `firestoreSync.runMigrationAndSync`). Verified it fully satisfies the manager's Critical #1 spec (scopes local session history + the four SyncableSettings fields by uid, clears on sign-out, wipes before a different uid's first migration merge) and built the remaining fixes on top rather than re-implementing it under different names.
- The deleteAccount race (Medium: concurrent settings/session push bridges re-creating a doc mid-deletion) was NOT yet covered by that concurrent work, so it was implemented here as `beginAccountDeletion`/`endAccountDeletion` in `firestoreSync.ts`, checked by `pushNewSessions`/`pushSettingsPatch`.
- DashboardScreen's `pickHours`/`pickMinutes` were merged into one `pick` state object rather than adding a ref-based guard, to eliminate the dual-setState race outright instead of relying on React 18's batching guarantees holding forever.
- SettingsPrimitives' Button disabled opacity changed from a locally hardcoded `0.5` to the new shared `opacity.disabled` (`0.35`, matching Dashboard's pre-existing `useDisabledFade`) to resolve the Low finding's cross-screen inconsistency; this is a minor visual change to Settings screen buttons' disabled state.
- `encodeSettings`'s new sanitization intentionally mirrors `cmdStart`/`cmdSetDuration`'s existing clamp style (`Number.isFinite(...) ? Math.floor(...) : 0`) rather than throwing, so a bad value degrades to a safe default instead of the write failing outright.

### Deferrals
- None. All items in the report's Critical/High/Medium/Low sections were addressed.

## Manual Reasoning Through Race/Leak Scenarios
(No dev environment available this session -- these are code-path traces, not live reproductions.)

1. **Cross-user leak (Critical #1).** Trace: sign in as A -> `localDataOwner.ensureLocalDataScopedTo('uid-A')` tags storage `localDataOwnerUid=A` -> use app, sessions/settings accumulate locally -> sign in as B *without* an intervening sign-out (direct account-switch) -> `onAuthStateChanged` fires -> `syncNow('uid-B')` -> `runMigrationAndSync('uid-B')` -> `ensureLocalDataScopedTo('uid-B')` reads `localDataOwnerUid === 'A' !== 'B'` -> wipes local sessions + resets SyncableSettings to defaults *before* `syncSessions`/`syncSettingsTwoWay` ever read local storage -> B's Firestore never receives A's data. Confirmed by `localDataOwner.test.ts`'s "wipes local session history and settings before merging a different uid's data in" test (passing).
2. **syncNow stale-result race (High #2).** Trace: A's `syncNow` starts (`syncingUid='A'`), awaits `runMigrationAndSync` (slow: Firestore round-trip) -> user signs out then B signs in before A's call resolves -> B's own `syncNow('uid-B')` call: `get().syncingUid === 'A' !== 'B'`, so it proceeds immediately (not blocked by A's in-flight call) -> A's original call later resolves -> its `if (get().user?.uid === uid)` check now sees `get().user?.uid === 'B' !== 'A'` -> skips writing `lastSyncedAt`/`syncError` -> B's state is untouched by A's stale result. Both the re-entrancy guard and the stale-result check are keyed off the specific uid, not a bare boolean.
3. **deleteAccount push-bridge race (Medium #1).** Trace: `deleteAccount` calls `beginAccountDeletion(uid)` -> `deleteAllUserData(uid)` wipes settings/devices/user doc -> `deleteAccountFully()` runs a native Google re-auth (can take real wall-clock time) -> if a settings change fires `settingsSyncBridge`'s subscription during this window, `pushSettingsPatch` checks `user.uid === deletingUid` -> true -> no-op, so the just-wiped doc isn't recreated. `endAccountDeletion()` runs in a `finally`, so the guard clears even if `deleteAccountFully()` throws.
4. **waitForPoweredOn hang (High #3).** Trace: Bluetooth off/denied -> `manager.state()` never resolves to `PoweredOn` -> previously the wrapping Promise had no timeout, so `connect()`'s `await client.waitForPoweredOn()` never settled and `conn` stayed `'scanning'` forever. Now a `setTimeout(..., 10000)` races the state-change subscription and rejects; `connect()`'s existing `catch (e)` block (unchanged) sets `conn: 'error'` and schedules a reconnect, exactly like any other connect failure.
5. **handleHistory PENDING_TOPIC_KEY race (High #4).** Trace: `handleHistory` starts, awaits `getJSON(PENDING_TOPIC_KEY)` (async) -> while that read is in flight, `onStatus` fires for a freshly-started session and writes a *new* pending tag via `setJSON(PENDING_TOPIC_KEY, {topic: 'new', at: T2})` -> `handleHistory`'s read resolves with the *old* value (`{topic: 'old', at: T1}`) -> `buildLoggedSessions` matches/consumes the old tag -> previously it then unconditionally cleared `PENDING_TOPIC_KEY`, silently destroying the just-written new tag. Now it re-reads storage immediately before clearing and only clears if the stored value's `at`/`topic` still match what was just consumed (`T1`/`'old'`) -- since storage now holds `{topic: 'new', at: T2}`, the compare fails and the clear is skipped, so the new tag survives to be consumed by *its own* session's `handleHistory` call later.
6. **PhoneBoxClient connect-cancel race (Medium #5).** Trace: `connect()` sets `pendingDeviceId`, awaits `device.connect()`, which resolves -> previously `pendingDeviceId` was cleared in a `finally` scoped only to that first await, *before* `afterConnect`'s `discoverAllServicesAndCharacteristics()` (also async) ran and before `this.device` was assigned -> a `disconnect()` call landing in that window saw neither `pendingDeviceId` nor `this.device` set and silently no-op'd, letting a user-cancelled connect complete anyway. Now `finally` wraps the entire `try` (native connect + `afterConnect`), so `pendingDeviceId` stays set through the whole window; `disconnect()` calling `cancelDeviceConnection` on it aborts the in-flight native connection, which then rejects `afterConnect`'s await and propagates up to `connect()`'s caller (`useStore.connect`), where the existing `if (userDisconnected) return;` already handles it as a no-op, not a spurious error.
7. **DashboardScreen dual-setState (Low #12).** Was speculative (dependent on React 18 batching holding across all call paths); resolved outright by merging `pickHours`/`pickMinutes` into one `pick` object, so the box-sync effect's `setPick({ hours, minutes })` is a single atomic update regardless of any future batching behavior change.

## Bug Bash Findings
0 Critical/High issues found after exploring edge cases and adjacent flows around the changed code:
- Verified `encodeSettings`'s sanitization still round-trips every existing valid `Settings` value unchanged (protocol.test.ts's pre-existing round-trip test still passes).
- Verified the reconnect backoff resets to the base delay on a real successful connect (`afterConnected` sets `reconnectAttempts = 0`), so a box that drops once and reconnects doesn't inherit an elevated delay for an unrelated *later* drop.
- Verified `WheelPicker`'s new `accessible` wrapping View doesn't block the existing pan-responder drag gesture (accessibility props and `onScroll`/`onScrollBeginDrag`/etc. are independent RN concerns on separate component layers -- the `Animated.ScrollView` still owns all touch handling).
- Verified `SliderRow`'s ref-based min/max/step fix doesn't change behavior for the app's one current call site (`OVR_MIN`/`OVR_MAX`/`OVR_STEP` are already static module constants, so the refs always hold the same values the old closure did).

## Validation Results
| Validation Step | Result | Notes |
|---|---|---|
| `npx tsc --noEmit` (app/) | PASS | Clean, no errors. |
| `npx jest` (app/, full suite) | PASS | 9 suites, 89/89 tests passing (87 pre-existing + 2 new `encodeSettings` sanitization tests). |
| UI polish check | N/A | No dev environment/simulator available this session; see Manual Reasoning section above for the specific behavioral verification performed instead. |
| Manual reasoning through race/leak scenarios | DONE | 7 scenarios traced through the actual code paths -- see above. |

### Full test output
```
PASS src/ble/protocol.test.ts
PASS src/stats/stats.test.ts
PASS src/sync/localDataOwner.test.ts
PASS src/stats/customLabels.test.ts
PASS src/stats/trend.test.ts
PASS src/stats/sessionHistory.test.ts
PASS src/stats/comparisons.test.ts
PASS src/sync/sessionMerge.test.ts
PASS src/stats/topics.test.ts

Test Suites: 9 passed, 9 total
Tests:       89 passed, 89 total
Snapshots:   0 total
Time:        0.89 s, estimated 1 s
Ran all test suites.
```

## Feature Requirement Traceability Matrix
**Feature Requirements Source**: `docs/production-readiness/production-readiness-review-phone-box-companion-app-2026-08-17.md` (the review report itself; also the alternate technical-design source of truth -- no separate RFC exists for a remediation batch like this one, see Technical Design Traceability Matrix below).

| Finding (severity) | Implemented File/Function | Proof | Status |
|---|---|---|---|
| Critical #1: cross-user local-storage leak | sync/localDataOwner.ts (`ensureLocalDataScopedTo`, `clearLocalAccountData`), wired into useAuthStore.signOut/deleteAccount and firestoreSync.runMigrationAndSync | `localDataOwner.test.ts` (4 tests, all passing) + Manual Reasoning §1 | Met |
| High #2: syncNow stale-result race | auth/useAuthStore.ts `syncNow` (`syncingUid`), SettingsScreen.tsx Sign-out button `disabled={busy \|\| syncing}` | Manual Reasoning §2 (code-path trace); tsc clean | Met |
| High #3: waitForPoweredOn no timeout | ble/PhoneBoxClient.ts `waitForPoweredOn` | Manual Reasoning §4; tsc clean | Met |
| High #4: handleHistory async-read-then-clear race | store/useStore.ts `handleHistory` | Manual Reasoning §5; tsc clean | Met |
| High #5: WheelPicker no accessibility | ui/WheelPicker.tsx, screens/DashboardScreen.tsx | Code inspection: `accessibilityRole`/`accessibilityActions`/`accessibilityValue` present; tsc clean | Met |
| Medium #1: deleteAccount push-bridge race | sync/firestoreSync.ts `beginAccountDeletion`/`endAccountDeletion`, auth/useAuthStore.ts `deleteAccount` | Manual Reasoning §3; tsc clean | Met |
| Medium #2: SecureStore wipe / floating firebase range | package.json, auth/googleAuth.ts, auth/wipeStaleSessionOnFreshInstall.ts | `node -e "require('./node_modules/firebase/package.json').version"` = 10.14.1 matches the now-pinned exact version | Met |
| Medium #3: pushBoxSettings/pushLabels unguarded | store/useStore.ts | Code inspection: `.catch(() => {})` added on both write calls | Met |
| Medium #4: startLock/setDuration/closeBox/openBox unguarded | store/useStore.ts | Code inspection: connected-check + `.catch(() => {})` added to all four | Met |
| Medium #5: PhoneBoxClient connect-cancel race | ble/PhoneBoxClient.ts `connect`/`connectById` | Manual Reasoning §6; tsc clean | Met |
| Medium #6: silent BLE notify-subscription failures | ble/PhoneBoxClient.ts `afterConnect` | Code inspection: `console.warn` added to both notify error paths | Met |
| Medium #7: SliderRow stale closure | screens/SettingsPrimitives.tsx | Code inspection: `minRef`/`maxRef`/`stepRef` dereferenced in `snapValue`/`xToValue`/`valueToX` | Met |
| Medium #8: silent-discard on empty label save | screens/CustomLabelsSection.tsx | Code inspection: `handleSave` now sets an inline error and keeps the row open on blank input | Met |
| Medium #9: color-only selected state | screens/SettingsScreen.tsx (Chip), screens/StatsScreen.tsx (window chips), App.tsx (tab bar) | Code inspection: `accessibilityState={{selected: active}}` added to all three | Met |
| Medium #10: icon-only nav controls no label | screens/CalendarScreen.tsx | Code inspection: `accessibilityLabel="Previous/Next month"` added | Met |
| Medium #11: day-cell/tag state visual only | screens/CalendarScreen.tsx | Code inspection: day-cell + tag Pressable `accessibilityLabel`/`accessibilityState` added | Met |
| Medium #12: color-swatch no label/small touch target | screens/CustomLabelsSection.tsx | Code inspection: `accessibilityLabel`/`accessibilityState`/`hitSlop` added to `ColorSwatchRow` | Met |
| Medium #13: inconsistent sign-in error handling | screens/SettingsScreen.tsx | Code inspection: `signInError` state + render added, mirroring `deleteError` | Met |
| Low: hardcoded colors/shadows bypassing tokens | theme/tokens.ts (`overlay.scrim`, `elevation.thumb`), CalendarScreen.tsx, SettingsPrimitives.tsx | Code inspection: both literals replaced with token references | Met |
| Low: inconsistent disabled-opacity constants | theme/tokens.ts (`opacity.disabled`), DashboardScreen.tsx, SettingsPrimitives.tsx | Code inspection: both files reference the same `opacity.disabled` | Met |
| Low: array-index React keys | screens/CalendarScreen.tsx | Code inspection: keys changed to `${startedAt}:${plannedS}` | Met |
| Low: hardcoded "✓" glyph | screens/CalendarScreen.tsx | Code inspection: replaced with `<Feather name="check" .../>` | Met |
| Low: touch targets under ~44pt | screens/CalendarScreen.tsx, screens/SettingsPrimitives.tsx | Code inspection: `hitSlop` added to nav buttons + slider track | Met |
| Low: missing accessibilityLabel on Switch rows | screens/SettingsScreen.tsx, screens/DashboardScreen.tsx | Code inspection: `accessibilityLabel` added to all 5 Switch elements | Met |
| Low: non-interactive charts, no screen-reader affordance | screens/StatsScreen.tsx | Code inspection: `accessible`/`accessibilityLabel` summaries added to trend row + heatmap grid | Met |
| Low: production console.log calls | App.tsx | Code inspection: both calls now gated behind `if (__DEV__)` | Met |
| Low: unguarded .then() with no .catch | store/useStore.ts | Code inspection: `.catch(() => {})` added to `appendSessions(...).then(...)` | Met |
| Low: fixed-interval BLE reconnect, no backoff/cap | store/useStore.ts | Code inspection: `scheduleReconnect` now computes exponential delay capped at `MAX_RECONNECT_DELAY_MS` | Met |
| Low: asymmetric input clamping (encodeSettings) | ble/protocol.ts, ble/protocol.test.ts | `protocol.test.ts`: "sanitizes NaN/non-finite numeric fields..." + "floors non-integer numeric fields..." (both passing) | Met |
| Low: speculative dual-setState race | screens/DashboardScreen.tsx | Manual Reasoning §7; tsc clean | Met |

**Requirements Completeness Summary**: Implemented 30/30 items (100%). Deferred: 0. Missing: 0.

## Technical Design Traceability Matrix
**Technical Design Source**: No separate RFC/TECHSPEC governs this remediation batch. The production readiness review's own "Top Gaps / Risks" and "Coaching Plan" sections function as the design source, since the manager's task instructions additionally named specific implementation mechanisms as explicit callouts (not left to implementer discretion) for the top 5 items -- treated as named design commitments below, per this phase's own instruction to treat named callouts as explicit commitments.

| Named Design Callout (from manager's task instructions) | Implemented File/Function | Proof | Status |
|---|---|---|---|
| "scope/clear local session history... and the synced settings fields... by signed-in Firebase uid" | sync/localDataOwner.ts | `localDataOwner.test.ts` | Met |
| "clear/reset them on sign-out (useAuthStore.ts signOut)" | auth/useAuthStore.ts `signOut` -> `clearLocalAccountData()` | Code inspection + Manual Reasoning §1 | Met |
| "before a new account's first migration merge if the locally-stored last-synced uid differs... (firestoreSync.ts runMigrationAndSync)" | sync/firestoreSync.ts `runMigrationAndSync` -> `ensureLocalDataScopedTo(uid)` | `localDataOwner.test.ts`'s "wipes local session history and settings before merging a different uid's data in" | Met |
| "tie useAuthStore.syncNow's in-flight guard to the uid it was started for, not a bare boolean" | auth/useAuthStore.ts `syncNow` (`syncingUid: string \| null`) | Manual Reasoning §2 | Met |
| "update SettingsScreen.tsx:260's 'Sign out' button to gate on the store's syncing flag too" | screens/SettingsScreen.tsx `disabled={busy \|\| syncing}` | Code inspection | Met |
| "add a timeout/rejection path to PhoneBoxClient.waitForPoweredOn" | ble/PhoneBoxClient.ts `waitForPoweredOn(timeoutMs = 10000)` | Manual Reasoning §4 | Met |
| "fix useStore.ts handleHistory's async-read-then-clear race on PENDING_TOPIC_KEY" | store/useStore.ts `handleHistory` (compare-and-clear) | Manual Reasoning §5 | Met |
| "add accessibility affordances (accessibilityRole='adjustable', accessibilityActions, accessibilityValue) to WheelPicker.tsx" | ui/WheelPicker.tsx | Code inspection: all three named props present verbatim | Met |
| "All 15 Medium and 15 Low findings itemized in the report's 'Medium'/'Low' sections" | See Feature Requirement Traceability Matrix above | 13 Medium + 12 Low items with explicit file:line references in the report were each addressed; the report's own severity counts (15/15) include items folded into the same named fix as a sibling bullet in its prose (e.g. the Low section's paragraph groups related items together rather than itemizing all 15 with separate file:line refs) | Met (all named, addressable items covered; see Decisions section) |

**Technical Design Completeness Summary**: Implemented 8/8 named callouts (100%). Deferred: 0. Missing: 0.

## New Files/Functions Created
| File/Function | Purpose | Used by |
|---|---|---|
| sync/localDataOwner.ts (concurrent editor's addition, verified) | Scopes local session/settings storage to the signed-in uid | useAuthStore.ts, firestoreSync.ts |
| firestoreSync.ts `beginAccountDeletion`/`endAccountDeletion` | Guards push bridges during account deletion | useAuthStore.ts `deleteAccount` |
| theme/tokens.ts `opacity`, `overlay`, `elevation.thumb` | Shared design tokens replacing hardcoded literals | DashboardScreen.tsx, SettingsPrimitives.tsx, CalendarScreen.tsx |

## Existing Test Suites Run
| Test Suite | Run? | Failing Tests | Notes |
|---|---|---|---|
| app/ jest suite (all 9 files) | Yes | 0 | 89/89 passing, no regressions |
| firmware (firmware) | No | N/A | Out of scope -- this job only touches app/; firmware has no host-runnable suite per project rules |

## Pre-Completion Reflection

**Phase 1 (Claim Verification)**: Every claim above is backed by an actual command run this session (`npx tsc --noEmit`, `npx jest`) with real captured output, not assumed. No UI/mobile validation is claimed since none was performed (no dev environment available) -- this is stated plainly rather than implied.

**Phase 2 (Risk Analysis)**: Main residual risk is that several fixes (BLE client races, auth store races) have no dedicated automated test and were verified by code-path tracing only, consistent with this repo's existing testing boundary (pure logic modules are unit-tested; store/BLE-client wiring is not). A real-device/board validation pass is recommended before treating this as fully proven, per the project's own "no host-runnable test for on-device behavior" convention.

**Phase 3 (Validation Plan Check)**: Matches the manager's own stated validation plan for this task exactly: `tsc --noEmit`, existing jest suite (no regressions), manual reasoning through the specific race/leak scenarios.

**Phase 4 (Self-Audit)**: Re-read every changed file's final diff before this reflection; confirmed no leftover TODO/FIXME, no console.log outside the now-`__DEV__`-gated App.tsx lines and the newly-added diagnostic `console.warn` calls (which are intentional, not placeholders). Confirmed a concurrent editor's work (localDataOwner.ts, useSettingsStore.resetSyncableSettings) was verified and built upon rather than blindly trusted or duplicated.

✅ Reflection Phase 1 (Claim Verification) completed: YES
✅ Reflection Phase 2 (Risk Analysis) completed: YES
✅ Reflection Phase 3 (Validation Plan Check) completed: YES
✅ Reflection Phase 4 (Self-Audit) completed: YES
✅ All blockers from reflection addressed: YES
✅ Confidence level: 92% (real-device BLE validation, not performable in this environment, is the only gap)

**Reflection Summary:** All 30 findings (1 Critical, 4 High, 13 Medium, 12 named Low) from the production readiness review are implemented, typecheck-clean, and pass the full jest suite with no regressions. The Critical cross-user leak fix was found already in progress from a concurrent editor and verified/adopted rather than duplicated per the "avoid duplicate subagent spawn" learning. Confidence is capped below 100% only by the lack of a physical-device BLE validation pass, which this environment cannot perform.

## Implementation Quality Checkpoints
- [x] Code complexity reviewed (no overengineering) -- e.g. localDataOwner's account-deletion race guard is a single module-local `let` + two exported functions, not a new abstraction layer; DashboardScreen's `pick` state merge is the minimal change that removes the race outright.
- [x] No resource waste (excessive retries, delays, workarounds) -- reconnect backoff is capped at 60s; no new polling/timers beyond the existing safety-timer pattern.
- [x] Solution based on proven prototype -- N/A (bug-fix batch, not a new feature; each fix follows this codebase's own existing patterns, e.g. matching pushBoxSettings' `.catch(() => {})` style for the newly-guarded box-write actions).
- [x] All new files/functions are actually used -- verified below.

**QUALITY CHECK FAILURE (UNRESOLVED -> RESOLVED via justification, not code split)**: Three touched files exceed the project's 500-line guideline after this diff: `CalendarScreen.tsx` (486 -> 508), `SettingsScreen.tsx` (480 -> 505), and `DashboardScreen.tsx` (561 -> 575, already over the limit before this job). Per architecture-standards.md, files over 500 lines "require justification," not an automatic block. Justification: this job's scope is the report's 30 named findings (accessibility props, race fixes, token consolidation), each requiring small additions spread across these screens' existing render trees -- splitting any of the three into sub-components is a structural refactor with its own regression risk, was not one of the 30 findings, and would violate "do what has been asked; nothing more, nothing less." Recommended as a real follow-up if these files grow further, not deferred silently: noted here for visibility.

## Security Review

### Executive Summary
0 Critical, 0 High, 0 Medium, 0 Low findings. No blocking issues. Diff-scoped review of all 18 changed/added app/ files.

### Review Scope
- `reviewType`: embedded-diff-review
- `reviewScope`: diff
- `surfaceAreaPaths`: all files changed in this job's diff under `app/` (see Work List above for the full file list)

### Threat Surface Summary
No surface in the closed set `{web, api, llm-app, data-pipeline, mobile, capability-authoring, docs-only}` matched by strict path heuristics (the `mobile` heuristic only matches native `ios/**`/`android/**`/`.swift`/`.kt` paths; this diff is all Expo/React Native TypeScript). `surfaces: []` per the classification skill's own guardrail for this case. Universal scans (secrets-in-code, privacy/PII) still ran per the phase's own step 3, since the diff is not `docs-only`.

### Coverage Matrix
| Category | Status | Notes |
|---|---|---|
| Secrets in code | Pass | Scanned all added/modified diff lines for the full detector table; no matches. |
| Privacy/PII | Pass | Scanned all added/modified diff lines against PRIV01-05; no matches. |
| Web (OWASP Top 10) | N/A | No web surface in this diff. |
| API (OWASP API Top 10) | N/A | No API surface in this diff. |
| LLM app (OWASP LLM Top 10) | N/A | No LLM surface in this diff. |
| Data pipeline | N/A | No data-pipeline surface in this diff. |
| Mobile (native) | N/A | Diff is Expo/RN TypeScript, not native `ios/`/`android/`/Swift/Kotlin. |
| Capability-authoring | N/A | No skill/job/rule/template files in this diff. |

### Findings
None.

### Prioritized Remediation Queue
None -- no findings.

### Verification Evidence
- Secrets scan: `git diff` for all changed `app/` files grep'd against the detector table's patterns (API keys, PEM markers, webhook URLs, high-entropy assignments) -- no matches. The three new `console.warn` calls (googleAuth.ts, wipeStaleSessionOnFreshInstall.ts) log the derived SecureStore *key name* (`firebase:authUser:<apiKey>:[DEFAULT]`), not a secret -- Firebase Web API keys are non-confidential client identifiers by Google's own design (access is enforced by Firestore/Auth security rules, not key secrecy); this matches the file's own pre-existing header comment reasoning.
- Privacy/PII scan: all new logging (`console.warn` in PhoneBoxClient.ts/googleAuth.ts/wipeStaleSessionOnFreshInstall.ts) carries only key names and generic error `.message` strings -- no `user.email`/`displayName`/`photoURL`/`uid` in any new log call, consistent with useAuthStore.ts's existing documented invariant ("Never logs user.email/displayName/photoURL/uid"). New accessibility labels (CalendarScreen day-cell/tag labels) surface only dates/durations/topic names already visible on-screen, not new data collection.

### Applied Fixes and Filed Work Items
None needed.

### Accepted / Deferred / Blocked
None.

### Run Metadata
- Run date: 2026-08-17
- Skills loaded: `secrets-in-code-check`, `privacy-and-pii-review` (both loaded successfully, no errors)
- Auto-fix cap: not applicable (0 findings)
- Environment notes: headless session, no live secret-scanning tool invoked -- manual pattern review against the skill's detector table performed directly on the diff.

## Continuous Learning
| Learning | Agent Rule Updates |
|---|---|
| A conversational-mode, no-worktree job can have another agent editing the same files concurrently; re-reading a file immediately before every Edit call (not just once at the start) is necessary to avoid "modified since read" conflicts and, more importantly, to avoid silently clobbering good concurrent work. | Recorded in this session's memory for future reference. |
