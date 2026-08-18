# Phone Box Companion App — Google Sign-In & Cross-Device Sync Architecture

> **Note:** an independently-produced design for this same feature already existed at
> `docs/rfcs/firebase-auth-sync-technical-design.md` (found after this doc was written — duplicate work
> from an earlier, since-interrupted run of the same delegation). This document remains authoritative
> for the auth-library choice (native `@react-native-google-signin/google-signin` over that document's
> `expo-auth-session` PKCE flow — reduces hand-rolled security-critical code) and the token-storage
> adapter. One correction adopted from the other document: sync logic must subscribe to `useStore`/
> `useSettingsStore` from the outside (`store.subscribe()`), never add Firestore writes inside their
> existing action bodies — that document caught this boundary violation risk and this one didn't
> originally call it out explicitly.

**Date:** 2026-08-09
**Type:** RFC / technical design (pre-implementation)
**Prepared for:** Phone Box companion app (`app/`, React Native + Expo dev client)
**Upstream context:** `docs/rfcs/companion-app-development-approach-technical-design.md` established the
app as **BLE-first, offline, local**, and explicitly **deferred any Wi-Fi/cloud backend** (its "B3"
tier) until an accountability/subscription feature justified the permanent backend, accounts, and
privacy surface it carries — and it already named `expo-secure-store` as the tool "if the B3 backend
ever ships." **This document is that decision being exercised**: it designs Google Sign-In + Firestore
sync/backup as an *additive* layer on top of the existing local-first app, not a replacement for it.

---

## Executive summary — the recommendation

Add **Firebase Authentication (Google provider) + Firestore** as an optional account layer:

1. **Auth library: `@react-native-google-signin/google-signin`**, not a hand-rolled
   `expo-auth-session` PKCE flow. The app is already a **bare/dev-client build** (required by
   `react-native-ble-plx`; it cannot run in Expo Go), so there is no cost to requiring a native
   module here — and a native module wrapping Google's own iOS/Android SDKs is a smaller, better-audited
   attack surface than reimplementing PKCE/state/nonce handling by hand. §1 covers the
   `expo-auth-session` + `expo-web-browser` fallback for the hypothetical case a web or Expo-Go build
   is ever needed.
2. **Token storage: `expo-secure-store` only, never AsyncStorage.** This rules out the plain
   **`firebase` (modular JS SDK)** used out of the box, whose default React Native persistence writes
   through AsyncStorage — and it rules out `@react-native-firebase` (the native wrapper), which persists
   sessions invisibly inside the native Firebase SDK with no app-level storage call to point
   `expo-secure-store` at. The design in §2 uses the **modular `firebase` JS SDK with a custom
   `Persistence` adapter backed by `expo-secure-store`**, so every byte of session state that touches
   disk goes through one explicit, auditable, Keychain/Keystore-backed call.
3. **Firestore: strict per-user isolation, deny-by-default, append-only session history.** §3 gives the
   schema and the actual rules file. A user's `request.auth.uid` must match the document path for every
   read/write; anything else — including any unauthenticated request — is denied by a catch-all rule.
   Session records are `create`-only (no `update`/`delete`) since they are immutable historical events.
4. **Migration: additive union for sessions, last-write-wins for settings.** §4 justifies treating
   session history and app settings differently: sessions are append-only events (union/dedupe is
   lossless and correct), settings are a single current-state document (last edit should simply win).
5. **UI/UX: optional, Settings-tab entry point — not a gate.** Per the app's existing local-first
   design (and its own explicit "additive, not required" precedent for secrets), signing in must never
   be required to use the box. §6 places it in the Settings tab, alongside the existing preferences.

**Top priority, restated:** security of the sign-in flow is the explicit priority here, ahead of sync
feature completeness. Every design choice above is driven by minimizing what touches disk unencrypted,
minimizing custom cryptographic code, and making the Firestore rules impossible to accidentally leave
open.

---

## 1. Auth flow

### 1.1 Library choice: native Google Sign-In vs. hand-rolled PKCE

