import fs from "node:fs/promises";
import path from "node:path";
import { parse } from "yaml";
import { RUNTIME_ROOT } from "../constants.js";

const SEED_FILE_NAME_PATTERN = /^SEED-(\d{4}-\d{2}-\d{2})-([a-z0-9]+(?:-[a-z0-9]+)*)(?:-(\d+))?\.md$/u;
const DEFAULT_MAX_MATCHES = 3;
const MAX_SEED_MATCHES = 10;
const MIN_TOKEN_OVERLAP = 2;

interface ParsedFrontmatter {
  values: Record<string, unknown>;
  body: string;
}

export interface SeedShelfEntry {
  fileName: string;
  absPath: string;
  relPath: string;
  createdOn: string;
  title: string;
  triggerWhen: string[];
  sourceStage: string | null;
  sourceArtifact: string | null;
  hypothesis: string | null;
  action: string | null;
  summary: string;
  raw: string;
}

export interface SeedTemplateInput {
  title: string;
  triggerWhen: readonly string[];
  hypothesis: string;
  action: string;
  sourceStage?: string;
  sourceArtifact?: string;
  createdAt?: Date;
}

export interface ResolvedSeedPath {
  fileName: string;
  absPath: string;
  relPath: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeTriggerList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .map((item) =>
        typeof item === "string" || typeof item === "number" ? String(item).trim() : ""
      )
      .filter((item) => item.length > 0);
  }
  if (typeof value === "string") {
    return value
      .split(/,\s*/u)
      .map((item) => item.trim())
      .filter((item) => item.length > 0);
  }
  return [];
}

function parseSeedFrontmatter(raw: string): ParsedFrontmatter {
  if (!raw.startsWith("---")) {
    return { values: {}, body: raw };
  }
  const lines = raw.split(/\r?\n/u);
  let closingIndex = -1;
  for (let index = 1; index < lines.length; index += 1) {
    if (lines[index]?.trim() === "---") {
      closingIndex = index;
      break;
    }
  }
  if (closingIndex < 0) {
    return { values: {}, body: raw };
  }
  const frontmatterRaw = lines.slice(1, closingIndex).join("\n");
  const body = lines.slice(closingIndex + 1).join("\n");
  try {
    const parsed = parse(frontmatterRaw);
    if (isRecord(parsed)) {
      return { values: parsed, body };
    }
    return { values: {}, body };
  } catch {
    return { values: {}, body };
  }
}

function firstHeading(body: string): string | null {
  const match = /^#\s+(.+)$/mu.exec(body);
  if (!match) return null;
  const title = match[1]?.trim() ?? "";
  return title.length > 0 ? title : null;
}

function firstNonEmptyParagraph(body: string): string {
  const lines = body.split(/\r?\n/u);
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    if (/^#\s+/u.test(trimmed)) continue;
    if (/^[-*]\s+/u.test(trimmed)) continue;
    return trimmed;
  }
  return "";
}

function fromFileNameFallbackTitle(fileName: string): string {
  const stem = fileName.replace(/\.md$/u, "");
  const withoutPrefix = stem.replace(/^SEED-\d{4}-\d{2}-\d{2}-/u, "");
  return withoutPrefix
    .split("-")
    .filter((part) => part.length > 0 && !/^\d+$/u.test(part))
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join(" ")
    .trim();
}

export function seedShelfDir(projectRoot: string): string {
  return path.join(projectRoot, RUNTIME_ROOT, "seeds");
}

