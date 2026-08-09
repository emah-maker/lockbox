# Feature: Firebase Auth (Google Sign-In) + Firestore Cross-Device Sync/Backup

> **Superseded** by `docs/rfcs/google-signin-cross-device-sync-architecture.md` (found after this doc
> was written — duplicate work from an earlier, since-interrupted run of the same delegation). That
> document is authoritative going forward; it made a different, deliberately-justified auth-library
> choice (native `@react-native-google-signin/google-signin` instead of this document's
> `expo-auth-session` PKCE flow) and adopted this document's "sync must subscribe to the stores from the
> outside, not write from inside their action bodies" correction (see this doc's own "Patterns
> incorrectly followed" section below). Kept for its migration/deletion-cascade and test-matrix detail,
> which remain useful background reading.

Issue: n/a (conversational-mode design task, no issue tracker for this repo folder)
Owner: architecture agent (for Mandy's review before implementation)

## Customer

Phone Box app users who use the app on more than one device, or who replace/reinstall their phone,
and buyers in the accountability/family segment who will eventually need an account to share data
with a partner (future tier, not built here).

## Customer Problem being solved

Today the app is **fully local-only by explicit prior design decision**: confirmed via
`app/package.json` — no `expo-auth-session`, `expo-secure-store`, `expo-web-browser`, or any
Firebase/Auth0 dependency exists. All state (focus session history, stats, theme/settings, the
box-settings mirror) lives only in `AsyncStorage` on one device via `app/src/storage/storage.ts`
(prefix `phonebox:`), written from `app/src/store/useStore.ts` and
`app/src/store/useSettingsStore.ts`. An uninstall, device loss, or phone upgrade loses everything,
and there is no way to see the same focus history on a second device. This design adds account
sign-in and cross-device sync/backup **without weakening the app's local-first, offline-capable
behavior**, and treats security as the top priority per explicit requirement.

## User Experience that will solve the problem

- Settings screen gains a new **Account** section: "Sign in with Google".
- Tap → system browser opens (`expo-web-browser`) → Google consent screen → redirects back into the
  app via an `expo-auth-session` PKCE flow. No password is ever handled by this app.
- **First sign-in on a device that already has local data:** the app detects existing
  `sessionHistory`/settings, uploads/merges them into the signed-in user's Firestore data, and shows
  a small non-blocking "backing up…" indicator — never a blocking modal.
- **Subsequent opens, same or another device:** on sign-in and on each app foreground while signed
  in, the app pulls the latest Firestore state and merges it into local storage/state.
- **Sign out:** local data is left in place (the app stays fully usable offline/signed-out); an
  explicit, separate "Sign out and remove local data" destructive action is offered for users who
  want that.
- **Delete account:** explicit destructive flow, requires re-authentication, deletes the user's
  Firestore documents and the Firebase Auth user; local on-device data is untouched unless the user
  also chose to clear it.
- No existing BLE/box behavior changes. This is an additive account/sync layer; the app remains
  fully usable with the box while signed out.

## Technical Details

### Architecture overview

```
Google OAuth (PKCE, expo-auth-session + expo-web-browser)
        │  id_token
        ▼
Firebase Auth (Google provider only) ── refresh token ──▶ expo-secure-store (iOS Keychain,
        │  ID token (short-lived, in-memory only)              device-only, no iCloud sync)
        ▼
Firestore  /users/{uid}/...   ◀── security rules: request.auth.uid == uid, always
        ▲
        │  additive push/pull, piggybacked on existing hydrate()/foreground/connect events
        │  (no new background transport competing with the BLE-first architecture)
        ▼
Existing local stores (unchanged): useStore.ts (sessionHistory via AsyncStorage),
useSettingsStore.ts (theme/accent/callAlerts/advancedStats/boxSettings mirror)
```

New modules, following the codebase's existing per-concern module convention
(`lock_servo.py`-style single-owner drivers on the firmware side; `useStore`/`useSettingsStore`
split on the app side):

- `app/src/auth/googleAuth.ts` — the `expo-auth-session` `AuthRequest`/PKCE flow against Google's
  discovery document.
- `app/src/auth/firebase.ts` — Firebase JS SDK (modular v10+) initialization. Recommended over
  `@react-native-firebase` for this feature: the app has no other native Firebase dependency, and
  the JS SDK avoids adding `GoogleService-Info.plist`/native config plumbing for an MVP that only
  needs Auth + Firestore (no push notifications, no Crashlytics).
- `app/src/auth/secureTokens.ts` — a `expo-secure-store`-backed custom Firebase `Persistence`
  implementation (see Token Storage below).
- `app/src/auth/useAuthStore.ts` — a zustand store mirroring the existing `useStore`/
  `useSettingsStore` shape/conventions; holds only non-secret derived identity state (uid,
  displayName, email, photoURL, signed-in boolean).
- `app/src/sync/firestoreSync.ts` — push/pull of sessions and settings.
- `app/src/sync/migration.ts` — the first-sync local→cloud merge (pure logic, unit-testable like
  `stats.ts`).

### OAuth / PKCE flow (detailed)

1. App builds an `AuthRequest` via `expo-auth-session`'s PKCE support (library generates
   `code_verifier`/`code_challenge`).
