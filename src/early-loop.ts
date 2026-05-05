import fs from "node:fs/promises";
import { DEFAULT_EARLY_LOOP_MAX_ITERATIONS } from "./config.js";

export const EARLY_LOOP_STAGES = ["brainstorm", "scope", "design"] as const;
export type EarlyLoopStage = (typeof EARLY_LOOP_STAGES)[number];

export type EarlyLoopConcernSeverity = "critical" | "important" | "suggestion";

export interface EarlyLoopConcern {
  id: string;
  severity: EarlyLoopConcernSeverity;
  locator: string;
  summary: string;
  firstSeenIteration: number;
  lastSeenIteration: number;
  resolvedAtIteration?: number;
}

export interface EarlyLoopStatus {
  schemaVersion: 1;
  stage: EarlyLoopStage;
  runId: string;
  iteration: number;
  maxIterations: number;
  openConcerns: EarlyLoopConcern[];
  resolvedConcerns: EarlyLoopConcern[];
  lastSeenConcernIds: string[];
  convergenceTripped: boolean;
  escalationReason?: string;
  lastUpdatedAt: string;
}

export function clampEarlyLoopStatusForWrite(status: EarlyLoopStatus): {
  status: EarlyLoopStatus;
  clampedFrom: number | null;
} {
  if (status.iteration <= status.maxIterations) {
    return { status, clampedFrom: null };
  }
  return {
    status: {
      ...status,
      iteration: status.maxIterations
    },
    clampedFrom: status.iteration
  };
}

export interface EarlyLoopLogConcern {
  id: string;
  severity: EarlyLoopConcernSeverity;
  locator: string;
  summary: string;
}

export interface EarlyLoopLogEntry {
  ts: string;
  runId: string;
  stage: string;
  iteration?: number;
  concerns: EarlyLoopLogConcern[];
  resolvedConcernIds: string[];
}

export interface EarlyLoopParseIssue {
  lineNumber: number;
  reason: string;
  rawLine: string;
}

export interface ParseEarlyLoopLogOptions {
  issues?: EarlyLoopParseIssue[];
  strict?: boolean;
}

export interface DeriveEarlyLoopStatusOptions {
  stage: EarlyLoopStage;
  runId: string;
  maxIterations?: number;
  now?: Date;
}

export interface ComputeEarlyLoopStatusOptions {
  maxIterations?: number;
  now?: Date;
  parseIssues?: EarlyLoopParseIssue[];
  strictParse?: boolean;
}

const CONCERN_ID_PREFIX = "C-";

function severityWeight(severity: EarlyLoopConcernSeverity): number {
  if (severity === "critical") return 3;
  if (severity === "important") return 2;
  return 1;
}

function normalizeSeverity(value: unknown): EarlyLoopConcernSeverity {
  if (value === "critical" || value === "important" || value === "suggestion") {
    return value;
  }
  return "important";
}

function normalizeText(value: unknown, fallback: string): string {
  if (typeof value !== "string") return fallback;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : fallback;
}

function stableConcernFallbackId(locator: string, summary: string): string {
  const seed = `${locator}::${summary}`.trim().toLowerCase();
  let hash = 0;
  for (let index = 0; index < seed.length; index += 1) {
    hash = (Math.imul(31, hash) + seed.charCodeAt(index)) >>> 0;
  }
  return `${CONCERN_ID_PREFIX}${hash.toString(16).padStart(8, "0")}`;
}

function normalizeConcernId(id: unknown, locator: string, summary: string): string {
  if (typeof id === "string") {
    const trimmed = id.trim();
    if (trimmed.length > 0) {
      return trimmed;
    }
  }
  return stableConcernFallbackId(locator, summary);
}

function normalizeConcerns(value: unknown): EarlyLoopLogConcern[] {
  if (!Array.isArray(value)) return [];
  const concerns: EarlyLoopLogConcern[] = [];
  for (const row of value) {
    if (!row || typeof row !== "object" || Array.isArray(row)) continue;
    const typed = row as Record<string, unknown>;
    const locator = normalizeText(typed.locator, "unknown-location");
    const summary = normalizeText(typed.summary, "missing-summary");
    concerns.push({
      id: normalizeConcernId(typed.id, locator, summary),
      severity: normalizeSeverity(typed.severity),
      locator,
      summary
    });
  }
  return concerns;
}

function normalizeResolvedConcernIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

export function isEarlyLoopStage(value: unknown): value is EarlyLoopStage {
  return typeof value === "string" && (EARLY_LOOP_STAGES as readonly string[]).includes(value);
}

export function normalizeEarlyLoopMaxIterations(value: number | undefined): number {
  if (typeof value === "number" && Number.isInteger(value) && value >= 1) {
    return value;
  }
  return DEFAULT_EARLY_LOOP_MAX_ITERATIONS;
}

export function parseEarlyLoopLog(
  text: string,
  options: ParseEarlyLoopLogOptions = {}
): EarlyLoopLogEntry[] {
  const strict = options.strict === true;
  const issues = options.issues;
  const normalized = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const lines = normalized.split(/\r?\n/u);
  const entries: EarlyLoopLogEntry[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const raw = lines[index] ?? "";
    const line = raw.trim();
    if (line.length === 0) continue;
    const lineNumber = index + 1;
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(line) as Record<string, unknown>;
    } catch (error) {
      issues?.push({
        lineNumber,
        reason: `json-parse-failed: ${error instanceof Error ? error.message : String(error)}`,
        rawLine: raw
      });
      continue;
    }

    const runId = normalizeText(parsed.runId, "");
    const stage = normalizeText(parsed.stage, "");
    const concerns = normalizeConcerns(parsed.concerns);
    const resolvedConcernIds = normalizeResolvedConcernIds(parsed.resolvedConcernIds);
    const iteration =
      typeof parsed.iteration === "number" &&
      Number.isInteger(parsed.iteration) &&
      parsed.iteration >= 1
        ? parsed.iteration
        : undefined;

    if (strict) {
      const missing: string[] = [];
      if (runId.length === 0) missing.push("runId");
      if (stage.length === 0) missing.push("stage");
      if (concerns.length === 0 && resolvedConcernIds.length === 0) {
        missing.push("concerns/resolvedConcernIds");
      }
      if (missing.length > 0) {
        issues?.push({
          lineNumber,
          reason: `missing-required-fields: ${missing.join(",")}`,
          rawLine: raw
        });
        continue;
      }
    }

    // schema repair: legacy logs may carry rows with no runId
    // (the prior parser silently coerced them to "active", which then
    // collided across runs). Surface a structured warning on read but
    // skip the row so derived status doesn't fold cross-run state.
    // Writers must always provide a runId (enforced upstream in the
    // CLI/hook surface).
    if (runId.length === 0) {
      issues?.push({
        lineNumber,
        reason: "missing-runId: legacy entry skipped to avoid cross-run pollution",
        rawLine: raw
      });
      continue;
    }

    entries.push({
      ts: normalizeText(parsed.ts, ""),
      runId,
      stage: stage.length > 0 ? stage : "brainstorm",
      iteration,
      concerns,
      resolvedConcernIds
    });
  }

  return entries;
}

function sortConcerns(a: EarlyLoopConcern, b: EarlyLoopConcern): number {
  const severityDiff = severityWeight(b.severity) - severityWeight(a.severity);
  if (severityDiff !== 0) return severityDiff;
  if (a.firstSeenIteration !== b.firstSeenIteration) {
    return a.firstSeenIteration - b.firstSeenIteration;
  }
  if (a.lastSeenIteration !== b.lastSeenIteration) {
    return a.lastSeenIteration - b.lastSeenIteration;
  }
  return a.id.localeCompare(b.id, "en");
}

