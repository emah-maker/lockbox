---
reviewContext:
  subjectType: mobile-app-directory
  subjectLabel: Phone Box companion app (app/)
  reviewRef: app/src/{screens,store,ble,stats,sync,auth,ui,theme},App.tsx @ master
  scopeSummary: >
    Audit of app/ (screens, store, ble, stats, sync, auth, ui, theme) for UX/polish,
    correctness, performance, accessibility, and consistency with this app's documented
    conventions (theme tokens, AnimatedPressable, hand-rolled tab switcher, Firebase/BLE
    data channels). Findings-only (no auto-fix). Excludes the already-reviewed
    stats-window-persistence change and the outstanding app-icon task.
  repoIdentifier: lockbox
  branchRef: master
  sourceInventory:
    - app/src/auth/useAuthStore.ts
    - app/src/sync/firestoreSync.ts
    - app/src/ui/WheelPicker.tsx
    - app/src/store/useStore.ts
    - app/src/ble/PhoneBoxClient.ts
quality:
  composite: 3.9
  gateDecision: "fail"
  securityPosture:
    score: 3
    rationale: "Critical, undocumented cross-user local-storage leakage on sign-in/out/account-switch, compounded by a stale-sync-result race between signed-out and newly signed-in users."
  availabilityResilience:
    score: 5
    rationale: "BLE/firmware wire contract verified drift-free, but several BLE operations lack timeouts, connected-checks, or reconnect backoff."
  backupRestore:
    score: 7
    rationale: "N/A in the traditional sense for a client-only app; Firestore/box are the systems of record and enforce their own integrity via security rules. No restore-path finding surfaced."
  observabilityOps:
    score: 5
    rationale: "Several BLE write paths throw unhandled rejections; one notify-subscription failure path fails silently; leftover production console.log calls."
  releaseSafety:
    score: 5
    rationale: "Multiple real, reproducible correctness bugs (session-tag race, connect-cancel race, input-clamp asymmetry) though none currently exploitable end-to-end thanks to firmware-side defenses."
  governanceRunbooks:
    score: 7
    rationale: "Unusually well-documented conventions (expo-react-native-dev skill, sync RFC with its own QA checklist) mostly followed; gaps found are consistency drift, not absent governance."
  criticalRisks: 1
  highRisks: 4
  mediumRisks: 15
  lowRisks: 15
  blockedLaunchCriteria: 1
  restoreTested: false
  failoverValidated: false
  rollbackValidated: false
  coaching: "Scope local AsyncStorage session/settings storage by signed-in uid (or wipe/reset it on sign-out and before a new account's first migration merge), removing both the critical leakage risk and the High-severity syncNow stale-result race it enables."
---

# Production Readiness Review — Phone Box Companion App (`app/`)

## Executive Summary

Full-file review of `app/src/{screens,store,ble,stats,sync,auth,ui,theme}` and `App.tsx` against
the app's documented conventions. **Gate decision: FAIL** — one critical, launch-blocking privacy/data-integrity
gap (cross-user local-storage leakage) plus 4 High, 15 Medium, and 15 Low findings across accessibility,
BLE reliability, and correctness. The BLE↔firmware wire contract itself is verified clean (no drift against
`Box-code/lib/lock_config.py`). Most findings are gaps in things this app does well elsewhere (error surfacing,
accessibility, token discipline) rather than systemic architecture problems — the conventions themselves are sound
and mostly followed.

## Review Context

- **Subject**: Phone Box companion app, `app/` directory (Expo SDK 52, React Native 0.76.5, TypeScript)
- **Excluded from scope**: `StatsScreen.tsx`'s time-window persistence logic (`TIME_WINDOW_KEY`/`isTimeWindow`/
  `userSelectedRef`) — already reviewed and accepted, see
  `docs/evidence/stats-window-persistence-fully-delegate-evidence.md`. The missing/placeholder app icon — tracked separately.
