import fs from "node:fs/promises";
import path from "node:path";
import { RUNTIME_ROOT } from "./constants.js";
import { exists, withDirectoryLock } from "./fs-utils.js";
import { readFlowState } from "./runs.js";

/**
 * v6.10.0 — sidecar ledger that replaces the per-slice markdown tables in
 * `06-tdd.md` (Watched-RED Proof, Vertical Slice Cycle, RED/GREEN Evidence).
 *
 * The file lives next to the TDD artifact (`<artifacts-dir>/06-tdd-slices.jsonl`)
 * and is append-only — every CLI call writes a new row, and consumers fold
 * rows by `sliceId` taking the latest entry (by file order). Markdown tables
 * remain a legacy fallback when this sidecar is absent or empty.
 */
export interface TddSliceLedgerEntry {
  runId: string;
  sliceId: string;
  status: "red" | "green" | "refactor-deferred" | "refactor-done";
  testFile: string;
  testCommand: string;
  redObservedAt?: string;
  redOutputRef?: string;
  greenAt?: string;
  greenOutputRef?: string;
  refactorAt?: string;
  refactorRationale?: string;
  claimedPaths: string[];
  acceptanceCriterionId?: string;
  planUnitId?: string;
  schemaVersion: 1;
}

export const TDD_SLICE_LEDGER_FILENAME = "06-tdd-slices.jsonl";
export const TDD_SLICE_LEDGER_SCHEMA_VERSION = 1 as const;

export const TDD_SLICE_STATUSES = [
  "red",
  "green",
  "refactor-deferred",
  "refactor-done"
] as const;

export type TddSliceStatus = (typeof TDD_SLICE_STATUSES)[number];

/**
 * Resolve `<artifacts-dir>/06-tdd-slices.jsonl`. Mirrors the convention used
 * by the rest of the runtime (see `artifact-paths.ts::searchRoots`): the
 * sidecar always lives under `.cclaw/artifacts/` regardless of the active
 * topic slug for the TDD artifact.
 */
export function tddSliceLedgerPath(projectRoot: string): string {
  return path.join(projectRoot, RUNTIME_ROOT, "artifacts", TDD_SLICE_LEDGER_FILENAME);
}

function tddSliceLedgerLockPath(projectRoot: string): string {
  return path.join(projectRoot, RUNTIME_ROOT, "artifacts", `.${TDD_SLICE_LEDGER_FILENAME}.lock`);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

export function isTddSliceLedgerEntry(value: unknown): value is TddSliceLedgerEntry {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const o = value as Record<string, unknown>;
  if (typeof o.runId !== "string" || o.runId.length === 0) return false;
  if (typeof o.sliceId !== "string" || o.sliceId.length === 0) return false;
  if (typeof o.status !== "string" || !TDD_SLICE_STATUSES.includes(o.status as TddSliceStatus)) {
    return false;
  }
  if (typeof o.testFile !== "string") return false;
  if (typeof o.testCommand !== "string") return false;
  if (!isStringArray(o.claimedPaths)) return false;
  if (o.redObservedAt !== undefined && typeof o.redObservedAt !== "string") return false;
  if (o.redOutputRef !== undefined && typeof o.redOutputRef !== "string") return false;
  if (o.greenAt !== undefined && typeof o.greenAt !== "string") return false;
  if (o.greenOutputRef !== undefined && typeof o.greenOutputRef !== "string") return false;
  if (o.refactorAt !== undefined && typeof o.refactorAt !== "string") return false;
  if (o.refactorRationale !== undefined && typeof o.refactorRationale !== "string") return false;
  if (
    o.acceptanceCriterionId !== undefined &&
    typeof o.acceptanceCriterionId !== "string"
  ) {
    return false;
  }
  if (o.planUnitId !== undefined && typeof o.planUnitId !== "string") return false;
  if (o.schemaVersion !== TDD_SLICE_LEDGER_SCHEMA_VERSION) return false;
  return true;
}

export async function readTddSliceLedger(projectRoot: string): Promise<{
  entries: TddSliceLedgerEntry[];
  corruptLines: number[];
}> {
  const filePath = tddSliceLedgerPath(projectRoot);
  if (!(await exists(filePath))) {
    return { entries: [], corruptLines: [] };
  }
  const text = await fs.readFile(filePath, "utf8").catch(() => "");
  const lines = text.split(/\r?\n/gu);
  const entries: TddSliceLedgerEntry[] = [];
  const corruptLines: number[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]?.trim() ?? "";
    if (line.length === 0) continue;
    try {
      const parsed: unknown = JSON.parse(line);
      if (isTddSliceLedgerEntry(parsed)) {
        entries.push(parsed);
      } else {
        corruptLines.push(index + 1);
      }
    } catch {
      corruptLines.push(index + 1);
    }
  }
  return { entries, corruptLines };
}

