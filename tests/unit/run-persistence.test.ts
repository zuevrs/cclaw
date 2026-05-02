import { describe, expect, it } from "vitest";
import { createInitialFlowState } from "../../src/flow-state.js";
import { ensureRunSystem, readFlowState, writeFlowState } from "../../src/runs.js";
import { createTempProject } from "../helpers/index.js";

describe("flow-state persistence (repoSignals)", () => {
  it("round-trips repoSignals", async () => {
    const root = await createTempProject("run-persistence-repo-signals");
    await ensureRunSystem(root);
    const rs = {
      fileCount: 4,
      hasReadme: true,
      hasPackageManifest: false,
      capturedAt: "2026-05-01T12:00:00.000Z"
    };
    await writeFlowState(
      root,
      { ...createInitialFlowState({ track: "standard", discoveryMode: "guided" }), repoSignals: rs },
      { allowReset: true }
    );
    const state = await readFlowState(root);
    expect(state.repoSignals).toEqual(rs);
  });

  it("treats omitted repoSignals as undefined", async () => {
    const root = await createTempProject("run-persistence-no-repo-signals");
    await ensureRunSystem(root);
    await writeFlowState(root, createInitialFlowState({ track: "standard" }), { allowReset: true });
    const state = await readFlowState(root);
    expect(state.repoSignals).toBeUndefined();
  });
});
