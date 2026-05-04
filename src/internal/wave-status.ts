import fs from "node:fs/promises";
import path from "node:path";
import type { Writable } from "node:stream";
import { RUNTIME_ROOT } from "../constants.js";
import { readDelegationEvents, readDelegationLedger } from "../delegation.js";
import type { DelegationEntry } from "../delegation.js";
import { readFlowState } from "../runs.js";
import {
  mergeParallelWaveDefinitions,
  parseParallelExecutionPlanWaves,
  parseWavePlanDirectory,
  type ParsedParallelWave
} from "./plan-split-waves.js";

interface InternalIo {
  stdout: Writable;
  stderr: Writable;
}

interface WaveStatusArgs {
  format: "json" | "human";
}

export interface WaveStatusWaveSummary {
  waveId: string;
  members: string[];
  closedMembers: string[];
  openMembers: string[];
  readyMembers: string[];
  blockedMembers: string[];
  status: "closed" | "open" | "partial" | "empty";
}

export interface WaveStatusNextDispatch {
  waveId: string | null;
  readyToDispatch: string[];
  pathConflicts: string[];
  mode: "single-slice" | "wave-fanout" | "none";
}

export interface WaveStatusReport {
  activeRunId: string;
  currentStage: string;
  tddCutoverSliceId: string | null;
  tddWorktreeCutoverSliceId: string | null;
  legacyContinuation: boolean;
  waves: WaveStatusWaveSummary[];
  nextDispatch: WaveStatusNextDispatch;
  warnings: string[];
}

export interface RunWaveStatusOptions {
  /**
   * Override the artifacts directory; useful for fixture tests that
   * place an `05-plan.md` outside `.cclaw/artifacts`. Defaults to
   * `<projectRoot>/.cclaw/artifacts`.
   */
  artifactsDir?: string;
}

function parseArgs(tokens: string[]): WaveStatusArgs {
  const args: WaveStatusArgs = { format: "json" };
  for (const token of tokens) {
    if (token === "--json") args.format = "json";
    else if (token === "--human" || token === "--text") args.format = "human";
    else if (token.startsWith("--format=")) {
      const raw = token.slice("--format=".length).trim();
      if (raw === "json" || raw === "human") args.format = raw;
      else throw new Error(`Unknown wave-status --format value: ${raw}`);
    } else {
      throw new Error(`Unknown wave-status flag: ${token}`);
    }
  }
  return args;
}

function classifyWaveStatus(
  total: number,
  closedCount: number
): WaveStatusWaveSummary["status"] {
  if (total === 0) return "empty";
  if (closedCount === 0) return "open";
  if (closedCount >= total) return "closed";
  return "partial";
}

const TERMINAL_PHASES = new Set([
  "refactor",
  "refactor-deferred",
  "resolve-conflict"
]);

/**
 * v6.14.2 — deterministic helper for the TDD controller. Reads the
 * managed `<!-- parallel-exec-managed-start -->` block from
 * `<artifacts-dir>/05-plan.md` plus the `wave-plans/` directory and
 * reports waves + the next dispatchable members so the controller does
 * NOT have to page through a 1400-line plan to find the active wave.
 *
 * Always exits 0 unless the plan is malformed (no managed block AND no
 * wave-plans directory), in which case exit 2 with a structured error.
 */
