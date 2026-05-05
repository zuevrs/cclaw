import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import type { Writable } from "node:stream";
import { readConfig, resolveTddCommitMode } from "../config.js";
import { readDelegationLedger } from "../delegation.js";
import { exists } from "../fs-utils.js";

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
  claimedPaths: string[];
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
  const claimedPaths: string[] = [];
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
    claimedPaths,
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

  const gitPresent = await exists(path.join(projectRoot, ".git"));
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

  const { stdout: statusRaw } = await execFileAsync("git", ["status", "--porcelain", "-uall"], {
    cwd: projectRoot
  });
  const changedPaths = parsePorcelainPaths(statusRaw);
  if (changedPaths.length === 0) {
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
      cwd: projectRoot
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
      cwd: projectRoot
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (/nothing to commit/iu.test(message)) {
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
    cwd: projectRoot
  });
  const commitSha = shaStdout.trim();
  output(io, args, {
    ok: true,
    commitSha,
    sliceId: args.sliceId,
    spanId: args.spanId,
    claimedPaths,
    changedPaths: changedInClaim,
    message: `slice commit created for ${args.sliceId}: ${commitSha}`
  });
  return 0;
}

