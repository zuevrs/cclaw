import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import type { Writable } from "node:stream";
import {
  readConfig,
  resolveTddCommitMode,
  resolveTddIsolationMode,
  resolveTddWorktreeRoot
} from "../config.js";
import { readDelegationLedger } from "../delegation.js";
import { exists } from "../fs-utils.js";
import {
  cleanupWorktree,
  commitAndMergeBack,
  createSliceWorktree,
  WorktreeMergeConflictError,
  WorktreeUnsupportedError
} from "../worktree-manager.js";

const execFileAsync = promisify(execFile);

interface InternalIo {
  stdout: Writable;
  stderr: Writable;
}

interface SliceCommitArgs {
  sliceId: string;
  spanId: string;
  taskId?: string;
  title?: string;
  runId?: string;
  worktreePath?: string;
  claimedPaths: string[];
  prepareWorktree: boolean;
  json: boolean;
  quiet: boolean;
}

function parseCsv(raw: string): string[] {
  return raw
    .split(",")
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
}

function normalizePathLike(value: string): string {
  const slashes = value.replace(/\\/gu, "/");
  const withoutDot = slashes.replace(/^\.\//u, "");
  return withoutDot.replace(/\/+$/u, "");
}

function parseSliceCommitArgs(tokens: string[]): SliceCommitArgs {
  let sliceId = "";
  let spanId = "";
  let taskId: string | undefined;
  let title: string | undefined;
  let runId: string | undefined;
  let worktreePath: string | undefined;
  const claimedPaths: string[] = [];
  let prepareWorktree = false;
  let json = false;
  let quiet = false;

  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i]!;
    const next = tokens[i + 1];
    const valueFrom = (flag: string): string => {
      if (token.startsWith(`${flag}=`)) return token.slice(flag.length + 1);
      if (token === flag && next && !next.startsWith("--")) {
        i += 1;
        return next;
      }
      throw new Error(`${flag} requires a value.`);
    };
    if (token === "--json") {
      json = true;
      continue;
    }
    if (token === "--quiet") {
      quiet = true;
      continue;
    }
    if (token === "--prepare-worktree") {
      prepareWorktree = true;
      continue;
    }
    if (token.startsWith("--slice=") || token === "--slice") {
      sliceId = valueFrom("--slice").trim();
      continue;
    }
    if (token.startsWith("--span-id=") || token === "--span-id") {
      spanId = valueFrom("--span-id").trim();
      continue;
    }
    if (token.startsWith("--task-id=") || token === "--task-id") {
      taskId = valueFrom("--task-id").trim();
      continue;
    }
    if (token.startsWith("--title=") || token === "--title") {
      title = valueFrom("--title").trim();
      continue;
    }
    if (token.startsWith("--run-id=") || token === "--run-id") {
      runId = valueFrom("--run-id").trim();
      continue;
    }
    if (token.startsWith("--worktree-path=") || token === "--worktree-path") {
      const resolved = valueFrom("--worktree-path").trim();
      if (resolved.length > 0) {
        worktreePath = resolved;
      }
      continue;
    }
    if (token.startsWith("--claimed-paths=") || token === "--claimed-paths") {
      claimedPaths.push(...parseCsv(valueFrom("--claimed-paths")));
      continue;
    }
    if (token.startsWith("--claimed-path=") || token === "--claimed-path") {
      const one = valueFrom("--claimed-path").trim();
      if (one.length > 0) claimedPaths.push(one);
      continue;
    }
    throw new Error(`Unknown flag for internal slice-commit: ${token}`);
  }

  if (sliceId.length === 0) {
    throw new Error("internal slice-commit requires --slice=<S-N>.");
  }
  if (spanId.length === 0) {
    throw new Error("internal slice-commit requires --span-id=<span-id>.");
  }

  return {
    sliceId,
    spanId,
    taskId,
    title,
    runId,
    worktreePath,
    claimedPaths,
    prepareWorktree,
    json,
    quiet
  };
}