export function seedSlug(title: string): string {
  const normalized = title
    .toLowerCase()
    .trim()
    .replace(/[`"'“”‘’()[\]{}<>]/gu, " ")
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+/u, "")
    .replace(/-+$/u, "");
  if (normalized.length === 0) {
    return "seed";
  }
  return normalized.slice(0, 48);
}

function isoDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

export function seedFileName(title: string, createdAt: Date = new Date()): string {
  return `SEED-${isoDate(createdAt)}-${seedSlug(title)}.md`;
}

async function pathExists(absPath: string): Promise<boolean> {
  try {
    await fs.stat(absPath);
    return true;
  } catch {
    return false;
  }
}

export async function resolveSeedPathForWrite(
  projectRoot: string,
  title: string,
  createdAt: Date = new Date()
): Promise<ResolvedSeedPath> {
  const seedsDir = seedShelfDir(projectRoot);
  await fs.mkdir(seedsDir, { recursive: true });
  const baseFile = seedFileName(title, createdAt);
  const baseStem = baseFile.replace(/\.md$/u, "");
  let candidate = baseFile;
  let index = 2;
  while (await pathExists(path.join(seedsDir, candidate))) {
    candidate = `${baseStem}-${index}.md`;
    index += 1;
  }
  return {
    fileName: candidate,
    absPath: path.join(seedsDir, candidate),
    relPath: path.join(RUNTIME_ROOT, "seeds", candidate)
  };
}

export async function readSeedShelf(projectRoot: string): Promise<SeedShelfEntry[]> {
  const dir = seedShelfDir(projectRoot);
  let names: string[] = [];
  try {
    names = await fs.readdir(dir);
  } catch {
    return [];
  }
  const entries: SeedShelfEntry[] = [];
  for (const fileName of names) {
    if (!SEED_FILE_NAME_PATTERN.test(fileName)) continue;
    const absPath = path.join(dir, fileName);
    let raw = "";
    try {
      raw = await fs.readFile(absPath, "utf8");
    } catch {
      continue;
    }
    const frontmatter = parseSeedFrontmatter(raw);
    const title =
      (typeof frontmatter.values.title === "string" && frontmatter.values.title.trim().length > 0
        ? frontmatter.values.title.trim()
        : null) ??
      firstHeading(frontmatter.body) ??
      fromFileNameFallbackTitle(fileName) ??
      "Untitled seed";
    const triggerWhen = normalizeTriggerList(
      frontmatter.values.trigger_when ?? frontmatter.values.triggerWhen
    );
    const sourceStage =
      typeof frontmatter.values.source_stage === "string"
        ? frontmatter.values.source_stage
        : typeof frontmatter.values.sourceStage === "string"
          ? frontmatter.values.sourceStage
          : null;
    const sourceArtifact =
      typeof frontmatter.values.source_artifact === "string"
        ? frontmatter.values.source_artifact
        : typeof frontmatter.values.sourceArtifact === "string"
          ? frontmatter.values.sourceArtifact
          : null;
    const hypothesis =
      typeof frontmatter.values.hypothesis === "string" ? frontmatter.values.hypothesis : null;
    const action = typeof frontmatter.values.action === "string" ? frontmatter.values.action : null;
    const createdOn = SEED_FILE_NAME_PATTERN.exec(fileName)?.[1] ?? "1970-01-01";
    const summary = firstNonEmptyParagraph(frontmatter.body);
    entries.push({
      fileName,
      absPath,
      relPath: path.join(RUNTIME_ROOT, "seeds", fileName),
      createdOn,
      title,
      triggerWhen,
      sourceStage,
      sourceArtifact,
      hypothesis,
      action,
      summary,
      raw
    });
  }
  entries.sort((a, b) => b.fileName.localeCompare(a.fileName));
  return entries;
}

function normalizeMatchText(value: string): string {
  return value.toLowerCase().trim().replace(/\s+/gu, " ");
}

function tokenizeSeedText(value: string | null | undefined): string[] {
  if (!value) return [];
  return value
    .toLowerCase()
    .split(/[^a-z0-9]+/u)
    .map((token) => token.trim())
    .filter((token) => token.length >= 3);
}

function uniqueTokens(values: string[]): Set<string> {
  return new Set(values);
}

function exactTriggerMatch(seed: SeedShelfEntry, normalizedPrompt: string): boolean {
  if (normalizedPrompt.length === 0 || seed.triggerWhen.length === 0) return false;
  return seed.triggerWhen.some((trigger) => {
    const normalizedTrigger = normalizeMatchText(trigger);
    return normalizedTrigger.length > 0 && normalizedPrompt.includes(normalizedTrigger);
  });
}

function seedContentTokens(seed: SeedShelfEntry): Set<string> {
  return uniqueTokens([
    ...tokenizeSeedText(seed.title),
    ...tokenizeSeedText(seed.summary),
    ...tokenizeSeedText(seed.hypothesis),
    ...tokenizeSeedText(seed.action)
  ]);
}

function tokenOverlap(seed: SeedShelfEntry, promptTokens: Set<string>): number {
  if (promptTokens.size === 0) return 0;
  const contentTokens = seedContentTokens(seed);
  let overlap = 0;
  for (const token of promptTokens) {
    if (contentTokens.has(token)) overlap += 1;
  }
  return overlap;
}

export function seedMatchesPrompt(seed: SeedShelfEntry, prompt: string): boolean {
  const normalizedPrompt = normalizeMatchText(prompt);
  if (exactTriggerMatch(seed, normalizedPrompt)) return true;
  return tokenOverlap(seed, uniqueTokens(tokenizeSeedText(prompt))) >= MIN_TOKEN_OVERLAP;
}

export async function findMatchingSeeds(
  projectRoot: string,
  prompt: string,
  maxMatches = DEFAULT_MAX_MATCHES
): Promise<SeedShelfEntry[]> {
  const seeds = await readSeedShelf(projectRoot);
  const normalizedPrompt = normalizeMatchText(prompt);
  if (normalizedPrompt.length === 0) return [];
  const promptTokens = uniqueTokens(tokenizeSeedText(prompt));
  const cappedMax =
    typeof maxMatches === "number" && Number.isFinite(maxMatches) && maxMatches > 0
      ? Math.min(MAX_SEED_MATCHES, Math.max(1, Math.floor(maxMatches)))
      : DEFAULT_MAX_MATCHES;
  const ranked = seeds
    .map((seed, index) => {
      const exact = exactTriggerMatch(seed, normalizedPrompt);
      const overlap = tokenOverlap(seed, promptTokens);
      return { seed, index, exact, overlap };
    })
    .filter((row) => row.exact || row.overlap >= MIN_TOKEN_OVERLAP);

  ranked.sort((a, b) => {
    if (a.exact !== b.exact) return a.exact ? -1 : 1;
    if (b.overlap !== a.overlap) return b.overlap - a.overlap;
    const recency = b.seed.createdOn.localeCompare(a.seed.createdOn);
    if (recency !== 0) return recency;
    return a.index - b.index;
  });

  return ranked.slice(0, cappedMax).map((row) => row.seed);
}

export function renderSeedTemplate(input: SeedTemplateInput): string {
  const triggerWhen = [...input.triggerWhen].map((item) => item.trim()).filter((item) => item.length > 0);
  const createdAt = input.createdAt ?? new Date();
  const sourceStage = input.sourceStage?.trim() || "unknown";
  const sourceArtifact = input.sourceArtifact?.trim() || "unknown";
  return `---
title: ${input.title.trim()}
created_at: ${createdAt.toISOString()}
source_stage: ${sourceStage}
source_artifact: ${sourceArtifact}
trigger_when:
${triggerWhen.length > 0 ? triggerWhen.map((trigger) => `  - ${trigger}`).join("\n") : "  - <trigger token>"}
hypothesis: ${input.hypothesis.trim()}
action: ${input.action.trim()}
---

# ${input.title.trim()}

## Why capture this seed
${input.hypothesis.trim()}

## Trigger when
${triggerWhen.length > 0 ? triggerWhen.map((trigger) => `- ${trigger}`).join("\n") : "- <trigger token>"}

## Suggested action
${input.action.trim()}

## Notes
- Expected payoff:
- Risks:
`;
}
