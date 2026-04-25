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

## Context
- **Project state:**
- **Relevant existing code/patterns:**

## Problem
- **What we're solving:**
- **Success criteria:**
- **Constraints:**

## Clarifying Questions
| # | Question | Answer | Decision impact |
|---|---|---|---|
| 1 |  |  |  |

## Approach Tier
- Tier: Lightweight | Standard | Deep
- Why this tier:

## Short-Circuit Decision
- Status: bypassed
- Why:
- Scope handoff:

## Approaches
| Approach | Role | Upside | Architecture | Trade-offs | Recommendation |
|---|---|---|---|---|---|
| A | baseline | modest |  |  |  |
| B | challenger | high |  |  |  |

## Approach Reaction
- Closest option:
- Concerns:
- What changed after reaction:

## Selected Direction
- **Approach:**
- **Rationale:** Trace this to the prior Approach Reaction.
- **Approval:** pending
- **Next-stage handoff:** On standard track, hand this to \`scope\`; on medium track, hand this directly to \`spec\` with explicit requirements/constraints.

${SEED_SHELF_SECTION}

## Design
- **Architecture:**
- **Key components:**
- **Data flow:**

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
- Is this the right problem?
- Why this path?
- What if we do nothing?

## Dream State Mapping
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

## Temporal Interrogation
| Time slice | Likely decision pressure | Lock now or defer? | Reason |
|---|---|---|---|
| HOUR 1 (foundations) |  |  |  |
| HOUR 2-3 (core logic) |  |  |  |
| HOUR 4-5 (integration) |  |  |  |
| HOUR 6+ (polish/tests) |  |  |  |

## Scope Mode
- [ ] SCOPE EXPANSION — dream bigger; user explicitly opts into the larger product slice.
- [ ] SELECTIVE EXPANSION — hold baseline scope and cherry-pick one high-leverage addition.
- [ ] HOLD SCOPE — preserve the approved brainstorm direction with maximum rigor.
- [ ] SCOPE REDUCTION — strip to the smallest useful wedge when risk/blast radius is too high.

## Mode-Specific Analysis
- **Selected mode:**
- **Analysis:**
  - (SCOPE EXPANSION: 10-star opportunities, delight features)
  - (SELECTIVE EXPANSION: hold-scope baseline, cherry-picked expansions)
  - (HOLD SCOPE: approved slice with maximum rigor)
  - (SCOPE REDUCTION: ruthless cuts, follow-up split)

## Requirements (stable IDs)
| ID | Requirement (observable outcome) | Priority | Source (origin doc / prompt line) |
|---|---|---|---|
| R1 |  | P0 |  |

> Assign \`R1\`, \`R2\`, \`R3\`… once and never renumber. Downstream artifacts
> (design, spec, plan, review) reference these IDs verbatim. If a requirement
> is later dropped, keep the row and mark Priority \`DROPPED\`; if a new one is
> added mid-flow, append with the next free R-number — do NOT reuse numbers.

## Locked Decisions (D-XX)
| Decision ID | Decision | Why locked now | Downstream impact |
|---|---|---|---|
| D-01 |  |  |  |

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

## Spec Review Loop
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
- Selected mode:
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
| UX/product patterns |  |  |

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

## Upstream Handoff
- Source artifacts: \`02-scope-<slug>.md\`, \`02a-research.md\` when present
- Decisions carried forward:
- Constraints carried forward:
- Open questions:
- Drift from upstream (or \`None\`):

## Codebase Investigation
| File | Current responsibility | Patterns discovered |
|---|---|---|
|  |  |  |

## Search Before Building
| Layer | Label | What to reuse first |
|---|---|---|
| Layer 1 |  |  |
| Layer 2 |  |  |
| Layer 3 |  |  |

## Research Fleet Synthesis
| Lens | Key findings | Design impact | Evidence |
|---|---|---|---|
| stack-researcher |  |  |  |
| features-researcher |  |  |  |
| architecture-researcher |  |  |  |
| pitfalls-researcher |  |  |  |

## Architecture Boundaries
| Component | Responsibility | Owner |
|---|---|---|
|  |  |  |

## Architecture Diagram

<!-- diagram: architecture -->

${MARKDOWN_CODE_FENCE}
(ASCII, Mermaid, or tool-generated diagram showing component boundaries and data flow direction)
${MARKDOWN_CODE_FENCE}

## Data-Flow Shadow Paths
<!-- diagram: data-flow-shadow-paths -->
| Path | Trigger | Fallback/Degrade behavior |
|---|---|---|
|  |  |  |

## Error Flow Diagram

<!-- diagram: error-flow -->

${MARKDOWN_CODE_FENCE}
(failure detection -> rescue action -> user-visible outcome)
${MARKDOWN_CODE_FENCE}

## State Machine Diagram

<!-- diagram: state-machine -->

${MARKDOWN_CODE_FENCE}
(state transitions for the critical flow lifecycle)
${MARKDOWN_CODE_FENCE}

## Rollback Flowchart

<!-- diagram: rollback-flowchart -->

${MARKDOWN_CODE_FENCE}
(trigger -> rollback actions -> verification)
${MARKDOWN_CODE_FENCE}

## Deployment Sequence Diagram

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
- Happy path:
- Nil/empty input path:
- Upstream error path:
- Timeout/downstream path:

### Interaction Edge Case Matrix
| Edge case | Handled? | Design response | Deferred item (if not handled) |
|---|---|---|---|
| double-click | yes/no |  | None / D-XX |
| nav-away-mid-request | yes/no |  | None / D-XX |
| 10K-result dataset | yes/no |  | None / D-XX |
| background-job abandonment | yes/no |  | None / D-XX |
| zombie connection | yes/no |  | None / D-XX |

## Security & Threat Model
| Boundary | Threat | Mitigation | Owner |
|---|---|---|---|
|  |  |  |  |

## Failure Mode Table
| Method | Exception | Rescue | UserSees |
|---|---|---|---|
|  |  |  |  |

## Test Strategy
- Unit:
- Integration:
- E2E:

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

## Outside Voice Findings
| ID | Dimension | Finding | Disposition | Rationale |
|---|---|---|---|---|
| F-1 | architecture_fit |  | accept/reject/defer |  |

## Spec Review Loop
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
- Parallel lanes:
- Conflict risks:

## Patterns to Mirror
| Pattern | Source file | Rationale |
|---|---|---|
|  |  |  |

## Interface Contracts
| Module | Produces | Consumes |
|---|---|---|
|  |  |  |

## Unresolved Decisions
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

## Learnings
- None this stage.
`,
  "04-spec.md": `${artifactFrontmatter("spec")}

# Specification Artifact

## Upstream Handoff
- Source artifacts: \`02-scope-<slug>.md\`, \`03-design-<slug>.md\`
- Decisions carried forward:
- Constraints carried forward:
- Open questions:
- Drift from upstream (or \`None\`):

## Acceptance Criteria
| ID | Requirement Ref (R#) | Criterion (observable/measurable/falsifiable) | Design Decision Ref |
|---|---|---|---|
| AC-1 | R1 |  |  |

> Every AC must reference at least one \`R#\` from \`02-scope.md\`. ACs are
> stable (never renumber): dropped ACs stay with Priority \`DROPPED\`; new
> ones append with the next free \`AC-#\`.

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

## Testability Map
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

## Approval
- Approved by:
- Date:

## Learnings
- None this stage.
`,
  "05-plan.md": `${artifactFrontmatter("plan")}

# Plan Artifact

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
| Decision ID | Source section | Plan tasks implementing decision | Status |
|---|---|---|---|
| D-01 | 02-scope.md > Locked Decisions | T-1 | covered |

## Risk Assessment
| Task/Batch | Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
|  |  |  |  |  |

## Boundary Map
| Task/Batch | Produces (exports) | Consumes (imports from) |
|---|---|---|
|  |  |  |

## No-Placeholder Scan
- Scanned tokens: \`TODO\`, \`TBD\`, \`FIXME\`, \`<fill-in>\`, \`<your-*-here>\`, \`xxx\`, bare ellipsis in task rows.
- Hits: 0 (required for WAIT_FOR_CONFIRM to resolve).

## No Scope Reduction Language Scan
- Scanned phrases: \`v1\`, \`for now\`, \`later\`, \`temporary\`, \`placeholder\`, \`mock for now\`, \`hardcoded for now\`, \`will improve later\`.
- Hits: 0 (required when Locked Decisions section is non-empty).

## WAIT_FOR_CONFIRM
- Status: pending
- Confirmed by:

## Learnings
- None this stage.
`,
  "06-tdd.md": `${artifactFrontmatter("tdd")}

# TDD Artifact

## Upstream Handoff
- Source artifacts: \`04-spec.md\`, \`05-plan.md\`
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
- RED/GREEN/REFACTOR checkpoint plan:
- Incremental commits: yes/no/deferred because

## RED Evidence
| Slice | Test name | Command | Failure output summary |
|---|---|---|---|
| S-1 |  |  |  |

## Acceptance Mapping
| Slice | Plan task ID | Spec criterion ID |
|---|---|---|
| S-1 | T-1 | AC-1 |

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
- Plan task IDs:
- Spec criterion IDs:


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

## Learnings
- None this stage.
`,
  "07-review.md": `${artifactFrontmatter("review")}

# Review Artifact

## Upstream Handoff
- Source artifacts: \`04-spec.md\`, \`05-plan.md\`, \`06-tdd.md\`
- Decisions carried forward:
- Constraints carried forward:
- Open questions:
- Drift from upstream (or \`None\`):

## Layer 1 Verdict
| Criterion | Verdict | Evidence |
|---|---|---|
| AC-1 | PASS/FAIL |  |

## Layer 2 Findings
| ID | Severity | Category | Description | Status |
|---|---|---|---|---|
| R-1 | Critical/Important/Suggestion | correctness/security/performance/architecture |  | open/resolved |
- NO_CHANGE_ATTESTATION: <required when Category=security has no entries; explain why no security-relevant changes were detected>

## Incoming Feedback Queue
| ID | Source | Severity | File:line | Request | Status | Evidence |
|---|---|---|---|---|---|---|
| CR-1 | reviewer / bot / ci | Critical/Important/Suggestion | path:line or n/a |  | open/in-progress/resolved/accepted-risk/rejected-with-evidence |  |

## Review Findings Contract
- See \`07-review-army.json\`
- Reconciliation summary:

## Review Readiness Snapshot

- Completed checks: Layer 1, Layer 2 tags, security sweep, schema validation
- Delegation log: \`.cclaw/state/delegation-log.json\` required/completed/waived/pending
- Staleness signal: commit at last review pass vs current commit
- Open critical blockers:
- Ship recommendation: APPROVED | APPROVED_WITH_CONCERNS | BLOCKED


## Completeness Snapshot
- AC coverage: <N>/<M> (<percent>%)
- Task coverage (tasks backed by ≥1 test slice): <N>/<M>
- Slice coverage (slices linked to ≥1 AC): <N>/<M>
- Adversarial review: not triggered | pass | fail
- Overall: complete | concerns | blocked

## Trace Matrix Check
- Command: \`cclaw internal trace-matrix\`
- Orphaned criteria: 0
- Orphaned tasks: 0
- Orphaned tests: 0
- Evidence ref:

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

## Preflight Results
- Review verdict:
- Build:
- Tests:
- Lint:
- Type-check:
- Working tree clean:

## Release Notes
-

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
2. Start with \`/cc\` or continue with \`/cc-next\`.
3. If no software-stage flow applies, respond normally.

## Stage Order

\`brainstorm -> scope -> design -> spec -> plan -> tdd -> review -> ship\`

Track-specific skips are allowed only when \`flow-state.track\` + \`skippedStages\` explicitly say so.

## Task Classification

| Class | Route |
|---|---|
| non-trivial software work | \`/cc <idea>\` |
| trivial software fix | \`/cc <idea>\` (quick or medium track) |
| bugfix with repro | \`/cc <idea>\` and enforce RED-first in tdd |
| pure question / non-software | direct answer (no stage flow) |

## Command Surface

- \`/cc\` = entry and resume.
- \`/cc-next\` = only progression path.
- Knowledge capture and recall use the \`learnings\` skill when requested.

## Verification Discipline

- No completion claim without fresh command evidence in this turn.
- Do not mark gates passed from memory.
- Keep evidence in \`.cclaw/artifacts/\`; archive via \`npx cclaw-cli archive\`.

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
