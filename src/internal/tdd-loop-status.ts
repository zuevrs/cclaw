import fs from "node:fs/promises";
import path from "node:path";
import type { Writable } from "node:stream";
import { RUNTIME_ROOT } from "../constants.js";
import { writeFileSafe } from "../fs-utils.js";
import { readFlowState } from "../runs.js";
import {
  computeRalphLoopStatus,
  parseTddCycleLog,
  type RalphLoopStatus
} from "../tdd-cycle.js";

interface InternalIo {
  stdout: Writable;
  stderr: Writable;
}

interface TddLoopStatusArgs {
  json: boolean;
  quiet: boolean;
  write: boolean;
}

function parseArgs(tokens: string[]): TddLoopStatusArgs {
  const args: TddLoopStatusArgs = { json: false, quiet: false, write: true };
  for (const token of tokens) {
    if (token === "--json") args.json = true;
    else if (token === "--quiet") args.quiet = true;
    else if (token === "--no-write") args.write = false;
    else if (token === "--write") args.write = true;
    else throw new Error(`Unknown tdd-loop-status flag: ${token}`);
  }
  return args;
}

function stateDir(projectRoot: string): string {
  return path.join(projectRoot, RUNTIME_ROOT, "state");
}

async function readCycleLog(projectRoot: string): Promise<string> {
  const filePath = path.join(stateDir(projectRoot), "tdd-cycle-log.jsonl");
  try {
    return await fs.readFile(filePath, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return "";
    throw err;
  }
}

/**
 * Produces a one-line "Ralph Loop: iter=X, slices=Y, acClosed=Z, redOpen=..."
 * summary — suitable for session-digest / bootstrap surfaces where the user
 * just needs a progress indicator, not the full slice breakdown.
 */
export function formatRalphLoopStatusLine(status: RalphLoopStatus): string {
  const redOpen = status.redOpenSlices.length > 0
    ? status.redOpenSlices.join(",")
    : "none";
  return `Ralph Loop: iter=${status.loopIteration}, slices=${status.sliceCount}, acClosed=${status.acClosed.length}, redOpen=${redOpen}`;
}

export async function runTddLoopStatusCommand(
  projectRoot: string,
  argv: string[],
  io: InternalIo
): Promise<number> {
  const args = parseArgs(argv);
  const flow = await readFlowState(projectRoot).catch(() => null);
  const runId = flow?.activeRunId ?? "active";
  const text = await readCycleLog(projectRoot);
  const entries = parseTddCycleLog(text);
  const status = computeRalphLoopStatus(entries, { runId });

  if (args.write) {
    const target = path.join(stateDir(projectRoot), "ralph-loop.json");
    await writeFileSafe(target, `${JSON.stringify(status, null, 2)}\n`);
  }

  if (!args.quiet) {
    if (args.json) {
      io.stdout.write(`${JSON.stringify(status, null, 2)}\n`);
    } else {
      io.stdout.write(`${formatRalphLoopStatusLine(status)}\n`);
    }
  }
  return 0;
}
