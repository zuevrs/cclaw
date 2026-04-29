import { CCLAW_VERSION, SHIP_FINALIZATION_MODES } from "../constants.js";
import { orderedStageSchemas } from "./stage-schema.js";
import { FLOW_STAGES } from "../types.js";

const SHIP_FINALIZATION_ENUM_LINES = SHIP_FINALIZATION_MODES.map((mode) => `  - ${mode}`).join("\n");
const MARKDOWN_CODE_FENCE = "```";

function artifactFrontmatter(stage: string): string {
  return `---
stage: ${stage}
schema_version: 1
version: ${CCLAW_VERSION}
run: <run-id>
locked_decisions: []
inputs_hash: sha256:pending
---`;
}

const SEED_SHELF_SECTION = `## Seed Shelf Candidates (optional)
| Seed file | Trigger when | Suggested action | Status (planted/deferred/ignored) |
|---|---|---|---|
| .cclaw/seeds/SEED-YYYY-MM-DD-<slug>.md |  |  |  |`;

export const ARTIFACT_TEMPLATES: Record<string, string> = {
  "01-brainstorm.md": `${artifactFrontmatter("brainstorm")}

# Brainstorm Artifact

## Mode Block
- **Mode:** STARTUP | BUILDER | ENGINEERING | OPS | RESEARCH (pick exactly one)
- **Why this mode:** (one line; cite a concrete signal — repo state, user prompt, ownership, risk window)

## Context
- **Project state:**
- **Relevant existing code/patterns:**

### Discovered context
- (paths, prior artifacts, seeds, prompt fragments — referenced by downstream stages, or \`- None.\`)

## Reference Pattern Candidates
| Pattern / source | Reusable invariant | Disposition (accept/reject/defer) | Why |
|---|---|---|---|
|  |  |  |  |

## Problem Decision Record
- **Depth:** lite | standard | deep
- **Frame type:** \`<free-form-label>\` (one short token that names how this work is framed; pick whatever fits — examples in commentary only: \`product\`, \`technical-maintenance\`, \`research-spike\`, \`ops-incident\`, \`infrastructure\`, \`library-extraction\`. Do NOT treat the examples as an enum.)

### Framing fields (universal — keep field names; fill in whatever is meaningful for this work)
- **Affected user / role / operator:** (who experiences the problem or carries the consequence)
- **Current state / failure mode / opportunity:** (what is happening today)
- **Desired outcome (observable):** (what changes when this work lands; phrase so a test or operator could verify)
- **Evidence / signal supporting this framing:** (citation, metric, ticket, prior artifact, repo path, or \`- None.\`)
- **Why now (urgency / cost of waiting):**
- **Do-nothing consequence:** (concrete — not "nothing happens")
- **Non-goals:**

## Premise Check
- **Right problem?** (yes/no + one-line justification — take a position)
- **Direct path?** (yes/no + one-line justification)
- **What if we do nothing?** (concrete consequence, not "nothing happens")

## Forcing Questions
> Minimum 3 questions; each answer MUST contain at least one *specific* token: a concrete name, a role, a number, a repo-relative path, an external link, or a verbatim quote. Vague answers fail the linter.

| # | Forcing question | Specific answer | Decision impact | Q\\<n\\> decision |
|---|---|---|---|---|
| 1 |  |  |  | decision: |
| 2 |  |  |  | decision: |
| 3 |  |  |  | decision: |

## Premise List
> ≥2 premises. Each premise must be in the form \`P<n>: <statement> — agreed | disagreed | revised\`. \`revised\` rows must include the revised statement on the next line.

- P1: <statement> — agreed | disagreed | revised
- P2: <statement> — agreed | disagreed | revised

## Anti-Sycophancy Stamp
- **Forbidden response openers acknowledged:** yes (no "you're absolutely right", "great point", "absolutely!", etc.)
- **Posture commitment:** push back with reasoning when premises feel weak; do not perform agreement.
- **Evidence-that-would-change-the-recommendation:** (one line per premise, or \`- None.\`)

## How Might We
- *How might we …?* — one line naming the user, the desired outcome, and the binding constraint.

## Clarity Gate
- Ambiguity score (0.00-1.00):
- Decision boundaries (what this stage will decide):
- Reaffirmed non-goals:
- Residual-risk handoff to scope:

## Sharpening Questions
> Ask one decision-changing question at a time. For concrete early exits, record \`None - early exit\` with rationale.
| # | Question | Answer / Assumption | Decision impact |
|---|---|---|---|
| 1 |  |  |  |

## Clarifying Questions
| # | Question | Answer | Decision impact |
|---|---|---|---|
| 1 |  |  |  |

## Approach Tier
- Tier: lite | standard | deep
- Why this tier:

## Short-Circuit Decision
- Status: bypassed
- Why:
- Scope handoff:

## Approaches
| Approach | Role | Upside | Architecture | Trade-offs | Reuses / reference pattern | Recommendation |
|---|---|---|---|---|---|---|
| A | baseline | modest |  |  |  |  |
| B | challenger | high |  |  |  |  |

> Role values: \`baseline\` | \`challenger\` | \`wild-card\`. Upside values: \`low\` | \`modest\` | \`high\` | \`higher\`. Exactly one row must be a \`challenger\` with \`high\` or \`higher\` upside.

### Approach Detail Cards
> Required structural form per approach (≥2). One block per row above:

#### APPROACH A
- Summary:
- Effort:
- Risk:
- Pros:
- Cons:
- Reuses:

#### APPROACH B
- Summary:
- Effort:
- Risk:
- Pros:
- Cons:
- Reuses:

RECOMMENDATION: <approach letter — one-line rationale, traced to forcing-question answers and premise list>

## Outside Voice (optional)
- source: <model id | critic agent | human reviewer> | (or \`- not used.\`)
- prompt:
- tension:
- resolution:

## Approach Reaction
- Closest option:
- Concerns:
- What changed after reaction:

## Selected Direction
- **Approach:**
- **Rationale:** Trace this to the prior Approach Reaction.
- **Approval:** pending
- **Next-stage handoff:** On standard track, hand this to \`scope\`; on medium track, hand this directly to \`spec\`. Include upstream decisions used, drift, confidence, unresolved questions, risk hints, and non-goals.

## Not Doing
- (3-5 things this brainstorm is *not* committing to — distinct from \`Deferred\`. These will not appear in scope unless the user explicitly opts in.)

${SEED_SHELF_SECTION}

## Design
- **Architecture:**
- **Key components:**
- **Data flow:**

## Visual Companion
- (compact ASCII/Mermaid diagram for medium+ complexity, or one-line justification for omission.)

## Self-Review Notes
- Status: Approved
- Patches applied:
  - None
- Remaining concerns:
  - None

## Assumptions and Open Questions
- **Assumptions:**
- **Open questions (or "None"):**

## Learnings
- None this stage.
`,
  "02-scope.md": `${artifactFrontmatter("scope")}

# Scope Artifact

## Upstream Handoff
- Source artifacts: \`00-idea.md\`, \`01-brainstorm-<slug>.md\`
- Decisions carried forward:
- Constraints carried forward:
- Open questions:
- Drift from upstream (or \`None\`):

## Pre-Scope System Audit
| Check | Command | Findings |
|---|---|---|
| Recent commits | \`git log -30 --oneline\` |  |
| Current diff | \`git diff --stat\` |  |
| Stash state | \`git stash list\` |  |
| Debt markers | \`rg -n "TODO|FIXME|XXX|HACK"\` |  |

## Prime Directives
- Zero silent failures:
- Every error has a name:
- Four paths per data flow:

## Premise Challenge
| Question | Answer (take a position) | Evidence / leverage |
|---|---|---|
| Right problem? |  |  |
| Direct path? |  |  |
| What if we do nothing? |  |  |
| Existing-code leverage? |  |  |
| Reversibility cost? |  |  |

## Dream State Mapping
- Deep/optional only; omit for compact scope.
- CURRENT STATE:
- THIS PLAN:
- 12-MONTH IDEAL:
- Alignment verdict:

## Implementation Alternatives
| Option | Summary | Effort (S/M/L/XL) | Risk (Low/Med/High) | Pros | Cons | Reuses |
|---|---|---|---|---|---|---|
| A (minimum viable) |  |  |  |  |  |  |
| B (ideal architecture) |  |  |  |  |  |  |
| C (optional) |  |  |  |  |  |  |

RECOMMENDATION: <option letter — one-line rationale tying back to premise challenge and existing-code leverage>

## Failure Modes Registry
> Universal failure-mode shape — applies to CLI, library, infra, web, batch jobs.

| Codepath | Failure mode | Rescued? (yes/no) | Test? (unit/integration/e2e) | User sees? (message/silent/N/A) | Logged? (level/none) | Q\\<n\\> decision |
|---|---|---|---|---|---|---|
|  |  |  |  |  |  | decision: |

## Reversibility Rating
- Score (1-5, 1 = one-way door / unrecoverable, 5 = trivially reversible):
- Justification (cite a specific artifact/file or migration step):
- Rollback plan reference:

## Temporal Interrogation
- Deep/optional only; omit for compact scope.
| Time slice | Likely decision pressure | Lock now or defer? | Reason |
|---|---|---|---|
| HOUR 1 (foundations) |  |  |  |
| HOUR 2-3 (core logic) |  |  |  |
| HOUR 4-5 (integration) |  |  |  |
| HOUR 6+ (polish/tests) |  |  |  |

## Scope Contract
- **Selected mode:** HOLD SCOPE | SELECTIVE EXPANSION | SCOPE EXPANSION | SCOPE REDUCTION
- **In scope:**
- **Out of scope:**
- **Requirements:**
- **Locked decisions:**
- **Discretion areas:**
- **Deferred ideas:**
- **Accepted reference ideas:**
- **Rejected reference ideas:**
- **Success definition:**
- **Design handoff:**

## Decision Drivers
| Driver | Weight (1-5) | Option A | Option B | Option C | Notes |
|---|---|---|---|---|---|
| Value impact |  |  |  |  |  |
| Risk reduction |  |  |  |  |  |
| Reversibility |  |  |  |  |  |
| Delivery effort |  |  |  |  |  |
| Timeline fit |  |  |  |  |  |

## Scope Completeness Score
- Score (0.00-1.00):
- What is still uncertain:
- Blockers requiring escalation:

## Scope Mode
- [ ] SCOPE EXPANSION — explore ambitious alternatives; user explicitly opts into the larger product slice.
- [ ] SELECTIVE EXPANSION — hold baseline scope and cherry-pick one high-leverage addition.
- [ ] HOLD SCOPE — preserve the approved brainstorm direction with maximum rigor.
- [ ] SCOPE REDUCTION — strip to the smallest useful wedge when risk/blast radius is too high.

## Mode-Specific Analysis
| Selected mode | Rationale | Depth |
|---|---|---|
|  |  | lite / standard / deep |

> Default path: one selected-mode row plus rationale. Deep/high-risk scope may expand with optional evidence headings below.

## Landscape Check
- Optional for EXPAND/SELECTIVE/deep; omit for compact HOLD SCOPE.

## Taste Calibration
- Optional quality-bar references from in-repo modules/files.

## Reference Pattern Registry
| Pattern / source | Invariant to preserve | Disposition (accepted/rejected/deferred) | Scope boundary impact |
|---|---|---|---|
|  |  |  |  |

## Reference Pull
- Optional evidence from \`<repo-relative references dir>\`; list accepted/rejected ideas or \`Not needed - compact scope\`.

## Ambitious Alternatives
- Optional for SCOPE EXPANSION/SELECTIVE; list larger alternatives and disposition.

## Ruthless Minimum Slice
- Optional for SCOPE REDUCTION/high-risk scope; define the smallest useful wedge.

## Requirements (stable IDs)
| ID | Requirement (observable outcome) | Priority | Source (origin doc / prompt line) |
|---|---|---|---|
| R1 |  | P0 |  |

> Assign \`R1\`, \`R2\`, \`R3\`… once and never renumber. Downstream artifacts
> (design, spec, plan, review) reference these IDs verbatim. If a requirement
> is later dropped, keep the row and mark Priority \`DROPPED\`; if a new one is
> added mid-flow, append with the next free R-number — do NOT reuse numbers.

## Locked Decisions (LD#hash)
| Decision Anchor | Decision | Why locked now | Downstream impact |
|---|---|---|---|
| LD#<sha8> |  |  |  |

> Decision Anchor is \`LD#\` + the first 8 lowercase hex chars of SHA-256 over
> the normalized \`Decision\` cell (trim, collapse whitespace, lowercase). Downstream
> design/spec/plan/review artifacts reference these anchors verbatim.

## In Scope / Out of Scope

### In Scope
- 

### Out of Scope
- 

## Discretion Areas
- (or \`None\`)

## Deferred Items
| Item | Rationale |
|---|---|
|  |  |

${SEED_SHELF_SECTION}

## Error & Rescue Registry
| Capability | Failure mode | Detection | Fallback |
|---|---|---|---|
|  |  |  |  |

## Outside Voice Findings
| ID | Dimension | Finding | Disposition | Rationale |
|---|---|---|---|---|
| F-1 | premise_fit |  | accept/reject/defer |  |

## Scope Outside Voice Loop
| Iteration | Quality Score | Findings | Stop decision |
|---|---|---|---|
| 1 | 0.00 | 0 | continue/stop |
- Stop reason:
- Target score: 0.800
- Max iterations: 3
- Unresolved concerns:

## Completion Dashboard
- Checklist findings:
- Resolved decisions count:
- Unresolved decisions (or \`None\`):

## Scope Summary
- Selected mode: (one of \`SCOPE EXPANSION\` | \`SELECTIVE EXPANSION\` | \`HOLD SCOPE\` | \`SCOPE REDUCTION\`)
- Confidence: high | medium | low
- Drift from brainstorm: None / <specific drift>
- Unresolved questions: None / <questions>
- Strongest challenges resolved:
- Recommended path:
- Accepted scope:
- Deferred:
- Explicitly excluded:
- Next-stage handoff: identify whether the next stage is \`design\` (standard track) or \`spec\` (medium track), and list the exact artifacts/decisions it must carry forward.

## Learnings
- None this stage.
`,
  "02a-research.md": `${artifactFrontmatter("design")}

# Research Report

## Stack Analysis
| Topic | Finding | Evidence |
|---|---|---|
| Dependency compatibility |  |  |
| Alternatives/deprecations |  |  |

## Features & Patterns
| Topic | Finding | Evidence |
|---|---|---|
| Domain conventions |  |  |
| User-facing or operator-facing patterns |  |  |

## Architecture Options
| Option | Trade-offs | Recommendation | Evidence |
|---|---|---|---|
| A |  |  |  |
| B |  |  |  |

## Pitfalls & Risks
| Risk | Impact | Mitigation | Evidence |
|---|---|---|---|
|  |  |  |  |

## Synthesis
- Key decisions informed by research:
- Open questions:

## Learnings
- None this stage.
`,
  "03-design.md": `${artifactFrontmatter("design")}

# Design Artifact

## Compact-First Scaffold
- Default to the compact design spine unless risk requires Standard/Deep add-ons.
- Compact required spine: Upstream Handoff, Codebase Investigation, Engineering Lock, Architecture Boundaries, Architecture Diagram, Data Flow, Failure Mode Table, Test Strategy, Spec Handoff, and Completion Dashboard.
- Mark optional Standard/Deep sections as \`Omitted - compact design\` when they do not apply; do not expand the scaffold just to fill empty tables.

## Upstream Handoff
- Source artifacts: \`02-scope-<slug>.md\`, \`02a-research.md\` only when present for deep/high-risk research
- Decisions carried forward:
- Constraints carried forward:
- Open questions:
- Drift from upstream (or \`None\`):

## Codebase Investigation
| File | Current responsibility | Patterns discovered | Existing fit / reuse candidate |
|---|---|---|---|
|  |  |  |  |

## Engineering Lock
| Decision area | Chosen path | Shadow alternative | Switch trigger | Failure/rescue/degraded behavior | Verification evidence | Confidence |
|---|---|---|---|---|---|---|
|  |  |  |  |  |  |  |

## Architecture Decision Record (ADR)
| ADR ID | Context | Decision | Alternatives considered | Consequences | Reversal trigger |
|---|---|---|---|---|---|
| ADR-1 |  |  |  |  |  |

## Search Before Building
| Layer | Label | What to reuse first |
|---|---|---|
| Layer 1 |  |  |
| Layer 2 |  |  |
| Layer 3 |  |  |

## Research Fleet Synthesis
| Lens actually run | Key findings | Design impact | Evidence |
|---|---|---|---|
| compact inline synthesis |  |  |  |

> Default path: compact inline synthesis here. Deep/high-risk work may also write \`.cclaw/artifacts/02a-research.md\`.

## Architecture Boundaries
| Component | Responsibility | Requirement Refs (R#) | Decision Refs (LD#hash) | Owner |
|---|---|---|---|---|
|  |  |  |  |  |

## Architecture Diagram

<!-- diagram: architecture -->

${MARKDOWN_CODE_FENCE}
(ASCII, Mermaid, or tool-generated diagram showing component boundaries and data flow direction)
${MARKDOWN_CODE_FENCE}

## Data-Flow Shadow Paths
- Standard/Deep add-on; omit when compact design does not need a shadow path.
<!-- diagram: data-flow-shadow-paths -->
| Chosen path | Shadow alternative | Switch trigger | Failure/rescue/degraded behavior | Verification evidence |
|---|---|---|---|---|
|  |  |  |  |  |

## Error Flow Diagram
- Standard/Deep add-on; omit when the Failure Mode Table is sufficient.

<!-- diagram: error-flow -->

${MARKDOWN_CODE_FENCE}
(failure detection -> rescue action -> user-visible outcome)
${MARKDOWN_CODE_FENCE}

## State Machine Diagram
- Deep add-on; omit for compact design.

<!-- diagram: state-machine -->

${MARKDOWN_CODE_FENCE}
(state transitions for the critical flow lifecycle)
${MARKDOWN_CODE_FENCE}

## Rollback Flowchart
- Deep add-on; omit for compact design.

<!-- diagram: rollback-flowchart -->

${MARKDOWN_CODE_FENCE}
(trigger -> rollback actions -> verification)
${MARKDOWN_CODE_FENCE}

## Deployment Sequence Diagram
- Deep add-on; omit for compact design.

<!-- diagram: deployment-sequence -->

${MARKDOWN_CODE_FENCE}
(rollout order, guard checks, and verification sequence)
${MARKDOWN_CODE_FENCE}

## Stale Diagram Audit
| File | Last modified | Diagram marker baseline | Status | Notes |
|---|---|---|---|---|
|  |  |  | clear/stale |  |

## What Already Exists
| Sub-problem | Existing code/library | Layer | Reuse decision |
|---|---|---|---|
|  |  |  |  |

## Data Flow
- Data/state flow:
- Critical path:
- Happy path:
- Nil/empty input path:
- Upstream error path:
- Timeout/downstream path:

### Interaction Edge Case Matrix
| Edge case | Handled? | Design response | Deferred item (if not handled) |
|---|---|---|---|
| double-click | yes/no |  | None / LD#hash |
| nav-away-mid-request | yes/no |  | None / LD#hash |
| 10K-result dataset | yes/no |  | None / LD#hash |
| background-job abandonment | yes/no |  | None / LD#hash |
| zombie connection | yes/no |  | None / LD#hash |

## Security & Threat Model
| Boundary | Threat | Mitigation | Owner |
|---|---|---|---|
|  |  |  |  |

## Failure Mode Table
| Method | Exception | Rescue | UserSees |
|---|---|---|---|
|  |  |  |  |

## Pre-mortem
| Scenario | Earliest warning signal | Mitigation owner | Containment action |
|---|---|---|---|
|  |  |  |  |

## Test Strategy
- Unit:
- Integration:
- E2E:

## Test-Diagram Mapping
| Critical flow | Test coverage (ID/command) | Diagram anchor | Gap status |
|---|---|---|---|
|  |  |  | covered/gap |

## ASCII Coverage Diagram

<!-- diagram: ascii-coverage -->

${MARKDOWN_CODE_FENCE}
entry-point
  ├── happy path           [★★★]
  ├── empty input          [★★]
  ├── error path           [★]
  ├── concurrency edge     [GAP]
  ├── slow-network edge    [→E2E]
  └── perf regression      [→EVAL]
${MARKDOWN_CODE_FENCE}

> Required marker tokens (at least one each present where applicable): \`[★★★]\` / \`[★★]\` / \`[★]\` / \`[GAP]\` / \`[→E2E]\` / \`[→EVAL]\`. The diagram is the single source of truth for coverage; gaps must be traced into Plan or Spec.

## Regression Iron Rule
- Iron rule acknowledged: yes — any diff that changes existing behavior gets a regression test added to the plan, no exceptions.
- Detected behavior changes (or \`- None.\`):
- Regression test handoff (Plan task ID or \`- None.\`):

## Calibrated Findings
> Format: \`[P1|P2|P3] (confidence: <n>/10) <repo-relative-path>[:<line>] — <one-line description>\`. Findings with confidence \`< 7\` are suppressed unless severity is \`P1\`.

- (or \`- None this stage.\`)

## Performance Budget
| Critical path | Metric | Target | Measurement method |
|---|---|---|---|
|  |  |  |  |

## Observability & Debuggability
| Signal | Source | Alert/Debug path |
|---|---|---|
|  |  |  |

## Deployment & Rollout
| Step | Strategy | Rollback plan |
|---|---|---|
|  |  |  |

## Rejected Alternatives
| Alternative | Why rejected | Revival signal |
|---|---|---|
|  |  |  |

## Design Decisions
| Decision Ref | Requirement / LD refs | Decision | Spec impact |
|---|---|---|---|
| DD-1 |  |  |  |

## Spec Handoff
- Requirements to carry forward:
- Design decisions to encode:
- Risks and rescue paths:
- Test/performance expectations:
- Unresolved questions (or \`None\`):

## Outside Voice Findings
| ID | Dimension | Finding | Disposition | Rationale |
|---|---|---|---|---|
| F-1 | architecture_fit |  | accept/reject/defer |  |

## Design Outside Voice Loop
| Iteration | Quality Score | Findings | Stop decision |
|---|---|---|---|
| 1 | 0.00 | 0 | continue/stop |
- Stop reason:
- Target score: 0.800
- Max iterations: 3
- Unresolved concerns:

## NOT in scope
- 

## Parallelization Strategy
- Standard/Deep add-on when multi-module; omit for compact sequential work.
- Parallel lanes:
- Conflict risks:

## Patterns to Mirror
| Pattern | Source file | Rationale |
|---|---|---|
|  |  |  |

## Reference-Grade Contracts
| Pattern / source | Reusable invariant | Local adaptation | Rejection boundary | Verification signal |
|---|---|---|---|---|
|  |  |  |  |  |

## Interface Contracts
- Standard/Deep add-on when module boundaries or APIs change; omit for compact local changes.
| Module | Produces | Consumes |
|---|---|---|
|  |  |  |

## Unresolved Decisions
- Standard/Deep add-on; use \`None\` for compact design with no unresolved decisions.
| Decision | Missing info | Owner | Default |
|---|---|---|---|
|  |  |  |  |

${SEED_SHELF_SECTION}

## Completion Dashboard
| Review Section | Status | Issues |
|---|---|---|
| Architecture Review |  |  |
| Security & Threat Model |  |  |
| Code Quality Review |  |  |
| Data Flow & Interaction Edge Cases |  |  |
| Test Review |  |  |
| Performance Review |  |  |
| Observability & Debuggability |  |  |
| Deployment & Rollout Review |  |  |

**Decisions made:** 0 | **Unresolved:** 0

## Learning Capture Hint
For meaningful design work, replace the Learnings sentinel with 1-3 JSON learning bullets, for example: \`- {"type":"lesson","trigger":"when design chooses a risky fallback path","action":"record the switch trigger and rollback signal in Spec Handoff","confidence":"medium","domain":"architecture","stage":"design"}\`

## Learnings
- None this stage.
`,
  "04-spec.md": `${artifactFrontmatter("spec")}

# Specification Artifact

## Upstream Handoff
- Source artifacts: standard uses \`02-scope-<slug>.md\` + \`03-design-<slug>.md\`; medium uses \`01-brainstorm-<slug>.md\` when present; quick uses \`00-idea.md\` plus reproduction context.
- Decisions carried forward:
- Constraints carried forward:
- Open questions:
- Drift from upstream (or \`None\`):

## Acceptance Criteria
| ID | Requirement Ref (R#) | Criterion (observable/measurable/falsifiable) | Design Decision Ref (LD#hash) |
|---|---|---|---|
| AC-1 | R1 |  |  |

> Standard ACs reference at least one \`R#\` from \`02-scope.md\`. Quick-track ACs may instead put \`Quick Reproduction Contract\` / bug-slice refs in the Requirement Ref column and \`N/A\` for Design Decision Ref. ACs are stable (never renumber): dropped ACs stay with Priority \`DROPPED\`; new ones append with the next free \`AC-#\`.

## Quick Reproduction Contract
> Required for quick bug-fix specs; use \`N/A\` for non-bugfix or standard/medium tracks. TDD turns this contract into the RED reproduction test.

| Bug slice | Symptom | Repro steps | Expected RED test behavior | Linked acceptance criterion |
|---|---|---|---|---|
| QS-1 |  |  |  | AC-1 |

## Edge Cases
| Criterion ID | Boundary case | Error case |
|---|---|---|
| AC-1 |  |  |

## Constraints and Assumptions
- Constraints:
- Assumptions:

## Assumptions Before Finalization
| Assumption | Source / confidence | Validation path | Disposition |
|---|---|---|---|
|  |  |  | accepted/rejected/open |

## Acceptance Mapping
| Criterion ID | Verification approach | Command/manual steps |
|---|---|---|
| AC-1 |  |  |

## Vague to Fixed
| Original (vague) | Rewritten (observable/testable) |
|---|---|
|  |  |

## Non-Functional Requirements
| Category | Requirement | Threshold | Measurement |
|---|---|---|---|
|  |  |  |  |

## Interface Contracts
| Module | Produces | Consumes |
|---|---|---|
|  |  |  |

## Synthesis Sources
> Spec is synthesized from existing context (CLAUDE.md / AGENTS.md / TODOS.md / git history / brainstorm + scope + design artifacts) — interview only when something genuinely cannot be derived. List the artifacts/files actually read and what each supplied.

| Source | What it supplied | Confidence (1-10) |
|---|---|---|
|  |  |  |

## Behavior Contract
> List behaviors universally (works for CLI, library, infra, web, batch). Use either \`As a <role>, I can <action> so that <outcome>.\` or \`Given <state>, When <event>, Then <outcome>.\`. ≥3 behaviors required. The shape — not the topic — is what the linter checks.

- (or write \`- None.\` if a single-step spec)

## Architecture Modules
> One line of responsibility per module — no file paths, no signatures, no method names. Modules must be derivable from the design artifact.

| Module | Responsibility (one sentence) | Maps to design ref (DD-#) |
|---|---|---|
|  |  |  |

## Testing Strategy
- Behaviors covered (not implementation):
- Integration vs. unit split (and why):
- Real services vs. doubles (and why):
- Coverage gaps with rationale (or \`- None.\`):

## Spec Self-Review
> Inline pass; fix in place. If a check fails, do not move on without recording the fix.

- [ ] Placeholders scan (no \`TBD\`, \`TODO\`, \`FIXME\`, \`<placeholder>\`)
- [ ] Internal consistency (sections do not contradict each other)
- [ ] Scope check (focused enough for a single plan)
- [ ] Ambiguity check (no requirement readable two ways)
- Patches applied:
  - None
- Remaining concerns:
  - None

## Reviewer Concerns (convergence guard)
> Populate ONLY if the spec review loop did not converge after 3 iterations. Each row links a concern to the unresolved review pass.

| ID | Concern | Reviewer / source | Disposition (open/accept/defer) | Rationale |
|---|---|---|---|---|
|  |  |  |  |  |

## Approval
- Approved by:
- Date:

## Learnings
- None this stage.
`,
  "05-plan.md": `${artifactFrontmatter("plan")}

# Plan Artifact

## Plan Header
- **Goal:** (one sentence — what this plan delivers)
- **Architecture:** (2-3 sentences — approach + key boundaries)
- **Tech Stack:** (key languages/runtimes/frameworks/libraries that the executor must know)

## Upstream Handoff
- Source artifacts: \`03-design-<slug>.md\`, \`04-spec.md\`
- Decisions carried forward:
- Constraints carried forward:
- Open questions:
- Drift from upstream (or \`None\`):

## Dependency Graph
- 

## Dependency Batches

### Batch 1 (foundation)
- Task IDs:
- Verification gate:

### Batch 2 (dependent)
- Task IDs:
- Depends on:
- Verification gate:

### Batch 3 (integration)
- Task IDs:
- Depends on:
- Verification gate:

Execution rule: complete and verify each batch before starting the next batch.

## Task List

**Rules (apply before writing rows):**
- Every task fits the **2-5 minute budget**. If \`[~Nm]\` is >5, split the task.
- **No placeholders.** Forbidden tokens anywhere in this table: \`TODO\`, \`TBD\`, \`FIXME\`, \`<fill-in>\`, \`<your-*-here>\`, \`xxx\`, bare ellipsis. Every file path, test, and verification command must be copy-pasteable as written.
- **No silent scope reduction.** Forbidden phrasing when locked decisions exist: \`v1\`, \`for now\`, \`later\`, \`temporary\`, \`placeholder\`, \`mock for now\`, \`hardcoded for now\`, \`will improve later\`.
- If an estimate is genuinely uncertain (new library, unfamiliar subsystem), add a **spike task in batch 0** to de-risk — do NOT hide the uncertainty inside a large estimate.

| Task ID | Description | Acceptance criterion | Verification command | Effort (S/M/L) | Minutes |
|---|---|---|---|---|---|
| T-1 |  |  |  |  | [~3m] |

## Acceptance Mapping
| Criterion ID | Task IDs |
|---|---|
| AC-1 | T-1 |

## Execution Posture
- Posture: sequential | dependency-batched | parallel-safe | blocked
- Stop conditions:
- Risk triggers:
- TDD checkpoint plan: RED commit/checkpoint -> GREEN commit/checkpoint -> REFACTOR commit/checkpoint (or deferred because: )

## Locked Decision Coverage
| Decision Ref (LD#hash) | Source section | Plan tasks implementing decision | Status |
|---|---|---|---|
| LD#<sha8> | 02-scope.md > Locked Decisions | T-1 | covered |

## Risk Assessment
| Task/Batch | Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
|  |  |  |  |  |

## Boundary Map
| Task/Batch | Produces (exports) | Consumes (imports from) |
|---|---|---|
|  |  |  |

## Implementation Units
> Required structural form per implementation unit. Use ≥1 unit; bite-sized 2-5 minute steps inside each. The linter validates shape, not topic.

### Implementation Unit U-1
- **Goal:**
- **Requirements (from Spec):**
- **Dependencies (other units):**
- **Files (repo-relative; never absolute):**
  - Create:
  - Modify:
  - Test:
- **Approach:** (1-3 sentences; cite design decision DD-# or LD#hash)
- **Patterns to follow:** (link existing files/modules to mirror, or \`- None applicable.\`)
- **Test scenarios:**
  - Happy:
  - Edge:
  - Error:
  - Integration:
- **Verification:** (outcome to observe — not a shell script; e.g., "command exits 0 and prints \`<artifact-anchor>\`").
- **Steps (each 2-5 min, checkbox):**
  - [ ] Step 1: write failing test for <behavior>
  - [ ] Step 2: run test, observe RED with reason
  - [ ] Step 3: minimal implementation
  - [ ] Step 4: run test, observe GREEN
  - [ ] Step 5: refactor + commit

## High-Level Technical Design
> "Directional guidance, not implementation specification." Choose the form that fits the work: pseudo-code grammar, mermaid sequence/state, data-flow ASCII, decision matrix. Skip if the plan is a pure rename/move.

\`\`\`
(pseudo-code, mermaid, ASCII data flow, or decision matrix)
\`\`\`

## Plan Self-Review
- [ ] Spec coverage: every spec behavior maps to a unit/task
- [ ] Placeholder scan (regex on full artifact, not only Task List)
- [ ] Type/name consistency across units (signatures referenced match definitions)
- [ ] No silent scope reduction
- [ ] Confidence per unit recorded (1-10)
- Patches applied:
  - None
- Remaining concerns:
  - None

## Execution Handoff
- **Posture chosen:** Subagent-Driven (recommended) | Inline executor
- **Why this posture:** (one line tying choice to plan size, parallelism, novelty)
- **Subagent recipe (if Subagent-Driven):** \`<harness>\` -> \`<dispatch surface>\` -> \`<agent-definition path>\` (substitute neutral placeholders; full recipes in \`docs/harnesses.md\`)
- **Inline recipe (if Inline executor):** TDD loop unit-by-unit with batch checkpoints

## No-Placeholder Scan
- Scanned tokens: \`TODO\`, \`TBD\`, \`FIXME\`, \`<fill-in>\`, \`<your-*-here>\`, \`xxx\`, bare ellipsis in task rows.
- Hits: 0 (required for WAIT_FOR_CONFIRM to resolve).

## No Scope Reduction Language Scan
- Scanned phrases: \`v1\`, \`for now\`, \`later\`, \`temporary\`, \`placeholder\`, \`mock for now\`, \`hardcoded for now\`, \`will improve later\`.
- Hits: 0 (required when Locked Decisions section is non-empty; use LD#hash anchors).

## WAIT_FOR_CONFIRM
- Status: pending
- Confirmed by:

## Learnings
- None this stage.
`,
  "06-tdd.md": `${artifactFrontmatter("tdd")}

# TDD Artifact

## Upstream Handoff
- Source artifacts: \`04-spec.md\` plus the active track's upstream source item (plan slice on standard/medium, spec acceptance item or bug reproduction slice on quick).
- Decisions carried forward:
- Constraints carried forward:
- Open questions:
- Drift from upstream (or \`None\`):

## Test Discovery
| Slice | Existing tests / helpers / fixtures | Exact command(s) | Pattern to extend |
|---|---|---|---|
| S-1 |  |  |  |

## System-Wide Impact Check
| Slice | Callbacks/state/interfaces/contracts affected | Coverage decision |
|---|---|---|
| S-1 |  | covered/out-of-scope because  |

## Execution Posture
- Posture: sequential | dependency-batched | blocked
- Vertical-slice RED/GREEN/REFACTOR checkpoint plan:
- Incremental commits: yes/no/deferred because

## RED Evidence
| Slice | Test name | Command | Failure output summary |
|---|---|---|---|
| S-1 |  |  |  |

## Acceptance Mapping
| Vertical slice | Source item ID | Spec criterion ID |
|---|---|---|
| S-1 | SRC-1 | AC-1 |

> Map each slice to the active track's source item: plan slice on standard/medium, or the \`Quick Reproduction Contract\` bug slice / spec acceptance item on quick.

## Failure Analysis
| Slice | Expected missing behavior | Actual failure reason |
|---|---|---|
| S-1 |  |  |

## GREEN Evidence
- Full suite command:
- Full suite result:

## REFACTOR Notes
- What changed:
- Why:
- Behavior preserved:

## Traceability
- Source item IDs:
- Spec criterion IDs:


## Iron Law Acknowledgement
- Iron Law: NO PRODUCTION CODE WITHOUT A FAILING TEST FIRST.
- Acknowledged: yes — code that landed before its test will be deleted and rewritten from the test.
- Exceptions invoked (or \`- None.\`):

## Watched-RED Proof
> Required for every new test in this stage. Each row proves the test was *observed* failing before any production code was written.

| Slice | Test name | Observed at (ISO ts) | Failure reason snippet | Source command/log |
|---|---|---|---|---|
| S-1 |  |  |  |  |

## Vertical Slice Cycle
> Per slice: RED -> GREEN -> REFACTOR within the same cycle (refactor not deferred). The linter checks structural presence of all three phases.

| Slice | RED ts | GREEN ts | REFACTOR ts (or \`deferred because <reason>\`) |
|---|---|---|---|
| S-1 |  |  |  |

## Assertion Correctness Notes
> For each new test assertion, name a *plausible subtle bug* that would still pass it (mental mutation test). If you cannot, the assertion is too coarse — strengthen it.

| Slice | Assertion (one line) | Bug that would still pass | Strengthening action (or \`- Sufficient.\`) |
|---|---|---|---|
| S-1 |  |  |  |

## Anti-Rationalization Checks
- [ ] No "test passes immediately" — each new test was watched failing first
- [ ] No "code before test" reuse from a prior session
- [ ] No "tests after" backfill instead of RED-first
- [ ] No "spirit not ritual" overrides
- Notes (or \`- None this stage.\`):

## Verification Ladder
| Slice | Tier reached | Evidence |
|---|---|---|
| S-1 |  |  |

## Coverage Targets
| Code type | Target | Current | Command |
|---|---|---|---|
|  |  |  |  |

## Test Pyramid Shape
> Fill in per slice. Size classes: **Small** = pure logic, no I/O, <50ms; **Medium** = single process boundary (fs, in-memory DB, in-process service); **Large** = multi-process / network / real external service. Default to Small; escalate only when a real boundary must be exercised.

| Slice | # Small | # Medium | # Large | Justification for any Medium/Large |
|---|---|---|---|---|
| S-1 |  |  |  |  |

## Prove-It Reproduction (bug-fix slices only)
> Required whenever the slice is classified as a **bug fix** (task class = \`software-bugfix\`). Must demonstrate the test fails without the fix, passes with the fix, and would fail again if the fix were reverted. Skip this table entirely for non-bugfix slices.

| Slice | Reproduction test | RED-without-fix evidence | GREEN-with-fix evidence | Revert-guard note |
|---|---|---|---|---|
| S-1 |  |  |  |  |

## Learning Capture Hint
For meaningful TDD work, replace the Learnings sentinel with 1-3 JSON learning bullets, for example: \`- {"type":"pattern","trigger":"when a regression only fails after state rewind","action":"keep the RED fixture and add a cycle-log assertion before GREEN","confidence":"medium","domain":"testing","stage":"tdd"}\`

## Learnings
- None this stage.
`,
  "07-review.md": `${artifactFrontmatter("review")}

# Review Artifact

## Upstream Handoff
- Source artifacts: \`04-spec.md\`, \`06-tdd.md\`, plus the active track's upstream source item when available.
- Decisions carried forward:
- Constraints carried forward:
- Open questions:
- Drift from upstream (or \`None\`):

## Self-Review First
- [ ] Build/lint/type-check/tests passed locally
- [ ] Diff matches spec/plan (no scope creep)
- [ ] Leftover prints / commented code / unused imports removed
- [ ] Deletion test: each new module justifies its existence
- Evidence (commands + result):
- Patches applied (or \`- None.\`):

## Frame the Review Request
- **Goal:**
- **Approach:**
- **Risk areas:**
- **Verification done:**
- **Open questions for the reviewer:**

## Critic Subagent Dispatch
> Dispatch a fresh-context critic (not the session history). Required even for self-driven review — the critic delegates back via \`delegation-record.mjs\` so the proof chain is preserved.

| Field | Value |
|---|---|
| Critic agent definition path | \`<repo-relative path under harness directory>\` |
| Dispatch surface | One of the \`--dispatch-surface\` enum values listed in \`docs/harnesses.md\` (\`claude-task\`, \`cursor-task\`, \`opencode-agent\`, \`codex-agent\`, \`generic-task\`, \`role-switch\`, \`manual\`) |
| Frame sent | WHAT_WAS_IMPLEMENTED + PLAN_OR_REQUIREMENTS + BASE_SHA + HEAD_SHA |
| Critic returned | Strengths / Critical / Important / Minor |
| Span id | \`<span-id>\` |
| Acknowledgement ts | \`<iso ts>\` |

## Receiving Posture
- [ ] No performative agreement (forbidden openers acknowledged)
- [ ] READ -> UNDERSTAND -> VERIFY -> EVALUATE -> RESPOND -> IMPLEMENT one-at-a-time discipline followed
- [ ] Push-back recorded with reasoning when the critic was wrong
- Notes (or \`- None.\`):

## Critic Convergence
- Iterations run: <n>/3
- Convergence reached: yes / no — \`Reviewer Concerns\` populated when no
- Stop reason:

## Review Evidence Scope
- Base/head:
- Files inspected:
- Changed-file coverage summary:
- Diagnostics run:
- Omitted files with explicit reason:
- Reviewer delegation evidence:
- Security-reviewer delegation evidence:

## Changed-File Coverage
| File | Coverage status | Evidence / no-impact reason |
|---|---|---|
|  | inspected / broader-module / omitted-no-impact |  |

## Layer 1 Verdict
| Criterion | Verdict | Evidence |
|---|---|---|
| AC-1 | PASS/FAIL |  |

## Layer 2 Findings
| ID | Severity | Category | File:line / no-line reason | Description | Status |
|---|---|---|---|---|---|
| R-1 | Critical/Important/Suggestion | correctness/security/performance/architecture/external-safety | path:line |  | open/resolved |
- NO_FINDINGS_ATTESTATION: <required when no findings are reported; cite inspected coverage>

## Security Sweep Attestation
- Result: findings | NO_CHANGE_ATTESTATION | NO_SECURITY_IMPACT
- Inspected surfaces:
- Rationale:

## Dependency & Version Audit
- Relevant: yes/no
- Manifests/lockfiles/generated clients/CI/runtime config/external APIs inspected:
- Result / no-impact rationale:

## Incoming Feedback Queue
| ID | Source | Severity | File:line | Request | Status | Evidence |
|---|---|---|---|---|---|---|
| CR-1 | reviewer / bot / ci | Critical/Important/Suggestion | path:line or n/a |  | open/in-progress/resolved/accepted-risk/rejected-with-evidence |  |

## Review Findings Contract
- See \`07-review-army.json\`
- Reconciliation summary:

## Review Readiness Snapshot

- Victory Detector: pass | fail (Layer 1, Layer 2, security sweep, structured findings, trace evidence, unresolved-critical status)
- Completed checks: Layer 1, Layer 2 tags, security sweep, schema validation
- Delegation log: \`.cclaw/state/delegation-log.json\` required/completed/waived/pending
- Staleness signal: commit at last review pass vs current commit
- Open critical blockers:
- Ship recommendation: APPROVED | APPROVED_WITH_CONCERNS | BLOCKED


## Completeness Snapshot
- AC coverage: <N>/<M> (<percent>%)
- Source item coverage (source items backed by ≥1 test slice): <N>/<M> or \`N/A - direct spec/reproduction coverage\`
- Slice coverage (slices linked to ≥1 AC or bug reproduction slice): <N>/<M>
- Adversarial review: not triggered | pass | fail
- Overall: complete | concerns | blocked

## Trace Matrix Check
- Command: \`cclaw internal trace-matrix\` when the active track enforces it; otherwise record direct AC/reproduction-slice coverage.
- Orphaned criteria: 0
- Orphaned source items: 0 or \`N/A - direct spec/reproduction coverage\`
- Orphaned tests: 0
- Evidence ref:

## Verification Command Discovery
| Source | Discovered command | Result | Evidence ref |
|---|---|---|---|
| package.json / pytest / go.mod / Cargo.toml / pom.xml / gradle |  | PASS/FAIL |  |

## Blocked Route
- ROUTE_BACK_TO_TDD: only when Final Verdict = BLOCKED
- Target stage: tdd
- Blocking finding IDs:
- Rewind command payload:

## Severity Summary
- Critical:
- Important:
- Suggestion:

## Final Verdict
- APPROVED | APPROVED_WITH_CONCERNS | BLOCKED

## Learning Capture Hint
For meaningful review work, replace the Learnings sentinel with 1-3 JSON learning bullets, for example: \`- {"type":"lesson","trigger":"when security sweep finds no issues but touches trust boundaries","action":"record NO_SECURITY_IMPACT with inspected surfaces and rationale","confidence":"medium","domain":"security","stage":"review"}\`

## Learnings
- None this stage.
`,
  "07-review-army.json": `{
  "version": 1,
  "generatedAt": "<ISO 8601 timestamp, e.g. 2026-04-14T12:00:00Z>",
  "scope": {
    "base": "<base branch or ref>",
    "head": "<head branch or ref>",
    "files": []
  },
  "findings": [],
  "reconciliation": {
    "duplicatesCollapsed": 0,
    "conflicts": [],
    "multiSpecialistConfirmed": [],
    "layerCoverage": {
      "spec": false,
      "correctness": false,
      "security": false,
      "performance": false,
      "architecture": false,
      "external-safety": false
    },
    "shipBlockers": []
  }
}
`,
  "08-ship.md": `${artifactFrontmatter("ship")}

# Ship Artifact

## Upstream Handoff
- Source artifacts: \`06-tdd.md\`, \`07-review.md\`
- Decisions carried forward:
- Constraints carried forward:
- Open questions:
- Drift from upstream (or \`None\`):

## Verify Tests Gate
- Discovered test command (cite repo config — package scripts / pyproject / go.mod / Cargo.toml / pom.xml / gradle):
- Result: PASS | FAIL
- Evidence (full output snippet or path):
- Stop on FAIL: confirmed (no options surface unless PASS)

## Preflight Results
- Review verdict:
- Build:
- Tests:
- Lint:
- Type-check:
- Working tree clean:

## Base Branch Determination
- Command run: \`git merge-base HEAD main || git merge-base HEAD master\`
- Base branch:
- User confirmation (if ambiguous):

## Finalization Options
> Exactly four options must be surfaced when tests pass. Selecting any option requires a recorded user decision.

1. **Merge back to base locally** — \`MERGE_LOCAL\`
2. **Push and create PR** — \`OPEN_PR\`
3. **Keep branch as-is** — \`KEEP_BRANCH\`
4. **Discard this work** — \`DISCARD\` (typed-confirmation required)

- Selected option:
- Typed confirmation (DISCARD only):
- User decision recorded at:

## Release Notes
-

## Structured PR Body
> Required when selected option is \`OPEN_PR\`. The structure is universal — replace placeholder bullets with concrete content, do not introduce domain-specific subsections.

### ## Summary
- (2-3 bullets describing what changed and why)

### ## Test Plan
- [ ] (verification step — repo-relative command + expected outcome)
- [ ] (additional verification step or \`Manual: <action>\`)

### ## Commits Included
- (auto-generated commit list; one bullet per commit hash + subject)

## Worktree Cleanup
- Cleanup applies to options \`MERGE_LOCAL\` and \`DISCARD\`; preserved for \`OPEN_PR\` and \`KEEP_BRANCH\`.
- Worktree path:
- Cleanup result:

## Rollback Plan
- Trigger conditions:
- Rollback steps:
- Verification steps:

## Monitoring
- Metrics/logs to watch:
- Risk note (if no monitoring):

## Finalization
- Selected enum (exactly one):
${SHIP_FINALIZATION_ENUM_LINES}
- Selected label (A/B/C/D/E):
- Execution result:
- PR URL / merge commit / kept branch / discard confirmation:
- NO_VCS handoff target + artifact path (if FINALIZE_NO_VCS):

## Completion Status
- Victory Detector: pass | fail (review verdict valid, preflight fresh, rollback ready, one finalization enum selected, execution result present)
- SHIPPED | SHIPPED_WITH_EXCEPTIONS | BLOCKED
- Exceptions (if any):

## Retro Gate Handoff
- Complete the retro gate before archive.
- Retro artifact path: \`.cclaw/artifacts/09-retro.md\`
- Archive remains blocked until retro gate is complete.

## Learnings
- None this stage.
`,
  "09-retro.md": `${artifactFrontmatter("retro")}

# Retro Artifact

## Run Summary
- Flow track:
- Scope delivered:
- Main outcome:

## Friction Log
| Category | What slowed us down | Evidence | Prevention rule |
|---|---|---|---|
|  |  |  |  |

## Acceleration Log
| Category | What helped | Evidence | Reuse trigger |
|---|---|---|---|
|  |  |  |  |

## Compound Decisions
| Insight | Trigger pattern | Action rule for next run |
|---|---|---|
|  |  |  |

## Knowledge Writes
- Compound entries appended to \`.cclaw/knowledge.jsonl\`: <N>
- Entry ids / timestamps:

## Retro Completion
- RETRO_COMPLETE: yes
- Completed at (UTC):
- Notes:

## Learnings
- None this stage.
`
};

