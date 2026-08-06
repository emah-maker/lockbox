# Guide to FRAIM for Enterprise Teams

## Overview

FRAIM helps enterprise development teams deliver features with greater rigor, clearer handoffs, and more predictable outcomes. This guide maps common enterprise development workflows to FRAIM jobs, focusing on established product development within larger organizations.

## At a Glance

The canonical enterprise feature delivery sequence. Each step shows the FRAIM job to run, what it produces, and which earlier steps it depends on. The `recommend-next-job` skill parses this list to detect prerequisites and gate downstream jobs gently. The detailed stage tables further down explain each step in depth.

1. **Define the feature** — `feature-specification` → `docs/features/feature-spec-{feature-name}.md`
2. **Create technical design** *(needs 1)* — `technical-design` → `docs/technical-design/design-{feature-name}.md`
3. **Implement the feature** *(needs 2)* — `feature-implementation`
4. **Validate browser behavior** *(needs 3)* — `browser-application-validation`
5. **Assess code quality** *(needs 3)* — `code-quality-assessment`
6. **Review feature implementation** *(needs 4)* — `implementation-feature-review`
7. **Run delivery governance review** *(ongoing cadence for programs, needs 3)* — `delivery-governance-review` → `docs/delivery-ops/delivery-governance-review-{project}-{date}.md`
8. **Deploy to production** *(needs 6)* — `cloud-application-deployment`
9. **Complete the work package** *(needs 8)* — `work-completion`
10. **Capture retrospective** *(needs 9)* — `issue-retrospective`

### Note on security in `feature-implementation`

`feature-implementation` now includes an `implement-security-review` phase between `implement-validate` and `implement-regression`. It runs OWASP (Web / API / LLM), privacy/PII, secrets-in-code, capability-authoring, and compliance-control-mapping checks against the diff; findings are appended to the implementation evidence doc. Critical or High findings with `file` disposition route the state machine back to `implement-code` — the PR cannot proceed to quality / completeness / deploy phases until they are resolved or explicitly accepted with written justification.

### Ongoing cadences (portfolio / program level, not per-feature)

- `delivery-governance-review` — run on active programs (typically weekly or at milestone gates). Produces a RAID log + milestone health summary with escalation distinctions. Useful when programs span multiple teams or when customer-facing SLAs are in play.

## The Enterprise Development Journey

### Stage 1: Requirements & Planning

**Goal**: Transform business requirements into clear technical specifications with proper validation.

| Task | FRAIM Job | What It Does | Output |
|------|-----------|--------------|--------|
| Define Feature Requirements | `feature-specification` | Transforms business requirements into clear user stories, acceptance criteria, and UX specifications | Feature specification document |
| Create Technical Design | `technical-design` | Converts approved specs into implementation plans, architecture decisions, and technical approach | Technical design document |
| Establish Testing Strategy | `test-execution` | Defines test coverage, validation approach, and quality gates before implementation | Test plan and initial test suite |

**When to run**: At the start of any non-trivial feature development

**Key outputs**: 
- `docs/features/feature-spec-{feature-name}.md`
- `docs/technical-design/design-{feature-name}.md`
- Test coverage plan

---

### Stage 2: Implementation & Development

**Goal**: Build the feature according to specifications with proper validation and quality gates.

| Task | FRAIM Job | What It Does | Output |
|------|-----------|--------------|--------|
| Implement Feature | `feature-implementation` | Main development job - writes code, updates docs, implements according to approved design | Working feature implementation |
| Refactor Existing Code | `code-refactoring` | Improves code structure and maintainability without changing functionality | Refactored codebase |
| Iterate on Pull Requests | `pr-iteration` | Manages code review cycles and addresses feedback systematically | Approved pull request |

**When to run**: After specifications and design are approved

**Key outputs**:
- Feature implementation
- Updated documentation
- Passing tests

---

### Stage 3: Quality Assurance & Validation

**Goal**: Ensure the implementation meets requirements and quality standards before release.

| Task | FRAIM Job | What It Does | Output |
|------|-----------|--------------|--------|
| Validate Browser Behavior | `browser-application-validation` | Tests user journeys and functional behavior across browsers and devices | Validation report with evidence |
| Check UI Polish | `ui-polish-validation` | Validates visual design, responsiveness, spacing, and interaction details | UI quality assessment |
| Assess Code Quality | `code-quality-assessment` | Primary review across code quality and broken windows | Code quality report |
| Assess Test Quality | `test-quality-assessment` | Parallel review across test coverage, test standards, integrity, and reliability | Test quality report |

**When to run**: After implementation is complete, before release

**Key outputs**:
- Validation evidence
- Quality assessment reports
- Test coverage metrics

