export type TddCyclePhase = "red" | "green" | "refactor";

export interface TddCycleEntry {
  ts: string;
  runId: string;
  stage: string;
  slice: string;
  phase: TddCyclePhase;
  command: string;
  files?: string[];
  exitCode?: number;
  note?: string;
}

export interface TddCycleValidation {
  ok: boolean;
  issues: string[];
  openRedSlices: string[];
  sliceCount: number;
}

export function parseTddCycleLog(text: string): TddCycleEntry[] {
  const out: TddCycleEntry[] = [];
  // Strip a leading UTF-8 BOM on the whole blob so the first line parses
  // cleanly; `trim()` handles BOM on subsequent lines through the same
  // codepath (empty/whitespace-only lines are skipped).
  const normalized = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  for (const raw of normalized.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    try {
      const parsed = JSON.parse(line) as Record<string, unknown>;
      const phase = parsed.phase;
      if (phase !== "red" && phase !== "green" && phase !== "refactor") {
        continue;
      }
      const entry: TddCycleEntry = {
        ts: typeof parsed.ts === "string" ? parsed.ts : "",
        runId: typeof parsed.runId === "string" ? parsed.runId : "active",
        stage: typeof parsed.stage === "string" ? parsed.stage : "tdd",
        slice: typeof parsed.slice === "string" ? parsed.slice : "S-unknown",
        phase,
        command: typeof parsed.command === "string" ? parsed.command : "",
        files: Array.isArray(parsed.files)
          ? parsed.files.filter((item): item is string => typeof item === "string")
          : undefined,
        exitCode: typeof parsed.exitCode === "number" ? parsed.exitCode : undefined,
        note: typeof parsed.note === "string" ? parsed.note : undefined
      };
      out.push(entry);
    } catch {
      // skip malformed line
    }
  }
  return out;
}

const SLICE_ID_PATTERN = /^S-\d+$/u;

export function validateTddCycleOrder(
  entries: TddCycleEntry[],
  options: { runId?: string } = {}
): TddCycleValidation {
  const targetRun = options.runId;
  const filtered = targetRun
    ? entries.filter((entry) => entry.runId === targetRun)
    : entries;
  const bySlice = new Map<string, TddCycleEntry[]>();
  for (const entry of filtered) {
    const list = bySlice.get(entry.slice) ?? [];
    list.push(entry);
    bySlice.set(entry.slice, list);
  }
  const issues: string[] = [];
  const openRedSlices: string[] = [];

  // Reject slices whose ID does not match the stable `S-<number>` contract.
  // Entries that drop the slice field entirely were previously coerced to
  // `S-unknown` and silently bucketed together, which means multiple distinct
  // cycles could appear to share a RED/GREEN pair.
  for (const slice of bySlice.keys()) {
    if (!SLICE_ID_PATTERN.test(slice)) {
      issues.push(`slice "${slice}": id must match /^S-\\d+$/ (e.g. S-1)`);
    }
  }

  for (const [slice, sliceEntries] of bySlice.entries()) {
    let state: "need_red" | "red_open" | "green_done" = "need_red";
    for (const entry of sliceEntries) {
      if (entry.phase === "red") {
        if (entry.exitCode === undefined) {
          issues.push(`slice ${slice}: red entry must record a non-zero exitCode`);
          continue;
        }
        if (entry.exitCode === 0) {
          issues.push(`slice ${slice}: red entry exitCode must be non-zero`);
          continue;
        }
        if (state === "red_open") {
          issues.push(`slice ${slice}: duplicate red before green`);
          continue;
        }
        state = "red_open";
        continue;
      }
      if (entry.phase === "green") {
        if (entry.exitCode === undefined) {
          issues.push(`slice ${slice}: green entry must record exitCode 0`);
          continue;
        }
        if (entry.exitCode !== 0) {
          issues.push(`slice ${slice}: green entry exitCode must be 0`);
          continue;
        }
        if (state !== "red_open") {
          issues.push(`slice ${slice}: green logged before red`);
          continue;
        }
        state = "green_done";
        continue;
      }
      // refactor — must preserve the passing state established by green.
      if (entry.exitCode === undefined) {
        issues.push(`slice ${slice}: refactor entry must record exitCode 0`);
        continue;
      }
      if (entry.exitCode !== 0) {
        issues.push(`slice ${slice}: refactor entry exitCode must be 0 (tests must stay green)`);
        continue;
      }
      if (state !== "green_done") {
        issues.push(`slice ${slice}: refactor logged before green`);
        continue;
      }
      state = "need_red";
    }
    if (state === "red_open") {
      openRedSlices.push(slice);
    }
  }

  return {
    ok: issues.length === 0 && openRedSlices.length === 0,
    issues,
    openRedSlices,
    sliceCount: bySlice.size
  };
}

function normalizePath(value: string): string {
  return value.replace(/\\/gu, "/").toLowerCase();
}

/**
 * Checks whether the log contains a failing RED record associated with
 * `productionPath` for the active run.
 */
export function hasFailingTestForPath(
  entries: TddCycleEntry[],
  productionPath: string,
  options: { runId?: string } = {}
): boolean {
  const normalizedTarget = normalizePath(productionPath);
  const filtered = options.runId
    ? entries.filter((entry) => entry.runId === options.runId)
    : entries;

  for (const entry of filtered) {
    if (entry.phase !== "red") continue;
    if (entry.exitCode === undefined || entry.exitCode === 0) continue;
    if (!Array.isArray(entry.files) || entry.files.length === 0) continue;
    const hasMatch = entry.files.some((filePath) => {
      const normalized = normalizePath(filePath);
      return normalized === normalizedTarget || normalized.endsWith(`/${normalizedTarget}`);
    });
    if (hasMatch) {
      return true;
    }
  }
  return false;
}
