# Guide to FRAIM for Accelerators

## Overview

FRAIM gives accelerator and venture-program operators something most of them have never had: **real-time optics into the quality of founder work across every stage of the cohort**, plus a sponsor-ready impact report at the end. While your founders run FRAIM jobs to crystallize problems, run customer discovery, build business plans, and prep pitches, you watch the signal land in your analytics dashboard live. When a founder's interview quality is declining, you know in the week it happens, not at demo day. When sponsor reporting season arrives, FRAIM turns the same signals into a defensible impact report with full source lineage.

This guide maps the accelerator operator lifecycle from program design through sponsor reporting and retrospective, using FRAIM jobs as the primary execution units and the FRAIM analytics dashboard as the cohort optics layer. It applies to accelerators, incubators, VC funds, corporate venture arms, government innovation programs (NSF I-Corps Hubs, ARPA-E, EDA), and university tech-transfer offices.

## Cohort Optics in the FRAIM Analytics Dashboard

This is where most accelerator operators will spend their time. When a founder runs FRAIM jobs, the signals surface on `/analytics/` in near real time.

### Team accordion

Your team accordion lists every founder in your cohort. Each row, collapsed, shows:

- **Activity indicator:** how the founder is progressing in their journey, and how much are they leveraging AI.
- **Quality indicator:** quality of each phase of the founder journey.

Expanding a row reveals two tabs per founder:

### Activity tab

Jobs run, event counts, dominant job categories, and cadence. Tells you *what* a founder is doing in any given week, and whether they have disappeared into silence.

### Quality tab

A tile grid, one tile per founder-journey stage:

- **Customer Development** (interview quality trajectory, Gate 1 status, discovery coaching)
- **Business Strategy** (business plan and pricing quality, once the founder reaches that stage)
- **Product Quality** (code quality grade, if the founder is building)
- **Test Quality** (test coverage and standards)
- **Fundraising** (pitch quality, once the founder reaches demo-day prep)
- **Go-to-Market** (marketing strategy and launch readiness)

Each tile shows a current composite score, trend arrow (improving, stable, declining), and a mini sparkline of recent scores. Clicking a tile opens a detail panel with:

- **Score history chart** across the stage's full timeline
- **Latest assessment** with sub-dimension breakdown (for example, for interviews: participant fit, evidence quality, past-behavior evidence)
- **Coaching card** with the current recommendation the founder's agent surfaced (for example: "Follow up with 'walk me through the last time that happened' to get past-behavior evidence")
- **Assessment list** scrollable by date

### What you actually do with it

Three operator moves show up repeatedly:

1. **Intervene early.** When a founder's Gate 1 decision flips to `flag` or `fail`, or their interview quality trends downward over two or three weeks, the row goes amber or red. You reach out to that founder before office hours even happen. The intervention is now grounded in specific evidence ("your last three interviews scored below five on past-behavior evidence; let's work on pull-past questions") rather than generic encouragement.
2. **Spot pattern across the cohort.** If four out of seven founders are scoring low on the same dimension, the bottleneck is the program, not the founders. Curriculum adjusts.
3. **Prioritize coaching time.** Green-dot founders get less synchronous time, red-dot founders get more, all grounded in current-week quality data.

### Relationship to sponsor reporting

The dashboard is one input to the annual `operational-reporting` portfolio-impact mode, not the whole picture. The report also covers follow-on funding (SBIR, STTR, federal and state grants, equity rounds), jobs created and hiring trajectory, IP (patents filed, assigned, licensed), revenue and federal contracts, company status (active, acquired, shut down, pivoted), MSI and HBCU participation, and institutional or regional-node activity for federated programs. Most of that evidence comes from public sources (SBIR.gov, NSF Awards, SEC EDGAR, USPTO, Secretary of State registries) and from program records (intake forms, NSF Hub award numbers, cohort rosters), not from the dashboard.

What the dashboard contributes to the report is the qualitative spine: how engaged each founder was, how their customer-discovery quality trended, where coaching interventions happened, which stages produced strong work and which did not. That turns an otherwise number-heavy report into one with defensible founder-level narrative. You are not scrambling at year-end to reconstruct what happened in the cohort. The signals have been accumulating all along, and the report job stitches them together with the financial, hiring, and IP evidence pulled from the public record.

---

