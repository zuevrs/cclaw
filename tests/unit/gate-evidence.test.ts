import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { stageSchema } from "../../src/content/stage-schema.js";
import { createInitialFlowState } from "../../src/flow-state.js";
import { verifyCurrentStageGateEvidence } from "../../src/gate-evidence.js";

async function prepareRoot(root: string): Promise<void> {
  await fs.mkdir(path.join(root, ".cclaw/state"), { recursive: true });
  await fs.mkdir(path.join(root, ".cclaw/artifacts"), { recursive: true });
}

describe("gate evidence verification", () => {
  it("fails when passed gates have no recorded guard evidence", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "cclaw-gate-evidence-fail-"));
    await prepareRoot(root);

    const state = createInitialFlowState("run-gate");
    const firstGate = stageSchema(state.currentStage).requiredGates[0]!.id;
    state.stageGateCatalog[state.currentStage].passed = [firstGate];

    const result = await verifyCurrentStageGateEvidence(root, state);
    expect(result.ok).toBe(false);
    expect(result.issues.join("\n")).toContain("missing guardEvidence entry");
  });

  it("passes when guard evidence exists and artifact checks satisfy required sections", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "cclaw-gate-evidence-pass-"));
    await prepareRoot(root);
    await fs.writeFile(path.join(root, ".cclaw/artifacts/01-brainstorm.md"), `# Brainstorm Artifact

## Problem Statement
- User problem: harden release flow

## Alternatives Table
| Option | Summary | Trade-offs | Recommendation |
|---|---|---|---|
| A | narrow fix | low risk |  |
| B | broader refactor | medium risk | recommended |

## Approved Direction
- Selected option: B
- Approval marker: approved

## Open Questions
- None
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
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "cclaw-gate-evidence-review-army-"));
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
