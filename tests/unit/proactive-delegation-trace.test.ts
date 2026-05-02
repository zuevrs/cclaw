import { describe, expect, it } from "vitest";
import { ensureProactiveDelegationTrace } from "../../src/internal/advance-stage/proactive-delegation-trace.js";
import { createInitialFlowState } from "../../src/flow-state.js";
import { ensureRunSystem, writeFlowState } from "../../src/runs.js";
import { createTempProject } from "../helpers/index.js";

describe("ensureProactiveDelegationTrace repoSignals", () => {
  it("skips researcher on sparse brainstorm repo in deep mode", async () => {
    const root = await createTempProject("proactive-sparse-brainstorm");
    await ensureRunSystem(root);
    const repoSignals = {
      fileCount: 2,
      hasReadme: false,
      hasPackageManifest: false,
      capturedAt: "2026-05-01T00:00:00.000Z"
    };
    await writeFlowState(
      root,
      { ...createInitialFlowState({ track: "standard", discoveryMode: "deep" }), repoSignals },
      { allowReset: true }
    );
    const r = await ensureProactiveDelegationTrace(root, "brainstorm", {
      acceptWaiver: false,
      discoveryMode: "deep",
      repoSignals
    });
    expect(r.missingRules.some((x) => x.agent === "researcher")).toBe(false);
  });

  it("keeps researcher requirement on substantive brainstorm repo in deep mode", async () => {
    const root = await createTempProject("proactive-full-brainstorm");
    await ensureRunSystem(root);
    const repoSignals = {
      fileCount: 12,
      hasReadme: true,
      hasPackageManifest: false,
      capturedAt: "2026-05-01T00:00:00.000Z"
    };
    await writeFlowState(
      root,
      { ...createInitialFlowState({ track: "standard", discoveryMode: "deep" }), repoSignals },
      { allowReset: true }
    );
    const r = await ensureProactiveDelegationTrace(root, "brainstorm", {
      acceptWaiver: false,
      discoveryMode: "deep",
      repoSignals
    });
    expect(r.missingRules.some((x) => x.agent === "researcher")).toBe(true);
  });
});
