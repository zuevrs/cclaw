import fs from "node:fs/promises";
import path from "node:path";
import { DEFAULT_COMPOUND_RECURRENCE_THRESHOLD } from "./config.js";
import { RUNTIME_ROOT } from "./constants.js";
import { stripBom, withDirectoryLock } from "./fs-utils.js";
import { FLOW_STAGES, type FlowStage } from "./types.js";

export type KnowledgeEntryType = "rule" | "pattern" | "lesson" | "compound";
export type KnowledgeEntryConfidence = "high" | "medium" | "low";
export type KnowledgeEntrySeverity = "critical" | "important" | "suggestion";
export type KnowledgeEntrySource = "stage" | "retro" | "compound" | "idea" | "manual";

export interface KnowledgeEntry {
  type: KnowledgeEntryType;
  trigger: string;
  action: string;
  confidence: KnowledgeEntryConfidence;
  severity?: KnowledgeEntrySeverity;
  stage: FlowStage | null;
  origin_stage: FlowStage | null;
  frequency: number;
  created: string;
  first_seen_ts: string;
  last_seen_ts: string;
  project: string | null;
  source?: KnowledgeEntrySource | null;
}

export interface KnowledgeSeedEntry {
  type: KnowledgeEntryType;
  trigger: string;
  action: string;
  confidence: KnowledgeEntryConfidence;
  severity?: KnowledgeEntrySeverity;
  stage?: FlowStage | null;
  origin_stage?: FlowStage | null;
  frequency?: number;
  created?: string;
  first_seen_ts?: string;
  last_seen_ts?: string;
  project?: string | null;
  source?: KnowledgeEntrySource | null;
}

export interface AppendKnowledgeDefaults {
  stage?: FlowStage | null;
  originStage?: FlowStage | null;
  project?: string | null;
  source?: KnowledgeEntrySource | null;
  nowIso?: string;
}

export interface AppendKnowledgeResult {
  appended: number;
  skippedDuplicates: number;
  invalid: number;
  errors: string[];
  appendedEntries: KnowledgeEntry[];
}

export interface ReadKnowledgeOptions {
  lockAware?: boolean;
}

export interface ReadKnowledgeResult {
  entries: KnowledgeEntry[];
  malformedLines: number;
}

export interface SelectRelevantLearningsOptions {
  stage?: FlowStage | null;
  branch?: string | null;
  diffFiles?: string[];
  openGates?: string[];
  limit?: number;
}

/**
 * One clustered (trigger, action) group ready for compound lift.
 *
 * A cluster "qualifies" when its recurrence count meets the configured
 * threshold **or** any contributing entry is marked `severity: "critical"`.
 * The skill surface exposes this for nudging — it is not a gate.
 */
export interface CompoundReadinessCluster {
  trigger: string;
  action: string;
  /**
   * Sum of `frequency` across entries in the cluster — matches the
   * recurrence count used by compound readiness analysis.
   */
  recurrence: number;
  /** Distinct entry lines contributing to this cluster. */
  entryCount: number;
  qualification: "recurrence" | "critical_override";
  severity?: KnowledgeEntrySeverity;
  lastSeenTs: string;
  /** Entry types observed (rule/pattern/lesson/compound). */
  types: KnowledgeEntryType[];
}

export interface CompoundReadiness {
  schemaVersion: 2;
  /**
   * Effective recurrence threshold actually used. When
   * `archivedRunsCount < SMALL_PROJECT_ARCHIVE_RUNS_THRESHOLD`, this is
   * `min(baseThreshold, SMALL_PROJECT_RECURRENCE_THRESHOLD)` — otherwise
   * it equals `baseThreshold`.
   */
  threshold: number;
  /** Base threshold from config/CLI before small-project relaxation. */
  baseThreshold: number;
  /**
   * Archived-run count observed at compute time (used to gate the
   * small-project relaxation). Optional — the computation can run
   * without knowing this and then no relaxation is applied.
   */
  archivedRunsCount?: number;
  /**
   * True iff the effective threshold was lowered by the small-project
   * relaxation rule. Always false when `archivedRunsCount` is not
   * supplied.
   */
  smallProjectRelaxationApplied: boolean;
  /** Total number of (trigger, action) clusters seen, regardless of threshold. */
  clusterCount: number;
  /** Number of clusters that passed the threshold or critical override. */
  readyCount: number;
  /**
   * Top ready clusters (sorted by qualification severity / recurrence /
   * recency). Capped by `maxReady` to keep the artifact small.
   */
  ready: CompoundReadinessCluster[];
  lastUpdatedAt: string;
}