function output(
  io: InternalIo,
  args: SliceCommitArgs,
  payload: Record<string, unknown>,
  channel: "stdout" | "stderr" = "stdout"
): void {
  if (args.quiet && channel === "stdout") return;
  const writer = channel === "stdout" ? io.stdout : io.stderr;
  if (args.json) {
    writer.write(`${JSON.stringify(payload)}\n`);
    return;
  }
  const message = typeof payload.message === "string"
    ? payload.message
    : JSON.stringify(payload);
  writer.write(`${message}\n`);
}

function parsePorcelainPaths(raw: string): string[] {
  const out: string[] = [];
  for (const line of raw.split(/\r?\n/gu)) {
    const trimmed = line.trimEnd();
    if (trimmed.length < 4) continue;
    // porcelain line shape: XY<space><path>
    const status = trimmed.slice(0, 2);
    if (status === "??") {
      const p = normalizePathLike(trimmed.slice(3).trim());
      if (p.length > 0) out.push(p);
      continue;
    }
    let p = trimmed.slice(3).trim();
    const renameIdx = p.indexOf(" -> ");
    if (renameIdx >= 0) {
      p = p.slice(renameIdx + 4);
    }
    p = normalizePathLike(p.replace(/^"/u, "").replace(/"$/u, ""));
    if (p.length > 0) out.push(p);
  }
  return [...new Set(out)];
}

async function gitChangedPaths(cwd: string): Promise<string[]> {
  const { stdout: statusRaw } = await execFileAsync("git", ["status", "--porcelain", "-uall"], {
    cwd
  });
  return parsePorcelainPaths(statusRaw);
}

function matchesClaimedPath(changedPath: string, claimedPaths: string[]): boolean {
  const changed = normalizePathLike(changedPath);
  return claimedPaths.some((rawClaimed) => {
    const claimed = normalizePathLike(rawClaimed);
    if (claimed.length === 0) return false;
    if (changed === claimed) return true;
    return changed.startsWith(`${claimed}/`);
  });
}

async function resolveClaimedPathsFromLedger(
  projectRoot: string,
  args: SliceCommitArgs
): Promise<string[]> {
  const ledger = await readDelegationLedger(projectRoot);
  const matches = ledger.entries.filter((entry) =>
    entry.stage === "tdd" &&
    entry.agent === "slice-builder" &&
    entry.sliceId === args.sliceId &&
    entry.spanId === args.spanId &&
    (!args.runId || entry.runId === args.runId) &&
    Array.isArray(entry.claimedPaths) &&
    entry.claimedPaths.length > 0
  );
  matches.sort((a, b) => {
    const aTs = a.ts ?? a.startTs ?? "";
    const bTs = b.ts ?? b.startTs ?? "";
    return aTs < bTs ? 1 : aTs > bTs ? -1 : 0;
  });
  const fromLedger = matches[0]?.claimedPaths ?? [];
  return [...new Set(fromLedger.map((p) => normalizePathLike(p)).filter((p) => p.length > 0))];
}

