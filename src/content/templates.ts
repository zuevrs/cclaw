import { COMMAND_FILE_ORDER } from "../constants.js";
import { orderedStageSchemas } from "./stage-schema.js";

export const ARTIFACT_TEMPLATES: Record<string, string> = {
  "01-brainstorm.md": `# Brainstorm Artifact

## Problem Statement
- 

## Clarifying Questions
- 

## Approaches (2-3)
- Approach A:
- Approach B:
- Approach C:

## Chosen Direction
- 

## Approval
- Approved by:
- Date:
`,
  "02-scope.md": `# Scope Artifact

## Scope Mode
- [ ] expand
- [ ] selective
- [ ] hold
- [ ] reduce

## In Scope
- 

## Out of Scope
- 

## Strategic Risks
- 

## Scope Contract
- Decision owner:
- Decision date:
`,
  "03-design.md": `# Design Artifact

## Architecture
- 

## Data Flow
- 

## State Transitions
- 

## Failure Modes and Mitigation
- 

## Test Strategy
- Unit:
- Integration:
- E2E:

## Performance Budget
- 
`,
  "04-spec.md": `# Specification Artifact

## Acceptance Criteria
- 

## Constraints
- 

## Assumptions
- 

## Edge Cases
- 

## Testability Notes
- 
`,
  "05-plan.md": `# Plan Artifact

## Task Graph
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

## Ordered Tasks
1. 
2. 

## Acceptance Mapping
- Task 1 -> Criteria:

## Checkpoints
- 

## User Confirmation
- Status: pending
- Confirmed by:
`,
  "06-tdd.md": `# TDD Artifact

## RED Evidence
- Test:
- Failure output:

## GREEN Result
- Passing suite summary:

## REFACTOR Notes
- 
`,
  "07-review.md": `# Review Artifact

## Spec Compliance
- Status:
- Findings:

## Code Quality
- Status:
- Security:
- Performance:
- Maintainability:

## Severity Log
- Critical:
- Important:
- Minor:

## Ready to Ship
- yes/no
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

## Pre-Ship Checks
- Review pass:
- Tests pass:

## Release Notes
- 

## Rollback Plan
- Trigger conditions:
- Rollback steps:

## Branch Finalization
- [ ] merge
- [ ] pull request
- [ ] keep branch
- [ ] discard branch
`
};

export const RULEBOOK_MARKDOWN = `# Cclaw Rulebook

## MUST_ALWAYS
- Follow flow order: brainstorm -> scope -> design -> spec -> plan -> test -> build -> review -> ship
- Require explicit user confirmation after /plan before /test or /build
- Keep evidence artifacts in \`.cclaw/artifacts/\`
- Enforce RED before GREEN in TDD
- Run two-layer review (spec_compliance and code_quality) before ship
- Validate all inputs before processing — never trust external data without sanitization
- Prefer immutable data patterns and pure functions where the language supports them
- Follow existing repo conventions, patterns, and directory structure — match the codebase
- Verify claims with fresh evidence: "tests pass" requires running tests in this message
- Use conventional commits: \`type(scope): description\` (feat, fix, refactor, test, docs, chore)

## MUST_NEVER
- Skip /test and jump directly to /build
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