## At a Glance

The canonical accelerator operator sequence. Each step shows the FRAIM job to run, what it produces, and which earlier steps it depends on. The `recommend-next-job` skill parses this list to detect prerequisites and gate downstream jobs gently. The detailed stage tables further down explain each step in depth.

1. **Crystallize program thesis** — `problem-statement-crystallization` → `docs/business-development/problem-statement-{program}.md`
2. **Validate program strategy** *(needs 1)* — `review-business-strategy`
3. **Define program brand and positioning** *(needs 2)* — `marketing-strategy-definition` → `docs/marketing/marketing-strategy-{program}.md`
4. **Build the program website** *(needs 3)* — `website-creation`
5. **Respond to corporate-sponsor RFPs** *(optional, ongoing)* — `rfp-response-preparation` → `docs/commercial-ops/rfp-response-preparation-{sponsor}-{date}.md`
6. **Source and profile founder candidates** *(needs 3)* — `customer-prospect-discovery` → `docs/customer-development/customer-prospect-discovery/customer-prospect-discovery-{date}.md`
7. **Onboard the cohort** *(needs 6)* — `send-thank-you-notes`
8. **Shepherd founders through the founder journey** *(ongoing during cohort, needs 7)* — direct founders to [Guide to FRAIM for Founders](GuideToFRAIMForFounders.md)
9. **Run weekly program ops** *(ongoing cadence)* — `operational-reporting` with `weekly-operating-review` mode → `docs/business-ops/operating-review-{date}.md`
10. **Support demo-day pitch prep** *(late cohort, per founder, needs 8)* — `investor-pitch-preparation` → `docs/fundraising/pitch-narrative-{founder}-{date}.md`
11. **Support post-program fundraising** *(ongoing portfolio support, per company)* — `fundraising-prospect-discovery`
12. **Send portfolio and sponsor newsletters** *(ongoing cadence)* — `send-newsletter`
13. **Report cohort impact to sponsors** *(annual or quarterly, needs 9)* — `operational-reporting` with `portfolio-impact` mode → `docs/business-ops/portfolio-impact-report-{program}-{date}.md`

### Ongoing cadences (not part of the linear cycle)

- `operational-reporting` with `weekly-operating-review` mode — weekly brief covering cohort progress, sponsor commitments, pipeline of applicants, and decisions that need attention. Run once the cohort is active. Writes `docs/business-ops/operating-review-{date}.md` each week.
- `rfp-response-preparation` — whenever a corporate partner issues a sponsorship or partnership RFP. Produces a requirement-response matrix with assumptions and open questions for internal review before the response goes out.
- `send-newsletter` — portfolio updates for sponsors, alumni, and ecosystem partners on whatever cadence the program commits to (monthly, quarterly).
- `operational-reporting` with `portfolio-impact` mode — quarterly brief or annual impact document. Often the primary deliverable for federal grants, sponsor contracts, and LP reports.

---

## The Accelerator Operator Journey

### Stage 1: Program Setup and Positioning

**Goal:** Define what the program does, who it serves, and how it reaches founders and sponsors.

| Task | FRAIM Job | What It Does | Output |
|---|---|---|---|
| Crystallize program thesis | `problem-statement-crystallization` | Turns a vague program concept into a tested, falsifiable thesis about which founders you serve and what gap you close | Program thesis document |
| Validate program strategy | `review-business-strategy` | Stress-tests the thesis, deal flow assumptions, and operating model before commitment | Strategy review |
| Define program brand and positioning | `marketing-strategy-definition` | Produces positioning, messaging pillars, and channel strategy for founder and sponsor acquisition | Marketing strategy |
| Build the program website | `website-creation` | Program-facing site with application flow, cohort criteria, mentor and sponsor pages | Website deliverable |

**When to run:** Before the first application opens, or when repositioning between cohorts.

**Key outputs:**
- `docs/business-development/problem-statement-{program}.md`
- Strategy review and positioning artifacts
- Live program website

---

### Stage 2: Cohort Recruitment and Onboarding

**Goal:** Find the right founders, select the cohort, and set them up for a fast start.

