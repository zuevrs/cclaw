import fs from "node:fs/promises";
import path from "node:path";
import { Writable } from "node:stream";
import { describe, expect, it } from "vitest";
import { initCclaw } from "../../src/install.js";
import { runInternalCommand } from "../../src/internal/advance-stage.js";
import {
  createTempProject,
  writeProjectFile
} from "../helpers/index.js";

interface CapturedIo {
  io: { stdout: Writable; stderr: Writable };
  stdout: () => string;
  stderr: () => string;
}

function captureIo(): CapturedIo {
  const stdoutChunks: string[] = [];
  const stderrChunks: string[] = [];
  const stdout = new Writable({
    write(chunk, _encoding, callback) {
      stdoutChunks.push(chunk.toString());
      callback();
    }
  });
  const stderr = new Writable({
    write(chunk, _encoding, callback) {
      stderrChunks.push(chunk.toString());
      callback();
    }
  });
  return {
    io: { stdout, stderr },
    stdout: () => stdoutChunks.join(""),
    stderr: () => stderrChunks.join("")
  };
}

function parseReport(stdout: string): {
  ok: boolean;
  findings: Array<{ id: string; ok: boolean }>;
  summary: { errors: number; warnings: number };
} {
  return JSON.parse(stdout) as {
    ok: boolean;
    findings: Array<{ id: string; ok: boolean }>;
    summary: { errors: number; warnings: number };
  };
}

describe("cclaw internal runtime-integrity", () => {
  it("returns ok for a healthy runtime", async () => {
    const root = await createTempProject("internal-runtime-integrity-healthy");
    await initCclaw({ projectRoot: root, harnesses: ["claude"] });
    const captured = captureIo();

    const exit = await runInternalCommand(root, ["runtime-integrity", "--json"], captured.io);
    const report = parseReport(captured.stdout());

    expect(exit).toBe(0);
    expect(report.ok).toBe(true);
    expect(report.summary.errors).toBe(0);
  });

  it("fails when managed-resources manifest is malformed", async () => {
    const root = await createTempProject("internal-runtime-integrity-manifest");
    await initCclaw({ projectRoot: root, harnesses: ["claude"] });
    await writeProjectFile(root, ".cclaw/state/managed-resources.json", "{ malformed");
    const captured = captureIo();

    const exit = await runInternalCommand(root, ["runtime-integrity", "--json"], captured.io);
    const report = parseReport(captured.stdout());

    expect(exit).toBe(1);
    const finding = report.findings.find((item) => item.id === "managed_manifest");
    expect(finding?.ok).toBe(false);
  });

  it("fails when a required harness shim is missing", async () => {
    const root = await createTempProject("internal-runtime-integrity-shim");
    await initCclaw({ projectRoot: root, harnesses: ["claude"] });
    await fs.rm(path.join(root, ".claude/commands/cc.md"), { force: true });
    const captured = captureIo();

    const exit = await runInternalCommand(root, ["runtime-integrity", "--json"], captured.io);
    const report = parseReport(captured.stdout());

    expect(exit).toBe(1);
    const finding = report.findings.find((item) => item.id === "shim_drift_claude");
    expect(finding?.ok).toBe(false);
  });

  it("fails when hook document schema is broken", async () => {
    const root = await createTempProject("internal-runtime-integrity-hook");
    await initCclaw({ projectRoot: root, harnesses: ["claude"] });
    await writeProjectFile(
      root,
      ".claude/hooks/hooks.json",
      `${JSON.stringify({
        cclawHookSchemaVersion: 1,
        hooks: {}
      }, null, 2)}\n`
    );
    const captured = captureIo();

    const exit = await runInternalCommand(root, ["runtime-integrity", "--json"], captured.io);
    const report = parseReport(captured.stdout());

    expect(exit).toBe(1);
    const finding = report.findings.find((item) => item.id === "hook_document_claude");
    expect(finding?.ok).toBe(false);
  });

  it("fails when flow-state is corrupt", async () => {
    const root = await createTempProject("internal-runtime-integrity-flow-state");
    await initCclaw({ projectRoot: root, harnesses: ["claude"] });
    await writeProjectFile(root, ".cclaw/state/flow-state.json", "{ not-json");
    const captured = captureIo();

    const exit = await runInternalCommand(root, ["runtime-integrity", "--json"], captured.io);
    const report = parseReport(captured.stdout());

    expect(exit).toBe(1);
    const finding = report.findings.find((item) => item.id === "flow_state");
    expect(finding?.ok).toBe(false);
  });

});
