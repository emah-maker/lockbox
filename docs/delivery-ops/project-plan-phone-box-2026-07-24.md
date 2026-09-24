# Phone Box — Project Plan

> **DRAFT — Requires Human Approval**
> Date: 2026-07-24
> Owner: Project owner (solo maintainer, light-coder). Planning artifact only — no source was changed to produce this.

## Project Objective

Sequence the Phone Box product — a CircuitPython phone-lock box (Waveshare ESP32-S3-Touch-LCD-1.47) plus an unbuilt React Native companion app — from its current as-built-but-unverified state to a shippable, cost-optimized, connected product, giving the solo maintainer a milestone-level plan with owners, dependencies, and a live risk register.

This plan was synthesized from existing project artifacts (no live stakeholders to interview — this is a solo-maintainer local project with no remote/issue tracker): `docs/roadmaps/phone-box-development-roadmap-2026-07-24.md` (prior code-audit-based roadmap), `docs/rfcs/companion-app-development-approach-technical-design.md`, `docs/procurement/bom.md`, and the project context/rules docs.

**Open uncertainties carried into this plan, not assumed:**
- Whether the owner intends to fund the Apple toolchain (macOS/EAS + $99/yr Apple Dev account + iPhone) that gates the entire app track (see Milestone M4).
- Whether accountability/cloud (Milestone M10) is committed to, or only a future option contingent on validating the subscription tier.

---

## 1. Scope

### 1.1 In-Scope Work (by workstream)

**Firmware verification & hardening**
- Verify SD session logging + on-device Focus stats on real hardware.
- Bring the BLE GATT peripheral online (`adafruit_ble`/`_bleio` vendoring).
- Verify MAX17048 fuel-gauge accuracy upgrade.
- Implement BLE pairing/bonding/encryption before any write-path ships.

**Cost-down / procurement**
- Switch board sourcing to The Pi Hut.
- Bulk-source servo/buttons/battery/wiring.
- Optimize the 3D-print profile.
- Move the lock button on-screen (drop a switch + cutout, keep the physical override).
- Decide battery 2000 mAh → 1000 mAh, gated on measured runtime.

**Companion app**
- Lock in the existing Jest/typecheck regression baseline.
- Ship the BLE read-only Viewer MVP (RFC Step 2).
- Add chunked session-history sync (box + app).
- Wire existing `startLock`/`writeSettings` store actions to UI; add scheduling/profiles (RFC Step 3).

**Accountability / cloud**
- Family/accountability mode, optionally backed by a cloud tier (RFC Step 4).

**Greenlist calling**
- iOS Tier 1 any-call alert-through (`CXCallObserver`).
- iOS Tier 2 per-contact greenlist via VoIP/PushKit (research spike).

**OTA**
- Firmware updates delivered over BLE, gated on BLE security landing first.

### 1.2 Out of Scope

- Writing or shipping any new source code as part of this planning job — this deliverable is planning-only; no firmware/app files are touched.
- Executing the procurement/purchasing itself (RFQs, POs) — only the sourcing plan and savings targets are in scope.
- Enclosure/CAD redesign beyond what's already noted in the BOM — no new mechanical design.
- Android greenlist and any greenlist work beyond iOS Tier 1/Tier 2 — explicitly deferred until the iOS path is proven.
- Marketing, retail packaging, or app-store submission planning.
- Sprint-level task tickets — this plan captures milestones, not day-to-day tasks.

### 1.3 Success Criteria

| Workstream | Definition of done |
|---|---|
| Firmware verification | BLE peripheral reports `enabled=True` on real hardware; SD logging round-trips a session record; fuel gauge reads a live, non-zero %. |
| Cost-down | Per-unit BOM demonstrably reduced from $43.77 toward the ~$28 floor with zero regression to the 7 fixed functions. |
| Companion app Viewer MVP | App scans, connects, and displays live status + history from a real box, matching the RFC §7 validation table. |
| BLE security | Pairing/bonding/encryption implemented and verified before any remote-unlock write path ships to anyone but the owner. |
| Session history + write path | Chunked history characteristic implemented on both sides; scheduling/profiles UI wired to existing store actions. |
| Accountability/cloud, Greenlist | Explicitly scoped as later phases; success = a validated go/no-go decision, plus (if go) a working Tier-1 alert-through on iOS. |

