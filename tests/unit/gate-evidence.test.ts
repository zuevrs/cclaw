import fs from "node:fs/promises";
import path from "node:path";
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

async function prepareRoot(root: string): Promise<void> {
  await fs.mkdir(path.join(root, ".cclaw/state"), { recursive: true });
  await fs.mkdir(path.join(root, ".cclaw/artifacts"), { recursive: true });
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
