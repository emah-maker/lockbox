# Guide to FRAIM for Consultants

## Overview

FRAIM helps consultants deliver structured, evidence-based client work with clear deliverables and systematic quality gates. This guide maps common consulting engagement patterns to FRAIM jobs, focusing on client delivery, project management, and knowledge transfer.

## At a Glance

The canonical consulting engagement sequence. Each step shows the FRAIM job to run, what it produces, and which earlier steps it depends on. The `recommend-next-job` skill parses this list to detect prerequisites and gate downstream jobs gently. The detailed stage tables further down explain each step in depth.

1. **Respond to client RFP** *(optional)* — `rfp-response-preparation` → `docs/commercial-ops/rfp-response-preparation-{client-name}-{date}.md`
2. **Analyze the client problem** — `problem-statement-crystallization` → `docs/client-discovery/problem-statement-{client-name}.md`
3. **Validate the business case** *(needs 2)* — `business-idea-validation-and-scoping` → `docs/client-discovery/validation-report-{client-name}.md`
4. **Build the strategic plan** *(needs 3)* — `business-plan-creation`
5. **Design the architecture** *(needs 3)* — `create-architecture`
6. **Define implementation strategy** *(needs 5)* — `technical-design`
7. **Implement the solution** *(needs 6)* — `feature-implementation`
8. **Validate client solution** *(needs 7)* — `browser-application-validation`
9. **Review delivery quality** *(needs 7)* — `implementation-feature-review`
10. **Run delivery governance review** *(ongoing cadence, needs 7)* — `delivery-governance-review` → `docs/delivery-ops/delivery-governance-review-{project}-{date}.md`
11. **Hand off to client** *(needs 9)* — `work-completion`
12. **Capture engagement learnings** *(needs 11)* — `issue-retrospective`

### Ongoing cadences (not part of the linear engagement)

- `rfp-response-preparation` — used at the **start** of a new prospective engagement, before discovery. Produces a requirement-response matrix with assumptions + open questions for internal review before any client-facing submission.
- `delivery-governance-review` — run during active delivery (typically weekly or bi-weekly). Produces a RAID log + milestone health summary with escalation distinctions (watch-only vs. action-now).
- `feature-implementation` — when it runs, it now includes an `implement-security-review` phase between validate and regression. Critical/High security findings route back to `implement-code` before the delivery can close out. Findings land in the implementation evidence doc.

## The Consulting Engagement Journey

### Stage 1: Client Discovery & Scoping

**Goal**: Understand client needs, establish clear scope, and set up engagement framework.

| Task | FRAIM Job | What It Does | Output |
|------|-----------|--------------|--------|
| Analyze Client Problem | `problem-statement-crystallization` | Transforms vague client requests into clear, testable problem statements | Problem clarity document |
| Validate Business Case | `business-idea-validation-and-scoping` | Comprehensive validation of client's business hypothesis and strategic direction | Validation and scoping report |
| Assess Current State | `code-quality-assessment` or `application-replication-workflow` | Evaluates existing systems, processes, or codebase | Current state analysis |

**When to run**: At engagement start, during discovery phase

**Key outputs**: 
- `docs/client-discovery/problem-statement-{client-name}.md`
- `docs/client-discovery/validation-report-{client-name}.md`
- Current state assessment

---

### Stage 2: Strategic Planning & Design

**Goal**: Develop strategic recommendations and implementation roadmaps for client.

| Task | FRAIM Job | What It Does | Output |
|------|-----------|--------------|--------|
| Create Business Plan | `business-plan-creation` | Deep strategic analysis including market positioning, competitive landscape, and growth strategy | Comprehensive business plan |
| Analyze Competitors | `competitive-analysis` | Produces a focused competitor set, matrix, positioning assessment, threat map, and strategic recommendations | Competitive analysis report |
| Design Technical Architecture | `create-architecture` | Designs system architecture and technical approach for client solutions | Architecture documentation |
| Define Implementation Strategy | `technical-design` | Converts strategic direction into detailed implementation plans | Technical design document |

**When to run**: After discovery, before implementation begins

**Key outputs**:
- Strategic recommendations
- Technical architecture
- Implementation roadmap

---

### Stage 3: Client Delivery & Implementation

**Goal**: Execute the planned work while maintaining client communication and quality standards.

| Task | FRAIM Job | What It Does | Output |
|------|-----------|--------------|--------|
| Implement Solutions | `feature-implementation` | Main delivery job - builds solutions according to approved designs | Working implementation |
| Create Client Prototypes | `user-facing-prototyping` | Builds interactive demos and proof-of-concepts for client validation | Client-ready prototypes |
| Develop Marketing Materials | `marketing-content-creation` | Creates client-facing content, presentations, and marketing materials | Marketing deliverables |

**When to run**: During active delivery phase

**Key outputs**:
- Client deliverables
- Working prototypes
- Documentation and training materials

---

### Stage 4: Quality Assurance & Client Validation

**Goal**: Ensure deliverables meet client requirements and quality standards.