- **Conventions reference**: `fraim/personalized-employee/skills/mobile/expo-react-native-dev.md`
- **Method**: three parallel full-file reviews (screens/ui/theme/App.tsx; store/ble/stats + firmware
  cross-check; sync/auth), followed by direct spot-verification of the two highest-severity claims
  against source and against `docs/rfcs/google-signin-cross-device-sync-architecture.md`.

## Dimension Scorecard

| Dimension | Score /10 | Note |
|---|---|---|
| Security posture | 3 | Critical cross-user data leakage + High sync race |
| Availability/resilience | 5 | BLE contract clean; several unguarded/untimed BLE ops |
| Backup/restore | 7 | N/A shape for this workload; no restore-path finding |
| Observability/ops | 5 | Silent error swallowing, unhandled rejections, stray logs |
| Release safety | 5 | Real but currently-contained correctness bugs |
| Governance/runbooks | 7 | Strong documented conventions, mostly followed |
| **Composite (capped, gate=fail)** | **3.9** | Cap applies because a critical risk is open |

## Launch Decision and Remediation Queue

**Decision: FAIL.** One critical risk (cross-user local data leakage) must close before this is safe to treat as
production-ready for any device that could ever be shared, resold, reset, or re-signed-into with a different account.

**Remediation queue (highest leverage first):**
1. **[Critical]** Scope/clear local session + settings storage by uid on sign-in/sign-out (closes Sync/Auth #1 and materially reduces the blast radius of Sync/Auth #2).
2. **[High]** Tie `syncNow`'s in-flight state to the uid it was started for, not a bare boolean (Sync/Auth #2).
3. **[High]** Add a timeout/rejection path to `waitForPoweredOn` (BLE #2).
4. **[High]** Fix `handleHistory`'s async-read-then-clear race that can wipe a fresh session tag (Store/BLE #1).
5. **[High]** Add accessibility affordances to `WheelPicker`, the sole control for a core flow (Screens/UI #WheelPicker).
6. Work down the Medium queue (below) at normal priority; Low findings are cleanup-tier.

## Top Gaps / Risks

### Critical

**1. Cross-user local-data leakage on shared devices / account switches**
`app/src/sync/firestoreSync.ts:89-132` (`syncSessions`), `:145-171` (`syncSettingsTwoWay`); `app/src/auth/useAuthStore.ts:71-92` (`signIn`/`signOut`)

Local session/settings storage is never scoped, tagged, or reset per Firebase uid — the only persisted
sync bookkeeping is a bare `lastSyncedAt` timestamp (`useAuthStore.ts:22`). `syncSessions` unconditionally
uploads whatever is in local storage to the *newly signed-in* uid's Firestore path and merges the remote
result back into local storage (`firestoreSync.ts:117-121`); `syncSettingsTwoWay` compares timestamps with
no identity check and can silently overwrite the new account's cloud settings with the previous account's
local ones (`firestoreSync.ts:157-168`). Neither `signIn` nor `signOut` clears or namespaces local storage.
**Verified against design intent**: `docs/rfcs/google-signin-cross-device-sync-architecture.md` §4.1-4.2 designs
the merge model only for "same account, multiple devices" and its own manual QA checklist item 10 ("Logout
performs a full wipe") only tests Keychain/`auth.currentUser`, never AsyncStorage — this is a genuine,
undocumented gap, not an accepted risk.
**Impact**: on any shared/family/resold/reset device, or a corrected "wrong account" sign-in, one person's full
session history and topic labels can be uploaded into a different person's account and displayed in their Stats
screen, and a returning account's cloud settings can be silently clobbered.

### High

**2. `syncNow` race — a stale, signed-out user's sync outcome can apply to the next signed-in user**
`app/src/auth/useAuthStore.ts:58-69,94-110`; `app/src/screens/SettingsScreen.tsx:260`
Re-entrancy is guarded by a single boolean (`syncing`) with no uid binding. If user A's `syncNow` is still
in flight when user B signs in, B's own `syncNow` call no-ops (sees `syncing === true`), and when A's stale
promise later settles it unconditionally writes into whatever is now the *current* store state — B's session
can inherit A's error message or a bogus `lastSyncedAt`. Reachable in the real UI: "Sign out" on
`SettingsScreen.tsx:260` is gated only on local `busy`, not the store's `syncing` flag.

**3. `waitForPoweredOn` has no timeout — indefinite spinner if Bluetooth is off/denied**
`app/src/ble/PhoneBoxClient.ts:78-89`, called from `app/src/store/useStore.ts:254`
No rejection path; `conn` stays `'scanning'` forever with no error surfaced and no user-facing way out short
of manually disconnecting.

**4. `handleHistory` async race can silently wipe a freshly-tagged session**
`app/src/store/useStore.ts:139-173`, specifically `:151-154`
Reads `PENDING_TOPIC_KEY` async, then unconditionally clears it and resets `currentTopic: null` — if a new
tag write (`:353-356` or `:187-190`) lands for the newly-started session while an older, unrelated
`handleHistory` call is still in flight (realistic: both `onHistory`/`onStatus` fire right after connect),
the new tag is silently discarded from storage and live state.

**5. `WheelPicker` has zero accessibility affordances**
`app/src/ui/WheelPicker.tsx` (whole component; verified — no `accessibilityRole`, `accessibilityActions`, or
`accessibilityValue` anywhere in the file)
This is the sole phone-side control for setting lock duration on the Dashboard. It is completely inoperable
via VoiceOver/TalkBack — a hard accessibility blocker on a core flow, not a nice-to-have gap.

### Medium (15 total — representative selection; full list in Source Inventory / audit transcripts)

- **`deleteAccount` race with concurrent settings/session push bridges** — `firestoreSync.ts:247-269`,
  `useAuthStore.ts:83-92`: a settings/session write landing between Firestore-data deletion and Auth-user
  deletion can re-create docs that were just wiped, becoming unreachable-but-not-purged.
- **SecureStore wipe depends on undocumented Firebase internals + a floating dependency range** —
  `auth/secureStoreKeys.ts:20-33`, `app/package.json:24` (`firebase": "^10.14.1"`): a minor-version bump
  could silently break both the sign-out and fresh-install SecureStore wipes with no error surfaced
  (every delete is `.catch(() => {})`).
- **`pushBoxSettings`/`pushLabels` unguarded against mid-write disconnect** — `store/useStore.ts:337-347`:
  unhandled `Error('Not connected')` rejection.
- **`startLock`/`setDuration`/`closeBox`/`openBox` have no connected-check or error handling** —
  `store/useStore.ts:312-326`, inconsistent with the connected-check pattern two functions away.
- **`PhoneBoxClient` connect-cancel race** — `ble/PhoneBoxClient.ts:119-140` vs `142-187`: `pendingDeviceId`
  clears before `afterConnect` finishes, briefly defeating the very race-guard its own doc comment describes;
  a user-cancelled connect can complete anyway before self-correcting.
- **Silent BLE notify-subscription failures** — `ble/PhoneBoxClient.ts:167-184`: errors are dropped with
  `if (err || !c) return;` — the app can sit in `'connected'` state receiving no further updates,
  indistinguishable from healthy in the UI.
- **`SliderRow` stale-closure on `min`/`max`/`step`** — `screens/SettingsPrimitives.tsx:212-246`: the
  `PanResponder` is built once via `useRef(...).current` and permanently closes over first-render range
  values; latent today (one call site, constant range) but a real bug if reused with a dynamic range.
- **Silent-discard on empty label save** — `screens/CustomLabelsSection.tsx:121-128`: no error text, row
  just reverts.
- **Color-only "selected" state with no `accessibilityState`** — `screens/SettingsScreen.tsx` `Chip`
  (410-448), `screens/StatsScreen.tsx` window chips (103-122), `App.tsx` tab bar (102-115).
- **Icon-only nav controls with no accessibility label** — `screens/CalendarScreen.tsx:144-153,157-166`.
- **Day-cell/tag state conveyed visually only** — `screens/CalendarScreen.tsx:190-212,240-249`.
- **Color-swatch picker has no label and a 28×28 touch target** — `screens/CustomLabelsSection.tsx:155-179`.
- **Inconsistent sign-in error handling** — `screens/SettingsScreen.tsx:187-198` swallows all sign-in errors
  silently while `handleDeleteAccount` (209-236) surfaces failures, inconsistent within the same screen.

### Low (15 total)

Hardcoded colors/shadows bypassing `theme/tokens.ts` (`CalendarScreen.tsx:391` scrim,
`SettingsPrimitives.tsx:333-345` slider-thumb shadow); inconsistent disabled-opacity constants
(`DashboardScreen.tsx:35` vs `SettingsPrimitives.tsx:55`); array-index React keys on reorderable lists
(`CalendarScreen.tsx:119,227`); a hardcoded `"✓"` glyph instead of `Feather` (`CalendarScreen.tsx:375`);
touch targets under ~44pt on month-nav (`CalendarScreen.tsx:430`) and the slider drag surface
(`SettingsPrimitives.tsx:330`); missing `accessibilityLabel` on Switch rows (`SettingsScreen.tsx`);
non-interactive charts with no screen-reader affordance (`StatsScreen.tsx` heatmap/sparklines);
two production `console.log` calls (`App.tsx:51-52`); unguarded `.then()` with no `.catch` on session
append (`store/useStore.ts:168-171`); fixed-interval BLE reconnect with no backoff/cap
(`store/useStore.ts:42,118-124`); asymmetric input clamping between BLE encode/parse paths
(`ble/protocol.ts:131,137,140`) — not currently exploitable since the firmware clamps defensively, but a
`NaN` slipping into `encodeSettings` would abort a settings write partway through with no diagnostic; a
speculative dual-`setState` race in the Dashboard's duration-mirror effect (`DashboardScreen.tsx:240-263`).

## Coaching Plan

1. **Highest leverage**: close the cross-user local-storage leak (Critical #1) — scope AsyncStorage
   session/settings reads/writes by the currently signed-in uid, and clear/reset that local state on
   sign-out and before a new account's first migration merge runs. This also removes the precondition
   for the High-severity `syncNow` race (#2).
2. Add a timeout to `waitForPoweredOn` and connected-guards to the four unguarded box-write actions in
   `useStore.ts` — both are small, contained changes with outsized reliability payoff for the core
   lock/unlock flow.
3. Give `WheelPicker` real accessibility support (`accessibilityRole="adjustable"`, `accessibilityActions`,
   `accessibilityValue`) before treating the Dashboard's duration control as complete — it is currently a
   hard accessibility blocker, not a polish item.
4. Batch the Medium/Low consistency findings (hardcoded colors/shadows, disabled-opacity constants,
   color-only selection state) into a single follow-up pass once the correctness/security items above are
   closed — none of them are individually urgent, but taken together they represent convention drift worth
   correcting before it compounds.

## Source Inventory

- `app/src/screens/{CalendarScreen,CustomLabelsSection,DashboardScreen,SettingsPrimitives,SettingsScreen,StatsScreen}.tsx`
- `app/src/ui/{AnimatedFill,AnimatedPressable,TopicDonut,useReducedMotion,WheelPicker}.tsx`
- `app/src/theme/{theme,tokens,useTheme}.ts`, `app/App.tsx`
- `app/src/store/{useStore,useSettingsStore}.ts`
- `app/src/ble/{PhoneBoxClient,protocol}.ts` (cross-checked against `Box-code/lib/lock_config.py`,
  `lock_controller.py`, `lock_ble.py`, `lock_log.py`)
- `app/src/stats/{comparisons,customLabels,sessionHistory,stats,topics,trend}.ts`
- `app/src/sync/{firestoreSync,sessionMerge,sessionsSyncBridge,settingsSyncBridge}.ts`
- `app/src/auth/{firebase,firebaseConfig,googleAuth,secureStoreKeys,secureStorePersistence,useAuthStore,wipeStaleSessionOnFreshInstall}.ts`
- `app/src/storage/storage.ts`
- `docs/rfcs/google-signin-cross-device-sync-architecture.md` (design-intent cross-check)