export interface ComputeCompoundReadinessOptions {
  threshold?: number;
  /** Hard cap on `ready[]` to keep the surface digest concise. Default 10. */
  maxReady?: number;
  now?: Date;
  /**
   * Count of archived runs under `.cclaw/archive/`. When supplied and
   * `< SMALL_PROJECT_ARCHIVE_RUNS_THRESHOLD`, the effective threshold
   * is lowered to `min(threshold, SMALL_PROJECT_RECURRENCE_THRESHOLD)`.
   * Matches the rule documented in `docs/config.md`.
   */
  archivedRunsCount?: number;
}

const DEFAULT_COMPOUND_READINESS_MAX_READY = 10;

/**
 * Single source of truth for the small-project relaxation rule.
 *
 * Kept exported so the inline hook mirror and CLI/runtime paths all agree on
 * the same numbers.
 */
export const SMALL_PROJECT_ARCHIVE_RUNS_THRESHOLD = 5;
export const SMALL_PROJECT_RECURRENCE_THRESHOLD = 2;

export function effectiveCompoundThreshold(
  baseThreshold: number,
  archivedRunsCount: number | undefined
): { threshold: number; relaxationApplied: boolean } {
  if (
    typeof archivedRunsCount === "number" &&
    Number.isFinite(archivedRunsCount) &&
    archivedRunsCount < SMALL_PROJECT_ARCHIVE_RUNS_THRESHOLD &&
    baseThreshold > SMALL_PROJECT_RECURRENCE_THRESHOLD
  ) {
    return {
      threshold: SMALL_PROJECT_RECURRENCE_THRESHOLD,
      relaxationApplied: true
    };
  }
  return { threshold: baseThreshold, relaxationApplied: false };
}

/**
 * Pure function — no filesystem side effects. Callers pass entries from
 * `readKnowledgeSafely` and get a derived readiness snapshot suitable
 * for persisting to `.cclaw/state/compound-readiness.json`.
 *
 * Clustering key: `(type, normalizeText(trigger), normalizeText(action))`
 * which mirrors the compound readiness clustering in runtime state.
 * The readiness surface intentionally stays simple: no maturity/supersede
 * suppression logic in this pass.
 */
