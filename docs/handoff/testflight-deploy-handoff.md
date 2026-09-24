# Handoff: ship a Phone Box build to public TestFlight

## Original ask (verbatim, for provenance)
> write a handoff file to deploy this and what still needs to be done

## Where this came from

The 2026-09-09 pass closed the code-and-verification half of
`docs/handoff/testflight-demo-account-handoff.md`: the demo-account seed script exists, is
committed-ready, and every payload it writes has been checked against the real
`app/firestore.rules` and the app's own sanitizers. `website/privacy.html` was deployed on
2026-09-10, which cleared the one hard blocker.

What is left is the part no script can do: a Firebase console toggle, a credential
decision, an EAS build, and App Store Connect data entry. This file is the ordered list.

`docs/app-store/testflight-external-testing.md` is the companion reference — it holds
Apple's requirements with source links, the paste-ready copy for every App Store Connect
field, and the evidence behind each "verified" claim. **Do not retype that copy from
memory; open that file and paste from it.** This handoff is the sequence; that one is the
content.

## Improved task prompt (use this instead)

Take the Phone Box iOS app from its current state to a build that external testers can
install from a public TestFlight link. Work through "What still needs to be done" below in
order. Every step is either a console action, a single command, or a paste from
`docs/app-store/testflight-external-testing.md`.

Read "Traps" before starting. Several of them are one-way doors, and two of them
(the deviceId, the append-only sessions rule) cannot be undone on the account they damage.

## Where things actually stand

Verified on 2026-09-10 unless noted.

| Item | State |
|---|---|
| Seed script, re-runnable, no credentials committed | Done — `scripts/seed-demo-account.js`, `scripts/lib/demo-seed-data.js` |
| Seed payloads accepted by `app/firestore.rules` | Done — 43/43 writes, Firestore emulator |
| Seed payloads survive the app's own sanitizers | Done — goals and labels round-trip unchanged |
| Re-running the seed is idempotent | Done — second run wrote 0 duplicate sessions |
| Privacy policy live and matching the in-app link | Done — HTTP 200, byte-identical to `website/privacy.html` |
| In-app privacy link, privacy manifest, release logging | Done — 2026-09-08 compliance pass |
| Sign in with Apple present (Guideline 4.8) | Done — `usesAppleSignIn: true`, alongside Google and email/password |
| Account deletion purges session history (5.1.1(v)) | Done — rules deployed 2026-09-11 04:21 UTC, live ruleset byte-identical to git |
| Debug panels hidden from a release build | Done — call diagnostics is behind a long-press, 2026-09-10 |
| Existing test suites | Green — 1067 app, 51 Firestore rules |
| **Everything below** | **Not started** |

## What still needs to be done

### 1. Commit the working tree

`git status` shows ~69 modified and untracked paths on `master`, including the whole
2026-09-08 compliance pass and this task's new files (`scripts/seed-demo-account.js`,
`scripts/lib/`, `docs/app-store/`).

Do this first, and not as bookkeeping. EAS uploads the **working directory** subject to
`.easignore`, not the committed tree — so a build made now is not reproducible from any
commit, and if Beta App Review rejects it there is no recorded state to diff against. Also
check `git diff` shows no demo password anywhere before committing.

Branch first if you would rather not commit straight to `master`.

### 2. Enable Email/Password in the Firebase console

Firebase console → project `phonebox-d14b7` → **Authentication → Sign-in method →
Email/Password → Enable**.

Console-only; there is no CLI for it. Email/Password is the only one of this app's three
sign-in methods a reviewer can use without owning a Google or Apple account you control.

If this is skipped, step 4 exits with `auth/operation-not-allowed` and prints this exact
instruction, so it fails loudly rather than silently.

### 3. Choose the demo credentials

- **Password ≥ 6 characters** — `MIN_PASSWORD_LENGTH` in
  `app/src/screens/account/EmailPasswordFields.tsx`, enforced client-side *before* Firebase
  sees it. A 5-character password can be created by the script and then refused by the
  app's own sign-in form, which is a uniquely confusing way for this to fail.
- **No ambiguous characters, no leading or trailing whitespace.** A reviewer retypes this
  by hand.
- **Use a mailbox you do not care about.** Email verification is not enforced anywhere —
  `createAccountWithEmail` fires a best-effort verification email but no screen gates on
  `user.emailVerified` — so the account works unverified and you never need to read that
  inbox.

### 4. Create and seed the demo account

```sh
cd "<repo root>"
PHONEBOX_DEMO_EMAIL='<email>' PHONEBOX_DEMO_PASSWORD='<password>' \
  node scripts/seed-demo-account.js --create
```

