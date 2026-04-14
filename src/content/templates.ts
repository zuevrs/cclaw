import { COMMAND_FILE_ORDER } from "../constants.js";
import { orderedStageSchemas } from "./stage-schema.js";

export const ARTIFACT_TEMPLATES: Record<string, string> = {
  "01-brainstorm.md": `# Brainstorm Artifact

## Problem Statement
- **User problem:**
- **Who benefits:**
- **Why now:**
- **Success signal:**

## Known Context
- **Explored files/patterns:**
- **Existing behavior:**
- **Relevant dependencies:**

## Clarification Log
| Category | Question asked | User answer | Evidence note |
|---|---|---|---|
| PURPOSE |  |  |  |
| SCOPE |  |  |  |
| BOUNDARIES |  |  |  |
| ENVIRONMENT |  |  |  |
| CONSTRAINTS |  |  |  |

## Purpose & Beneficiaries
- **Project purpose:**
- **Primary users:**
- **Value outcome:**

## Scope Boundaries
### In Scope
- 

### Out of Scope
- 

## Failure Boundaries
- **Edge cases to handle:**
- **Expected failures and behavior:**
- **Error visibility expectations:**

## Runtime Environment
- **Runtime/platform:**
- **Install/distribution model:**
- **Execution context (local/CI/deploy):**

## Constraints
- **Performance constraints:**
- **Compatibility constraints:**
- **Dependency constraints:**

## Alternatives Table
| Option | Summary | Trade-offs | Recommendation |
|---|---|---|---|
| A |  |  |  |
| B |  |  |  |
| C |  |  |  |

## Approved Direction
- **Selected option:**
- **Why selected:**
- **What was approved:** (state the specific decision)
- **Approval marker:**

## Assumptions & Risks
- 

## Open Questions
- None
`,
  "02-scope.md": `# Scope Artifact

## Prime Directives
- Zero silent failures:
- Every error has a name:
- Four paths per data flow:

## Premise Challenge
- Is this the right problem?
- Why this path?
- What if we do nothing?

## Scope Mode
- [ ] expand
- [ ] selective
- [ ] hold
- [ ] reduce

## In Scope / Out of Scope

### In Scope
- 

### Out of Scope
- 

## Deferred Items
| Item | Rationale |
|---|---|
|  |  |

## Error & Rescue Registry
| Capability | Failure mode | Detection | Fallback |
|---|---|---|---|
|  |  |  |  |

## Scope Summary
- Selected mode:
- Accepted scope:
- Deferred:
- Explicitly excluded:
`,
  "03-design.md": `# Design Artifact

## Architecture Boundaries
| Component | Responsibility | Owner |
|---|---|---|
|  |  |  |

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

## NOT in scope
- 

## Parallelization Strategy
- Parallel lanes:
- Conflict risks:

## Unresolved Decisions
| Decision | Missing info | Owner | Default |
|---|---|---|---|
|  |  |  |  |
`,
  "04-spec.md": `# Specification Artifact

## Acceptance Criteria
| ID | Criterion (observable/measurable/falsifiable) |
|---|---|
| AC-1 |  |

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

## Approval
- Approved by:
- Date:
`,
  "05-plan.md": `# Plan Artifact

## Dependency Graph
- 

## Dependency Waves

### Wave 1 (foundation)
- Task IDs:
- Verification gate:

### Wave 2 (dependent)
- Task IDs:
- Depends on:
- Verification gate:

### Wave 3 (integration)
- Task IDs:
- Depends on:
- Verification gate:

Execution rule: complete and verify each wave before starting the next wave.

## Task List
| Task ID | Description | Acceptance criterion | Verification command |
|---|---|---|---|
| T-1 |  |  |  |

## Acceptance Mapping
| Criterion ID | Task IDs |
|---|---|
| AC-1 | T-1 |

## WAIT_FOR_CONFIRM
- Status: pending
- Confirmed by:
`,
  "06-tdd.md": `# TDD Artifact

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
`,
  "07-review.md": `# Review Artifact

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
- Layer 1 complete:
- Layer 2 complete:
- Review army schema valid:
- Open critical blockers:
- Ship recommendation:

## Severity Summary
- Critical:
- Important:
- Suggestion:

## Final Verdict
- APPROVED | APPROVED_WITH_CONCERNS | BLOCKED
`,
  "07-review-army.json": `{
  "version": 1,
  "generatedAt": "",
  "scope": {
    "base": "",
    "head": "",
    "files": []
  },
  "findings": [
    {
      "id": "",
      "title": "",
      "severity": "Critical",
      "confidence": 7,
      "category": "correctness",
      "location": {
        "file": "",
        "line": 0
      },
      "fingerprint": "",
      "reportedBy": [],
      "status": "open",
      "recommendation": ""
    }
  ],
  "reconciliation": {
    "duplicatesCollapsed": 0,
    "conflicts": [],
    "multiSpecialistConfirmed": [],
    "shipBlockers": []
  }
}
`,
  "08-ship.md": `# Ship Artifact

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

- Follow stage order: brainstorm -> scope -> design -> spec -> plan -> tdd -> review -> ship.
- Read \`.cclaw/state/flow-state.json\` before acting; continue from current stage when active.
- Use \`/cc-next\` only after required gates pass; never bypass explicit pause/approval rules.
- Keep evidence in \`.cclaw/artifacts/\` and canonical run copies in \`.cclaw/runs/<activeRunId>/artifacts/\`.
- For machine-only checks in design/plan/tdd/review/ship, dispatch required specialists automatically when tooling supports it.
- Ask for user input only at explicit approval gates (scope mode, plan approval, user challenge resolution, ship finalization).
- Treat \`.cclaw/skills/using-cclaw/SKILL.md\` as routing source of truth; load contextual utility skills only when their triggers apply.
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
