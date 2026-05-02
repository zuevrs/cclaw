import fs from "node:fs/promises";
import path from "node:path";
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { createInitialFlowState } from "../../src/flow-state.js";
import { runInternalCommand } from "../../src/internal/advance-stage.js";
import {
  ensureRunSystem,
  flowStateGuardSidecarPathFor,
  flowStateRepairLogPathFor,
  readFlowState,
  writeFlowState
} from "../../src/runs.js";
import { createTempProject } from "../helpers/index.js";

async function runCli(root: string, argv: string[]): Promise<{
  code: number;
  stdout: string;
  stderr: string;
}> {
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  let stdoutBuf = "";
  let stderrBuf = "";
  stdout.on("data", (chunk: Buffer) => {
    stdoutBuf += chunk.toString("utf8");
  });
  stderr.on("data", (chunk: Buffer) => {
    stderrBuf += chunk.toString("utf8");
  });
  const code = await runInternalCommand(root, argv, { stdout, stderr });
  return { code, stdout: stdoutBuf, stderr: stderrBuf };
}

describe("cclaw internal flow-state-repair", () => {
  it("fails when --reason is missing", async () => {
    const root = await createTempProject("flow-state-repair-missing-reason");
    await ensureRunSystem(root);
    const { code, stderr } = await runCli(root, ["flow-state-repair"]);
    expect(code).toBe(1);
    expect(stderr).toMatch(/requires --reason/u);
  });

  it("recomputes sidecar and appends repair log with a valid reason", async () => {
    const root = await createTempProject("flow-state-repair-happy");
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
    const { code, stdout } = await runCli(root, [
      "flow-state-repair",
      "--reason=manual_edit_recovery",
      "--json"
    ]);
    expect(code).toBe(0);
    expect(stdout).toContain("flow-state-repair");
    const sidecarRaw = await fs.readFile(flowStateGuardSidecarPathFor(root), "utf8");
    const sidecar = JSON.parse(sidecarRaw) as Record<string, unknown>;
    expect(typeof sidecar.sha256).toBe("string");
    const logRaw = await fs.readFile(flowStateRepairLogPathFor(root), "utf8");
    expect(logRaw).toContain("reason=manual_edit_recovery");
    const loaded = await readFlowState(root);
    expect(loaded.currentStage).toBe("plan");
  });
});
