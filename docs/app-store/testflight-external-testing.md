# TestFlight external (public link) testing — submission checklist

Everything needed to get a Phone Box build past **TestFlight App Review** and out to
external testers via a public link. Written 2026-09-09; Apple's requirements below were
read off Apple's own pages that day, with links, because they change.

This closes out `docs/handoff/testflight-demo-account-handoff.md` (the demo account) and
carries the two loose ends that handoff called "one-liners" — deploying `privacy.html` and
filling in the App Store Connect fields — because neither is optional for external testing.

---

## Status

| # | Item | State |
|---|---|---|
| 1 | Re-runnable demo-account seed script, no credentials committed | **Done** — `scripts/seed-demo-account.js` + `scripts/lib/demo-seed-data.js` |
| 2 | Every seeded payload verified against `app/firestore.rules` | **Done** — 43/43 writes accepted, Firestore emulator |
| 3 | Every seeded payload verified through the app's own sanitizers | **Done** — `sanitizeRemoteGoals` / `sanitizeCustomLabels` round-trip unchanged |
| 4 | Review notes + all App Store Connect copy drafted | **Done** — [below](#copy-for-each-app-store-connect-field) |
| 5 | Email/Password enabled in the Firebase console | **Needs a human** — console-only setting |
| 6 | Demo account created and seeded in `phonebox-d14b7` | **Needs a human** — pick the credentials, then one command |
| 7 | `website/privacy.html` deployed to Firebase Hosting | **Done (2026-09-10)** — live, HTTP 200, byte-identical to the working tree |
| 8 | Credentials stored outside this repo | **Needs a human** — password manager |
| 9 | App Store Connect fields filled in | **Needs a human** — copy is written, paste it |
| 10 | Verified on a clean install | **Needs a human** — device or simulator |

Items 5–10 all need either the Firebase console, App Store Connect, or a decision about a
credential. Nothing about them is unresolved: each has an exact command or an exact string
below.

---

## What Apple actually requires

### For external testers at all

From [Invite external testers](https://developer.apple.com/help/app-store-connect/test-a-beta-version/invite-external-testers)
and [Provide test information](https://developer.apple.com/help/app-store-connect/test-a-beta-version/provide-test-information/):

- An **internal** testing group must exist before an external one can be created.
- The first build for a version goes through **TestFlight App Review**; it must reach
  **Approved** before external testers can install. Max **6 builds** submitted for review
  per 24 hours.
- **Beta App Description is required.** Apple's wording: *"In the Beta App Description text
  field, enter a description of your beta version. This field is required."*
- **Feedback Email** — where testers reach you from inside the TestFlight app, and the
  reply-to on invitation emails.
- Apple states plainly: *"Your beta app description and beta app review information are
  required in order to share your beta with external testers."*
- A **public link** takes 1–10,000 testers (10,000 external testers per app is the cap).
  Testers who join by link show up as *anonymous* — no name or email.
- A build marked "TestFlight Internal Only" at upload can never be added to an external
  group. Don't set that flag.

### App Review Information

From [App Review Information reference](https://developer.apple.com/help/app-store-connect/reference/app-review-information/):

- **Required:** contact name, contact email, contact phone number.
- **Required if the app has a login:** sign-in username and password.
- **Optional:** notes.
- Apple's wording, and the reason item 1 above is a script and not a one-off:
  *"The demo account is used during the App Review process and must not expire."*

### Guidelines this app is judged against

From the [App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/):

- **2.1 App Completeness** — *"include demo account info (and turn on your back-end
  service!) if your app includes a login"*, and *"placeholder text, empty websites, and
  other temporary content should be scrubbed before submission"*. A demo account with no
  data, or an in-app link to a 404, both fail here. This is why item 7 is a blocker and why
  the account is seeded rather than empty.
- **2.2 Beta Testing** — a TestFlight build *"should be intended for public distribution and
  should comply with the App Review Guidelines"*. The full guidelines apply, not a subset.
- **4.8 Login Services** — a third-party login needs an equivalent privacy-preserving
  option. Satisfied: `usesAppleSignIn: true` in `app/app.json`, Sign in with Apple
  alongside Google, plus email/password.
- **5.1.1(v) Account Sign-In** — *"If your app doesn't include significant account-based
  features, let people use it without a login"*, and account creation requires in-app
  account deletion. Both hold: sign-in is optional, and `deleteAccount` exists. Say the
  first part in the review notes, because it is not obvious from a screenshot.

---

## Remaining steps, in order

### 1. Enable Email/Password in Firebase

Firebase console → **Authentication → Sign-in method → Email/Password → Enable**, on
project `phonebox-d14b7`.

Do this first. Nothing else works without it, and the failure is unmistakable: the seed
script exits with `auth/operation-not-allowed` and prints this exact instruction.

Email/Password is the only one of this app's three sign-in methods a reviewer can use
without owning a Google or Apple account that you control.

### 2. Privacy policy — done, but re-check before every submission

`https://phonebox-d14b7.web.app/privacy.html` returns **HTTP 200** as of 2026-09-10, and the
deployed bytes are identical to `website/privacy.html` in the working tree. This was a 404
on 2026-09-09; it has since been deployed.

Nothing to do right now. It stays on this list because it is the cheapest thing to
re-break: that URL is hardcoded as `PRIVACY_POLICY_URL` in `app/src/legal/legalLinks.ts`
and rendered in-app by `screens/settings/AboutSection.tsx` and
`screens/account/DataPrivacySection.tsx`, so an in-app link to a 404 is a Guideline 2.1
rejection on its own — and `firebase deploy --only hosting` publishes the whole `website/`
directory, so any future site deploy can take it down with it.

Re-verify before each submission:

```sh
curl -sS -o /dev/null -w "%{http_code}
" https://phonebox-d14b7.web.app/privacy.html   # want 200
```

If it ever 404s again (the Firebase CLI credentials on this machine expire regularly):

```sh
npx firebase-tools@latest login --reauth
npx firebase-tools@latest deploy --only hosting --project phonebox-d14b7
```

### 3. Choose the demo credentials

Constraints, all of them real:

- **Password ≥ 6 characters** — `MIN_PASSWORD_LENGTH` in
  `app/src/screens/account/EmailPasswordFields.tsx`, enforced client-side before Firebase
  sees it. A 5-character password would be creatable by the script and then rejected by the
  app's own form.
- **No ambiguous characters, no leading or trailing spaces.** A reviewer retypes this by
  hand from a text field.
- **Use a mailbox you do not care about.** Email verification is not enforced anywhere —
  `createAccountWithEmail` sends a best-effort verification email but no screen gates on
  `user.emailVerified` — so the account works unverified and you never need to read that
  inbox.

### 4. Create and seed the account

```sh
cd "<repo root>"
PHONEBOX_DEMO_EMAIL='<the email>' PHONEBOX_DEMO_PASSWORD='<the password>' \
  node scripts/seed-demo-account.js --create
```

Or run it with no environment variables and answer the two prompts; the password prompt does
not echo. Either way the credentials never touch the repo — `git diff` will show nothing but
the two script files.

Check the plan it prints before it writes. It should read roughly:

```
  sessions        38 across 22 days (24.7h total)
  custom labels   Thesis, Guitar
  planned         2026-09-10 09:00, 2026-09-12 14:30
  device id       unknown-device
  goals
    MET         monthly-focus    monthly 8h55 / 6h15
    in progress daily-focus      daily   0h22 / 1h00
    in progress thesis-weekdays  daily   0h00 / 0h30
```

`device id unknown-device` is the line to actually look at. It must be exactly that. See
the header of `scripts/lib/demo-seed-data.js` for why any other value permanently
double-counts every seeded session in every stat, with no way to undo it.

At least one goal must say `MET` and at least one `in progress`. The script warns if not
(it happens only if the script runs before the first seeded session of the day) — re-run
later in the day.

To rehearse a change to the seed data without touching the real project:

```sh
export PATH="/c/Program Files/Eclipse Adoptium/jre-21.0.12.101-hotspot/bin:$PATH"  # emulator needs Java
npx firebase-tools@latest emulators:exec --only firestore --project phonebox-d14b7 \
  "node scripts/seed-demo-account.js --dry-run"
```

`--dry-run` writes nothing. For a full write against emulators, set
`FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099` and `FIRESTORE_EMULATOR_HOST=127.0.0.1:8080`
in the shell *before* `emulators:exec` — on Windows the script runs through `cmd.exe`, so a
`VAR=value` prefix inside the quoted command does not work. The Auth emulator also needs a
block in `firebase.json`, which this repo does not have yet.

### 5. Store the credentials outside the repo

A password manager. Not `docs/` (tracked), not a new file anywhere in the tree.

Note that the root `.easignore` **replaces** `.gitignore` for deciding what EAS Build
uploads, so a secret dropped in a new location is not automatically protected from the
builder even if git ignores it — see that file's own header.

The account is not recoverable from this repo. Whoever submits the next build needs these,
and if a reviewer exercises account deletion (Guideline 5.1.1(v)) it is gone and step 4 has
to run again from scratch on a new email.

### 6. Fill in App Store Connect

Paste from the next section. Then submit the build for TestFlight App Review, wait for
**Approved**, and only then create the public link.

### 7. Verify on a clean install

Not in the Firestore console — on a device or simulator, from a fresh install:

1. Sign in with the demo credentials.
2. Home, Stats and Calendar all populate within one sync.
3. The goal ring shows one met goal and one partial.
4. Settings → About → the privacy policy link opens a real page.
5. Account → Data & privacy → the same link, and account deletion is present.

If the data does not appear, check two things in this order: the seeded document IDs
(`unknown-device_<startedAt>_<actualS>`), then `MIN_LOGGED_SESSION_S`. Those are the two
failure modes that look like a sync bug and aren't.

---

## Copy for each App Store Connect field

### TestFlight → Test Information

**Beta App Description** (required):

> Phone Box is the companion app for a physical Bluetooth focus lockbox. Lock your phone in
> the box for a set stretch of time, and the app shows live session status, your focus
> history and stats, per-session labels, focus goals with streaks, and a calendar of past
> and planned sessions. Incoming-call alert-through can light the box up for an important
> call while it stays locked. The app works entirely on-device without an account; signing
> in only adds sync across devices.

**Feedback Email**: `emah@kitchenlab.org`

**What to Test**:

> This beta does not need the Phone Box hardware. Sign in with the account in the review
> notes to see synced focus history, goals, stats and the calendar, then try: tagging and
> re-tagging a past session from the Calendar tab, creating and editing a focus goal,
> scheduling a session, switching theme and accent in Settings, and signing out and back in
> to confirm everything syncs back. If you do have a box, the Home tab's connect flow and
> the live session ring are the parts to exercise.
>
> Known and expected without hardware: the Home tab shows a "Connect your box" state. That
> is not a failure.

**Privacy Policy URL**: `https://phonebox-d14b7.web.app/privacy.html`

Put this wherever your App Store Connect shows a Privacy Policy URL field — the TestFlight
Test Information page, and App Information if an App Store version has been started. Apple's
current help pages do not enumerate that field, so go by what the UI shows rather than by
this doc. Two things are non-negotiable either way: it must be byte-identical to
`PRIVACY_POLICY_URL` in `app/src/legal/legalLinks.ts` (reviewers compare the in-app link
against the one in metadata), and it must return 200 before you submit — step 2.

### TestFlight → Test Information → Beta App Review Information

**Sign-In Required**: **Yes**, with the demo credentials from step 3.

Sign-in is genuinely optional in this app, so arguably this toggle could stay off. Turn it
on anyway: it is the field a reviewer actually reads, and the notes below explain that the
app does not require an account. Do not put credentials only in the notes.

**Contact**: name, email and phone are all required. Use a phone number that will be
answered.

**Notes**:

> Phone Box is the companion app for a physical Bluetooth focus lockbox. The reviewer will
> not have that hardware, so the "Connect your box" state on the Home tab is expected and is
> not a failure.
>
> Everything else in the app is fully exercisable without the box: sign in with the account
> above to see synced focus-session history, goals, stats and the calendar. The account is
> pre-populated with about three weeks of focus sessions, two custom labels, three goals
> (one already met, two in progress) and two scheduled sessions.
>
> Sign-in is optional in normal use — the app runs entirely on-device without an account,
> per Guideline 5.1.1(v). Account creation, sign-out and in-app account deletion are all
> under the Account screen.
>
> Bluetooth is used solely to talk to the box; the app requests no location permission. The
> privacy policy is linked in-app under Settings → About, and under Account → Data & privacy
> once signed in.
>
> Please note: if account deletion is tested on the demo account above, the account is
> permanently destroyed and the credentials stop working. Contact us and we will provision a
> new one.

That last paragraph is deliberate. Apple's own reference says the demo account *"must not
expire"*, and 5.1.1(v) invites the reviewer to delete it — the note is what keeps a deleted
demo account from reading as a broken one on the next round.

---

## What was verified, and how

Both checks ran on 2026-09-09 against the current working tree.

**Firestore rules.** Every payload the seed script produces was written through
`app/firestore.rules` in the Firestore emulator, using the same
`@firebase/rules-unit-testing` harness as `app/tests/firestore-rules`: 1 profile document,
38 sessions, `settings/app`, `goals/config` and 2 scheduled sessions — **43 writes, 43
accepted, 0 rejected**. This matters because the rules validate shapes with `hasOnly` key
allow-lists and a rejected write surfaces as a generic permission error that names no field.

**App-side sanitizers.** The seeded goals and labels were pushed through
`goals/goalSanitize.ts`'s `sanitizeRemoteGoals` and `stats/customLabels.ts`'s
`sanitizeCustomLabels` / `sanitizeExcludedTopicKeys` and came back byte-identical — 3/3
goals, 2/2 labels. A payload the rules accept but a sanitizer silently drops would sync down
and then disappear from the reviewer's screen, which is the harder bug to see.

**Re-runnability.** The script was run twice in a row against the same emulated
account. Run 1 created the profile and 38 sessions; run 2 took the profile *update* path
(`createdAt` pinned to its existing value) and wrote **0** new sessions, leaving the total
at 38 — no duplicates. Separately, re-setting a byte-identical existing session document was
**rejected** by the rules, which confirms the skip-existing logic in `writeSessions` is a
correctness requirement and not an optimisation: the sessions `update` rule requires
`topicUpdatedAt` to strictly increase, and `allow delete: if false` means a wrong write
cannot be cleaned up.

**Session durations.** All 38 seeded sessions are ≥ 60s (`MIN_LOGGED_SESSION_S`) with
integer, non-negative `startedAt`, and an `outcome` of `completed` or `overridden`.

**Privacy policy URL.** `https://phonebox-d14b7.web.app/privacy.html` returns HTTP 200 and
the served bytes are byte-identical to `website/privacy.html` (checked 2026-09-10).

Not verified, because it needs a device and the credentials: the clean-install sync in
step 7.

---

## Out of scope

Do not relax `app/firestore.rules` to make seeding easier. The append-only sessions rule is
load-bearing: sessions are deletable only while `users/{uid}` is absent, which is a state
only `deleteAllUserData` produces. That narrow window is what closed the residual
Guideline 5.1.1(v) risk flagged in the 2026-09-08 pass (account deletion used to orphan
session documents rather than erase them). Widening it would reopen that, and would also
let a stolen client token erase real history.
