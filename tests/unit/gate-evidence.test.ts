import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { stageSchema } from "../../src/content/stage-schema.js";
import { createInitialFlowState } from "../../src/flow-state.js";
import { createTempProject } from "../helpers/index.js";
import {
  reconcileAndWriteCurrentStageGateCatalog,
  reconcileCurrentStageGateCatalog,
  verifyCompletedStagesGateClosure,
  verifyCurrentStageGateEvidence
} from "../../src/gate-evidence.js";

const execFileAsync = promisify(execFile);

async function prepareRoot(root: string): Promise<void> {
  await fs.mkdir(path.join(root, ".cclaw/state"), { recursive: true });
  await fs.mkdir(path.join(root, ".cclaw/artifacts"), { recursive: true });
}

async function git(cwd: string, args: string[]): Promise<void> {
  await execFileAsync("git", args, { cwd });
}

async function initGitRepoWithPublicApiChange(root: string): Promise<void> {
  await git(root, ["init"]);
  await git(root, ["config", "user.email", "tests@example.com"]);
  await git(root, ["config", "user.name", "Test Runner"]);
  await fs.writeFile(path.join(root, "README.md"), "# temp\n", "utf8");
  await git(root, ["add", "README.md"]);
  await git(root, ["commit", "-m", "init"]);

  await fs.mkdir(path.join(root, "src"), { recursive: true });
  await fs.writeFile(path.join(root, "src/types.ts"), "export interface PublicApi { id: string }\n", "utf8");
  await git(root, ["add", "src/types.ts"]);
  await git(root, ["commit", "-m", "public api change"]);
}

function requiredGateIds(stage: ReturnType<typeof stageSchema>["stage"]): string[] {
  return stageSchema(stage).requiredGates
    .filter((gate) => gate.tier === "required")
    .map((gate) => gate.id);
}

