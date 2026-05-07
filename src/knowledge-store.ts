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