| Task | FRAIM Job | What It Does | Output |
|------|-----------|--------------|--------|
| Validate Client Solutions | `browser-application-validation` | Tests client-facing applications and user journeys | Validation evidence |
| Review Implementation Quality | `implementation-feature-review` | Systematic review of deliverables against client requirements | Quality review report |
| Conduct User Testing | `user-testing-and-bug-bash` | Organizes client user testing and feedback sessions | User testing results |

**When to run**: Before client handoff and final delivery

**Key outputs**:
- Quality validation reports
- Client testing results
- Issue resolution documentation

---

### Stage 5: Knowledge Transfer & Engagement Closure

**Goal**: Transfer knowledge to client team and ensure sustainable handoff.

| Task | FRAIM Job | What It Does | Output |
|------|-----------|--------------|--------|
| Complete Client Handoff | `work-completion` | Ensures proper knowledge transfer, documentation, and client enablement | Handoff documentation |
| Document Engagement Learnings | `issue-retrospective` | Captures engagement insights, client feedback, and process improvements | Engagement retrospective |
| Prepare Follow-up Proposals | `investor-pitch-preparation` | Adapts pitch preparation skills for follow-up engagement proposals | Proposal materials |

**When to run**: At engagement conclusion and follow-up planning

**Key outputs**:
- Client handoff package
- Engagement retrospective
- Future opportunity documentation

---

## Common Consulting Delivery Patterns

### Pattern 1: Strategic Consulting Engagement
Use this for business strategy and planning projects:

1. `problem-statement-crystallization`
2. `business-idea-validation-and-scoping`
3. `competitive-analysis` when the engagement needs a standalone market/category comparison
4. `business-plan-creation`
5. `investor-pitch-preparation` (for client presentations)
6. `work-completion`
7. `issue-retrospective`

### Pattern 2: Technical Implementation Project
Use this for software development and technical delivery:

1. `technical-design`
2. `feature-implementation`
3. `browser-application-validation`
4. `implementation-feature-review`
5. `work-completion`
6. `issue-retrospective`

### Pattern 3: Digital Transformation Consulting
Use this for comprehensive transformation projects:

1. `code-quality-assessment` (current state)
2. `create-architecture` (future state)
3. `technical-design` (migration plan)
4. `feature-implementation` (pilot implementation)
5. `user-testing-and-bug-bash`
6. `work-completion`

### Pattern 4: Marketing & Go-to-Market Consulting
Use this for marketing strategy and execution:

1. `marketing-strategy-definition`
2. `marketing-content-creation`
3. `evangelist-content-development`
4. `social-engagement-campaign`
5. `work-completion`
6. `issue-retrospective`

---

## Client Relationship Management

### Communication & Reporting
- Use feature specifications as client requirement contracts
- Use technical designs for stakeholder alignment
- Use validation reports for progress demonstration
- Use retrospectives for continuous improvement

### Scope Management
- Problem crystallization jobs help prevent scope creep
- Validation jobs ensure client alignment before major work
- Review jobs provide quality gates and client checkpoints

### Risk Mitigation
- Always validate client requirements before implementation
- Use systematic review processes for quality assurance
- Document decisions and trade-offs for client transparency

---

## Multi-Client Management

### Standardization Across Clients
- Develop consistent templates and deliverable formats
- Use FRAIM jobs to ensure quality consistency
- Build reusable skills and processes

### Knowledge Reuse
- Capture learnings in retrospectives for future engagements
- Build library of proven solutions and approaches
- Use organizational learning jobs for cross-client insights

### Resource Allocation
- Use project management jobs for timeline coordination
- Use quality milestone jobs for delivery gate management
- Use work completion jobs for proper engagement closure

---

## Consulting-Specific Considerations

### Client Onboarding
- Establish clear communication protocols
- Define deliverable formats and quality standards
- Set up proper documentation and knowledge transfer processes

### Intellectual Property Management
- Use legal jobs for contract and IP documentation
- Maintain clear boundaries between client and consultant IP
- Document reusable components and methodologies

### Proposal Development
- Use business plan creation skills for proposal development
- Use pitch preparation jobs for client presentations
- Use validation jobs for proposal risk assessment

### Team Collaboration
- Coordinate with client teams using project management jobs
- Use communication jobs for stakeholder management
- Use review jobs for collaborative quality assurance

---

## Scaling Consulting Practice

### Practice Development
- Use organizational learning jobs to capture best practices
- Use skill refinement jobs to improve delivery capabilities
- Use team development jobs for consultant training

### Client Portfolio Management
- Standardize on FRAIM job patterns across clients
- Build reusable templates and accelerators
- Use analytics to optimize engagement patterns

### Quality Assurance
- Establish consistent quality standards across engagements
- Use systematic review processes for all deliverables
- Maintain client satisfaction through structured delivery

---

## Integration with Consulting Tools

### Project Management Integration
- Integrate FRAIM phases with project management tools
- Use milestone jobs for project gate management
- Track deliverable quality and client satisfaction

### Client Communication Tools
- Use FRAIM deliverables in client reporting
- Integrate validation evidence in status updates
- Maintain audit trails for client accountability

### Knowledge Management
- Capture engagement patterns in organizational learning
- Build consulting methodology around FRAIM jobs
- Share best practices across consulting team

---

*Last updated: 2026-04-10*