export function computeCompoundReadiness(
  entries: KnowledgeEntry[],
  options: ComputeCompoundReadinessOptions = {}
): CompoundReadiness {
  const thresholdRaw = options.threshold ?? DEFAULT_COMPOUND_RECURRENCE_THRESHOLD;
  const baseThreshold =
    Number.isInteger(thresholdRaw) && thresholdRaw >= 1
      ? thresholdRaw
      : DEFAULT_COMPOUND_RECURRENCE_THRESHOLD;
  const maxReadyRaw = options.maxReady ?? DEFAULT_COMPOUND_READINESS_MAX_READY;
  const maxReady =
    Number.isInteger(maxReadyRaw) && maxReadyRaw >= 1
      ? maxReadyRaw
      : DEFAULT_COMPOUND_READINESS_MAX_READY;
  const now = options.now ?? new Date();
  const archivedRunsCount =
    typeof options.archivedRunsCount === "number" &&
    Number.isFinite(options.archivedRunsCount) &&
    options.archivedRunsCount >= 0
      ? Math.floor(options.archivedRunsCount)
      : undefined;
  const { threshold, relaxationApplied } = effectiveCompoundThreshold(
    baseThreshold,
    archivedRunsCount
  );

  const buckets = new Map<
    string,
    {
      trigger: string;
      action: string;
      recurrence: number;
      entryCount: number;
      severity?: KnowledgeEntrySeverity;
      lastSeenTs: string;
      types: Set<KnowledgeEntryType>;
    }
  >();

  for (const entry of entries) {
    const key = [
      entry.type,
      normalizeText(entry.trigger),
      normalizeText(entry.action)
    ].join("||");
    const frequency = Math.max(1, Math.floor(entry.frequency));
    const bucket = buckets.get(key);
    if (!bucket) {
      buckets.set(key, {
        trigger: entry.trigger,
        action: entry.action,
        recurrence: frequency,
        entryCount: 1,
        severity: entry.severity,
        lastSeenTs: entry.last_seen_ts,
        types: new Set([entry.type])
      });
      continue;
    }
    bucket.recurrence += frequency;
    bucket.entryCount += 1;
    bucket.types.add(entry.type);
    if (entry.severity === "critical") {
      bucket.severity = "critical";
    } else if (entry.severity === "important" && bucket.severity !== "critical") {
      bucket.severity = "important";
    }
    if (Date.parse(entry.last_seen_ts) > Date.parse(bucket.lastSeenTs)) {
      bucket.lastSeenTs = entry.last_seen_ts;
    }
  }

  const ready: CompoundReadinessCluster[] = [];
  for (const bucket of buckets.values()) {
    const criticalOverride = bucket.severity === "critical";
    const meetsRecurrence = bucket.recurrence >= threshold;
    if (!criticalOverride && !meetsRecurrence) continue;
    ready.push({
      trigger: bucket.trigger,
      action: bucket.action,
      recurrence: bucket.recurrence,
      entryCount: bucket.entryCount,
      qualification: criticalOverride && !meetsRecurrence ? "critical_override" : "recurrence",
      ...(bucket.severity ? { severity: bucket.severity } : {}),
      lastSeenTs: bucket.lastSeenTs,
      types: Array.from(bucket.types).sort()
    });
  }

  ready.sort((a, b) => {
    const severityWeight = (sev: KnowledgeEntrySeverity | undefined): number => {
      if (sev === "critical") return 3;
      if (sev === "important") return 2;
      if (sev === "suggestion") return 1;
      return 0;
    };
    const severityDiff = severityWeight(b.severity) - severityWeight(a.severity);
    if (severityDiff !== 0) return severityDiff;
    if (b.recurrence !== a.recurrence) return b.recurrence - a.recurrence;
    const recencyDiff = Date.parse(b.lastSeenTs) - Date.parse(a.lastSeenTs);
    if (!Number.isNaN(recencyDiff) && recencyDiff !== 0) return recencyDiff;
    return a.trigger.localeCompare(b.trigger);
  });

  return {
    schemaVersion: 2,
    threshold,
    baseThreshold,
    ...(archivedRunsCount !== undefined ? { archivedRunsCount } : {}),
    smallProjectRelaxationApplied: relaxationApplied,
    clusterCount: buckets.size,
    readyCount: ready.length,
    ready: ready.slice(0, maxReady),
    lastUpdatedAt: normalizeUtcIso(now.toISOString())
  };
}

const KNOWLEDGE_TYPE_SET = new Set<KnowledgeEntryType>(["rule", "pattern", "lesson", "compound"]);
const KNOWLEDGE_CONFIDENCE_SET = new Set<KnowledgeEntryConfidence>(["high", "medium", "low"]);
const KNOWLEDGE_SEVERITY_SET = new Set<KnowledgeEntrySeverity>(["critical", "important", "suggestion"]);
const LEGACY_KNOWLEDGE_UNIVERSALITY_SET = new Set(["project", "personal", "universal"]);
const LEGACY_KNOWLEDGE_MATURITY_SET = new Set(["raw", "lifted-to-rule", "lifted-to-enforcement"]);
const KNOWLEDGE_SOURCE_SET = new Set<KnowledgeEntrySource>([
  "stage",
  "retro",
  "compound",
  "idea",
  "manual"
]);
const FLOW_STAGE_SET = new Set<FlowStage>(FLOW_STAGES);
const KNOWLEDGE_REQUIRED_KEYS = [
  "type",
  "trigger",
  "action",
  "confidence",
  "stage",
  "origin_stage",
  "frequency",
  "created",
  "first_seen_ts",
  "last_seen_ts",
  "project"
] as const;
const KNOWLEDGE_ALLOWED_KEYS = new Set<string>(KNOWLEDGE_REQUIRED_KEYS);
// Legacy keys are accepted for backwards compatibility when reading historical
// knowledge entries, but no longer required for newly materialized rows.
KNOWLEDGE_ALLOWED_KEYS.add("domain");
KNOWLEDGE_ALLOWED_KEYS.add("origin_run");
KNOWLEDGE_ALLOWED_KEYS.add("universality");
KNOWLEDGE_ALLOWED_KEYS.add("maturity");
KNOWLEDGE_ALLOWED_KEYS.add("source");
KNOWLEDGE_ALLOWED_KEYS.add("severity");
KNOWLEDGE_ALLOWED_KEYS.add("supersedes");
KNOWLEDGE_ALLOWED_KEYS.add("superseded_by");

