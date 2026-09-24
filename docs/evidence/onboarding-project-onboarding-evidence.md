# Evidence — Project Onboarding: Phone Box

## Summary
- **Job:** project-onboarding
- **Project:** Phone Box — a physical phone-lockbox that helps people focus by
  locking a phone inside for a set time.
- Onboarded the project into a FRAIM-ready state: bootstrapped FRAIM, captured
  durable project context and rules, recorded a cost baseline, and validated the
  written config.

## Work Completed
- Ran `npx fraim init-project` (project had no `fraim/` scaffolding; not a git repo).
- Wrote `fraim/config.json` — project name/industry, `mode: conversational`,
  `customizations.architectureDoc` → project context file. No validation
  commands (on-device CircuitPython firmware has no host build/test).
- Wrote `fraim/personalized-employee/context/project_context.md` — product
  purpose, `firmware/` firmware layout, hardware target (Waveshare ESP32-S3
  1.47" Touch board; unused Wi-Fi/BLE noted), 7 key functions, cost baseline
  table, cost structure, and the local batch-write+sync deploy workflow.
- Wrote `fraim/personalized-employee/rules/project_rules.md` — CircuitPython-only
  constraint, `lock_config.py` as pin-map authority, no host tests, deploy
  routine, and cost-reduction priorities (board → battery → servo, functions
  preserved).

## Cost baseline captured (prototype volume, functions negotiable)
Estimated per-prototype BOM ≈ **$40.77** (includes a ~$0.50 mechanical override
switch on `GPIO10`). Waveshare board **~61%**, battery **~21%**, servo **~10%**,
all other parts **<8%** combined. Firmware uses no Wi-Fi/BLE, so the board's
radio is unused cost — the primary cost-down lever.

## Validation
- `npx fraim workspace-config validate` → **"Validated fraim\config.json"**.
- First run failed because empty `customizations.validation.*` commands are
  rejected; resolved by removing the validation block (no host build/test
  exists). Re-validation passed.
- `project_context.md` and `project_rules.md` confirmed present, non-empty,
  valid Markdown.

## Quality Checks
- All three durable artifacts written and validated.
- Context vs. rules split kept crisp ("what is true" vs. "how to behave").
- Facts anchored to repo-relative paths (`firmware/lib/lock_config.py`, CAD files).

## Feedback History
### Round 1 (2026-07-19) — ADDRESSED
- **Item 1:** BOM was missing a mechanical override switch. Added a ~$0.50/unit
  panel-mount momentary override switch (`GPIO10` / `BTN_OVERRIDE_PIN`) to the
  BOM in `project_context.md`; per-prototype total updated $40.27 → $40.77.
  Re-validated config clean. Full record in
  `docs/evidence/onboarding-project-onboarding-feedback.md`.

## Phase Completion
sync → scope → write → validate → submit completed, then one feedback round
(override switch) re-ran write → validate → submit. No blockers.
