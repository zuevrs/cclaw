import { describe, expect, it } from "vitest";
import { stageAutoSubagentDispatch } from "../../src/content/stage-schema.js";
import { ensureProactiveDelegationTrace } from "../../src/internal/advance-stage/proactive-delegation-trace.js";
import { createInitialFlowState } from "../../src/flow-state.js";
import { ensureRunSystem, writeFlowState } from "../../src/runs.js";
import type { DiscoveryMode, FlowStage } from "../../src/types.js";
import { createTempProject } from "../helpers/index.js";

describe("ensureProactiveDelegationTrace across discovery modes", () => {
  it("drops dependsOnInternalRepoSignals from authored dispatch payload", () => {
    expect(JSON.stringify(stageAutoSubagentDispatch("brainstorm"))).not.toContain(
      "dependsOnInternalRepoSignals"
    );
  });

  it("keeps researcher required on sparse whermes-shaped repo for deep brainstorm", async () => {
    const root = await createTempProject("proactive-whermes-deep");
    await ensureRunSystem(root);
    const repoSignals = {
      fileCount: 8,
      hasReadme: false,
      hasPackageManifest: false,
      capturedAt: "2026-05-02T12:00:00.000Z"
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
    expect(r.missingRules.some((rule) => rule.agent === "researcher")).toBe(true);
    expect(r.missingRules.some((rule) => rule.agent === "divergent-thinker")).toBe(true);
  });

  async function researcherMissing(stage: FlowStage, mode: DiscoveryMode) {
    const root = await createTempProject(`proactive-${mode}-${stage}-${Math.random().toString(36).slice(2, 8)}`);
    await ensureRunSystem(root);
    const repoSignals = {
      fileCount: 120,
      hasReadme: true,
      hasPackageManifest: true,
      capturedAt: "2026-05-02T12:01:00.000Z"
    };
    await writeFlowState(
      root,
      { ...createInitialFlowState({ track: "standard", discoveryMode: mode }), repoSignals },
      { allowReset: true }
    );
    const outcome = await ensureProactiveDelegationTrace(root, stage, {
      acceptWaiver: false,
      discoveryMode: mode,
      repoSignals
    });
    expect(outcome.missingRules.some((rule) => rule.agent === "researcher")).toBe(true);
  }

  const earlyStages = ["brainstorm", "scope", "design"] as const;
  const lightModes = ["lean", "guided"] as const;
  for (const mode of lightModes) {
    for (const stage of earlyStages) {
      it(`requires researcher for ${mode} / ${stage}`, async () => {
        await researcherMissing(stage, mode);
      });
    }
  }

  for (const mode of lightModes) {
    it(`${mode}: brainstorm discretionary proactive lenses stay off the mandatory trace list`, async () => {
      const root = await createTempProject(`proactive-light-brain-${mode}`);
      await ensureRunSystem(root);
      const repoSignals = {
        fileCount: 120,
        hasReadme: true,
        hasPackageManifest: false,
        capturedAt: "2026-05-02T12:03:00.000Z"
      };
      await writeFlowState(
        root,
        { ...createInitialFlowState({ track: "standard", discoveryMode: mode }), repoSignals },
        { allowReset: true }
      );
      const r = await ensureProactiveDelegationTrace(root, "brainstorm", {
        acceptWaiver: false,
        discoveryMode: mode,
        repoSignals
      });
      expect(r.missingRules.map((rule) => rule.agent)).toEqual(expect.arrayContaining(["researcher"]));
      expect(r.missingRules.some((rule) => rule.agent === "divergent-thinker")).toBe(false);
    });

    it(`${mode}: design keeps only researcher among proactive checklist entries`, async () => {
      const root = await createTempProject(`proactive-light-design-${mode}`);
      await ensureRunSystem(root);
      await writeFlowState(
        root,
        createInitialFlowState({ track: "standard", discoveryMode: mode }),
        { allowReset: true }
      );
      const r = await ensureProactiveDelegationTrace(root, "design", {
        acceptWaiver: false,
        discoveryMode: mode,
        repoSignals: undefined
      });
      expect(r.missingRules.map((rule) => rule.agent).sort()).toEqual(["researcher"]);
    });
  }
});