| Task | FRAIM Job | What It Does | Output |
|---|---|---|---|
| Source and profile founder candidates | `customer-prospect-discovery` | Builds a ranked list of prospective founders or teams using public signal and program-fit criteria | Dated dossier plus dated prospects CSV in `docs/customer-development/customer-prospect-discovery/` |
| Respond to corporate-sponsor RFPs | `rfp-response-preparation` | Produces a requirement-response matrix with assumptions and open questions for internal review before a sponsor pitch | RFP response package |
| Onboard the cohort | `send-thank-you-notes` | Welcomes accepted teams, captures intake records, and kicks off kickoff communications | Cohort welcome artifacts |

**When to run:** In the weeks before each cohort starts.

**Key outputs:**
- Applicant pool and selection record
- Signed sponsor commitments
- Cohort intake records (the same records the `operational-reporting` portfolio-impact mode will later pull against)

---

### Stage 3: Cohort Execution

**Goal:** Move each portfolio founder from problem through validated product-market-fit signal, while running the program itself on a weekly cadence.

Accelerators do not run founder jobs for their founders. They shepherd founders through the founder journey documented separately, and they watch cohort progress live through the FRAIM analytics dashboard (see "Cohort Optics" section above). Most of the operator's day-to-day attention during an active cohort happens on `/analytics/`, not in drafting new artifacts.

| Task | FRAIM Job | What It Does | Output |
|---|---|---|---|
| Shepherd founders through validation | See [Guide to FRAIM for Founders](GuideToFRAIMForFounders.md) | Founders run `problem-statement-crystallization`, `business-idea-validation-and-scoping`, `founder-market-fit-analysis`, `customer-prospect-discovery`, `interview-preparation`, `process-interview-notes`, `triage-customer-needs` | Founder-owned artifacts |
| Support business planning | `business-plan-creation`, `pricing-strategy-definition` | Founders build the business plan and pricing once customer discovery finishes | Founder business plan and pricing |
| Run weekly program ops | `operational-reporting` with `weekly-operating-review` mode | Weekly brief covering cohort progress, sponsor commitments, and decisions that need attention | `docs/business-ops/operating-review-{date}.md` |
| Support demo-day pitch prep | `investor-pitch-preparation` | Per-founder pitch narrative and deck outline aligned to demo-day evaluators | `docs/fundraising/pitch-narrative-{founder}-{date}.md` |

**When to run:** Across the active cohort window, typically 8 to 16 weeks.

**Key outputs:**
- Founder-journey artifacts per team (problem statements, interview analyses, triage documents, business plans)
- Weekly operating review cadence established
- Demo day pitch narratives per founder

---

### Stage 4: Ongoing Portfolio Operations

**Goal:** Keep alumni close, support follow-on capital, and maintain sponsor and ecosystem relationships.

| Task | FRAIM Job | What It Does | Output |
|---|---|---|---|
| Support post-program fundraising | `fundraising-prospect-discovery` | Builds a ranked investor list per portfolio company, with outreach angles informed by each company's stage and sector | Per-company investor prospect list |
| Support follow-on pitch prep | `investor-pitch-preparation` | Updated pitch narrative for the next round, post-traction | Updated pitch narrative |
| Portfolio and sponsor newsletters | `send-newsletter` | Regular ecosystem updates for sponsors, alumni, mentors, and LPs | Published newsletter |
| Sponsor and mentor thank-yous | `send-thank-you-notes` | Relationship maintenance with sponsors and mentors who invested time in the cohort | Sent thank-you batch |

**When to run:** Continuously after the cohort graduates. Newsletter and operating review cadences run indefinitely.

---

### Stage 5: Sponsor Reporting and Retrospective

**Goal:** Meet sponsor and LP reporting obligations with defensible evidence, then extract lessons for the next cohort.

| Task | FRAIM Job | What It Does | Output |
|---|---|---|---|
| Report cohort impact to sponsors | `operational-reporting` with `portfolio-impact` mode | Produces a sponsor-ready impact report with defensible metrics, declared source policy, explicit gap disclosure, and narrative spotlights that never silently replace aggregate totals | `docs/business-ops/portfolio-impact-report-{program}-{date}.md` plus metrics CSV, evidence map, and founder interview briefs |
| Retrospective on the cohort | `issue-retrospective` | Captures what worked, what did not, and what changes next cohort should adopt | Cohort retrospective document |

**When to run:** `operational-reporting` with `portfolio-impact` mode runs on the sponsor's required cadence (annual for most federal grants, quarterly for corporate sponsors). Retrospective runs once the cohort closes and the report is delivered.

