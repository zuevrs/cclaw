import fs from "node:fs/promises";
import path from "node:path";
import { PassThrough } from "node:stream";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { createDefaultConfig, writeConfig } from "../../src/config.js";
import { runSliceCommitCommand } from "../../src/internal/slice-commit.js";
import { createTempProject } from "../helpers/index.js";

const execFileAsync = promisify(execFile);

async function git(cwd: string, args: string[]): Promise<void> {
  await execFileAsync("git", args, { cwd });
}

function createIoCapture(): {
  stdout: PassThrough;
  stderr: PassThrough;
  readStdout: () => string;
  readStderr: () => string;
} {
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  let out = "";
  let err = "";
  stdout.on("data", (chunk) => {
    out += String(chunk ?? "");
  });
  stderr.on("data", (chunk) => {
    err += String(chunk ?? "");
  });
  return {
    stdout,
    stderr,
    readStdout: () => out,
    readStderr: () => err
  };
}

describe("slice-commit path drift guard", () => {
  it("rejects commit when working tree changes escape claimed paths", async () => {
    const root = await createTempProject("slice-commit-path-drift");
    await writeConfig(root, createDefaultConfig(["claude"]));
    await git(root, ["init"]);
    await git(root, ["config", "user.email", "tests@example.com"]);
    await git(root, ["config", "user.name", "Test Runner"]);

    await fs.mkdir(path.join(root, "src"), { recursive: true });
    await fs.writeFile(path.join(root, "src/claimed.ts"), "export const claimed = 1;\n", "utf8");
    await fs.writeFile(path.join(root, "src/drift.ts"), "export const drift = 1;\n", "utf8");
    await git(root, ["add", "."]);
    await git(root, ["commit", "-m", "init"]);

    await fs.writeFile(path.join(root, "src/claimed.ts"), "export const claimed = 2;\n", "utf8");
    await fs.writeFile(path.join(root, "src/drift.ts"), "export const drift = 2;\n", "utf8");

    const io = createIoCapture();
    const exitCode = await runSliceCommitCommand(
      root,
      [
        "--json",
        "--slice=S-1",
        "--span-id=span-S-1",
        "--task-id=T-1",
        "--claimed-paths=src/claimed.ts"
      ],
      { stdout: io.stdout, stderr: io.stderr }
    );

    expect(exitCode).toBe(2);
    const payload = JSON.parse(io.readStderr().trim()) as {
      errorCode?: string;
      details?: { driftPaths?: string[] };
    };
    expect(payload.errorCode).toBe("slice_commit_path_drift");
    expect(payload.details?.driftPaths ?? []).toContain("src/drift.ts");
  });
});