/**
 * Latest-row-wins fold by `sliceId`. Returns one entry per slice, ordered by
 * the index of its latest row. Mirrors the pattern used by
 * `computeActiveSubagents` for the delegation ledger.
 */
export function foldTddSliceLedger(entries: TddSliceLedgerEntry[]): TddSliceLedgerEntry[] {
  const latest = new Map<string, TddSliceLedgerEntry>();
  for (const entry of entries) {
    latest.set(entry.sliceId, entry);
  }
  return [...latest.values()];
}

/**
 * Atomic append under a directory lock — reuses the same `withDirectoryLock`
 * primitive that `appendDelegation` uses so concurrent CLI invocations don't
 * tear a half-written JSON line.
 */
export async function appendSliceEntry(
  projectRoot: string,
  entry: TddSliceLedgerEntry
): Promise<void> {
  const filePath = tddSliceLedgerPath(projectRoot);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await withDirectoryLock(tddSliceLedgerLockPath(projectRoot), async () => {
    await fs.appendFile(filePath, `${JSON.stringify(entry)}\n`, {
      encoding: "utf8",
      mode: 0o600
    });
  });
}

/**
 * Whether the exact same row (by all fields except timestamps) already
 * exists. Used to make CLI retries idempotent — a hook that re-runs after
 * a transient failure should not double-append.
 */
function entriesEquivalent(
  a: TddSliceLedgerEntry,
  b: TddSliceLedgerEntry
): boolean {
  return (
    a.runId === b.runId &&
    a.sliceId === b.sliceId &&
    a.status === b.status &&
    a.testFile === b.testFile &&
    a.testCommand === b.testCommand &&
    a.redObservedAt === b.redObservedAt &&
    a.redOutputRef === b.redOutputRef &&
    a.greenAt === b.greenAt &&
    a.greenOutputRef === b.greenOutputRef &&
    a.refactorAt === b.refactorAt &&
    a.refactorRationale === b.refactorRationale &&
    a.acceptanceCriterionId === b.acceptanceCriterionId &&
    a.planUnitId === b.planUnitId &&
    a.claimedPaths.length === b.claimedPaths.length &&
    a.claimedPaths.every((p, i) => p === b.claimedPaths[i])
  );
}

export interface TddSliceRecordArgs {
  sliceId: string;
  status: TddSliceStatus;
  testFile?: string;
  testCommand?: string;
  claimedPaths?: string[];
  redOutputRef?: string;
  greenOutputRef?: string;
  redObservedAt?: string;
  greenAt?: string;
  refactorAt?: string;
  refactorRationale?: string;
  acceptanceCriterionId?: string;
  planUnitId?: string;
  json: boolean;
}

function readFlagValue(
  tokens: string[],
  index: number,
  flag: string
): { value: string; advance: number } {
  const token = tokens[index]!;
  if (token.startsWith(`${flag}=`)) {
    return { value: token.slice(flag.length + 1), advance: 0 };
  }
  const next = tokens[index + 1];
  if (token === flag) {
    if (next === undefined || next.startsWith("--")) {
      throw new Error(`${flag} requires a value.`);
    }
    return { value: next, advance: 1 };
  }
  throw new Error(`${flag} requires a value.`);
}

