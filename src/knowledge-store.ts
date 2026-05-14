import fs from "node:fs/promises";
import path from "node:path";
import { KNOWLEDGE_LOG_REL_PATH } from "./constants.js";
import { exists, writeFileSafe } from "./fs-utils.js";

/**
 * v8.34 — categorical classification a shipped slug carries forward.
 *
 * Compound capture stamps the field from flow signals:
 *
 *   - `securityFlag: true` AND reviewer found a CVE-class finding → `bug`.
 *   - `bug-only` ship (reviewer's `block` cleared by fix-only edits) → `bug`.
 *   - `hasArchitectDecision: true` AND design Phase 4 D-N inlines a decision → `decision`.
 *   - reviewer's `perf` axis finding cleared → `performance`.
 *   - simplification rubric fired during REFACTOR AND no AC text changed → `refactor`.
 *   - everything else → `knowledge` (the prior implicit default).
 *
 * `findNearKnowledge` accepts an optional `problemType` filter; missing
 * values surface only under the `knowledge` filter (the implicit
 * default), preserving the back-compat contract from v8.18.
 */
export const PROBLEM_TYPES = [
  "bug",
  "knowledge",
  "decision",
  "performance",
  "refactor"
] as const;
export type ProblemType = (typeof PROBLEM_TYPES)[number];

function isProblemType(value: unknown): value is ProblemType {
  return typeof value === "string" && (PROBLEM_TYPES as readonly string[]).includes(value);
}

/**
 * v8.50 — outcome telemetry stamped on each `KnowledgeEntry` after the
 * slug is shipped. Closes the half-real loop in `knowledge.jsonl`: pre-
 * v8.50 entries were forward-only — captured at compound time, read at
 * triage time, never down-weighted when the slug they recorded turned
 * out to be a bad reference. v8.50 adds three automatic capture paths
 * (revert detection, follow-up-bug detection, manual-fix detection)
 * that stamp this signal on the affected entry, and routes the signal
 * through `findNearKnowledge` as a Jaccard-score multiplier so down-
 * weighted entries fall below the threshold sooner.
 *
 * The signal values are deliberately ordered worst → best:
 *
 * - `reverted` — the slug was reverted (commit message starts with
 *   `revert:` or `Revert "<slug-ref>"` matched a shipped slug). Heavy
 *   down-weight (near-exclusion) because the slug's authored direction
 *   is no longer trusted.
 * - `follow-up-bug` — a later slug's task description named this slug
 *   in a bug-fix context (e.g. `/cc fix the auth bug from v8.42`).
 *   Heavy down-weight; the slug's authored solution didn't hold.
 * - `manual-fix` — the slug's `touchSurface` saw a `fix(AC-N)` or
 *   hot-fix-style commit within the 24h after ship. Self-reported (the
 *   slug being captured marks itself), so be honest: this slug is now
 *   a less authoritative reference even though we cannot tell whether
 *   the manual fix was a real defect or a stylistic follow-up.
 * - `good` — the slug shipped clean and stayed clean. Reserved value;
 *   no automatic capture path writes it in v8.50 (would require
 *   active validation telemetry that we do not have yet).
 * - `unknown` — explicit "no signal recorded". Same multiplier as
 *   `good` (neutral, no weighting impact); the value exists so the
 *   field is non-`undefined` when a capture path runs but finds
 *   nothing actionable.
 *
 * Backwards compat: pre-v8.50 entries without the field are treated
 * exactly like `outcome_signal: "unknown"` (neutral). The field is
 * `?` optional on the type and `outcomeMultiplier(entry)` reads the
 * absent / `undefined` case as `1.0`.
 */
export const OUTCOME_SIGNALS = [
  "unknown",
  "good",
  "manual-fix",
  "follow-up-bug",
  "reverted"
] as const;
export type OutcomeSignal = (typeof OUTCOME_SIGNALS)[number];

