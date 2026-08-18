# Whole-product audit — fully-delegate evidence

**DRAFT - Requires Human Approval**

## Executive summary
Goal: audit the whole product (box firmware, companion app, website) for improvements, dispatched after GSAP animation work landed on the website. Three independent workstreams ran in parallel, all findings-only (no auto-fix). All three passed manager review on the first iteration.

**Confidence: High on process** (all first-iteration passes, no escalations) **but the companion-app workstream returned a FAIL gate with one Critical, launch-blocking finding.** This is not a process risk, it's the actual substantive finding of the audit: the product has a real, verified data-integrity/privacy gap that needs a human decision before anything ships to a device that could ever be shared, resold, reset, or re-signed into.

## Delegation ledger
| Task ID | Persona | Job | Status |
|---|---|---|---|
| website-audit | web-dev | production-readiness-review | Verified-complete, iteration 1 |
| box-firmware-audit | firmware-dev | production-readiness-review | Verified-complete, iteration 1 |
| companion-app-audit | mobile-dev | production-readiness-review | Verified-complete, iteration 1 |

## Sub-agent work and manager verdicts

### 1. Website audit (web-dev)
- Evidence: `docs/quality-assurance/website-gsap-ux-a11y-audit-2026-08-17.md`
- Gate: flag (informal — infra dimensions N/A for a static frontend)
- **Manager verdict: PASS.** Independently reread `index.html`, `script.js`, `nav.js`, `dashboard.js`, `dashboard.css` and reproduced all 8 findings exactly, including the one with real business impact.
- Key finding: nearly the entire marketing homepage is gated behind a scroll-reveal (`.reveal`) whose only reveal path is a JS `IntersectionObserver`, with no `<noscript>`/timeout fallback — if that script fails, the whole page (hero, CTAs, pricing) stays permanently invisible. Pre-existing site architecture, not introduced by the GSAP work.
- GSAP itself confirmed clean: two first-load moments on `index.html` only, correctly gated behind `window.gsap` + `prefers-reduced-motion`; `dashboard.html` deliberately has zero GSAP, a documented restraint choice, not a partial rollout.
- Also: dashboard calendar contrast failure (~1.3:1), missing ARIA state on calendar day buttons, duplicated nav-scroll logic, missing SRI on the GSAP CDN tag, ungated demo interval, tablet grid orphan.
- Iterations: 1.

### 2. Box firmware audit (firmware-dev)
- Evidence: `docs/production-readiness/production-readiness-review-box-firmware-2026-08-17.md`
- Gate: flag (0 critical, 1 high, 2 medium, 2 low)
- **Manager verdict: PASS.** Independently traced the brownout-counter logic across `code.py`/`safemode.py` and reproduced the exact failure sequence; confirmed all other findings against `lock_settings.py`, `lock_controller.py`, `lock_config.py`, and `project_context.md`.
- Key finding (High): `code.py` clears the brownout-retry counter before any hardware initializes, so a brownout triggered later by servo current draw (a risk the codebase's own comments already flag) can never accumulate past the safe-mode retry cap — defeating the exact guarantee it exists to provide. Device could reset-loop indefinitely on a marginal battery.
- Also: settings NVM writes aren't debounced during hold-to-repeat (~12 writes/sec, flash-wear risk), BLE `sleep` setting skips the input-validation its siblings get, an inverted code comment, and two stale claims in `project_context.md` (line-count, and a broad "lock_log.py removed" claim that's actually only true of the on-screen stats view).
- No board run was performed for any finding — correctly disclosed throughout as static-analysis, not reproduced failures.
- Iterations: 1.

### 3. Companion app audit (mobile-dev)
- Evidence: `docs/production-readiness/production-readiness-review-phone-box-companion-app-2026-08-17.md`
- Gate: **FAIL** (1 critical, 4 high, 15 medium, 15 low)
- **Manager verdict: PASS on audit quality** (the FAIL gate is the correct, evidence-backed conclusion, not a workstream defect). Independently verified the critical finding and all 4 high findings against live source:
  - Read `useAuthStore.ts` in full: confirmed `signIn`/`signOut`/`deleteAccount` never touch local session/settings storage, only `user`/`lastSyncedAt`/`syncError`.
  - Read `wipeStaleSessionOnFreshInstall.ts`: confirmed it only wipes stale Keychain state on a *fresh install*, a different scenario from the claimed sign-out/account-switch leak on the *same install* — does not mitigate the critical finding.
  - Confirmed `syncNow`'s re-entrancy guard is a bare boolean with no uid binding, and confirmed `SettingsScreen.tsx:260` gates "Sign out" on local `busy` only, not the store's `syncing` — reproducing the exact race described.
  - Confirmed `waitForPoweredOn` has no timeout/reject path, confirmed `handleHistory`'s async-read-then-clear race, and confirmed `WheelPicker.tsx` has zero accessibility props via direct grep.
- **Critical finding**: local AsyncStorage session history and settings are never scoped or cleared by Firebase uid. On a shared/resold/reset device, or a corrected wrong-account sign-in, one person's full session history and topic labels can upload into a different person's Firestore account and merge into their Stats screen; a returning account's cloud settings can be silently overwritten. Verified this is a genuine gap, not an accepted risk — the sync RFC's own manual QA checklist ("logout performs a full wipe") only ever tested Keychain/auth state, never local storage.
- The BLE↔firmware wire contract (`protocol.ts` vs `Box-code/lib/lock_config.py`) was cross-checked and is clean, no drift.
- Iterations: 1.

## Risk areas
None from a process standpoint (all three workstreams passed first-iteration manager review with no corrections). The substantive risk is the companion app's Critical finding above — flagged for explicit human decision, not something MANdy is authorized to resolve unilaterally (no code changes were requested or made; this run was findings-only across all three workstreams).

## Human approval checklist
- [ ] **Priority decision needed**: how to sequence the companion-app Critical finding (cross-user local-storage leakage) relative to other work — this blocks treating the app as launch-ready for any device that could be shared, resold, reset, or re-signed into.
- [ ] Decide whether to delegate remediation of the Critical + 4 High companion-app findings as a follow-up `feature-implementation` (or bug-fix) workstream.
- [ ] Decide whether to delegate remediation of the firmware High finding (brownout-counter timing) similarly.
- [ ] Decide whether to act on the website's one High finding (`.reveal` no-JS fallback) and the two Medium accessibility findings (calendar contrast, calendar ARIA state).
- [ ] Confirm no action needed on the still-outstanding items not covered by this run: the app-icon task, and the stats-window-persistence diff (still separately pending your approval from the earlier cycle).
- [ ] Note: all three audits used the `production-readiness-review` job template; the website workstream flagged (and MANdy agrees) that five of its six infra dimensions don't fit a static, backend-less frontend — worth routing this class of request to a dedicated QA/UI-polish job in future, captured as a signal for `sleep-on-learnings` rather than acted on here.

## Catalog gap signal
`production-readiness-review`'s six-dimension infra scorecard (security/HA/backup/observability/release-safety/governance) is designed for a backend/service subject. It forced awkward N/A-ing of most dimensions for the website (static frontend) and partial mismatch for the firmware (no host build/test, no watchdog/observability surface by platform design). Both child workstreams adapted reasonably by substituting the actually-relevant audit dimensions rather than forcing the template, but this is a recurring signal that a lighter-weight "product audit" job without the infra-scorecard assumption would fit this project's non-backend surfaces better. Captured for `sleep-on-learnings`, not acted on directly.
