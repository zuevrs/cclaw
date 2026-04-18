import { COMMAND_FILE_ORDER } from "../constants.js";
import { orderedStageSchemas } from "./stage-schema.js";

export const ARTIFACT_TEMPLATES: Record<string, string> = {
  "01-brainstorm.md": `---
stage: brainstorm
schema_version: 1
version: 0.18.0
feature: <feature-id>
locked_decisions: []
inputs_hash: sha256:pending
---

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

## Approaches
| Approach | Architecture | Trade-offs | Recommendation |
|---|---|---|---|
| A |  |  |  |
| B |  |  |  |

## Selected Direction
- **Approach:**
- **Rationale:**
- **Approval:** pending

## Design
- **Architecture:**
- **Key components:**
- **Data flow:**

## Assumptions and Open Questions
- **Assumptions:**
- **Open questions (or "None"):**
`,
  "02-scope.md": `---
stage: scope
schema_version: 1
version: 0.18.0
feature: <feature-id>
locked_decisions: []
inputs_hash: sha256:pending
---

# Scope Artifact

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
- [ ] expand
- [ ] selective
- [ ] hold
- [ ] reduce

## Mode-Specific Analysis
- **Selected mode:**
- **Analysis:**
  - (EXPAND: 10x opportunities, delight features)
  - (SELECTIVE: hold-scope baseline, cherry-picked expansions)
  - (HOLD: minimum-change-set hardening)
  - (REDUCE: ruthless cuts, follow-up split)

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

## Error & Rescue Registry
| Capability | Failure mode | Detection | Fallback |
|---|---|---|---|
|  |  |  |  |

## Completion Dashboard
- Checklist findings:
- Resolved decisions count:
- Unresolved decisions (or \`None\`):

## Scope Summary
- Selected mode:
- Accepted scope:
- Deferred:
- Explicitly excluded:
`,
  "03-design.md": `---
stage: design
schema_version: 1
version: 0.18.0
feature: <feature-id>
locked_decisions: []
inputs_hash: sha256:pending
---

# Design Artifact

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

## Architecture Boundaries
| Component | Responsibility | Owner |
|---|---|---|
|  |  |  |

## Architecture Diagram

\`\`\`
(ASCII, Mermaid, or tool-generated diagram showing component boundaries and data flow direction)
\`\`\`

## What Already Exists
| Sub-problem | Existing code/library | Layer | Reuse decision |
|---|---|---|---|
|  |  |  |  |

## Data Flow
- Happy path:
- Nil/empty input path:
- Upstream error path:
- Timeout/downstream path:

## Failure Mode Table
| Failure mode | Trigger | Detection | Mitigation | User impact |
|---|---|---|---|---|
|  |  |  |  |  |

## Test Strategy
- Unit:
- Integration:
- E2E:

## Performance Budget
| Critical path | Metric | Target | Measurement method |
|---|---|---|---|
|  |  |  |  |

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

## Completion Dashboard
| Review Section | Status | Issues |
|---|---|---|
| Architecture Review |  |  |
| Code Quality Review |  |  |
| Test Review |  |  |
| Performance Review |  |  |
| Distribution & Delivery Review |  |  |

**Decisions made:** 0 | **Unresolved:** 0
`,
  "04-spec.md": `---
stage: spec
schema_version: 1
version: 0.18.0
feature: <feature-id>
locked_decisions: []
inputs_hash: sha256:pending
---

# Specification Artifact

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
`,
  "05-plan.md": `---
stage: plan
schema_version: 1
version: 0.18.0
feature: <feature-id>
locked_decisions: []
inputs_hash: sha256:pending
---

# Plan Artifact

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
`,
  "06-tdd.md": `---
stage: tdd
schema_version: 1
version: 0.18.0
feature: <feature-id>
locked_decisions: []
inputs_hash: sha256:pending
---

# TDD Artifact

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
`,
  "07-review.md": `---
stage: review
schema_version: 1
version: 0.18.0
feature: <feature-id>
locked_decisions: []
inputs_hash: sha256:pending
---

# Review Artifact

## Layer 1 Verdict
| Criterion | Verdict | Evidence |
|---|---|---|
| AC-1 | PASS/FAIL |  |

## Layer 2 Findings
| ID | Severity | Category | Description | Status |
|---|---|---|---|---|
| R-1 | Critical/Important/Suggestion | correctness/security/performance/architecture |  | open/resolved |

## Review Army Contract
- See \`07-review-army.json\`
- Reconciliation summary:

## Review Readiness Dashboard

| Pass | Status | Completed at (UTC) | Reviewer / source | Commit at review | Drift vs HEAD |
|---|---|---|---|---|---|
| Layer 1 — spec compliance | pass / fail / pending | <ISO 8601> | reviewer | <short sha> | <files changed since> |
| Layer 2 — correctness | pass / fail / pending | <ISO 8601> | reviewer | <short sha> | <files changed since> |
| Layer 2 — security | pass / fail / pending | <ISO 8601> | security-reviewer | <short sha> | <files changed since> |
| Layer 2 — performance | pass / fail / pending | <ISO 8601> | reviewer | <short sha> | <files changed since> |
| Layer 2 — architecture | pass / fail / pending | <ISO 8601> | reviewer | <short sha> | <files changed since> |
| Adversarial review | pass / fail / n/a | <ISO 8601 or —> | adversarial-review skill | <short sha or —> | <drift or —> |
| Review army schema valid | pass / fail | <ISO 8601> | jsonschema | <short sha> | n/a |

### Delegation log snapshot (current run, current stage)
- Path: \`.cclaw/state/delegation-log.json\`
- Required: <list of mandatory specialists>
- Completed: <list with timestamps>
- Waived (with reason): <list or "none">
- Pending: <list or "none">

### Staleness signal
- Worktree commit at last review pass: \`<short sha>\`
- Worktree commit now: \`<short sha>\`
- Files changed since last review pass: \`<count>\` (run \`git diff --stat <sha>..HEAD\` to inspect)
- If drift > 0 lines, mark Layer 1 / Layer 2 results as **STALE — re-run before ship**.

### Headline
- Open critical blockers: <count>
- Adversarial review pass: pass / fail / n/a
- Ship recommendation: APPROVED | APPROVED_WITH_CONCERNS | BLOCKED

## Completeness Score
- AC coverage: <N>/<M> (<percent>%)
- Task coverage (tasks backed by ≥1 test slice): <N>/<M>
- Slice coverage (slices linked to ≥1 AC): <N>/<M>
- Adversarial review pass: true | false
- Overall score: <0-100>

## Severity Summary
- Critical:
- Important:
- Suggestion:

## Final Verdict
- APPROVED | APPROVED_WITH_CONCERNS | BLOCKED
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
    "shipBlockers": []
  }
}
`,
  "08-ship.md": `---
stage: ship
schema_version: 1
version: 0.18.0
feature: <feature-id>
locked_decisions: []
inputs_hash: sha256:pending
---

# Ship Artifact

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
  - FINALIZE_MERGE_LOCAL
  - FINALIZE_OPEN_PR
  - FINALIZE_KEEP_BRANCH
  - FINALIZE_DISCARD_BRANCH
- Selected label (A/B/C/D):
- Execution result:
- PR URL / merge commit / kept branch / discard confirmation:

## Completion Status
- SHIPPED | SHIPPED_WITH_EXCEPTIONS | BLOCKED
- Exceptions (if any):

## Retro Gate Handoff
- Run \`/cc-ops retro\` before archive.
- Retro artifact path: \`.cclaw/artifacts/09-retro.md\`
- Archive remains blocked until retro gate is complete.
`,
  "09-retro.md": `---
stage: retro
schema_version: 1
version: 0.18.0
feature: <feature-id>
locked_decisions: []
inputs_hash: sha256:pending
---

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
- \`/cc-learn\` = knowledge capture and recall.

## Verification Discipline

- No completion claim without fresh command evidence in this turn.
- Do not mark gates passed from memory.
- Keep evidence in \`.cclaw/artifacts/\`; archive via \`/cc-ops archive\` (agent flow) or archive runtime.

## Delegation And Approvals

- Machine-only checks in design/plan/tdd/review/ship should auto-dispatch when tooling supports it.
- Ask for user input only at explicit approval gates (scope mode, plan approval, challenge resolution, ship finalization).
- If harness capabilities are partial, record waiver reasons in delegation logs.

## Routing Source Of Truth

- Primary router: \`.cclaw/skills/using-cclaw/SKILL.md\`.
- Protocols: \`.cclaw/references/protocols/*.md\`.
- Preamble budget: \`.cclaw/references/protocols/ethos.md\`.
`;

export function buildRulesJson(): Record<string, unknown> {
  return {
    version: 1,
    stage_order: COMMAND_FILE_ORDER,
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
      "skip_test_stage",
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
