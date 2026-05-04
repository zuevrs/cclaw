import type { Dirent } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { exists } from "./fs-utils.js";
import type { GitBaseRef, WorktreeLaneId } from "./worktree-types.js";

const execFileAsync = promisify(execFile);

const WORKTREES_SEG = ".cclaw/worktrees";
const LANE_BRANCH_PREFIX = "cclaw/lane/";

export interface CreateLaneOptions {
  /** Repository root that owns `.cclaw/`. */
  projectRoot: string;
  /** TDD slice id (e.g. `S-7`). */
  sliceId: string;
  /** Git ref to create the worktree from (e.g. `HEAD`, branch name). */
  baseRef: GitBaseRef;
}

export interface CreateLaneResult {
  laneId: WorktreeLaneId;
  workdir: string;
  branchName: string;
}

function sanitizeSliceId(sliceId: string): string {
  return sliceId.replace(/[^A-Za-z0-9_-]/gu, "");
}

function safeLaneSuffix(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

/**
 * Create a dedicated git worktree for a slice under `.cclaw/worktrees/`.
 * Uses branch namespace `cclaw/lane/<sliceId>-<suffix>`. Does not commit.
 */
export async function createLane(options: CreateLaneOptions): Promise<CreateLaneResult> {
  const { projectRoot, sliceId, baseRef } = options;
  const slug = sanitizeSliceId(sliceId);
  const laneId = `lane-${slug}-${safeLaneSuffix()}`;
  const worktreesRoot = path.join(projectRoot, WORKTREES_SEG);
  await fs.mkdir(worktreesRoot, { recursive: true });
  const workdir = path.join(worktreesRoot, laneId);
  const branchName = `${LANE_BRANCH_PREFIX}${slug}-${safeLaneSuffix()}`;
  await execFileAsync(
    "git",
    ["worktree", "add", "-b", branchName, workdir, baseRef],
    { cwd: projectRoot }
  );
  return { laneId, workdir, branchName };
}

/**
 * Assert the lane worktree exists, has a clean working tree, and matches
 * the expected baseline ref (merge-base check with `baseRef`).
 */
export async function verifyLaneClean(
  projectRoot: string,
  laneId: WorktreeLaneId,
  baseRef: GitBaseRef
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const workdir = path.join(projectRoot, WORKTREES_SEG, laneId);
  if (!(await exists(workdir))) {
    return { ok: false, reason: `lane workdir missing: ${workdir}` };
  }
  try {
    const { stdout: status } = await execFileAsync(
      "git",
      ["status", "--porcelain"],
      { cwd: workdir }
    );
    if (status.trim().length > 0) {
      return { ok: false, reason: "lane working tree is dirty" };
    }
    await execFileAsync("git", ["merge-base", "--is-ancestor", baseRef, "HEAD"], { cwd: workdir });
  } catch (err) {
    return {
      ok: false,
      reason: err instanceof Error ? err.message : String(err)
    };
  }
  return { ok: true };
}

/**
 * Prepare the lane for interactive work (no-op placeholder for harness parity).
 */
export async function attachLane(_laneId: WorktreeLaneId): Promise<void> {
  // Intentionally minimal: callers use workdir from createLane.
}

/**
 * Release local harness attachment (no-op).
 */
export async function detachLane(_laneId: WorktreeLaneId): Promise<void> {}

/**
 * Remove the worktree directory and prune git metadata.
 */
export async function cleanupLane(
  projectRoot: string,
  laneId: WorktreeLaneId,
  options: { force?: boolean } = {}
): Promise<void> {
  const workdir = path.join(projectRoot, WORKTREES_SEG, laneId);
  if (!(await exists(workdir))) return;
  const insideSubmodules = await hasSubmoduleAtPath(projectRoot, workdir);
  if (insideSubmodules && !options.force) {
    throw new Error(
      "cleanupLane: path appears inside a git submodule; pass { force: true } after manual review."
    );
  }
  await execFileAsync("git", ["worktree", "remove", "--force", workdir], {
    cwd: projectRoot
  }).catch(() =>
    execFileAsync("git", ["worktree", "remove", workdir], { cwd: projectRoot })
  );
  await fs.rm(workdir, { recursive: true, force: true });
  await execFileAsync("git", ["worktree", "prune"], { cwd: projectRoot }).catch(() => undefined);
}

async function hasSubmoduleAtPath(projectRoot: string, targetPath: string): Promise<boolean> {
  try {
    const { stdout } = await execFileAsync("git", ["submodule", "status"], { cwd: projectRoot });
    if (!stdout.trim()) return false;
    // Conservative: if targetPath is under any registered submodule worktree, refuse.
    const absTarget = path.resolve(targetPath);
    const entries = stdout.split("\n").map((l) => l.trim()).filter(Boolean);
    for (const line of entries) {
      const parts = line.split(/\s+/u);
      const subPath = parts[1];
      if (!subPath) continue;
      const absSub = path.resolve(projectRoot, subPath);
      if (absTarget === absSub || absTarget.startsWith(`${absSub}${path.sep}`)) {
        return true;
      }
    }
  } catch {
    return false;
  }
  return false;
}

export interface PruneStaleLanesOptions {
  olderThanHours: number;
}

/**
 * Remove lane worktrees older than the threshold based on directory mtime.
 */
export async function pruneStaleLanes(
  projectRoot: string,
  options: PruneStaleLanesOptions
): Promise<string[]> {
  const worktreesRoot = path.join(projectRoot, WORKTREES_SEG);
  if (!(await exists(worktreesRoot))) return [];
  const cutoff = Date.now() - options.olderThanHours * 3600 * 1000;
  const removed: string[] = [];
  let dirents: Dirent[] = [];
  try {
    dirents = await fs.readdir(worktreesRoot, { withFileTypes: true });
  } catch {
    return removed;
  }
  for (const ent of dirents) {
    if (!ent.isDirectory()) continue;
    if (!ent.name.startsWith("lane-")) continue;
    const abs = path.join(worktreesRoot, ent.name);
    const st = await fs.stat(abs).catch(() => null);
    if (!st) continue;
    if (st.mtimeMs < cutoff) {
      await cleanupLane(projectRoot, ent.name, { force: false });
      removed.push(ent.name);
    }
  }
  return removed;
}
