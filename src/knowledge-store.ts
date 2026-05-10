import fs from "node:fs/promises";
import path from "node:path";
import { KNOWLEDGE_LOG_REL_PATH } from "./constants.js";
import { exists, writeFileSafe } from "./fs-utils.js";

export interface KnowledgeEntry {
  slug: string;
  ship_commit: string;
  shipped_at: string;
  signals: {
    hasArchitectDecision: boolean;
    reviewIterations: number;
    securityFlag: boolean;
    userRequestedCapture: boolean;
  };
  refines?: string | null;
  notes?: string;
  tags?: string[];
  /**
   * Files / dirs the AC list of this slug touched (union across all AC).
   * Optional because legacy entries written before v8.9 do not have it; the
   * dedup helper treats an absent field as "no signal".
   */
  touchSurface?: string[];
  /**
   * When this entry's `touchSurface ∪ tags` overlap a recent shipped entry by
   * the dedup threshold, this points at that earlier slug. The new entry is
   * still appended (the jsonl is append-only) — this is metadata for
   * `learnings-research` and human readers, not a redirect.
   *
   * `null` or absent means "no near-duplicate detected".
   */
  dedupeOf?: string | null;
}

/**
 * Tunables for {@link findNearDuplicate}. Defaults are deliberately
 * conservative: window = recent 50 entries, similarity = 0.6 Jaccard.
 */
export interface NearDuplicateOptions {
  /** Number of most recent entries to scan. Default: 50. */
  windowSize?: number;
  /** Minimum Jaccard similarity (0-1) for a hit. Default: 0.6. */
  jaccardThreshold?: number;
}

export interface NearDuplicateMatch {
  entry: KnowledgeEntry;
  similarity: number;
}

export class KnowledgeStoreError extends Error {}

export function knowledgeLogPath(projectRoot: string): string {
  return path.join(projectRoot, KNOWLEDGE_LOG_REL_PATH);
}

function assertEntry(value: unknown): asserts value is KnowledgeEntry {
  if (typeof value !== "object" || value === null) {
    throw new KnowledgeStoreError("Knowledge entry must be an object.");
  }
  const entry = value as KnowledgeEntry;
  for (const key of ["slug", "ship_commit", "shipped_at"] as const) {
    if (typeof entry[key] !== "string" || entry[key].length === 0) {
      throw new KnowledgeStoreError(`Knowledge entry must include string ${key}.`);
    }
  }
  if (typeof entry.signals !== "object" || entry.signals === null) {
    throw new KnowledgeStoreError("Knowledge entry must include a `signals` object.");
  }
  if (entry.touchSurface !== undefined && entry.touchSurface !== null) {
    if (!Array.isArray(entry.touchSurface) || entry.touchSurface.some((item) => typeof item !== "string")) {
      throw new KnowledgeStoreError("Knowledge entry `touchSurface` must be an array of strings when present.");
    }
  }
  if (entry.tags !== undefined && entry.tags !== null) {
    if (!Array.isArray(entry.tags) || entry.tags.some((item) => typeof item !== "string")) {
      throw new KnowledgeStoreError("Knowledge entry `tags` must be an array of strings when present.");
    }
  }
  if (entry.dedupeOf !== undefined && entry.dedupeOf !== null && typeof entry.dedupeOf !== "string") {
    throw new KnowledgeStoreError("Knowledge entry `dedupeOf` must be a string when present.");
  }
}

function jaccard(a: ReadonlySet<string>, b: ReadonlySet<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const item of a) {
    if (b.has(item)) intersection += 1;
  }
  const union = a.size + b.size - intersection;
  if (union === 0) return 0;
  return intersection / union;
}

function signatureSet(entry: KnowledgeEntry): ReadonlySet<string> {
  const tokens = new Set<string>();
  for (const item of entry.touchSurface ?? []) tokens.add(`path:${item}`);
  for (const item of entry.tags ?? []) tokens.add(`tag:${item}`);
  return tokens;
}

export async function appendKnowledgeEntry(projectRoot: string, entry: KnowledgeEntry): Promise<void> {
  assertEntry(entry);
  const target = knowledgeLogPath(projectRoot);
  const line = `${JSON.stringify(entry)}\n`;
  if (!(await exists(target))) {
    await writeFileSafe(target, line);
    return;
  }
  await fs.appendFile(target, line, "utf8");
}

export async function readKnowledgeLog(projectRoot: string): Promise<KnowledgeEntry[]> {
  const target = knowledgeLogPath(projectRoot);
  if (!(await exists(target))) return [];
  const raw = await fs.readFile(target, "utf8");
  const lines = raw.split(/\r?\n/u).filter((line) => line.trim().length > 0);
  const entries: KnowledgeEntry[] = [];
  for (const line of lines) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch (err) {
      throw new KnowledgeStoreError(`Invalid JSON line in knowledge.jsonl: ${(err as Error).message}`);
    }
    assertEntry(parsed);
    entries.push(parsed);
  }
  return entries;
}

/**
 * Scan the most recent shipped entries for a near-duplicate of `candidate`,
 * computing Jaccard similarity over `tags ∪ touchSurface`. Returns the entry
 * with the highest similarity if it crosses {@link NearDuplicateOptions.jaccardThreshold}.
 *
 * Behaviour notes:
 *
 * - When `candidate` has no `tags` and no `touchSurface`, similarity is 0
 *   against every entry and `null` is returned (no false positives on legacy
 *   metadata-less entries).
 * - When the recent-window contains the same slug as `candidate`, that
 *   entry is excluded — `findNearDuplicate` is asymmetric (it answers
 *   "should this new entry note a prior duplicate?", not "are these two
 *   already linked?").
 * - Window is most recent N entries by file order (we never sort by
 *   `shipped_at` because clock skew across machines is real and the file is
 *   already chronological per shipping host).
 */
export async function findNearDuplicate(
  projectRoot: string,
  candidate: KnowledgeEntry,
  options: NearDuplicateOptions = {}
): Promise<NearDuplicateMatch | null> {
  const { windowSize = 50, jaccardThreshold = 0.6 } = options;
  if (jaccardThreshold <= 0 || jaccardThreshold > 1) {
    throw new KnowledgeStoreError(`jaccardThreshold must be in (0, 1]; got ${jaccardThreshold}.`);
  }
  const candidateSet = signatureSet(candidate);
  if (candidateSet.size === 0) return null;
  const all = await readKnowledgeLog(projectRoot);
  const window = all.slice(-Math.max(1, windowSize));
  let best: NearDuplicateMatch | null = null;
  for (const entry of window) {
    if (entry.slug === candidate.slug) continue;
    const similarity = jaccard(candidateSet, signatureSet(entry));
    if (similarity < jaccardThreshold) continue;
    if (!best || similarity > best.similarity) {
      best = { entry, similarity };
    }
  }
  return best;
}

export async function findRefiningChain(projectRoot: string, slug: string): Promise<KnowledgeEntry[]> {
  const all = await readKnowledgeLog(projectRoot);
  const bySlug = new Map<string, KnowledgeEntry>();
  for (const entry of all) bySlug.set(entry.slug, entry);
  const chain: KnowledgeEntry[] = [];
  let cursor: string | null | undefined = slug;
  const seen = new Set<string>();
  while (cursor !== null && cursor !== undefined && bySlug.has(cursor) && !seen.has(cursor)) {
    const found: KnowledgeEntry = bySlug.get(cursor) as KnowledgeEntry;
    chain.push(found);
    seen.add(cursor);
    cursor = found.refines ?? null;
  }
  return chain;
}
