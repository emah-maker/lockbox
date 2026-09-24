# Evidence — BOM-derived features and iOS notification access (fully-delegate)

**Issue:** phone-box-bom-ios-notifications
**Job:** fully-delegate (manager)
**Date:** 2026-07-24
**Status:** DRAFT — Requires Human Approval

## Summary

Researched two independent questions: what additional product features the existing BOM
components could support beyond the prior ideation document, and whether there is another way
besides the previously documented options to surface iOS notifications through the box. Both
threads are research/ideation only; no firmware or app code was changed.

## Work Completed

Delegated as two independent nodes (no dependency between them, ran in parallel):

| Task | Persona | Job | Iterations | Verdict |
|------|---------|-----|-----------|---------|
| bom-feature-ideation | researcher | blue-sky-brainstorming | 2 | pass (iteration 1 failed on a session quota limit, not content; iteration 2 passed) |
| ios-notification-research | researcher | blue-sky-brainstorming | 1 | pass |

### Deliverables
- `docs/brainstorming/phone-box-bom-features-and-ios-notifications-2026-07-24.md` (canonical markdown source)
- `docs/brainstorming/phone-box-bom-features-and-ios-notifications-2026-07-24.docx` (review surface, rendered via `scripts/md_to_docx.py`)

### Key findings carried into the synthesis
- 9 net-new feature ideas grounded in components already in the BOM (servo analog range,
  fuel-gauge voltage signal, the two buttons, touchscreen, BLE advertising/scanning, and the SD
  card slot, which is wired in hardware but has no driver anywhere in current firmware).
- One of those findings (Settings view has no access control, so the lock can be defeated by
  editing the override-press count on-screen) is a live security gap in shipped behavior, not a
  speculative feature, and is called out separately in the synthesis for independent triage.
- ANCS (Apple Notification Center Service) identified as a global, no-app, no-MFi-certification
  BLE path for full iOS notification content, changing the prior "iOS restricted by design"
  framing. One open item: unconfirmed whether this board's CircuitPython BLE stack supports
  Central role (needed for ANCS) concurrently with the Peripheral role already used for the
  planned companion app.

## Validation

- Both research nodes were required to read the actual BOM (`docs/procurement/bom.md`) and the
  prior ideation document (`docs/brainstorming/phone-box-feature-ideation-2026-07-20.md`) before
  proposing anything, and the BOM node additionally read the live firmware
  (`firmware/lib/lock_*.py`) so nothing already implemented or already proposed was repeated.
- The iOS research node was required to cite primary sources (Apple's ANCS specification,
  existing CircuitPython/ESP32 ANCS client libraries) rather than rely on unverified recall,
  given Apple's notification/accessory rules changed in March 2026.
- `.docx` render confirmed: `Wrote docs/brainstorming/phone-box-bom-features-and-ios-notifications-2026-07-24.docx`.
- No source files were modified; this is a research/ideation deliverable only.

## Quality Checks
- Both delegated nodes reached verified-complete status; one correction cycle was a retry after
  an infrastructure failure (session quota), not a content coaching cycle → confidence MEDIUM.
- Deliverable carries the DRAFT — Requires Human Approval banner.
- Every Part A idea is tagged with the BOM component(s) it builds on and cross-checked against
  what the prior ideation doc and current firmware already cover; every Part B candidate carries
  an explicit feasibility verdict and sources.

## Human Approval Checklist
1. Confirm whether the Settings access-control gap (Part A, idea 4) should be triaged as a bug
   fix now, independent of the rest of this document.
2. Decide whether to greenlight a hardware spike to confirm CircuitPython BLE Central + Peripheral
   dual-role operation on this ESP32-S3 board, which gates both the ANCS finding (Part B) and the
   proximity-gated override idea (Part A, idea 8).
3. Select which, if any, of the 9 Part A feature ideas, or the 7 Part A2 feature ideas, to carry
   into the roadmap or a follow-on technical-design pass.
4. Decide whether to reframe the existing Deep-dive B document's iOS section to lead with ANCS,
   as recommended, or keep this as a standalone addendum.
5. Confirm whether Part A2 ideas 1 (brownout/reset silently unlocks early) and 2 (no critical-battery
   safety-net release mid-lock) should be triaged as reliability fixes now, alongside idea 4.
6. Approve or request changes on Part A2, the third-round ideation pass appended after initial approval.

## Feedback Round 1
*Received: 2026-07-24*

### Item 1 - ADDRESSED
- **Feedback:** "1. approve, 2. yes" — approved Parts A and B as submitted; authorized a third,
  independent BOM-feature-ideation pass (Part A2).
- **Status:** ADDRESSED. Parts A and B approved with no changes requested. Ran a third ideation
  pass (`bom-feature-ideation-pass3`, persona researcher, job blue-sky-brainstorming, 1 iteration,
  pass), explicitly barred from repeating Part A, Part B, or the 2026-07-20 document. Returned 7
  further ideas, including two more live gaps in shipped firmware (brownout/reset early-unlock,
  no critical-battery safety-net release). Appended as Part A2 to
  `docs/brainstorming/phone-box-bom-features-and-ios-notifications-2026-07-24.md`, updated the
  executive summary, execution trace, risk flags, and approval checklist, and regenerated the
  `.docx`. Part A2 itself is DRAFT, pending its own approval.
