import path from "node:path";
import type { Writable } from "node:stream";
import { RUNTIME_ROOT } from "../constants.js";
import {
  computeEarlyLoopStatus,
  formatEarlyLoopStatusLine,
  isEarlyLoopStage,
  type EarlyLoopStage
} from "../early-loop.js";
import { writeFileSafe } from "../fs-utils.js";
import { readFlowState } from "../runs.js";

interface InternalIo {
  stdout: Writable;
  stderr: Writable;
}

interface EarlyLoopStatusArgs {
  json: boolean;
  quiet: boolean;
  write: boolean;
  stage?: EarlyLoopStage;
  runId?: string;
}

function parseArgs(tokens: string[]): EarlyLoopStatusArgs {
  const args: EarlyLoopStatusArgs = { json: false, quiet: false, write: true };
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]!;
    const nextToken = tokens[index + 1];
    if (token === "--json") {
      args.json = true;
      continue;
    }
    if (token === "--quiet") {
      args.quiet = true;
      continue;
    }
    if (token === "--write") {
      args.write = true;
      continue;
    }
    if (token === "--no-write") {
      args.write = false;
      continue;
    }
    if (token === "--stage") {
      if (!nextToken || nextToken.startsWith("--")) {
        throw new Error("--stage requires a value: brainstorm | scope | design");
      }
      if (!isEarlyLoopStage(nextToken)) {
        throw new Error("--stage must be one of: brainstorm, scope, design");
      }
      args.stage = nextToken;
      index += 1;
      continue;
    }
    if (token.startsWith("--stage=")) {
      const stageRaw = token.slice("--stage=".length);
      if (!isEarlyLoopStage(stageRaw)) {
        throw new Error("--stage must be one of: brainstorm, scope, design");
      }
      args.stage = stageRaw;
      continue;
    }
    if (token === "--run-id") {
      if (!nextToken || nextToken.startsWith("--")) {
        throw new Error("--run-id requires a value.");
      }
      args.runId = nextToken.trim();
      index += 1;
      continue;
    }
    if (token.startsWith("--run-id=")) {
      args.runId = token.slice("--run-id=".length).trim();
      continue;
    }
    throw new Error(`Unknown early-loop-status flag: ${token}`);
  }
  return args;
}

function stateDir(projectRoot: string): string {
  return path.join(projectRoot, RUNTIME_ROOT, "state");
}

export async function runEarlyLoopStatusCommand(
  projectRoot: string,
  argv: string[],
  io: InternalIo
): Promise<number> {
  const args = parseArgs(argv);
  const flow = await readFlowState(projectRoot).catch(() => null);
  const stage = args.stage ?? flow?.currentStage;
  if (!isEarlyLoopStage(stage)) {
    io.stderr.write(
      "cclaw internal early-loop-status: current stage is not an early-loop stage. Pass --stage=brainstorm|scope|design.\n"
    );
    return 1;
  }

  const runId = (args.runId ?? flow?.activeRunId ?? "active").trim() || "active";
  const status = await computeEarlyLoopStatus(
    stage,
    runId,
    path.join(stateDir(projectRoot), "early-loop-log.jsonl")
  );

  if (args.write) {
    const target = path.join(stateDir(projectRoot), "early-loop.json");
    await writeFileSafe(target, `${JSON.stringify(status, null, 2)}\n`);
  }

  if (!args.quiet) {
    if (args.json) {
      io.stdout.write(`${JSON.stringify(status, null, 2)}\n`);
    } else {
      io.stdout.write(`${formatEarlyLoopStatusLine(status)}\n`);
    }
  }

  return 0;
}
