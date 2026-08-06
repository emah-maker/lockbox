# Guide to FRAIM for Agencies

## Overview

FRAIM helps agencies deliver consistent, high-quality client work across multiple projects and teams. This guide focuses on agency-specific workflows including client management, creative development, campaign execution, and multi-project coordination.

## At a Glance

The canonical agency project sequence. Each step shows the FRAIM job to run, what it produces, and which earlier steps it depends on. The `recommend-next-job` skill parses this list to detect prerequisites and gate downstream jobs gently. The detailed stage tables further down explain each step in depth, and list optional alternatives at each phase.

1. **Respond to agency RFP** *(optional)* — `rfp-response-preparation` → `docs/commercial-ops/rfp-response-preparation-{client-name}-{date}.md`
2. **Clarify the client brief** — `problem-statement-crystallization` → `docs/clients/{client-name}/strategic-brief-{project}.md`
3. **Develop marketing strategy** *(needs 2)* — `marketing-strategy-definition` → `docs/clients/{client-name}/marketing-strategy-{project}.md`
4. **Research target audience** *(needs 2)* — `customer-prospect-discovery`
5. **Create campaign content** *(needs 3)* — `marketing-content-creation`
6. **Build campaign assets** *(needs 3)* — `website-creation`
7. **Launch the campaign** *(needs 5, 6)* — `product-launch-management`
8. **Validate performance** *(needs 7)* — `browser-application-validation`
9. **Capture user feedback** *(needs 7)* — `user-testing-and-bug-bash`
10. **Run delivery governance review** *(ongoing cadence during delivery, needs 7)* — `delivery-governance-review` → `docs/delivery-ops/delivery-governance-review-{project}-{date}.md`
11. **Close out engagement** *(needs 9)* — `work-completion`
12. **Document learnings** *(needs 11)* — `issue-retrospective`

### Ongoing cadences (not part of the linear project)

- `rfp-response-preparation` — used at the start of a new prospective engagement, before strategy work begins. Produces a requirement-response matrix with assumptions + open questions for internal review before the pitch or proposal goes out.
- `delivery-governance-review` — run during active delivery for mid-to-large engagements. Produces a RAID log + milestone health summary. Particularly useful when campaigns have multiple workstreams (content + media + creative + site) that can diverge.

## The Agency Project Journey

### Stage 1: Client Briefing & Strategy Development

**Goal**: Transform client briefs into actionable creative and technical strategies.

| Task | FRAIM Job | What It Does | Output |
|------|-----------|--------------|--------|
| Clarify Client Brief | `problem-statement-crystallization` | Transforms client requests into clear, measurable objectives and success criteria | Strategic brief document |
| Develop Marketing Strategy | `marketing-strategy-definition` | Creates comprehensive marketing approach including positioning, messaging, and channel strategy | Marketing strategy document |
| Research Target Audience | `customer-prospect-discovery` | Identifies and profiles target audience segments for campaign development | Dated dossier plus dated prospects CSV in `docs/customer-development/customer-prospect-discovery/` |

**When to run**: At project kickoff, after client briefing

**Key outputs**: 
- `docs/clients/{client-name}/strategic-brief-{project}.md`
- `docs/clients/{client-name}/marketing-strategy-{project}.md`
- Target audience profiles

---

### Stage 2: Creative Development & Content Creation

**Goal**: Develop creative concepts, content, and campaign materials based on approved strategy.

| Task | FRAIM Job | What It Does | Output |
|------|-----------|--------------|--------|
| Create Marketing Content | `marketing-content-creation` | Develops copy, creative concepts, and campaign materials | Creative deliverables |
| Develop Video Content | `promo-video-creation` | Produces promotional videos, commercials, and video marketing content | Video assets |
| Create Thought Leadership Content | `thought-leadership-engagement` | Develops industry expertise content and thought leadership materials | Content library |
| Design Website/Landing Pages | `website-creation` | Builds client websites, landing pages, and digital experiences | Web deliverables |

**When to run**: After strategy approval, during creative development phase

**Key outputs**:
- Creative campaign materials
- Video and multimedia content
- Website and digital assets
- Content calendar and strategy

---

### Stage 3: Campaign Execution & Management

**Goal**: Launch and manage marketing campaigns across multiple channels.

| Task | FRAIM Job | What It Does | Output |
|------|-----------|--------------|--------|
| Execute Social Campaigns | `social-engagement-campaign` | Manages social media marketing campaigns and community engagement | Social campaign results |
| Manage Product Launches | `product-launch-management` | Coordinates comprehensive product or service launch campaigns | Launch execution plan |
| Develop Evangelist Programs | `evangelist-content-development` | Creates community advocacy and influencer engagement programs | Advocacy program materials |
| Send Client Communications | `send-newsletter` | Manages client newsletter campaigns and customer communications | Communication campaigns |

**When to run**: During active campaign periods

**Key outputs**:
- Live marketing campaigns
- Social media engagement
- Launch coordination
- Performance metrics

---

### Stage 4: Performance Analysis & Optimization

**Goal**: Measure campaign performance and optimize for better results.

