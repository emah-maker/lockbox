# FRAIM Compliance & Audit Brief
**For: Engineering Leaders, Legal, Compliance, and Risk Teams**
**Version:** 1.0 | April 2026

---

## Executive Summary

FRAIM is an AI management platform that provides structured workflows, review gates, and organizational learning for engineering teams using AI coding assistants (Claude, Cursor, Copilot, etc.). This document addresses how FRAIM supports compliance, audit readiness, and data governance requirements for regulated industries.

**Bottom line:** FRAIM makes AI-assisted engineering auditable. Every job produces a structured evidence trail. FRAIM collects metadata only — no source code, no PII, no customer data.

---

## 1. What FRAIM Collects (and What It Doesn't)

### Collected (Metadata Only)
| Data | Example | Purpose |
|------|---------|---------|
| Job name | `feature-implementation` | Track what type of work was done |
| Phase transitions | `context-review → implement-design → implement-build` | Audit trail of workflow stages |
| Completion status | `completed`, `abandoned at phase 3` | Quality and process metrics |
| Timestamps | `2026-03-15T14:30:00Z` | Timing and duration analysis |
| User identifier | `engineer@company.com` | Attribution and team analytics |
| Success/failure | `true/false` | Quality tracking |
| Skill invocations | `code-analysis`, `compliance-checker` | Capability usage tracking |
| Session metadata | Agent name, IDE, platform | Environment context |

### Never Collected
| Data | Guarantee |
|------|-----------|
| Source code | FRAIM never reads, stores, or transmits source code |
| Code diffs or patches | No code content crosses the FRAIM boundary |
| Customer/user PII | No names, SSNs, financial records, or personal data |
| API keys or secrets | Never captured in job metadata |
| Database contents | No query results, schema data, or record contents |
| Chat/prompt contents | The actual prompts and responses between engineer and AI stay in the IDE |

**Architecture guarantee:** FRAIM operates as a workflow orchestration and telemetry layer. It sits between the engineer and the AI agent, managing *what work happens in what order* — not *what the work contains*. The AI model (Claude, GPT, etc.) processes the code. FRAIM manages the process around it.

---

## 2. How Structured Jobs Support Audit Readiness

### The Problem With Unmanaged AI
When engineers use AI coding assistants directly (raw Claude, Copilot, Cursor without FRAIM), there is no record of:
- What was generated vs. what was human-written
- Whether the output was reviewed before deployment
- Whether compliance checks were performed
- Who approved the work and when
- Whether established SOPs were followed

This creates an audit gap: the organization cannot demonstrate that AI-assisted work met the same governance standards as traditional development.

### How FRAIM Closes the Gap

**Structured jobs** are multi-phase workflows with defined entry/exit criteria:

```
feature-implementation job:
  Phase 1:  implement-scoping              ← Scope the work, understand requirements
  Phase 2:  implement-repro                ← Reproduce the bug (bugs only)
  Phase 3:  implement-tests                ← Write failing tests first (TDD)
  Phase 4:  implement-code                 ← Write the implementation
  Phase 5:  implement-validate             ← Run tests, UI validation, manual verification
  Phase 6:  implement-regression           ← Full regression suite
  Phase 7:  implement-quality              ← Code quality and standards review
  Phase 8:  implement-completeness-review  ← Verify all requirements met
  Phase 9:  implement-architecture-update  ← Update architecture docs if needed
  Phase 10: implement-submission           ← PR creation, final review
  Phase 11: address-feedback               ← Respond to PR review comments
  Phase 12: retrospective                  ← Capture learnings for L1/L2 system
```

At each phase transition, FRAIM:
1. **Logs the transition** with timestamp and user ID
2. **Enforces review gates** (seekMentoring) — the agent cannot proceed without human review
3. **Records the outcome** — did the phase complete successfully?
4. **Captures skill invocations** — was the compliance-checker run? Was test-runner used?

**The result:** Every job produces a timestamped, phase-by-phase evidence trail that answers:
- *What work was done?* → Job name and category
- *Who did it?* → User identifier
- *What process was followed?* → Phase sequence with timestamps
- *Were review gates enforced?* → seekMentoring events logged
- *Were compliance checks performed?* → Skill invocation records
- *Was the work completed to standard?* → Completion status and success rate

---

## 3. SOP Enforcement Through Job Structure

### Traditional SOP Compliance
Most organizations enforce SOPs through documentation (wikis, runbooks) and trust (engineers are expected to follow them). Compliance verification happens retroactively — during audits, code reviews, or incident investigations.

### FRAIM SOP Compliance
FRAIM encodes SOPs directly into job workflows. Examples:

| SOP Requirement | FRAIM Enforcement |
|----------------|-------------------|
| "Code must be reviewed before deployment" | `implement-validate` phase with mandatory review gate |
| "Database migrations must have rollback plans" | `write-migration` phase requires both up and down scripts |
| "Compliance checks before schema changes" | `compliance-checker` skill invoked automatically in data jobs |
| "No direct commits to main branch" | Job workflow creates feature branch; org preference enforced |
| "Security review for customer-facing changes" | `implement-validate` phase includes security checklist |