| Option | How it works | Security posture | Verdict |
|---|---|---|---|
| **`@react-native-google-signin/google-signin`** (chosen) | Wraps Google's own native SDKs (`GoogleSignIn-iOS`, Google Play Services Auth on Android). App calls `GoogleSignin.signIn()`; the native SDK shows Google's native account picker/consent UI, handles PKCE/nonce/state internally, and returns an `idToken`. | Handles the security-sensitive parts (PKCE, state, nonce, redirect validation) inside Google's own maintained native code, not app JS. No custom crypto to review. Supports silent re-sign-in via the OS-level Google account cache. | **Chosen** — smaller, better-audited attack surface; zero added cost since the app is already dev-client-only. |
| `expo-auth-session` + `expo-web-browser` (PKCE against Google's OAuth endpoint) | App generates its own `code_verifier`/`code_challenge`, opens Google's `/o/oauth2/v2/auth` endpoint via `expo-web-browser`'s `openAuthSessionAsync` (backed by `ASWebAuthenticationSession`/Chrome Custom Tabs — an external, isolated user agent, not an embedded WebView), receives the redirect on the `phonebox://` custom scheme, then exchanges the code for tokens with a direct `fetch` to Google's token endpoint. | Workable and Google-policy-compliant (external user agent, not a WebView), but every step — verifier storage during the flow, redirect validation, token-endpoint exchange, error handling — is app code we write and must get right. More custom security-relevant code than option 1 for identical end state. | Works, but only adopt if a native module is genuinely unavailable (see §1.2). |
| Firebase's `expo-firebase-auth` popup/redirect web flow | Browser-only; not applicable to a native RN app. | — | Not applicable. |

**Decision: `@react-native-google-signin/google-signin` for both iOS and Android**, since:
- The app already requires `expo-dev-client` / `expo prebuild` / `expo run:ios` (see `app/package.json`
  scripts) because of `react-native-ble-plx` — it is **not** Expo-Go-compatible today. Adding another
  native module changes nothing about the build model.
- Fewer hand-written security-critical lines directly serves the "super secure" requirement.
- It is what Firebase's own React Native documentation recommends pairing with
  `GoogleAuthProvider.credential(idToken)`.

### 1.2 Flow (native path, both platforms)

```
Settings tab                 Native module                Google              Firebase
┌────────────────┐          ┌──────────────────┐         ┌────────┐          ┌─────────┐
│ "Sign in with   │          │ GoogleSignin      │         │ Google  │          │ Firebase│
│  Google" button │─signIn()▶│  .signIn()        │────────▶│ account │          │  Auth   │
└────────────────┘          │ (native UI: OS     │◀────────│ picker  │          └─────────┘
                             │  account picker)   │ idToken │ + consent          ▲
                             └──────────────────┘         └────────┘          │
                                       │ idToken                               │
                                       ▼                                       │
                          GoogleAuthProvider.credential(idToken)               │
                                       │                                       │
                                       └───────── signInWithCredential ────────┘
                                                          │
                                                          ▼
                                          Firebase session established;
                                          our SecureStore persistence
                                          adapter (§2) persists it.
```

1. User taps **Sign in with Google** in Settings (§6).
2. `GoogleSignin.signIn()` shows the native account picker; no browser, no custom scheme redirect.
3. Result contains a Google **ID token** (and optionally an access token, unused here — we never need
   Google API scopes beyond identity).
4. The app immediately converts it: `const credential = GoogleAuthProvider.credential(idToken)` then
   `await signInWithCredential(auth, credential)`. The raw Google ID token is **not stored**; it is used
   once, synchronously, and discarded. Firebase issues and manages its own session from here.
5. Firebase's `onAuthStateChanged`/`onIdTokenChanged` fires; the custom persistence adapter (§2) writes
   the session state to `expo-secure-store`.
6. The app reads `auth.currentUser.uid` and begins the migration/sync flow (§4).

### 1.3 Fallback: web / Expo-Go path (only if ever needed)

Given the app's BLE dependency already rules out Expo Go, this is documented for completeness, not as
a near-term plan:

- Swap the sign-in call for `expo-auth-session`'s `useAuthRequest` (Google provider helper) +
  `expo-web-browser`, using PKCE (`usePKCE: true`, no client secret — Google's "iOS"/"Android" OAuth
  client types issue none).
- Redirect URI uses the app's existing `scheme: "phonebox"` (already declared in `app/app.json`) — e.g.
  `phonebox://oauth2redirect`. **This scheme must be registered as an authorized redirect URI in the
  Google Cloud Console OAuth client**, and nowhere else.
- Everything downstream (§1.2 step 4 onward) is identical — exchange ends in an ID token, which still
  goes through `GoogleAuthProvider.credential`.
- **Storage caveat:** the web build has no Keychain/Keystore and no `expo-secure-store` backing —
  `SecureStore` throws on web. A web build would need its own persistence design (e.g. an in-memory-only
  session with no persisted refresh token, forcing re-sign-in per tab) — call this out explicitly as an
  open gap rather than silently degrading to `localStorage`/`AsyncStorage`, which would violate the
  "never plaintext" requirement.

---

## 2. Token storage

### 2.1 Why the obvious Firebase setups don't satisfy the requirement

| Approach | Where the session actually lives | Problem |
|---|---|---|
| `firebase` JS SDK, default RN persistence (`getReactNativePersistence(AsyncStorage)`) | AsyncStorage (unencrypted JSON, same mechanism as `app/src/storage/storage.ts`) | Directly violates "never AsyncStorage." |
| `@react-native-firebase/auth` (native wrapper) | Inside the native Firebase iOS/Android SDK's own storage (Keychain/Keystore-backed, but **opaque** — no app-level call to point at `expo-secure-store`) | Secure, but makes the explicit `expo-secure-store` requirement moot; no auditable single choke point in *our* code. |
| **`firebase` JS SDK + custom `Persistence` adapter over `expo-secure-store`** (chosen) | `expo-secure-store` → iOS Keychain / Android Keystore-backed encrypted storage, via one function we write and can audit | Satisfies the explicit requirement; every write/read is one small, reviewable adapter. |

### 2.2 The adapter

Firebase's modular Auth SDK accepts any object implementing its `Persistence` interface
(`_isAvailable`, `_set`, `_get`, `_remove`, plus listener no-ops for single-tab apps). Design:

```ts
// app/src/auth/secureStorePersistence.ts
import * as SecureStore from 'expo-secure-store';
import type { Persistence } from 'firebase/auth';

const OPTS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY, // never exported to iCloud Keychain backups
};

export const secureStorePersistence: Persistence = {
  type: 'LOCAL',
  async _isAvailable() {
    try {
      await SecureStore.setItemAsync('__probe', '1', OPTS);
      await SecureStore.deleteItemAsync('__probe', OPTS);
      return true;
    } catch {
      return false;
    }
  },
  _set: (key, value) => SecureStore.setItemAsync(key, value, OPTS),
  _get: (key) => SecureStore.getItemAsync(key, OPTS),
  _remove: (key) => SecureStore.deleteItemAsync(key, OPTS),
  _addListener: () => {}, // single-tab RN app: no cross-tab sync needed
  _removeListener: () => {},
};
```

`initializeAuth(app, { persistence: secureStorePersistence })` replaces the default. Every Firebase
session field Firebase itself decides to persist (refresh token, uid, claims) now flows through this
adapter and nowhere else.

**Known constraint to verify during implementation:** iOS Keychain items have historically had a
practical per-item size ceiling well above what Firebase's persisted user record needs (typically well
under 2 KB), but this should be confirmed on-device with a real signed-in user record before shipping;
if Firebase ever needs to persist something unexpectedly large, split across multiple `SecureStore` keys
rather than loosening the storage mechanism.

