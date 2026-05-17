/**
 * Worktree-isolated parallel slices — git-worktree lifecycle helpers.
 *
 * Encapsulates the git-worktree lifecycle the builder uses when
 * dispatching a topological layer of ≥2 independent slices in
 * parallel. Each sub-builder works inside its own worktree on a
 * disposable branch (`cclaw/<slug>-<sliceId>`) so concurrent
 * TDD cycles can never collide on the same working tree state.
 *
 * The pre-v8.73 builder ran independent-layer slices in PARALLEL but
 * inside the **shared** working tree (v8.64 topological-layer dispatch).
 * That was safe only because the upstream plan-critic §4b
 * independence-mismatch gate already required zero file overlap; in
 * practice partial overlaps still slipped through (the gate's check
 * was prose-only) and triggered ad-hoc merge conflicts the builder
 * was not equipped to handle. v8.73 promotes the legacy
 * `topology: parallel-build` worktree shape into the default for
 * every multi-slice independent layer and tightens plan-critic §4b
 * to explicitly require zero-file-overlap evidence as the
 * independence claim's only acceptable proof.
 *
 * This module is intentionally a thin wrapper around the `git
 * worktree` CLI: the three helpers each shell out via
 * `execFileSync` and return strings / booleans the orchestrator and
 * the integration test exercise end-to-end. We do NOT attempt to
 * reimplement git's locking, merge, or branch semantics — failure
 * cases (worktree already exists, dirty working tree, merge
 * conflict, missing branch) bubble up as thrown errors with
 * informative messages so the builder can route a `BLOCKED` status
 * back through the v8.68 always-auto failure matrix.
 *
 * Escalation: if a future platform (Windows path handling,
 * filesystems without symlink support, network-mounted projectRoot)
 * requires platform-specific shims, surface to the user and stop —
 * the v8.73 brief calls out platform shims as the only stop trigger.
 */

import { execFileSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";

import { exists } from "./fs-utils.js";
import type { SliceId } from "./types.js";

/**
 * Compute the sibling-directory path the builder uses for a slice's
 * worktree. The shape is `../<projectName>-<slug>-<sliceId>` so the
 * paths line up with cclaw's own worktree convention (`../cclaw-v873`
 * etc.) — sibling to the project root, not inside `.cclaw/` so they
 * never accidentally land under the slug's artifact tree.
 *
 * Pure function so callers (orchestrator prose, tests, the integration
 * runner) can compute the expected path without touching the
 * filesystem.
 */
export function sliceWorktreePath(
  projectRoot: string,
  slug: string,
  sliceId: SliceId
): string {
  const parent = path.dirname(projectRoot);
  const base = path.basename(projectRoot);
  return path.join(parent, `${base}-${slug}-${sliceId}`);
}

/**
 * Branch name the sub-builder commits onto inside the worktree.
 * Namespaced under `cclaw/` so a future `git branch --list 'cclaw/*'`
 * sweep can identify orphan slice branches a cancelled flow left
 * behind.
 */
export function sliceWorktreeBranch(slug: string, sliceId: SliceId): string {
  return `cclaw/${slug}-${sliceId}`;
}

function runGit(
  projectRoot: string,
  args: readonly string[]
): { stdout: string; stderr: string } {
  try {
    const stdout = execFileSync("git", args, {
      cwd: projectRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"]
    });
    return { stdout, stderr: "" };
  } catch (err) {
    const e = err as { stdout?: Buffer | string; stderr?: Buffer | string; message?: string };
    const stderr =
      typeof e.stderr === "string"
        ? e.stderr
        : e.stderr instanceof Buffer
          ? e.stderr.toString("utf8")
          : "";
    const stdout =
      typeof e.stdout === "string"
        ? e.stdout
        : e.stdout instanceof Buffer
          ? e.stdout.toString("utf8")
          : "";
    throw new SliceWorktreeError(
      `git ${args.join(" ")} failed: ${stderr.trim() || e.message || "unknown error"}`,
      { stdout, stderr }
    );
  }
}

/** Error thrown by every helper; carries best-effort git output. */
export class SliceWorktreeError extends Error {
  constructor(
    message: string,
    public readonly detail?: { stdout: string; stderr: string }
  ) {
    super(message);
    this.name = "SliceWorktreeError";
  }
}

/**
 * Create a sibling git worktree for `sliceId` rooted at
 * {@link sliceWorktreePath}. The worktree checks out a fresh branch
 * `cclaw/<slug>-<sliceId>` derived from the current HEAD of
 * `projectRoot` so sub-builders never race on the same working tree
 * state.
 *
 * Returns the absolute path to the worktree directory.
 *
 * Failure modes (each throws {@link SliceWorktreeError}):
 *
 * - `projectRoot` is not a git repository (`.git/` missing).
 * - The target directory already exists with arbitrary content. The
 *   helper refuses to clobber an existing tree — the caller must
 *   call {@link cleanupSliceWorktree} first when retrying after a
 *   failed run.
 * - `git worktree add` returns non-zero (dirty working tree, branch
 *   name collision, locked worktree, etc.).
 */
export function createSliceWorktree(
  projectRoot: string,
  slug: string,
  sliceId: SliceId
): string {
  if (!existsSync(path.join(projectRoot, ".git"))) {
    throw new SliceWorktreeError(
      `createSliceWorktree: ${projectRoot} is not a git repository (.git/ missing)`
    );
  }
  const target = sliceWorktreePath(projectRoot, slug, sliceId);
  if (existsSync(target)) {
    throw new SliceWorktreeError(
      `createSliceWorktree: target directory already exists at ${target}; call cleanupSliceWorktree first`
    );
  }
  const branch = sliceWorktreeBranch(slug, sliceId);
  runGit(projectRoot, ["worktree", "add", "-B", branch, target, "HEAD"]);
  return target;
}

/**
 * Fast-forward merge the sliceId's worktree branch back into the
 * parent's current branch. Returns `true` when the merge landed
 * cleanly and `false` when git refused the fast-forward (the slice's
 * commits could not replay on top of the parent's HEAD — typically a
 * real conflict caused by overlapping `Surface` columns the
 * plan-critic gate missed). The caller is the builder; on `false`
 * it emits a `BLOCKED` status with the slice id in the Notes line
 * and stamps `slice_merge_failures` on `flow-state.json` so the
 * orchestrator's always-auto matrix routes the slug to the v8.68
 * stop-and-report surface.
 *
 * `parentPath` is the merge target's project root (usually the same
 * value as the `projectRoot` passed to {@link createSliceWorktree};
 * accepted as an explicit argument because the builder may dispatch
 * the merge from a different cwd — e.g. an orchestrator-level
 * cleanup hook that owns its own working directory).
 *
 * Implementation: for N parallel slices that all branched from the
 * same original HEAD, only the first slice can strictly fast-forward.
 * Subsequent slices need their per-slice commits replayed on top of
 * the parent's new HEAD before the fast-forward will succeed, so this
 * helper rebases the worktree's disposable branch onto the parent's
 * current branch first, then fast-forwards. The rebase rewrites
 * the slice's commit SHAs but preserves commit messages verbatim, so
 * the reviewer's `git log --grep="(SL-N):"` plan-traceability scan
 * still finds the slice's chain. The fast-forward-only contract
 * stays: a true three-way merge commit per slice would defeat the
 * linear per-slice audit history the reviewer reads at handoff.
 *
 * When the rebase OR the fast-forward fails, `false` is returned and
 * the worktree is left in whatever intermediate state git produced
 * (rebase in progress, or unchanged) so the user can `cd` in and
 * inspect / resolve by hand after the orchestrator surfaces the
 * BLOCKED status.
 */
export function mergeSliceWorktree(
  parentPath: string,
  slug: string,
  sliceId: SliceId
): boolean {
  const branch = sliceWorktreeBranch(slug, sliceId);
  const worktree = sliceWorktreePath(parentPath, slug, sliceId);
  let parentBranch: string;
  try {
    parentBranch = runGit(parentPath, ["rev-parse", "--abbrev-ref", "HEAD"]).stdout.trim();
  } catch {
    return false;
  }
  if (parentBranch.length === 0 || parentBranch === "HEAD") {
    // Detached HEAD or unparseable — refuse the merge so the caller
    // routes through BLOCKED instead of silently producing a
    // half-defined parent state.
    return false;
  }
  if (existsSync(worktree)) {
    try {
      runGit(worktree, ["rebase", parentBranch]);
    } catch {
      // Abort the in-progress rebase so the worktree is left in a
      // recoverable state; if abort itself fails (rare), swallow —
      // the user can inspect / clean up by hand after BLOCKED fires.
      try {
        runGit(worktree, ["rebase", "--abort"]);
      } catch {
        // intentional: best-effort recovery
      }
      return false;
    }
  }
  try {
    runGit(parentPath, ["merge", "--ff-only", branch]);
    return true;
  } catch (err) {
    if (err instanceof SliceWorktreeError) {
      return false;
    }
    throw err;
  }
}

/**
 * Remove the slice worktree's directory + delete the disposable
 * branch. Idempotent: missing directory / missing branch / unknown
 * worktree are all no-ops, so the orchestrator's ship and cancel
 * hooks can blanket-invoke without first inspecting state.
 *
 * Order of operations: `git worktree remove --force` first (cleans
 * up the worktree registry + on-disk directory), then `git branch
 * -D <branch>` (deletes the disposable branch). Both steps are
 * wrapped in try/catch and swallow errors — cleanup MUST NOT fail
 * the orchestrator's ship flow. The worst case is a stale
 * `cclaw/<slug>-<slice>` branch the user can prune manually; the
 * worktree directory is the higher-priority cleanup target (an
 * orphan directory blocks future `createSliceWorktree` runs).
 */
export function cleanupSliceWorktree(
  projectRoot: string,
  slug: string,
  sliceId: SliceId
): void {
  const target = sliceWorktreePath(projectRoot, slug, sliceId);
  try {
    runGit(projectRoot, ["worktree", "remove", "--force", target]);
  } catch {
    // Best-effort: the worktree may not exist (already cleaned up,
    // never created on a single-slice layer, or removed manually).
    // Fall through to the branch delete + filesystem mop-up.
  }
  if (existsSync(target)) {
    try {
      // Defensive: when `git worktree remove` failed the directory
      // may still be on disk. Walking removal keeps the helper
      // idempotent across degraded states (e.g. git registry was
      // pruned but the directory survived).
      void removeDirSync(target);
    } catch {
      // Swallow — the orchestrator's ship MUST NOT fail because a
      // stale directory remained. Surfaces in the integration test
      // as a residual directory the test can flag if it cares.
    }
  }
  const branch = sliceWorktreeBranch(slug, sliceId);
  try {
    runGit(projectRoot, ["branch", "-D", branch]);
  } catch {
    // The branch may not exist (worktree never created, or already
    // deleted by `git worktree remove --force` when the branch was
    // the worktree's HEAD). Swallow per cleanup contract.
  }
}

/**
 * Async sibling for callers that want a Promise-returning surface
 * (matches the rest of fs-utils.ts). The cleanup hooks in
 * `src/compound.ts` and `src/cancel.ts` invoke this so they remain
 * fully async.
 */
export async function cleanupSliceWorktreeAsync(
  projectRoot: string,
  slug: string,
  sliceId: SliceId
): Promise<void> {
  cleanupSliceWorktree(projectRoot, slug, sliceId);
  // Stray on-disk debris (worktree remove failed but the directory
  // exists) — async sweep so the orchestrator's ship flow stays
  // non-blocking.
  const target = sliceWorktreePath(projectRoot, slug, sliceId);
  if (await exists(target)) {
    try {
      await fs.rm(target, { recursive: true, force: true });
    } catch {
      // Swallow per cleanup contract.
    }
  }
}

function removeDirSync(target: string): void {
  // Tiny recursive-rm shim so the cleanup path stays self-contained.
  // Best-effort — the async sibling above is the canonical cleanup
  // path for orchestrator hooks; this one only fires when
  // `git worktree remove` left debris on disk.
  rmSync(target, { recursive: true, force: true });
}
