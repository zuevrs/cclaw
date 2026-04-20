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
  for (const raw of text.split(/\r?\n/)) {
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
      // refactor
      if (state !== "green_done") {
        issues.push(`slice ${slice}: refactor logged before green`);
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