### 2.3 Token refresh

- Firebase's ID token (JWT, ~1 hour lifetime) is refreshed automatically by the Auth SDK using the
  refresh token it retrieves through `secureStorePersistence._get`; the Firestore SDK calls
  `getIdToken()` internally before each request and never needs app code to manage this.
- The Google-side ID token from `GoogleSignin.signIn()` is **not** kept around for refresh — it was a
  one-time bridge into Firebase. If Firebase's refresh token itself is ever rejected (revoked, expired
  from long inactivity), the app calls `GoogleSignin.signInSilently()` first (uses the native SDK's own
  OS-level cached Google session, no user interaction) to mint a fresh Google ID token and re-run
  `signInWithCredential`; only if that fails does the user see the sign-in button again.

### 2.4 Logout — secure wipe

```ts
async function signOut() {
  await auth.signOut();                 // Firebase: clears its in-memory user + fires _remove on our adapter
  await GoogleSignin.revokeAccess();    // revoke the OAuth grant at Google, not just the local session
  await GoogleSignin.signOut();         // clear the native module's own cached account
  // Defense-in-depth: explicitly delete every key we know Firebase Auth may have written,
  // rather than trusting the SDK's own cleanup alone.
  for (const key of FIREBASE_AUTH_SECURE_STORE_KEYS) {
    await SecureStore.deleteItemAsync(key, OPTS).catch(() => {});
  }
}
```

`revokeAccess()` (not just `signOut()`) matters: it invalidates the OAuth grant at Google, so a leaked
refresh token elsewhere can't be replayed against Google either.

### 2.5 Reinstall behavior — the Keychain-survives-uninstall trap

iOS Keychain entries are **not** guaranteed to be cleared when an app is deleted (this is a well-known
platform quirk, independent of `keychainAccessible` choice) — a fresh install can silently resume a
previous install's signed-in session, which is surprising and a real "why am I still logged in as
someone else" bug/security concern on shared or resold devices.

**Mitigation — an install marker in AsyncStorage (not SecureStore):**

```ts
// app/src/auth/wipeStaleSessionOnFreshInstall.ts
const MARKER_KEY = 'phonebox:hasRunBefore';

export async function wipeStaleSessionOnFreshInstall() {
  const hasRunBefore = await getJSON<boolean>(MARKER_KEY, false); // storage.ts (AsyncStorage)
  if (!hasRunBefore) {
    // AsyncStorage IS cleared on uninstall (app sandbox), unlike Keychain — so its absence here
    // is a reliable "this is a fresh install" signal. Proactively wipe any Keychain-resident
    // auth state left over from a previous install before Firebase Auth even initializes.
    for (const key of FIREBASE_AUTH_SECURE_STORE_KEYS) {
      await SecureStore.deleteItemAsync(key, OPTS).catch(() => {});
    }
    await setJSON(MARKER_KEY, true);
  }
}
```

Call this once, before `initializeAuth`, at app start (`App.tsx`'s existing `init()` effect is the
natural place). Net effect: a fresh install always starts signed out, regardless of what iOS left in the
Keychain from a prior install.

---

## 3. Firestore data model and security rules

### 3.1 Schema

Maps the existing local shapes (`LoggedSession` in `app/src/stats/sessionHistory.ts`, the settings
fields in `app/src/store/useSettingsStore.ts`) onto per-user Firestore paths:

```
users/{uid}                                  (doc)
  email, displayName, photoURL: string
  createdAt, updatedAt: timestamp

users/{uid}/sessions/{sessionId}             (subcollection, append-only)
  startedAt: int (epoch ms)
  plannedS:  int
  actualS:   int
  outcome:   'completed' | 'overridden'
  topic?:    string
  # sessionId = `${deviceId}_${startedAt}_${actualS}` — deterministic, so re-uploading
  # the same locally-known session is an idempotent no-op, never a duplicate.

users/{uid}/settings/app                     (doc, mutable, last-write-wins)
  themeMode: 'light' | 'dark'
  accent: string
  callAlertsEnabled: boolean
  advancedStatsEnabled: boolean
  customLabels: { id: string, name: string, color: string }[]  # user-managed focus labels, added 2026-08-10
  updatedAt: timestamp

users/{uid}/devices/{deviceId}               (doc per physical box paired to this account)
  lastKnownSettings: { ovr, auto, sleep, bright, unlk, ucal, thm, acc }  # cache/backup only
  lastSeenAt: timestamp
```

