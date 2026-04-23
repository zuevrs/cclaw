import fs from "node:fs/promises";
import path from "node:path";
import type { Writable } from "node:stream";
import { RUNTIME_ROOT } from "../constants.js";
import { readFlowState } from "../runs.js";
import {
  hasFailingTestForPath,
  parseTddCycleLog,
  pathMatchesTarget
} from "../tdd-cycle.js";

interface InternalIo {
  stdout: Writable;
  stderr: Writable;
}

interface TddRedEvidenceArgs {
  targetPath: string;
  runId?: string;
  quiet: boolean;
}

interface AutoEvidenceEntry {
  runId: string;
  exitCode: number;
  paths: string[];
}

// normalizePath and the path matcher live in src/tdd-cycle.ts so all
// TDD-related guards (internal CLI, runtime hook, unit tests) agree on
// what "path X matches recorded file Y" means.

function parseArgs(tokens: string[]): TddRedEvidenceArgs {
  const args: Partial<TddRedEvidenceArgs> = { quiet: false };
  for (const token of tokens) {
    if (token === "--quiet") {
      args.quiet = true;
      continue;
    }
    if (token.startsWith("--path=")) {
      const value = token.slice("--path=".length).trim();
      if (!value) {
        throw new Error("--path must not be empty.");
      }
      args.targetPath = value;
      continue;
    }
    if (token.startsWith("--run-id=")) {
      const value = token.slice("--run-id=".length).trim();
      if (value) {
        args.runId = value;
      }
      continue;
    }
    throw new Error(`Unknown flag for tdd-red-evidence: ${token}`);
  }
  if (!args.targetPath) {
    throw new Error("Missing required flag: --path=<production-file-path>");
  }
  return args as TddRedEvidenceArgs;
}

function parseAutoEvidence(text: string): AutoEvidenceEntry[] {
  const out: AutoEvidenceEntry[] = [];
  for (const rawLine of text.split(/\r?\n/gu)) {
    const line = rawLine.trim();
    if (!line) continue;
    try {
      const parsed = JSON.parse(line) as Record<string, unknown>;
      const exitCode = parsed.exitCode;
      if (typeof exitCode !== "number" || exitCode === 0) continue;
      const runId = typeof parsed.runId === "string" && parsed.runId.length > 0
        ? parsed.runId
        : "active";
      const rawPaths = Array.isArray(parsed.paths)
        ? parsed.paths
        : typeof parsed.path === "string"
          ? [parsed.path]
          : [];
      const paths = rawPaths
        .filter((value): value is string => typeof value === "string")
        .map((value) => value.trim())
        .filter((value) => value.length > 0);
      if (paths.length === 0) continue;
      out.push({
        runId,
        exitCode,
        paths
      });
    } catch {
      // ignore malformed lines
    }
  }
  return out;
}

function hasFailingAutoEvidenceForPath(
  entries: AutoEvidenceEntry[],
  targetPath: string,
  options: { runId?: string } = {}
): boolean {
  for (const entry of entries) {
    if (options.runId && entry.runId !== options.runId) continue;
    for (const filePath of entry.paths) {
      if (pathMatchesTarget(filePath, targetPath)) return true;
    }
  }
  return false;
}

export async function runTddRedEvidenceCommand(
  projectRoot: string,
  tokens: string[],
  io: InternalIo
): Promise<number> {
  const args = parseArgs(tokens);
  const flowState = await readFlowState(projectRoot).catch(() => null);
  // Strict runId scoping: a previous implementation fell back to no
  // filter when both `--runId` and `flowState.activeRunId` were missing,
  // which let evidence rows from past runs satisfy the current check
  // (false positive). Now: require an explicit or inferred runId or
  // fail loud so the caller cannot silently inherit cross-run state.
  const effectiveRunId = args.runId ?? flowState?.activeRunId;
  if (!effectiveRunId || effectiveRunId.trim().length === 0) {
    const reason =
      "tdd-red-evidence: cannot scope check — no --runId provided and " +
      "flow-state.json has no activeRunId. Pass --runId=<id> explicitly " +
      "or run `cclaw doctor` to reconcile state.";
    if (!args.quiet) {
      io.stdout.write(`${JSON.stringify({
        ok: false,
        path: args.targetPath,
        runId: null,
        error: reason,
        sources: { tddCycleLog: false, autoEvidence: false }
      }, null, 2)}\n`);
    } else {
      io.stderr.write(`${reason}\n`);
    }
    return 2;
  }

  const tddLogPath = path.join(projectRoot, RUNTIME_ROOT, "state", "tdd-cycle-log.jsonl");
  const autoEvidencePath = path.join(projectRoot, RUNTIME_ROOT, "state", "tdd-red-evidence.jsonl");

  let cycleLogHasRed = false;
  let autoEvidenceHasRed = false;

  try {
    const raw = await fs.readFile(tddLogPath, "utf8");
    // Strict parse: drop malformed/underspecified rows rather than
    // backfilling runId=active / stage=tdd defaults, which used to
    // silently glue foreign entries to the current run.
    const entries = parseTddCycleLog(raw, { strict: true });
    cycleLogHasRed = hasFailingTestForPath(entries, args.targetPath, {
      runId: effectiveRunId
    });
  } catch {
    cycleLogHasRed = false;
  }

  try {
    const raw = await fs.readFile(autoEvidencePath, "utf8");
    const entries = parseAutoEvidence(raw);
    autoEvidenceHasRed = hasFailingAutoEvidenceForPath(entries, args.targetPath, {
      runId: effectiveRunId
    });
  } catch {
    autoEvidenceHasRed = false;
  }

  const hasRed = cycleLogHasRed || autoEvidenceHasRed;
  if (!args.quiet) {
    io.stdout.write(`${JSON.stringify({
      ok: hasRed,
      path: args.targetPath,
      runId: effectiveRunId,
      sources: {
        tddCycleLog: cycleLogHasRed,
        autoEvidence: autoEvidenceHasRed
      }
    }, null, 2)}\n`);
  }

  return hasRed ? 0 : 2;
}
