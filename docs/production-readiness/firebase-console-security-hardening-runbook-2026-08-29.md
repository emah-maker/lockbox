# Firebase/GCP Console Security Hardening Runbook — 2026-08-29

Project: `phonebox-d14b7`

This is a **console-work checklist**, not a code change. Nothing here is deployed or
edited from the repo — every step is a click-path in the Firebase console or the
Google Cloud (GCP) console, performed by the project owner. Work through it top to
bottom; each section is ordered so the safe, non-breaking steps come first and the
steps with real breakage risk come with a verify-immediately-after step and a fast
rollback.

## Read this first: what the API key finding actually means

The Firebase browser API key currently has **no application restrictions** in the
GCP console. That is a real finding, but don't over-read it: **the key being public
is expected, not the bug.** Every value in `app/.env` is `EXPO_PUBLIC_*`, and Expo
inlines those into the shipped app bundle at build time; the website fetches the
same shape of config at runtime from Firebase Hosting's reserved
`/__/firebase/init.json` path (see `website/js/firebaseConfig.js`'s header comment).
Anyone with the app binary or the deployed site already has these values by design —
a Firebase web API key is a project/app **identifier**, not a credential, and it was
never meant to be secret.

The actual access-control boundary is `app/firestore.rules`. Restricting the key
limits blast radius and quota abuse (defence in depth) — it does not, by itself,
protect any data. Do not treat "restrict the key" as if it closes a data-exposure
hole; it doesn't. Keep the rules file as the thing you'd actually audit for that.

---

## Part A — Restrict the API key(s)

### A1. Find out how many keys you actually have (read-only, do this first)

A single GCP API key can carry only **one** application-restriction type at a time —
HTTP referrers, IP addresses, Android apps, or iOS apps are mutually exclusive on
one key (the GCP console presents them as a single-select control). Firebase's own
docs confirm the project likely already has more than one key: Firebase
auto-provisions a separate key for each platform — a **Browser key** when the
project/web app was created, an **iOS key** when the Apple app was registered, and
an **Android key** when the Android app was registered — each pre-scoped with its
own default API allow-list. *(Verified against current Firebase docs,
`firebase.google.com/docs/projects/api-keys`, 2026-08-29.)*

So before touching anything, go to:

> **GCP Console → APIs & Services → Credentials**
> `https://console.cloud.google.com/apis/credentials?project=phonebox-d14b7`

and read the **API keys** list. You're looking for names like:
- `Browser key (auto created by Firebase)`
- `iOS key (auto created by Firebase)`
- `Android key (auto created by Firebase)`

**Branch here:**

- **If you see three (or more) distinct auto-created keys** — this is the expected
  case. Each client (website, iOS app, Android app) already has its own key, so
  restricting one does not touch the others. Continue to A2–A4 below; it's three
  independent edits.
- **If you see fewer than three** (e.g., everything is sharing one key, or the
  key(s) don't have the "auto created by Firebase" naming) — **stop and do not
  apply an application restriction yet.** Restricting a shared key to one client's
  restriction type (say, HTTP referrers for the website) will immediately break
  every other client using that same key (native apps get zero traffic through an
  HTTP-referrer-restricted key, since a native request carries no referrer header).
  In that case you need to provision dedicated keys per platform first — either by
  re-triggering Firebase's auto-provisioning (re-downloading/re-registering the
  iOS/Android app config from **Firebase console → Project settings → General →
  Your apps**) or by manually creating additional keys on the Credentials page —
  and confirming which key each client (`app/.env`'s
  `EXPO_PUBLIC_FIREBASE_API_KEY`, the iOS `GoogleService-Info.plist`, the Android
  `google-services.json`, and the website's Hosting-served config) is actually
  using, before restricting anything. That's a bigger change than this runbook
  covers — treat it as its own task if you land here.

The rest of Part A assumes the expected case: three distinct keys.

### A2. API restrictions (allow-list) — apply to all three keys

This is separate from the application restriction below: API restrictions limit
*which Google APIs* a key can call, regardless of caller. Based on what this repo
actually imports (checked against `app/package.json`, `app/src/auth/firebase.ts`,
`app/src/sync/firestoreSync.ts`, and every `website/js/*.js` Firebase import — all
of it is `firebase/app`, `firebase/auth`, `firebase/firestore`, and (once Part B
lands) `firebase/app-check`; nothing imports Storage, Messaging/FCM, Remote Config,
or Analytics), allow-list:

- **Identity Toolkit API** (Firebase Auth sign-in)
- **Token Service API** (`securetoken.googleapis.com` — Auth token refresh)
- **Cloud Firestore API**
- **Firebase Installations API** (used internally by Auth/App Check — needed even
  though nothing calls it directly)
- **Token Service API for App Check** / **Firebase App Check API** — needed once
  Part B's App Check registration lands; if you're doing Part A before Part B is
  merged, come back and add this after.
- **Firebase Hosting API** — website key only, if it isn't already default-included.

Do **not** add: Cloud Storage, Cloud Messaging (FCM), Remote Config, or Analytics —
this repo uses none of them. If you're ever unsure whether something is used,
err toward adding it back rather than guessing wrong the other way: omitting an API
that's actually in use is an outage; listing one that isn't used is harmless
clutter.

Apply this same allow-list to all three keys (Browser, iOS, Android) — API
restrictions are independent of the application-restriction branching above.

### A3. Application restrictions — one per key, safest-first

Do these in this order so that if something goes wrong, you find out on the
lowest-traffic surface first.

**3a. iOS key → iOS bundle ID restriction**
- Restriction type: **iOS apps**
- Bundle ID: `com.emahmaker.phonebox`

**3b. Android key → Android app restriction**
- Restriction type: **Android apps**
- Package name: `com.phonebox.app`
- SHA-1 signing certificate fingerprint: this project builds via EAS, so the
  signing key is EAS-managed, not local. Get it from either:
  - `https://expo.dev` → your project → **Credentials** → Android → the active
    build credential → SHA-1 fingerprint, or
  - running `eas credentials` (select Android → view credentials) from `app/`.
  - If both a Google Play App Signing key and an EAS-managed upload key exist,
    add **both** SHA-1s — Play re-signs the app for distribution with its own
    key, and a restriction keyed to only the upload cert will block production
    installs.

**3c. Browser key → HTTP referrer restriction (do this last — highest breakage risk)**
- Restriction type: **HTTP referrers (web sites)**
- Add every one of these — an outage here is the most likely failure mode in this
  whole runbook:
  - `https://phonebox-d14b7.web.app/*`
  - `https://phonebox-d14b7.firebaseapp.com/*`
  - Any live custom domain, if one is later attached to Hosting (at the time of
    writing, `website/index.html` uses `phonebox.example.com` as a placeholder —
    confirmed no real custom domain is wired up yet, so this doesn't apply today).
  - **Preview channels**, which get a generated subdomain of the form
    `phonebox-d14b7--<channel-id>-<hash>.web.app`. Add a wildcard pattern:
    `https://phonebox-d14b7--*.web.app/*`
    **Flagging this as unverified**: GCP's referrer-restriction wildcard support is
    documented for a *leading* subdomain wildcard (`*.example.com/*`); whether a
    `*` is accepted in the middle of a subdomain label like this is not something
    Context7's current Firebase docs confirmed either way. Add the pattern, save,
    and deploy a test preview channel (`firebase hosting:channel:deploy test`) to
    confirm sign-in/Firestore actually works from it before trusting it. If the
    console rejects the pattern or it doesn't work in practice, the fallback is
    the broader `https://*.web.app/*` (matches any Firebase-Hosting-served site,
    not just this project's preview channels — wider than ideal, but functional).
  - Also add `http://localhost/*` if you ever test the site with
    `firebase emulators:start` or `firebase serve`.

### A4. Verify — don't assume it worked

After each edit (A2 and each of 3a/3b/3c), **wait ~5 minutes** — GCP API key
restriction changes are not instant, and testing immediately after saving is the
most common reason people think a *correct* change failed. Then:

- **Website**: open the live site and a preview channel, sign in, and confirm the
  waitlist form on `index.html` still submits. Watch the browser console for:
  - `auth/requests-from-referer-...-are-blocked` (Auth blocked by the referrer
    restriction)
  - `API_KEY_HTTP_REFERRER_BLOCKED` (Firestore/other API blocked by the referrer
    restriction)
  - *(These are the commonly-seen identifiers for this failure mode; treat the
    exact wording as approximate; the console's own error banner is the source of
    truth if you hit one.)*
- **iOS/Android app**: sign in and confirm Firestore sync still works in a build
  using the same credentials you restricted against (a EAS internal/preview build,
  not just a dev client pointed at a different, unrestricted key).

**Rollback, fast**: if anything breaks, go back to the key's **Application
restrictions** setting and set it to **None**, save, wait the same ~5 minutes, and
re-verify. That fully undoes the application restriction on that one key without
touching the others.

---

## Part B — Enable Firebase App Check (reCAPTCHA v3) on the website — monitor only, do not enforce

Another change is adding Firebase App Check to the website's Firebase init
(`website/js/appCheck.js` — currently shipped disabled, with an empty
`RECAPTCHA_SITE_KEY`) to guard `app/firestore.rules`' `waitlist/{docId}` create
rule, which today is the only thing standing between the open internet and
unlimited waitlist writes (a script can hit the Firestore REST API directly with
random doc IDs and made-up emails; the rule's dedupe-by-hashed-doc-ID only caps
*repeat* signups, not distinct ones — see that rule's own comment in
`app/firestore.rules`). This section is the console half that code alone can't do.

### B1. Create the reCAPTCHA v3 site + register the web app (safe, no user-facing effect)

> **Firebase console → Build → App Check → Apps**
> `https://console.firebase.google.com/project/phonebox-d14b7/appcheck`

- Register the website's web app, provider: **reCAPTCHA v3**.
- This creates a **site key** and a **secret key**.
  - The **site key** is public by design — same category as the Firebase API key
    itself. It goes into `website/js/appCheck.js`'s `RECAPTCHA_SITE_KEY` constant
    (that file's header comment already documents this — it's the only line that
    needs to change in that file).
  - The **secret key** must **never** be committed to this repo. It stays only in
    the Firebase console (App Check uses it server-side to validate tokens); there
    is no client-side use for it at all.

### B2. Turn on Monitoring mode for Cloud Firestore — not Enforce

In the same App Check console page, under **APIs**, find **Cloud Firestore** and
set it to **Monitor**. This starts recording which requests carry valid/missing/
invalid App Check tokens without rejecting anything — nothing breaks yet.

### B3. Watch metrics before deciding on enforcement — and expect an "unverified" band that is normal

Give this some time under real traffic before touching the Enforce toggle. Signup
volume on this site is low, so "some time" means watching across at least a few
real waitlist submissions, not a fixed clock duration — check the **App Check →
Metrics** tab for the Firestore API and confirm:

- Requests tagged **verified** correspond to real website traffic (i.e., actual
  waitlist submissions and dashboard sign-ins going through App Check
  successfully).
- **You will also see a large "unverified" band, and this is expected, not a
  problem.** The Phone Box mobile app talks to this same Firestore database
  (`app/src/auth/firebase.ts` uses the plain `firebase` JS SDK — there is no
  `@react-native-firebase/*` App Check integration in this codebase, and the web
  SDK's App Check providers, ReCaptchaV3/ReCaptchaEnterprise/Custom, all assume a
  browser DOM, so they don't apply to the React Native runtime as it exists
  today). Once the website is registered, **100% of the app's legitimate traffic
  will show as unverified** on this dashboard, because the app has no way to
  attach an App Check token at all. Do not read that band as abuse, and do not
  let it push you toward enforcing sooner — see B4.

### B4. Do NOT enable Firestore enforcement while the app is unregistered — this is a resolved decision, not an open question

**This is the most important item in Part B.** App Check enforcement is set
**per project, per service** (Cloud Firestore here) — not per client. If you flip
Cloud Firestore from Monitor to **Enforce**, Firestore starts rejecting *every*
request that lacks a valid App Check token, including 100% of the mobile app's
traffic, project-wide. Because `app/firestore.rules` gates essentially everything
through `isOwner(uid)` behind a deny-by-default catch-all, this isn't a corner
case — it breaks every signed-in user's ordinary reads and writes to their own
`users/{uid}/...` data, across the entire app, immediately.

This was evaluated and decided against for now: the app uses the plain Firebase
JS SDK, and native App Check attestation (App Attest on iOS, Play Integrity on
Android) is only available through `@react-native-firebase/app-check`, which
lives on a separate native Firebase-app registry from the JS SDK the app uses
today — adopting it would be a client-library migration, not a quick add-on.
Given every Firestore path the app touches is already authenticated and
owner-scoped, that migration isn't justified by this risk alone.

**So: enable Monitor for Cloud Firestore, confirm the website's own traffic shows
as verified, and stop there.** Leave enforcement off.

Revisit this if either becomes true later:
- Real abuse shows up against `users/{uid}/...` paths specifically (not the
  waitlist path App Check is actually meant to guard) — that would be a different,
  worse problem than what this runbook addresses.
- The app is migrated to `@react-native-firebase/*` for some other reason (native
  offline persistence, Crashlytics, etc.) — at that point adding native App Check
  attestation becomes close to free, and enforcement can be reconsidered.

---

## Part C — Monitoring for unbounded session-document growth (accept-and-watch, no enforcement to build)

Finding: nothing caps how many documents a signed-in user can create under their
own `users/{uid}/sessions` subcollection. This can't be fixed in
`app/firestore.rules` at all — rules evaluate a `create` before the document
exists, so there's no `resource` to compare a write against for a per-user rate
limit; Firestore rules simply cannot count existing documents in a collection.

This is lower severity than Parts A and B, and the decision here is deliberately
cheap: **accept the risk, watch for it, don't build enforcement.**

- **It's self-inflicted and cost-only, not a data-exposure issue.** `isOwner(uid)`
  means a user can only bloat their *own* subtree — never anyone else's data.
- **A Cloud Function was considered and rejected as disproportionate.** This
  project has zero Cloud Functions today (`functions/` doesn't exist; root
  `firebase.json` only has `hosting` and `firestore` keys) — standing up Blaze
  billing and a whole new runtime surface to guard against a cost-only risk isn't
  worth it right now.
- **App Check (Part B) does not close this gap**, and don't let it give false
  comfort. App Check attests that a request came from a genuine app instance; it
  says nothing about whether that instance's legitimate, signed-in owner is
  scripting their own client to hammer creates under their own uid.
- **Legitimate volume is naturally tiny.** Session documents come from the
  physical box's BLE history sync, with sub-60-second sessions filtered out
  before they're written — a very heavy real user produces on the order of a few
  thousand documents a year, not a runaway number.

### Checklist

1. **Set a GCP Cloud Billing budget alert on `phonebox-d14b7`.** This is the
   highest-value item here — zero engineering, actionable today.
   > **GCP Console → Billing → Budgets & alerts**
   > `https://console.cloud.google.com/billing/budgets?project=phonebox-d14b7`
   Set two or three thresholds above your normal expected spend (exact dollar
   figures aren't given here — current Firestore pricing wasn't independently
   verified for this doc, so pick thresholds based on what you already expect to
   pay day-to-day, not a number from this runbook).
2. **Optional**: add a Cloud Monitoring alerting policy on Firestore's write-count
   metric, or just periodically check the **Firestore → Usage** tab in the
   Firebase console. If you go the alerting-policy route, the metric is
   `firestore.googleapis.com/document/write_ops_count` *(verified against current
   Firebase docs, `firebase.google.com/docs/firestore/enterprise/use-monitoring-dashboard-mongodb`,
   2026-08-29 — note this is `write_ops_count`, not `write_count`)*.
3. **If a billing or usage alert ever fires**, treat it as a one-off: write a
   small Admin SDK script (which runs with elevated access and bypasses rules) to
   inspect the offending `uid`'s `sessions` subcollection and prune it manually.
   Don't build a standing guard rail reactively under pressure — that's how you
   end up with the disproportionate-Cloud-Function outcome this section already
   decided against.
4. **What would change this decision**: if a Cloud Function gets added later for
   an unrelated reason, a per-write counter (e.g., a Firestore-triggered function
   maintaining a count field, checked by a rule against a reasonable ceiling)
   becomes nearly free to bolt on at that point. Not worth standing up on its own.

---

## Summary — suggested execution order

1. Part A1 — check key count (read-only).
2. Part B1–B3 — register App Check, Monitor mode, watch metrics. (Safe throughout;
   never reaches enforcement in this runbook.)
3. Part A2 — API allow-lists on all three keys.
4. Part A3 — application restrictions, iOS → Android → Website (referrer last).
5. Part A4 — verify each, with the ~5 minute propagation wait and the fast
   None-restriction rollback if anything breaks.
6. Part C — billing budget alert (do any time; it's independent of the above).
