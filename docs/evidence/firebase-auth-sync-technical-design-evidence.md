# Feature: Firebase Auth (Google Sign-In) + Firestore Cross-Device Sync/Backup
Issue: n/a — conversational-mode design task, no issue tracker/branch/PR for this workstream (per manager instruction)
Feature Spec: none exists; the manager's direct instructions (relayed in this session) are the spec of record
PR: n/a — no branch/PR; RFC returned directly to Mandy for review

## Completeness Evidence
- Issue tagged with label `phase:design`: N/A (no issue tracker in play for this task)
- Issue tagged with label `status:needs-review`: N/A
- All files committed/synced to branch: N/A (conversational mode — RFC + this evidence file written to the working tree, no branch/commit made)
- PR Comment / How Addressed: N/A — no PR feedback exists yet; this is the initial design submission

### Traceability Matrix

| Requirement (from manager's brief) | RFC Section / Data Model | Status | Validation Plan Alignment |
|---|---|---|---|
| Firebase Auth with Google provider for account sign-in | "OAuth / PKCE flow (detailed)" | Met | Validation Plan rows: "Sign in with Google (fresh device)", "Revoke Google access" |
| Firestore for cross-device sync/backup of `app/src/stats` and `app/src/store` data | "Data model (Firestore)" — `/users/{uid}/sessions/*` (stats/session history), `/users/{uid}/settings/preferences` + `/settings/boxMirror` (store data) | Met | "Sign in on a second device" row |
| OAuth/PKCE flow via `expo-auth-session` + `expo-web-browser` | "OAuth / PKCE flow (detailed)", steps 1-6 | Met | "Sign in with Google" rows; pre-implementation spike recommended in Spike Findings for the EAS-build-specific redirect behavior |
| Token storage via `expo-secure-store` / Keychain | "Token storage" section | Met | Covered as a design/rules property, not independently runtime-testable pre-implementation; flagged for the later security-review pass per the manager's explicit ask |
| Firestore security rules — per-user data isolation | "Firestore security rules (per-user isolation, least privilege)" | Met | "Read another user's Firestore doc..." and "Directly edit or delete a session doc" rows (Rules Playground / emulator) |
| Least-privilege service configuration | "Least-privilege service configuration" (Google-only provider, minimal OAuth scopes, App Check recommendation, no Admin SDK/backend) | Met | Not independently runtime-testable pre-implementation; documented as a configuration checklist for implementation + security review |
| What happens to already-local AsyncStorage data during migration/first sync | "AsyncStorage → Firestore migration plan" (never deleted, additive mirror, union/last-write-wins merge, idempotent retry) | Met | "Sign in with Google (device with existing local sessions)" and "Sign out" rows |
| Design explicit enough for a later security-review pass | Whole document, esp. Token storage, Security rules, Least-privilege config, Risks & Mitigations | Met | N/A (this is a documentation-completeness requirement, not a runtime scenario) |

No `Unmet` rows — every item in the manager's brief is addressed with a concrete RFC section and a corresponding Validation Plan row (or an explicit statement of why it is a configuration/documentation requirement not independently runtime-testable before implementation exists).

## Due Diligence Evidence
- Reviewed feature spec in detail (if feature spec present): N/A — none exists; manager's brief reviewed in detail instead
- Reviewed codebase in detail to understand and repro the issue: Yes — read `app/package.json` (confirmed zero auth/backend deps), `app/src/store/useStore.ts`, `app/src/store/useSettingsStore.ts`, `app/src/stats/{stats,sessionHistory,topics}.ts`, `app/src/storage/storage.ts`, `app/app.json`, and the prior `docs/rfcs/companion-app-development-approach-technical-design.md`
- Included detailed design, validation plan, test strategy in doc: Yes

## Prototype & Validation Evidence
- [ ] Built simple proof-of-concept that works end-to-end — not built; this is a design-only deliverable, no Firebase project exists yet in this repo (see "Help needed" in Spike Findings)
- [ ] Manually tested complete user flow (browser/curl) — not applicable pre-implementation
- [ ] Verified solution actually works before designing architecture — not applicable; every component used (expo-auth-session, Firebase Auth, Firestore rules) is a well-documented, named-by-the-manager technology, not a novel unverified one (see RFC "Spike Findings")
- [x] Identified minimal viable implementation — RFC's phased "Touched surfaces" + migration plan describes the minimal additive change set (no restructuring of existing BLE/local-store logic)
- [x] Documented what works vs. what's overengineered — RFC explicitly rejects a server/Admin-SDK-backed approach in favor of client-direct-to-Firestore-with-rules, and defers Firebase App Check + Cloud-Function-based account-deletion cascade as later-phase hardening rather than building them now

## Continuous Learning

| Learning | Agent Rule Update |
|---|---|
| `fraim/personalized-employee/context/project_context.md` is stale for this repo in two ways: it describes the app-level context nowhere (it's firmware-only) and it wrongly claims "not a git repository... no remote, issue tracker" when a real GitHub remote exists (confirmed via `fraim_connect`). No rule file updated in this pass — flagged in the RFC's Architecture Analysis section as a decision item for Mandy, since correcting `project_context.md` project-wide is outside this task's scope and should be a deliberate edit, not a side effect of one RFC. |
