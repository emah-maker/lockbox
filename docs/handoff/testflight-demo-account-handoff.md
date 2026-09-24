# Handoff: create and seed the App Review demo account for Phone Box

## Original ask (verbatim, for provenance)
> write a handoff file for an agent to set up the test login

## Where this came from
The 2026-09-08 TestFlight-compliance pass closed the code-side gaps (in-app privacy
policy link, privacy manifest, release logging) and left three things that are not code.
This is the largest of them. The other two are one-liners: deploy `website/privacy.html`
to Firebase Hosting, and fill in the App Store Connect metadata fields.

## Improved task prompt (use this instead)

Create the account Apple's reviewers sign in with during Beta App Review, seed it so the
app has something to show on a device that has no Phone Box hardware, and record the
credentials where App Store Connect expects them.

Deliverables:
1. A demo account in the `phonebox-d14b7` Firebase project, created through email/password
   (the only one of this app's three sign-in methods a reviewer can use without owning a
   Google or Apple account you control).
2. A committed, re-runnable seed script under `scripts/` that populates that account's
   Firestore data. Committed **without** credentials — it should read them from the
   environment or prompt.
3. The credentials stored somewhere that is not this repository, and entered into App
   Store Connect.
4. Review notes explaining the Bluetooth hardware dependency.

## Why the seed script matters more than it looks

A reviewer signing into an empty account sees an app with no stats, no goals, no calendar
history, and no box to connect to — which reads as "incomplete", the most common
Guideline 2.1 rejection. Seeded data is what makes the app demonstrable without hardware.

The script is also the recovery path. Guideline 5.1.1(v) means the reviewer may well
**test account deletion**, which permanently destroys this account (`deleteAllUserData` +
`deleteUser`). If they do, the next submission round needs a new account from scratch. Do
not set this up by hand-clicking; you will be doing it again.

## Approach: use the client SDK, not the Admin SDK

Sign the script in as the demo user with `firebase/auth`'s `signInWithEmailAndPassword`,
then write with `firebase/firestore` as that user. Reasons, in order of importance:

- It writes through `app/firestore.rules` instead of around them, so a seed that succeeds
  proves the shape is one a real client could have produced. An Admin SDK write bypasses
  rules and can leave data the app itself would be denied from updating later.
- It needs no service-account key. This repo has no Admin SDK dependency anywhere, and
  `firestoreSync.ts`'s `deleteAllUserData` header explicitly calls a privileged Cloud
  Function out of scope for the client-only design. Adding a key to `app/.secrets/` for a
  one-off seed is a bigger change than the task warrants.
- The config it needs already exists: `app/.env` holds the `EXPO_PUBLIC_FIREBASE_*`
  values, and `app/src/auth/firebaseConfig.ts` shows the shape.

## Traps this repo will spring on you

Read these before writing a line. Most are one-way doors.

1. **Seeded sessions can never be deleted.** `app/firestore.rules`'s
   `match /sessions/{sessionId}` ends with `allow delete: if false` — deliberate
   append-only integrity, not an oversight. A malformed or embarrassing seed is permanent
   for that account. Dry-run against a throwaway account first, or be ready to burn the
   demo account and make another.

2. **A session shorter than 60s will sync down and then vanish.** `sessionHistory.ts`'s
   `MIN_LOGGED_SESSION_S = 60` filters sub-minute entries out of the local log on load.
   Seed `actualS >= 60` or the reviewer sees Firestore rows that never appear in the app —
   which looks exactly like a sync bug.

3. **Session document IDs are deterministic and must match.**
   `sync/sessionMerge.ts`'s `sessionDocId` is `` `${deviceId}_${startedAt}_${actualS}` ``.
   Use a stable made-up `deviceId` (the app falls back to `'unknown-device'` when it has
   none). Get this wrong and the next real sync writes a second document for the same
   session, permanently double-counting it in every stat.

4. **The sessions `create` rule is strict.** Keys are limited to
   `startedAt`/`plannedS`/`actualS`/`outcome`/`topic`/`topicUpdatedAt`; `outcome` must be
   `'completed'` or `'overridden'`; the three numbers must be non-negative ints; `topic`
   caps at 200 chars. Read the rule rather than guessing — a rejected write surfaces as a
   generic permission error that says nothing about which field was wrong.

