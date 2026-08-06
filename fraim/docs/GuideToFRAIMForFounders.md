# Guide to FRAIM for Founders

## Overview

FRAIM provides a structured, evidence-based approach to building a startup. This guide maps the founder journey — from initial problem hypothesis through customer discovery, MVP validation, company formation, team building, and fundraising — using FRAIM jobs as the primary execution units, each run by the right FRAIM employee.

## At a Glance

The canonical founder sequence. Each step shows the FRAIM job to run, what it produces, and which earlier steps it depends on. The `recommend-next-job` skill parses this list to detect prerequisites and gate downstream jobs gently. The detailed stage tables further down explain each step in depth.

1. **Explore moonshots** *(optional)* — `blue-sky-brainstorming` → `docs/brainstorming/blue-sky-brainstorming-{date}.md`
2. **Crystallize the problem** — `problem-statement-crystallization` → `docs/business-development/problem-statement-{date}.md`
3. **Validate the idea** *(needs 2)* — `business-idea-validation-and-scoping` → `docs/business-development/business-validation-scoping-{date}.md`
4. **Assess founder–market fit** *(needs 2)* — `founder-market-fit-analysis` → `docs/business-development/founder-market-fit-{date}.md`
5. **Find prospects** *(needs 2, 3)* — `customer-prospect-discovery`
6. **Recruit interviews** *(needs 5)* — `participant-recruitment`
7. **Prep interviews** *(needs 6)* — `interview-preparation`
8. **Process interviews** *(needs 7)* — `process-interview-notes`
9. **Triage findings — Gate 1** *(needs 8)* — `triage-customer-needs`
10. **Validate the MVP** *(needs 9)* — `mvp-validation-plan` (design the test) + `user-facing-prototyping` (build the mockup/prototype) → `docs/product/mvp-validation/{slug}-validation-plan-{date}.docx`
11. **Build the business plan** *(needs 9)* — `business-plan-creation`
12. **Define pricing** *(needs 9)* — `pricing-strategy-definition`
13. **Form the company (legal entity)** *(needs 9, before hiring or fundraising)* — `entity-type-selection`, `state-incorporation-filing`, `ein-application`, `business-tax-registration`
14. **Set founder equity & cap table** *(needs 13)* — `founder-and-equity-agreements`, `cap-table-construction`
15. **Protect the company's IP** *(needs 13)* — `ip-assignment-agreement-creation`
16. **Stand up infrastructure & banking** *(needs 13)* — `domain-registration-research`, `github-org-setup`, `google-workspace-setup`, `website-creation`, `linkedin-company-page-setup`, `x-account-setup`, `business-banking-setup`
17. **Build your team & advisory board** *(needs 13)* — `employment-structure-decision`, then `advisory-board-development` → `advisor-interview` → `advisory-board-selection`
18. **Prepare investor pitch** *(optional, needs 11)* — `investor-pitch-preparation` (includes timed delivery-rehearsal + handoff to a practice tool) → `docs/fundraising/pitch-narrative-{date}.md`
19. **Run weekly operating review** *(ongoing cadence, needs 11)* — `operational-reporting` with `weekly-operating-review` mode

### Ongoing cadences (not part of the linear journey)

- `operational-reporting` — weekly operating reviews, portfolio-impact reports, and stakeholder-status reports from normalized evidence.
- `resilience-planning` — a whole-life resilience plan (work, relationships, finances, health, and identity) so you sustain yourself through the highs and lows. Run early and revisit; founding is a marathon. Run by CAREEna.
- `feature-implementation` — used whenever product work happens, with a security-review phase between validate and regression.

### Which FRAIM employee runs what

| Employee | Owns |
|---|---|
| **BeZa** (business strategy) | idea validation, founder-market-fit, business plan, advisory board (development → interview → selection) |
| **CELiA** (legal & company creation) | entity selection, incorporation, **cap table**, **founder & equity agreements**, **IP-assignment agreements**, **employment-structure decision**, **business banking** |
| **PaM** (product) | feature spec, technical design, **MVP validation plan** |
| **hUXley** (design/UX) | prototyping, design system, brand |
| **GauTaM** (go-to-market) | pricing, GTM motion/stack, funnel, growth, paid media |
| **CAREEna** (career & wellbeing) | **resilience planning**, career coaching |
| **AshLey** (operations) | weekly operating review, stakeholder updates, thank-you notes |

BeZa also owns standalone `competitive-analysis` when a founder needs a focused competitor matrix, differentiation strategy, and threat/opportunity map outside the broader business plan.

---

## The Founder Journey: Phase 1 - Problem Discovery

### Stage 0: Opportunity Exploration (Optional)

**Goal**: Explore breakthrough possibilities and generate multiple directions before committing to specific problems.

| Task | FRAIM Job | What It Does | Output |
|------|-----------|--------------|--------|
| Explore Moonshot Ideas | `blue-sky-brainstorming` | Generate visionary, unconstrained ideas asking "What could we build if anything were possible?" | Breakthrough concepts and future scenarios |

