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

/**
 * Tunables for {@link findNearKnowledge}. Defaults mirror the v8.18 brief
 * (window=100, threshold=0.4, limit=3) and were tuned around how compound's
 * knowledge writer populates `tags[]` + `touchSurface[]` + `notes` —
 * thresholds higher than 0.4 prune too aggressively on real-world entries
 * where the prompt tokens overlap only one tag.
 */
export interface NearKnowledgeOptions {
  /** Number of most recent entries to scan. Default: 100. */
  window?: number;
  /** Minimum Jaccard similarity (0-1) for a hit. Default: 0.4. */
  threshold?: number;
  /** Cap on returned hits, sorted by similarity desc. Default: 3. */
  limit?: number;
  /**
   * Exclude this slug from the candidate pool. The orchestrator passes the
   * active flow's slug so a re-search during the same flow never returns
   * the still-being-shipped entry as its own "prior learning".
   */
  excludeSlug?: string;
}

/**
 * Tokenise a free-form task summary into a Jaccard-comparable set.
 *
 * - lowercases the input
 * - splits on non-alphanumeric runs
 * - drops tokens shorter than 3 characters (filters out "a", "to", "of",
 *   path noise like `ts` / `js` / `0`, and other connective fragments
 *   that bloat the union without carrying signal)
 *
 * Stays prose-shaped on purpose — we score against the curated-signal
 * tokens an entry emits (its tags and path basenames; see
 * {@link entryTokensForSummaryMatch}), NOT against every word in every
 * filename, because path noise (`src`, `lib`, `components`, `tests`, …)
 * would otherwise dominate the union and pull every real hit below the
 * threshold.
 *
 * Exported for tests; callers should use {@link findNearKnowledge}.
 */
export function tokenizeTaskSummary(taskSummary: string): ReadonlySet<string> {
  const tokens = new Set<string>();
  for (const word of taskSummary.toLowerCase().split(/[^a-z0-9]+/u)) {
    if (word.length >= 3) tokens.add(word);
  }
  return tokens;
}

/**
 * Path-noise stopwords that show up in nearly every touchSurface entry
 * and would otherwise dominate the union. Tuned for TS/JS-shaped repos
 * (cclaw is one); extend conservatively — every word added here weakens
 * a real Jaccard hit on slugs that happen to share these tokens.
 */
const PATH_STOPWORDS = new Set([
  "src",
  "lib",
  "test",
  "tests",
  "spec",
  "specs",
  "dist",
  "node_modules",
  "components",
  "utils",
  "util",
  "helpers",
  "scripts",
  "common",
  "shared",
  "index",
  "main"
]);

/**
 * Tokens used to score a {@link KnowledgeEntry} against a tokenised task
 * summary. Curated signal only:
 *
 * - **Tags** — emitted as bare lowercase tokens (tags are the entry's
 *   self-chosen index; the highest-signal match surface).
 * - **TouchSurface paths** — only the **basename without extension** of
 *   each path is emitted, after splitting on non-alphanumeric runs and
 *   dropping path-noise stopwords (`src`, `lib`, `test`, …) and tokens
 *   <3 chars. The full directory chain is path noise that washes out
 *   real hits; the basename is where the per-slug signal lives.
 *
 * Same length-3 cutoff as the task-summary tokeniser so both sides of
 * the Jaccard live on the same alphabet shape.
 */
function entryTokensForSummaryMatch(entry: KnowledgeEntry): ReadonlySet<string> {
  const tokens = new Set<string>();
  for (const tag of entry.tags ?? []) {
    for (const part of tag.toLowerCase().split(/[^a-z0-9]+/u)) {
      if (part.length >= 3 && !PATH_STOPWORDS.has(part)) tokens.add(part);
    }
  }
  for (const surface of entry.touchSurface ?? []) {
    // Pull just the file name (no directory), strip the extension, then
    // tokenise. Mirrors how a user's task summary tends to mention the
    // module's name (`permissions`, `tooltip`) but never its full path.
    const lowered = surface.toLowerCase();
    const slashIdx = Math.max(lowered.lastIndexOf("/"), lowered.lastIndexOf("\\"));
    const fileName = slashIdx >= 0 ? lowered.slice(slashIdx + 1) : lowered;
    const dotIdx = fileName.lastIndexOf(".");
    const stem = dotIdx > 0 ? fileName.slice(0, dotIdx) : fileName;
    for (const part of stem.split(/[^a-z0-9]+/u)) {
      if (part.length >= 3 && !PATH_STOPWORDS.has(part)) tokens.add(part);
    }
  }
  return tokens;
}

/**
 * v8.18 — surface prior shipped slugs that look near the current task.
 *
 * Where {@link findNearDuplicate} answers "is this *new* entry a duplicate
 * of an already-shipped one?" (structured-vs-structured, append-time), this
 * answers "given the user's *task summary*, which prior entries should the
 * triage/specialists read as context?" — text-vs-structured, before any
 * specialist runs.
 *
 * Behaviour:
 *
 * - Returns `[]` when `knowledge.jsonl` is missing, empty, or unreadable.
 *   **Never throws** on a missing file — the early-project case where no
 *   entries exist yet is the most common one and must not break triage.
 * - Tokenises `taskSummary` with {@link tokenizeTaskSummary}, scores each
 *   recent-window entry with Jaccard against {@link entryTokensForSummaryMatch},
 *   and returns the top-`limit` hits with `similarity >= threshold`,
 *   sorted by similarity desc.
 * - Honours `options.excludeSlug` — when set, that slug is removed from
 *   the candidate pool (asymmetric: a slug never surfaces itself).
 * - Honours `options.window` — only the most recent N entries (by file
 *   order, no `shipped_at` sort) are scored.
 */
export async function findNearKnowledge(
  taskSummary: string,
  projectRoot: string,
  options: NearKnowledgeOptions = {}
): Promise<KnowledgeEntry[]> {
  const { window = 100, threshold = 0.4, limit = 3, excludeSlug } = options;
  if (typeof taskSummary !== "string" || taskSummary.trim().length === 0) return [];
  if (threshold <= 0 || threshold > 1) {
    throw new KnowledgeStoreError(`threshold must be in (0, 1]; got ${threshold}.`);
  }
  const taskTokens = tokenizeTaskSummary(taskSummary);
  if (taskTokens.size === 0) return [];

  let all: KnowledgeEntry[];
  try {
    all = await readKnowledgeLog(projectRoot);
  } catch {
    // Missing file → empty list. (`readKnowledgeLog` already returns [] when
    // the file is absent, but defensively swallow any read error so a
    // corrupted line never surfaces as a triage-time crash. The orchestrator
    // logs zero "prior learnings" and proceeds.)
    return [];
  }

  const recent = all.slice(-Math.max(0, window));
  const scored: Array<{ entry: KnowledgeEntry; similarity: number }> = [];
  for (const entry of recent) {
    if (excludeSlug && entry.slug === excludeSlug) continue;
    const entryTokens = entryTokensForSummaryMatch(entry);
    if (entryTokens.size === 0) continue;
    const similarity = jaccard(taskTokens, entryTokens);
    if (similarity < threshold) continue;
    scored.push({ entry, similarity });
  }
  scored.sort((a, b) => b.similarity - a.similarity);
  return scored.slice(0, Math.max(0, limit)).map((row) => row.entry);
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