function keyAllowedInKnowledgeEntry(key: string): boolean {
  return KNOWLEDGE_ALLOWED_KEYS.has(key);
}

function normalizeParsedKnowledgeEntry(obj: Record<string, unknown>): KnowledgeEntry {
  const normalized: KnowledgeEntry = {
    type: obj.type as KnowledgeEntryType,
    trigger: obj.trigger as string,
    action: obj.action as string,
    confidence: obj.confidence as KnowledgeEntryConfidence,
    stage: obj.stage as FlowStage | null,
    origin_stage: obj.origin_stage as FlowStage | null,
    frequency: obj.frequency as number,
    created: obj.created as string,
    first_seen_ts: obj.first_seen_ts as string,
    last_seen_ts: obj.last_seen_ts as string,
    project: obj.project as string | null
  };
  if (obj.severity !== undefined) {
    normalized.severity = obj.severity as KnowledgeEntrySeverity;
  }
  if (obj.source !== undefined) {
    normalized.source = obj.source as KnowledgeEntrySource | null;
  }
  return normalized;
}

function knowledgePath(projectRoot: string): string {
  return path.join(projectRoot, RUNTIME_ROOT, "knowledge.jsonl");
}

function knowledgeLockPath(projectRoot: string): string {
  return path.join(projectRoot, RUNTIME_ROOT, "state", ".knowledge.lock");
}

function normalizeUtcIso(iso: string): string {
  return iso.replace(/\.\d{3}Z$/u, "Z");
}

function nowUtcIso(): string {
  return normalizeUtcIso(new Date().toISOString());
}

function normalizeText(value: string): string {
  return value.trim().replace(/\s+/gu, " ").toLowerCase();
}

function dedupeKey(entry: Pick<
  KnowledgeEntry,
  "type" | "trigger" | "action" | "stage" | "origin_stage" | "project" | "source" | "severity"
>): string {
  return [
    entry.type,
    normalizeText(entry.trigger),
    normalizeText(entry.action),
    entry.stage ?? "null",
    entry.origin_stage ?? "null",
    entry.project === null ? "null" : normalizeText(entry.project),
    entry.source === undefined || entry.source === null ? "null" : entry.source,
    entry.severity === undefined ? "none" : entry.severity
  ].join("|");
}

interface KnowledgeSnapshot {
  lines: string[];
  entries: KnowledgeEntry[];
  malformedLines: number;
  keyToIndex: Map<string, number>;
  entryByIndex: Map<number, KnowledgeEntry>;
}

function emptyKnowledgeSnapshot(): KnowledgeSnapshot {
  return {
    lines: [],
    entries: [],
    malformedLines: 0,
    keyToIndex: new Map<string, number>(),
    entryByIndex: new Map<number, KnowledgeEntry>()
  };
}

function parseKnowledgeSnapshot(raw: string): KnowledgeSnapshot {
  const lines = stripBom(raw).split(/\r?\n/u);
  const entries: KnowledgeEntry[] = [];
  const keyToIndex = new Map<string, number>();
  const entryByIndex = new Map<number, KnowledgeEntry>();
  let malformedLines = 0;

  for (let i = 0; i < lines.length; i += 1) {
    const trimmed = lines[i]!.trim();
    if (trimmed.length === 0) continue;
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      const validated = validateKnowledgeEntry(parsed);
      if (!validated.ok) {
        malformedLines += 1;
        continue;
      }
      const entry = normalizeParsedKnowledgeEntry(parsed as Record<string, unknown>);
      entries.push(entry);
      const key = dedupeKey(entry);
      if (!keyToIndex.has(key)) {
        keyToIndex.set(key, i);
      }
      entryByIndex.set(i, entry);
    } catch {
      malformedLines += 1;
    }
  }

  return {
    lines,
    entries,
    malformedLines,
    keyToIndex,
    entryByIndex
  };
}

async function readKnowledgeSnapshot(filePath: string): Promise<KnowledgeSnapshot> {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return parseKnowledgeSnapshot(raw);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException | undefined)?.code;
    if (code === "ENOENT") {
      return emptyKnowledgeSnapshot();
    }
    throw error;
  }
}

