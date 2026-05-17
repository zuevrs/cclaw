import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  SliceWorktreeError,
  cleanupSliceWorktree,
  cleanupSliceWorktreeAsync,
  createSliceWorktree,
  mergeSliceWorktree,
  sliceWorktreeBranch,
  sliceWorktreePath
} from "../../src/slice-worktree.js";
import type { SliceId } from "../../src/types.js";

/**
 * v8.73 — slice-worktree integration test.
 *
 * Exercises the full worktree lifecycle against real git: parent repo
 * is initialised, two parallel slices each get their own sibling
 * worktree, both author commits on disposable branches, the parent
 * fast-forward merges them in topological-layer order, and the
 * cleanup helper drops the worktrees idempotently.
 *
 * Tests run sequentially (not in parallel) because they share the
 * `git` binary against per-test temp dirs and we want each test to
 * own its own merge target. Each test prepares its own parent +
 * cleans up children in afterEach.
 *
 * Skipped automatically when `git` is missing on the executor.
 */

function gitAvailable(): boolean {
  try {
    execFileSync("git", ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

const describeOrSkip = gitAvailable() ? describe : describe.skip;

async function makeRepo(prefix: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), `cclaw-wt-${prefix}-`));
  execFileSync("git", ["init", "--initial-branch=main"], { cwd: dir, stdio: "ignore" });
  execFileSync("git", ["config", "user.email", "cclaw-test@example.com"], { cwd: dir, stdio: "ignore" });
  execFileSync("git", ["config", "user.name", "cclaw test"], { cwd: dir, stdio: "ignore" });
  execFileSync("git", ["config", "commit.gpgsign", "false"], { cwd: dir, stdio: "ignore" });
  await fs.writeFile(path.join(dir, "README.md"), "# parent\n", "utf8");
  execFileSync("git", ["add", "README.md"], { cwd: dir, stdio: "ignore" });
  execFileSync("git", ["commit", "-m", "init"], {
    cwd: dir,
    stdio: "ignore",
    env: { ...process.env, GIT_COMMITTER_DATE: "2026-05-17T00:00:00Z" }
  });
  return dir;
}

