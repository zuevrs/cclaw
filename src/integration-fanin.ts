import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { exists } from "./fs-utils.js";
import { readDelegationEvents, recordCclawFanInAudit } from "./delegation.js";
import { effectiveWorktreeExecutionMode, type FlowState } from "./flow-state.js";
import type { WorktreeLaneId } from "./worktree-types.js";

const execFileAsync = promisify(execFile);

export type FanInEventKind = "applied" | "conflict" | "resolved" | "abandoned";

export interface FanInLaneOptions {
  projectRoot: string;
  /** Lane directory under `.cclaw/worktrees/<laneId>`. */
  laneId: WorktreeLaneId;
  /** Integration branch to receive the patch (must already exist locally). */
  integrationBranch: string;
  /**
   * Baseline ref for `git diff` in the lane (fork point vs integration).
   * When omitted, computed as `git merge-base <integration> HEAD` in the lane.
   */
  baseRef?: string;
}

export interface FanInLaneResult {
  ok: boolean;
  event: FanInEventKind;
  details: string;
}

const WORKTREES_SEG = ".cclaw/worktrees";

/**
 * Build a unified diff from `baseRef..HEAD` in the lane worktree and apply it
 * to the integration branch in the main repo using three-way merge.
 * On conflict, the integration branch working tree is reset and, when possible,
 * git HEAD is restored to the branch that was checked out before fan-in.
 */
export async function fanInLane(options: FanInLaneOptions): Promise<FanInLaneResult> {
  const { projectRoot, laneId, integrationBranch } = options;
  const workdir = path.join(projectRoot, WORKTREES_SEG, laneId);
  if (!(await exists(workdir))) {
    return { ok: false, event: "abandoned", details: `missing lane workdir ${workdir}` };
  }
  let integrationRef: string;
  try {
    integrationRef = (
      await execFileAsync("git", ["rev-parse", "--verify", integrationBranch], {
        cwd: projectRoot
      })
    ).stdout.trim();
  } catch {
    return {
      ok: false,
      event: "abandoned",
      details: `integration branch/ref not found: ${integrationBranch}`
    };
  }
  let baseRef = options.baseRef?.trim() ?? "";
  if (baseRef.length === 0) {
    try {
      baseRef = (
        await execFileAsync("git", ["merge-base", integrationRef, "HEAD"], { cwd: workdir })
      ).stdout.trim();
    } catch (err) {
      return {
        ok: false,
        event: "abandoned",
        details: `cannot merge-base lane ${laneId} with ${integrationBranch}: ${
          err instanceof Error ? err.message : String(err)
        }`
      };
    }
  }
  const patchFile = path.join(projectRoot, WORKTREES_SEG, `.fanin-${laneId}.patch`);
  let restoreBranch: string | null = null;
  try {
    let curBranch = "";
    try {
      curBranch = (
        await execFileAsync("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd: projectRoot })
      ).stdout.trim();
    } catch {
      curBranch = "";
    }
    if (curBranch.length > 0 && curBranch !== integrationBranch && curBranch !== "HEAD") {
      restoreBranch = curBranch;
    }
    const { stdout: diffOut } = await execFileAsync(
      "git",
      ["diff", `${baseRef}..HEAD`],
      { cwd: workdir, maxBuffer: 64 * 1024 * 1024 }
    );
    if (diffOut.trim().length === 0) {
      return { ok: true, event: "applied", details: "empty diff; nothing to merge" };
    }
    await fs.writeFile(patchFile, diffOut, "utf8");
    await execFileAsync("git", ["checkout", integrationBranch], { cwd: projectRoot });
    try {
      await execFileAsync("git", ["apply", "--3way", patchFile], { cwd: projectRoot });
      return { ok: true, event: "applied", details: `applied lane ${laneId} onto ${integrationBranch}` };
    } catch (err) {
      await execFileAsync("git", ["checkout", "--", "."], { cwd: projectRoot }).catch(() => undefined);
      if (restoreBranch) {
        await execFileAsync("git", ["checkout", restoreBranch], { cwd: projectRoot }).catch(() => undefined);
      }
      const msg = err instanceof Error ? err.message : String(err);
      return {
        ok: false,
        event: "conflict",
        details: `git apply --3way reported conflicts for lane ${laneId}: ${msg}`
      };
    }
  } finally {
    await fs.rm(patchFile, { force: true });
  }
}

export interface ResolverDispatchHint {
  sliceId: string;
  command: string;
}

/**
 * Returns the canonical CLI hint for resolving fan-in conflicts for a slice.
 */
export function buildResolveConflictDispatchHint(sliceId: string): ResolverDispatchHint {
  return {
    sliceId,
    command: `slice-implementer --phase resolve-conflict --slice ${sliceId}`
  };
}

/**
 * Merge every lane that recorded a completed GREEN `ownerLaneId` for the
 * active run, then emit `cclaw_fanin_*` audit rows. Does nothing in
 * `single-tree` mode or when git is unavailable.
 */
export async function runTddDeterministicFanInBeforeAdvance(
  projectRoot: string,
  flowState: FlowState
): Promise<{ ok: boolean; issues: string[] }> {
  if (effectiveWorktreeExecutionMode(flowState) !== "worktree-first") {
    return { ok: true, issues: [] };
  }
  let integrationBranch: string;
  try {
    integrationBranch = (
      await execFileAsync("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd: projectRoot })
    ).stdout.trim();
  } catch {
    return {
      ok: false,
      issues: ["worktree fan-in: cannot read current git branch (not a repository or detached HEAD unsupported here)."]
    };
  }
  const { events } = await readDelegationEvents(projectRoot);
  const runId = flowState.activeRunId;
  const laneToSlices = new Map<string, Set<string>>();
  for (const e of events) {
    if (e.runId !== runId || e.stage !== "tdd") continue;
    if (e.agent !== "slice-implementer") continue;
    if (e.status !== "completed" || e.phase !== "green") continue;
    const lane = e.ownerLaneId?.trim();
    const sid = e.sliceId?.trim();
    if (!lane || !sid) continue;
    if (!laneToSlices.has(lane)) laneToSlices.set(lane, new Set());
    laneToSlices.get(lane)!.add(sid);
  }
  if (laneToSlices.size === 0) {
    return { ok: true, issues: [] };
  }
  const issues: string[] = [];
  for (const [laneId, sliceSet] of laneToSlices) {
    const result = await fanInLane({
      projectRoot,
      laneId: laneId as WorktreeLaneId,
      integrationBranch,
      baseRef: undefined
    });
    const sliceIds = [...sliceSet].sort();
    if (!result.ok && result.event === "conflict") {
      await recordCclawFanInAudit(projectRoot, {
        kind: "cclaw_fanin_conflict",
        runId,
        laneId,
        sliceIds,
        integrationBranch,
        details: result.details
      });
      issues.push(
        `${result.details} — ${buildResolveConflictDispatchHint(sliceIds[0] ?? "S-1").command}`
      );
      continue;
    }
    if (!result.ok) {
      await recordCclawFanInAudit(projectRoot, {
        kind: "cclaw_fanin_abandoned",
        runId,
        laneId,
        sliceIds,
        integrationBranch,
        details: result.details
      });
      issues.push(result.details);
      continue;
    }
    await recordCclawFanInAudit(projectRoot, {
      kind: "cclaw_fanin_applied",
      runId,
      laneId,
      sliceIds,
      integrationBranch,
      details: result.details
    });
  }
  return { ok: issues.length === 0, issues };
}
