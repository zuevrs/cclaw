import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createInitialFlowState } from "../../src/flow-state.js";
import {
  FlowStateGuardMismatchError,
  ensureRunSystem,
  flowStateGuardSidecarPathFor,
  flowStateRepairLogPathFor,
  readFlowState,
  readFlowStateGuarded,
  repairFlowStateGuard,
  writeFlowState,
  writeFlowStateGuarded
} from "../../src/runs.js";
import { createTempProject } from "../helpers/index.js";

describe("flow-state write-guard", () => {
  it("writes a .cclaw/.flow-state.guard.json sidecar on every write", async () => {
    const root = await createTempProject("run-persistence-guard-write");
    await ensureRunSystem(root);
    await writeFlowState(
      root,
      createInitialFlowState({ track: "standard", discoveryMode: "guided" }),
      { allowReset: true }
    );
    const sidecarPath = flowStateGuardSidecarPathFor(root);
    const raw = await fs.readFile(sidecarPath, "utf8");
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    expect(typeof parsed.sha256).toBe("string");
    expect((parsed.sha256 as string).length).toBe(64);
    expect(typeof parsed.writtenAt).toBe("string");
    expect(typeof parsed.writerSubsystem).toBe("string");
    expect(typeof parsed.runId).toBe("string");
  });

  it("round-trips through writeFlowStateGuarded / readFlowStateGuarded", async () => {
    const root = await createTempProject("run-persistence-guard-round-trip");
    await ensureRunSystem(root);
    const state = createInitialFlowState({ track: "standard", discoveryMode: "guided" });
    await writeFlowStateGuarded(root, state, { allowReset: true });
    const loaded = await readFlowStateGuarded(root);
    expect(loaded.activeRunId).toBe(state.activeRunId);
    expect(loaded.track).toBe("standard");
  });

  it("throws FlowStateGuardMismatchError when flow-state.json is edited by hand", async () => {
    const root = await createTempProject("run-persistence-guard-tamper");
    await ensureRunSystem(root);
    await writeFlowState(
      root,
      createInitialFlowState({ track: "standard", discoveryMode: "guided" }),
      { allowReset: true }
    );
    const statePath = path.join(root, ".cclaw", "state", "flow-state.json");
    const raw = await fs.readFile(statePath, "utf8");
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    parsed.currentStage = "plan";
    await fs.writeFile(statePath, `${JSON.stringify(parsed, null, 2)}\n`, "utf8");
    let err: unknown = null;
    try {
      await readFlowStateGuarded(root);
    } catch (caught) {
      err = caught;
    }
    expect(err).toBeInstanceOf(FlowStateGuardMismatchError);
    if (err instanceof FlowStateGuardMismatchError) {
      expect(err.expectedSha).toMatch(/^[a-f0-9]{64}$/u);
      expect(err.actualSha).toMatch(/^[a-f0-9]{64}$/u);
      expect(err.expectedSha).not.toBe(err.actualSha);
      expect(err.repairCommand).toContain("cclaw-cli internal flow-state-repair");
    }
  });

  it("readFlowState ignores the sidecar so existing sanitizer paths keep working", async () => {
    const root = await createTempProject("run-persistence-guard-loose-read");
    await ensureRunSystem(root);
    await writeFlowState(
      root,
      createInitialFlowState({ track: "standard", discoveryMode: "guided" }),
      { allowReset: true }
    );
    const statePath = path.join(root, ".cclaw", "state", "flow-state.json");
    const raw = await fs.readFile(statePath, "utf8");
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    parsed.currentStage = "plan";
    await fs.writeFile(statePath, `${JSON.stringify(parsed, null, 2)}\n`, "utf8");
    const loaded = await readFlowState(root);
    expect(loaded.currentStage).toBe("plan");
  });

  it("reads legacy flow-state.json without a sidecar as valid (legacy mode)", async () => {
    const root = await createTempProject("run-persistence-guard-legacy");
    await ensureRunSystem(root);
    await writeFlowState(
      root,
      createInitialFlowState({ track: "standard", discoveryMode: "guided" }),
      { allowReset: true }
    );
    const sidecarPath = flowStateGuardSidecarPathFor(root);
    await fs.rm(sidecarPath, { force: true });
    const loaded = await readFlowStateGuarded(root);
    expect(loaded.currentStage).toBe("brainstorm");
  });

  it("recovers from manual edits via repairFlowStateGuard and records a repair log", async () => {
    const root = await createTempProject("run-persistence-guard-repair");
    await ensureRunSystem(root);
    await writeFlowState(
      root,
      createInitialFlowState({ track: "standard", discoveryMode: "guided" }),
      { allowReset: true }
    );
    const statePath = path.join(root, ".cclaw", "state", "flow-state.json");
    const raw = await fs.readFile(statePath, "utf8");
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    parsed.currentStage = "plan";
    await fs.writeFile(statePath, `${JSON.stringify(parsed, null, 2)}\n`, "utf8");
    await expect(readFlowStateGuarded(root)).rejects.toBeInstanceOf(
      FlowStateGuardMismatchError
    );
    const result = await repairFlowStateGuard(root, "manual_edit_recovery");
    expect(result.sidecar.sha256).toMatch(/^[a-f0-9]{64}$/u);
    const logRaw = await fs.readFile(flowStateRepairLogPathFor(root), "utf8");
    expect(logRaw).toContain("reason=manual_edit_recovery");
    const loaded = await readFlowStateGuarded(root);
    expect(loaded.currentStage).toBe("plan");
  });

  it("rejects repair without a non-empty reason slug", async () => {
    const root = await createTempProject("run-persistence-guard-repair-reason");
    await ensureRunSystem(root);
    await writeFlowState(
      root,
      createInitialFlowState({ track: "standard", discoveryMode: "guided" }),
      { allowReset: true }
    );
    await expect(repairFlowStateGuard(root, "")).rejects.toThrow(/--reason/u);
    await expect(repairFlowStateGuard(root, "X")).rejects.toThrow(/lowercase slug/u);
    await expect(repairFlowStateGuard(root, "has spaces")).rejects.toThrow(/lowercase slug/u);
  });
});