5. **Email Enumeration Protection is enabled on this project.** A wrong password and a
   nonexistent account both come back as `auth/invalid-credential`. Do not debug by error
   code; you will conclude the wrong thing. See `emailAuth.ts`'s `signInWithEmail` comment.

6. **Email verification is not enforced anywhere.** `createAccountWithEmail` fires a
   best-effort verification email, but no screen gates on `user.emailVerified`. The demo
   account works unverified, so you do not need access to the mailbox — which is good,
   because you probably shouldn't use a real one.

7. **Password minimum is 6.** `EmailPasswordFields.tsx`'s `MIN_PASSWORD_LENGTH`, enforced
   client-side before Firebase sees it. Pick something a reviewer can retype without
   error: no ambiguous characters, no leading/trailing spaces.

8. **Verify the provider is on first.** If Email/Password is not enabled under Firebase
   console → Authentication → Sign-in method, account creation fails with
   `auth/operation-not-allowed` and nothing else in this plan works.

9. **Other collections have their own schemas.** `goals/config` (array capped at 20 by
   rules; per-goal validation lives in `app/src/goals/goals.ts`), `settings/app`, and
   `scheduledSessions/{planId}` each have a `hasOnly` key list in `firestore.rules`. Build
   payloads from the app's own writers — `firestoreSync.ts`'s `goalsPayload` /
   `localSettingsPayload`, and `scheduledSessionsSync.ts`'s `toRemote` — rather than
   hand-rolling shapes.

10. **Do not commit the password.** `app/.secrets/` and `.env` are git-ignored; `docs/` is
    not. Note that the root `.easignore` replaces `.gitignore` for EAS uploads, so a
    secret dropped in a new location is not automatically protected from the builder.

## What to seed

Enough that every tab has something to show, and nothing that looks like test garbage to a
human reviewer:

- **Sessions** — a few weeks of history, several per week, plausible durations, tagged
  across a mix of built-in topics and one or two custom labels. This drives Home's ring,
  the whole Stats tab, and the calendar heat map.
- **Goals** — two or three active, at least one already met and one in progress, so the
  goal ring and streak surfaces are not empty. Keep reminders off; a reviewer does not
  want notifications from a demo account.
- **Custom labels** — one or two, so the label UI is not an empty state.
- **Scheduled sessions** — one or two in the near future so the Calendar tab has content.
- **Profile** — `users/{uid}` with `email`/`displayName`/`photoURL`. Give it an
  unremarkable display name.

Leave `pushTokens` alone. Those are per-device and the app writes them itself.

## Where the credentials go

- **App Store Connect → the app version → App Review Information → Sign-In Required**:
  username and password. This is what the reviewer actually reads.
- **TestFlight → Test Information**: beta app description, "What to Test", and the
  feedback email (`<developer email>`). External testing will not start without these.
- **Review notes** — draft, adapt as needed:

  > Phone Box is the companion app for a physical Bluetooth focus lockbox. The reviewer
  > will not have that hardware, so the "Connect your box" state on the Home tab is
  > expected and is not a failure. Everything else in the app is fully exercisable
  > without it: sign in with the account above to see synced focus-session history,
  > goals, stats and the calendar. Sign-in is optional in normal use — the app runs
  > entirely on-device without an account. Bluetooth is used solely to talk to the box;
  > the app requests no location permission. The privacy policy is linked in-app under
  > Settings → About, and under Account → Data & privacy once signed in.

## What "done" looks like

- Email/Password is confirmed enabled in the Firebase console.
- A demo account exists and can be signed into from the app on a clean install.
- Signing in on that clean install populates Home, Stats and Calendar with the seeded data
  within one sync — verified on a device or simulator, not just in the Firestore console.
  If it does not appear, the doc-ID or the 60-second filter is the first thing to check.
- `scripts/seed-demo-account.(js|ts)` is committed, re-runnable, and reads its credentials
  from the environment. `git diff` shows no password anywhere.
- Credentials are recorded in App Store Connect's App Review Information, and the
  TestFlight Test Information fields are filled in.
- The credentials are also stored somewhere durable outside the repo, because whoever
  submits the next build will need them and they are not recoverable from here.

## Out of scope

Do not change `app/firestore.rules` to make seeding easier. The append-only sessions rule
is load-bearing and there is a separate open question about it (account deletion leaves
session documents orphaned rather than erased — flagged in the 2026-09-08 pass as the one
residual Guideline 5.1.1(v) risk). Decide that on its own merits, not as a side effect of
this task.
