import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { lintArtifact, validateReviewArmy } from "../../src/artifact-linter.js";

async function writeRuntimeArtifact(root: string, fileName: string, content: string): Promise<void> {
  await fs.mkdir(path.join(root, ".cclaw/state"), { recursive: true });
  await fs.mkdir(path.join(root, ".cclaw/artifacts"), { recursive: true });
  await fs.writeFile(path.join(root, ".cclaw/state/flow-state.json"), JSON.stringify({
    currentStage: "brainstorm",
    activeRunId: "active",
    completedStages: []
  }, null, 2), "utf8");
  await fs.writeFile(path.join(root, ".cclaw/artifacts", fileName), content, "utf8");
}

describe("artifact linter heuristics", () => {
  it("fails when required brainstorm sections are missing", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "cclaw-artifact-lint-missing-"));
    await writeRuntimeArtifact(root, "01-brainstorm.md", `# Brainstorm Artifact

## Context
- Project state: monorepo with CI
- Relevant existing code/patterns: pre-publish.sh

## Problem
- What we're solving: reduce release regressions
- Success criteria: invalid metadata blocked before publish
- Constraints: no new runtime dependencies

## Clarifying Questions
| # | Question | Answer | Decision impact |
|---|---|---|---|
| 1 | Block or warn? | Block | enforce hard gate |

## Selected Direction
- Approach: B
- Rationale: reusable module
- Approval: approved

## Design
- Architecture: shared validation module
- Key components: validator
- Data flow: metadata -> checks -> result

## Assumptions and Open Questions
- Assumptions: CI remains source of truth
- Open questions (or "None"): None
`);

    const result = await lintArtifact(root, "brainstorm");
    const approaches = result.findings.find((finding) => finding.section === "Approaches");
    expect(result.passed).toBe(false);
    expect(approaches?.found).toBe(false);
  });

  it("passes brainstorm artifact when required sections are present", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "cclaw-artifact-lint-pass-"));
    await writeRuntimeArtifact(root, "01-brainstorm.md", `# Brainstorm Artifact

## Context
- Project state: monorepo with CI pipeline and custom release scripts
- Relevant existing code/patterns: scripts/pre-publish.sh does metadata checks

## Problem
- What we're solving: reduce release regressions
- Success criteria: invalid metadata blocked before publish
- Constraints: no new runtime dependencies

## Clarifying Questions
| # | Question | Answer | Decision impact |
|---|---|---|---|
| 1 | Block invalid metadata or warn? | Block | hard gate required |
| 2 | Add runtime dependencies? | No | stay on existing runtime stack |

## Approaches
| Approach | Architecture | Trade-offs | Recommendation |
|---|---|---|---|
| A | script-only checks | faster but weaker reuse |  |
| B | reusable validation module | slightly more effort, better long-term reuse | recommended |

## Selected Direction
- Approach: B — reusable validation module
- Rationale: best balance of reuse and delivery speed
- Approval: approved by user

## Design
- Architecture: shared TS module with typed validators imported by CI and local CLI
- Key components: validateMetadata, validateChangelog, validateVersion, runAll
- Data flow: package.json + CHANGELOG.md -> validator module -> structured result

## Assumptions and Open Questions
- Assumptions: CI remains primary release path
- Open questions (or "None"): None
`);

    const result = await lintArtifact(root, "brainstorm");
    expect(result.passed).toBe(true);
  });

  it("fails brainstorm clarifying questions section when empty", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "cclaw-artifact-lint-empty-questions-"));
    await writeRuntimeArtifact(root, "01-brainstorm.md", `# Brainstorm Artifact

## Context
- Project state: monorepo
- Relevant existing code/patterns: pre-publish.sh

## Problem
- What we're solving: reduce release regressions
- Success criteria: invalid metadata blocked before publish
- Constraints: none

## Clarifying Questions

## Approaches
| Approach | Architecture | Trade-offs | Recommendation |
|---|---|---|---|
| A | script-only checks | quick but weaker reuse |  |
| B | reusable validation module | more effort, better reuse | recommended |

## Selected Direction
- Approach: B
- Rationale: reusable module
- Approval: approved

## Design
- Architecture: shared module
- Key components: validator
- Data flow: metadata -> checks -> result

## Assumptions and Open Questions
- Assumptions: CI remains source of truth
- Open questions (or "None"): None
`);

    const result = await lintArtifact(root, "brainstorm");
    const questions = result.findings.find((finding) => finding.section === "Clarifying Questions");
    expect(result.passed).toBe(false);
    expect(questions?.found).toBe(false);
    expect(questions?.details).toContain("no meaningful content");
  });

  it("enforces exactly one selected enum token in finalization", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "cclaw-artifact-lint-enum-"));
    await writeRuntimeArtifact(root, "08-ship.md", `# Ship Artifact

## Preflight Results
- Build: pass

## Release Notes
- Updated rollout logic

## Rollback Plan
- Verification steps: run smoke tests

## Monitoring
- Metrics/logs to watch: request latency

## Finalization
- FINALIZE_MERGE_LOCAL
- FINALIZE_OPEN_PR
- FINALIZE_KEEP_BRANCH
- FINALIZE_DISCARD_BRANCH
`);

    const result = await lintArtifact(root, "ship");
    const finalization = result.findings.find((f) => f.section === "Finalization");
    expect(finalization?.found).toBe(false);
    expect(finalization?.details).toContain("exactly one selected token");
  });

  it("requires review readiness dashboard section for review artifacts", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "cclaw-artifact-lint-review-readiness-"));
    await writeRuntimeArtifact(root, "07-review.md", `# Review Artifact

## Layer 1 Verdict
| Criterion | Verdict | Evidence |
|---|---|---|
| AC-1 | PASS | src/a.ts |

## Layer 2 Findings
| ID | Severity | Category | Description | Status |
|---|---|---|---|---|
| R-1 | Suggestion | correctness | tighten naming | open |

## Review Army Contract
- See \`07-review-army.json\`
- Reconciliation summary: none

## Severity Summary
- Critical: 0
- Important: 0
- Suggestion: 1

## Final Verdict
- APPROVED
`);

    const result = await lintArtifact(root, "review");
    const readiness = result.findings.find((finding) => finding.section === "Review Readiness Dashboard");
    expect(result.passed).toBe(false);
    expect(readiness?.found).toBe(false);
  });

  it("fails scope artifact missing Mode-Specific Analysis section", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "cclaw-scope-missing-mode-"));
    await writeRuntimeArtifact(root, "02-scope.md", `# Scope Artifact

## Prime Directives
- Zero silent failures: every delivery failure maps to a visible state.
- Named error surfaces: stream disconnect, auth drift, and publisher timeout.
- Four-path data flow: happy, nil payload, empty payload, upstream error.
- Interaction edge cases: double-open panel, reconnect after sleep.
- Observability expectations: stream error counter, publish-to-visible lag.
- Deferred-item handling: WebSocket channel deferred with rationale.

## Premise Challenge
- Right problem? Yes, users miss follow-ups.
- Direct path? Durable feed is the right path.
- What if nothing? Users continue missing events.

## Implementation Alternatives
| Option | Summary | Effort (S/M/L/XL) | Risk | Pros | Cons | Reuses |
|---|---|---|---|---|---|---|
| A (minimum viable) | Polling-only | S | Low | Fast | Weaker UX | REST endpoint |
| B (recommended) | SSE + REST fallback | M | Med | Better UX | Reconnect handling | Event publisher |

## Scope Mode
- [x] selective

## In Scope / Out of Scope

### In Scope
- In-app notification feed

### Out of Scope
- Email/SMS providers

## Discretion Areas
- Badge rendering strategy

## Deferred Items
| Item | Rationale |
|---|---|
| WebSocket channel | Not justified for current load |

## Error & Rescue Registry
| Capability | Failure mode | Detection | Fallback |
|---|---|---|---|
| Event delivery | SSE drops | Heartbeat timeout | REST polling |

## Completion Dashboard
- Checklist findings: 9/9 complete
- Resolved decisions count: 5
- Unresolved decisions: None

## Scope Summary
- Selected mode: selective
- Accepted scope: durable feed + SSE
- Deferred: WebSocket channel
- Explicitly excluded: outbound channels
`);

    const result = await lintArtifact(root, "scope");
    const modeAnalysis = result.findings.find((f) => f.section === "Mode-Specific Analysis");
    expect(result.passed).toBe(false);
    expect(modeAnalysis?.found).toBe(false);
    expect(modeAnalysis?.required).toBe(true);
  });

  it("fails design artifact when Codebase Investigation is missing", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "cclaw-design-missing-cbi-"));
    await writeRuntimeArtifact(root, "03-design.md", `# Design Artifact

## Search Before Building
| Layer | Label | What to reuse first |
|---|---|---|
| Layer 1 | stdlib | Built-in timers |

## Architecture Boundaries
| Component | Responsibility | Owner |
|---|---|---|
| API | routes | team-a |

## Architecture Diagram
\`\`\`
API -> Service -> DB
\`\`\`

## What Already Exists
| Sub-problem | Existing code | Layer | Reuse decision |
|---|---|---|---|
| Auth | middleware/auth.ts | Layer 1 | Reuse |

## Data Flow
- Happy path: request -> response
- Nil/empty input path: 400 error
- Upstream error path: 502 retry
- Timeout/downstream path: 504

## Failure Mode Table
| Failure mode | Trigger | Detection | Mitigation | User impact |
|---|---|---|---|---|
| DB down | outage | health check | failover | degraded |

## Test Strategy
- Unit: validators
- Integration: API routes
- E2E: full flow

## Performance Budget
| Critical path | Metric | Target | Measurement method |
|---|---|---|---|
| API response | p99 latency | 200ms | load test |

## NOT in scope
- Admin UI

## Completion Dashboard
| Review Section | Status | Issues |
|---|---|---|
| Architecture Review | clear | — |

**Decisions made:** 2 | **Unresolved:** 0
`);

    const result = await lintArtifact(root, "design");
    const cbi = result.findings.find((f) => f.section === "Codebase Investigation");
    expect(result.passed).toBe(false);
    expect(cbi?.found).toBe(false);
    expect(cbi?.required).toBe(true);
  });

  it("fails design artifact when Performance Budget is missing", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "cclaw-design-missing-perf-"));
    await writeRuntimeArtifact(root, "03-design.md", `# Design Artifact

## Codebase Investigation
| File | Current responsibility | Patterns discovered |
|---|---|---|
| src/api.ts | API routes | Express router |

## Search Before Building
| Layer | Label | What to reuse first |
|---|---|---|
| Layer 1 | stdlib | Built-in timers |

## Architecture Boundaries
| Component | Responsibility | Owner |
|---|---|---|
| API | routes | team-a |

## Architecture Diagram
\`\`\`
API -> Service -> DB
\`\`\`

## What Already Exists
| Sub-problem | Existing code | Layer | Reuse decision |
|---|---|---|---|
| Auth | middleware/auth.ts | Layer 1 | Reuse |

## Data Flow
- Happy path: request -> response
- Nil/empty input path: 400 error
- Upstream error path: 502 retry
- Timeout/downstream path: 504

## Failure Mode Table
| Failure mode | Trigger | Detection | Mitigation | User impact |
|---|---|---|---|---|
| DB down | outage | health check | failover | degraded |

## Test Strategy
- Unit: validators
- Integration: API routes
- E2E: full flow

## NOT in scope
- Admin UI

## Completion Dashboard
| Review Section | Status | Issues |
|---|---|---|
| Architecture Review | clear | — |

**Decisions made:** 2 | **Unresolved:** 0
`);

    const result = await lintArtifact(root, "design");
    const perf = result.findings.find((f) => f.section === "Performance Budget");
    expect(result.passed).toBe(false);
    expect(perf?.found).toBe(false);
    expect(perf?.required).toBe(true);
  });

  it("design trivial-change escape hatch downgrades most sections to optional", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "cclaw-design-trivial-"));
    await writeRuntimeArtifact(root, "03-design.md", `# Design Artifact — Trivial Change / Escape Hatch

## Architecture Boundaries
| Component | Responsibility | Owner |
|---|---|---|
| config parser | reads YAML config | core team |

## NOT in scope
- Full config migration tool

## Completion Dashboard
| Review Section | Status | Issues |
|---|---|---|
| Architecture Review | clear | — |

**Decisions made:** 1 | **Unresolved:** 0
`);

    const result = await lintArtifact(root, "design");
    expect(result.passed).toBe(true);
    const required = result.findings.filter((f) => f.required);
    expect(required.every((f) => f.found)).toBe(true);
  });

  it("fails spec artifact when namedAntiPattern language appears in AC", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "cclaw-spec-anti-"));
    await writeRuntimeArtifact(root, "04-spec.md", `# Specification Artifact

## Acceptance Criteria
| ID | Criterion (observable/measurable/falsifiable) | Design Decision Ref |
|---|---|---|
| AC-1 | The system should be fast and intuitive |  |

## Edge Cases
| Criterion ID | Boundary case | Error case |
|---|---|---|
| AC-1 | Empty input | Server error |

## Constraints and Assumptions
- Constraints: None
- Assumptions: None

## Testability Map
| Criterion ID | Verification approach | Command/manual steps |
|---|---|---|
| AC-1 | manual | Check it works |

## Approval
- Approved by: user
- Date: 2026-04-14
`);

    const result = await lintArtifact(root, "spec");
    expect(result.passed).toBe(true);
  });

  it("passes complete plan artifact", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "cclaw-plan-full-pass-"));
    await writeRuntimeArtifact(root, "05-plan.md", `# Plan Artifact

## Dependency Graph
- T-1 -> T-2 -> T-3

## Dependency Waves

### Wave 1
- Task IDs: T-1
- Verification gate: schema tests pass

### Wave 2
- Task IDs: T-2
- Depends on: Wave 1
- Verification gate: integration tests pass

## Task List
| Task ID | Description | Acceptance criterion | Verification command | Effort |
|---|---|---|---|---|
| T-1 | Define schema | AC-1 | npm test | S |
| T-2 | Implement publisher | AC-1, AC-2 | npm test | M |

## Acceptance Mapping
| Criterion ID | Task IDs |
|---|---|
| AC-1 | T-1, T-2 |
| AC-2 | T-2 |

## WAIT_FOR_CONFIRM
- Status: pending
- Confirmed by:
`);

    const result = await lintArtifact(root, "plan");
    expect(result.passed).toBe(true);
  });

  it("fails plan when Dependency Graph is missing", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "cclaw-plan-no-dg-"));
    await writeRuntimeArtifact(root, "05-plan.md", `# Plan Artifact

## Dependency Waves

### Wave 1
- Task IDs: T-1
- Verification gate: tests pass

## Task List
| Task ID | Description | Acceptance criterion | Verification command | Effort |
|---|---|---|---|---|
| T-1 | Do stuff | AC-1 | npm test | S |

## Acceptance Mapping
| Criterion ID | Task IDs |
|---|---|
| AC-1 | T-1 |

## WAIT_FOR_CONFIRM
- Status: pending
- Confirmed by:
`);

    const result = await lintArtifact(root, "plan");
    expect(result.passed).toBe(false);
    const dg = result.findings.find((f) => f.section === "Dependency Graph");
    expect(dg?.found).toBe(false);
    expect(dg?.required).toBe(true);
  });

  it("fails plan when Task List is empty", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "cclaw-plan-empty-tasks-"));
    await writeRuntimeArtifact(root, "05-plan.md", `# Plan Artifact

## Dependency Graph
- T-1

## Dependency Waves

### Wave 1
- Task IDs: T-1
- Verification gate: tests pass

## Task List

## Acceptance Mapping
| Criterion ID | Task IDs |
|---|---|
| AC-1 | T-1 |

## WAIT_FOR_CONFIRM
- Status: pending
- Confirmed by:
`);

    const result = await lintArtifact(root, "plan");
    expect(result.passed).toBe(false);
    const tl = result.findings.find((f) => f.section === "Task List");
    expect(tl?.found).toBe(false);
  });

  it("fails plan WAIT_FOR_CONFIRM when Status is missing", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "cclaw-plan-wfc-missing-"));
    await writeRuntimeArtifact(root, "05-plan.md", `# Plan Artifact

## Dependency Graph
- T-1 -> T-2

## Dependency Waves

### Wave 1
- Task IDs: T-1
- Verification gate: tests pass

## Task List
| Task ID | Description | Acceptance criterion | Verification command | Effort |
|---|---|---|---|---|
| T-1 | Do stuff | AC-1 | npm test | S |

## Acceptance Mapping
| Criterion ID | Task IDs |
|---|---|
| AC-1 | T-1 |

## WAIT_FOR_CONFIRM
- Confirmed by: nobody
`);

    const result = await lintArtifact(root, "plan");
    const wfc = result.findings.find((f) => f.section === "WAIT_FOR_CONFIRM");
    expect(wfc?.found).toBe(false);
    expect(wfc?.details).toContain("Status");
  });

  it("passes plan WAIT_FOR_CONFIRM when Status is pending", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "cclaw-plan-wfc-ok-"));
    await writeRuntimeArtifact(root, "05-plan.md", `# Plan Artifact

## Dependency Graph
- T-1 -> T-2

## Dependency Waves

### Wave 1
- Task IDs: T-1
- Verification gate: tests pass

## Task List
| Task ID | Description | Acceptance criterion | Verification command | Effort |
|---|---|---|---|---|
| T-1 | Do stuff | AC-1 | npm test | S |

## Acceptance Mapping
| Criterion ID | Task IDs |
|---|---|
| AC-1 | T-1 |

## WAIT_FOR_CONFIRM
- Status: pending
- Confirmed by:
`);

    const result = await lintArtifact(root, "plan");
    const wfc = result.findings.find((f) => f.section === "WAIT_FOR_CONFIRM");
    expect(wfc?.found).toBe(true);
  });

  it("fails plan WAIT_FOR_CONFIRM when Status is invalid value", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "cclaw-plan-wfc-invalid-"));
    await writeRuntimeArtifact(root, "05-plan.md", `# Plan Artifact

## Dependency Graph
- T-1 -> T-2

## Dependency Waves

### Wave 1
- Task IDs: T-1
- Verification gate: tests pass

## Task List
| Task ID | Description | Acceptance criterion | Verification command | Effort |
|---|---|---|---|---|
| T-1 | Do stuff | AC-1 | npm test | S |

## Acceptance Mapping
| Criterion ID | Task IDs |
|---|---|
| AC-1 | T-1 |

## WAIT_FOR_CONFIRM
- Status: maybe
- Confirmed by:
`);

    const result = await lintArtifact(root, "plan");
    const wfc = result.findings.find((f) => f.section === "WAIT_FOR_CONFIRM");
    expect(wfc?.found).toBe(false);
    expect(wfc?.details).toContain("pending, approved");
  });

  it("passes complete tdd artifact", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "cclaw-tdd-full-pass-"));
    await writeRuntimeArtifact(root, "06-tdd.md", `# TDD Artifact

## RED Evidence
| Slice | Test name | Command | Failure output summary |
|---|---|---|---|
| S-1 | counts unique keys | pnpm vitest run dedupe.test.ts | Cannot find module |

## Acceptance Mapping
| Slice | Plan task ID | Spec criterion ID |
|---|---|---|
| S-1 | T-1 | AC-1 |

## Failure Analysis
| Slice | Expected missing behavior | Actual failure reason |
|---|---|---|
| S-1 | Module not implemented | Module import fails — correct |

## GREEN Evidence
- Full suite command: pnpm vitest run
- Full suite result: 12 passed, 0 failed

## REFACTOR Notes
- What changed: Extracted helper function
- Why: Reuse across tests
- Behavior preserved: Full suite green after refactor

## Traceability
- Plan task IDs: T-1
- Spec criterion IDs: AC-1
`);

    const result = await lintArtifact(root, "tdd");
    expect(result.passed).toBe(true);
  });

  it("fails tdd when RED Evidence is missing", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "cclaw-tdd-no-red-"));
    await writeRuntimeArtifact(root, "06-tdd.md", `# TDD Artifact

## Acceptance Mapping
| Slice | Plan task ID | Spec criterion ID |
|---|---|---|
| S-1 | T-1 | AC-1 |

## Failure Analysis
| Slice | Expected missing behavior | Actual failure reason |
|---|---|---|
| S-1 | Module missing | Import fails |

## GREEN Evidence
- Full suite command: pnpm vitest run
- Full suite result: 12 passed

## REFACTOR Notes
- What changed: Extracted helper
- Why: Reuse
- Behavior preserved: Yes

## Traceability
- Plan task IDs: T-1
- Spec criterion IDs: AC-1
`);

    const result = await lintArtifact(root, "tdd");
    expect(result.passed).toBe(false);
    const red = result.findings.find((f) => f.section === "RED Evidence");
    expect(red?.found).toBe(false);
    expect(red?.required).toBe(true);
  });

  it("fails tdd when GREEN Evidence is empty", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "cclaw-tdd-empty-green-"));
    await writeRuntimeArtifact(root, "06-tdd.md", `# TDD Artifact

## RED Evidence
| Slice | Test name | Command | Failure output summary |
|---|---|---|---|
| S-1 | test name | vitest | Cannot find module |

## Acceptance Mapping
| Slice | Plan task ID | Spec criterion ID |
|---|---|---|
| S-1 | T-1 | AC-1 |

## Failure Analysis
| Slice | Expected missing behavior | Actual failure reason |
|---|---|---|
| S-1 | Not implemented | Import fails |

## GREEN Evidence

## REFACTOR Notes
- What changed: Nothing
- Why: Minimal
- Behavior preserved: Yes

## Traceability
- Plan task IDs: T-1
- Spec criterion IDs: AC-1
`);

    const result = await lintArtifact(root, "tdd");
    expect(result.passed).toBe(false);
    const green = result.findings.find((f) => f.section === "GREEN Evidence");
    expect(green?.found).toBe(false);
  });

  it("fails tdd when Traceability is missing", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "cclaw-tdd-no-trace-"));
    await writeRuntimeArtifact(root, "06-tdd.md", `# TDD Artifact

## RED Evidence
| Slice | Test name | Command | Failure output summary |
|---|---|---|---|
| S-1 | test name | vitest | Cannot find module |

## Acceptance Mapping
| Slice | Plan task ID | Spec criterion ID |
|---|---|---|
| S-1 | T-1 | AC-1 |

## Failure Analysis
| Slice | Expected missing behavior | Actual failure reason |
|---|---|---|
| S-1 | Not implemented | Import fails |

## GREEN Evidence
- Full suite command: vitest run
- Full suite result: 12 passed

## REFACTOR Notes
- What changed: Extracted helper
- Why: Reuse
- Behavior preserved: Yes
`);

    const result = await lintArtifact(root, "tdd");
    expect(result.passed).toBe(false);
    const trace = result.findings.find((f) => f.section === "Traceability");
    expect(trace?.found).toBe(false);
    expect(trace?.required).toBe(true);
  });

  it("fails Prime Directives when required keywords are missing", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "cclaw-scope-keywords-"));
    await writeRuntimeArtifact(root, "02-scope.md", `# Scope Artifact

## Prime Directives
- Basic error handling is in scope.

## Premise Challenge
- Right problem? Yes.
- Direct path? Yes.
- What if nothing? Bad outcomes.

## Implementation Alternatives
| Option | Summary | Effort (S/M/L/XL) | Risk | Pros | Cons | Reuses |
|---|---|---|---|---|---|---|
| A | Simple approach | S | Low | Fast | Limited | None |
| B | Better approach | M | Med | Robust | Slower | Some |

## Scope Mode
- [x] hold

## Mode-Specific Analysis
- Selected mode: HOLD
- Analysis: minimum-change-set hardening applied to existing notification system.

## In Scope / Out of Scope

### In Scope
- Notification feed

### Out of Scope
- Email providers

## Discretion Areas
- None

## Deferred Items
| Item | Rationale |
|---|---|
| None | N/A |

## Error & Rescue Registry
| Capability | Failure mode | Detection | Fallback |
|---|---|---|---|
| Feed | Timeout | Health check | Retry |

## Completion Dashboard
- Checklist findings: complete
- Resolved decisions count: 3
- Unresolved decisions: None

## Scope Summary
- Selected mode: hold
- Accepted scope: notification feed hardening
- Deferred: none
- Explicitly excluded: email/SMS
`);

    const result = await lintArtifact(root, "scope");
    const primeDirectives = result.findings.find((f) => f.section === "Prime Directives");
    expect(primeDirectives?.found).toBe(false);
    expect(primeDirectives?.details).toContain("missing");
  });
});