| Task | FRAIM Job | What It Does | Output |
|------|-----------|--------------|--------|
| Validate Campaign Performance | `browser-application-validation` | Tests digital campaigns, landing pages, and user journeys | Performance validation |
| Assess Content Quality | `ui-polish-validation` | Reviews creative quality, brand consistency, and user experience | Quality assessment |
| Analyze User Engagement | `user-testing-and-bug-bash` | Conducts user testing and feedback collection for campaign optimization | User insights report |

**When to run**: During and after campaign execution

**Key outputs**:
- Performance analytics
- Optimization recommendations
- User feedback analysis
- Campaign effectiveness reports

---

### Stage 5: Client Reporting & Relationship Management

**Goal**: Provide comprehensive reporting and maintain strong client relationships.

| Task | FRAIM Job | What It Does | Output |
|------|-----------|--------------|--------|
| Complete Project Delivery | `work-completion` | Ensures proper project closure, asset delivery, and client handoff | Project completion package |
| Document Project Learnings | `issue-retrospective` | Captures project insights, client feedback, and process improvements | Project retrospective |
| Prepare Client Presentations | `investor-pitch-preparation` | Adapts presentation skills for client reporting and new business pitches | Client presentation materials |

**When to run**: At project milestones and completion

**Key outputs**:
- Client deliverable packages
- Performance reports
- Project retrospectives
- Future opportunity documentation

---

## Common Agency Delivery Patterns

### Pattern 1: Brand Campaign Development
Use this for comprehensive brand marketing campaigns:

1. `problem-statement-crystallization`
2. `marketing-strategy-definition`
3. `marketing-content-creation`
4. `social-engagement-campaign`
5. `user-testing-and-bug-bash`
6. `work-completion`
7. `issue-retrospective`

### Pattern 2: Digital Product Launch
Use this for product or service launch campaigns:

1. `marketing-strategy-definition`
2. `website-creation`
3. `marketing-content-creation`
4. `product-launch-management`
5. `browser-application-validation`
6. `work-completion`

### Pattern 3: Content Marketing Program
Use this for ongoing content and thought leadership:

1. `customer-prospect-discovery` (audience research)
2. `thought-leadership-engagement`
3. `marketing-content-creation`
4. `evangelist-content-development`
5. `social-engagement-campaign`
6. `issue-retrospective`

### Pattern 4: Video Marketing Campaign
Use this for video-focused marketing initiatives:

1. `marketing-strategy-definition`
2. `promo-video-creation`
3. `social-engagement-campaign`
4. `user-testing-and-bug-bash`
5. `work-completion`

---

## Multi-Client Agency Management

### Client Portfolio Coordination
- Standardize project workflows across all clients
- Use consistent quality standards and deliverable formats
- Maintain clear project timelines and milestone tracking

### Resource Allocation
- Use project management jobs for timeline coordination
- Balance creative and technical resources across projects
- Manage team capacity and skill allocation

### Quality Consistency
- Establish agency-wide creative and technical standards
- Use systematic review processes for all client work
- Maintain brand consistency across client deliverables

---

## Agency-Specific Considerations

### Creative Process Management
- Use brainstorming jobs for creative concept development
- Use validation jobs for creative testing and optimization
- Use review jobs for creative quality assurance

### Client Relationship Management
- Establish clear communication protocols and reporting schedules
- Use presentation jobs for client meetings and pitches
- Maintain detailed project documentation for client transparency

### Brand Management
- Develop consistent brand guidelines and creative standards
- Use quality validation jobs to ensure brand compliance
- Maintain creative asset libraries and brand resources

### Performance Measurement
- Establish clear success metrics for all campaigns
- Use validation jobs to measure campaign effectiveness
- Provide regular performance reporting to clients

---

## Team Collaboration in Agency Environment

### Creative Team Coordination
- Use creative development jobs for concept creation
- Use review jobs for creative approval processes
- Use quality jobs for creative execution validation

### Account Management Integration
- Use communication jobs for client relationship management
- Use project management jobs for timeline coordination
- Use reporting jobs for client performance updates

### Technical Team Integration
- Use technical design jobs for digital implementation
- Use validation jobs for technical quality assurance
- Use deployment jobs for campaign launch coordination

---

## Scaling Agency Operations

### Process Standardization
- Develop consistent FRAIM job patterns for common project types
- Build reusable templates and creative frameworks
- Establish quality gates and approval processes

### Knowledge Management
- Capture project learnings in retrospectives
- Build library of successful campaign approaches
- Share best practices across agency teams

### New Business Development
- Use pitch preparation jobs for new business presentations
- Use validation jobs for proposal risk assessment
- Use strategic planning jobs for agency growth initiatives

---

## Integration with Agency Tools

### Project Management Integration
- Integrate FRAIM phases with agency project management systems
- Use milestone jobs for project gate management
- Track project profitability and resource utilization

### Creative Tools Integration
- Use FRAIM workflows with creative development tools
- Integrate validation processes with creative review systems
- Maintain creative asset management and version control

### Client Reporting Integration
- Use FRAIM deliverables in client reporting dashboards
- Integrate performance metrics with client communication
- Maintain audit trails for client accountability

### Performance Analytics
- Track campaign performance across all client projects
- Use analytics to optimize agency processes and outcomes
- Measure client satisfaction and retention metrics

---

*Last updated: 2026-04-10*