describeOrSkip("v8.73 — slice-worktree full lifecycle (integration)", () => {
  const created: string[] = [];

  afterEach(async () => {
    // Tear down any worktree sibling directories that survived test
    // failure so the test runner's temp dir doesn't accumulate orphans.
    while (created.length > 0) {
      const dir = created.pop();
      if (!dir) continue;
      try {
        await fs.rm(dir, { recursive: true, force: true });
      } catch {
        // Best effort — orphan dirs are harmless across test runs.
      }
      // The sibling worktree path (../<base>-SLUG-SL-N) needs the
      // same removal in case `cleanupSliceWorktree` didn't reach it.
      const parent = path.dirname(dir);
      try {
        const entries = await fs.readdir(parent);
        for (const entry of entries) {
          if (entry.startsWith(path.basename(dir) + "-")) {
            await fs.rm(path.join(parent, entry), { recursive: true, force: true });
          }
        }
      } catch {
        // Parent may already be removed; nothing to clean.
      }
    }
  });

  it("creates a sibling worktree on a disposable branch with the cclaw/ namespace", async () => {
    const repo = await makeRepo("create");
    created.push(repo);
    const slug = "v873-test-create";
    const sliceId: SliceId = "SL-1";

    const wt = createSliceWorktree(repo, slug, sliceId);

    expect(wt).toBe(sliceWorktreePath(repo, slug, sliceId));
    expect(existsSync(wt)).toBe(true);
    // The worktree should carry its own .git pointer file (worktrees
    // share the parent's .git/ admin tree but each has a .git file).
    expect(existsSync(path.join(wt, ".git"))).toBe(true);
    // Branch must exist with the disposable namespace.
    const branches = execFileSync("git", ["branch", "--list", "cclaw/*"], {
      cwd: repo,
      encoding: "utf8"
    });
    expect(branches).toContain(sliceWorktreeBranch(slug, sliceId));
  });

  it("refuses to clobber an existing target directory", async () => {
    const repo = await makeRepo("clobber");
    created.push(repo);
    const slug = "v873-test-clobber";
    const sliceId: SliceId = "SL-1";

    createSliceWorktree(repo, slug, sliceId);

    expect(() => createSliceWorktree(repo, slug, sliceId)).toThrow(SliceWorktreeError);
  });

  it("fast-forward merges a slice's commit back into the parent and returns true", async () => {
    const repo = await makeRepo("merge-ok");
    created.push(repo);
    const slug = "v873-test-merge";
    const sliceId: SliceId = "SL-1";

    const wt = createSliceWorktree(repo, slug, sliceId);
    // Author one commit inside the worktree.
    await fs.writeFile(path.join(wt, "slice-1.txt"), "slice-1 work\n", "utf8");
    execFileSync("git", ["add", "slice-1.txt"], { cwd: wt, stdio: "ignore" });
    execFileSync("git", ["commit", "-m", "green(SL-1): slice work"], {
      cwd: wt,
      stdio: "ignore",
      env: { ...process.env, GIT_COMMITTER_DATE: "2026-05-17T01:00:00Z" }
    });

    const ok = mergeSliceWorktree(repo, slug, sliceId);
    expect(ok).toBe(true);
    // Parent HEAD must now contain the slice file.
    expect(existsSync(path.join(repo, "slice-1.txt"))).toBe(true);
  });

  it("returns false when fast-forward is impossible (parent advanced; non-ff merge)", async () => {
    const repo = await makeRepo("merge-fail");
    created.push(repo);
    const slug = "v873-test-merge-fail";
    const sliceId: SliceId = "SL-1";

    const wt = createSliceWorktree(repo, slug, sliceId);
    await fs.writeFile(path.join(wt, "common.txt"), "from slice\n", "utf8");
    execFileSync("git", ["add", "common.txt"], { cwd: wt, stdio: "ignore" });
    execFileSync("git", ["commit", "-m", "green(SL-1): slice"], {
      cwd: wt,
      stdio: "ignore",
      env: { ...process.env, GIT_COMMITTER_DATE: "2026-05-17T01:00:00Z" }
    });

    // Advance the parent on the same file so the worktree branch is
    // no longer a strict ancestor — git will refuse the fast-forward.
    await fs.writeFile(path.join(repo, "common.txt"), "from parent\n", "utf8");
    execFileSync("git", ["add", "common.txt"], { cwd: repo, stdio: "ignore" });
    execFileSync("git", ["commit", "-m", "parent: divergent work"], {
      cwd: repo,
      stdio: "ignore",
      env: { ...process.env, GIT_COMMITTER_DATE: "2026-05-17T02:00:00Z" }
    });

    const ok = mergeSliceWorktree(repo, slug, sliceId);
    expect(ok).toBe(false);
  });

  it("cleans up the worktree directory + the disposable branch idempotently", async () => {
    const repo = await makeRepo("cleanup");
    created.push(repo);
    const slug = "v873-test-cleanup";
    const sliceId: SliceId = "SL-1";
    const wt = createSliceWorktree(repo, slug, sliceId);
    expect(existsSync(wt)).toBe(true);

    cleanupSliceWorktree(repo, slug, sliceId);

    expect(existsSync(wt)).toBe(false);
    const branches = execFileSync("git", ["branch", "--list", "cclaw/*"], {
      cwd: repo,
      encoding: "utf8"
    });
    expect(branches).not.toContain(sliceWorktreeBranch(slug, sliceId));

    // Second call is a no-op (idempotent) — must not throw.
    expect(() => cleanupSliceWorktree(repo, slug, sliceId)).not.toThrow();
  });

  it("async cleanup sweeps stray on-disk debris even if git registry was pruned", async () => {
    const repo = await makeRepo("async-cleanup");
    created.push(repo);
    const slug = "v873-test-async-cleanup";
    const sliceId: SliceId = "SL-2";
    const wt = createSliceWorktree(repo, slug, sliceId);
    expect(existsSync(wt)).toBe(true);

    // Prune the worktree registry behind cleanup's back; the directory
    // remains on disk. Async sweep should still remove it.
    execFileSync("git", ["worktree", "remove", "--force", wt], {
      cwd: repo,
      stdio: "ignore"
    });
    if (!existsSync(wt)) {
      // git removed the dir on prune; recreate one so we exercise the sweep.
      await fs.mkdir(wt, { recursive: true });
      await fs.writeFile(path.join(wt, "stray.txt"), "stray\n", "utf8");
    }

    await cleanupSliceWorktreeAsync(repo, slug, sliceId);

    expect(existsSync(wt)).toBe(false);
  });

  it("full parallel-layer scenario: two slices, two worktrees, sequential fast-forward, then cleanup", async () => {
    const repo = await makeRepo("parallel");
    created.push(repo);
    const slug = "v873-test-parallel";
    const slices: SliceId[] = ["SL-1", "SL-2"];

    // Layer dispatch — parent creates one worktree per slice.
    const worktrees = slices.map((sid) => createSliceWorktree(repo, slug, sid));
    for (const wt of worktrees) expect(existsSync(wt)).toBe(true);

    // Each sub-builder authors a commit on disjoint files (the
    // plan-critic §4b zero-file-overlap guarantee).
    for (let i = 0; i < slices.length; i += 1) {
      const wt = worktrees[i]!;
      const sid = slices[i]!;
      const file = `slice-${i + 1}.txt`;
      await fs.writeFile(path.join(wt, file), `work for ${sid}\n`, "utf8");
      execFileSync("git", ["add", file], { cwd: wt, stdio: "ignore" });
      execFileSync("git", ["commit", "-m", `green(${sid}): work`], {
        cwd: wt,
        stdio: "ignore",
        env: { ...process.env, GIT_COMMITTER_DATE: `2026-05-17T0${i + 1}:00:00Z` }
      });
    }

    // Sequential fast-forward merge in topological-layer order. Each
    // merge must succeed because the slices touched disjoint files.
    for (const sid of slices) {
      const ok = mergeSliceWorktree(repo, slug, sid);
      expect(ok).toBe(true);
    }

    // Parent HEAD must now contain both slice files.
    expect(existsSync(path.join(repo, "slice-1.txt"))).toBe(true);
    expect(existsSync(path.join(repo, "slice-2.txt"))).toBe(true);

    // Ship-side cleanup drops the sibling worktrees.
    for (const sid of slices) {
      await cleanupSliceWorktreeAsync(repo, slug, sid);
    }
    for (const wt of worktrees) expect(existsSync(wt)).toBe(false);
  });

  it("rejects createSliceWorktree on a non-git directory with an informative error", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "cclaw-wt-nogit-"));
    created.push(dir);
    expect(() => createSliceWorktree(dir, "v873-test-nogit", "SL-1")).toThrow(
      /not a git repository/i
    );
  });
});