function isOutcomeSignal(value: unknown): value is OutcomeSignal {
  return typeof value === "string" && (OUTCOME_SIGNALS as readonly string[]).includes(value);
}

/**
 * v8.50 — Jaccard-score multipliers per outcome signal. Applied in
 * {@link findNearKnowledge} AFTER the raw Jaccard similarity is
 * computed; the candidate's effective ranking score is
 * `similarity * OUTCOME_SIGNAL_MULTIPLIERS[signal]`. If the adjusted
 * score drops below the caller-supplied `threshold`, the candidate is
 * excluded (same gate the pre-v8.50 raw-similarity code used).
 *
 * The numbers are tuned for the v8.18 baseline threshold of `0.4`:
 *
 * - `good` / `unknown` → `1.0` (neutral; pre-v8.50 behaviour).
 * - `manual-fix` → `0.75` (light down-weight; a candidate that
 *   would have scored exactly `0.4` now scores `0.3` and falls
 *   below the threshold, so the down-weight bites at the margin).
 * - `follow-up-bug` → `0.5` (heavy down-weight; the candidate
 *   needs a raw similarity of `0.8` to clear the `0.4` threshold).
 * - `reverted` → `0.2` (near-exclusion; even a perfect raw
 *   similarity of `1.0` lands at `0.2`, well below `0.4` — the
 *   only way a reverted entry surfaces is if the caller drops
 *   the threshold or removes it).
 *
 * Exported so tests can assert the exact numbers and so future
 * tuning lives in one place (don't open-code the constants).
 */
export const OUTCOME_SIGNAL_MULTIPLIERS: Readonly<Record<OutcomeSignal, number>> = Object.freeze({
  unknown: 1.0,
  good: 1.0,
  "manual-fix": 0.75,
  "follow-up-bug": 0.5,
  reverted: 0.2
});

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
  /**
   * v8.34 — categorical classification (`bug` / `knowledge` / `decision`
   * / `performance` / `refactor`). Optional; missing reads as "knowledge"
   * (the prior implicit default). See {@link ProblemType} for the
   * compound-stamping rules.
   */
  problemType?: ProblemType | null;
  /**
   * v8.50 — outcome telemetry stamped after ship by one of the three
   * automatic capture paths (revert detection, follow-up-bug detection,
   * manual-fix detection). Drives the {@link OUTCOME_SIGNAL_MULTIPLIERS}
   * down-weight applied in {@link findNearKnowledge}.
   *
   * Optional for backwards compat: pre-v8.50 entries without the field
   * are treated as `"unknown"` (neutral; multiplier `1.0`). See
   * {@link OUTCOME_SIGNALS} for the value enum and capture-path
   * semantics.
   */
  outcome_signal?: OutcomeSignal;
  /**
   * v8.50 — ISO 8601 timestamp of the most recent
   * {@link outcome_signal} write. Stamped at the moment a capture path
   * (revert / follow-up-bug / manual-fix) updates the entry. Optional
   * for backwards compat and on entries whose signal is still
   * `"unknown"` / absent.
   */
  outcome_signal_updated_at?: string;
  /**
   * v8.50 — short free-text explanation of why the {@link outcome_signal}
   * has its current value, e.g. `"revert detected on a1b2c3d"`,
   * `"follow-up-bug slug 20260514-auth-fix"`, `"post-ship fix(AC-2) at
   * 5f2e7c1"`. The reviewer / specialists surface this string when they
   * cite a down-weighted prior so the user sees WHY a candidate was
   * pushed down. Optional; absent on entries with no signal recorded.
   */
  outcome_signal_source?: string;
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
  if (entry.problemType !== undefined && entry.problemType !== null && !isProblemType(entry.problemType)) {
    throw new KnowledgeStoreError(
      `Knowledge entry \`problemType\` must be one of ${JSON.stringify(PROBLEM_TYPES)} when present; got ${JSON.stringify(entry.problemType)}.`
    );
  }
  if (entry.outcome_signal !== undefined && !isOutcomeSignal(entry.outcome_signal)) {
    throw new KnowledgeStoreError(
      `Knowledge entry \`outcome_signal\` must be one of ${JSON.stringify(OUTCOME_SIGNALS)} when present; got ${JSON.stringify(entry.outcome_signal)}.`
    );
  }
  if (entry.outcome_signal_updated_at !== undefined && typeof entry.outcome_signal_updated_at !== "string") {
    throw new KnowledgeStoreError("Knowledge entry `outcome_signal_updated_at` must be a string when present.");
  }
  if (entry.outcome_signal_source !== undefined && typeof entry.outcome_signal_source !== "string") {
    throw new KnowledgeStoreError("Knowledge entry `outcome_signal_source` must be a string when present.");
  }
}