function parseClaimedPaths(raw: string): string[] {
  return raw
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

export function parseTddSliceRecordArgs(tokens: string[]): TddSliceRecordArgs {
  let sliceId: string | undefined;
  let status: TddSliceStatus | undefined;
  let testFile: string | undefined;
  let testCommand: string | undefined;
  let claimedPaths: string[] | undefined;
  let redOutputRef: string | undefined;
  let greenOutputRef: string | undefined;
  let redObservedAt: string | undefined;
  let greenAt: string | undefined;
  let refactorAt: string | undefined;
  let refactorRationale: string | undefined;
  let acceptanceCriterionId: string | undefined;
  let planUnitId: string | undefined;
  let json = false;

  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i]!;
    if (token === "--json") {
      json = true;
      continue;
    }
    if (token === "--slice" || token.startsWith("--slice=")) {
      const { value, advance } = readFlagValue(tokens, i, "--slice");
      sliceId = value.trim();
      i += advance;
      continue;
    }
    if (token === "--status" || token.startsWith("--status=")) {
      const { value, advance } = readFlagValue(tokens, i, "--status");
      const trimmed = value.trim();
      if (!TDD_SLICE_STATUSES.includes(trimmed as TddSliceStatus)) {
        throw new Error(
          `--status must be one of ${TDD_SLICE_STATUSES.join("|")}`
        );
      }
      status = trimmed as TddSliceStatus;
      i += advance;
      continue;
    }
    if (token === "--test-file" || token.startsWith("--test-file=")) {
      const { value, advance } = readFlagValue(tokens, i, "--test-file");
      testFile = value.trim();
      i += advance;
      continue;
    }
    if (token === "--command" || token.startsWith("--command=")) {
      const { value, advance } = readFlagValue(tokens, i, "--command");
      testCommand = value.trim();
      i += advance;
      continue;
    }
    if (token === "--paths" || token.startsWith("--paths=")) {
      const { value, advance } = readFlagValue(tokens, i, "--paths");
      claimedPaths = parseClaimedPaths(value);
      i += advance;
      continue;
    }
    if (token === "--red-output-ref" || token.startsWith("--red-output-ref=")) {
      const { value, advance } = readFlagValue(tokens, i, "--red-output-ref");
      redOutputRef = value.trim();
      i += advance;
      continue;
    }
    if (token === "--green-output-ref" || token.startsWith("--green-output-ref=")) {
      const { value, advance } = readFlagValue(tokens, i, "--green-output-ref");
      greenOutputRef = value.trim();
      i += advance;
      continue;
    }
    if (token === "--red-observed-at" || token.startsWith("--red-observed-at=")) {
      const { value, advance } = readFlagValue(tokens, i, "--red-observed-at");
      redObservedAt = value.trim();
      i += advance;
      continue;
    }
    if (token === "--green-at" || token.startsWith("--green-at=")) {
      const { value, advance } = readFlagValue(tokens, i, "--green-at");
      greenAt = value.trim();
      i += advance;
      continue;
    }
    if (token === "--refactor-at" || token.startsWith("--refactor-at=")) {
      const { value, advance } = readFlagValue(tokens, i, "--refactor-at");
      refactorAt = value.trim();
      i += advance;
      continue;
    }
    if (token === "--refactor-rationale" || token.startsWith("--refactor-rationale=")) {
      const { value, advance } = readFlagValue(tokens, i, "--refactor-rationale");
      refactorRationale = value.trim();
      i += advance;
      continue;
    }
    if (token === "--ac" || token.startsWith("--ac=")) {
      const { value, advance } = readFlagValue(tokens, i, "--ac");
      acceptanceCriterionId = value.trim();
      i += advance;
      continue;
    }
    if (token === "--plan-unit" || token.startsWith("--plan-unit=")) {
      const { value, advance } = readFlagValue(tokens, i, "--plan-unit");
      planUnitId = value.trim();
      i += advance;
      continue;
    }
    throw new Error(`Unknown flag for internal tdd-slice-record: ${token}`);
  }

  if (!sliceId) {
    throw new Error("internal tdd-slice-record requires --slice <id>.");
  }
  if (!status) {
    throw new Error(
      `internal tdd-slice-record requires --status <${TDD_SLICE_STATUSES.join("|")}>.`
    );
  }
  if (status === "refactor-deferred" && (!refactorRationale || refactorRationale.length === 0)) {
    throw new Error(
      "internal tdd-slice-record: --status=refactor-deferred requires --refactor-rationale=<text>."
    );
  }

  return {
    sliceId,
    status,
    testFile,
    testCommand,
    claimedPaths,
    redOutputRef,
    greenOutputRef,
    redObservedAt,
    greenAt,
    refactorAt,
    refactorRationale,
    acceptanceCriterionId,
    planUnitId,
    json
  };
}

interface TddSliceRecordIo {
  stdout: { write(chunk: string): boolean };
  stderr: { write(chunk: string): boolean };
}

