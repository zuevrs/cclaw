import fs from "node:fs/promises";
import path from "node:path";
import { KNOWLEDGE_LOG_REL_PATH } from "./constants.js";
import { exists } from "./fs-utils.js";

/**
 * categorical classification a shipped slug carries forward.
 *
 * cclaw is a prompt toolkit; the LLM writes `.cclaw/knowledge.jsonl`
 * entries directly via `Write` / `Bash`. The TypeScript helpers in
 * this module are the READ side only (consumed by `cli.ts` for the
 * `cclaw knowledge` command). Capture / append / outcome-stamping
 * are LLM-executed via the prompt body — see `runbooks/triage-gate.md`
 * and `runbooks/compound-refresh.md` for the schema. The v8.109
 * honesty sweep deleted the dead TS write helpers (`appendKnowledgeEntry`,
 * `setOutcomeSignal`, `findNearKnowledge`, etc.) that were never
 * invoked from `cli.ts`; the field schema this file declares is the
 * surviving contract.
 *
 * `problemType` is referenced by entries the LLM writes — missing
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
 * outcome telemetry stamped on each `KnowledgeEntry` after the slug
 * is shipped. The values close the half-real loop in `knowledge.jsonl`:
 * a shipped slug starts with `outcome_signal: "unknown"` and is
 * down-weighted by future capture paths (revert detection,
 * follow-up-bug detection, manual-fix detection) when subsequent
 * activity proves the slug's authored direction stopped holding.
 *
 * Pre-v8.109 the capture paths were implemented as TypeScript helpers
 * (`setOutcomeSignal`, `applyFollowUpBugSignals`, `runCompoundAndShip`)
 * that were never invoked from `cli.ts`. cclaw is a prompt toolkit —
 * the LLM performs the captures via prompt instructions and writes
 * the JSONL directly. The enum and multiplier table below survive as
 * the schema authority (consumed by the LLM via prompt content + by
 * `cli.ts` for entry validation in `readKnowledgeLog`).
 *
 * Values, worst → best:
 *
 * - `reverted` — the slug was reverted. Heavy down-weight.
 * - `follow-up-bug` — a later slug's task description named this slug
 *   in a bug-fix context. Heavy down-weight.
 * - `manual-fix` — the slug's `touchSurface` saw a `fix(AC-N)` or
 *   hot-fix-style commit within the 24h after ship.
 * - `good` — the slug shipped clean and stayed clean. Reserved.
 * - `unknown` — explicit "no signal recorded".
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
   * Optional because legacy entries written before do not have it.
   */
  touchSurface?: string[];
  /**
   * When this entry's `touchSurface ∪ tags` overlap a recent shipped entry
   * by the dedup threshold at compound capture time, the LLM stamps this
   * with the prior slug's id. The new entry is still appended (the jsonl is
   * append-only) — this is metadata for `learnings-research` and human
   * readers, not a redirect.
   */
  dedupeOf?: string | null;
  /**
   * categorical classification (`bug` / `knowledge` / `decision`
   * / `performance` / `refactor`). Optional; missing reads as "knowledge"
   * (the prior implicit default).
   */
  problemType?: ProblemType | null;
  /**
   * outcome telemetry stamped after ship by an LLM-executed capture
   * path (revert detection / follow-up-bug detection / manual-fix
   * detection). See {@link OUTCOME_SIGNALS} for the value enum.
   */
  outcome_signal?: OutcomeSignal;
  /**
   * ISO 8601 timestamp of the most recent {@link outcome_signal} write.
   */
  outcome_signal_updated_at?: string;
  /**
   * short free-text explanation of why the {@link outcome_signal}
   * has its current value, e.g. `"revert detected on a1b2c3d"`.
   */
  outcome_signal_source?: string;
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
 * Read `.cclaw/state/knowledge.jsonl` and return its entries.
 *
 * Consumed by `cli.ts` for the `cclaw knowledge` listing command —
 * the only production runtime read path. Missing file → `[]`.
 * Malformed JSON → {@link KnowledgeStoreError}.
 */
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
 * does an entry's `problemType` match the requested filter?
 *
 * Back-compat rule (v8.18): absent / `null` `problemType` surfaces ONLY
 * under the `knowledge` filter — the prior implicit default. Every
 * other filter value (`bug` / `decision` / `performance` / `refactor`)
 * requires an exact string match.
 */
export function matchesProblemType(entry: KnowledgeEntry, filter: ProblemType): boolean {
  const value = entry.problemType;
  if (value === null || value === undefined) {
    return filter === "knowledge";
  }
  return value === filter;
}
