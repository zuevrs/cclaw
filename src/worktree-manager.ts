import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { DEFAULT_TDD_WORKTREE_ROOT } from "./config.js";
import { exists } from "./fs-utils.js";

const execFileAsync = promisify(execFile);

export interface WorktreeManagerOptions {
  projectRoot?: string;
  worktreeRoot?: string;
}

export class WorktreeUnsupportedError extends Error {
  readonly code = "worktree_unavailable";

  constructor(message: string) {
    super(message);
    this.name = "WorktreeUnsupportedError";
  }
}

export class WorktreeMergeConflictError extends Error {
  readonly code = "worktree_merge_conflict";

  constructor(message: string) {
    super(message);
    this.name = "WorktreeMergeConflictError";
  }
}

function sanitizeSliceId(sliceId: string): string {
  return sliceId.trim().replace(/[^A-Za-z0-9._-]+/gu, "-");
}

function resolveProjectRoot(options?: WorktreeManagerOptions): string {
  return options?.projectRoot ?? process.cwd();
}

function resolveWorktreeRoot(projectRoot: string, options?: WorktreeManagerOptions): string {
  const root = typeof options?.worktreeRoot === "string" && options.worktreeRoot.trim().length > 0
    ? options.worktreeRoot.trim()
    : DEFAULT_TDD_WORKTREE_ROOT;
  return path.resolve(projectRoot, root);
}

async function resolveMainRepoRootFromWorktree(worktreePath: string): Promise<string> {
  const { stdout } = await execFileAsync(
    "git",
    ["rev-parse", "--path-format=absolute", "--git-common-dir"],
    { cwd: worktreePath }
  );
  const commonDir = stdout.trim();
  if (commonDir.length === 0) {
    throw new Error(`Cannot resolve git common-dir from worktree ${worktreePath}`);
  }
  return path.dirname(commonDir);
}

export async function createSliceWorktree(
  sliceId: string,
  baseRef: string,
  _claimedPaths: string[],
  options: WorktreeManagerOptions = {}
): Promise<{ path: string; ref: string }> {
  const projectRoot = resolveProjectRoot(options);
  const ref = baseRef.trim().length > 0 ? baseRef.trim() : "HEAD";
  const worktreeRoot = resolveWorktreeRoot(projectRoot, options);
  const safeSliceId = sanitizeSliceId(sliceId);
  if (safeSliceId.length === 0) {
    throw new WorktreeUnsupportedError("Cannot create worktree: empty slice id.");
  }
  const worktreePath = path.join(worktreeRoot, safeSliceId);

  try {
    await execFileAsync("git", ["rev-parse", "--git-dir"], { cwd: projectRoot });
  } catch {
    throw new WorktreeUnsupportedError("Cannot create worktree: repository has no .git metadata.");
  }

  await fs.mkdir(worktreeRoot, { recursive: true });
  if (await exists(worktreePath)) {
    if (await exists(path.join(worktreePath, ".git"))) {
      return { path: worktreePath, ref };
    }
    await fs.rm(worktreePath, { recursive: true, force: true });
  }

  try {
    await execFileAsync("git", ["worktree", "add", "--detach", worktreePath, ref], {
      cwd: projectRoot
    });
  } catch (error) {
    throw new WorktreeUnsupportedError(
      `Cannot create worktree for ${sliceId}: ${error instanceof Error ? error.message : String(error)}`
    );
  }
  return { path: worktreePath, ref };
}

export async function commitAndMergeBack(
  worktreePath: string,
  _message: string,
  options: WorktreeManagerOptions = {}
): Promise<{ commitSha: string }> {
  const projectRoot = options.projectRoot ?? await resolveMainRepoRootFromWorktree(worktreePath);
  try {
    const { stdout: mainHeadStdout } = await execFileAsync("git", ["rev-parse", "HEAD"], {
      cwd: projectRoot
    });
    const mainHead = mainHeadStdout.trim();
    await execFileAsync("git", ["rebase", mainHead], { cwd: worktreePath });
    const { stdout } = await execFileAsync("git", ["rev-parse", "HEAD"], { cwd: worktreePath });
    const commitSha = stdout.trim();
    await execFileAsync("git", ["fetch", worktreePath, "HEAD"], { cwd: projectRoot });
    await execFileAsync("git", ["merge", "--ff-only", "FETCH_HEAD"], { cwd: projectRoot });
    return { commitSha };
  } catch (error) {
    throw new WorktreeMergeConflictError(
      `worktree_merge_conflict: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

export async function cleanupWorktree(
  worktreePath: string,
  options: WorktreeManagerOptions = {}
): Promise<void> {
  if (!(await exists(worktreePath))) return;
  const projectRoot = options.projectRoot ?? await resolveMainRepoRootFromWorktree(worktreePath).catch(
    () => null
  );
  if (projectRoot) {
    try {
      await execFileAsync("git", ["worktree", "remove", "--force", worktreePath], {
        cwd: projectRoot
      });
      return;
    } catch {
      // fall through to rm fallback below
    }
  }
  await fs.rm(worktreePath, { recursive: true, force: true });
}