**Key output**: `docs/brainstorming/blue-sky-brainstorming-{date}.md`

---

### Stage 1: Problem Hypothesis & ICP Definition

**Goal**: Define what problem you're solving and for whom, with initial validation.

| Task | FRAIM Job | What It Does | Output |
|------|-----------|--------------|--------|
| Crystallize Problem Statement | `problem-statement-crystallization` | Transforms vague product concepts into testable problem statements and narrow target market definitions | Problem clarity document with validation framework |
| Validate Business Idea & Scope | `business-idea-validation-and-scoping` | Combines hypothesis testing, market research, and strategic scoping to answer "Should we build this?" | Validation and scoping report with MVP scope |
| Assess Founder-Market Fit | `founder-market-fit-analysis` | Analyzes the founder's background, expertise, and network against target-market requirements; identifies co-founder and advisor candidates | Founder credibility assessment with network analysis |

**When to run**: Before talking to customers

---

### Stage 3: Customer Discovery

**Goal**: Talk to 10+ potential customers to validate the problem, current process, and pain intensity.

| Task | FRAIM Job | What It Does | Output |
|------|-----------|--------------|--------|
| Find Prospects | `customer-prospect-discovery` | Build a database of qualified prospects who have expressed your target pain points | Dated dossier + prospects CSV |
| Recruit Participants | `participant-recruitment` | Convert prospects into scheduled interviews using "humble inquiry" outreach | Outreach copy and status |
| Prepare for Interviews | `interview-preparation` | Researches each prospect and generates Mom Test-compliant questions | Interview prep doc + script |
| Log Conversations | `process-interview-notes` | Analyzes each interview, scores fit, flags quote quality | Interview analysis per customer |

**Milestones**: 3 conversations → debrief; 10 conversations → Gate 1.

---

### Stage 4: Gate 1 Decision

| Task | FRAIM Job | What It Does | Output |
|------|-----------|--------------|--------|
| Synthesize Patterns | `triage-customer-needs` | Aggregates insights across interviews; builds a validated JTBD map; evaluates evidence strength | Pass/Flag/Fail decision |

**Gate Criteria**: ✅ Pass (3+ patterns, 3+ customers each, strong quotes) · ⚠️ Flag (thin evidence → 3-5 more interviews) · ❌ Fail (pivot/re-scope).

---

### Stage 4b: MVP Validation (Build → Test → Decide)

**Goal**: Prove the riskiest assumption behind the product with real customers *before* building more.

| Task | FRAIM Job | What It Does | Output |
|------|-----------|--------------|--------|
| Plan the validation | `mvp-validation-plan` | Picks the lightest validation vehicle (mockup vs. concierge MVP vs. prototype), designs a non-leading customer test, and pre-commits the signal that confirms or kills the hypothesis | Validation plan with kill/confirm signal |
| Build the artifact | `user-facing-prototyping` | Builds the mockup/prototype the test runs against | Interactive prototype |

**When to run**: After Gate 1, before investing in a full build. `mvp-validation-plan` is the "validate" counterpart to `user-facing-prototyping`'s "build".

---

### Stage 5: Strategic Planning (Post-Gate 1)

| Task | FRAIM Job | What It Does | Output |
|------|-----------|--------------|--------|
| Create Business Plan | `business-plan-creation` | Porter's Five Forces, TAM/SAM/SOM, network effects, CAC/LTV, competitive positioning | Comprehensive business plan |
| Analyze Competitors | `competitive-analysis` | Builds a focused, source-backed competitor set, matrix, differentiation strategy, threat map, and strategic recommendations | Competitive analysis report |
| Define Pricing Strategy | `pricing-strategy-definition` | Pricing model tied to unit economics and competitive positioning | Pricing strategy doc |

---

### Stage 6: Company Formation, Equity, IP, Infrastructure & Banking

**Goal**: Turn the validated plan into a real, protected company. These are largely **one-time formation tasks**.

#### 6a. Legal Entity and Tax Registration

| Task | FRAIM Job | What It Does | Output |
|------|-----------|--------------|--------|
| Pick a legal entity type | `entity-type-selection` | Evaluates LLC / C-Corp / S-Corp tradeoffs | Entity recommendation |
| File state incorporation | `state-incorporation-filing` | Drafts and files formation documents | Incorporation certificate |
| Apply for an EIN | `ein-application` | Obtains the federal tax ID | EIN confirmation |
| Register for business taxes | `business-tax-registration` | State/local tax registrations | Tax registration evidence |

#### 6b. Founder Equity, Cap Table & IP *(new)*

| Task | FRAIM Job | What It Does | Output |
|------|-----------|--------------|--------|
| Agree founder equity | `founder-and-equity-agreements` | Helps the founding team agree a fair, durable equity split with vesting, roles, and decision-rights, drafting the founder agreement | Founder/equity agreement draft |
| Build the cap table | `cap-table-construction` | Builds an accurate, fully-diluted cap table (founders, option pool, SAFEs/notes) that reconciles to 100% and is ready for fundraising | Cap-table document + spreadsheet |
| Protect the company's IP | `ip-assignment-agreement-creation` | Finds every contributor (incl. contractors) who created IP without a signed assignment and drafts the CIIA/assignment to close the gaps | IP coverage matrix + agreements |

