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
  /**
   * Optional acceptance-criterion IDs this log line relates to (e.g. `["AC-1"]`).
   * Used by the Ralph Loop status summary to surface how many ACs have been
   * closed by a GREEN cycle without forcing the user to track them manually.
   */
  acIds?: string[];
}

export interface TddCycleValidation {
  ok: boolean;
  issues: string[];
  openRedSlices: string[];
  sliceCount: number;
}

export interface TddCycleParseIssue {
  lineNumber: number;
  reason: string;
  rawLine: string;
}

export interface ParseTddCycleLogOptions {
  /**
   * Collect one issue per dropped/malformed line. Callers that care
   * (doctor, red-evidence) can surface them; hooks keep soft-fail.
   */
  issues?: TddCycleParseIssue[];
  /**
   * When true, reject lines that omit required fields instead of
   * back-filling them with defaults. Used by validation paths
   * (`validateTddCycleOrder`, `cclaw doctor`) to avoid silently
   * bucketing unscoped rows into "runId=active, stage=tdd". Soft paths
   * (generated hooks) keep the legacy defaults so a half-written file
   * never takes the session down.
   */
  strict?: boolean;
}

export function parseTddCycleLog(
  text: string,
  options: ParseTddCycleLogOptions = {}
): TddCycleEntry[] {
  const issues = options.issues;
  const strict = options.strict === true;
  const out: TddCycleEntry[] = [];
  // Strip a leading UTF-8 BOM on the whole blob so the first line parses
  // cleanly; `trim()` handles BOM on subsequent lines through the same
  // codepath (empty/whitespace-only lines are skipped).
  const normalized = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const lines = normalized.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const raw = lines[index] ?? "";
    const line = raw.trim();
    if (!line) continue;
    const lineNumber = index + 1;
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(line) as Record<string, unknown>;
    } catch (err) {
      issues?.push({
        lineNumber,
        reason: `json-parse-failed: ${err instanceof Error ? err.message : String(err)}`,
        rawLine: raw
      });
      continue;
    }
    const phase = parsed.phase;
    if (phase !== "red" && phase !== "green" && phase !== "refactor") {
      issues?.push({
        lineNumber,
        reason: `invalid-phase: ${JSON.stringify(parsed.phase)}`,
        rawLine: raw
      });
      continue;
    }
    const runIdField = typeof parsed.runId === "string" ? parsed.runId : null;
    const stageField = typeof parsed.stage === "string" ? parsed.stage : null;
    const sliceField = typeof parsed.slice === "string" ? parsed.slice : null;
    if (strict) {
      const missing: string[] = [];
      if (!runIdField) missing.push("runId");
      if (!stageField) missing.push("stage");
      if (!sliceField) missing.push("slice");
      if (missing.length > 0) {
        issues?.push({
          lineNumber,
          reason: `missing-required-fields: ${missing.join(",")}`,
          rawLine: raw
        });
        continue;
      }
    }
    const entry: TddCycleEntry = {
      ts: typeof parsed.ts === "string" ? parsed.ts : "",
      runId: runIdField ?? "active",
      stage: stageField ?? "tdd",
      slice: sliceField ?? "S-unknown",
      phase,
      command: typeof parsed.command === "string" ? parsed.command : "",
      files: Array.isArray(parsed.files)
        ? parsed.files.filter((item): item is string => typeof item === "string")
        : undefined,
      exitCode: typeof parsed.exitCode === "number" ? parsed.exitCode : undefined,
      note: typeof parsed.note === "string" ? parsed.note : undefined,
      acIds: Array.isArray(parsed.acIds)
        ? parsed.acIds
            .filter((item): item is string => typeof item === "string" && item.length > 0)
        : undefined
    };
    out.push(entry);
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

export interface RalphLoopSliceState {
  slice: string;
  redCount: number;
  greenCount: number;
  refactorCount: number;
  redOpen: boolean;
  acIds: string[];
}

export interface RalphLoopStatus {
  schemaVersion: 1;
  runId: string;
  /**
   * Number of RED -> GREEN cycles observed for the run — a rough "Ralph Loop"
   * iteration counter that mirrors how many passing tests the loop has
   * delivered so far.
   */
  loopIteration: number;
  redOpen: boolean;
  redOpenSlices: string[];
  acClosed: string[];
  sliceCount: number;
  slices: RalphLoopSliceState[];
  lastUpdatedAt: string;
}

/**
 * Derive a lightweight Ralph Loop summary from parsed tdd-cycle-log entries.
 * The goal is to give the model a single source of truth for "am I done
 * iterating?" — it collapses per-slice progress and distinct closed AC IDs
 * (from GREEN rows) into a single artifact the next-command contract reads.
 */
export function computeRalphLoopStatus(
  entries: TddCycleEntry[],
  options: { runId?: string; now?: Date } = {}
): RalphLoopStatus {
  const runId = options.runId ?? "active";
  const filtered = entries.filter((entry) =>
    options.runId ? entry.runId === options.runId : true
  );
  const slicesMap = new Map<string, RalphLoopSliceState>();
  const acClosedSet = new Set<string>();
  let loopIteration = 0;
  const redOpenSlices: string[] = [];

  for (const slice of Array.from(new Set(filtered.map((entry) => entry.slice)))) {
    slicesMap.set(slice, {
      slice,
      redCount: 0,
      greenCount: 0,
      refactorCount: 0,
      redOpen: false,
      acIds: []
    });
  }

  for (const entry of filtered) {
    const state = slicesMap.get(entry.slice);
    if (!state) continue;
    if (entry.phase === "red") {
      state.redCount += 1;
      if (entry.exitCode !== undefined && entry.exitCode !== 0) {
        state.redOpen = true;
      }
      continue;
    }
    if (entry.phase === "green") {
      state.greenCount += 1;
      state.redOpen = false;
      loopIteration += 1;
      if (Array.isArray(entry.acIds)) {
        for (const acId of entry.acIds) {
          acClosedSet.add(acId);
          if (!state.acIds.includes(acId)) state.acIds.push(acId);
        }
      }
      continue;
    }
    state.refactorCount += 1;
  }

  for (const state of slicesMap.values()) {
    if (state.redOpen) redOpenSlices.push(state.slice);
  }

  const slices = Array.from(slicesMap.values()).sort((a, b) =>
    a.slice.localeCompare(b.slice, "en")
  );

  return {
    schemaVersion: 1,
    runId,
    loopIteration,
    redOpen: redOpenSlices.length > 0,
    redOpenSlices,
    acClosed: Array.from(acClosedSet).sort(),
    sliceCount: slices.length,
    slices,
    lastUpdatedAt: (options.now ?? new Date()).toISOString()
  };
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