function mergeKnowledgeOccurrence(target: KnowledgeEntry, incoming: KnowledgeEntry): KnowledgeEntry {
  const mergedFrequency = target.frequency + Math.max(1, incoming.frequency);
  const mergedLastSeen = target.last_seen_ts >= incoming.last_seen_ts
    ? target.last_seen_ts
    : incoming.last_seen_ts;
  return {
    ...target,
    frequency: mergedFrequency,
    last_seen_ts: mergedLastSeen
  };
}

function isIsoUtcTimestamp(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/u.test(value);
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function isNullableStage(value: unknown): value is FlowStage | null {
  return value === null || (typeof value === "string" && FLOW_STAGE_SET.has(value as FlowStage));
}

export function validateKnowledgeEntry(
  entry: unknown
): { ok: boolean; errors: string[] } {
  const errors: string[] = [];
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
    return { ok: false, errors: ["Knowledge entry must be a JSON object."] };
  }
  const obj = entry as Record<string, unknown>;

  for (const key of Object.keys(obj)) {
    if (!keyAllowedInKnowledgeEntry(key)) {
      errors.push(`Unknown key "${key}" in knowledge entry.`);
    }
  }
  for (const key of KNOWLEDGE_REQUIRED_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(obj, key)) {
      errors.push(`Missing required key "${key}".`);
    }
  }

  if (!KNOWLEDGE_TYPE_SET.has(obj.type as KnowledgeEntryType)) {
    errors.push("type must be one of: rule, pattern, lesson, compound.");
  }
  if (typeof obj.trigger !== "string" || obj.trigger.trim().length === 0) {
    errors.push("trigger must be a non-empty string.");
  }
  if (typeof obj.action !== "string" || obj.action.trim().length === 0) {
    errors.push("action must be a non-empty string.");
  }
  if (!KNOWLEDGE_CONFIDENCE_SET.has(obj.confidence as KnowledgeEntryConfidence)) {
    errors.push("confidence must be one of: high, medium, low.");
  }
  if (
    obj.severity !== undefined &&
    (typeof obj.severity !== "string" || !KNOWLEDGE_SEVERITY_SET.has(obj.severity as KnowledgeEntrySeverity))
  ) {
    errors.push("severity must be one of: critical, important, suggestion.");
  }
  if (obj.domain !== undefined && !isNullableString(obj.domain)) {
    errors.push("domain must be string or null.");
  }
  if (!isNullableStage(obj.stage)) {
    errors.push(`stage must be one of ${FLOW_STAGES.join(", ")} or null.`);
  }
  if (!isNullableStage(obj.origin_stage)) {
    errors.push(`origin_stage must be one of ${FLOW_STAGES.join(", ")} or null.`);
  }
  const originRun = obj.origin_run;
  if (originRun !== undefined && !isNullableString(originRun)) {
    errors.push("origin_run must be string or null.");
  }
  if (
    typeof obj.frequency !== "number" ||
    !Number.isInteger(obj.frequency) ||
    obj.frequency < 1
  ) {
    errors.push("frequency must be an integer >= 1.");
  }
  if (
    obj.universality !== undefined &&
    (typeof obj.universality !== "string" || !LEGACY_KNOWLEDGE_UNIVERSALITY_SET.has(obj.universality))
  ) {
    errors.push("universality must be one of: project, personal, universal.");
  }
  if (
    obj.maturity !== undefined &&
    (typeof obj.maturity !== "string" || !LEGACY_KNOWLEDGE_MATURITY_SET.has(obj.maturity))
  ) {
    errors.push("maturity must be one of: raw, lifted-to-rule, lifted-to-enforcement.");
  }
  for (const timestampField of ["created", "first_seen_ts", "last_seen_ts"] as const) {
    const value = obj[timestampField];
    if (typeof value !== "string" || !isIsoUtcTimestamp(value)) {
      errors.push(`${timestampField} must be ISO UTC (YYYY-MM-DDTHH:MM:SSZ).`);
    }
  }
  if (!isNullableString(obj.project)) {
    errors.push("project must be string or null.");
  }
  if (obj.supersedes !== undefined) {
    if (
      !Array.isArray(obj.supersedes) ||
      obj.supersedes.length === 0 ||
      obj.supersedes.some((value) => typeof value !== "string" || value.trim().length === 0)
    ) {
      errors.push("supersedes must be a non-empty array of strings when present.");
    }
  }
  if (
    obj.superseded_by !== undefined &&
    (typeof obj.superseded_by !== "string" || obj.superseded_by.trim().length === 0)
  ) {
    errors.push("superseded_by must be a non-empty string when present.");
  }
  const sourceAllowed =
    obj.source === undefined ||
    obj.source === null ||
    (
      typeof obj.source === "string" &&
      KNOWLEDGE_SOURCE_SET.has(obj.source as KnowledgeEntrySource)
    );
  if (!sourceAllowed) {
    errors.push("source must be one of: stage, retro, compound, idea, manual, or null.");
  }

  return { ok: errors.length === 0, errors };
}