#### 6c. Digital Infrastructure, Presence & Banking

| Task | FRAIM Job | What It Does | Output |
|------|-----------|--------------|--------|
| Research domain options | `domain-registration-research` | Finds/evaluates domain names | Domain recommendation |
| Set up a GitHub organization | `github-org-setup` | Provisions the code org with a security baseline | GitHub org |
| Set up Google Workspace | `google-workspace-setup` | Company email, calendar, drive | Verified Workspace tenant |
| Build the company website | `website-creation` | Public web presence | Live site |
| Set up LinkedIn Company Page | `linkedin-company-page-setup` | Professional presence | Company Page |
| Set up X (Twitter) account | `x-account-setup` | Social handle | X business account |
| Set up business banking *(new)* | `business-banking-setup` | Selects a startup-friendly business bank account for the region and produces the account-opening checklist | Banking recommendation + checklist |

**Key principle**: Stage 6 is infrastructure for later go-to-market work, not go-to-market itself.

---

### Stage 6d: Team & Advisory Board *(new)*

**Goal**: Surround the founder with the right people — structured correctly, and advised well. Advisory-board steps happen at **different times**: development (find + reach out) is up front; interviews are rolling as people respond; selection is a later, one-time decision after test-projects.

| Task | FRAIM Job | What It Does | Output |
|------|-----------|--------------|--------|
| Decide how to engage people | `employment-structure-decision` | Recommends contractor vs. employee (and comp mix / trial periods) per role, with misclassification risk, for the jurisdiction | Per-role structure decision |
| Develop the advisory board | `advisory-board-development` | Uses founder-market-fit gaps to source advisor candidates by competency (via an authenticated LinkedIn People search) and opens warm, connector-led outreach | Advisor target list + outreach |
| Interview an advisor | `advisor-interview` | Per-candidate: prep → interview → score chemistry & value → propose a small test-project (run repeatedly as candidates respond) | Scored interview + test-project |
| Select the board | `advisory-board-selection` | After interviews and test-projects, ranks candidates and selects the board, handing equity to the founder-equity/cap-table jobs | Confirmed advisory board |

---

### Stage 7: Capital Resourcing (Optional / Venture Path)

| Task | FRAIM Job | What It Does | Output |
|------|-----------|--------------|--------|
| Prepare Investor Pitch | `investor-pitch-preparation` | Builds the narrative, deck outline, financial scaffold, and Q&A — and now a **timed delivery-rehearsal** (time-boxed script + checklist) with a **handoff to a recorded-practice tool** (e.g., Yoodli) for pace/filler-word coaching | Investor pitch package |
| Find investors | `fundraising-prospect-discovery` | Identifies and prioritizes the highest-probability investors | Prospect hit list |
| Apply for Cloud Credits | `*-credits-application` | Data-backed cloud-credit applications | Credit application draft |

---

## Choosing Your Path: Bootstrap vs. Venture

### 🟢 The Bootstrap Path (Sustainable Growth)
- **Key Focus**: Stages 1, 3, 4, 4b, and 5.
- **Job Priority**: `customer-prospect-discovery`, `mvp-validation-plan`, and `pricing-strategy-definition`.

### 🔵 The Venture Path (Hyper-Growth)
- **Key Focus**: All Stages (0 through 7), including Team & Advisory Board (6d).
- **Job Priority**: `founder-market-fit-analysis`, `advisory-board-development`, and `investor-pitch-preparation`.

---

## Key Principles

### The Mom Test Alignment
Ask about past behavior, avoid leading questions, focus on specific stories, listen for pain intensity.

### Evidence-Based Decision Making
1 data point = anecdote · 3 = pattern · 10 = validated insight.

### Validate before you build
`mvp-validation-plan` exists so you pre-commit a kill/confirm signal and test with real customers before sinking time into a full build.

### Look after the founder
Founding is a marathon with real highs and lows. `resilience-planning` builds a whole-life plan — including diversifying identity beyond "the founder of X" — so you can go the distance.

---

## Common Pitfalls

- ❌ **Don't skip problem crystallization** before validation.
- ❌ **Don't skip validation** before the business plan.
- ❌ **Don't rush Gate 1** with <10 interviews.
- ❌ **Don't build before validating the MVP** — design the kill/confirm signal first (`mvp-validation-plan`).
- ❌ **Don't leave founder equity unvested or the cap table informal** — run `founder-and-equity-agreements` + `cap-table-construction` early.
- ❌ **Don't assume contractors assigned their IP** — run `ip-assignment-agreement-creation` to close the gaps.
- ❌ **Don't grant advisor equity before a test-project** — let `advisor-interview`/`advisory-board-selection` earn it.

---

*Last updated: 2026-06-04*
