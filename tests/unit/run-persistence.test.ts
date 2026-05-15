import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { FLOW_STATE_REL_PATH } from "../../src/constants.js";
import { LegacyFlowStateError } from "../../src/flow-state.js";
import {
  ensureRunSystem,
  patchFlowState,
  readFlowState,
  resetFlowState,
  writeFlowState
} from "../../src/run-persistence.js";
import { createTempProject, removeProject } from "../helpers/temp-project.js";

describe("run-persistence", () => {
  let project: string;
  afterEach(async () => {
    if (project) await removeProject(project);
  });

  it("creates an initial state on first read (v8.2 schema)", async () => {
    project = await createTempProject();
    await ensureRunSystem(project);
    const state = await readFlowState(project);
    expect(state.schemaVersion).toBe(3);
    expect(state.currentSlug).toBeNull();
    expect(state.ac).toEqual([]);
    expect(state.triage).toBeNull();
  });

  it("round-trips a written state", async () => {
    project = await createTempProject();
    await writeFlowState(project, {
      schemaVersion: 3,
      currentSlug: "demo",
      currentStage: "plan",
      ac: [{ id: "AC-1", text: "t", status: "pending" }],
      lastSpecialist: null,
      startedAt: "2026-05-07T00:00:00Z",
      reviewIterations: 0,
      securityFlag: false,
      triage: null
    });
    const state = await readFlowState(project);
    expect(state.currentSlug).toBe("demo");
    expect(state.ac).toHaveLength(1);
  });

  it("patches a state immutably", async () => {
    project = await createTempProject();
    await ensureRunSystem(project);
    const next = await patchFlowState(project, { currentSlug: "x", currentStage: "build" });
    expect(next.currentSlug).toBe("x");
    expect(next.currentStage).toBe("build");
  });

  it("rejects loading a 7.x flow-state on read", async () => {
    project = await createTempProject();
    await fs.mkdir(path.join(project, ".cclaw", "state"), { recursive: true });
    await fs.writeFile(
      path.join(project, FLOW_STATE_REL_PATH),
      JSON.stringify({ schemaVersion: 1, currentStage: "spec" }),
      "utf8"
    );
    await expect(readFlowState(project)).rejects.toBeInstanceOf(LegacyFlowStateError);
  });

  it("resetFlowState zeroes slug, AC, and triage", async () => {
    project = await createTempProject();
    await writeFlowState(project, {
      schemaVersion: 3,
      currentSlug: "demo",
      currentStage: "plan",
      ac: [{ id: "AC-1", text: "t", status: "committed", commit: "abc" }],
      lastSpecialist: null,
      startedAt: "2026-05-07T00:00:00Z",
      reviewIterations: 0,
      securityFlag: false,
      triage: {
        complexity: "small-medium",
        ceremonyMode: "soft",
        path: ["plan", "build", "review", "ship"],
        rationale: "test",
        decidedAt: "2026-05-07T00:00:00Z",
        userOverrode: false
      }
    });
    await resetFlowState(project);
    const state = await readFlowState(project);
    expect(state.currentSlug).toBeNull();
    expect(state.ac).toEqual([]);
    expect(state.triage).toBeNull();
  });

  it("auto-migrates a v8.0/v8.1 (schemaVersion=2) state on read and rewrites the file", async () => {
    project = await createTempProject();
    await fs.mkdir(path.join(project, ".cclaw", "state"), { recursive: true });
    await fs.writeFile(
      path.join(project, FLOW_STATE_REL_PATH),
      JSON.stringify({
        schemaVersion: 2,
        currentSlug: "approval-page",
        currentStage: "build",
        ac: [{ id: "AC-1", text: "user sees pill", status: "pending" }],
        lastSpecialist: null,
        startedAt: "2026-05-07T00:00:00Z",
        reviewIterations: 0,
        securityFlag: false
      }),
      "utf8"
    );
    const state = await readFlowState(project);
    expect(state.schemaVersion).toBe(3);
    expect(state.currentSlug).toBe("approval-page");
    expect(state.triage?.ceremonyMode).toBe("strict");
    expect(state.triage?.complexity).toBe("small-medium");

    const onDisk = JSON.parse(
      await fs.readFile(path.join(project, FLOW_STATE_REL_PATH), "utf8")
    ) as { schemaVersion: number };
    expect(onDisk.schemaVersion).toBe(3);
  });
});
