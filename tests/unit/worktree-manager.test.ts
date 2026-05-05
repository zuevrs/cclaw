import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import {
  cleanupWorktree,
  commitAndMergeBack,
  createSliceWorktree,
  WorktreeMergeConflictError
} from "../../src/worktree-manager.js";
import { createTempProject, projectPathExists } from "../helpers/index.js";

const execFileAsync = promisify(execFile);

async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", args, { cwd });
  return stdout.trim();
}

async function setupRepo(tag: string): Promise<string> {
  const root = await createTempProject(tag);
  await git(root, ["init"]);
  await git(root, ["config", "user.email", "tests@example.com"]);
  await git(root, ["config", "user.name", "Test Runner"]);
  await fs.mkdir(path.join(root, "src"), { recursive: true });
  await fs.writeFile(path.join(root, "src/main.ts"), "export const value = 1;\n", "utf8");
  await git(root, ["add", "."]);
  await git(root, ["commit", "-m", "init"]);
  return root;
}

describe("worktree manager", () => {
  it("creates and removes a slice worktree", async () => {
    const root = await setupRepo("worktree-manager-create");
    const created = await createSliceWorktree("S-11", "HEAD", ["src/main.ts"], {
      projectRoot: root
    });
    expect(created.ref).toBe("HEAD");
    expect(await projectPathExists(root, path.relative(root, created.path))).toBe(true);
    await cleanupWorktree(created.path, { projectRoot: root });
    expect(await projectPathExists(root, path.relative(root, created.path))).toBe(false);
  });

  it("fast-forward merges a worktree commit back to main", async () => {
    const root = await setupRepo("worktree-manager-merge");
    const created = await createSliceWorktree("S-12", "HEAD", ["src/main.ts"], {
      projectRoot: root
    });
    await fs.writeFile(path.join(created.path, "src/main.ts"), "export const value = 2;\n", "utf8");
    await git(created.path, ["add", "src/main.ts"]);
    await git(created.path, ["commit", "-m", "S-12/T-001: update main"]);
    const headBefore = await git(created.path, ["rev-parse", "HEAD"]);

    const merged = await commitAndMergeBack(created.path, "merge", { projectRoot: root });
    expect(merged.commitSha).toBe(headBefore);
    expect(await fs.readFile(path.join(root, "src/main.ts"), "utf8")).toContain("value = 2");
    await cleanupWorktree(created.path, { projectRoot: root });
  });

  it("throws worktree_merge_conflict when merge-back is not fast-forward", async () => {
    const root = await setupRepo("worktree-manager-conflict");
    const wtA = await createSliceWorktree("S-21", "HEAD", ["src/main.ts"], { projectRoot: root });
    const wtB = await createSliceWorktree("S-22", "HEAD", ["src/main.ts"], { projectRoot: root });

    await fs.writeFile(path.join(wtA.path, "src/main.ts"), "export const value = 21;\n", "utf8");
    await git(wtA.path, ["add", "src/main.ts"]);
    await git(wtA.path, ["commit", "-m", "S-21/T-021: update main"]);

    await fs.writeFile(path.join(wtB.path, "src/main.ts"), "export const value = 22;\n", "utf8");
    await git(wtB.path, ["add", "src/main.ts"]);
    await git(wtB.path, ["commit", "-m", "S-22/T-022: update main"]);

    await commitAndMergeBack(wtA.path, "merge", { projectRoot: root });
    await expect(commitAndMergeBack(wtB.path, "merge", { projectRoot: root })).rejects.toBeInstanceOf(
      WorktreeMergeConflictError
    );
  });
});
