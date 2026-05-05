import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { RUNTIME_ROOT } from "../constants.js";
import { ensureDir, exists, withDirectoryLock, writeFileSafe } from "../fs-utils.js";
import type { FlowStage } from "../types.js";
import type { LintFinding } from "./shared.js";

/**
 * linter-dedup cache. The linter persists a per-stage
 * fingerprint of each finding between runs so authors can tell at a
 * glance what's `new`, `repeat`, or `resolved` relative to the last run.
 *
 * Fingerprint = `sha256(stage | rule | normalizedDetail).slice(0, 8)`.
 * Details are normalized to stabilize the digest: whitespace collapsed,
 * run-ids/hashes/timestamps replaced with placeholders, and enumeration
 * counts (e.g. "3 approach detail card(s)") replaced with `<N>`.
 *
 * The cache is intentionally bounded by `MAX_PER_STAGE` so a noisy stage
 * can't grow the sidecar without bound. When the active run trims the
 * cache we drop the oldest `firstSeenAt` entries first.
 */
const FINDINGS_CACHE_REL_PATH = `${RUNTIME_ROOT}/.linter-findings.json`;
const FINDINGS_CACHE_LOCK_REL_PATH = `${RUNTIME_ROOT}/.linter-findings.json.lock`;
export const FINDINGS_CACHE_SCHEMA_VERSION = 1;
const MAX_PER_STAGE = 200;

export type FindingStatus =
  | { kind: "new" }
  | { kind: "repeat"; count: number }
  | { kind: "resolved" };

export interface ClassifiedFinding {
  finding: LintFinding;
  fingerprint: string;
  status: FindingStatus;
}

export interface ResolvedFinding {
  fingerprint: string;
  rule: string;
  lastSeenAt: string;
}

export interface FindingsDedupSummary {
  newCount: number;
  repeatCount: number;
  resolvedCount: number;
  resolved: ResolvedFinding[];
}

export interface LintRunDedupResult {
  classified: ClassifiedFinding[];
  summary: FindingsDedupSummary;
  header: string;
}

interface FindingEntry {
  fingerprint: string;
  rule: string;
  section: string;
  firstSeenAt: string;
  lastSeenAt: string;
  runCount: number;
}

interface StageCache {
  findings: FindingEntry[];
  lastRunAt: string | null;
}

interface FindingsCacheFile {
  schemaVersion: number;
  stages: Partial<Record<FlowStage, StageCache>>;
}

function cachePath(projectRoot: string): string {
  return path.join(projectRoot, FINDINGS_CACHE_REL_PATH);
}

function cacheLockPath(projectRoot: string): string {
  return path.join(projectRoot, FINDINGS_CACHE_LOCK_REL_PATH);
}

function emptyStageCache(): StageCache {
  return { findings: [], lastRunAt: null };
}

function emptyCacheFile(): FindingsCacheFile {
  return { schemaVersion: FINDINGS_CACHE_SCHEMA_VERSION, stages: {} };
}

/**
 * Normalize a finding detail string so volatile tokens (run IDs,
 * timestamps, counts, hex hashes, temp paths) don't cause a finding
 * to appear "new" on every invocation.
 */
export function normalizeFindingDetail(detail: string): string {
  if (typeof detail !== "string" || detail.length === 0) return "";
  let normalized = detail;
  normalized = normalized.replace(/\brun-[a-z0-9-]+\b/giu, "run-<id>");
  normalized = normalized.replace(/\b[0-9a-f]{16,}\b/giu, "<hex>");
  normalized = normalized.replace(
    /\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z?\b/gu,
    "<ts>"
  );
  normalized = normalized.replace(/\b\d{10,}\b/gu, "<n>");
  normalized = normalized.replace(/\b\d+\b/gu, "<n>");
  normalized = normalized.replace(/[ \t]+/gu, " ");
  normalized = normalized.replace(/\r?\n/gu, " ");
  return normalized.trim().toLowerCase();
}

export function fingerprintFinding(stage: FlowStage, finding: LintFinding): string {
  const payload = `${stage}|${finding.rule.trim()}|${normalizeFindingDetail(finding.details)}`;
  return createHash("sha256").update(payload, "utf8").digest("hex").slice(0, 8);
}

async function readCacheFile(projectRoot: string): Promise<FindingsCacheFile> {
  const filePath = cachePath(projectRoot);
  if (!(await exists(filePath))) return emptyCacheFile();
  let raw: string;
  try {
    raw = await fs.readFile(filePath, "utf8");
  } catch {
    return emptyCacheFile();
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return emptyCacheFile();
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return emptyCacheFile();
  }
  const typed = parsed as Record<string, unknown>;
  const stages = (typed.stages ?? {}) as Record<string, unknown>;
  const next: FindingsCacheFile = emptyCacheFile();
  for (const [stageKey, value] of Object.entries(stages)) {
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    const rawStage = value as Record<string, unknown>;
    const findingsRaw = Array.isArray(rawStage.findings) ? rawStage.findings : [];
    const findings: FindingEntry[] = [];
    for (const row of findingsRaw) {
      if (!row || typeof row !== "object" || Array.isArray(row)) continue;
      const r = row as Record<string, unknown>;
      const fingerprint = typeof r.fingerprint === "string" ? r.fingerprint : "";
      const rule = typeof r.rule === "string" ? r.rule : "";
      const section = typeof r.section === "string" ? r.section : "";
      const firstSeenAt = typeof r.firstSeenAt === "string" ? r.firstSeenAt : "";
      const lastSeenAt = typeof r.lastSeenAt === "string" ? r.lastSeenAt : "";
      const runCount = typeof r.runCount === "number" && Number.isFinite(r.runCount)
        ? Math.max(1, Math.floor(r.runCount))
        : 1;
      if (fingerprint.length === 0 || rule.length === 0) continue;
      findings.push({ fingerprint, rule, section, firstSeenAt, lastSeenAt, runCount });
    }
    next.stages[stageKey as FlowStage] = {
      findings,
      lastRunAt: typeof rawStage.lastRunAt === "string" ? rawStage.lastRunAt : null
    };
  }
  return next;
}