export async function runWaveStatus(
  projectRoot: string,
  options: RunWaveStatusOptions = {}
): Promise<WaveStatusReport> {
  const artifactsDir =
    options.artifactsDir ?? path.join(projectRoot, RUNTIME_ROOT, "artifacts");

  const flowState = await readFlowState(projectRoot).catch(() => null);
  const activeRunId = flowState?.activeRunId ?? "unknown-run";
  const currentStage = flowState?.currentStage ?? "tdd";
  const tddCutoverSliceId = flowState?.tddCutoverSliceId ?? null;
  const tddWorktreeCutoverSliceId =
    flowState?.tddWorktreeCutoverSliceId ?? null;
  const legacyContinuation = flowState?.legacyContinuation === true;

  let planRaw = "";
  try {
    planRaw = await fs.readFile(path.join(artifactsDir, "05-plan.md"), "utf8");
  } catch {
    planRaw = "";
  }

  let primaryWaves: ParsedParallelWave[] = [];
  try {
    primaryWaves = parseParallelExecutionPlanWaves(planRaw);
  } catch (err) {
    return {
      activeRunId,
      currentStage,
      tddCutoverSliceId,
      tddWorktreeCutoverSliceId,
      legacyContinuation,
      waves: [],
      nextDispatch: {
        waveId: null,
        readyToDispatch: [],
        pathConflicts: [],
        mode: "none"
      },
      warnings: [
        `wave_plan_parse_error: ${err instanceof Error ? err.message : String(err)}`
      ]
    };
  }
  let secondaryWaves: ParsedParallelWave[] = [];
  try {
    secondaryWaves = await parseWavePlanDirectory(artifactsDir);
  } catch (err) {
    secondaryWaves = [];
    void err;
  }
  let merged: ParsedParallelWave[] = [];
  try {
    merged = mergeParallelWaveDefinitions(primaryWaves, secondaryWaves);
  } catch (err) {
    return {
      activeRunId,
      currentStage,
      tddCutoverSliceId,
      tddWorktreeCutoverSliceId,
      legacyContinuation,
      waves: [],
      nextDispatch: {
        waveId: null,
        readyToDispatch: [],
        pathConflicts: [],
        mode: "none"
      },
      warnings: [
        `wave_plan_merge_conflict: ${err instanceof Error ? err.message : String(err)}`
      ]
    };
  }

  // Collect closed slice ids from the active run delegation ledger +
  // events. A slice is "closed" once it carries a terminal phase
  // (refactor, refactor-deferred, resolve-conflict) OR a phase=green
  // event with refactorOutcome (v6.14.0 fold-inline path). Anything else
  // we treat as still open so the helper never falsely advances.
  const closedSlices = new Set<string>();
  let ledgerEntries: DelegationEntry[] = [];
  try {
    const ledger = await readDelegationLedger(projectRoot);
    ledgerEntries = ledger.entries.filter(
      (entry) => entry.runId === ledger.runId && entry.stage === "tdd"
    );
  } catch {
    ledgerEntries = [];
  }
  for (const entry of ledgerEntries) {
    if (entry.status !== "completed") continue;
    if (typeof entry.sliceId !== "string") continue;
    if (typeof entry.phase !== "string") continue;
    if (TERMINAL_PHASES.has(entry.phase)) {
      closedSlices.add(entry.sliceId);
      continue;
    }
    if (entry.phase === "green" && entry.refactorOutcome) {
      const mode = entry.refactorOutcome.mode;
      if (mode === "inline" || mode === "deferred") {
        closedSlices.add(entry.sliceId);
      }
    }
  }
  // Also consult the JSONL events in case the ledger projection lags.
  try {
    const { events } = await readDelegationEvents(projectRoot);
    for (const ev of events) {
      if (ev.event !== "completed") continue;
      if (ev.runId !== activeRunId) continue;
      if (ev.stage !== "tdd") continue;
      if (typeof ev.sliceId !== "string") continue;
      if (typeof ev.phase !== "string") continue;
      if (TERMINAL_PHASES.has(ev.phase)) {
        closedSlices.add(ev.sliceId);
        continue;
      }
      if (ev.phase === "green" && ev.refactorOutcome) {
        const mode = ev.refactorOutcome.mode;
        if (mode === "inline" || mode === "deferred") {
          closedSlices.add(ev.sliceId);
        }
      }
    }
  } catch {
    // best-effort; ledger already covers the canonical case.
  }

  const waves: WaveStatusWaveSummary[] = merged.map((wave) => {
    const members = wave.members.map((m) => m.sliceId);
    const closedMembers = members.filter((id) => closedSlices.has(id));
    const openMembers = members.filter((id) => !closedSlices.has(id));
    return {
      waveId: wave.waveId,
      members,
      closedMembers,
      openMembers,
      readyMembers: openMembers,
      blockedMembers: [],
      status: classifyWaveStatus(members.length, closedMembers.length)
    };
  });

  const firstOpenWave = waves.find(
    (w) => w.status === "open" || w.status === "partial"
  ) ?? null;

  const warnings: string[] = [];
  if (tddCutoverSliceId) {
    warnings.push(
      "tddCutoverSliceId is a historical boundary; do not use it to find the active slice."
    );
  }
  if (merged.length === 0 && planRaw.length === 0) {
    warnings.push(
      "wave_plan_missing: 05-plan.md not found or empty under <artifacts-dir>."
    );
  } else if (merged.length === 0) {
    warnings.push(
      "wave_plan_managed_block_missing: <!-- parallel-exec-managed-start --> block not found in 05-plan.md and wave-plans/ has no parseable wave files."
    );
  }

  let nextDispatch: WaveStatusNextDispatch;
  if (firstOpenWave === null) {
    nextDispatch = {
      waveId: null,
      readyToDispatch: [],
      pathConflicts: [],
      mode: "none"
    };
  } else {
    const readyToDispatch = [...firstOpenWave.readyMembers].sort();
    nextDispatch = {
      waveId: firstOpenWave.waveId,
      readyToDispatch,
      pathConflicts: [],
      mode: readyToDispatch.length > 1 ? "wave-fanout" : "single-slice"
    };
  }

  return {
    activeRunId,
    currentStage,
    tddCutoverSliceId,
    tddWorktreeCutoverSliceId,
    legacyContinuation,
    waves,
    nextDispatch,
    warnings
  };
}

