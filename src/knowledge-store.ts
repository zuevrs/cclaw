import fs from "node:fs/promises";
import path from "node:path";
import { RUNTIME_ROOT } from "./constants.js";
import { stripBom, withDirectoryLock } from "./fs-utils.js";
import { FLOW_STAGES, type FlowStage } from "./types.js";

export type KnowledgeEntryType = "rule" | "pattern" | "lesson" | "compound";
export type KnowledgeEntryConfidence = "high" | "medium" | "low";
export type KnowledgeEntrySeverity = "critical" | "important" | "suggestion";
export type KnowledgeEntryUniversality = "project" | "personal" | "universal";
export type KnowledgeEntryMaturity = "raw" | "lifted-to-rule" | "lifted-to-enforcement";
export type KnowledgeEntrySource = "stage" | "retro" | "compound" | "ideate" | "manual";

export interface KnowledgeEntry {
  type: KnowledgeEntryType;
  trigger: string;
  action: string;
  confidence: KnowledgeEntryConfidence;
  severity?: KnowledgeEntrySeverity;
  domain: string | null;
  stage: FlowStage | null;
  origin_stage: FlowStage | null;
  origin_feature: string | null;
  frequency: number;
  universality: KnowledgeEntryUniversality;
  maturity: KnowledgeEntryMaturity;
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
  domain?: string | null;
  stage?: FlowStage | null;
  origin_stage?: FlowStage | null;
  origin_feature?: string | null;
  frequency?: number;
  universality?: KnowledgeEntryUniversality;
  maturity?: KnowledgeEntryMaturity;
  created?: string;
  first_seen_ts?: string;
  last_seen_ts?: string;
  project?: string | null;
  source?: KnowledgeEntrySource | null;
}

export interface AppendKnowledgeDefaults {
  stage?: FlowStage | null;
  originStage?: FlowStage | null;
  originFeature?: string | null;
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

const KNOWLEDGE_TYPE_SET = new Set<KnowledgeEntryType>(["rule", "pattern", "lesson", "compound"]);
const KNOWLEDGE_CONFIDENCE_SET = new Set<KnowledgeEntryConfidence>(["high", "medium", "low"]);
const KNOWLEDGE_SEVERITY_SET = new Set<KnowledgeEntrySeverity>(["critical", "important", "suggestion"]);
const KNOWLEDGE_UNIVERSALITY_SET = new Set<KnowledgeEntryUniversality>(["project", "personal", "universal"]);
const KNOWLEDGE_MATURITY_SET = new Set<KnowledgeEntryMaturity>(["raw", "lifted-to-rule", "lifted-to-enforcement"]);
const KNOWLEDGE_SOURCE_SET = new Set<KnowledgeEntrySource>([
  "stage",
  "retro",
  "compound",
  "ideate",
  "manual"
]);
const FLOW_STAGE_SET = new Set<FlowStage>(FLOW_STAGES);
const KNOWLEDGE_REQUIRED_KEYS = [
  "type",
  "trigger",
  "action",
  "confidence",
  "domain",
  "stage",
  "origin_stage",
  "origin_feature",
  "frequency",
  "universality",
  "maturity",
  "created",
  "first_seen_ts",
  "last_seen_ts",
  "project"
] as const;
const KNOWLEDGE_ALLOWED_KEYS = new Set<string>(KNOWLEDGE_REQUIRED_KEYS);
KNOWLEDGE_ALLOWED_KEYS.add("source");
KNOWLEDGE_ALLOWED_KEYS.add("severity");

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
  "type" | "trigger" | "action" | "domain" | "stage" | "origin_stage" | "origin_feature" | "universality" | "project" | "source" | "severity"
>): string {
  return [
    entry.type,
    normalizeText(entry.trigger),
    normalizeText(entry.action),
    entry.domain === null ? "null" : normalizeText(entry.domain),
    entry.stage ?? "null",
    entry.origin_stage ?? "null",
    entry.origin_feature === null ? "null" : normalizeText(entry.origin_feature),
    entry.universality,
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
      const entry = parsed as KnowledgeEntry;
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

export function validateKnowledgeEntry(entry: unknown): { ok: boolean; errors: string[] } {
  const errors: string[] = [];
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
    return { ok: false, errors: ["Knowledge entry must be a JSON object."] };
  }
  const obj = entry as Record<string, unknown>;

  for (const key of Object.keys(obj)) {
    if (!KNOWLEDGE_ALLOWED_KEYS.has(key)) {
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
  if (!isNullableString(obj.domain)) {
    errors.push("domain must be string or null.");
  }
  if (!isNullableStage(obj.stage)) {
    errors.push(`stage must be one of ${FLOW_STAGES.join(", ")} or null.`);
  }
  if (!isNullableStage(obj.origin_stage)) {
    errors.push(`origin_stage must be one of ${FLOW_STAGES.join(", ")} or null.`);
  }
  if (!isNullableString(obj.origin_feature)) {
    errors.push("origin_feature must be string or null.");
  }
  if (
    typeof obj.frequency !== "number" ||
    !Number.isInteger(obj.frequency) ||
    obj.frequency < 1
  ) {
    errors.push("frequency must be an integer >= 1.");
  }
  if (!KNOWLEDGE_UNIVERSALITY_SET.has(obj.universality as KnowledgeEntryUniversality)) {
    errors.push("universality must be one of: project, personal, universal.");
  }
  if (!KNOWLEDGE_MATURITY_SET.has(obj.maturity as KnowledgeEntryMaturity)) {
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
  if (
    obj.source !== undefined &&
    obj.source !== null &&
    (typeof obj.source !== "string" || !KNOWLEDGE_SOURCE_SET.has(obj.source as KnowledgeEntrySource))
  ) {
    errors.push("source must be one of: stage, retro, compound, ideate, manual, or null.");
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
    domain: seed.domain ?? null,
    stage,
    origin_stage: originStage,
    origin_feature: seed.origin_feature ?? defaults.originFeature ?? null,
    frequency: seed.frequency ?? 1,
    universality: seed.universality ?? "project",
    maturity: seed.maturity ?? "raw",
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