**Key difference:** SOPs are not just documented — they are **executed and logged**. The agent cannot skip a required phase. When an auditor asks "how do you enforce SOP X?", the answer is "it's built into the workflow and we have phase-level evidence of every execution" — not "we have a wiki page."

---

## 4. Organizational Learning as Compliance Intelligence

### L1 (Individual) and L2 (Organization) Learning

FRAIM captures recurring patterns across the engineering organization:

**Mistake Patterns (compliance-relevant examples):**
- "Engineers skip UI validation before declaring implementation complete" → 12 incidents across 4 engineers
- "Hardcoded English strings break localization for international operations" → 7 incidents
- "Database migrations deployed without rollback scripts" → 5 incidents, 2 reached production

**Manager Coaching (process enforcement examples):**
- "Compliance jobs must loop in legal before the remediation phase" → prevents 60% rework rate
- "Migration jobs should be paired: database + API together" → prevents compatibility gaps

**Why this matters for compliance:** These patterns surface systemic risks that would otherwise be invisible. Traditional audits find point failures. FRAIM's learning system finds patterns — "this type of mistake happens across multiple engineers on multiple teams" — and prevents recurrence.

---

## 5. Compliance-Specific Job Types

FRAIM includes pre-built job workflows designed for regulated environments:

| Job | Purpose | Audit Value |
|-----|---------|-------------|
| `compliance-audit` | Systematic audit preparation: scope, evidence collection, review, remediation, reporting | Produces structured findings with code path references |
| `database-migration` | Schema changes with mandatory rollback plans | Evidence of forward + rollback scripts, test execution |
| `feature-implementation` | Standard development with review gates | Phase-level evidence of design review, testing, validation |
| `code-review` | Structured PR review with feedback documentation | Evidence of review criteria, findings, and resolution |
| `deploy-to-production` | Production deployment with pre-checks, smoke tests, rollback plan | Evidence of deployment governance |

---

## 6. Data Residency and Security

| Concern | FRAIM's Position |
|---------|-----------------|
| **Data residency** | Telemetry metadata stored in customer-specified region (Azure Cosmos DB) |
| **Encryption at rest** | AES-256 via Azure managed encryption |
| **Encryption in transit** | TLS 1.2+ for all API communication |
| **Access control** | API key per user; manager-team relationships control visibility |
| **Data retention** | 90-day TTL on usage events (configurable); customers can request deletion |
| **No code transmission** | Source code never leaves the engineer's machine or IDE |
| **No PII collection** | Only email addresses (for user identification) and job metadata |
| **Third-party sharing** | FRAIM does not share customer metadata with any third party |
| **SOC 2 / ISO 27001** | In progress (contact us for current status) |

---

## 7. Frequently Asked Questions

**Q: Does FRAIM see our source code?**
No. FRAIM orchestrates workflows and collects metadata (job names, phase transitions, timestamps). The AI model processes the code within the engineer's IDE. No code content is transmitted to FRAIM.

**Q: Can FRAIM be used as evidence in a regulatory audit?**
Yes. Every job produces a structured evidence trail: phases executed, review gates passed, skills invoked, timestamps logged. This evidence can demonstrate that AI-assisted development followed your organization's established SOPs.

**Q: What happens if an engineer bypasses FRAIM and uses Claude/Cursor directly?**
FRAIM tracks adoption through the analytics dashboard. Managers can see which team members are running structured jobs and which are not. This visibility gap is itself an audit finding — FRAIM helps you identify where AI is being used without governance.

**Q: How does FRAIM handle PII that might appear in job names or arguments?**
FRAIM's job metadata schema does not capture prompts, code, or data content. The `args` field captures job parameters (e.g., `{action: "start"}`) but not user data or code. Organizations can configure additional redaction rules if needed.

**Q: Can we self-host FRAIM?**
Contact us for self-hosted deployment options for organizations with strict data residency requirements.

---

## 8. Summary: FRAIM's Compliance Value Proposition

| Without FRAIM | With FRAIM |
|---------------|------------|
| AI usage is a black box — no record of what was generated, reviewed, or approved | Every job produces a timestamped, phase-level evidence trail |
| SOPs are documented in wikis and enforced by trust | SOPs are encoded in job workflows and enforced by the system |
| Compliance checks are manual, periodic, and retroactive | Compliance checks are automated, continuous, and built into workflows |
| Organizational risks surface during incidents or audits | Organizational risks surface as patterns in real-time |
| Auditors ask "how was this reviewed?" and the answer is "we're not sure" | Auditors ask "how was this reviewed?" and the answer is a structured log |

---

*For questions or to schedule a security review, contact: sid.mathur@gmail.com*