export async function runSliceCommitCommand(
  projectRoot: string,
  tokens: string[],
  io: InternalIo
): Promise<number> {
  let args: SliceCommitArgs;
  try {
    args = parseSliceCommitArgs(tokens);
  } catch (err) {
    io.stderr.write(
      `cclaw internal slice-commit: ${err instanceof Error ? err.message : String(err)}\n`
    );
    return 1;
  }

  const config = await readConfig(projectRoot).catch(() => null);
  const commitMode = resolveTddCommitMode(config);
  const isolationMode = resolveTddIsolationMode(config);
  const worktreeRoot = resolveTddWorktreeRoot(config);
  const gitPresent = await exists(path.join(projectRoot, ".git"));

  if (args.prepareWorktree) {
    if (!gitPresent) {
      output(io, args, {
        ok: true,
        skipped: true,
        reason: "no-git",
        message: "slice-worktree skipped: .git is missing"
      });
      return 0;
    }
    if (isolationMode === "in-place") {
      output(io, args, {
        ok: true,
        skipped: true,
        reason: "isolation-in-place",
        isolationMode,
        message: "slice-worktree skipped: tdd.isolationMode=in-place"
      });
      return 0;
    }
    try {
      const { stdout } = await execFileAsync("git", ["rev-parse", "HEAD"], { cwd: projectRoot });
      const prepared = await createSliceWorktree(args.sliceId, stdout.trim(), args.claimedPaths, {
        projectRoot,
        worktreeRoot
      });
      output(io, args, {
        ok: true,
        prepared: true,
        sliceId: args.sliceId,
        spanId: args.spanId,
        worktreePath: prepared.path,
        baseRef: prepared.ref
      });
      return 0;
    } catch (error) {
      if (error instanceof WorktreeUnsupportedError) {
        output(io, args, {
          ok: true,
          skipped: true,
          reason: "worktree-unavailable",
          degradedCommitMode: "agent-required",
          message: error.message
        });
        return 0;
      }
      output(io, args, {
        ok: false,
        errorCode: "worktree_prepare_failed",
        details: {
          message: error instanceof Error ? error.message : String(error)
        },
        message: `worktree_prepare_failed: ${
          error instanceof Error ? error.message : String(error)
        }`
      }, "stderr");
      return 1;
    }
  }

  if (commitMode !== "managed-per-slice") {
    output(io, args, {
      ok: true,
      skipped: true,
      reason: "commit-mode-not-managed",
      commitMode,
      message: `slice-commit skipped: commitMode=${commitMode}`
    });
    return 0;
  }

  if (!gitPresent) {
    output(io, args, {
      ok: true,
      skipped: true,
      reason: "no-git",
      message: "slice-commit skipped: .git is missing"
    });
    return 0;
  }

  const claimedPaths = args.claimedPaths.length > 0
    ? [...new Set(args.claimedPaths.map((p) => normalizePathLike(p)).filter((p) => p.length > 0))]
    : await resolveClaimedPathsFromLedger(projectRoot, args);
  if (claimedPaths.length === 0) {
    output(io, args, {
      ok: false,
      errorCode: "slice_commit_claimed_paths_missing",
      details: {
        sliceId: args.sliceId,
        spanId: args.spanId
      },
      message: `slice_commit_claimed_paths_missing: no claimed paths for ${args.sliceId}/${args.spanId}`
    }, "stderr");
    return 2;
  }

  let managedWorktreePath: string | null = null;
  let activeCwd = projectRoot;
  let degradedToInPlace = false;
  const requestedWorktreePath =
    typeof args.worktreePath === "string" && args.worktreePath.trim().length > 0
      ? path.resolve(projectRoot, args.worktreePath.trim())
      : null;

  if (requestedWorktreePath && await exists(requestedWorktreePath)) {
    managedWorktreePath = requestedWorktreePath;
    activeCwd = requestedWorktreePath;
  } else if (isolationMode !== "in-place") {
    try {
      const { stdout } = await execFileAsync("git", ["rev-parse", "HEAD"], { cwd: projectRoot });
      const prepared = await createSliceWorktree(args.sliceId, stdout.trim(), claimedPaths, {
        projectRoot,
        worktreeRoot
      });
      managedWorktreePath = prepared.path;
      activeCwd = prepared.path;
    } catch (error) {
      if (error instanceof WorktreeUnsupportedError) {
        output(io, args, {
          ok: true,
          skipped: true,
          reason: "worktree-unavailable",
          degradedCommitMode: "agent-required",
          message: error.message
        });
        return 0;
      }
      output(io, args, {
        ok: false,
        errorCode: "worktree_prepare_failed",
        details: {
          message: error instanceof Error ? error.message : String(error)
        },
        message: `worktree_prepare_failed: ${
          error instanceof Error ? error.message : String(error)
        }`
      }, "stderr");
      return 1;
    }
  }

  const cleanupManagedWorktree = async (): Promise<void> => {
    if (!managedWorktreePath) return;
    await cleanupWorktree(managedWorktreePath, { projectRoot }).catch(() => undefined);
  };

  let changedPaths = await gitChangedPaths(activeCwd);
  if (changedPaths.length === 0 && managedWorktreePath && activeCwd !== projectRoot) {
    const rootChangedPaths = await gitChangedPaths(projectRoot);
    if (rootChangedPaths.length > 0) {
      activeCwd = projectRoot;
      changedPaths = rootChangedPaths;
      degradedToInPlace = true;
    }
  }
  if (changedPaths.length === 0) {
    await cleanupManagedWorktree();
    output(io, args, {
      ok: true,
      skipped: true,
      reason: "no-changes",
      message: `slice-commit skipped: no working-tree changes for ${args.sliceId}`
    });
    return 0;
  }

  const pathDrift = changedPaths.filter((p) => !matchesClaimedPath(p, claimedPaths));
  if (pathDrift.length > 0) {
    output(io, args, {
      ok: false,
      errorCode: "slice_commit_path_drift",
      details: {
        sliceId: args.sliceId,
        spanId: args.spanId,
        claimedPaths,
        driftPaths: pathDrift
      },
      message: `slice_commit_path_drift: ${pathDrift.join(", ")}`
    }, "stderr");
    return 2;
  }

  const changedInClaim = changedPaths.filter((p) => matchesClaimedPath(p, claimedPaths));
  if (changedInClaim.length === 0) {
    await cleanupManagedWorktree();
    output(io, args, {
      ok: true,
      skipped: true,
      reason: "claimed-paths-unchanged",
      message: `slice-commit skipped: no changes within claimed paths for ${args.sliceId}`
    });
    return 0;
  }

  try {
    await execFileAsync("git", ["add", "--", ...claimedPaths], {
      cwd: activeCwd
    });
    const taskPart = args.taskId && args.taskId.length > 0 ? args.taskId : "task";
    const titlePart = args.title && args.title.length > 0 ? args.title : "slice update";
    const header = `${args.sliceId}/${taskPart}: ${titlePart}`;
    const body = [
      `span-id: ${args.spanId}`,
      `run-id: ${args.runId ?? "unknown"}`,
      "phase-cycle: red->green->refactor->doc"
    ].join("\n");
    await execFileAsync("git", ["commit", "-m", header, "-m", body], {
      cwd: activeCwd
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (/nothing to commit/iu.test(message)) {
      await cleanupManagedWorktree();
      output(io, args, {
        ok: true,
        skipped: true,
        reason: "nothing-to-commit",
        message: `slice-commit skipped: nothing to commit for ${args.sliceId}`
      });
      return 0;
    }
    output(io, args, {
      ok: false,
      errorCode: "slice_commit_failed",
      details: { message },
      message: `slice_commit_failed: ${message}`
    }, "stderr");
    return 1;
  }

  const { stdout: shaStdout } = await execFileAsync("git", ["rev-parse", "HEAD"], {
    cwd: activeCwd
  });
  let commitSha = shaStdout.trim();

  if (managedWorktreePath && activeCwd !== projectRoot) {
    try {
      const merged = await commitAndMergeBack(activeCwd, `merge ${args.sliceId}`, { projectRoot });
      commitSha = merged.commitSha;
    } catch (error) {
      if (error instanceof WorktreeMergeConflictError) {
        output(io, args, {
          ok: false,
          errorCode: "worktree_merge_conflict",
          details: {
            sliceId: args.sliceId,
            spanId: args.spanId,
            worktreePath: activeCwd,
            message: error.message
          },
          message: error.message
        }, "stderr");
        return 2;
      }
      output(io, args, {
        ok: false,
        errorCode: "slice_commit_failed",
        details: { message: error instanceof Error ? error.message : String(error) },
        message: `slice_commit_failed: ${error instanceof Error ? error.message : String(error)}`
      }, "stderr");
      return 1;
    }
  }

  await cleanupManagedWorktree();
  output(io, args, {
    ok: true,
    commitSha,
    sliceId: args.sliceId,
    spanId: args.spanId,
    claimedPaths,
    changedPaths: changedInClaim,
    worktreePath: managedWorktreePath ?? undefined,
    degradedToInPlace: degradedToInPlace || undefined,
    message: `slice commit created for ${args.sliceId}: ${commitSha}`
  });
  return 0;
}