### 1.4 Stakeholder Map (RACI)

| Role | Who |
|---|---|
| **Accountable** | Project owner (solo maintainer, light-coder) |
| **Responsible** | Firmware implementer (CircuitPython), mobile-dev (React Native/Expo), procurement/sourcing — all currently the same owner wearing different hats |
| **Consulted** | Security-architect (BLE pairing/bonding/encryption design), researcher (on-device verification audits) |
| **Informed** | None — no external investors, customers, or leadership; local project with no remote/issue tracker |

---

## 2. Dependency Map

### 2.1 Technical Dependencies

| ID | Dependency | Blocks | Owner | Risk | ETA | Fallback |
|---|---|---|---|---|---|---|
| B1 | `adafruit_ble`/`_bleio` confirmed supported (or vendored) in the board's CircuitPython 10.2.1 build | BLE bring-up; gates 8 downstream steps | Owner (firmware) | **HIGH** | 1 on-device REPL session | None — hard gate on the entire connectivity track |
| B3 | Writable microSD + `sdioio` present in the CP build | SD logging verification; history data source | Owner (firmware) | MED | 0.5 day | Firmware runs without logging (degrades to "NO SD CARD"); not one of the 7 fixed functions |
| B4 | `.podspec` for `CallObserverModule.swift` so Expo autolinking/prebuild compiles | App on-device build (Viewer MVP, greenlist) | Owner (mobile-dev) | MED | 1 session once Apple toolchain available | None until authored; straightforward once attempted |
| B7 | Chunked per-session `history` GATT characteristic — doesn't exist yet, needs design | Session-history sync (both sides) | Owner (firmware + mobile-dev) | MED | Part of history-sync milestone | Viewer MVP can ship on status-only characteristic first |
| B5 | BLE pairing/bonding/encryption — not implemented; CP `_bleio` bonding support on this chip unverified | Safe ship of write path, accountability, OTA | Owner (firmware), consult: security-architect | **HIGH** | Verify during B1 spike; implement before M8/M9 | Remote unlock off by default + 1s rate-limit (not sufficient for a shipped write path) |
| B9 | `eas.json` not configured for EAS cloud-macOS builds | Workaround path for B2 (no local Mac) | Owner (mobile-dev) | LOW | 1 session | None needed — low effort to add |

### 2.2 External Dependencies

| Dependency | External party | Blocks | Owner | Risk | Latest acceptable date | Fallback |
|---|---|---|---|---|---|---|
| **B2** — Apple Developer Program enrollment ($99/yr) + physical iPhone | Apple | Entire app on-device track | Project owner (funding decision) | **HIGH** | Before starting M5 (Viewer MVP) | None — spending/logistics decision; until settled, keep effort on firmware + cost-down tracks |
| Board supplier switch (The Pi Hut) + bulk-sourcing quotes | The Pi Hut, bulk-parts suppliers | Cost-down savings realization (~$12+/unit) | Owner (procurement) | LOW | Ongoing — non-blocking | Continue on current Amazon-sourced BOM at higher unit cost |
| **B6** — MAX17048 #5580 breakout delivery + wiring | Adafruit/Pi Hut/Pimoroni | Fuel-gauge accuracy verification (optional) | Owner (procurement + firmware) | LOW | No hard deadline | Existing voltage-divider + curve estimate remains the shipped baseline |

### 2.3 Internal (Cross-Workstream) Dependencies

| Dependency | Upstream | Downstream | Owner |
|---|---|---|---|
| Viewer MVP cannot start meaningful device work until BLE bring-up (B1) lands | Firmware verification | Companion app | Owner |
| Session-history sync needs both BLE (B1) live and SD logging (B3) verified as the data source | Firmware verification | Companion app | Owner |
| Write path (scheduling/profiles) needs Viewer MVP shipped and BLE command hooks proven live | Companion app (Viewer MVP) | Companion app (write path) | Owner |
| BLE security must land before write path ships broadly, and before OTA | Firmware verification | Companion app write path; OTA | Owner, consult: security-architect |
| Greenlist (iOS) needs the app's on-device build path working and the call overlay live on the box | Companion app device-build track; firmware BLE bring-up | Greenlist | Owner |
| Accountability/cloud depends on write path and BLE security both landing, plus a validated go/no-go | Companion app write path; BLE security | Accountability/cloud | Owner (business decision) |