/**
 * Consume parsed CLI flags, fold against the existing sidecar to inherit
 * fields recorded on earlier rows of the same slice, auto-stamp the
 * status-relevant timestamp when not provided, and append the new row.
 *
 * The CLI surface is intentionally lenient: only the very first call for a
 * slice (status=red) needs `--test-file`, `--command`, `--paths`. Subsequent
 * green/refactor calls inherit those values from the latest prior row.
 */
export async function runTddSliceRecord(
  projectRoot: string,
  args: TddSliceRecordArgs,
  io: TddSliceRecordIo
): Promise<number> {
  const { activeRunId } = await readFlowState(projectRoot);
  const ledger = await readTddSliceLedger(projectRoot);
  const priorForSlice = ledger.entries.filter((entry) => entry.sliceId === args.sliceId);
  const latestPrior = priorForSlice.length > 0 ? priorForSlice[priorForSlice.length - 1]! : null;

  const testFile = args.testFile ?? latestPrior?.testFile ?? "";
  const testCommand = args.testCommand ?? latestPrior?.testCommand ?? "";
  const claimedPaths = args.claimedPaths ?? latestPrior?.claimedPaths ?? [];

  if (args.status === "red") {
    if (testFile.length === 0) {
      throw new Error("--status=red requires --test-file=<path> on the first call for a slice.");
    }
    if (testCommand.length === 0) {
      throw new Error("--status=red requires --command=<cmd>.");
    }
    if (claimedPaths.length === 0) {
      throw new Error("--status=red requires --paths=<comma-separated>.");
    }
  }

  const now = new Date().toISOString();
  const inheritedRedObservedAt = args.redObservedAt
    ?? latestPrior?.redObservedAt
    ?? (args.status === "red" ? now : undefined);
  const inheritedGreenAt = args.greenAt
    ?? latestPrior?.greenAt
    ?? (args.status === "green" ? now : undefined);
  const inheritedRefactorAt = args.refactorAt
    ?? latestPrior?.refactorAt
    ?? (args.status === "refactor-done" ? now : undefined);

  const entry: TddSliceLedgerEntry = {
    runId: activeRunId,
    sliceId: args.sliceId,
    status: args.status,
    testFile,
    testCommand,
    claimedPaths,
    schemaVersion: TDD_SLICE_LEDGER_SCHEMA_VERSION,
    ...(inheritedRedObservedAt !== undefined ? { redObservedAt: inheritedRedObservedAt } : {}),
    ...(args.redOutputRef ?? latestPrior?.redOutputRef
      ? { redOutputRef: args.redOutputRef ?? latestPrior?.redOutputRef }
      : {}),
    ...(inheritedGreenAt !== undefined ? { greenAt: inheritedGreenAt } : {}),
    ...(args.greenOutputRef ?? latestPrior?.greenOutputRef
      ? { greenOutputRef: args.greenOutputRef ?? latestPrior?.greenOutputRef }
      : {}),
    ...(inheritedRefactorAt !== undefined ? { refactorAt: inheritedRefactorAt } : {}),
    ...(args.refactorRationale ?? latestPrior?.refactorRationale
      ? { refactorRationale: args.refactorRationale ?? latestPrior?.refactorRationale }
      : {}),
    ...(args.acceptanceCriterionId ?? latestPrior?.acceptanceCriterionId
      ? { acceptanceCriterionId: args.acceptanceCriterionId ?? latestPrior?.acceptanceCriterionId }
      : {}),
    ...(args.planUnitId ?? latestPrior?.planUnitId
      ? { planUnitId: args.planUnitId ?? latestPrior?.planUnitId }
      : {})
  };

  if (latestPrior && entriesEquivalent(latestPrior, entry)) {
    if (args.json) {
      io.stdout.write(`${JSON.stringify({ ok: true, command: "tdd-slice-record", idempotent: true, entry })}\n`);
    }
    return 0;
  }

  await appendSliceEntry(projectRoot, entry);
  if (args.json) {
    io.stdout.write(`${JSON.stringify({ ok: true, command: "tdd-slice-record", entry })}\n`);
  } else {
    io.stdout.write(
      `Recorded TDD slice ${entry.sliceId} status=${entry.status} runId=${entry.runId}\n`
    );
  }
  return 0;
}