describe("gate evidence verification", () => {
  it("fails when passed gates have no recorded guard evidence", async () => {
    const root = await createTempProject("gate-evidence-fail");
    await prepareRoot(root);

    const state = createInitialFlowState("run-gate");
    const firstGate = stageSchema(state.currentStage).requiredGates[0]!.id;
    state.stageGateCatalog[state.currentStage].passed = [firstGate];

    const result = await verifyCurrentStageGateEvidence(root, state);
    expect(result.ok).toBe(false);
    expect(result.issues.join("\n")).toContain("missing guardEvidence entry");
  });

  it("passes when guard evidence exists and artifact checks satisfy required sections", async () => {
    const root = await createTempProject("gate-evidence-pass");
    await prepareRoot(root);
    await fs.writeFile(path.join(root, ".cclaw/artifacts/01-brainstorm.md"), `# Brainstorm Artifact

## Context
- Project state: monorepo with CI pipeline
- Relevant existing code/patterns: scripts/pre-publish.sh does metadata checks

## Problem Decision Record
- What we're solving: harden release flow to prevent unsafe publishes
- Success criteria: invalid release metadata blocks publish
- Constraints: no new runtime dependencies

## Clarifying Questions
| # | Question | Answer | Decision impact |
|---|---|---|---|
| 1 | Block invalid metadata or warn? | Block | enforce mandatory gate |
| 2 | Add runtime dependencies? | No | keep existing runtime stack |

## Approach Tier
- Tier: Standard
- Why this tier: multiple workflow touchpoints but bounded blast radius.

## Short-Circuit Decision
- Status: bypassed
- Why: requirements needed explicit trade-off discussion.
- Scope handoff: continue full brainstorm before scope.

## Approaches
| Approach | Role | Upside | Architecture | Trade-offs | Recommendation |
|---|---|---|---|---|---|
| A | baseline | modest | narrow fix | lower risk, weaker reuse |  |
| B | challenger | higher | reusable validation module | moderate effort, stronger reuse | recommended |

## Approach Reaction
- Closest option: B
- Concerns: avoid over-building and keep rollout deterministic.
- What changed after reaction: kept module approach but constrained scope to v1 essentials.

## Selected Direction
- Approach: B — reusable validation module
- Rationale: user reaction favored reuse with bounded scope, giving best balance of reuse and delivery speed
- Approval: approved
- Next-stage handoff: scope - lock the validator module boundary and reuse target.

## Design
- Architecture: shared TS module with typed validators
- Key components: validateMetadata, validateChangelog, validateVersion
- Data flow: package.json + CHANGELOG.md -> validator module -> result

## Assumptions and Open Questions
- Assumptions: CI pipeline is stable
- Open questions (or "None"): None
`, "utf8");

    const state = createInitialFlowState("run-gate");
    const firstGate = stageSchema(state.currentStage).requiredGates[0]!.id;
    state.stageGateCatalog[state.currentStage].passed = [firstGate];
    state.guardEvidence[firstGate] = "see 01-brainstorm.md approved direction";

    const result = await verifyCurrentStageGateEvidence(root, state);
    expect(result.ok).toBe(true);
    expect(result.issues).toEqual([]);
  });

  it("blocks tdd docs drift when public API changed without doc-updater completion", async () => {
    const root = await createTempProject("gate-evidence-tdd-docs-drift");
    await prepareRoot(root);
    await initGitRepoWithPublicApiChange(root);
    await fs.writeFile(
      path.join(root, ".cclaw/artifacts/06-tdd.md"),
      `# TDD Artifact

## Test Discovery
- Lists existing tests: tests/unit/api.test.ts
- Fixtures/helpers: temp project helper
- Exact commands: pnpm vitest run api.test.ts
- The chosen local pattern to extend: public API behavior assertions

## System-Wide Impact Check
- Callbacks: none affected
- State transitions: no persisted state transition change
- Interfaces/schemas: public exported API contract changed and covered
- Public APIs/config/CLI: public API docs drift checked
- Persistence/event contracts: out of scope for this slice

## RED Evidence
| Slice | Test name | Command | Failure output summary |
|---|---|---|---|
| S-1 | exposes public api | pnpm vitest run api.test.ts | FAIL: expected exported type |

## Acceptance Mapping
| Slice | Plan task ID | Spec criterion ID |
|---|---|---|
| S-1 | T-1 | AC-1 |

## Failure Analysis
| Slice | Expected missing behavior | Actual failure reason |
|---|---|---|
| S-1 | API surface changed | Existing docs/tests stale |

## GREEN Evidence
- Full suite command: pnpm vitest run
- Full suite result: 12 passed, 0 failed

## REFACTOR Notes
- What changed: normalized exported type names
- Why: keep API naming consistent
- Behavior preserved: Full suite green after refactor

## Traceability
- T-1 -> AC-1

## Verification Ladder
- Highest tier reached: command
- Evidence: pnpm vitest run api.test.ts (pass)
`,
      "utf8"
    );

    const state = createInitialFlowState("run-tdd-docs");
    state.currentStage = "tdd";
    const required = requiredGateIds("tdd");
    state.stageGateCatalog.tdd.passed = [...required];
    for (const gateId of required) {
      state.guardEvidence[gateId] =
        gateId === "tdd_verified_before_complete"
          ? "npm test; sha: abc1234; PASS"
          : `evidence:${gateId}`;
    }

    const blocked = await verifyCurrentStageGateEvidence(root, state);
    expect(blocked.ok).toBe(false);
    expect(blocked.issues.join("\n")).toContain("tdd_docs_drift_check");

    await fs.writeFile(
      path.join(root, ".cclaw/state/delegation-log.json"),
      JSON.stringify({
        runId: "run-tdd-docs",
        entries: [
          {
            stage: "tdd",
            agent: "doc-updater",
            mode: "proactive",
            status: "completed",
            fulfillmentMode: "isolated",
            evidenceRefs: [".cclaw/artifacts/06-tdd.md#verification-ladder"],
            ts: new Date().toISOString(),
            runId: "run-tdd-docs"
          }
        ]
      }, null, 2),
      "utf8"
    );

    const cleared = await verifyCurrentStageGateEvidence(root, state);
    expect(cleared.ok).toBe(true);
  });

  it("blocks tdd completion evidence that does not cite a discovered real test command", async () => {
    const root = await createTempProject("gate-evidence-tdd-real-command");
    await prepareRoot(root);
    await fs.writeFile(path.join(root, "package.json"), JSON.stringify({
      scripts: { test: "vitest run", "test:unit": "vitest run tests/unit" }
    }), "utf8");
    await fs.writeFile(path.join(root, ".cclaw/artifacts/06-tdd.md"), `# TDD Artifact

## Test Discovery
- Exact commands: npm test

## System-Wide Impact Check
- Public APIs/config/CLI: unchanged

## RED Evidence
| Slice | Test name | Command | Failure output summary |
|---|---|---|---|
| S-1 | sample | npm test | FAIL first |

## Acceptance Mapping
| Slice | Plan task ID | Spec criterion ID |
|---|---|---|
| S-1 | T-1 | AC-1 |

## Failure Analysis
- Expected missing behavior: sample

## GREEN Evidence
- Full suite command: npm test
- Full suite result: PASS

## REFACTOR Notes
- Behavior preserved: PASS

## Traceability
- T-1 -> AC-1

## Verification Ladder
- Evidence: npm test PASS
`, "utf8");

    const state = createInitialFlowState("run-tdd-real-command");
    state.currentStage = "tdd";
    state.stageGateCatalog.tdd.passed = ["tdd_verified_before_complete"];
    state.guardEvidence.tdd_verified_before_complete = "custom smoke command; sha: abc1234; PASS";

    const blocked = await verifyCurrentStageGateEvidence(root, state);
    expect(blocked.issues.join("\n")).toContain("must cite one discovered real test command");
    expect(blocked.issues.join("\n")).toContain("npm test");

    state.guardEvidence.tdd_verified_before_complete = "npm test; sha: abc1234; PASS";
    const cleared = await verifyCurrentStageGateEvidence(root, state);
    expect(cleared.issues.join("\n")).not.toContain("must cite one discovered real test command");
  });

  it("blocks review-to-ship trace evidence that does not cite a discovered real test command", async () => {
    const root = await createTempProject("gate-evidence-review-real-command");
    await prepareRoot(root);
    await fs.writeFile(path.join(root, "package.json"), JSON.stringify({
      scripts: { test: "vitest run" }
    }), "utf8");

    const state = createInitialFlowState("run-review-real-command");
    state.currentStage = "review";
    state.stageGateCatalog.review.passed = ["review_trace_matrix_clean"];
    state.guardEvidence.review_trace_matrix_clean = "manual QA PASS";

    const blocked = await verifyCurrentStageGateEvidence(root, state);
    expect(blocked.issues.join("\n")).toContain("review verification gate blocked");
    expect(blocked.issues.join("\n")).toContain("npm test");
  });

  it("requires content or artifact hash for configured no-VCS TDD evidence", async () => {
    const root = await createTempProject("gate-evidence-tdd-no-vcs-hash");
    await prepareRoot(root);
    await fs.writeFile(path.join(root, ".cclaw/config.yaml"), `harnesses:
  - claude
vcs: none
`, "utf8");
    await fs.writeFile(path.join(root, ".cclaw/artifacts/06-tdd.md"), `# TDD Artifact

## Test Discovery
- Exact commands: npm test

## System-Wide Impact Check
- Public APIs/config/CLI: unchanged

## RED Evidence
| Slice | Test name | Command | Failure output summary |
|---|---|---|---|
| S-1 | sample | npm test | FAIL first |

## GREEN Evidence
- Full suite command: npm test
- Full suite result: PASS

## REFACTOR Notes
- Behavior preserved: PASS

## Traceability
- T-1 -> AC-1

## Verification Ladder
- Evidence: npm test PASS no-vcs: sandbox has no git
`, "utf8");

    const state = createInitialFlowState("run-tdd-no-vcs-hash");
    state.currentStage = "tdd";
    state.stageGateCatalog.tdd.passed = ["tdd_verified_before_complete"];
    state.guardEvidence.tdd_verified_before_complete = "npm test PASS no-vcs: sandbox has no git";

    const blocked = await verifyCurrentStageGateEvidence(root, state);
    expect(blocked.issues.join("\n")).toContain("content/artifact hash");

    state.guardEvidence.tdd_verified_before_complete = "npm test PASS no-vcs: sandbox has no git artifact-hash: sha256:1234567890abcdef";
    const cleared = await verifyCurrentStageGateEvidence(root, state);
    expect(cleared.issues.join("\n")).not.toContain("content/artifact hash");
  });

  it("fails review stage when Final Verdict is APPROVED but open Critical findings exist", async () => {
    const root = await createTempProject("review-verdict-mismatch");
    await prepareRoot(root);
    await fs.writeFile(
      path.join(root, ".cclaw/artifacts/07-review.md"),
      `# Review Artifact

## Layer 1 Verdict
| Criterion | Verdict | Evidence |
|---|---|---|
| AC-1 | PASS | src/a.ts |

## Layer 2 Findings
| ID | Severity | Category | Description | Status |
|---|---|---|---|---|
| F-1 | Critical | security | unpatched SSRF | open |

## Review Findings Contract
- See \`07-review-army.json\`
- Reconciliation summary: pending

## Review Readiness Snapshot
- Layer 1 complete: yes
- Layer 2 complete: yes
- Review army schema valid: pending
- Open critical blockers: 1
- Ship recommendation: blocked

## Severity Summary
- Critical: 1
- Important: 0
- Suggestion: 0

## Final Verdict
- APPROVED
`,
      "utf8"
    );
    await fs.writeFile(
      path.join(root, ".cclaw/artifacts/07-review-army.json"),
      JSON.stringify({
        version: 1,
        generatedAt: "2026-01-01T00:00:00Z",
        scope: { base: "main", head: "feature", files: ["src/a.ts"] },
        findings: [
          {
            id: "F-1",
            severity: "Critical",
            confidence: 9,
            fingerprint: "fp-1",
            reportedBy: ["security-reviewer"],
            status: "open",
            recommendation: "Patch SSRF before merge"
          }
        ],
        reconciliation: {
          duplicatesCollapsed: 0,
          conflicts: [],
          multiSpecialistConfirmed: [],
          shipBlockers: ["F-1"]
        }
      }, null, 2),
      "utf8"
    );

    const state = createInitialFlowState("run-mismatch");
    state.currentStage = "review";
    const firstReviewGate = stageSchema("review").requiredGates[0]!.id;
    state.stageGateCatalog.review.passed = [firstReviewGate];
    state.guardEvidence[firstReviewGate] = "review gate evidence";

    const result = await verifyCurrentStageGateEvidence(root, state);
    expect(result.ok).toBe(false);
    expect(result.issues.join("\n")).toMatch(/verdict inconsistency/);
  });

  it("blocks review_criticals_resolved when open critical blockers remain", async () => {
    const root = await createTempProject("review-criticals-gate");
    await prepareRoot(root);
    await fs.writeFile(
      path.join(root, ".cclaw/artifacts/07-review.md"),
      `# Review Artifact

## Layer 1 Verdict
| Criterion | Verdict | Evidence |
|---|---|---|
| AC-1 | PASS | src/auth.ts |

## Layer 2 Findings
| ID | Severity | Category | Description | Status |
|---|---|---|---|---|
| F-99 | Critical | security | auth bypass | open |

## Review Findings Contract
- See \`07-review-army.json\`

## Severity Summary
- Critical: 1
- Important: 0
- Suggestion: 0

## Final Verdict
- BLOCKED
`,
      "utf8"
    );
    await fs.writeFile(
      path.join(root, ".cclaw/artifacts/07-review-army.json"),
      JSON.stringify({
        version: 1,
        generatedAt: "2026-01-01T00:00:00Z",
        scope: { base: "main", head: "feature", files: ["src/auth.ts"] },
        findings: [
          {
            id: "F-99",
            severity: "Critical",
            confidence: 9,
            fingerprint: "fp-auth-bypass",
            reportedBy: ["security-reviewer"],
            status: "open",
            recommendation: "Patch auth guard before merge"
          }
        ],
        reconciliation: {
          duplicatesCollapsed: 0,
          conflicts: [],
          multiSpecialistConfirmed: [],
          shipBlockers: ["F-99"]
        }
      }, null, 2),
      "utf8"
    );

    const state = createInitialFlowState("run-review-criticals");
    state.currentStage = "review";
    const reviewRequired = requiredGateIds("review");
    state.stageGateCatalog.review.passed = [...reviewRequired];
    for (const gateId of reviewRequired) {
      state.guardEvidence[gateId] = `evidence:${gateId}`;
    }

    const result = await verifyCurrentStageGateEvidence(root, state);
    expect(result.ok).toBe(false);
    expect(result.issues.join("\n")).toContain("review criticals gate blocked");
    expect(result.issues.join("\n")).toContain("review_criticals_resolved");
  });

  it("fails review stage when review-army payload is invalid", async () => {
    const root = await createTempProject("gate-evidence-review-army");
    await prepareRoot(root);
    await fs.writeFile(path.join(root, ".cclaw/artifacts/07-review.md"), `# Review Artifact

## Layer 1 Verdict
| Criterion | Verdict | Evidence |
|---|---|---|
| AC-1 | PASS | src/a.ts |

## Layer 2 Findings
| ID | Severity | Category | Description | Status |
|---|---|---|---|---|
| F-1 | Critical | security | missing auth check | open |

## Review Findings Contract
- See \`07-review-army.json\`
- Reconciliation summary: pending

## Review Readiness Snapshot
- Layer 1 complete: yes
- Layer 2 complete: yes
- Review army schema valid: pending
- Open critical blockers: 1
- Ship recommendation: blocked

## Severity Summary
- Critical: 1
- Important: 0
- Suggestion: 0

## Final Verdict
- BLOCKED
`, "utf8");

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

    const state = createInitialFlowState("run-review");
    state.currentStage = "review";
    const firstReviewGate = stageSchema("review").requiredGates[0]!.id;
    state.stageGateCatalog.review.passed = [firstReviewGate];
    state.guardEvidence[firstReviewGate] = "review gate evidence present";

    const result = await verifyCurrentStageGateEvidence(root, state);
    expect(result.ok).toBe(false);
    expect(result.issues.join("\n")).toContain("review-army validation failed");
  });

  it("blocks review trace gate when trace matrix has orphaned links", async () => {
    const root = await createTempProject("gate-evidence-trace-orphans");
    await prepareRoot(root);
    await fs.writeFile(
      path.join(root, ".cclaw/artifacts/04-spec.md"),
      `# Spec

- AC-1: Login accepts valid credentials.
- AC-2: Login rejects invalid credentials.
`,
      "utf8"
    );
    await fs.writeFile(
      path.join(root, ".cclaw/artifacts/05-plan.md"),
      `# Plan

| Task ID | Description | Acceptance criterion |
|---|---|---|
| T-1 | login happy path | AC-1 |
`,
      "utf8"
    );
    await fs.writeFile(
      path.join(root, ".cclaw/artifacts/06-tdd.md"),
      `# TDD

| Slice | Task |
|---|---|
| S-1 | T-1 |
`,
      "utf8"
    );
    await fs.writeFile(
      path.join(root, ".cclaw/artifacts/07-review.md"),
      `# Review Artifact

## Layer 1 Verdict
| Criterion | Verdict | Evidence |
|---|---|---|
| AC-1 | PASS | src/auth.ts |

## Layer 2 Findings
| ID | Severity | Category | Description | Status |
|---|---|---|---|---|
| R-1 | Suggestion | architecture | tighten naming | resolved |

## Review Findings Contract
- See \`07-review-army.json\`
- Reconciliation summary: clean

## Severity Summary
- Critical: 0
- Important: 0
- Suggestion: 1

## Final Verdict
- APPROVED_WITH_CONCERNS
`,
      "utf8"
    );
    await fs.writeFile(
      path.join(root, ".cclaw/artifacts/07-review-army.json"),
      JSON.stringify({
        version: 1,
        generatedAt: "2026-01-01T00:00:00Z",
        scope: { base: "main", head: "feature", files: ["src/auth.ts"] },
        findings: [],
        reconciliation: {
          duplicatesCollapsed: 0,
          conflicts: [],
          multiSpecialistConfirmed: [],
          shipBlockers: []
        }
      }, null, 2),
      "utf8"
    );

    const state = createInitialFlowState("run-trace-gate");
    state.currentStage = "review";
    const reviewRequired = requiredGateIds("review");
    state.stageGateCatalog.review.passed = [...reviewRequired];
    for (const gateId of reviewRequired) {
      state.guardEvidence[gateId] = `evidence:${gateId}`;
    }

    const result = await verifyCurrentStageGateEvidence(root, state);
    expect(result.ok).toBe(false);
    expect(result.issues.join("\n")).toContain("review trace-matrix gate blocked");
  });

  it("blocks design research gate when sections are <fill-in> placeholders", async () => {
    const root = await createTempProject("gate-evidence-design-research-fillin");
    await prepareRoot(root);
    const state = createInitialFlowState("run-design-research-fillin");
    state.currentStage = "design";
    const required = requiredGateIds("design");
    state.stageGateCatalog.design.passed = [...required];
    for (const gateId of required) {
      state.guardEvidence[gateId] = `evidence:${gateId}`;
    }
    await fs.writeFile(
      path.join(root, ".cclaw/artifacts/02a-research.md"),
      `# Research Artifact

## Stack Analysis
<fill-in>

## Features & Patterns
<fill-in>

## Architecture Options
<fill-in>

## Pitfalls & Risks
<fill-in>

## Synthesis
<fill-in>
`,
      "utf8"
    );

    const result = await verifyCurrentStageGateEvidence(root, state);
    expect(result.ok).toBe(false);
    expect(result.issues.join("\n")).toMatch(/empty or placeholder/);
  });

  it("accepts inline research from the resolved slugged design artifact", async () => {
    const root = await createTempProject("gate-evidence-design-research-slugged");
    await prepareRoot(root);
    await fs.writeFile(
      path.join(root, ".cclaw/artifacts/03-design-runtime-correctness.md"),
      `# Design Artifact

## Research Fleet Synthesis
| Lens | Key findings | Design impact | Evidence |
|---|---|---|---|
| compact inline synthesis | Artifact resolver must read slugged design artifacts. | Gate evidence should not require legacy 03-design.md. | resolver regression |
`,
      "utf8"
    );

    const state = createInitialFlowState("run-design-research-slugged");
    state.currentStage = "design";
    const required = requiredGateIds("design");
    state.stageGateCatalog.design.passed = [...required];
    for (const gateId of required) {
      state.guardEvidence[gateId] = `evidence:${gateId}`;
    }

    const result = await verifyCurrentStageGateEvidence(root, state);
    expect(result.issues.join("\n")).not.toContain("design research gate blocked");
  });

  it("blocks design research gate when 02a-research artifact is missing", async () => {
    const root = await createTempProject("gate-evidence-design-research");
    await prepareRoot(root);
    const state = createInitialFlowState("run-design-research");
    state.currentStage = "design";
    const required = requiredGateIds("design");
    state.stageGateCatalog.design.passed = [...required];
    for (const gateId of required) {
      state.guardEvidence[gateId] = `evidence:${gateId}`;
    }

    const result = await verifyCurrentStageGateEvidence(root, state);
    expect(result.ok).toBe(false);
    expect(result.issues.join("\n")).toContain("design research gate blocked");
  });

  it("blocks tdd stage when tdd-cycle order is invalid for the active run", async () => {
    const root = await createTempProject("gate-evidence-tdd-order");
    await prepareRoot(root);
    await fs.writeFile(
      path.join(root, ".cclaw/artifacts/06-tdd.md"),
      `# TDD Artifact

## RED Evidence
| Slice | Test name | Command | Failure output summary |
|---|---|---|---|
| S-1 | should enforce guard | npm test -- guard.test.ts | FAIL: expected unauthorized to be blocked |

## Acceptance Mapping
| Slice | Plan task ID | Spec criterion ID |
|---|---|---|
| S-1 | T-1 | AC-1 |

## Failure Analysis
| Slice | Expected missing behavior | Actual failure reason |
|---|---|---|
| S-1 | Missing auth check | Guard path bypassed |

## GREEN Evidence
- Full suite command: npm test
- Full suite result: PASS

## REFACTOR Notes
- What changed: removed duplicate guard setup
- Why: reduce coupling
- Behavior preserved: npm test remains green

## Traceability
- T-1 -> AC-1

## Verification Ladder
- Highest tier reached: command
- Evidence: npm test (pass)
`,
      "utf8"
    );
    await fs.writeFile(
      path.join(root, ".cclaw/state/tdd-cycle-log.jsonl"),
      `${JSON.stringify({
        ts: "2026-04-21T10:00:00.000Z",
        runId: "run-tdd-order",
        stage: "tdd",
        slice: "S-1",
        phase: "green",
        command: "npm test -- guard.test.ts",
        exitCode: 0
      })}\n${JSON.stringify({
        ts: "2026-04-21T10:00:05.000Z",
        runId: "run-tdd-order",
        stage: "tdd",
        slice: "S-1",
        phase: "red",
        command: "npm test -- guard.test.ts",
        exitCode: 1
      })}\n`,
      "utf8"
    );

    const state = createInitialFlowState("run-tdd-order");
    state.currentStage = "tdd";
    const required = requiredGateIds("tdd");
    state.stageGateCatalog.tdd.passed = [...required];
    for (const gateId of required) {
      state.guardEvidence[gateId] =
        gateId === "tdd_verified_before_complete"
          ? "npm test -- guard.test.ts; sha: abc1234; PASS"
          : `evidence:${gateId}`;
    }

    const result = await verifyCurrentStageGateEvidence(root, state);
    expect(result.ok).toBe(false);
    expect(result.issues.join("\n")).toContain("tdd cycle order gate blocked");
    expect(result.issues.join("\n")).toContain("GREEN repair needed");
  });

  it("lints artifact eagerly when file exists even before any gate is passed", async () => {
    const root = await createTempProject("gate-evidence-artifact-eager");
    await prepareRoot(root);
    await fs.writeFile(
      path.join(root, ".cclaw/artifacts/01-brainstorm.md"),
      "# Malformed artifact without required H2 sections\n",
      "utf8"
    );

    const state = createInitialFlowState("run-eager");
    const result = await verifyCurrentStageGateEvidence(root, state);
    expect(result.ok).toBe(false);
    expect(result.issues.join("\n")).toContain("artifact validation failed");
  });

  it("reports missing required gates via missingRequired while stage is active", async () => {
    const root = await createTempProject("gate-evidence-missing");
    await prepareRoot(root);
    const state = createInitialFlowState("run-active");
    const required = requiredGateIds(state.currentStage);

    const result = await verifyCurrentStageGateEvidence(root, state);
    expect(result.complete).toBe(false);
    expect(result.missingRequired).toEqual(required);
    expect(result.ok).toBe(true);
  });

  it("fails when stage is marked completed but required gates are not all passed", async () => {
    const root = await createTempProject("gate-evidence-completed-gap");
    await prepareRoot(root);
    const state = createInitialFlowState("run-completed-gap");
    const required = requiredGateIds(state.currentStage);
    state.stageGateCatalog[state.currentStage].passed = [required[0]!];
    state.guardEvidence[required[0]!] = "evidence-1";
    state.completedStages.push(state.currentStage);

    const result = await verifyCurrentStageGateEvidence(root, state);
    expect(result.ok).toBe(false);
    expect(result.issues.join("\n")).toContain("marked completed but required gates are not passed");
  });
});

