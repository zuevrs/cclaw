import path from "node:path";
import { RUNTIME_ROOT } from "../constants.js";
import { repairFlowStateGuard } from "../run-persistence.js";
import type { Writable } from "node:stream";

interface InternalIo {
  stdout: Writable;
  stderr: Writable;
}

export interface FlowStateRepairArgs {
  reason: string;
  json: boolean;
  quiet: boolean;
}

export function parseFlowStateRepairArgs(tokens: string[]): FlowStateRepairArgs {
  let reason: string | undefined;
  let json = false;
  let quiet = false;
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
  return { reason, json, quiet };
}

export async function runFlowStateRepair(
  projectRoot: string,
  args: FlowStateRepairArgs,
  io: InternalIo
): Promise<number> {
  const result = await repairFlowStateGuard(projectRoot, args.reason);
  const logRel = path.relative(projectRoot, result.repairLogPath).replace(/\\/gu, "/");
  const guardRel = path.relative(projectRoot, result.guardPath).replace(/\\/gu, "/");
  if (args.json) {
    io.stdout.write(
      `${JSON.stringify({
        ok: true,
        command: "flow-state-repair",
        reason: args.reason,
        sidecar: result.sidecar,
        guardPath: guardRel,
        repairLogPath: logRel,
        runtimeRoot: RUNTIME_ROOT
      })}\n`
    );
    return 0;
  }
  if (!args.quiet) {
    io.stdout.write(
      `${JSON.stringify(
        {
          ok: true,
          command: "flow-state-repair",
          reason: args.reason,
          sidecar: result.sidecar,
          guardPath: guardRel,
          repairLogPath: logRel
        },
        null,
        2
      )}\n`
    );
  }
  return 0;
}
