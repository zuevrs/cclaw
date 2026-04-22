import path from "node:path";
import type { Writable } from "node:stream";
import { RUNTIME_ROOT } from "../constants.js";
import { readConfig } from "../config.js";
import { writeFileSafe } from "../fs-utils.js";
import {
  computeCompoundReadiness,
  readKnowledgeSafely,
  type CompoundReadiness
} from "../knowledge-store.js";

interface InternalIo {
  stdout: Writable;
  stderr: Writable;
}

interface CompoundReadinessArgs {
  json: boolean;
  quiet: boolean;
  write: boolean;
  threshold?: number;
}

function parseArgs(tokens: string[]): CompoundReadinessArgs {
  const args: CompoundReadinessArgs = { json: false, quiet: false, write: true };
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i]!;
    if (token === "--json") args.json = true;
    else if (token === "--quiet") args.quiet = true;
    else if (token === "--no-write") args.write = false;
    else if (token === "--write") args.write = true;
    else if (token === "--threshold") {
      const value = tokens[i + 1];
      if (!value) throw new Error("--threshold requires a numeric value");
      const parsed = Number.parseInt(value, 10);
      if (!Number.isInteger(parsed) || parsed < 1) {
        throw new Error(`--threshold must be a positive integer, got ${value}`);
      }
      args.threshold = parsed;
      i += 1;
    } else {
      throw new Error(`Unknown compound-readiness flag: ${token}`);
    }
  }
  return args;
}

function stateDir(projectRoot: string): string {
  return path.join(projectRoot, RUNTIME_ROOT, "state");
}

/**
 * Compact one-liner for session-digest / bootstrap surfaces.
 *
 * Example: `Compound readiness: clusters=12, ready=2 (critical=1)`.
 * When `ready === 0`, emit `Compound readiness: no candidates`.
 */
export function formatCompoundReadinessLine(status: CompoundReadiness): string {
  if (status.readyCount === 0) {
    return `Compound readiness: no candidates (clusters=${status.clusterCount}, threshold=${status.threshold})`;
  }
  const critical = status.ready.filter((cluster) => cluster.severity === "critical").length;
  const criticalSuffix = critical > 0 ? ` (critical=${critical})` : "";
  return `Compound readiness: clusters=${status.clusterCount}, ready=${status.readyCount}${criticalSuffix}`;
}

export async function runCompoundReadinessCommand(
  projectRoot: string,
  argv: string[],
  io: InternalIo
): Promise<number> {
  const args = parseArgs(argv);
  const config = await readConfig(projectRoot).catch(() => null);
  const threshold =
    args.threshold ??
    (typeof config?.compound?.recurrenceThreshold === "number"
      ? config!.compound!.recurrenceThreshold!
      : undefined);

  const { entries } = await readKnowledgeSafely(projectRoot, { lockAware: false });
  const status = computeCompoundReadiness(entries, {
    ...(typeof threshold === "number" ? { threshold } : {})
  });

  if (args.write) {
    const target = path.join(stateDir(projectRoot), "compound-readiness.json");
    await writeFileSafe(target, `${JSON.stringify(status, null, 2)}\n`);
  }

  if (!args.quiet) {
    if (args.json) {
      io.stdout.write(`${JSON.stringify(status, null, 2)}\n`);
    } else {
      io.stdout.write(`${formatCompoundReadinessLine(status)}\n`);
    }
  }
  return 0;
}
