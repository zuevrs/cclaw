export interface ObservationRecord {
  ts?: string;
  event?: string;
  tool?: string;
  phase?: string;
  stage?: string;
  runId?: string;
  data?: unknown;
}

export type LearningSource = "observed" | "user-stated" | "inferred";
export type LearningType = "pitfall" | "pattern" | "preference";

export interface LearningRecord {
  ts: string;
  skill: string;
  type: LearningType;
  key: string;
  insight: string;
  confidence: number;
  source: LearningSource;
}

export interface SummarizeOutcome {
  candidates: LearningRecord[];
  appendable: LearningRecord[];
}

const ERROR_PATTERN = /(error|fail|timeout|exception)/iu;
const KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/u;

function parseJsonLine(line: string): Record<string, unknown> | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  try {
    const parsed = JSON.parse(trimmed);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

function toText(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return "";
  }
}

function asValidLearning(value: unknown): LearningRecord | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const obj = value as Record<string, unknown>;
  const ts = obj.ts;
  const skill = obj.skill;
  const type = obj.type;
  const key = obj.key;
  const insight = obj.insight;
  const confidence = obj.confidence;
  const source = obj.source;
  if (typeof ts !== "string" || !ts) return null;
  if (typeof skill !== "string" || !skill) return null;
  if (type !== "pitfall" && type !== "pattern" && type !== "preference") return null;
  if (typeof key !== "string" || !KEY_PATTERN.test(key)) return null;
  if (typeof insight !== "string" || insight.trim().length < 16) return null;
  if (typeof confidence !== "number" || !Number.isInteger(confidence) || confidence < 1 || confidence > 10) return null;
  if (source !== "observed" && source !== "user-stated" && source !== "inferred") return null;
  return {
    ts,
    skill,
    type,
    key,
    insight,
    confidence,
    source
  };
}

function normalizeToken(value: string): string {
  const normalized = value.trim().replace(/[^A-Za-z0-9._-]+/gu, "-");
  return normalized.replace(/^-+/u, "").replace(/-+$/u, "") || "unknown";
}

function maybeObservation(value: unknown): ObservationRecord | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const obj = value as Record<string, unknown>;
  return {
    ts: typeof obj.ts === "string" ? obj.ts : undefined,
    event: typeof obj.event === "string" ? obj.event : undefined,
    tool: typeof obj.tool === "string" ? obj.tool : undefined,
    phase: typeof obj.phase === "string" ? obj.phase : undefined,
    stage: typeof obj.stage === "string" ? obj.stage : undefined,
    runId: typeof obj.runId === "string" ? obj.runId : undefined,
    data: obj.data
  };
}

function bestByConfidence(candidates: LearningRecord[]): LearningRecord[] {
  const table = new Map<string, LearningRecord>();
  for (const candidate of candidates) {
    const token = `${candidate.key}:${candidate.type}`;
    const current = table.get(token);
    if (!current || candidate.confidence > current.confidence) {
      table.set(token, candidate);
    }
  }
  return Array.from(table.values());
}

function buildCandidates(observations: ObservationRecord[], timestamp: string): LearningRecord[] {
  const toolUsage = new Map<string, number>();
  const toolErrors = new Map<string, number>();
  const stageErrors = new Map<string, number>();
  const longPayload = new Map<string, number>();

  for (const obs of observations) {
    const tool = normalizeToken(obs.tool ?? "unknown");
    const stage = normalizeToken(obs.stage ?? "none");
    const payload = toText(obs.data);

    toolUsage.set(tool, (toolUsage.get(tool) ?? 0) + 1);
    if (payload.length >= 1500) {
      longPayload.set(tool, (longPayload.get(tool) ?? 0) + 1);
    }

    if ((obs.event ?? "") === "tool_complete" && ERROR_PATTERN.test(payload)) {
      toolErrors.set(tool, (toolErrors.get(tool) ?? 0) + 1);
      stageErrors.set(stage, (stageErrors.get(stage) ?? 0) + 1);
    }
  }

  const candidates: LearningRecord[] = [];
  for (const [tool, errors] of toolErrors.entries()) {
    if (errors < 3) continue;
    candidates.push({
      ts: timestamp,
      skill: "observation",
      type: "pitfall",
      key: `frequent-errors-${tool}`,
      insight: `Tool ${tool} produced ${errors} error-like completions in a single session; add a preflight checklist before using it.`,
      confidence: Math.min(9, 4 + Math.floor(errors / 2)),
      source: "observed"
    });
  }

  for (const [tool, total] of toolUsage.entries()) {
    if (total < 8) continue;
    const errors = toolErrors.get(tool) ?? 0;
    if (errors > Math.max(1, Math.floor(total * 0.15))) continue;
    candidates.push({
      ts: timestamp,
      skill: "observation",
      type: "pattern",
      key: `reliable-tool-${tool}`,
      insight: `Tool ${tool} was used ${total} times with low failure rate; prefer it as a first option for similar tasks.`,
      confidence: Math.min(8, 3 + Math.floor(total / 3)),
      source: "observed"
    });
  }

  for (const [stage, errors] of stageErrors.entries()) {
    if (stage === "none" || errors < 4) continue;
    candidates.push({
      ts: timestamp,
      skill: "observation",
      type: "pitfall",
      key: `stage-hotspot-${stage}`,
      insight: `Stage ${stage} produced ${errors} error-like tool completions in one session; add stage-specific checks before execution.`,
      confidence: Math.min(8, 3 + Math.floor(errors / 2)),
      source: "observed"
    });
  }

  for (const [tool, count] of longPayload.entries()) {
    if (count < 3) continue;
    candidates.push({
      ts: timestamp,
      skill: "observation",
      type: "preference",
      key: `truncate-heavy-payloads-${tool}`,
      insight: `Tool ${tool} produced large payloads repeatedly; summarize outputs earlier to avoid context pressure.`,
      confidence: Math.min(7, 3 + Math.floor(count / 2)),
      source: "observed"
    });
  }

  return bestByConfidence(candidates).filter((entry) => asValidLearning(entry) !== null);
}

function appendableCandidates(existing: LearningRecord[], candidates: LearningRecord[]): LearningRecord[] {
  const bestExisting = new Map<string, number>();
  for (const entry of existing) {
    const token = `${entry.key}:${entry.type}`;
    const current = bestExisting.get(token) ?? 0;
    if (entry.confidence > current) bestExisting.set(token, entry.confidence);
  }

  const appendable: LearningRecord[] = [];
  for (const candidate of candidates) {
    const token = `${candidate.key}:${candidate.type}`;
    const current = bestExisting.get(token) ?? 0;
    if (candidate.confidence > current) {
      appendable.push(candidate);
      bestExisting.set(token, candidate.confidence);
    }
  }

  return appendable;
}

export function summarizeObservationLearnings(
  observationJsonl: string,
  existingLearningsJsonl: string,
  timestamp: string
): SummarizeOutcome {
  const observations = observationJsonl
    .split(/\r?\n/gu)
    .map(parseJsonLine)
    .filter((value): value is Record<string, unknown> => value !== null)
    .map(maybeObservation)
    .filter((value): value is ObservationRecord => value !== null);

  const existing = existingLearningsJsonl
    .split(/\r?\n/gu)
    .map(parseJsonLine)
    .map((value) => (value ? asValidLearning(value) : null))
    .filter((value): value is LearningRecord => value !== null);

  const candidates = buildCandidates(observations, timestamp);
  const appendable = appendableCandidates(existing, candidates);
  return { candidates, appendable };
}