export const RULEBOOK_MARKDOWN = `# Cclaw Rulebook

## MUST_ALWAYS
- Follow flow order: brainstorm -> scope -> design -> spec -> plan -> tdd -> review -> ship
- Require explicit user confirmation after plan before TDD
- Keep evidence artifacts in \`.cclaw/artifacts/\`
- Enforce RED before GREEN in TDD
- Run two-layer review (spec_compliance and code_quality) before ship
- Validate all inputs before processing — never trust external data without sanitization
- Prefer immutable data patterns and pure functions where the language supports them
- Follow existing repo conventions, patterns, and directory structure — match the codebase
- Verify claims with fresh evidence: "tests pass" requires running tests in this message
- Use conventional commits: \`type(scope): description\` (feat, fix, refactor, test, docs, chore)

## MUST_NEVER
- Skip RED phase and jump directly to GREEN in TDD
- Ship with critical review findings
- Start implementation during /brainstorm
- Modify generated cclaw files manually when CLI can regenerate them
- Commit \`.cclaw/\` or generated shim files
- Expose secrets, tokens, API keys, or absolute system paths in agent output
- Duplicate existing functionality without explicit justification — search before building
- Bypass security checks, linting hooks, or type checking to "move faster"
- Claim success ("Done," "All good," "Tests pass") without running verification in this message
- Make changes outside the blast radius of the current task without user consent

## DELEGATION
When a task requires specialist knowledge (security audit, performance profiling, database review),
delegate to a specialized agent or skill if the harness supports it. The primary agent should:
1. Identify the specialist domain
2. Provide focused context (relevant files, the specific concern)
3. Evaluate the specialist output before acting on it — do not blindly apply recommendations
`;

