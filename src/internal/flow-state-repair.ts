import fs from "node:fs/promises";
import path from "node:path";
import { RUNTIME_ROOT } from "../constants.js";
import {
  clampEarlyLoopStatusForWrite,
  computeEarlyLoopStatus,
  isEarlyLoopStage,
  type EarlyLoopStage
} from "../early-loop.js";
import { writeFileSafe } from "../fs-utils.js";
import { repairFlowStateGuard } from "../run-persistence.js";
import { readFlowState } from "../runs.js";
import type { FlowStage } from "../types.js";
import type { Writable } from "node:stream";

interface InternalIo {
  stdout: Writable;
  stderr: Writable;
}

export interface FlowStateRepairArgs {
  reason: string;
  json: boolean;
  quiet: boolean;
  /**
   * when true, normalize `state/early-loop.json` to the canonical
   * shape derived from `early-loop-log.jsonl`. Lets operators recover from
   * legacy hand-written `early-loop.json` files that drifted from the
   * source-of-truth log.
   */
  earlyLoop: boolean;
}

export function parseFlowStateRepairArgs(tokens: string[]): FlowStateRepairArgs {
  let reason: string | undefined;
  let json = false;
  let quiet = false;
  let earlyLoop = false;
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i]!;
    const nextToken = tokens[i + 1];
    if (token === "--json") {
      json = true;
      continue;
    }
    if (token === "--quiet") {
      quiet = true;
      continue;
    }
    if (token === "--early-loop") {
      earlyLoop = true;
      continue;
    }
    if (token === "--reason") {
      if (!nextToken || nextToken.startsWith("--")) {
        throw new Error("--reason requires a short slug value.");
      }
      reason = nextToken.trim();
      i += 1;
      continue;
    }
    if (token.startsWith("--reason=")) {
      reason = token.slice("--reason=".length).trim();
      continue;
    }
    throw new Error(`Unknown flag for internal flow-state-repair: ${token}`);
  }
  if (!reason || reason.length === 0) {
    throw new Error(
      "internal flow-state-repair requires --reason=<slug> (e.g. --reason=manual_edit_recovery)."
    );
  }
  return { reason, json, quiet, earlyLoop };
}

interface EarlyLoopRepairOutcome {
  performed: boolean;
  stage?: EarlyLoopStage;
  runId?: string;
  iteration?: number;
  openConcernCount?: number;
  skipped?: string;
}

async function repairEarlyLoopFile(
  projectRoot: string,
  io: InternalIo
): Promise<EarlyLoopRepairOutcome> {
  const flow = await readFlowState(projectRoot).catch(() => null);
  if (!flow) {
    return { performed: false, skipped: "flow-state-unreadable" };
  }
  const stage: FlowStage = flow.currentStage;
  if (!isEarlyLoopStage(stage)) {
    return { performed: false, skipped: `current-stage-${stage}-not-early-loop` };
  }
  const runId = flow.activeRunId.trim();
  if (runId.length === 0) {
    io.stderr.write(
      "cclaw internal flow-state-repair --early-loop: active run has no runId; cannot derive canonical early-loop.json.\n"
    );
    return { performed: false, skipped: "missing-active-runId" };
  }
  const stateDir = path.join(projectRoot, RUNTIME_ROOT, "state");
  const logPath = path.join(stateDir, "early-loop-log.jsonl");
  const status = await computeEarlyLoopStatus(stage, runId, logPath);
  const persisted = clampEarlyLoopStatusForWrite(status);
  const finalStatus = persisted.status;
  const target = path.join(stateDir, "early-loop.json");
  await writeFileSafe(target, `${JSON.stringify(finalStatus, null, 2)}\n`);
  return {
    performed: true,
    stage,
    runId,
    iteration: finalStatus.iteration,
    openConcernCount: finalStatus.openConcerns.length
  };
}

export async function runFlowStateRepair(
  projectRoot: string,
  args: FlowStateRepairArgs,
  io: InternalIo
): Promise<number> {
  const result = await repairFlowStateGuard(projectRoot, args.reason);
  const logRel = path.relative(projectRoot, result.repairLogPath).replace(/\\/gu, "/");
  const guardRel = path.relative(projectRoot, result.guardPath).replace(/\\/gu, "/");
  let earlyLoopOutcome: EarlyLoopRepairOutcome | null = null;
  if (args.earlyLoop) {
    earlyLoopOutcome = await repairEarlyLoopFile(projectRoot, io);
  }
  void fs;
  const payload = {
    ok: true,
    command: "flow-state-repair",
    reason: args.reason,
    sidecar: result.sidecar,
    guardPath: guardRel,
    repairLogPath: logRel,
    completedStageMetaBackfilled: result.completedStageMetaBackfilled,
    earlyLoop: earlyLoopOutcome,
    runtimeRoot: RUNTIME_ROOT
  };
  if (args.json) {
    io.stdout.write(`${JSON.stringify(payload)}\n`);
    return 0;
  }
  if (!args.quiet) {
    io.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
  }
  return 0;
}
