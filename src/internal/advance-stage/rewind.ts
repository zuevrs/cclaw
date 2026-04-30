import fs from "node:fs/promises";
import path from "node:path";
import { RUNTIME_ROOT } from "../../constants.js";
import { ensureDir } from "../../fs-utils.js";
import {
  type FlowState,
  type StageGateState
} from "../../flow-state.js";
import { readFlowState, writeFlowState } from "../../runs.js";
import { FLOW_STAGES, TRACK_STAGES, type FlowStage } from "../../types.js";
import type { RewindArgs } from "./parsers.js";
import type { Writable } from "node:stream";

interface InternalIo {
  stdout: Writable;
  stderr: Writable;
}


export function rewindLogPath(projectRoot: string): string {
  return path.join(projectRoot, RUNTIME_ROOT, "state", "rewind-log.jsonl");
}

export function rewindId(date = new Date()): string {
  return `rewind-${date.getTime().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function stagesInvalidatedByRewind(current: FlowState, targetStage: FlowStage): FlowStage[] {
  const ordered = TRACK_STAGES[current.track];
  const targetIndex = ordered.indexOf(targetStage);
  const currentIndex = ordered.indexOf(current.currentStage);
  if (targetIndex < 0 || currentIndex < 0 || targetIndex > currentIndex) {
    return [];
  }
  return ordered.slice(targetIndex, currentIndex + 1) as FlowStage[];
}

export async function appendRewindLog(projectRoot: string, payload: Record<string, unknown>): Promise<void> {
  const logPath = rewindLogPath(projectRoot);
  await ensureDir(path.dirname(logPath));
  await fs.appendFile(logPath, `${JSON.stringify(payload)}\n`, "utf8");
}

export async function runRewind(projectRoot: string, args: RewindArgs, io: InternalIo): Promise<number> {
  const current = await readFlowState(projectRoot);
  const now = new Date().toISOString();

  if (args.mode === "ack") {
    const marker = current.staleStages[args.targetStage];
    if (!marker) {
      io.stderr.write(`cclaw internal rewind: no stale marker exists for "${args.targetStage}".\n`);
      return 1;
    }
    if (current.currentStage !== args.targetStage) {
      io.stderr.write(
        `cclaw internal rewind: cannot ack "${args.targetStage}" while currentStage is "${current.currentStage}". Re-run the stale stage before acknowledging it.\n`
      );
      return 1;
    }
    const staleStages = { ...current.staleStages };
    delete staleStages[args.targetStage];
    const nextState: FlowState = { ...current, staleStages };
    await writeFlowState(projectRoot, nextState);
    const payload = {
      ok: true,
      command: "rewind",
      action: "ack",
      stage: args.targetStage,
      acknowledgedAt: now,
      rewindId: marker.rewindId
    };
    await appendRewindLog(projectRoot, payload);
    if (!args.quiet) {
      io.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
    }
    return 0;
  }

  const invalidatedStages = stagesInvalidatedByRewind(current, args.targetStage);
  if (invalidatedStages.length === 0) {
    io.stderr.write(
      `cclaw internal rewind: target "${args.targetStage}" is not an earlier or current stage on track "${current.track}" from "${current.currentStage}".\n`
    );
    return 1;
  }

  const id = rewindId();
  const completedInvalidated = new Set(invalidatedStages);
  const staleStages: FlowState["staleStages"] = { ...current.staleStages };
  for (const stage of invalidatedStages) {
    staleStages[stage] = {
      rewindId: id,
      reason: args.reason ?? "rewind",
      markedAt: now
    };
  }
  const record = {
    id,
    fromStage: current.currentStage,
    toStage: args.targetStage,
    reason: args.reason ?? "rewind",
    timestamp: now,
    invalidatedStages
  };
  const nextState: FlowState = {
    ...current,
    currentStage: args.targetStage,
    completedStages: current.completedStages.filter((stage) => !completedInvalidated.has(stage)),
    staleStages,
    rewinds: [...current.rewinds, record]
  };
  await writeFlowState(projectRoot, nextState);
  const payload = {
    ok: true,
    command: "rewind",
    action: "rewind",
    rewind: record,
    currentStage: nextState.currentStage,
    completedStages: nextState.completedStages,
    staleStages: Object.keys(nextState.staleStages),
    nextActions: [
      `Re-run ${args.targetStage} stage work and update its artifact evidence.`,
      `Then run cclaw internal rewind --ack ${args.targetStage}.`,
      "Continue with /cc after the stale marker is acknowledged."
    ]
  };
  await appendRewindLog(projectRoot, payload);
  if (!args.quiet) {
    io.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
  }
  return 0;
}
