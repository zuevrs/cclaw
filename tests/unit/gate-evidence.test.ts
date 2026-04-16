import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { stageSchema } from "../../src/content/stage-schema.js";
import { createInitialFlowState } from "../../src/flow-state.js";
import { createTempProject } from "../helpers/index.js";
import {
  reconcileAndWriteCurrentStageGateCatalog,
  reconcileCurrentStageGateCatalog,
  verifyCurrentStageGateEvidence
} from "../../src/gate-evidence.js";

async function prepareRoot(root: string): Promise<void> {
  await fs.mkdir(path.join(root, ".cclaw/state"), { recursive: true });
  await fs.mkdir(path.join(root, ".cclaw/artifacts"), { recursive: true });
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

## Problem
- What we're solving: harden release flow to prevent unsafe publishes
- Success criteria: invalid release metadata blocks publish
- Constraints: no new runtime dependencies

## Clarifying Questions
| # | Question | Answer | Decision impact |
|---|---|---|---|
| 1 | Block invalid metadata or warn? | Block | enforce mandatory gate |
| 2 | Add runtime dependencies? | No | keep existing runtime stack |

## Approaches
| Approach | Architecture | Trade-offs | Recommendation |
|---|---|---|---|
| A | narrow fix | lower risk, weaker reuse |  |
| B | reusable validation module | moderate effort, stronger reuse | recommended |

## Selected Direction
- Approach: B — reusable validation module
- Rationale: best balance of reuse and delivery speed
- Approval: approved

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

## Review Army Contract
- See \`07-review-army.json\`
- Reconciliation summary: pending

## Review Readiness Dashboard
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
});

describe("gate evidence reconciliation", () => {
  it("normalizes current-stage gate catalog and demotes passed gates without evidence", () => {
    const state = createInitialFlowState("run-reconcile");
    const required = stageSchema("brainstorm").requiredGates.map((gate) => gate.id);
    const firstGate = required[0]!;

    state.stageGateCatalog.brainstorm.required = [...required, "unexpected_gate"];
    state.stageGateCatalog.brainstorm.passed = [firstGate, "unexpected_gate"];
    state.stageGateCatalog.brainstorm.blocked = [firstGate];

    const { reconciliation } = reconcileCurrentStageGateCatalog(state);
    expect(reconciliation.changed).toBe(true);
    expect(reconciliation.after.required).toEqual(required);
    expect(reconciliation.after.passed).toEqual([]);
    expect(reconciliation.after.blocked).toContain(firstGate);
    expect(reconciliation.notes.join("\n")).toContain("missing evidence");
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
    expect(result.after.passed).toEqual([]);
    expect(result.after.blocked).toContain(firstGate);

    const persisted = JSON.parse(
      await fs.readFile(path.join(root, ".cclaw/state/flow-state.json"), "utf8")
    ) as typeof state;
    expect(persisted.stageGateCatalog.brainstorm.passed).toEqual([]);
    expect(persisted.stageGateCatalog.brainstorm.blocked).toContain(firstGate);
  });
});