export function materializeKnowledgeEntry(
  seed: KnowledgeSeedEntry,
  defaults: AppendKnowledgeDefaults = {}
): KnowledgeEntry {
  const now = normalizeUtcIso(defaults.nowIso ?? nowUtcIso());
  const stage = seed.stage ?? defaults.stage ?? null;
  const originStage = seed.origin_stage ?? defaults.originStage ?? stage ?? null;
  const source = seed.source ?? defaults.source ?? null;
  const entry: KnowledgeEntry = {
    type: seed.type,
    trigger: seed.trigger.trim(),
    action: seed.action.trim(),
    confidence: seed.confidence,
    stage,
    origin_stage: originStage,
    frequency: seed.frequency ?? 1,
    created: normalizeUtcIso(seed.created ?? now),
    first_seen_ts: normalizeUtcIso(seed.first_seen_ts ?? now),
    last_seen_ts: normalizeUtcIso(seed.last_seen_ts ?? now),
    project: seed.project ?? defaults.project ?? null
  };
  if (seed.severity !== undefined) {
    entry.severity = seed.severity;
  }
  if (source !== null) {
    entry.source = source;
  }
  return entry;
}

export async function readKnowledgeSafely(
  projectRoot: string,
  options: ReadKnowledgeOptions = {}
): Promise<ReadKnowledgeResult> {
  const filePath = knowledgePath(projectRoot);
  const read = async (): Promise<ReadKnowledgeResult> => {
    const snapshot = await readKnowledgeSnapshot(filePath);
    return {
      entries: snapshot.entries,
      malformedLines: snapshot.malformedLines
    };
  };

  if (options.lockAware === false) {
    return read();
  }

  return withDirectoryLock(knowledgeLockPath(projectRoot), read);
}

export async function appendKnowledge(
  projectRoot: string,
  seeds: KnowledgeSeedEntry[],
  defaults: AppendKnowledgeDefaults = {}
): Promise<AppendKnowledgeResult> {
  if (seeds.length === 0) {
    return { appended: 0, skippedDuplicates: 0, invalid: 0, errors: [], appendedEntries: [] };
  }

  const filePath = knowledgePath(projectRoot);
  const errors: string[] = [];
  const materialized: KnowledgeEntry[] = [];
  for (let i = 0; i < seeds.length; i += 1) {
    const seed = seeds[i]!;
    const entry = materializeKnowledgeEntry(seed, defaults);
    const validated = validateKnowledgeEntry(entry);
    if (!validated.ok) {
      errors.push(`entry #${i + 1}: ${validated.errors.join(" ")}`);
      continue;
    }
    materialized.push(entry);
  }

  let skippedDuplicates = 0;
  const appendedEntries: KnowledgeEntry[] = [];
  await withDirectoryLock(knowledgeLockPath(projectRoot), async () => {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    const snapshot = await readKnowledgeSnapshot(filePath);
    const updatedByIndex = new Map<number, KnowledgeEntry>();
    const batchEntries = new Map<string, KnowledgeEntry>();
    for (const entry of materialized) {
      const key = dedupeKey(entry);
      const existingIndex = snapshot.keyToIndex.get(key);
      if (existingIndex !== undefined) {
        skippedDuplicates += 1;
        const base = updatedByIndex.get(existingIndex) ?? snapshot.entryByIndex.get(existingIndex);
        if (base) {
          updatedByIndex.set(existingIndex, mergeKnowledgeOccurrence(base, entry));
        }
        continue;
      }
      const existingBatchEntry = batchEntries.get(key);
      if (existingBatchEntry) {
        skippedDuplicates += 1;
        batchEntries.set(key, mergeKnowledgeOccurrence(existingBatchEntry, entry));
        continue;
      }
      batchEntries.set(key, { ...entry });
    }
    appendedEntries.push(...batchEntries.values());

    if (updatedByIndex.size === 0 && batchEntries.size === 0) {
      return;
    }

    const rewrittenLines = snapshot.lines.map((line, index) => {
      const updated = updatedByIndex.get(index);
      return updated ? JSON.stringify(updated) : line;
    }).filter((line) => line.trim().length > 0);
    const linesToWrite = [
      ...rewrittenLines,
      ...Array.from(batchEntries.values(), (entry) => JSON.stringify(entry))
    ];
    if (linesToWrite.length > 0) {
      await fs.writeFile(filePath, `${linesToWrite.join("\n")}\n`, "utf8");
    }
  });

  return {
    appended: appendedEntries.length,
    skippedDuplicates,
    invalid: errors.length,
    errors,
    appendedEntries
  };
}

