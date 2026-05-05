import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { Writable } from "node:stream";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { initCclaw } from "../../src/install.js";
import { runSliceCommitCommand } from "../../src/internal/slice-commit.js";
import { createSliceWorktree } from "../../src/worktree-manager.js";
import { createTempProject, projectPathExists } from "../helpers/index.js";

const execFileAsync = promisify(execFile);

async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", args, { cwd });
  return stdout.trim();
}

function captureIo() {
  const out: string[] = [];
  const err: string[] = [];
  const stdout = new Writable({
    write(chunk, _enc, cb) {
      out.push(String(chunk));
      cb();
    }
  });
  const stderr = new Writable({
    write(chunk, _enc, cb) {
      err.push(String(chunk));
      cb();
    }
  });
  return {
    io: { stdout, stderr },
    stdout: () => out.join(""),
    stderr: () => err.join("")
  };
}

describe("worktree merge conflict integration", () => {
  it("reports worktree_merge_conflict and preserves failing worktree", async () => {
    const root = await createTempProject("worktree-merge-conflict");
    await git(root, ["init"]);
    await git(root, ["config", "user.email", "tests@example.com"]);
    await git(root, ["config", "user.name", "Test Runner"]);
    await initCclaw({ projectRoot: root, harnesses: ["claude"] });

    await fs.mkdir(path.join(root, "src"), { recursive: true });
    await fs.writeFile(path.join(root, "src/shared.ts"), "export const shared = 1;\n", "utf8");
    await git(root, ["add", "."]);
    await git(root, ["commit", "-m", "init"]);

    const wtA = await createSliceWorktree("S-41", "HEAD", ["src/shared.ts"], { projectRoot: root });
    const wtB = await createSliceWorktree("S-42", "HEAD", ["src/shared.ts"], { projectRoot: root });
    await fs.writeFile(path.join(wtA.path, "src/shared.ts"), "export const shared = 41;\n", "utf8");
    await fs.writeFile(path.join(wtB.path, "src/shared.ts"), "export const shared = 42;\n", "utf8");

    const first = captureIo();
    const firstExit = await runSliceCommitCommand(
      root,
      [
        "--json",
        "--slice=S-41",
        "--span-id=span-S-41",
        "--task-id=T-401",
        "--title=update shared",
        "--claimed-paths=src/shared.ts",
        `--worktree-path=${wtA.path}`
      ],
      first.io
    );
    expect(firstExit, first.stderr()).toBe(0);

    const second = captureIo();
    const secondExit = await runSliceCommitCommand(
      root,
      [
        "--json",
        "--slice=S-42",
        "--span-id=span-S-42",
        "--task-id=T-402",
        "--title=update shared",
        "--claimed-paths=src/shared.ts",
        `--worktree-path=${wtB.path}`
      ],
      second.io
    );
    expect(secondExit).toBe(2);
    expect(second.stderr()).toContain("worktree_merge_conflict");
    expect(await projectPathExists(root, path.relative(root, wtB.path))).toBe(true);
    expect(await fs.readFile(path.join(root, "src/shared.ts"), "utf8")).toContain("shared = 41");
  });
});