describe("review army schema validation", () => {
  it("accepts structured review-army payload with consistent blockers", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "cclaw-review-army-valid-"));
    await fs.mkdir(path.join(root, ".cclaw/state"), { recursive: true });
    await fs.mkdir(path.join(root, ".cclaw/artifacts"), { recursive: true });
    await fs.writeFile(path.join(root, ".cclaw/state/flow-state.json"), JSON.stringify({
      currentStage: "review",
      activeRunId: "active",
      completedStages: []
    }, null, 2), "utf8");
    await fs.writeFile(path.join(root, ".cclaw/artifacts/07-review-army.json"), JSON.stringify({
      version: 1,
      generatedAt: "2026-01-01T00:00:00Z",
      scope: { base: "main", head: "feature", files: ["src/a.ts"] },
      findings: [{
        id: "F-1",
        severity: "Critical",
        confidence: 8,
        fingerprint: "fp-1",
        reportedBy: ["spec-reviewer", "code-reviewer"],
        status: "open",
        location: { file: "src/a.ts", line: 10 },
        recommendation: "Add guard"
      }],
      reconciliation: {
        duplicatesCollapsed: 0,
        conflicts: [],
        multiSpecialistConfirmed: ["F-1"],
        shipBlockers: ["F-1"]
      }
    }, null, 2), "utf8");

    const result = await validateReviewArmy(root);
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("rejects open critical findings that are not listed as ship blockers", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "cclaw-review-army-invalid-"));
    await fs.mkdir(path.join(root, ".cclaw/state"), { recursive: true });
    await fs.mkdir(path.join(root, ".cclaw/artifacts"), { recursive: true });
    await fs.writeFile(path.join(root, ".cclaw/state/flow-state.json"), JSON.stringify({
      currentStage: "review",
      activeRunId: "active",
      completedStages: []
    }, null, 2), "utf8");
    await fs.writeFile(path.join(root, ".cclaw/artifacts/07-review-army.json"), JSON.stringify({
      version: 1,
      generatedAt: "2026-01-01T00:00:00Z",
      scope: { base: "main", head: "feature", files: ["src/a.ts"] },
      findings: [{
        id: "F-1",
        severity: "Critical",
        confidence: 9,
        fingerprint: "fp-1",
        reportedBy: ["security-reviewer"],
        status: "open",
        recommendation: "Patch before merge"
      }],
      reconciliation: {
        duplicatesCollapsed: 0,
        conflicts: [],
        multiSpecialistConfirmed: [],
        shipBlockers: []
      }
    }, null, 2), "utf8");

    const result = await validateReviewArmy(root);
    expect(result.valid).toBe(false);
    expect(result.errors.join("\n")).toContain("shipBlockers must include open Critical finding");
  });
});