**Deliberate scoping decision — `boxSettings` (the BLE settings mirror) is *not* the account's source
of truth.** It is per-physical-box hardware config (`ovr`/`auto`/`sleep`/`bright`/`unlk`/`ucal`/`thm`/
`acc`, mirroring `lock_settings.py`'s NVM), not a user preference — a second box would have its own.
`users/{uid}/devices/{deviceId}` stores it only as a **cache/backup** (so a new phone can show a
plausible value before it ever connects), while the box's own `readSettings()` response on connect
remains authoritative, exactly as `useStore.ts`'s `afterConnected()` already reconciles today. The
truly cross-device, account-level preferences are the fields in `settings/app`.

**Session `topic` is create-only, like the rest of the session doc.** Retagging a past session
(Calendar day-list) only ever edits the local copy (`sessionHistory.ts`'s `retagSession`) — it is
never pushed as a Firestore update, since `allow update: if false` forbids that for every client,
including the owner (§3.2's integrity property). `syncSessions`'s merge therefore prefers the
*local* `topic` over a same-id remote doc's (`sync/sessionMerge.ts`'s
`mergeSessionsPreferLocalTopic`) so a retag at least survives repeated local syncs, but a retag
made on one device does not appear on a second device signed into the same account. Closing that
gap would need a mutable side-channel for `topic` (e.g. a separate per-session-id map that isn't
subject to the create-only rule) and is deferred, not solved, by this design.

### 3.2 Security rules

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {

    function isSignedIn() {
      return request.auth != null;
    }

    function isOwner(uid) {
      return isSignedIn() && request.auth.uid == uid;
    }

    match /users/{uid} {
      allow read, update: if isOwner(uid);
      allow create: if isOwner(uid)
                    && request.resource.data.keys().hasOnly(['email', 'displayName', 'photoURL', 'createdAt', 'updatedAt'])
                    && request.resource.data.createdAt == request.time;
      allow delete: if isOwner(uid); // part of the account-deletion path, §5

      match /sessions/{sessionId} {
        allow read: if isOwner(uid);
        // Create-only: session history is an immutable, append-only event log.
        allow create: if isOwner(uid)
                      && request.resource.data.keys().hasOnly(['startedAt', 'plannedS', 'actualS', 'outcome', 'topic'])
                      && request.resource.data.outcome in ['completed', 'overridden']
                      && request.resource.data.startedAt is int
                      && request.resource.data.plannedS is int
                      && request.resource.data.actualS is int;
        allow update, delete: if false; // integrity: never edited or erased by a client, even the owner
      }

      match /settings/app {
        allow read, write: if isOwner(uid)
                            && request.resource.data.keys().hasOnly(
                                 ['themeMode', 'accent', 'callAlertsEnabled', 'advancedStatsEnabled', 'customLabels', 'updatedAt']);
      }

      match /devices/{deviceId} {
        allow read, write: if isOwner(uid);
      }
    }

    // Deny-by-default: anything not explicitly matched above — any other top-level
    // collection, any other user's uid path, any unauthenticated request — is denied.
    match /{document=**} {
      allow read, write: if false;
    }
  }
}
```

Notes:
- Every rule keys off `request.auth.uid == uid` from the *path*, not from any client-supplied field —
  a user cannot claim someone else's `uid` by writing it into the document body.
- `hasOnly([...])` allowlists fields per collection, so a compromised/buggy client can't smuggle extra
  fields (e.g. an `isAdmin` flag) into a doc it's otherwise allowed to write.
- The trailing `match /{document=**} { allow read, write: if false; }` is the deny-by-default backstop —
  it fires for unauthenticated requests and for any path this doc doesn't anticipate, so a future schema
  addition that forgets to add its own rule is closed, not open, by default.
- Session `update`/`delete` are hard-denied even for the owner — this is deliberate: it matches the
  "sessions are append-only events" framing in §4 and means a compromised client session can, at worst,
  add fabricated sessions (already a low-stakes local-first app fact — the box, not the account, is the
  actual enforcement point for lock behavior) but can never rewrite or erase real history.

---

## 4. Migration plan

### 4.1 First sign-in on a device with existing local-only history

The device already has `LoggedSession[]` in AsyncStorage (`sessionHistory.ts`) predating any account.
On first successful `signInWithCredential`:

1. Read `users/{uid}` (does the account doc exist yet?).
2. **If it does not exist** (this is genuinely the first device ever signed into this account):
   - Create `users/{uid}` with profile fields.
   - `loadSessions()` locally, chunk into batches of ≤500 (Firestore batch limit), and
     `set()` (not `add()`) each session at its deterministic ID
     `${deviceId}_${startedAt}_${actualS}` under `users/{uid}/sessions/`. Using `set()` at a
     deterministic ID makes the whole upload **idempotent** — re-running it after a crash or retry
     never creates duplicates.
   - Upload current `useSettingsStore` fields to `users/{uid}/settings/app` with `updatedAt: now`.
3. **If it already exists** (this device is signing into an account that has synced before, e.g. after
   a reinstall) — see §4.2, this collapses into the same merge logic as a second device.

### 4.2 Signing in on a second device (merge policy)

Two different kinds of local state need two different merge policies, and conflating them would be
wrong:

| Data | Nature | Policy | Why |
|---|---|---|---|
| **Session history** | Append-only historical events; a given session either happened or didn't | **Additive union**, deduped by deterministic doc ID | Sessions aren't "current state" to overwrite — they're facts. Losing a real session (overwrite) or double-counting one (blind append) both corrupt stats/streaks. Union is the only lossless, correct merge. |
| **App settings** (`themeMode`, `accent`, `callAlertsEnabled`, `advancedStatsEnabled`, `customLabels`) | A single current-state document representing "what the user wants right now" | **Last-write-wins by `updatedAt`** | There is no meaningful way to "merge" two theme choices — whichever device the user touched most recently expresses their current intent. `customLabels` rides the same LWW channel: if two devices independently add/rename/delete labels before syncing, the whole catalog from the more-recently-touched device wins, not a per-label merge. |

Concretely, on every sign-in (first or Nth device):
- **Sessions:** download `users/{uid}/sessions` ordered by `startedAt`, union with local
  `loadSessions()` result by the deterministic ID (a `Map` keyed by ID naturally dedupes), write the
  merged set back to local storage via `appendSessions`-equivalent replace, and upload (idempotent
  `set()`) any locally-known sessions not yet present remotely (covers the case where this device
  logged sessions offline before this sign-in).
- **Settings:** compare local `useSettingsStore` state's own last-changed timestamp (add an
  `updatedAt` alongside the existing persisted fields) against the remote `settings/app.updatedAt`;
  whichever is newer wins and is written to the other side. This is a simple two-way LWW, sufficient
  for a single human operating a handful of devices — no CRDT/vector-clock machinery is justified at
  this scale.
- **`devices/{deviceId}`** entries are additive by nature (keyed by the physical box's BLE device ID) —
  no conflict is possible; each device the account has ever paired with gets its own doc.

### 4.3 Ongoing sync (not just first sign-in)

- On every `go_done`-derived local append (`handleHistory` in `useStore.ts`), if signed in, also
  `set()` the new session(s) at their deterministic ID — the same idempotent write path as migration,
  just incremental.
- On every settings change (`setThemeMode`, `setAccent`, etc.), if signed in, write-through to
  `settings/app` with a fresh `updatedAt`, mirroring the existing "optimistic local write, best-effort
  remote sync" pattern the app already uses for the box's own settings (`pushBoxSettings`).
- No sync is required for the app to function — a network failure just means the next successful sync
  catches up, matching the box's own store's "connect() reconciles" precedent.

### 4.4 Local storage account-boundary guard

Local session history and the four `SyncableSettings` fields are tagged in AsyncStorage with the uid
they currently belong to (`localDataOwnerUid`, `sync/localDataOwner.ts`), separately from the merge
policy in §4.2. Before `runMigrationAndSync` runs any of the §4.2 union/LWW logic for a newly
signed-in uid, it calls `ensureLocalDataScopedTo(uid)`: if the tag belongs to a different uid, or
storage is untagged but non-empty (an install predating this guard), local session history is cleared
and the four settings fields reset to their defaults before the merge proceeds; only then is storage
re-tagged as belonging to the new uid. This is what makes §4.2's merge logic safe to run
unconditionally on every sign-in — without it, `syncSessions`/`syncSettingsTwoWay` would blend
whatever was already on the device into the newly signed-in uid's Firestore data, regardless of
whether it actually belonged to that account (shared/resold/reset device, or a corrected wrong-account
sign-in).

`useAuthStore.signOut` and `deleteAccount` call the same `clearLocalAccountData()` primitive directly
(session history cleared, settings reset, tag removed) once the account transition completes, so no
account's data lingers locally between sessions even without an intervening different-uid sign-in.
`boxSettings` (the per-physical-box BLE mirror) and the view-only local prefs
(`TIME_WINDOW_KEY`/`BEST_STREAK_KEY`) are outside this guard's scope — they were never part of the
account-syncable data set in the first place (§3.1).

`clearLocalAccountData()` and `syncSessions` (§4.2) both mirror their AsyncStorage write into
`useStore.setSessions()` — the in-memory `sessions` array `StatsScreen`/`DashboardScreen`/
`CalendarScreen` actually render, which `useStore.ts` otherwise only populates once at `init()`. Before
this, storage was correctly scoped/cleared (the account-boundary property above held), but a device
that stayed running across a sign-out → different-account sign-in (no app restart) kept showing the
previous account's sessions on-screen until the process restarted or a BLE history event happened to
overwrite the array — a UX staleness gap, not a data-isolation leak, since it never affected what was
actually persisted or synced. `firestoreSync.ts`'s `syncSessions` also calls
`sessionsSyncBridge.markSessionsSeen()` immediately before `setSessions()`: without it, that bridge's
own push-on-change subscription would treat any session it hadn't personally observed (e.g. one merged
in from another device) as newly-logged and re-upload it under this device's doc-id namespace
(`sessionDocId` is deviceId-scoped), creating a second Firestore doc for the same session and
permanently double-counting it in stats.

---

## 5. Threat model / security review checklist

Concrete, checkable items for a security-review pass after implementation. Each item names what to
grep for, run, or inspect — not generic advice.

| # | Check | How to verify |
|---|---|---|
| 1 | Google ID token is never persisted to disk in any form | Grep implementation for the variable holding `GoogleSignin.signIn()`'s `idToken` result; confirm it is used exactly once (passed into `GoogleAuthProvider.credential`) and never passed to `SecureStore`, `AsyncStorage`, a log call, or a Firestore write. |
| 2 | Firebase session state is written only through `secureStorePersistence`, never AsyncStorage | Confirm `initializeAuth(app, { persistence: secureStorePersistence })` is the only Auth initialization call in the codebase; grep for `firebase/auth` + `AsyncStorage` co-occurring anywhere (should be zero hits). |
| 3 | No token, credential, or PII is ever passed to `console.log`/`console.warn`/crash reporting | Grep for `console.log`/`console.warn`/`console.error` in every file touching `auth`, `GoogleSignin`, `idToken`, `credential`; confirm none interpolate token/credential/email/displayName values. Repeat for any analytics `.track()`/`.identify()` calls. |
| 4 | Sign-in screen doesn't leak PII into analytics | If any analytics SDK is present, confirm the sign-in button tap event and any post-auth event fire with no email/displayName/photoURL/uid in the event payload (a hashed/opaque uid is acceptable if analytics are added later; raw PII is not). |
| 5 | Firestore rules deny-by-default and are the deployed rules | Confirm the trailing `match /{document=**} { allow read, write: if false; }` catch-all is present in the *deployed* `firestore.rules`, not just this doc; run the Firebase Rules simulator (or `firebase emulators:exec` with a rules unit test) for: (a) unauthenticated read/write anywhere → denied, (b) user A reading/writing under user B's `uid` → denied, (c) user A reading/writing their own `uid` → allowed. |
| 6 | Session documents cannot be edited or deleted by any client | Rules-simulator test: authenticated owner attempts `update`/`delete` on an existing `sessions/{id}` doc → denied. |
| 7 | Field-level allowlisting is enforced, not just path-level | Rules-simulator test: owner attempts to write an extra/unexpected field (e.g. `isAdmin: true`) into `users/{uid}` or `settings/app` → denied by `hasOnly`. |
| 8 | No Firebase service-account key or admin SDK credential exists in the repo | `git grep -i "private_key"`, `git grep -i "type.*service_account"`, and confirm no `*firebase-adminsdk*.json` file is tracked. This app has no backend — there is no legitimate reason for one to exist. |
| 9 | No Firebase **API key** is treated as if it were secret in a way that causes other leaks | Confirm the `firebaseConfig` object (apiKey, authDomain, etc.) is not itself the problem (Firebase web API keys are not secret by design — they identify the project, not authorize access; access control lives entirely in the Firestore rules from §3.2) — but confirm nothing *else* sensitive (OAuth client secret, service-account key) is co-located with it in the same config file. |
| 10 | Logout performs a full wipe | Manual test: sign in, sign out, inspect device Keychain (or re-launch and check `auth.currentUser`) to confirm no residual session; confirm `GoogleSignin.revokeAccess()` (not just `signOut()`) is called so the Google-side grant is actually revoked, not just the local cache cleared. **Also confirm local AsyncStorage is wiped, not just Keychain/Auth state**: after sign-out, `sessionHistory`'s stored session list is empty and `themeMode`/`accent`/`callAlertsEnabled`/`customLabels` have reverted to their defaults (`sync/localDataOwner.ts`'s `clearLocalAccountData()`, called from `useAuthStore.signOut`/`deleteAccount`) — this is what actually prevents a signed-out device from leaking one account's session/settings data into whichever account (or none) uses the device next. |
| 17 | A wrong-account or shared-device sign-in cannot blend local data into the new account | Manual/code test: local session history and settings are tagged with the uid they belong to (`localDataOwnerUid` in AsyncStorage, `sync/localDataOwner.ts`). Confirm `runMigrationAndSync` calls `ensureLocalDataScopedTo(uid)` before any Firestore read/write, and that it wipes local storage whenever the stored tag doesn't match the newly signed-in uid (including the untagged case, e.g. a pre-existing install) — so `syncSessions`/`syncSettingsTwoWay` never union or LWW-merge a previous account's local data into the new uid's Firestore path. |
| 11 | Reinstall does not silently resume a prior session | Manual test: sign in, uninstall the app, reinstall, launch — confirm the user lands signed out (validates the §2.5 install-marker wipe actually runs before Firebase Auth initializes). |
| 12 | Account/session deletion path is complete | Manual test of "delete account": confirms (a) `deleteUser()` succeeds (re-authenticating first if Firebase requires a recent sign-in), (b) `users/{uid}` doc and all subcollections (`sessions`, `settings`, `devices`) are removed, (c) `GoogleSignin.revokeAccess()` is called, (d) local `SecureStore`/AsyncStorage auth state is wiped, (e) no orphaned data remains readable under that uid (rules-simulator: post-deletion, no path under the old uid is writable by anyone, including a re-registration with the same Google account — should just start a fresh empty `users/{uid}`). |
| 13 | Redirect URI / custom scheme is exact-match, not wildcard (only applies if the §1.3 fallback is ever built) | If `expo-auth-session` PKCE is ever added, confirm the Google Cloud Console OAuth client's authorized redirect URI list contains exactly `phonebox://oauth2redirect` (or whatever exact value is used) and not a wildcard/prefix. |
| 14 | Deterministic session IDs cannot be exploited for cross-user collision or overwrite | Confirm the rules in §3.2 scope every session doc under `users/{uid}/sessions/...` — the deterministic ID is unique only *within* a user's own subcollection path, so even if two different users' boxes produced an identical `deviceId_startedAt_actualS` string, the documents live at disjoint Firestore paths and the per-uid rule still applies. |
| 15 | Firestore reads are always scoped to `request.auth.uid`, never a client-supplied uid parameter | Code review: every Firestore query in the app (e.g. `doc(db, 'users', uid, ...)`) uses `auth.currentUser.uid` directly, never a uid value that arrived over BLE, from route params, or from any other externally-influenceable source. |
| 16 | App Check / abuse hardening status is a known, explicit decision, not an oversight | Confirm the doc/ticket recording whether Firebase App Check (Play Integrity + App Attest) was enabled at ship or explicitly deferred — should not be silently absent. |

---

## 6. UI/UX

### 6.1 Placement: Settings tab, optional entry point — not a gate

The existing `App.tsx` is a flat 4-tab switcher (`dashboard | stats | calendar | settings`, no router).
**Recommendation: add sign-in inside the existing `SettingsScreen`, as a new top section — no new tab,
no gate, no blocking screen shown at launch.**

Rationale:
- The app's own local-first design principle (stated explicitly in the upstream RFC and reflected in
  every store today — BLE, stats, settings all work with zero network) must not be broken by adding
  accounts. A sign-in *gate* would contradict that design outright.