**Key outputs:**
- Sponsor annual or quarterly report
- Evidence appendices for audit
- Cohort retrospective feeding into Stage 1 of the next cycle

---

## Running `operational-reporting` Portfolio-Impact Mode In Depth

This is the deliverable most accelerators owe sponsors on a recurring schedule, so it gets more detail here than other jobs.

### What the job produces

- `docs/business-ops/portfolio-impact-report-{program}-{YYYY-MM-DD}.md` (main artifact)
- `docs/business-ops/portfolio-impact-report-{program}-{YYYY-MM-DD}-metrics.csv` (normalized rows with verification status and source lineage)
- `docs/business-ops/portfolio-impact-report-{program}-{YYYY-MM-DD}-evidence-map.md` (claim-to-source traceability)
- `docs/business-ops/portfolio-impact-report-{program}-{YYYY-MM-DD}-founder-interview-briefs.md` (optional appendix for closing gaps)

Sections in the main report: executive summary, program scope and cohort identification, methodology and source policy, headline metrics, cohort and founder rollups, company spotlights, gaps and limitations, open items for sponsor submission, and a standalone source-policy statement.

### Source policies you can declare

The job asks which source-policy mode governs admissibility before metrics are computed.

| Mode | When to use |
|---|---|
| `public-evidence` | Reports where the sponsor wants independently verifiable data. Default for external publication. |
| `nsf-awards-only` | Federal-grant reports where only NSF Awards database and SBIR.gov are admissible for funding totals. |
| `pitchbook-only` | LP reports where funding claims must clear a paid-database audit. |
| `internal-first` | Internal board reviews where program records take primacy over public sources. |
| `sponsor-custom` | Anything else: RFP-prescribed evidence, academic tech-transfer reports, multi-tenant portfolio reviews. |

### Metric families covered by default

Follow-on funding, jobs and headcount, grants and non-dilutive capital, revenue and contracts, IP, company status, founder participation, institutional and regional-node activity, MSI / HBCU / diversity classification.

### Counting rules the job enforces

- **Dedupe:** `(company, metric_family, source_date, amount, source_class)` prevents double counting across cohorts and funding rounds.
- **Reporting window:** every metric declares `cumulative`, `in-period`, or `current-state` and respects the window.
- **Admissible vs supplemental:** headline totals draw only from allowed source classes. Supplemental evidence lives in narrative and appendices, never in the headline numbers.
- **Zero vs unknown:** a measured zero is not the same as missing evidence. The job labels them distinctly.
- **Interviews stay labeled:** founder-interview evidence enters as `reported_unverified` unless a public or program record corroborates.

### How to run it

In your FRAIM agent:

> Run the FRAIM operational-reporting job in portfolio-impact mode for [program name] [reporting period].

FRAIM will ask you for program name, sponsoring organization, reporting window, cohort roster, required metric families, and source policy. Have cohort intake and exit records, sponsor award number, customer-discovery interview counts, and any founder survey responses ready to speed the run. FRAIM drafts the report and appendices, flags every unresolved data gap explicitly, and tells you what founder outreach would close each gap. You review, fill placeholders, and approve.

### Known limits

- **Paid databases.** Without Crunchbase or PitchBook access, private equity rounds are undercounted. The job surfaces this as a methodology note rather than papering over it.
- **Program-internal metrics.** Customer-discovery interview counts, cohort roster attribution, and sponsor award numbers require your program records. Without them, the job uses `[PLACEHOLDER]` tokens and itemizes open items for you to fill in.
- **Small-n cohorts.** At N under ten, any single company dominates the aggregate. The job flags concentration risk and keeps spotlights separated from totals.
- **Founder-reported revenue.** Private-company revenue is rarely public. The job accepts founder survey answers but labels them `reported_unverified` and keeps them in an appendix.

---

## Related reading

- Companion: [Guide to FRAIM for Founders](GuideToFRAIMForFounders.md). The founder-journey guide that cohort participants follow. Accelerator operators should know it end-to-end so they can shepherd founders without re-explaining.
- Whitepaper: `docs/business-development/accelerator-portfolio-velocity-whitepaper.md`. Thesis for why portfolio velocity is the lever that matters for accelerators and funds.