const SHORT_TECHNICAL_TOKEN_SET = new Set(["ci", "db", "ui", "qa", "ux"]);

function tokenizeText(value: string | null | undefined): string[] {
  if (!value) return [];
  const tokens: string[] = [];
  const matches = value.matchAll(/[A-Za-z0-9]+/gu);
  for (const match of matches) {
    const raw = match[0] ?? "";
    const normalized = raw.toLowerCase();
    if (normalized.length >= 3) {
      tokens.push(normalized);
      continue;
    }
    if (/^[A-Z]{2}$/u.test(raw) || SHORT_TECHNICAL_TOKEN_SET.has(normalized)) {
      tokens.push(normalized);
    }
  }
  return tokens;
}

function uniqueTokens(values: string[]): string[] {
  return [...new Set(values)];
}

function pathTokens(paths: string[] | undefined): string[] {
  if (!Array.isArray(paths) || paths.length === 0) return [];
  const tokens: string[] = [];
  for (const filePath of paths) {
    tokens.push(...tokenizeText(filePath));
  }
  return uniqueTokens(tokens);
}

export async function selectRelevantLearnings(
  projectRoot: string,
  options: SelectRelevantLearningsOptions = {}
): Promise<KnowledgeEntry[]> {
  const { entries } = await readKnowledgeSafely(projectRoot);
  if (entries.length === 0) {
    return [];
  }

  const stage = options.stage ?? null;
  const branchTokens = tokenizeText(options.branch ?? null);
  const diffTokens = pathTokens(options.diffFiles);
  const gateTokens = pathTokens(options.openGates);
  const limit =
    typeof options.limit === "number" && Number.isFinite(options.limit) && options.limit > 0
      ? Math.floor(options.limit)
      : 8;

  const ranked = entries.map((entry, index) => {
    let score = 0;

    let stageScore = 0;
    if (stage) {
      if (entry.stage === stage) {
        stageScore = 4;
      } else if (entry.origin_stage === stage) {
        stageScore = 3;
      }
      score += stageScore;
    }

    if (entry.confidence === "high") score += 2;
    if (entry.confidence === "medium") score += 1;
    if (entry.frequency >= 3) score += 1;

    const searchable = [
      ...tokenizeText(entry.trigger),
      ...tokenizeText(entry.action),
      ...tokenizeText(entry.project)
    ];
    const searchSet = new Set(searchable);

    let contextualScore = 0;
    for (const token of branchTokens) {
      if (searchSet.has(token)) contextualScore += 2;
    }
    for (const token of diffTokens) {
      if (searchSet.has(token)) contextualScore += 2;
    }
    for (const token of gateTokens) {
      if (searchSet.has(token)) contextualScore += 2;
    }
    score += contextualScore;

    if (stage && entry.stage === null && stageScore === 0 && contextualScore < 4) {
      score = 0;
    }

    return {
      index,
      score,
      entry
    };
  });

  ranked.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    const bySeen = Date.parse(b.entry.last_seen_ts) - Date.parse(a.entry.last_seen_ts);
    if (!Number.isNaN(bySeen) && bySeen !== 0) return bySeen;
    if (b.entry.frequency !== a.entry.frequency) return b.entry.frequency - a.entry.frequency;
    return b.index - a.index;
  });

  return ranked
    .filter((row) => row.score > 0)
    .slice(0, limit)
    .map((row) => row.entry);
}