describe("completed-stage gate closure verification", () => {
  it("passes when no stages are completed", () => {
    const state = createInitialFlowState("run-empty");
    const result = verifyCompletedStagesGateClosure(state);
    expect(result.ok).toBe(true);
    expect(result.openStages).toEqual([]);
  });

  it("fails when a completed stage still has unpassed required gates", () => {
    const state = createInitialFlowState("run-open");
    state.completedStages.push("brainstorm");
    state.stageGateCatalog.brainstorm.passed = [];

    const result = verifyCompletedStagesGateClosure(state);
    expect(result.ok).toBe(false);
    expect(result.openStages[0]?.stage).toBe("brainstorm");
    expect(result.openStages[0]?.missingRequired.length).toBeGreaterThan(0);
  });

  it("fails when a completed stage carries blocked gates", () => {
    const state = createInitialFlowState("run-blocked");
    const required = requiredGateIds("brainstorm");
    state.completedStages.push("brainstorm");
    state.stageGateCatalog.brainstorm.passed = [...required];
    state.stageGateCatalog.brainstorm.blocked = [required[0]!];
    for (const gate of required) {
      state.guardEvidence[gate] = "ev";
    }

    const result = verifyCompletedStagesGateClosure(state);
    expect(result.ok).toBe(false);
    expect(result.issues.join("\n")).toContain("still has blocking blocked gates");
  });
});

