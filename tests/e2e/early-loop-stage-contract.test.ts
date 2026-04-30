import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { stageSkillMarkdown } from "../../src/content/skills.js";
import { createInitialFlowState } from "../../src/flow-state.js";
import { verifyCurrentStageGateEvidence } from "../../src/gate-evidence.js";
import { createTempProject } from "../helpers/index.js";

async function prepareRoot(root: string): Promise<void> {
  await fs.mkdir(path.join(root, ".cclaw/state"), { recursive: true });
  await fs.mkdir(path.join(root, ".cclaw/artifacts"), { recursive: true });
}

describe("early-loop stage contract", () => {
  it("brainstorm/scope/design stage markdown includes Victory Detector and Critic Pass", () => {
    for (const stage of ["brainstorm", "scope", "design"] as const) {
      const markdown = stageSkillMarkdown(stage);
      expect(markdown, `${stage} includes Victory Detector guidance`).toContain("Victory Detector");
      expect(markdown, `${stage} includes Critic Pass guidance`).toContain("Critic Pass");
      expect(markdown, `${stage} references early-loop state file`).toContain(".cclaw/state/early-loop.json");
      expect(markdown, `${stage} references early-loop log contract`).toContain(".cclaw/state/early-loop-log.jsonl");
    }
  });

  it("adds a gate issue when early-loop has open concerns and convergence is clear", async () => {
    const root = await createTempProject("early-loop-gate-block");
    await prepareRoot(root);
    const state = createInitialFlowState("run-early");
    state.currentStage = "scope";
    state.activeRunId = "run-early";

    await fs.writeFile(
      path.join(root, ".cclaw/state/early-loop.json"),
      JSON.stringify(
        {
          schemaVersion: 1,
          stage: "scope",
          runId: "run-early",
          iteration: 2,
          maxIterations: 3,
          openConcerns: [
            { id: "E-1", severity: "critical", locator: "Section A", summary: "Gap 1" },
            { id: "E-2", severity: "important", locator: "Section B", summary: "Gap 2" }
          ],
          convergenceTripped: false
        },
        null,
        2
      ),
      "utf8"
    );

    const result = await verifyCurrentStageGateEvidence(root, state);
    expect(result.ok).toBe(false);
    expect(result.issues.join("\n")).toContain("early_loop_open_concerns");
    expect(result.issues.join("\n")).toContain("2 open concern(s) remain");
  });

  it("converts open concerns into soft notice when convergence guard is tripped", async () => {
    const root = await createTempProject("early-loop-gate-soft-notice");
    await prepareRoot(root);
    const state = createInitialFlowState("run-early");
    state.currentStage = "design";
    state.activeRunId = "run-early";

    await fs.writeFile(
      path.join(root, ".cclaw/state/early-loop.json"),
      JSON.stringify(
        {
          schemaVersion: 1,
          stage: "design",
          runId: "run-early",
          iteration: 3,
          maxIterations: 3,
          openConcerns: [{ id: "D-1", severity: "important", locator: "Section C", summary: "Gap 3" }],
          convergenceTripped: true,
          escalationReason: "same concerns 2 iterations in a row"
        },
        null,
        2
      ),
      "utf8"
    );

    const result = await verifyCurrentStageGateEvidence(root, state);
    expect(result.ok).toBe(true);
    expect(result.issues).toEqual([]);
    expect(result.missingRecommended.join("\n")).toContain("early_loop_open_concerns");
    expect(result.missingRecommended.join("\n")).toContain("Request explicit human override before advancing");
  });
});