Or run it bare and answer the two prompts; the password prompt does not echo. Either way
the credentials never enter the repo.

Check the printed plan before it writes. Two lines matter:

- `device id       unknown-device` — must be exactly that. See trap 2.
- The goal table must show at least one `MET` and at least one `in progress`. The script
  warns if not; that only happens when it runs before the day's first seeded session, so
  re-run later in the day.

`--dry-run` prints the plan and writes nothing.

### 5. Store the credentials outside this repo

A password manager. Not `docs/` (tracked), not a new file in the tree — and note that
`.easignore` **replaces** `.gitignore` for EAS uploads, so a secret dropped somewhere new
is not automatically kept off the builder even when git ignores it.

Nothing in this repo can recover the account. Whoever submits the next build needs these.

### 5b. Deploy the Firestore rules — BEFORE the build, not after

```sh
firebase deploy --only firestore:rules --project phonebox-d14b7
```

**Verified done on 2026-09-12**: live ruleset `d2390c4d`, deployed 2026-09-11 04:21 UTC,
byte-identical to `app/firestore.rules` at `0fb77ae`. Re-check before any *later* build —
this is a standing step, not a one-off.

`app/firestore.rules` ships separately from the app binary, and this repo has no CI for
it, so the deployed ruleset regularly lags git. Two things in this build need the current
one:

- **Account deletion now purges session history** (Guideline 5.1.1(v)). Sessions are
  deletable only while `users/{uid}` is absent, and `deleteAllUserData` deletes that doc
  first to open the window. Against a stale ruleset the sweep is denied — tolerated, not
  fatal (the sweep is wrapped and logs `[sync] session history not purged on account
  deletion`), but the account silently keeps its history and the guideline gap is back.
- Any earlier rules change not yet pushed. Check before assuming: reading the live ruleset
  needs `firebase login --reauth` first — the stored credentials were expired as of
  2026-09-10.

### 6. Build and upload

```sh
cd app
eas build --platform ios --profile production
eas submit --platform ios --profile production
```

`eas.json` sets `appVersionSource: "remote"` with `autoIncrement: true` on the production
profile, so **EAS owns the build number** — do not hand-edit one into `app.json`. The
marketing version there is `1.0.0`.

Before spending build minutes, confirm `app/.env` is actually in the upload:

```sh
npx eas build:inspect --platform ios --stage archive --output <dir>
```

That writes the exact archive to disk and costs nothing. See trap 3 for why this is worth
the extra minute.

### 7. Fill in App Store Connect

Paste from `docs/app-store/testflight-external-testing.md` → "Copy for each App Store
Connect field". It has final text for:

- **TestFlight → Test Information**: Beta App Description (Apple marks this required for
  external testing), Feedback Email (`<developer email>`), What to Test, Privacy Policy
  URL.
- **Beta App Review Information**: Sign-In Required set to yes with the step-3 credentials,
  contact name/email/phone (all three required), and the review notes.

The review notes are the load-bearing part. They tell the reviewer that the "Connect your
box" state on Home is expected without hardware, that sign-in is optional in normal use,
and that deleting the demo account destroys it. Do not shorten them.

The Privacy Policy URL must be byte-identical to `PRIVACY_POLICY_URL` in
`app/src/legal/legalLinks.ts` — reviewers compare the in-app link against the metadata.

### 8. Submit for TestFlight App Review, then open the public link

- An **internal** testing group must exist before an external one can be created.
- The first build of a version goes through TestFlight App Review and must reach
  **Approved** before external testers can install.
- Only then create the public link. It takes 1–10,000 testers; 10,000 external testers per
  app is the cap. Link joiners appear as *anonymous* — no name or email.

### 9. Verify on a clean install

On a device or simulator, from a fresh install — **not** in the Firestore console:

1. Sign in with the demo credentials.
2. Home, Stats and Calendar all populate within one sync.
3. The goal ring shows one met goal and one partial.
4. Settings → About → the privacy policy link opens a real page.
5. Account → Data & privacy → the same link, and account deletion is present.

If the data does not appear, check in this order: the seeded document IDs
(`unknown-device_<startedAt>_<actualS>`), then `MIN_LOGGED_SESSION_S`. Those are the two
failure modes that look like a sync bug and are not.

Re-check the privacy URL immediately before submitting:

```sh
curl -sS -o /dev/null -w "%{http_code}\n" https://phonebox-d14b7.web.app/privacy.html
```

## Traps

Read these before starting. Most are one-way doors.

