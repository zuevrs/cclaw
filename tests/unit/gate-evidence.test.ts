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
});