---

### Stage 4: Review & Approval

**Goal**: Systematic review of implementation against specifications and design.

| Task | FRAIM Job | What It Does | Output |
|------|-----------|--------------|--------|
| Review Feature Implementation | `implementation-feature-review` | Validates that delivered behavior matches the approved feature specification | Feature review report |
| Review Technical Design | `implementation-design-review` | Ensures implementation follows approved technical design and architecture standards | Design review report |
| Conduct User Testing | `user-testing-and-bug-bash` | Organizes comprehensive user-driven testing sessions | User testing results |

**When to run**: After quality validation, before final approval

**Key outputs**:
- Review reports
- Approval status
- Issue tracking for any gaps

---

### Stage 5: Deployment & Learning

**Goal**: Deploy to production and capture learnings for future development cycles.

| Task | FRAIM Job | What It Does | Output |
|------|-----------|--------------|--------|
| Deploy Application | `cloud-application-deployment` | Handles application deployment processes and infrastructure setup | Deployed application |
| Complete Work Package | `work-completion` | Ensures proper work closure, handoff documentation, and stakeholder communication | Work completion report |
| Capture Retrospective | `issue-retrospective` | Documents learnings, challenges, and improvements for future cycles | Retrospective document |

**When to run**: After approval, during and after deployment

**Key outputs**:
- Production deployment
- Handoff documentation
- Process improvements

---

## Common Enterprise Delivery Paths

### Path 1: Standard Feature Development
Use this for most new features and enhancements:

1. `feature-specification`
2. `technical-design`
3. `feature-implementation`
4. `browser-application-validation` or `ui-polish-validation`
5. `implementation-feature-review`
6. `work-completion`
7. `issue-retrospective`

### Path 2: Bug Fix & Maintenance
Use this for defect resolution and small improvements:

1. `feature-implementation` (if bug is well-understood)
2. `browser-application-validation` (if user-facing)
3. `implementation-feature-review`
4. `issue-retrospective`

### Path 3: Technical Debt & Refactoring
Use this for code quality improvements:

1. `code-quality-assessment` (to identify code-quality and broken-window issues)
2. `code-refactoring`
3. `test-quality-assessment`
4. `issue-retrospective`

### Path 4: Quality Improvement Initiative
Use this for systematic quality improvements:

1. `code-quality-assessment`
2. `test-quality-assessment`
3. `broken-windows-detection-and-remediation`
4. `issue-retrospective`

---

## Enterprise-Specific Considerations

### Compliance & Governance
- Use `compliance-requirements-detection` for regulated industries
- Use `generate-audit-evidence` for compliance documentation
- Use `soc2-evidence-management` for security compliance

### Architecture & Standards
- Establish clear architecture documentation
- Use technical design jobs for all significant changes
- Maintain consistent code quality standards

### Stakeholder Communication
- Feature specifications serve as contracts with business stakeholders
- Technical designs communicate with architecture teams
- Review reports provide audit trails for decisions

### Risk Management
- Always validate user-facing changes with browser testing
- Use systematic review processes for quality gates
- Document decisions and trade-offs for future reference

---

## Integration with Enterprise Tools

### Issue Tracking Integration
FRAIM integrates with enterprise issue tracking systems:
- **Jira**: Full integration with project tracking and workflow management
- **Azure DevOps**: Work item tracking and pipeline integration
- **GitHub Issues**: Native integration with development workflow

### CI/CD Pipeline Integration
- Use validation jobs as quality gates in pipelines
- Integrate test execution with automated testing
- Use deployment jobs for consistent release processes

### Documentation Standards
- Feature specifications align with business requirements
- Technical designs integrate with architecture documentation
- Review reports provide audit trails for compliance

---

## Team Collaboration Patterns

### Cross-Functional Teams
- Product managers use feature specification jobs
- Architects use technical design jobs
- Developers use implementation jobs
- QA teams use validation and testing jobs

### Code Review Process
- Use `pr-iteration` for systematic review cycles
- Use design review jobs for architectural validation
- Use feature review jobs for requirements validation

### Knowledge Sharing
- Use retrospective jobs to capture team learnings
- Use documentation jobs to maintain institutional knowledge
- Use quality assessment jobs to establish standards

---

## Scaling Considerations

### Multiple Teams
- Standardize on common FRAIM job patterns
- Share templates and quality standards
- Use organizational learning jobs for cross-team insights

### Large Features
- Break down into smaller feature specifications
- Use technical design jobs for complex architecture
- Coordinate with quality milestone management

### Legacy Systems
- Use assessment jobs to understand current state
- Use refactoring jobs for systematic improvements
- Use migration jobs for platform transitions

---

*Last updated: 2026-04-10*
