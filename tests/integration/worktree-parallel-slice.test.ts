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

describe("worktree parallel slice integration", () => {
  it("commits two slices from isolated worktrees without races", async () => {
    const root = await createTempProject("worktree-parallel-slice");
    await git(root, ["init"]);
    await git(root, ["config", "user.email", "tests@example.com"]);
    await git(root, ["config", "user.name", "Test Runner"]);
    await initCclaw({ projectRoot: root, harnesses: ["claude"] });

    await fs.mkdir(path.join(root, "src"), { recursive: true });
    await fs.writeFile(path.join(root, "src/a.ts"), "export const a = 1;\n", "utf8");
    await fs.writeFile(path.join(root, "src/b.ts"), "export const b = 1;\n", "utf8");
    await git(root, ["add", "."]);
    await git(root, ["commit", "-m", "init"]);

    const wtA = await createSliceWorktree("S-31", "HEAD", ["src/a.ts"], { projectRoot: root });
    const wtB = await createSliceWorktree("S-32", "HEAD", ["src/b.ts"], { projectRoot: root });
    await fs.writeFile(path.join(wtA.path, "src/a.ts"), "export const a = 2;\n", "utf8");
    await fs.writeFile(path.join(wtB.path, "src/b.ts"), "export const b = 2;\n", "utf8");

    const capA = captureIo();
    const exitA = await runSliceCommitCommand(
      root,
      [
        "--json",
        "--slice=S-31",
        "--span-id=span-S-31",
        "--task-id=T-301",
        "--title=update a",
        "--claimed-paths=src/a.ts",
        `--worktree-path=${wtA.path}`
      ],
      capA.io
    );
    expect(exitA, capA.stderr()).toBe(0);

    const capB = captureIo();
    const exitB = await runSliceCommitCommand(
      root,
      [
        "--json",
        "--slice=S-32",
        "--span-id=span-S-32",
        "--task-id=T-302",
        "--title=update b",
        "--claimed-paths=src/b.ts",
        `--worktree-path=${wtB.path}`
      ],
      capB.io
    );
    expect(exitB, capB.stderr()).toBe(0);

    const logSubjects = await git(root, ["log", "-2", "--pretty=%s"]);
    expect(logSubjects).toContain("S-31/T-301:");
    expect(logSubjects).toContain("S-32/T-302:");
    expect(await fs.readFile(path.join(root, "src/a.ts"), "utf8")).toContain("a = 2");
    expect(await fs.readFile(path.join(root, "src/b.ts"), "utf8")).toContain("b = 2");
    expect(await projectPathExists(root, path.relative(root, wtA.path))).toBe(false);
    expect(await projectPathExists(root, path.relative(root, wtB.path))).toBe(false);
  });
});