/**
 * v8.50 — read an entry's outcome signal, defaulting absent / `undefined`
 * to `"unknown"` (the neutral value). Exists so callers don't repeat
 * the `entry.outcome_signal ?? "unknown"` fallback at every read site.
 */
export function outcomeSignalOf(entry: KnowledgeEntry): OutcomeSignal {
  return entry.outcome_signal ?? "unknown";
}

/**
 * v8.50 — Jaccard-score multiplier for an entry, derived from
 * {@link outcomeSignalOf}. Absent / `undefined` signals read as
 * `"unknown"` and return `1.0` (no weighting impact). See
 * {@link OUTCOME_SIGNAL_MULTIPLIERS} for the numbers.
 */
export function outcomeMultiplier(entry: KnowledgeEntry): number {
  return OUTCOME_SIGNAL_MULTIPLIERS[outcomeSignalOf(entry)];
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
  /**
   * v8.34 — restrict the candidate pool to entries whose
   * {@link KnowledgeEntry.problemType} equals this value. Entries with
   * `problemType` absent / `undefined` surface ONLY under the `knowledge`
   * filter (the prior implicit default before v8.34). Entries with
   * `problemType: null` are treated identically to absent.
   *
   * Omit the option to retain pre-v8.34 behaviour (all problemType
   * values surface).
   */
  problemType?: ProblemType;
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
  const { window = 100, threshold = 0.4, limit = 3, excludeSlug, problemType } = options;
  if (typeof taskSummary !== "string" || taskSummary.trim().length === 0) return [];
  if (threshold <= 0 || threshold > 1) {
    throw new KnowledgeStoreError(`threshold must be in (0, 1]; got ${threshold}.`);
  }
  if (problemType !== undefined && !isProblemType(problemType)) {
    throw new KnowledgeStoreError(
      `problemType filter must be one of ${JSON.stringify(PROBLEM_TYPES)}; got ${JSON.stringify(problemType)}.`
    );
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
  const scored: Array<{ entry: KnowledgeEntry; similarity: number; adjusted: number }> = [];
  for (const entry of recent) {
    if (excludeSlug && entry.slug === excludeSlug) continue;
    if (problemType !== undefined && !matchesProblemType(entry, problemType)) continue;
    const entryTokens = entryTokensForSummaryMatch(entry);
    if (entryTokens.size === 0) continue;
    const similarity = jaccard(taskTokens, entryTokens);
    // v8.50 — apply outcome-signal multiplier BEFORE the threshold gate,
    // so a down-weighted prior (e.g. `reverted: 0.2`) is excluded the
    // moment its adjusted score drops below the caller's threshold,
    // even if the raw similarity would have passed. Pre-v8.50 entries
    // without `outcome_signal` get multiplier `1.0` (no behaviour
    // change at the gate; the absence-as-`unknown` rule is honoured by
    // {@link outcomeMultiplier}).
    const adjusted = similarity * outcomeMultiplier(entry);
    if (adjusted < threshold) continue;
    scored.push({ entry, similarity, adjusted });
  }
  // Sort by adjusted score so the multiplier shapes ranking (a perfect
  // raw match with a `reverted` signal MUST land below a 0.5-raw match
  // with a `good` signal). Tie-break on raw similarity to keep two
  // entries with equal adjusted scores ordered the way pre-v8.50 would
  // have ordered them (the higher-overlap one first).
  scored.sort((a, b) => b.adjusted - a.adjusted || b.similarity - a.similarity);
  return scored.slice(0, Math.max(0, limit)).map((row) => row.entry);
}

/**
 * v8.34 — does an entry's `problemType` match the requested filter?
 *
 * Back-compat rule (v8.18): absent / `null` `problemType` surfaces ONLY
 * under the `knowledge` filter — the prior implicit default. Every
 * other filter value (`bug` / `decision` / `performance` / `refactor`)
 * requires an exact string match.
 *
 * Exported for tests; callers should use {@link findNearKnowledge}.
 */
export function matchesProblemType(entry: KnowledgeEntry, filter: ProblemType): boolean {
  const value = entry.problemType;
  if (value === null || value === undefined) {
    return filter === "knowledge";
  }
  return value === filter;
}

/**
 * v8.50 — write an outcome signal back to the entry whose `slug` matches
 * `targetSlug`. Reads the whole `knowledge.jsonl` into memory, mutates
 * the matched entry, writes the file back via `writeFileSafe` (the
 * existing atomic-rename pattern compound uses). Pure append semantics
 * are preserved for OTHER entries; only the matched entry's
 * `outcome_signal`, `outcome_signal_updated_at`, and
 * `outcome_signal_source` fields are overwritten.
 *
 * Behaviour:
 *
 * - **No match (`targetSlug` not present in the log)** → returns
 *   `false`. The capture paths log a warning and move on; we do not
 *   crash compound or block ship because a revert / follow-up-bug
 *   reference pointed at a slug we never recorded.
 * - **Missing / empty `knowledge.jsonl`** → returns `false` (same
 *   reason; treat the absent log as "nothing to update").
 * - **Match found** → updates the entry's three outcome fields,
 *   re-serialises the whole file, returns `true`. The stamp at
 *   `outcome_signal_updated_at` is the caller-supplied ISO string —
 *   the function does not call `new Date()` so tests are
 *   deterministic.
 *
 * The function is NOT a generic CRUD: it only touches the three
 * outcome fields and only on the slug match. Other shape changes
 * (e.g. backfilling `problemType`) need their own helper. This keeps
 * v8.50's "automatic loop closure" boundary tight: capture paths can
 * only stamp signals; they cannot rewrite slugs / tags / surfaces /
 * notes.
 */
export async function setOutcomeSignal(
  projectRoot: string,
  targetSlug: string,
  signal: OutcomeSignal,
  source: string,
  updatedAt: string
): Promise<boolean> {
  if (!isOutcomeSignal(signal)) {
    throw new KnowledgeStoreError(
      `setOutcomeSignal: signal must be one of ${JSON.stringify(OUTCOME_SIGNALS)}; got ${JSON.stringify(signal)}.`
    );
  }
  if (typeof targetSlug !== "string" || targetSlug.length === 0) {
    throw new KnowledgeStoreError("setOutcomeSignal: targetSlug must be a non-empty string.");
  }
  const target = knowledgeLogPath(projectRoot);
  if (!(await exists(target))) return false;
  const entries = await readKnowledgeLog(projectRoot);
  const idx = entries.findIndex((entry) => entry.slug === targetSlug);
  if (idx === -1) return false;
  const next: KnowledgeEntry = {
    ...entries[idx]!,
    outcome_signal: signal,
    outcome_signal_updated_at: updatedAt,
    outcome_signal_source: source
  };
  entries[idx] = next;
  const body = `${entries.map((entry) => JSON.stringify(entry)).join("\n")}\n`;
  await writeFileSafe(target, body);
  return true;
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