*Risk legend: HIGH = no fallback, on critical path. MED = fallback exists but adds work. LOW = nice-to-have, not blocking.*

---

## 3. Milestone Sequence

> No external deadline exists anywhere in the project docs (solo side project, no investors/customers/CI). Target dates below are planning estimates paced off the effort sizes in the prior roadmap/RFC, not committed dates — they should slip freely except where explicitly flagged as an owner decision gate.

| Milestone | Target date | Owner | Success criteria | Depends on | Critical path? |
|---|---|---|---|---|---|
| **M0** — Project plan approved | 2026-07-25 | Project owner | This DRAFT reviewed; owner approves, amends, or rejects the phase ordering and scope | None | — |
| **M1** — Bench verification pass | 2026-07-27 | Owner (firmware) | `lock_ble.py` reports `enabled=True` (B1 cleared); a logged session round-trips through SD (B3 cleared); `npm test` + `npm run typecheck` stay green | B1, B3 | ✅ |
| **M2** — Cost-down levers executed | 2026-08-07 | Owner (procurement) | Board resourced via The Pi Hut; bulk quotes locked; print optimized; on-screen lock-button change scoped; cost trending toward ~$28/unit | None (parallel) | — |
| **M3** — Battery fuel-gauge verified (optional) | 2026-07-31 | Owner (firmware + procurement) | MAX17048 wired to I2C 0x36; live accurate % confirmed (B6 cleared) | Physical breakout delivered | — |
| **M4** — Apple toolchain funding decision (owner gate) | 2026-07-31 | Project owner | Explicit go/no-go recorded on funding macOS/EAS + Apple Dev account + test iPhone (B2) | None to decide, but gates every app milestone below | ✅ |
| **M5** — BLE Viewer MVP shipped (RFC Step 2) | 2026-09-18 | Owner / mobile-dev | App scans, connects, bonds, displays live status + history dashboard from a real box, matching every row of RFC §7's validation table | M1, M4, B4, B9 | ✅ |
| **M6** — Session-history sync complete | 2026-10-02 | Owner (firmware + mobile-dev) | Chunked history characteristic implemented on box and app; real per-session history, not just aggregates | M5, B7 | ✅ |
| **M7** — BLE security landed (pairing/bonding/encryption) | 2026-10-16 | Owner (firmware), consult: security-architect | `command`/`settings` characteristics require a bonded connection; verified no unauthenticated client can read/write | B1 spike confirms bonding support | ✅ |
| **M8** — Write path shipped (remote lock, scheduling, profiles) | 2026-11-13 | Owner (mobile-dev + firmware) | `startLock`/`writeSettings` wired to UI; scheduled/recurring locks and multiple profiles work on device; ships only after M7 | M6, M7 | ✅ |
| **M9** — Greenlist Tier 1 (iOS any-call alert-through) | 2026-11-27 | Owner (mobile-dev, iOS) | `CXCallObserver` detects an incoming call while locked; box alert-through fires reliably | M5, M1 | — |
| **M10** — Accountability/family-mode go/no-go | 2026-12-04 | Project owner | Explicit decision recorded on pursuing multi-user accountability + optional cloud backend | M8, M7 | — |
| **M11** — OTA firmware updates over BLE | Not yet scheduled (re-prioritize after M8/M10) | Owner (firmware) | Firmware can be pushed over BLE without bricking risk; never ships before BLE security | M7 (hard gate) | — |

**Critical path:** M1 → M4 (decision) → M5 → M6 → M7 → M8, with M9/M10/M11 branching off after M7/M8 clear. M2 (cost-down) and M3 (battery gauge) are parallel, non-blocking tracks.

**Weekly review focus:** M1, M4, M5, M6, M7, M8 — any slip here pushes the whole connected-product timeline. M2/M3/M9/M10/M11 can slip independently without replanning the critical path.

---

## 4. Risk Register