1. **A bad seed can only be undone by deleting the whole account.** `app/firestore.rules`'
   sessions block permits a delete only while `users/{uid}` is absent — deliberate
   append-only integrity, not an oversight. No running app, including the owner's, can
   remove a session document; the sole exception is `deleteAllUserData`, which removes the
   parent doc first precisely to open that window. So a bad seed is fixable, but only by
   burning the account (and per trap 6, a deleted uid is never reissued). If you change
   `scripts/lib/demo-seed-data.js`, rehearse against the emulators first (command in
   `docs/app-store/testflight-external-testing.md`).

2. **The seeded deviceId must stay `unknown-device`.** `sync/sessionMerge.ts`'s
   `sessionDocId` is `` `${deviceId}_${startedAt}_${actualS}` ``, and
   `sync/sessionsSync.ts`'s `currentDeviceId()` falls back to `'unknown-device'` on a phone
   that has never connected to a box — which is exactly the reviewer's phone. Under any
   other id, the reviewer's first sync pulls the sessions down, recomputes a *different* id
   for each, matches none, and uploads a second copy of every one: permanent
   double-counting in every stat, and per trap 1 the duplicates cannot be removed.

3. **`.easignore` replaces `.gitignore` for what EAS uploads.** `app/.env` is git-ignored
   but deliberately *not* easignored, because `EXPO_PUBLIC_*` values are inlined at
   transform time and must exist on the builder. When they don't, the build ships
   `firebaseConfig.ts`'s `REPLACE_ME_*` fallbacks and the app reports "Sign-in isn't
   configured on this build" — which fails Guideline 2.1 with a demo account that cannot be
   used at all. That file's header documents two prior silent failures here. Verify with
   `eas build:inspect`.

4. **Do not "fix" the absent push-notification prompt.** `app/plugins/withoutPushEntitlement.js`
   strips `aps-environment` on purpose: the Apple App ID has no Push Notifications
   capability, so leaving the entitlement in fails codesign against the provisioning
   profile. iOS remote push is deliberately dormant; local reminders still work. Turning it
   on needs an APNs key *and* a regenerated profile — see `docs/push-notifications.md`. It
   is not part of this task.

5. **A wrong password and a nonexistent account look identical.** Email Enumeration
   Protection is on for this project, so both come back as `auth/invalid-credential`. Do
   not debug by error code — you will conclude the wrong thing. The seed script prints this
   warning when it hits that code.

6. **The demo account can be destroyed by the reviewer.** Apple's own reference says a demo
   account *"must not expire"*, while Guideline 5.1.1(v) invites the reviewer to test
   account deletion — which permanently removes it (`deleteAllUserData` + `deleteUser`).
   The review notes ask them to contact you if they do. If it happens, redo steps 3–5 with
   a *new* email; a deleted Firebase Auth uid is never reissued.

7. **Six builds per 24 hours** may be submitted for TestFlight App Review. Do not burn them
   on avoidable failures — hence steps 1 and 6's pre-flight checks.

8. **A build marked "TestFlight Internal Only" at upload can never be moved to an external
   group.** Do not set that flag.

9. **`firebase deploy --only hosting` publishes all of `website/`.** The privacy page is
   live now, but any future site deploy from a tree where that file is missing or broken
   takes the in-app privacy link down with it. Re-check the URL before every submission.

## What "done" looks like

- The working tree is committed, and `git diff` contains no password.
- Email/Password is confirmed enabled in the Firebase console.
- A demo account exists, is seeded, and signs in from the app on a clean install.
- That clean install populates Home, Stats and Calendar within one sync, with one goal met
  and one in progress — verified on a device or simulator, not in the Firestore console.
- The credentials are in a password manager outside this repo.
- App Store Connect has the Test Information and Beta App Review Information filled in from
  `docs/app-store/testflight-external-testing.md`, including the full review notes.
- A production build is uploaded, has reached **Approved** in TestFlight App Review, and a
  public link exists.
- `https://phonebox-d14b7.web.app/privacy.html` returns 200, and its URL matches
  `PRIVACY_POLICY_URL` exactly.

## Out of scope

- **Do not relax `app/firestore.rules` to make any of this easier.** The append-only
  sessions rule is load-bearing, and its one exception is deliberately as narrow as it can
  be: sessions are deletable only while `users/{uid}` is absent, a state nothing but
  `deleteAllUserData` produces. That window is what closed the residual Guideline 5.1.1(v)
  risk flagged in the 2026-09-08 pass (deletion used to orphan session documents rather
  than erase them). Widening it reopens that and lets a stolen client token erase history.
- **iOS remote push** (trap 4). Dormant by design.
- **App Store release.** This is TestFlight external testing only. Guideline 2.2 means the
  full review guidelines apply to the beta, but the store listing, screenshots and pricing
  are a separate piece of work.