export function deriveEarlyLoopStatus(
  entries: EarlyLoopLogEntry[],
  options: DeriveEarlyLoopStatusOptions
): EarlyLoopStatus {
  const maxIterations = normalizeEarlyLoopMaxIterations(options.maxIterations);
  const concerns = new Map<string, EarlyLoopConcern>();
  const filtered = entries.filter((entry) => entry.runId === options.runId && entry.stage === options.stage);

  let previousConcernSnapshotKey = "";
  let sameConcernStreak = 0;
  let convergenceTripped = false;
  let escalationReason: string | undefined;
  let currentIteration = 0;
  let lastSeenConcernIds: string[] = [];

  for (const entry of filtered) {
    currentIteration += 1;
    const iteration = entry.iteration ?? currentIteration;
    const seenThisIteration = new Set<string>();

    for (const concern of entry.concerns) {
      seenThisIteration.add(concern.id);
      const existing = concerns.get(concern.id);
      if (!existing) {
        concerns.set(concern.id, {
          id: concern.id,
          severity: concern.severity,
          locator: concern.locator,
          summary: concern.summary,
          firstSeenIteration: iteration,
          lastSeenIteration: iteration
        });
        continue;
      }
      existing.lastSeenIteration = iteration;
      existing.locator = concern.locator;
      existing.summary = concern.summary;
      if (severityWeight(concern.severity) >= severityWeight(existing.severity)) {
        existing.severity = concern.severity;
      }
      delete existing.resolvedAtIteration;
    }

    for (const concernId of entry.resolvedConcernIds) {
      const existing = concerns.get(concernId);
      if (!existing) continue;
      if (seenThisIteration.has(concernId)) continue;
      if (existing.resolvedAtIteration === undefined) {
        existing.resolvedAtIteration = iteration;
      }
    }

    for (const concern of concerns.values()) {
      if (concern.resolvedAtIteration !== undefined) continue;
      if (seenThisIteration.has(concern.id)) continue;
      concern.resolvedAtIteration = iteration;
    }

    const openConcernIds = Array.from(concerns.values())
      .filter((concern) => concern.resolvedAtIteration === undefined)
      .map((concern) => concern.id)
      .sort((a, b) => a.localeCompare(b, "en"));
    lastSeenConcernIds = openConcernIds;

    const snapshotKey = openConcernIds.join("|");
    if (snapshotKey.length > 0 && snapshotKey === previousConcernSnapshotKey) {
      sameConcernStreak += 1;
      if (!convergenceTripped && sameConcernStreak >= 2) {
        convergenceTripped = true;
        escalationReason = `same concerns ${sameConcernStreak} iterations in a row`;
      }
    } else {
      sameConcernStreak = snapshotKey.length > 0 ? 1 : 0;
    }
    previousConcernSnapshotKey = snapshotKey;
  }

  const openConcerns = Array.from(concerns.values())
    .filter((concern) => concern.resolvedAtIteration === undefined)
    .sort(sortConcerns);
  const resolvedConcerns = Array.from(concerns.values())
    .filter((concern): concern is EarlyLoopConcern & Required<Pick<EarlyLoopConcern, "resolvedAtIteration">> =>
      concern.resolvedAtIteration !== undefined
    )
    .sort((a, b) => {
      if (a.resolvedAtIteration !== b.resolvedAtIteration) {
        return a.resolvedAtIteration - b.resolvedAtIteration;
      }
      return sortConcerns(a, b);
    });

  if (!convergenceTripped && openConcerns.length > 0 && currentIteration >= maxIterations) {
    convergenceTripped = true;
    escalationReason = `max iterations ${maxIterations} reached with ${openConcerns.length} open concern(s)`;
  }

  const iteration = Math.min(currentIteration, maxIterations);

  return {
    schemaVersion: 1,
    stage: options.stage,
    runId: options.runId,
    iteration,
    maxIterations,
    openConcerns,
    resolvedConcerns,
    lastSeenConcernIds,
    convergenceTripped,
    ...(escalationReason ? { escalationReason } : {}),
    lastUpdatedAt: (options.now ?? new Date()).toISOString()
  };
}

export async function computeEarlyLoopStatus(
  stage: EarlyLoopStage,
  runId: string,
  concernsLogPath: string,
  options: ComputeEarlyLoopStatusOptions = {}
): Promise<EarlyLoopStatus> {
  let raw = "";
  try {
    raw = await fs.readFile(concernsLogPath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
  }
  const parsed = parseEarlyLoopLog(raw, {
    issues: options.parseIssues,
    strict: options.strictParse
  });
  return deriveEarlyLoopStatus(parsed, {
    stage,
    runId,
    maxIterations: options.maxIterations,
    now: options.now
  });
}

export function formatEarlyLoopStatusLine(status: EarlyLoopStatus): string {
  const convergence = status.convergenceTripped ? "tripped" : "clear";
  return `Early Loop: stage=${status.stage}, iter=${status.iteration}/${status.maxIterations}, open=${status.openConcerns.length}, convergence=${convergence}`;
}