| ID | Risk | Category | P | I | Sev (P×I) | Prevention | Contingency | Owner |
|---|---|---|---|---|---|---|---|---|
| **R1** | `adafruit_ble`/`_bleio` missing or incomplete in the board's CP 10.2.1 build (B1), silently disabling BLE + 3 dependent features | Technical complexity underestimate | 3 | 5 | **15** | Run the on-device REPL spike (`import _bleio`) in week 1, before any other app-track planning is trusted | Vendor the matching `adafruit_ble` bundle for CP 10.x into `firmware/lib/` and re-verify; if native BLE is genuinely unsupported, re-scope the entire connectivity bet | Owner (firmware) |
| **R2** | Owner delays or declines the Apple toolchain funding decision (M4), stalling the entire app track | External dependency / budget | 3 | 5 | **15** | Force an explicit go/no-go by the M4 target date rather than letting it default by inaction; present the EAS cloud-macOS workaround (B9) as a lower-cost path | If declined, formally re-scope the plan to firmware + cost-down tracks only and shelve M5–M11 | Project owner |
| **R3** | Single-maintainer key-person dependency — no other engineer exists; any extended unavailability stalls every workstream simultaneously | Key-person dependency | 3 | 4 | **12** | Keep this plan and underlying docs (roadmap, RFC, BOM) current enough that a hired freelancer could pick up the Viewer MVP from documentation alone | Prioritize finishing whichever milestone is in flight before starting a new one; consider hiring out the Viewer MVP per the RFC's $5k–20k estimate | Project owner |
| **R5** | CP `_bleio` bonding/encryption support on this ESP32-S3 build is unverified; BLE security (M7) may take longer than estimated or need an app-layer workaround | Technical complexity underestimate | 3 | 4 | **12** | Verify bonding/encryption support as part of the B1 spike (M1), not deferred to M7 | If native bonding is unsupported, fall back to an application-layer shared-secret/challenge scheme and re-estimate as added scope | Owner (firmware), consult: security-architect |
| **R8** | DIY effort to build the Viewer MVP (M5) is underestimated relative to the RFC's own $5k–20k/5–10-week hired-out benchmark | Budget overrun / schedule underestimate | 3 | 4 | **12** | Decide explicitly at M4 whether to DIY-with-AI-assist or hire out, using the RFC's difficulty table (§6a) rather than assuming DIY by default | If DIY stalls past ~2x the estimated timeline, switch to hiring a freelancer using the RFC itself as the brief | Project owner |
| **R4** | iOS `CXCallObserver` cannot supply caller ID by platform design; Tier-2 per-contact greenlist may cost more than estimated or be infeasible | Platform limitation | 3 | 3 | **9** | Ship Tier 1 (any-call alert-through) first; treat Tier 2 as an explicit VoIP/PushKit research spike with its own go/no-go | If VoIP/PushKit proves infeasible, ship Tier 1 only and never promise per-contact filtering of ordinary cellular calls on iOS | Owner (mobile-dev, iOS) |
| **R6** | Scope creep: the RFC's full connectivity vision (accountability/cloud, OTA, multi-tier greenlist) expands this plan into an open-ended greenfield effort | Scope creep | 3 | 3 | **9** | Hold the M1–M11 ordering as source of truth; M10 and M11 require an explicit go/no-go before work starts | Log new feature ideas as candidate milestones for a plan revision rather than pulling them into the current in-flight milestone | Project owner |

*Severity = Probability × Impact (1–5 scale each); focus is on severity > 12.*

**Review cadence:** Solo-maintainer project has no standing status meeting. Treat each work session touching M1–M8 (the critical path) as an implicit risk-register review — re-score R1/R5 immediately after the B1 on-device spike, and re-score R2/R8 immediately after the M4 funding decision.

---

## 5. Recommended Immediate Next Actions

1. Approve or amend this plan (M0).
2. Run the B1/B5 on-device spike (`import _bleio`, test bonding support) — resolves the two highest-severity risks (R1, R5) in one session.
3. Make the Apple toolchain funding decision (M4) explicitly, rather than letting the app track drift without a resourcing answer.
4. Start the parallel, zero-risk cost-down track (M2) — it needs none of the above.