- The upstream RFC already established the precedent for this exact kind of feature: `expo-secure-store`
  was named as a tool to add "if the B3 backend ever ships," described as additive, not foundational.
- A Settings-tab entry point matches where the box-settings mirror already lives, so "manage your stuff"
  (box settings, app preferences, now account) stays in one place.

### 6.2 Signed-out mode (default, and always fully functional)

- Dashboard, Stats, Calendar, and the rest of Settings behave exactly as they do today — BLE connect,
  live status, local session history, local preferences. Nothing is disabled, blurred, or nagged.
- Settings shows a single new row/section: **"Sign in with Google"** with one line of explanation
  ("Back up your stats and settings, and sync them to another phone. Optional — the box works fully
  without this.").

### 6.3 Signed-in mode

- The same section now shows the account's Google `displayName`/`email` (display only — never logged,
  per the checklist), a **"Sync now"** action, a **last-synced** timestamp, and **"Sign out"**.
- A lightweight, non-blocking sync indicator (e.g. a small "synced Xm ago" caption) is enough; no
  separate sync-status screen is justified at this scope.
- Migration (§4) runs automatically and silently on first successful sign-in; no separate "import your
  data?" prompt is needed since the merge policy is designed to be safe and lossless by default.

---

## 7. New dependencies and manual setup

