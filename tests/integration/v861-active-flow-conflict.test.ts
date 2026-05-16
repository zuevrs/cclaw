import fs from "node:fs/promises";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { initCclaw } from "../../src/install.js";
import { writeFlowState } from "../../src/run-persistence.js";
import { createInitialFlowState } from "../../src/flow-state.js";
import type { FlowStateV82 } from "../../src/flow-state.js";
import { createTempProject, removeProject } from "../helpers/temp-project.js";

/**
 * v8.61 — when a fresh `/cc <task>` is invoked while an active flow is
 * already in flight, the orchestrator MUST surface an error pointing
 * the user at `/cc` (continue) or `/cc-cancel` (discard). No silent
 * re-triage, no auto-cancel, no queueing.
 *
 * The orchestrator dispatches the matrix; this integration test
 * verifies the prerequisite — that `flow-state.json` carries the
 * information the matrix needs to detect an active flow (currentSlug
 * set + currentStage != ship-complete).
 */
describe("v8.61 — active-flow conflict detection (integration prerequisites)", () => {
  let project: string;

  afterEach(async () => {
    if (project) await removeProject(project);
  });

  it("a freshly-initialised project has flow-state.json with currentSlug=null (no active flow)", async () => {
    project = await createTempProject();
    await initCclaw({ cwd: project });
    const statePath = path.join(project, ".cclaw", "state", "flow-state.json");
    const body = await fs.readFile(statePath, "utf8");
    const state = JSON.parse(body) as FlowStateV82;
    expect(state.currentSlug).toBeNull();
    expect(state.currentStage).toBeNull();
  });

  it("a project with an in-flight slug has currentSlug set AND currentStage != ship-complete", async () => {
    project = await createTempProject();
    await initCclaw({ cwd: project });
    const state = createInitialFlowState("2026-05-15T00:00:00Z");
    state.currentSlug = "20260515-auth-cleanup";
    state.currentStage = "review";
    state.lastSpecialist = "reviewer";
    state.triage = {
      complexity: "small-medium",
      ceremonyMode: "soft",
      path: ["plan", "build", "review", "critic", "ship"],
      rationale: "test setup",
      decidedAt: "2026-05-15T00:00:00Z",
      userOverrode: false,
      runMode: "auto",
      mode: "task"
    };
    await writeFlowState(project, state);
    const statePath = path.join(project, ".cclaw", "state", "flow-state.json");
    const body = await fs.readFile(statePath, "utf8");
    const persisted = JSON.parse(body) as FlowStateV82;
    expect(persisted.currentSlug).toBe("20260515-auth-cleanup");
    expect(persisted.currentStage).toBe("review");
    expect(persisted.currentStage).not.toBe("ship-complete");
  });

  it("a freshly-finalised slug has currentSlug=null (finalize resets the state; matrix treats as no-active-flow)", async () => {
    project = await createTempProject();
    await initCclaw({ cwd: project });
    const state = createInitialFlowState("2026-05-15T00:00:00Z");
    state.currentSlug = null;
    state.currentStage = null;
    await writeFlowState(project, state);
    const statePath = path.join(project, ".cclaw", "state", "flow-state.json");
    const body = await fs.readFile(statePath, "utf8");
    const persisted = JSON.parse(body) as FlowStateV82;
    expect(persisted.currentSlug).toBeNull();
    expect(persisted.currentStage).toBeNull();
  });

  it("the active-flow detection rule is documented in the orchestrator body", async () => {
    const { START_COMMAND_BODY } = await import("../../src/content/start-command.js");
    expect(START_COMMAND_BODY).toMatch(/currentSlug != null/u);
    expect(START_COMMAND_BODY).toMatch(/Active flow:/u);
    expect(START_COMMAND_BODY).toMatch(/Continue with `?\/cc`?/u);
    expect(START_COMMAND_BODY).toMatch(/Cancel with `?\/cc-cancel`?/u);
  });
});