2. `promptAsync` opens Google's OAuth endpoint through `expo-web-browser`'s
   `openAuthSessionAsync`. Redirect URI uses the app's existing custom scheme (`app.json` already
   declares `"scheme": "phonebox"`), registered as an **iOS-type OAuth client** in Google Cloud
   Console against bundle ID `com.emahmaker.phonebox`.
3. Google returns an authorization code to the redirect URI. `expo-auth-session` exchanges it
   (with `code_verifier`) directly with Google's token endpoint — **no client secret is embedded in
   the app**, per Google's public-client/native-app OAuth guidance (PKCE is exactly what makes a
   secretless mobile client safe here).
4. App receives a Google `id_token`, builds `GoogleAuthProvider.credential(idToken)`, and calls
   Firebase `signInWithCredential`.
5. Firebase Auth verifies the Google `id_token` server-side against Google's public keys and mints
   its own Firebase ID token (JWT, ~1h) + refresh token for the user.
6. The Firebase SDK silently refreshes the ID token using the refresh token; only the refresh token
   needs durable, secure storage (step below).

### Token storage

- **Never persist the raw Google `id_token` or the Firebase refresh token in `AsyncStorage`/plain
  JSON.** Both are bearer credentials; `app/src/storage/storage.ts`'s unencrypted JSON wrapper is
  the wrong place for either, and must not be reused for auth state.
- The Firebase JS SDK's default React Native persistence, if wired to `AsyncStorage`, stores the
  refresh token in the clear. **This default is explicitly rejected.** Instead, implement a custom
  `Persistence` for the Firebase Auth SDK backed by `expo-secure-store`, which uses the iOS Keychain
  with `kSecAttrAccessibleWhenUnlockedThisDeviceOnly`.
- **Device-only, not iCloud-Keychain-synced, is a deliberate choice**: the refresh token is a
  long-lived bearer credential; scoping it to one device limits the blast radius of an iCloud
  account compromise or backup leak. Each device performs its own OAuth flow rather than trusting a
  secret that traveled through iCloud sync.
- The short-lived Firebase ID token lives in memory only (the zustand store / SDK internal state) —
  never persisted; it is re-derived from the refresh token on next launch.
- `useAuthStore` may mirror non-secret identity fields (uid, displayName, email, photoURL,
  signed-in boolean) into the existing `storage.ts` convention — these are not credentials and are
  fine to cache for a fast "welcome back" UI before the SDK finishes restoring the session.

### Data model (Firestore)

Per-user isolation via a top-level document keyed by the Firebase Auth `uid` — a value the client
never chooses and can never forge:

```
/users/{uid}                          (doc)
  displayName, email, photoURL, createdAt, lastSyncedAt

/users/{uid}/sessions/{sessionId}     (subcollection)
  startedAt, plannedS, actualS, outcome, topic?, deviceId, updatedAt
  -- sessionId = deterministic hash(startedAt, deviceId) so re-uploading/retrying is idempotent
     and never creates duplicates, without relying on server-generated IDs

/users/{uid}/settings/preferences     (singleton doc)
  themeMode, accent, callAlertsEnabled, advancedStatsEnabled, updatedAt

/users/{uid}/settings/boxMirror       (singleton doc)
  ovr, auto, sleep, bright, unlk, ucal, thm, acc, updatedAt
  -- mirrors useSettingsStore.boxSettings; last-write-wins by updatedAt; NEVER authoritative —
     the physical box's own NVM always wins on the next BLE read (existing afterConnected()
     reconciliation in useStore.ts is unchanged by this design)

-- Reserved extension point, not built by this design (tracked separately as the greenlist/
   per-contact workstream in the same parent objective):
/users/{uid}/greenlist/{contactId}
```

Design choices:

- **Nesting everything under `/users/{uid}/...`**, rather than top-level collections carrying a
  `uid` field, lets every Firestore security rule authorize on the path segment
  (`request.auth.uid == uid`) instead of a per-document field check — one invariant, no risk of a
  new document type forgetting an ownership check.
- **Sessions as a subcollection, not an array field on the user doc.** `sessionHistory.ts` already
  caps local history at `MAX_RECORDS = 2000`; a Firestore document has a 1 MiB limit, and an
  array-of-2000-objects field would force a full-document rewrite on every single new session.
  A subcollection lets sync push only the new/changed session docs.