### 7.1 `app/package.json` additions

```jsonc
"dependencies": {
  // ...existing...
  "@react-native-google-signin/google-signin": "^13.x",  // pin to current major at implementation time
  "firebase": "^10.x",                                    // modular JS SDK: firebase/app, firebase/auth, firebase/firestore
  "expo-secure-store": "*",                                // install via `npx expo install expo-secure-store` to match the Expo 52 SDK's bundled version
  "react-native-get-random-values": "^1.x"                 // polyfill firebase JS SDK's crypto.getRandomValues on RN; import once at app entry before firebase
}
```

Deliberately **not** added: `@react-native-firebase/*` (bypasses the mandated `expo-secure-store` choke
point, per §2.1), any server/admin SDK, any analytics SDK (out of scope here; if added later, checklist
item 4 applies).

`app.json` additions: register the Google Sign-In Expo config plugin (it patches iOS `Info.plist`/URL
scheme and Android manifest during `expo prebuild`):

```jsonc
"plugins": [
  "expo-dev-client",
  ["react-native-ble-plx", { /* existing config, unchanged */ }],
  "@react-native-google-signin/google-signin"
]
```

### 7.2 Firebase / Google Cloud Console setup — manual, human steps

These require console access and real project credentials; do not fabricate values for any of these —
they must be obtained from the actual Firebase/Google Cloud console by a human with access:

