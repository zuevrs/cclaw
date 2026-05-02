import { Writable } from "node:stream";
import { describe, expect, it } from "vitest";
import { runInternalCommand } from "../../src/internal/advance-stage.js";
import { collectRepoSignals } from "../../src/internal/advance-stage/start-flow.js";
import { ensureRunSystem, readFlowState } from "../../src/runs.js";
import { createTempProject, writeProjectFile } from "../helpers/index.js";

function captureIo(): {
  io: { stdout: Writable; stderr: Writable };
  stdout: () => string;
  stderr: () => string;
} {
  const stdoutChunks: string[] = [];
  const stderrChunks: string[] = [];
  const stdout = new Writable({
    write(chunk, _enc, cb) {
      stdoutChunks.push(chunk.toString());
      cb();
    }
  });
  const stderr = new Writable({
    write(chunk, _enc, cb) {
      stderrChunks.push(chunk.toString());
      cb();
    }
  });
  return {
    io: { stdout, stderr },
    stdout: () => stdoutChunks.join(""),
    stderr: () => stderrChunks.join("")
  };
}

describe("start-flow repoSignals", () => {
  it("persists repoSignals after successful start-flow", async () => {
    const root = await createTempProject("start-flow-repo-signals");
    await ensureRunSystem(root);
    await writeProjectFile(root, "README.md", "# hi\n");
    const cap = captureIo();
    const code = await runInternalCommand(
      root,
      ["start-flow", "--track=standard", "--discovery-mode=guided", "--quiet"],
      cap.io
    );
    expect(code).toBe(0);
    const state = await readFlowState(root);
    expect(state.repoSignals).toBeDefined();
    expect(state.repoSignals?.hasReadme).toBe(true);
    expect(state.repoSignals?.capturedAt).toMatch(/^\d{4}-/u);

    const out = cap.stdout().trim();
    expect(out.split("\n").length).toBe(1);
    const quietPayload = JSON.parse(out) as {
      ok: boolean;
      command: string;
      discoveryMode: string;
      repoSignals?: { hasReadme?: boolean };
    };
    expect(quietPayload.ok).toBe(true);
    expect(quietPayload.command).toBe("start-flow");
    expect(quietPayload.discoveryMode).toBe("guided");
    expect(quietPayload.repoSignals?.hasReadme).toBe(true);
  });

  it("includes repoSignals in start-flow success JSON", async () => {
    const root = await createTempProject("start-flow-stdout-repo-signals");
    await ensureRunSystem(root);
    await writeProjectFile(root, "README.md", "# hi\n");
    const cap = captureIo();
    const code = await runInternalCommand(
      root,
      ["start-flow", "--track=standard", "--discovery-mode=guided"],
      cap.io
    );
    expect(code).toBe(0);
    const stdout = cap.stdout().trim();
    const payloadStart = stdout.indexOf("{");
    expect(payloadStart).toBeGreaterThanOrEqual(0);
    const payload = JSON.parse(stdout.slice(payloadStart)) as {
      ok: boolean;
      command: string;
      repoSignals?: { fileCount: number; hasReadme: boolean };
    };
    expect(payload.ok).toBe(true);
    expect(payload.repoSignals?.hasReadme).toBe(true);
    expect(typeof payload.repoSignals?.fileCount).toBe("number");
  });

  it("collectRepoSignals respects file cap and skips node_modules", async () => {
    const root = await createTempProject("collect-repo-signals");
    await writeProjectFile(root, "a.txt", "1");
    await writeProjectFile(root, "node_modules/x/y", "skip");
    const sig = await collectRepoSignals(root);
    expect(sig.fileCount).toBeLessThanOrEqual(200);
    expect(sig.fileCount).toBeGreaterThanOrEqual(1);
  });
});