- **Two settings singletons, not one.** Splitting `preferences` (freely user-editable) from
  `boxMirror` (should only ever change via the app's BLE-reconciled write path) documents the trust
  boundary even though Firestore itself cannot distinguish "this write came from the Settings
  screen" vs "this write came from BLE code" — both arrive from the same authenticated client. This
  is called out explicitly rather than silently assumed.

### Firestore security rules (per-user isolation, least privilege)

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /users/{uid} {
      allow read, update: if request.auth != null && request.auth.uid == uid;
      allow create: if request.auth != null && request.auth.uid == uid
                    && request.resource.data.keys().hasOnly(
                         ['displayName', 'email', 'photoURL', 'createdAt', 'lastSyncedAt']);
      allow delete: if false; // account deletion goes through the app's explicit re-auth +
                               // cascade-delete flow (see Migration/Deletion), not a bare client delete

      match /sessions/{sessionId} {
        allow read, create: if request.auth != null && request.auth.uid == uid;
        allow update, delete: if false; // append-only / idempotent-upsert-by-create only —
                                          // no client-side edit or delete of session history,
                                          // even by the owning user, so a stolen client token
                                          // cannot rewrite a streak retroactively
      }

      match /settings/{docId} {
        allow read, write: if request.auth != null && request.auth.uid == uid
                            && docId in ['preferences', 'boxMirror'];
      }

      match /greenlist/{contactId} {
        // Reserved for the separate greenlist workstream; isolated under the same uid invariant
        // now so that future feature does not need a new top-level rule block.
        allow read, write: if request.auth != null && request.auth.uid == uid;
      }
    }
  }
}
```

Notes:

- Every branch re-derives authorization from `request.auth.uid == uid` on the path — never from a
  client-supplied field (email, displayName) that an attacker could set to any value.
- The `sessions` rule intentionally allows `create` but not `update`/`delete`: Firestore rules
  cannot express "insert-only" as a single `write` grant, so create/update/delete are split
  explicitly. This makes the session log tamper-resistant against a compromised or stolen client
  token: the attacker could still inject fabricated new sessions, but could not retroactively edit
  or erase real history.
- No Firebase Admin SDK, service-account key, or backend server is introduced by this design — every
  read/write is client-to-Firestore, authorized entirely by these rules plus Firebase Auth. This
  minimizes the infrastructure surface that needs protecting, at the cost of one honest limitation
  (account-deletion cascade, below) that a bare set of declarative rules can't fully solve alone.

### Least-privilege service configuration

- Enable **only the Google sign-in provider** in the Firebase project — no email/password, no
  anonymous auth. This matches the explicit ask and removes an entire class of attack surface
  (password reset, credential stuffing, email verification bypass) that this app will never need.
- Google Cloud OAuth consent screen: request only the default `openid email profile` scopes. No
  Drive/Contacts/Calendar or any other scope is needed for this feature and none should be
  requested.
- The Firebase Web `apiKey` embedded in the app config **is not a secret** — it identifies the
  Firebase project, it does not authorize access. Real authorization is Firestore rules + Firebase
  Auth. This is written down explicitly so a later security-review pass does not mistakenly flag
  "the API key is exposed in the bundle" as a vulnerability — it is expected and Firebase's own
  documented model.
- **Recommend Firebase App Check (App Attest provider on iOS)** before any wide release, to reject
  Firestore/Auth requests that don't originate from a genuine build of this app, independent of
  whether the request carries a valid user token. This needs an Apple Developer App Attest
  capability plus Firebase project configuration; it is not required for a small-scale MVP but
  should not be skipped indefinitely once the app has real users. Tracked as a Risk below, not
  built by this design.

### AsyncStorage → Firestore migration plan

Trigger: the first successful sign-in on any device, checked against whether local data already
exists (`sessionHistory.loadSessions().length > 0`, or any `useSettingsStore` key already present).

1. On sign-in success, before enabling live sync, read the local `sessionHistory` and
   `useSettingsStore` slices already in memory (zustand).
2. Read `/users/{uid}`'s `lastSyncedAt`.
   - **Absent (brand-new account):** one-way upload — batch-write local sessions to
     `/users/{uid}/sessions/*` (chunked to respect Firestore's 500-operation batch limit) and local
     settings to the two settings docs; set `lastSyncedAt = now`.
   - **Present (this device is signing into an account already synced from another device, and
     also has its own pre-existing local-only sessions from before sign-in):** **merge, never
     overwrite** — union session sets by the deterministic `sessionId` (so re-running migration is
     idempotent and cannot duplicate), and for conflicting settings fields take whichever side has
     the newer `updatedAt`.
3. **Local `AsyncStorage` data is never deleted by migration.** It remains the device's offline
   cache and the store that BLE-derived writes continue to hit exactly as today
   (`appendSessions`/`setJSON` are unchanged) — Firestore sync is an additive mirror, not a
   replacement store, so the app keeps working fully offline while signed in.
4. After first migration, sync is incremental: each new locally-appended session or settings change
   also gets a best-effort Firestore write alongside the existing local write; failures are
   silently retried on next app foreground rather than surfaced as a blocking error — this mirrors
   the codebase's existing "best-effort" pattern already used by `pushBoxSettings`/`setJSON`.
5. Pull direction: on sign-in and on each app foreground while signed in, pull
   `/users/{uid}/settings/*` and any session docs newer than the latest locally-known `updatedAt`,
   then merge into local `AsyncStorage`/zustand state using the same union/last-write-wins rules as
   step 2.
6. Account deletion must explicitly delete the `sessions` and `settings` subcollections before
   deleting the parent `/users/{uid}` doc — Firestore does not cascade-delete subcollections
   automatically. This either needs a client-side "delete each doc" loop (works, but is not
   atomic and could be interrupted) or a small Cloud Function trigered on user-doc delete (adds a
   sliver of backend, contradicting the "no backend" design goal, but is the reliable option). This
   tradeoff is flagged as an open decision for Mandy in Risks, not resolved unilaterally here.

### Touched surfaces (files)

- New: `app/src/auth/{googleAuth.ts, firebase.ts, useAuthStore.ts, secureTokens.ts}`
- New: `app/src/sync/{firestoreSync.ts, migration.ts}`
- New: `firestore.rules`, `firestore.indexes.json`, `firebase.json` (CLI-managed rules deploy)
- Modified: `app/package.json` — add `firebase`, `expo-auth-session`, `expo-web-browser`,
  `expo-secure-store`
- Modified: `app/app.json` — register the Google OAuth redirect against the existing
  `scheme: "phonebox"`; no other native config needed if the pure JS Firebase SDK path is used
- Modified: `app/src/store/useStore.ts`, `app/src/store/useSettingsStore.ts` — add sync hooks
  alongside existing local writes (additive; does not restructure the existing BLE/local-store
  logic)
- Modified: Settings screen UI — new Account section (sign in/out, delete account)

### Failure modes & timeouts

- No network at sign-in time: the `expo-web-browser` flow fails gracefully; show retry. There is no
  partial/inconsistent Firebase Auth state possible — the Google→Firebase exchange either fully
  completes or doesn't start.
- Firestore write fails mid-migration (e.g. app killed): safe to fully retry, because `sessionId` is
  deterministic and migration re-checks `lastSyncedAt`/re-unions rather than assuming a clean slate.
- Firebase refresh token revoked or expired: the SDK signs the user out locally; the app falls back
  to signed-out/local-only mode with **no local data loss** — nothing local is ever deleted by
  sign-out.
- Firestore offline/quota: the Firebase SDK has built-in offline persistence and write-queueing.
  Whether to rely on that native queue versus the app's own foreground-triggered retry is an open
  design question (see Risks) that should be resolved as one mechanism, not both, before
  implementation.

### Telemetry & analytics

- No new telemetry/analytics backend is introduced by this design. Local-only debug logging of sync
  outcome counts (success/fail counters) is fine for support purposes; session content, tokens, and
  any PII must never be written to a console log or crash reporter.

## Confidence Level

70/100. The Google-via-`expo-auth-session`-into-Firebase pattern and the Firestore per-uid rules
pattern are both well-documented and low-risk in isolation. The two open items that keep this from
being higher are (a) whether `expo-auth-session`'s redirect handling behaves identically in an EAS
standalone build versus Expo Go (Expo Go cannot use a custom URL scheme for this flow, so this must
be verified on an actual dev-client build), and (b) the Firestore-native-offline-queue-vs-custom-
retry choice flagged in Risks — neither is resolvable from a design doc alone; both need a running
build.

## Validation Plan

| User Scenario | Expected outcome | Validation method |
|---|---|---|
| Sign in with Google (fresh device, no local data) | Firebase user created; empty Firestore doc tree created | Manual: sign in, inspect Firebase console for new `/users/{uid}` |
| Sign in with Google (device with existing local sessions) | Local sessions uploaded to Firestore, none duplicated, `lastSyncedAt` set | Manual: seed local sessions, sign in, compare Firestore count to local count |
| Sign in on a second device | Settings + sessions from device A appear on device B after pull | Manual: sign in with the same account on two devices/simulators |
| Sign out | Local data untouched; Firestore data untouched; app fully usable offline | Manual: sign out, confirm sessions/settings still render |
| Revoke Google access (myaccount.google.com) | Next token refresh fails; app falls back to signed-out state without crashing or losing local data | Manual: revoke access, relaunch app |
| Read another user's Firestore doc with a mismatched uid token | Denied | Firebase Rules Playground / REST call with a mismatched uid |
| Directly edit or delete a session doc | Denied (insert-only) | Firebase Rules Playground |
| Delete account | Firestore doc tree + Firebase Auth user deleted; local data untouched unless user also opted to clear it | Manual: delete account, confirm Firebase console shows no doc/user |

## Test Matrix

- **Unit** (no RN/Firebase deps, mock the SDK boundary): `migration.ts`'s merge/dedup logic
  (session union by deterministic id, settings last-write-wins by `updatedAt`) — pure functions,
  testable the same way `stats.ts`/`comparisons.ts` already are under plain Jest.
- **Integration** (Firebase Local Emulator Suite, mocking only the real Google OAuth call): run the
  Auth + Firestore emulators, exercise a stubbed sign-in → migration → sync round-trip against the
  actual `firestore.rules` file, so security-rule regressions are caught in CI without touching
  real Google/Firebase infrastructure.
- **E2E** (1, real services, manual/on-device — no host-automatable real Google OAuth exists in
  CI): full sign-in with a real test Google account against a non-production Firebase project,
  confirm data appears correctly in the Firebase console.

## Risks & Mitigations

| Risk | Sev | Mitigation |
|---|---|---|
| Refresh token stored insecurely (Firebase's default RN persistence writes to plain AsyncStorage) | High | Custom `Persistence` backed by `expo-secure-store`/Keychain, `WhenUnlockedThisDeviceOnly`, as specified above — not left as an unexamined default |
| Firestore rules misconfigured, allowing cross-user read/write | High | Every rule branch keyed off `request.auth.uid == uid` on the path segment, never a field; validated with Rules Playground + emulator integration tests before any deploy |
| `expo-auth-session` redirect scheme behaves differently in an EAS standalone build vs. Expo Go | Med | Pre-implementation spike (see Next Steps): exercise the full redirect round-trip on a real dev-client build once, before writing the app auth module |
| Migration double-uploads or loses sessions on retry/crash mid-batch | Med | Deterministic idempotent `sessionId`; migration is safe to re-run in full at any point |
| Firestore's built-in offline write queue overlaps/conflicts with the app's own foreground-retry sync | Med | Open decision — recommend relying on the Firestore SDK's native offline persistence/listeners rather than hand-rolling a second retry system, resolved before implementation begins |
| Broader-than-needed Google OAuth scopes requested | Low | Explicitly restricted to `openid email profile` in this design |
| No App Check yet → a leaked Firebase config could be used by a non-app client to hit open Firestore rules | Med | Recommend Firebase App Check (App Attest) before wide release; acceptable to defer for a small MVP audience, not indefinitely |
| Account deletion doesn't cascade to subcollections (Firestore has no auto-cascade-delete) | Med | Decide between a client-side delete loop (simple, non-atomic) or a small Cloud Function trigger (reliable, adds a sliver of backend) — flagged for Mandy's decision, not resolved unilaterally |

## Spike Findings (if applicable)

No spike was run in this design phase. Per `rules/spike-first-development.md`, a spike exists to
validate unfamiliar-technology risk before building; every technology here (Google OAuth+PKCE via
`expo-auth-session`, Firebase Auth's `signInWithCredential`, Firestore security rules) is
well-documented and was already specified by name in the manager's brief — there is no unfamiliar
integration to de-risk from a design doc alone, and no Firebase project or EAS build exists yet in
this repo to spike against.

**Recommended pre-implementation spike** (before writing the auth/sync modules): stand up a
throwaway Firebase project, build a minimal Expo dev client with `expo-auth-session` +
`expo-web-browser`, and confirm one full Google→Firebase sign-in round-trip completes on a real
iOS device/simulator using this app's actual bundle ID (`com.emahmaker.phonebox`) and custom scheme
(`phonebox`). This resolves the EAS-build-vs-Expo-Go redirect-handling uncertainty called out above
before real implementation time is spent.

**Help needed:** a Firebase project (or permission to create one under the account this ships
under) and a Google Cloud OAuth client registration are required before that spike or any
implementation can start — neither currently exists in this repo.

## Architecture Analysis

This app has no standalone architecture document. The de-facto architecture record is (a)
`fraim/personalized-employee/context/project_context.md` / `project_rules.md` (firmware-focused,
silent on the app), and (b) the prior RFC `docs/rfcs/companion-app-development-approach-technical-
design.md`, which made an explicit architecture decision this design directly revisits: **"B1
(BLE-first, no internet) for the MVP... defer any Wi-Fi/cloud backend until the accountability/
subscription tier is actually validated — it is the only part that carries permanent cost and
privacy liability."** The rest of this analysis is checked against those two sources plus the
actual code in `app/src/store/`, `app/src/storage/`, `app/src/stats/`.

**Patterns correctly followed**
- **`storage.ts` as the single AsyncStorage entry point** — this design keeps all *non-secret*
  identity fields (`useAuthStore`'s uid/displayName/email/photoURL) going through the existing
  `getJSON`/`setJSON` wrapper rather than introducing a second ad hoc persistence path.
- **Per-concern store split** (`useStore` = BLE/device, `useSettingsStore` = local preferences) —
  the new `useAuthStore` follows the same one-zustand-store-per-concern shape rather than bolting
  auth state onto an existing store.
- **Per-concern `src/` subfolder convention** (`ble/`, `calls/`, `stats/`, `store/`, `storage/`,
  `theme/`) — the new `auth/` and `sync/` folders match this existing layout.
- **"Best-effort, never blocking" write pattern** — `pushBoxSettings`/`setJSON` already fail
  silently and let the next reconciliation catch up; this design's incremental Firestore push/pull
  explicitly reuses that same failure philosophy rather than inventing a new one.

**Patterns missing from architecture (design introduces; needs a doc decision)**
- **Cloud backend / accounts at all.** No architecture document currently allows for one — the only
  existing record on this question (the prior RFC's B1/B3 decision) says the *opposite*: defer
  cloud/accounts until the subscription tier is validated. This design does not wait for that
  validation; it was requested directly by the manager as part of the current parent objective.
  **This needs an explicit decision recorded in `project_context.md`** (or a superseding note in
  the companion-app RFC) that cloud sync is now an adopted feature, not a deferred one, and why —
  otherwise the next agent to read `project_context.md` will see a stale "local-only by design"
  statement that contradicts shipped code.
  - Note: `project_context.md` is separately visibly stale (states "not a git repository... no
    remote, issue tracker" — untrue; `fraim_connect` resolved a real GitHub remote for this repo).
    Flagging this so it is corrected in the same pass rather than compounding staleness.
- **Secure-credential storage.** No precedent exists anywhere in the app for a Keychain-backed
  secret; `storage.ts`'s AsyncStorage wrapper is the only persistence pattern on record, and it is
  explicitly wrong for this use case (see Token Storage above). `expo-secure-store` usage needs to
  be recorded as a new, deliberate exception to "everything goes through `storage.ts`" — not a
  silent one-off.
- **A sync/merge layer and its conflict-resolution rule** (idempotent id, last-write-wins by
  `updatedAt`) is new; nothing in the current architecture anticipates two writers (device A, device
  B) for the same logical data.
- **Firestore data model and security rules** are obviously new; there is no prior cloud schema to
  compare against.

**Patterns incorrectly followed (design error — needs correction before implementation)**
- **This design's "Touched surfaces" section says sync hooks are added inside `useStore.ts`'s and
  `useSettingsStore.ts`'s existing action bodies** (e.g. inside `setThemeMode`, `pushBoxSettings`).
  That contradicts the architecture as documented in those files' own header comments: `useStore.ts`
  states it is "the only thing that actually talks to the box over BLE," and `useSettingsStore.ts`
  states it holds "pure local preferences." Reaching into either store's action bodies to add a
  network side-effect (a Firestore write) blurs both documented boundaries and makes every future
  reader re-verify that "pure local preferences" is still true.
  - **Suggested resolution:** `firestoreSync.ts` should subscribe to both stores from the outside
    (zustand's `store.subscribe()`) and react to state changes, rather than either store importing
    or calling into `sync/`. This keeps `useStore`/`useSettingsStore` exactly as documented today —
    ignorant of the network — while `sync/` becomes the one place that knows about both local state
    *and* Firestore. This correction should be applied to the design during `address-feedback` once
    Mandy has seen this flag, not silently patched now.

## Observability (logs, metrics, alerts)

- Firebase Console's own Authentication and Firestore usage dashboards (sign-in counts, read/write
  volume, rules-denial counts) cover baseline observability for MVP with no additional
  instrumentation.
- No client-side crash/analytics SDK is introduced by this design. If one is added later, token
  values, email content beyond the account owner's own address (already visible to them), and
  session `topic` strings must be explicitly excluded from any breadcrumb/log payload.