1. Create a Firebase project (console.firebase.google.com).
2. **Authentication → Sign-in method → Google**: enable the provider. This auto-provisions a Web OAuth
   client — note its **Web client ID**; this is what `GoogleSignin.configure({ webClientId })` needs on
   *both* platforms (it's the `idToken` audience Firebase expects).
3. **Add an iOS app** in the Firebase console with bundle ID `com.emahmaker.phonebox` (from
   `app/app.json`'s `ios.bundleIdentifier`) — this provisions the iOS OAuth client; note its client ID
   and the **reversed client ID** (used for the URL scheme the config plugin needs,
   `iosClientId` in `GoogleSignin.configure`).
4. **Add an Android app** in the Firebase console with package `com.phonebox.app` (from
   `app/app.json`'s `android.package`). **Add the SHA-1 (and SHA-256 for Play App Signing) certificate
   fingerprints** for both the debug and eventual release keystores — Google Sign-In on Android fails
   with `DEVELOPER_ERROR` without this.
5. Retrieve the web `firebaseConfig` object (`apiKey`, `authDomain`, `projectId`, `storageBucket`,
   `messagingSenderId`, `appId`) from **Project settings → General** and wire it into the app's Firebase
   init (these values identify the project; they are not secrets — access control is entirely the
   Firestore rules in §3.2, not this config).
6. **Firestore Database**: create in production mode (not test mode, which defaults to open rules), in
   a region decided separately; deploy the rules file from §3.2 via the Firebase CLI
   (`firebase deploy --only firestore:rules`) — a manual step, since this project has no existing CI/CD
   pipeline (per the on-device-only validation convention noted in the upstream RFC).
7. **Never generate or download a service-account JSON key for this project.** There is no backend
   component in this design that would legitimately need one; if one is ever generated for a future
   Cloud Function, it must never be committed (checklist item 8).
8. Optional, recommended fast-follow (not MVP-blocking): enable **Firebase App Check** with Play
   Integrity (Android) and App Attest (iOS) to reject Firestore requests from anything but the real app
   binary.

---

## 8. Risks & mitigations

| Risk | Sev | Mitigation |
|---|---|---|
| Firebase JS SDK's persisted auth record exceeds a Keychain-item practical size limit | Low–Med | Verify on-device with a real signed-in record during implementation (§2.2); split across multiple `SecureStore` keys if ever needed — do not fall back to AsyncStorage. |
| iOS Keychain survives app uninstall, resuming a stale session on reinstall | Med | §2.5's AsyncStorage-marker wipe-on-fresh-install pattern; checklist item 11 verifies it. |
| A future schema addition forgets its own Firestore rule | Med | The deny-by-default catch-all (§3.2) makes "forgot a rule" fail closed, not open — verify with checklist item 5 on every rules change. |
| Settings LWW merge silently discards a device's legitimate offline change | Low | Acceptable at this scope (single user, few devices, low-stakes preference fields); revisit only if accountability/family multi-user sharing (a different, deferred feature) is ever built on top of this. |
| Deterministic session doc IDs collide across two different physical boxes on the same account | Very low | ID includes `deviceId` (the BLE peripheral's own ID) alongside `startedAt`/`actualS`, making practical collision effectively impossible (checklist item 14). |
| Google Sign-In Android `DEVELOPER_ERROR` from a missing SHA fingerprint | Low (setup-time, not a security risk) | §7.2 step 4 — must register both debug and release keystore fingerprints before Android testing. |
| Firestore rules simulator tests are never actually written, so regressions ship silently | Med | Treat checklist items 5–7 and 12 as required, not optional, for the security-review pass explicitly requested for this feature. |

---

## 9. Confidence level

**80/100** that this design ships a genuinely secure, additive sync layer without regressing the app's
local-first behavior. The architecture (Firebase Auth + Firestore, native Google Sign-In, per-user
rules) is well-trodden. The residual uncertainty is concentrated in two spots: (a) the custom
`expo-secure-store` `Persistence` adapter is bespoke — it needs on-device verification that Firebase's
persisted record fits Keychain item constraints (§2.2, §8), and (b) the Keychain-survives-uninstall
mitigation (§2.5) needs an explicit manual reinstall test before shipping (checklist item 11), since it
is easy to get subtly wrong (e.g. running the wipe *after* Firebase Auth has already initialized and
read the stale session).

---

## 10. Recommended immediate next steps

1. **Firebase/Google Cloud Console setup (blocking, human step):** §7.2, items 1–6. Nothing below can
   be tested without a real project, real OAuth client IDs, and deployed rules.
2. **Implement the `secureStorePersistence` adapter (§2.2) and the install-marker wipe (§2.5) first**,
   before any UI — these are the security-critical, easiest-to-get-subtly-wrong pieces, and are cheapest
   to unit-test in isolation (mock `expo-secure-store`, assert the adapter never touches AsyncStorage).
3. **Write the Firestore rules unit tests** (checklist items 5–7, 12) against the Firebase emulator
   before writing any client sync code — the rules are the actual security boundary; get them verified
   independent of app logic.
4. **Build the sign-in UI (§6) and migration flow (§4)** against the real project from step 1.
5. **Run the full checklist in §5** as the dedicated security-review pass this document was written to
   hand off to.

---

## Sources

- Google Sign-In (React Native): [`@react-native-google-signin/google-signin`](https://react-native-google-signin.github.io/docs/original)
- Firebase Auth (modular JS SDK) React Native guidance: [Firebase — Get Started with Firebase Authentication on React Native](https://firebase.google.com/docs/auth/web/react-native)
- Firebase Auth `signInWithCredential` / `GoogleAuthProvider`: [Firebase — Authenticate Using Google Sign-In](https://firebase.google.com/docs/auth/web/google-signin)
- Firebase Auth custom `Persistence`: [Firebase JS SDK — Auth Persistence reference](https://firebase.google.com/docs/reference/js/auth.persistence)
- `expo-secure-store`: [Expo docs — SecureStore](https://docs.expo.dev/versions/latest/sdk/securestore/)
- `expo-auth-session` PKCE / Google provider: [Expo docs — AuthSession](https://docs.expo.dev/versions/latest/sdk/auth-session/), [Expo docs — Authentication: Google](https://docs.expo.dev/guides/authentication/#google)
- `expo-web-browser`: [Expo docs — WebBrowser](https://docs.expo.dev/versions/latest/sdk/webbrowser/)
- Firestore security rules: [Firebase — Get started with Cloud Firestore Security Rules](https://firebase.google.com/docs/firestore/security/get-started), [Firebase — Security Rules structure](https://firebase.google.com/docs/firestore/security/rules-structure)
- Firestore rules unit testing: [Firebase — Test your security rules](https://firebase.google.com/docs/firestore/security/test-rules-emulator)
- Firebase App Check: [Firebase — App Check overview](https://firebase.google.com/docs/app-check)
- iOS Keychain persistence across app deletion (background on the reinstall trap): [Apple — Keychain Items](https://developer.apple.com/documentation/security/keychain_services/keychain_items) (`kSecAttrAccessible*` accessibility constants)
- Upstream context: `docs/rfcs/companion-app-development-approach-technical-design.md`