function formatHumanReport(report: WaveStatusReport): string {
  const lines: string[] = [];
  lines.push(`activeRunId: ${report.activeRunId}`);
  lines.push(`currentStage: ${report.currentStage}`);
  if (report.tddCutoverSliceId) {
    lines.push(`tddCutoverSliceId: ${report.tddCutoverSliceId} (HISTORICAL)`);
  }
  if (report.tddWorktreeCutoverSliceId) {
    lines.push(`tddWorktreeCutoverSliceId: ${report.tddWorktreeCutoverSliceId}`);
  }
  lines.push(`legacyContinuation: ${report.legacyContinuation}`);
  lines.push("waves:");
  if (report.waves.length === 0) {
    lines.push("  (no waves discovered)");
  } else {
    for (const wave of report.waves) {
      lines.push(
        `  ${wave.waveId} [${wave.status}]: ` +
          `closed=[${wave.closedMembers.join(",")}] ` +
          `open=[${wave.openMembers.join(",")}]`
      );
    }
  }
  lines.push(
    `nextDispatch: wave=${report.nextDispatch.waveId ?? "(none)"} ` +
      `mode=${report.nextDispatch.mode} ` +
      `ready=[${report.nextDispatch.readyToDispatch.join(",")}]`
  );
  if (report.warnings.length > 0) {
    lines.push("warnings:");
    for (const warn of report.warnings) {
      lines.push(`  - ${warn}`);
    }
  }
  return lines.join("\n") + "\n";
}

export async function runWaveStatusCommand(
  projectRoot: string,
  argv: string[],
  io: InternalIo
): Promise<number> {
  let parsed: WaveStatusArgs;
  try {
    parsed = parseArgs(argv);
  } catch (err) {
    io.stderr.write(
      `cclaw internal wave-status: ${err instanceof Error ? err.message : String(err)}\n`
    );
    return 1;
  }
  const report = await runWaveStatus(projectRoot);
  if (parsed.format === "json") {
    io.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    io.stdout.write(formatHumanReport(report));
  }
  return 0;
}