async function writeCacheFile(
  projectRoot: string,
  cache: FindingsCacheFile
): Promise<void> {
  await ensureDir(path.dirname(cachePath(projectRoot)));
  await writeFileSafe(
    cachePath(projectRoot),
    `${JSON.stringify(cache, null, 2)}\n`,
    { mode: 0o600 }
  );
}

/**
 * Classify each emitted finding as `new`, `repeat:N`, or `resolved`
 * relative to the cached sidecar for this stage. Persists the updated
 * fingerprint set under a directory lock so concurrent lint runs for
 * the same project don't clobber each other.
 *
 * The returned `header` is a short human string intended for inclusion
 * above the linter output; it's stable across runs when findings
 * repeat. Empty string when there is nothing meaningful to report
 * (no findings and no carry-over state).
 */
export async function classifyAndPersistFindings(
  projectRoot: string,
  stage: FlowStage,
  findings: LintFinding[],
  options: { now?: Date } = {}
): Promise<LintRunDedupResult> {
  const nowIso = (options.now ?? new Date()).toISOString();
  return withDirectoryLock(cacheLockPath(projectRoot), async () => {
    const cache = await readCacheFile(projectRoot);
    const previous = cache.stages[stage] ?? emptyStageCache();
    const previousByFingerprint = new Map<string, FindingEntry>();
    for (const entry of previous.findings) {
      previousByFingerprint.set(entry.fingerprint, entry);
    }

    const currentFingerprints = new Set<string>();
    const classified: ClassifiedFinding[] = [];
    const nextFindings: FindingEntry[] = [];
    let newCount = 0;
    let repeatCount = 0;

    for (const finding of findings) {
      const fingerprint = fingerprintFinding(stage, finding);
      currentFingerprints.add(fingerprint);
      const prior = previousByFingerprint.get(fingerprint);
      if (prior) {
        const nextEntry: FindingEntry = {
          fingerprint,
          rule: finding.rule,
          section: finding.section,
          firstSeenAt: prior.firstSeenAt || nowIso,
          lastSeenAt: nowIso,
          runCount: prior.runCount + 1
        };
        nextFindings.push(nextEntry);
        repeatCount += 1;
        classified.push({
          finding,
          fingerprint,
          status: { kind: "repeat", count: nextEntry.runCount }
        });
        continue;
      }
      const nextEntry: FindingEntry = {
        fingerprint,
        rule: finding.rule,
        section: finding.section,
        firstSeenAt: nowIso,
        lastSeenAt: nowIso,
        runCount: 1
      };
      nextFindings.push(nextEntry);
      newCount += 1;
      classified.push({
        finding,
        fingerprint,
        status: { kind: "new" }
      });
    }

    const resolved: ResolvedFinding[] = [];
    for (const entry of previous.findings) {
      if (currentFingerprints.has(entry.fingerprint)) continue;
      resolved.push({
        fingerprint: entry.fingerprint,
        rule: entry.rule,
        lastSeenAt: entry.lastSeenAt
      });
    }

    nextFindings.sort((a, b) => {
      const aTime = Date.parse(a.firstSeenAt);
      const bTime = Date.parse(b.firstSeenAt);
      return Number.isFinite(aTime) && Number.isFinite(bTime) ? aTime - bTime : 0;
    });
    const trimmed =
      nextFindings.length > MAX_PER_STAGE
        ? nextFindings.slice(nextFindings.length - MAX_PER_STAGE)
        : nextFindings;

    cache.stages[stage] = {
      findings: trimmed,
      lastRunAt: nowIso
    };
    await writeCacheFile(projectRoot, cache);

    const summary: FindingsDedupSummary = {
      newCount,
      repeatCount,
      resolvedCount: resolved.length,
      resolved
    };
    const header = buildDedupHeader(stage, summary);
    return { classified, summary, header };
  });
}

export function buildDedupHeader(
  stage: FlowStage,
  summary: FindingsDedupSummary
): string {
  const parts: string[] = [];
  if (summary.newCount > 0) parts.push(`${summary.newCount} new`);
  if (summary.repeatCount > 0) parts.push(`${summary.repeatCount} repeat`);
  if (summary.resolvedCount > 0) parts.push(`${summary.resolvedCount} resolved`);
  if (parts.length === 0) return "";
  return `linter findings (stage=${stage}): ${parts.join(", ")}.`;
}

export function formatFindingStatusTag(status: FindingStatus): string {
  if (status.kind === "new") return "[new]";
  if (status.kind === "resolved") return "[resolved]";
  return `[repeat:${status.count}]`;
}

export function findingsDedupCachePathFor(projectRoot: string): string {
  return cachePath(projectRoot);
}