export const CURSOR_WORKFLOW_RULE_MDC = `---
description: cclaw workflow guardrails for Cursor agent sessions
globs:
  - "**/*"
alwaysApply: true
---

<!-- cclaw-managed-cursor-workflow-rule -->

# Cclaw Workflow Guardrails

## Activation Rule

Before responding to coding work:
1. Read \`.cclaw/state/flow-state.json\`.
2. Start with \`/cc\` or continue with \`/cc\`.
3. If no software-stage flow applies, respond normally.

## Stage Order

\`brainstorm -> scope -> design -> spec -> plan -> tdd -> review -> ship\`

Track-specific skips are allowed only when \`flow-state.track\` + \`skippedStages\` explicitly say so.

## Task Classification

| Class | Route |
|---|---|
| non-trivial software work | \`/cc <idea>\` |
| trivial software fix | \`/cc <idea>\` (quick track) |
| bugfix with repro | \`/cc <idea>\` and enforce RED-first in tdd |
| pure question / non-software | direct answer (no stage flow) |

## Command Surface

- \`/cc\` = entry and resume.
- \`/cc\` = only progression path.
- Knowledge capture and recall use the \`learnings\` skill when requested.

## Verification Discipline

- No completion claim without fresh command evidence in this turn.
- Do not mark gates passed from memory.
- Keep evidence in \`.cclaw/artifacts/\`; archive through closeout via \`/cc\` or cancel early via \`node .cclaw/hooks/cancel-run.mjs\`.

## Delegation And Approvals

- Machine-only checks in design/plan/tdd/review/ship should auto-dispatch when tooling supports it.
- Ask for user input only at explicit approval gates (scope mode, plan approval, challenge resolution, ship finalization).
- If harness capabilities are partial, record waiver reasons in delegation logs.

## Routing Source Of Truth

- Primary router: \`.cclaw/skills/using-cclaw/SKILL.md\`.
- Stage behavior: current stage skill plus \`.cclaw/state/flow-state.json\`.
- Preamble budget: keep role/status announcements brief and avoid repeating
  them unless the stage or role changes.
`;

export function buildRulesJson(): Record<string, unknown> {
  return {
    version: 1,
    stage_order: FLOW_STAGES,
    stage_gates: Object.fromEntries(
      orderedStageSchemas().map((schema) => [
        schema.stage,
        schema.requiredGates.map((gate) => gate.id)
      ])
    ),
    MUST_ALWAYS: [
      "flow_order",
      "plan_confirm_gate",
      "artifact_evidence",
      "tdd_red_before_green",
      "two_layer_review_before_ship",
      "validate_inputs",
      "prefer_immutable",
      "follow_repo_conventions",
      "verify_claims_with_evidence",
      "conventional_commits"
    ],
    MUST_NEVER: [
      "skip_tdd_stage",
      "ship_with_critical_findings",
      "implement_in_brainstorm",
      "manual_edit_generated",
      "commit_cclaw_runtime",
      "expose_secrets_or_paths",
      "duplicate_without_justification",
      "bypass_security_hooks",
      "claim_success_without_verification",
      "changes_outside_blast_radius"
    ]
  };
}