describe("gate evidence reconciliation", () => {
  it("normalizes current-stage gate catalog and demotes passed gates without evidence", () => {
    const state = createInitialFlowState("run-reconcile");
    const required = requiredGateIds("brainstorm");
    const firstGate = required[0]!;

    state.stageGateCatalog.brainstorm.required = [...required, "unexpected_gate"];
    state.stageGateCatalog.brainstorm.passed = [firstGate, "unexpected_gate"];
    state.stageGateCatalog.brainstorm.blocked = [firstGate];

    const { reconciliation } = reconcileCurrentStageGateCatalog(state);
    expect(reconciliation.changed).toBe(true);
    expect(reconciliation.after.required).toEqual(required);
    expect(reconciliation.after.passed).toEqual([]);
    expect(reconciliation.after.blocked).toContain(firstGate);
    expect(reconciliation.demotedGateIds).toContain(firstGate);
    expect(reconciliation.notes.join("\n")).toContain("missing evidence");
  });

  it("resolves passed/blocked overlap in favor of passed when evidence exists", () => {
    const state = createInitialFlowState("run-reconcile-overlap-evidence");
    const required = requiredGateIds("brainstorm");
    const firstGate = required[0]!;

    state.stageGateCatalog.brainstorm.passed = [firstGate];
    state.stageGateCatalog.brainstorm.blocked = [firstGate];
    state.guardEvidence[firstGate] = "approved direction in artifact";

    const { reconciliation } = reconcileCurrentStageGateCatalog(state);
    expect(reconciliation.changed).toBe(true);
    expect(reconciliation.after.passed).toContain(firstGate);
    expect(reconciliation.after.blocked).not.toContain(firstGate);
    expect(reconciliation.demotedGateIds).toEqual([]);
    expect(reconciliation.notes.join("\n")).toContain("in favor of passed");
  });

  it("returns unchanged state when current-stage catalog is already normalized", () => {
    const state = createInitialFlowState("run-reconcile-clean");
    const required = requiredGateIds("brainstorm");
    state.stageGateCatalog.brainstorm.passed = [...required];
    for (const gate of required) {
      state.guardEvidence[gate] = "gate evidence";
    }

    const { nextState, reconciliation } = reconcileCurrentStageGateCatalog(state);
    expect(reconciliation.changed).toBe(false);
    expect(reconciliation.demotedGateIds).toEqual([]);
    expect(reconciliation.notes).toEqual([]);
    expect(nextState).toBe(state);
  });

  it("writes reconciled catalog back to flow-state", async () => {
    const root = await createTempProject("gate-reconcile-writeback");
    await prepareRoot(root);

    const state = createInitialFlowState("run-reconcile");
    const firstGate = stageSchema("brainstorm").requiredGates[0]!.id;
    state.stageGateCatalog.brainstorm.passed = [firstGate];
    await fs.writeFile(
      path.join(root, ".cclaw/state/flow-state.json"),
      `${JSON.stringify(state, null, 2)}\n`,
      "utf8"
    );

    const result = await reconcileAndWriteCurrentStageGateCatalog(root);
    expect(result.changed).toBe(true);
    expect(result.wrote).toBe(true);
    expect(result.demotedGateIds).toEqual([firstGate]);
    expect(result.after.passed).toEqual([]);
    expect(result.after.blocked).toContain(firstGate);

    const persisted = JSON.parse(
      await fs.readFile(path.join(root, ".cclaw/state/flow-state.json"), "utf8")
    ) as typeof state;
    expect(persisted.stageGateCatalog.brainstorm.passed).toEqual([]);
    expect(persisted.stageGateCatalog.brainstorm.blocked).toContain(firstGate);

    const notices = JSON.parse(
      await fs.readFile(path.join(root, ".cclaw/state/reconciliation-notices.json"), "utf8")
    ) as {
      schemaVersion: number;
      notices: Array<{ runId: string; stage: string; gateId: string; reason: string }>;
    };
    expect(notices.schemaVersion).toBe(1);
    expect(notices.notices).toHaveLength(1);
    expect(notices.notices[0]?.runId).toBe("run-reconcile");
    expect(notices.notices[0]?.stage).toBe("brainstorm");
    expect(notices.notices[0]?.gateId).toBe(firstGate);
    expect(notices.notices[0]?.reason).toContain("demoted from passed to blocked");
  });

  it("does not duplicate reconciliation notices for the same run/stage/gate", async () => {
    const root = await createTempProject("gate-reconcile-notice-dedupe");
    await prepareRoot(root);

    const state = createInitialFlowState("run-reconcile-dedupe");
    const firstGate = stageSchema("brainstorm").requiredGates[0]!.id;
    state.stageGateCatalog.brainstorm.passed = [firstGate];
    await fs.writeFile(
      path.join(root, ".cclaw/state/flow-state.json"),
      `${JSON.stringify(state, null, 2)}\n`,
      "utf8"
    );
    await fs.writeFile(
      path.join(root, ".cclaw/state/reconciliation-notices.json"),
      JSON.stringify({
        schemaVersion: 1,
        notices: [
          {
            id: `run-reconcile-dedupe:brainstorm:${firstGate}:2026-04-20T00:00:00.000Z`,
            runId: "run-reconcile-dedupe",
            stage: "brainstorm",
            gateId: firstGate,
            reason: "demoted from passed to blocked during gate reconciliation (missing evidence)",
            demotedAt: "2026-04-20T00:00:00.000Z"
          }
        ]
      }, null, 2),
      "utf8"
    );

    const result = await reconcileAndWriteCurrentStageGateCatalog(root);
    expect(result.demotedGateIds).toEqual([firstGate]);

    const notices = JSON.parse(
      await fs.readFile(path.join(root, ".cclaw/state/reconciliation-notices.json"), "utf8")
    ) as { notices: Array<{ gateId: string }> };
    expect(notices.notices).toHaveLength(1);
    expect(notices.notices[0]?.gateId).toBe(firstGate);
  });

  it("drops stale-run notices and keeps deterministic notice ordering", async () => {
    const root = await createTempProject("gate-reconcile-notice-sort");
    await prepareRoot(root);

    const state = createInitialFlowState("run-reconcile-sort");
    const required = stageSchema("brainstorm").requiredGates.map((gate) => gate.id);
    const [gateA, gateB, gateC] = required;
    state.stageGateCatalog.brainstorm.blocked = [gateA!, gateB!, gateC!];
    await fs.writeFile(
      path.join(root, ".cclaw/state/flow-state.json"),
      `${JSON.stringify(state, null, 2)}\n`,
      "utf8"
    );
    await fs.writeFile(
      path.join(root, ".cclaw/state/reconciliation-notices.json"),
      JSON.stringify({
        schemaVersion: 1,
        notices: [
          {
            id: "b-id",
            runId: "run-reconcile-sort",
            stage: "brainstorm",
            gateId: gateB,
            reason: "demoted from passed to blocked during gate reconciliation (missing evidence)",
            demotedAt: "2026-04-20T00:00:00.000Z"
          },
          {
            id: "a-id",
            runId: "run-reconcile-sort",
            stage: "brainstorm",
            gateId: gateA,
            reason: "demoted from passed to blocked during gate reconciliation (missing evidence)",
            demotedAt: "2026-04-20T00:00:00.000Z"
          },
          {
            id: "c-id",
            runId: "run-reconcile-sort",
            stage: "brainstorm",
            gateId: gateC,
            reason: "demoted from passed to blocked during gate reconciliation (missing evidence)",
            demotedAt: "2026-04-20T00:00:01.000Z"
          },
          {
            id: "stale-id",
            runId: "run-old",
            stage: "brainstorm",
            gateId: gateA,
            reason: "demoted from passed to blocked during gate reconciliation (missing evidence)",
            demotedAt: "2026-04-19T23:59:59.000Z"
          }
        ]
      }, null, 2),
      "utf8"
    );

    const result = await reconcileAndWriteCurrentStageGateCatalog(root);
    expect(result.changed).toBe(false);

    const notices = JSON.parse(
      await fs.readFile(path.join(root, ".cclaw/state/reconciliation-notices.json"), "utf8")
    ) as { notices: Array<{ id: string; runId: string }> };
    expect(notices.notices.map((notice) => notice.id)).toEqual(["a-id", "b-id", "c-id"]);
    expect(notices.notices.every((notice) => notice.runId === "run-reconcile-sort")).toBe(true);
  });
  it("accepts no-VCS attestation for tdd verification when no git repo exists", async () => {
    const root = await createTempProject("gate-evidence-tdd-no-vcs");
    await prepareRoot(root);
    await fs.writeFile(path.join(root, "package.json"), JSON.stringify({
      scripts: { test: "vitest run" }
    }), "utf8");
    await fs.writeFile(path.join(root, ".cclaw/artifacts/06-tdd.md"), `# TDD Artifact

## Test Discovery
- Exact commands: npm test

## System-Wide Impact Check
- Public APIs/config/CLI: unchanged

## RED Evidence
| Slice | Test name | Command | Failure output summary |
|---|---|---|---|
| S-1 | sample | npm test | FAIL first |

## GREEN Evidence
- Full suite command: npm test
- Full suite result: PASS

## REFACTOR Notes
- Behavior preserved: PASS

## Traceability
- T-1 -> AC-1

## Verification Ladder
- Evidence: npm test PASS no-vcs: temp project has no .git directory
`, "utf8");
    const state = createInitialFlowState("run-tdd-no-vcs");
    state.currentStage = "tdd";
    state.stageGateCatalog.tdd.passed = ["tdd_verified_before_complete"];
    state.guardEvidence.tdd_verified_before_complete = "npm test; no-vcs: temp project has no .git directory; PASS";

    const result = await verifyCurrentStageGateEvidence(root, state);
    expect(result.issues.join("\n")).not.toContain("commit SHA");
    expect(result.issues.join("\n")).not.toContain("no-VCS attestation");
  });

  it("honors tdd.verificationRef=disabled for verification evidence", async () => {
    const root = await createTempProject("gate-evidence-tdd-ref-disabled");
    await prepareRoot(root);
    await fs.writeFile(path.join(root, ".cclaw/config.yaml"), `harnesses:
  - claude
tdd:
  verificationRef: disabled
`, "utf8");
    await fs.writeFile(path.join(root, "package.json"), JSON.stringify({
      scripts: { test: "vitest run" }
    }), "utf8");
    const state = createInitialFlowState("run-tdd-ref-disabled");
    state.currentStage = "tdd";
    state.stageGateCatalog.tdd.passed = ["tdd_verified_before_complete"];
    state.guardEvidence.tdd_verified_before_complete = "npm test PASS";

    const result = await verifyCurrentStageGateEvidence(root, state);
    expect(result.issues.join("\n")).not.toContain("commit SHA");
  });

});
