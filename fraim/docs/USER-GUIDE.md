# FRAIM User Guide

## Table of Contents

1. [Introduction](#introduction)
2. [FRAIM's Operating Model](#fraims-operating-model)
3. [Getting Started](#getting-started)
4. [Which Job To Use When](#which-job-to-use-when)
5. [Common Delivery Paths](#common-delivery-paths)
6. [How To Ask Your Agent](#how-to-ask-your-agent)
7. [Customization](#customization)
8. [Integration Modes](#integration-modes)
9. [CLI Commands](#cli-commands)
10. [IDE Integration](#ide-integration)
11. [Best Practices](#best-practices)
12. [Troubleshooting Shortcuts](#troubleshooting-shortcuts)

---

## Introduction

FRAIM helps you manage AI agents with clearer structure, stronger evidence, and more reliable handoffs.

The most important concept to keep straight is this:

- **Jobs** are the primary execution unit.
- **Skills** and **rules** support jobs.
- **Phases** are gates inside jobs.
- **Templates** define reusable deliverable formats and are also customizable.

If you see older references to "workflows" in historical material, treat that as legacy terminology. In current FRAIM usage, users should think primarily in terms of **jobs**.

Start with `QUICK-START.md` if you are brand new. Use this file as the main reference once FRAIM is installed.

## Specialized User Guides

FRAIM provides specialized guides for different user contexts and organizational types:

- **[GuideToFRAIMForFounders.md](GuideToFRAIMForFounders.md)** - Startup founders and early-stage entrepreneurs
- **[GuideToFRAIMForEnterpriseTeams.md](GuideToFRAIMForEnterpriseTeams.md)** - Enterprise development teams and established product organizations
- **[GuideToFRAIMForConsultants.md](GuideToFRAIMForConsultants.md)** - Independent consultants and consulting firms
- **[GuideToFRAIMForAgencies.md](GuideToFRAIMForAgencies.md)** - Marketing agencies and creative service providers

**When to use specialized guides:**
- If you're unsure which FRAIM jobs to use for your context
- When you need workflow patterns specific to your organizational type
- For understanding how FRAIM jobs connect in your domain

**When to use this general guide:**
- For comprehensive job reference and technical details
- For customization and integration information
- For CLI commands and troubleshooting

---

## FRAIM's Operating Model

### Jobs

A **job** is the thing you run for a specific outcome.

Examples:

- `feature-specification`
- `technical-design`
- `feature-implementation`
- `browser-application-validation`
- `implementation-feature-review`

Jobs define:

- the intent
- the expected outcome
- the phases
- the evidence needed to advance

### Phases

A **phase** is a gate inside a job.

Typical phases might include:

- scoping
- design
- implementation
- validation
- submission
- retrospective

Agents should not skip phases just because they think they already know the answer. FRAIM uses phases to force clarity and proof.

### Skills

A **skill** is reusable execution guidance.

Use skills when you want a job to include a repeatable capability such as:

- writing a technical design
- running browser validation
- analyzing customer interviews
- generating structured evidence

You usually do not ask to "run a skill" first. The normal entry point is still a job.

### Rules

A **rule** is an always-on instruction set or quality constraint.

Rules typically cover:

- testing standards
- architecture standards
- communication style
- project-specific conventions

### Templates

A **template** is a reusable output format.

Templates are the right place to personalize:

- document structure
- required sections
- company language
- branded deliverable layout
- evidence report shape

Templates are especially useful when the job should stay the same but the output format should change.

### AI Mentor

The AI Mentor helps the agent stay aligned to the current phase and asks for evidence before it advances.

Use the mentor model when you want the agent to:

- explain the current phase
- justify whether a phase is complete
- recover after it drifted
- clarify what evidence is still missing

### Evidence

FRAIM works best when "done" means inspectable proof, not commentary.

Strong evidence includes:

- passing test commands
- generated artifacts
- review documents
- screenshots
- issue links
- file paths
- explicit findings and open questions

Weak evidence includes:

- "looks good"
- "I think it works"
- "tests should pass"

---

## Getting Started

### Install FRAIM

Recommended:

```bash
npx fraim@latest setup --key=<your-fraim-key>
```

### Run Setup

If you have not configured FRAIM yet:

```bash
npx fraim@latest setup
```

This guides you through:

1. FRAIM API key
2. working mode
3. platform integrations
4. IDE configuration
5. project initialization

### Initialize Another Project

```bash
cd your-project
npx fraim@latest init-project
```

This creates or refreshes:

- `fraim/config.json`
- `fraim/personalized-employee/`
- `fraim/ai-employee/`
- `fraim/ai-manager/`
- `fraim/docs/`
- user scripts under `~/.fraim/scripts/`

> Tell your AI agent: "Onboard this project"

**Important**: Do not add synced `fraim/` content to your committed `.gitignore`.

FRAIM keeps synced content out of Git locally via `.git/info/exclude` so IDEs like Cursor can still index and `@` reference files under `fraim/ai-employee/`, `fraim/ai-manager/`, and `fraim/docs/`.

This ensures:
- Synced content stays fresh (not stale committed versions)
- Your customizations in `fraim/personalized-employee/` are preserved
- Project configuration is version controlled
- IDE file pickers and indexers can still discover FRAIM stubs

If the repo still has legacy project content under `.fraim/`, run the one-time migration command first:

```bash
npx fraim@latest migrate-project-fraim
```

### Sync Local FRAIM Content

Use manual sync when you want a freshness or repair pass for local content:

```bash
npx fraim@latest sync
```

Use `npx fraim@latest sync` when you want refreshed:

- job stubs
- skill stubs
- rule stubs
- docs
- synced scripts

### First Prompt After Setup

The best first prompt is:

> `Onboard this project`

Then ask:

> `List FRAIM jobs`

---

## Which Job To Use When

This is the most important reference in the guide.

Before choosing, you can also use FRAIM's visual and analytics surfaces:

- open `https://fraim.wellnessatwork.me/fraim-brain` to see the full FRAIM job map and the skills connected to each job
- use the "Your Brain" mode inside FRAIM Brain with your FRAIM API key to see which jobs and skills your own usage is activating
- open `https://fraim.wellnessatwork.me/analytics` with your FRAIM API key to review personalized usage patterns, top components, success rates, and duration trends

These surfaces are useful when:

- you want to discover jobs outside your usual path
- you want to understand which skills a job is actually leveraging
- you want to see whether your usage is too concentrated in one area of FRAIM
- you want evidence about which jobs you or your team use most often before refining process

### Product-Building Jobs

| If you need to... | Use this job | Why |
| --- | --- | --- |
| Clarify requirements, UX, acceptance criteria, or user stories | `feature-specification` | Defines what should be built |
| Turn an approved spec into an implementation plan | `technical-design` | Defines how it should be built |
| Implement code, docs, config, or a bug fix | `feature-implementation` | Main delivery job |
| Establish or improve tests before implementation | `test-execution` | Focuses on reproducible validation |
| Capture learnings after delivery | `issue-retrospective` | Preserves mistakes and wins for future runs |

### Manager And Coaching Jobs

AI-Manager jobs help you manage AI agents, capture learnings, and maintain team productivity. Use these when you need to step into a management role rather than having an AI employee execute work.

#### When to Use AI-Manager Jobs

Use AI-manager jobs when:
- An AI agent has drifted from the correct process
- You need to capture learnings from mistakes or successes
- You want to improve team productivity and processes
- You need to onboard a new project or set up guardrails
- You want to synthesize patterns across multiple work sessions

#### Coaching Jobs

| If you need to... | Use this job | Why |
| --- | --- | --- |
| Recover after the agent drifted or skipped the correct phase | `follow-your-mentor` | Re-anchors the agent to the correct phase and resumes under mentor guidance |
| Produce a concise RCA after a significant miss | `analyze-why-you-messed-up` | Captures what failed, why, and what should change next time |

#### Project Setup Jobs

| If you need to... | Use this job | Why |
| --- | --- | --- |
| Onboard the repo into a trustworthy FRAIM-ready state | `project-onboarding` | Main manager job for first-run repo setup |
| Create or update project-specific rules and conventions | `author-project-rules` | Establishes team standards and constraints |
| Define team structure and roles | `shape-team` | Organizes team responsibilities and workflows |
| Establish core values and principles | `refine-core-values` | Sets foundational team beliefs and standards |

#### Learning and Synthesis Jobs

| If you need to... | Use this job | Why |
| --- | --- | --- |
| Consolidate daily learnings, review proposals, and apply approved updates | `sleep-on-learnings` | Synthesizes unprocessed coaching moments and retrospectives, walks the manager through the pending proposals, then applies the approved learnings |
| Synthesize patterns across multiple team members | `organizational-learning-synthesis` | Creates team-wide learning artifacts from individual patterns |

#### Delegation and Management Jobs

| If you need to... | Use this job | Why |
| --- | --- | --- |
| Clarify unclear requirements or scope | `create-clarity` | Transforms vague requests into actionable specifications |
| Delegate work completely to an AI agent | `fully-delegate` | Sets up autonomous execution with clear success criteria |
| Develop a point of view on ambiguous decisions | `need-pov` | Helps form opinions when direction is unclear |
| Strengthen and communicate existing viewpoints | `strong-pov` | Reinforces and articulates established positions |
| Develop stronger positions from weak starting points | `weak-pov` | Builds conviction and clarity from uncertain positions |

#### Team Development Jobs

| If you need to... | Use this job | Why |
| --- | --- | --- |
| Make the employee do things your way, teach new capabilities, fix recurring mistakes, or adapt to a new environment | `evolve-employee` | Canonical manager workflow that translates plain-language needs into the right mix of jobs, skills, rules, templates, scripts, and config changes |

`evolve-employee` is the single manager-facing workflow for reusable employee evolution in this area.
If you want a plain-English launch phrase, tell your agent: `Personalize my employee`

#### Productivity and Analytics Jobs

| If you need to... | Use this job | Why |
| --- | --- | --- |
| Generate team productivity reports and insights | `generate-productivity-report` | Provides data-driven view of team performance |
| Choose the right AI agent for specific tasks | `hire-right-ai-for-the-job` | Matches agent capabilities to work requirements |

#### Verification and Quality Jobs

| If you need to... | Use this job | Why |
| --- | --- | --- |
| Determine how to verify or validate work | `how-should-i-verify` | Provides guidance on appropriate validation approaches |

### Quality And Review Jobs

| If you need to... | Use this job | Why |
| --- | --- | --- |
| Validate browser behavior across a user journey | `browser-application-validation` | Good for runtime validation and bug discovery |
| Check UI fit and finish across breakpoints | `ui-polish-validation` | Good for overlap, spacing, overflow, and responsive polish |
| Verify delivered behavior matches the feature spec | `implementation-feature-review` | Reviewer job focused on customer-visible requirements |
| Verify implementation matches the approved design | `implementation-design-review` | Reviewer job focused on architectural and technical correctness |
| Improve code quality iteratively | `iterative-quality-improvement` | Useful when the goal is refinement rather than one specific feature |
| Assess overall codebase implementation quality across code quality and broken windows | `code-quality-assessment` | Primary implementation-quality review covering code structure, architecture health, and broken windows |
| Assess test coverage and test standards | `test-quality-assessment` | Parallel quality review focused on coverage depth, test standards, test integrity, and reliability |
| Detect and fix broken windows in the codebase | `broken-windows-detection-and-remediation` | Identifies and addresses technical debt and quality issues |
| Conduct user testing and bug bash sessions | `user-testing-and-bug-bash` | Organizes comprehensive user-driven testing |

### Business Development Jobs

| If you need to... | Use this job | Why |
| --- | --- | --- |
| Turn a vague idea into a clear problem statement | `problem-statement-crystallization` | Narrows the problem and ICP |
| Validate an idea before building | `business-idea-validation-and-scoping` | Tests whether the idea is worth pursuing |
| Create a comprehensive business plan | `business-plan-creation` | Develops strategic business framework |
| Analyze competitors and positioning | `competitive-analysis` | Creates a focused competitor set, matrix, differentiation strategy, threat map, and recommendations |
| Analyze founder-market fit | `founder-market-fit-analysis` | Evaluates founder credibility and market alignment |
| Define pricing strategy and models | `pricing-strategy-definition` | Establishes monetization approach |

### Customer Development Jobs

| If you need to... | Use this job | Why |
| --- | --- | --- |
| Find prospects | `customer-prospect-discovery` | Builds a target list |
| Recruit interview participants | `participant-recruitment` | Converts prospects into conversations |
| Prepare for customer interviews | `interview-preparation` | Creates interview scripts and research |
| Analyze one interview | `process-interview-notes` | Extracts structured learnings from a single session |
| Synthesize many interviews | `triage-customer-needs` | Finds patterns across sessions |
| Manage user surveys | `user-survey-management` | Designs and executes survey research |

### Marketing and Go-to-Market Jobs

| If you need to... | Use this job | Why |
| --- | --- | --- |
| Create marketing content | `marketing-content-creation` | Develops marketing materials and copy |
| Create promotional videos | `promo-video-creation` | Produces video marketing content |
| Run social engagement campaigns | `social-engagement-campaign` | Manages social media marketing efforts |
| Develop thought leadership content | `thought-leadership-engagement` | Creates industry expertise content |
| Define marketing strategy | `marketing-strategy-definition` | Establishes comprehensive marketing approach |
| Develop evangelist content | `evangelist-content-development` | Creates community and advocacy materials |
| Manage product launches | `product-launch-management` | Coordinates product release activities |
| Publish MCP applications | `publish-mcp-app` | Handles MCP app store submissions |

### Company Creation Jobs

Stand up the legal entity, infrastructure, and public identity of a new company. These are one-time formation tasks; the go-to-market jobs above use what you set up here.

| If you need to... | Use this job | Why |
| --- | --- | --- |
| Pick a legal entity type | `entity-type-selection` | Evaluates LLC/C-Corp/S-Corp tradeoffs |
| File state incorporation | `state-incorporation-filing` | Registers the entity with the state |
| Apply for an EIN | `ein-application` | Obtains the federal tax ID |
| Register for business taxes | `business-tax-registration` | Handles state/local tax registrations |
| Research domain registration options | `domain-registration-research` | Finds and evaluates domain name options |
| Create the company website | `website-creation` | Builds web presence and landing pages |
| Set up a GitHub organization | `github-org-setup` | Provisions the engineering code org |
| Set up Google Workspace | `google-workspace-setup` | Provisions company email and collaboration |
| Set up a LinkedIn Company Page | `linkedin-company-page-setup` | Establishes the company's professional presence |
| Set up an X (Twitter) business account | `x-account-setup` | Establishes the company's social handle |

### Customer Communication Jobs

| If you need to... | Use this job | Why |
| --- | --- | --- |
| Send newsletters to customers | `send-newsletter` | Manages customer newsletter campaigns |
| Send thank you notes to contributors | `send-thank-you-notes` | Acknowledges community contributions |

### Fundraising Jobs

| If you need to... | Use this job | Why |
| --- | --- | --- |
| Prepare investor pitch materials | `investor-pitch-preparation` | Creates comprehensive pitch packages |
| Apply for cloud startup credits | `cloud-credits-application` | Secures AWS Activate, Google Cloud, or Microsoft Azure startup credits |
| Discover fundraising prospects | `fundraising-prospect-discovery` | Identifies potential investors |
| Prepare for community funding | `community-funding-preparation` | Organizes crowdfunding or community investment |
| Review funding preparation materials | `review-funding-preparation` | Validates fundraising readiness |

### Legal and Compliance Jobs

| If you need to... | Use this job | Why |
| --- | --- | --- |
| Analyze and review contracts | `contract-review-analysis` | Evaluates legal agreements |
| Create NDAs | `nda-creation` | Generates non-disclosure agreements |
| Create W9 tax forms | `w9-creation` | Handles tax documentation |
| Create SaaS contract packages | `saas-contract-package-creation` | Develops software service agreements |
| Manage trademark registration | `trademark-registration-management` | Handles intellectual property protection |
| Create provisional patent applications | `provisional-patent-application-creation` | Files initial patent protection |
| Dispatch e-signature requests | `opensign-cloud-esign-dispatch` | Manages electronic signature workflows |
| Detect compliance requirements | `compliance-requirements-detection` | Identifies regulatory obligations |
| Generate audit evidence | `generate-audit-evidence` | Creates compliance documentation |
| Manage SOC2 evidence collection | `soc2-evidence-management` | Handles security compliance documentation |

### Technical and Infrastructure Jobs

| If you need to... | Use this job | Why |
| --- | --- | --- |
| Refactor existing code | `code-refactoring` | Improves code structure and maintainability |
| Iterate on pull requests | `pr-iteration` | Manages code review and improvement cycles |
| Complete and finalize work | `work-completion` | Ensures proper work closure and handoff |
| Create user-facing prototypes | `user-facing-prototyping` | Builds interactive demos and mockups |
| Deploy applications to cloud | `cloud-application-deployment` | Handles application deployment processes |
| Migrate between platforms | `gitlabs-to-github` | Manages platform migrations |
| Replicate applications | `application-replication-workflow` | Duplicates application setups |
| Optimize cloud costs (Azure / AWS / GCP) | `cloud-cost-optimization` | Reduces cloud infrastructure expenses across any supported platform |
| Diagnose cloud performance issues (Azure / AWS / GCP) | `cloud-performance-diagnosis` | Troubleshoots cloud performance problems across any supported platform |
| Create system architecture | `create-architecture` | Designs system architecture and documentation |

### Invoicing and Administrative Jobs

| If you need to... | Use this job | Why |
| --- | --- | --- |
| Generate invoices | `invoice-generation` | Creates billing and payment documentation |

### FRAIM Development Jobs

| If you need to... | Use this job | Why |
| --- | --- | --- |
| Contribute to FRAIM framework | `contribute-to-fraim` | Develops FRAIM platform improvements |
| File FRAIM issues and feedback | `file-fraim-issue` | Reports bugs and requests features |
| Turn genuine FRAIM wins into testimonials or social proof | `praise-fraim` | Drafts and stages authentic praise across website and social channels |
### If You Are Unsure

Ask directly:

- `Which FRAIM job should I use for this task?`
- `I have an approved spec. What is the next FRAIM job?`
- `This is a UI bug. Which job path should I follow?`

You can also cross-check visually:

- FRAIM Brain: `https://fraim.wellnessatwork.me/fraim-brain`
- personalized usage analytics: `https://fraim.wellnessatwork.me/analytics`

---

## Common Delivery Paths

### Path 1: Larger Feature

Use this path when the work is non-trivial or still evolving:

1. `feature-specification`
2. `technical-design`
3. `feature-implementation`
4. `implementation-feature-review` and/or `implementation-design-review`
5. `issue-retrospective`

### Path 2: Small Bug Fix

Use this when the bug is already understood:

1. `feature-implementation`
2. reviewer job if needed
3. `issue-retrospective`

If the bug is not reproducible or lacks coverage, run `test-execution` first.

If the agent ignored the correct phase, insert `follow-your-mentor` before resuming.

### Path 3: UI Change

Use this when the work changes what users see or interact with:

1. `feature-specification` if UX needs clarity
2. `technical-design` if implementation details or architecture matter
3. `feature-implementation`
4. `ui-polish-validation` or `browser-application-validation`
5. reviewer job

Rule of thumb:

- Use `browser-application-validation` for functional journey validation.
- Use `ui-polish-validation` for layout, responsiveness, spacing, clipping, and visual quality.
- Use both if the change is important and user-facing.

### Path 4: Founder Validation

Use this when you are still deciding whether to build:

1. `problem-statement-crystallization`
2. `business-idea-validation-and-scoping`
3. `customer-prospect-discovery`
4. `participant-recruitment`
5. `process-interview-notes`
6. `triage-customer-needs`

In this path, `customer-prospect-discovery` creates dated artifacts under `docs/customer-development/customer-prospect-discovery/` with `customer-prospect-discovery-{date}.md` plus `prospects-{date}.csv`, and `participant-recruitment` updates that same folder instead of creating a separate recruitment tracker.

### Path 5: Documentation Or Process Refresh

Use `feature-implementation` when the job is to update docs, rules, config, or other repo assets that still need validation and quality review.

### Path 6: Recovery After Drift Or Failure

Use this when the agent skipped phases, ignored mentoring guidance, or created a notable process miss:

1. `follow-your-mentor`
2. resume the correct employee job
3. `analyze-why-you-messed-up` if the miss was significant enough to warrant RCA

Naming opinion:

- `follow-your-mentor` is the correct name to document right now because it is the exposed job name.
- `follow-the-process` is the stronger long-term product name because it explains purpose better, is less awkward in customer-facing language, and scales beyond mentor framing.
- My recommendation is not to rename immediately unless you want to carry an alias. If you do rename, keep `follow-your-mentor` as a compatibility alias and present `follow-the-process` as the preferred display name.

---

## How To Ask Your Agent

The clearest pattern is:

1. state the job
2. give the issue or context
3. mention any constraints

Examples:

- `Run the feature-specification job for issue #123`
- `Run the technical-design job for the approved auth spec`
- `Run the feature-implementation job for issue #123 and do not commit`
- `Run the ui-polish-validation job against the signup flow`
- `Run the follow-your-mentor manager job before continuing`
- `Run the analyze-why-you-messed-up manager job for this miss`
- `Which FRAIM job should I use for this request?`

Good follow-up prompts:

- `What phase are you in?`
- `What evidence do you still need?`
- `What is the next FRAIM job after this?`

If an agent asks to list workflows, correct it to jobs.

Preferred phrasing:

- `List FRAIM jobs`
- `Show FRAIM jobs for product building`
- `Run the feature-implementation job`

---

## Customization

Project-specific customization lives under:

- `fraim/personalized-employee/jobs/`
- `fraim/personalized-employee/skills/`
- `fraim/personalized-employee/rules/`
- `fraim/personalized-employee/templates/`

Use `npx fraim@latest override` to create a starting point:

```bash
npx fraim@latest override --inherit jobs/product-building/feature-implementation.md
npx fraim@latest override --copy rules/engineering/architecture-standards.md
```

Use the directories like this:

- `jobs/`: phased repo-specific guidance
- `skills/`: reusable repo-specific capabilities
- `rules/`: persistent local standards
- `templates/`: local deliverable formats

### When To Customize A Template

Customize a template when:

- the output format needs company-specific structure
- the job logic is fine but the artifact shape should change
- the team wants branded or domain-specific deliverables
- the same formatting adjustment keeps repeating across runs

Important:

- do not edit synced base content under `fraim/ai-employee/` or `fraim/ai-manager/`
- re-running sync can overwrite synced content
- keep your durable local changes under `fraim/personalized-employee/`

### When To Customize A Job

Customize a job when:

- the repo has a repeatable local phase requirement
- the repo needs extra evidence or checks
- multiple runs keep needing the same local instruction

Do not customize a job when a one-off user prompt is enough.

### When To Add A Rule Instead

Add or refine a rule when:

- the guidance should apply across many jobs
- the instruction is always-on
- the constraint is not phase-specific

**Personalized jobs**
- Best when you need to change phase flow, add project-specific evidence requirements, or insert an extra review gate.
- Store them under `fraim/personalized-employee/jobs/...`.
- Prefer inheritance so upstream job updates still flow through.

Example:

```markdown
---
{
  "extends": "product-building/feature-implementation",
  "phases": {
    "scoping": { "onSuccess": "security-review" },
    "security-review": { "onSuccess": "coding", "onFailure": "security-review" }
  }
}
---
# Team-Specific Implementation Notes

## Phase: security-review
Run the internal threat-model checklist before coding starts.
```

**Personalized skills**
- Best when you want reusable local instructions that multiple jobs can include.
- Store them under `fraim/personalized-employee/skills/...`.
- Include them from jobs with `{{include:skills/<category>/<name>.md}}`.

Example:

```markdown
# Local Quality Bar

- Capture before/after evidence for any user-visible change.
- Do not mark a phase complete without a concrete validation artifact.
```

**Personalized rules**
- Best for stable team conventions that should apply broadly.
- Store them under `fraim/personalized-employee/rules/...`.
- Use them for policies, architecture constraints, naming standards, or validation requirements.

Example:

```markdown
# Architecture Standards

- New external dependencies require explicit justification.
- Cross-service changes must document rollback behavior.
```

**Important**
- Do not edit synced content under `fraim/ai-employee/` or `fraim/ai-manager/`; `npx fraim@latest sync` can overwrite it.
- If the repo still has legacy project content under `.fraim/`, run `npx fraim@latest migrate-project-fraim`.
- Keep durable local customization under `fraim/personalized-employee/`.

### Customer Communication

FRAIM includes built-in customer communication jobs through `send-newsletter` and `send-thank-you-notes`.

#### What you get for free

- Scoping first: the jobs check required config up front and surface missing setup before drafting starts.
- Issue fetching: the agent gathers issue and commit data for the requested time period.
- Editorial drafting: newsletters are curated into hero features, new features, improvements, and bug fixes; thank-you notes are grouped by reporter and drafted per recipient.
- HTML preview: a branded preview HTML file is generated before any send.
- Approval gate: the agent shows the preview plus recipient list and waits for explicit sign-off.
- Skill-driven delivery orchestration: after approval, FRAIM builds the final message payloads and calls your configured sender script.

#### What you need to configure

Add a `customer-communication` section to `fraim/config.json`:

```json
{
  "customer-communication": {
    "productName": "Your Product",
    "productUrl": "https://yourproduct.com",
    "senderDisplayName": "Your Team",
    "senderEmail": "updates@yourproduct.com",
    "senderReplyTo": "support@yourproduct.com",
    "newsletterAudienceProvider": "fraim/personalized-employee/scripts/resolve-newsletter-audience.ts",
    "deliveryProvider": "resend"
  }
}
```

| Key | Purpose |
| --- | --- |
| `productName`, `productUrl` | Product identity used in copy and links |
| `senderDisplayName`, `senderEmail`, `senderReplyTo` | Sender details shown in outgoing mail |
| `newsletterAudienceProvider` | Script path that deterministically returns the newsletter audience for the run |
| `deliveryProvider` | Either a built-in sender value (`resend`, `gmail`, `smtp`) or a path to your sender script |

The sender script should be narrow. FRAIM handles campaign assembly, recipient selection, provider resolution, and approval flow before the send step. Your script should just send the fields it is given.

Newsletter audience is resolved deterministically from `newsletterAudienceProvider` during job scoping. Thank-you issue selection remains a run-specific input.

Recommended CLI contract:

```text
--to
--to-name
--from
--reply-to
--subject
--html-file
--dry-run|--no-dry-run
```

Built-in provider values resolve automatically:

- `resend`, `gmail`, and `smtp` all use `~/.fraim/scripts/customer-communication/send-email.ts` with the matching `--provider` value.

Custom sender example:

```json
{
  "customer-communication": {
    "deliveryProvider": "fraim/personalized-employee/scripts/send-email-via-company-gateway.ts"
  }
}
```

Provider credentials stay in environment variables handled by that script. They do not belong in `fraim/config.json`.

Recommended newsletter audience resolver contract:

```json
{
  "recipients": [
    { "email": "user@example.com", "name": "User Example", "source": "signup" }
  ]
}
```

#### Running the newsletter job

Tell your AI agent:
```text
Run the send-newsletter job for the period Jan 15 - Feb 15
```

#### Running thank-you notes

Tell your AI agent:
```text
Run the send-thank-you-notes job for the past 30 days
```

---

## Integration Modes

### Conversational

Use this when you want FRAIM guidance without code-hosting or issue-tracker integration.

Good for:

- learning FRAIM
- offline or manual work
- non-code deliverables
- private projects

### Integrated

Use this when one platform handles both code and issues.

Good for:

- GitHub-only teams
- GitLab-only teams
- Azure DevOps-only teams

### Split

Use this when code and issue tracking live in different platforms.

Good for:

- GitHub plus Jira
- GitLab plus Jira
- Azure DevOps plus Jira

---

## CLI Commands

Common commands:

```bash
npx fraim@latest setup
npx fraim@latest init-project
npx fraim@latest sync
npx fraim@latest add-ide
npx fraim@latest add-ide --list
npx fraim@latest add-ide --ide claude
npx fraim@latest doctor
npx fraim@latest doctor --test-mcp
npx fraim@latest migrate-project-fraim
npx fraim@latest override --inherit jobs/product-building/feature-implementation.md
npx fraim@latest override --copy rules/engineering/architecture-standards.md
```

### What They Do

| Command | Purpose |
| --- | --- |
| `npx fraim@latest setup` | Initial configuration |
| `npx fraim@latest init-project` | Initialize FRAIM in the current repo |
| `npx fraim@latest sync` | Refresh synced local FRAIM content |
| `npx fraim@latest add-ide` | Add FRAIM MCP configuration to one or more IDEs |
| `npx fraim@latest doctor` | Diagnose local FRAIM setup |
| `npx fraim@latest doctor --test-mcp` | Specifically test MCP connectivity |
| `npx fraim@latest migrate-project-fraim` | One-time migration from project `.fraim/` to `fraim/` |
| `npx fraim@latest override ...` | Create local personalized starting points |

---

## IDE Integration

After setup, you can add FRAIM to additional IDEs:

```bash
npx fraim@latest add-ide
npx fraim@latest add-ide --ide claude
npx fraim@latest add-ide --ide cursor
npx fraim@latest add-ide --all
```

After configuring an IDE:

1. restart the IDE completely
2. verify with `npx fraim@latest doctor --test-mcp`
3. ask the agent to `List FRAIM jobs`

If the IDE still does not see FRAIM after sync or add-ide changes, restart it again. Discovery is often refreshed only on IDE startup.

---

## Best Practices

### Start With The Right Job

Most confusion comes from picking the wrong entry point.

- use `feature-specification` for "what"
- use `technical-design` for "how"
- use `feature-implementation` for "build it"
- use review or validation jobs for proof

### Ask For The Phase

If progress looks vague, ask:

> `What phase are you in and what evidence do you still need?`

### Prefer Evidence Over Narration

Ask for:

- file paths
- test commands
- screenshots
- review artifacts
- concrete findings

### Keep Synced Content Out Of Your Repo History

Normally keep synced content out of Git and keep only:

- `fraim/config.json`
- `fraim/personalized-employee/`

### Use Personalized Content For Durable Repo Behavior

If the same local instruction keeps repeating, move it into:

- a personalized rule
- a personalized skill
- a personalized job override

---

## Troubleshooting Shortcuts

Use these first:

```bash
npx fraim@latest doctor --test-mcp
npx fraim@latest sync
```

Check these paths if discovery feels wrong:

- `fraim/ai-employee/jobs/`
- `fraim/ai-manager/jobs/`
- `fraim/docs/`
- `~/.fraim/scripts/`
- `fraim/personalized-employee/`

If a guide or older conversation tells you to look in `fraim/workflows/`, that is outdated. Use the current job directories instead.

For detailed debugging, open `TROUBLESHOOTING.md`.
