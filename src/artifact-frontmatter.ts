import fs from "node:fs/promises";
import YAML from "yaml";
import { activeArtifactPath } from "./artifact-paths.js";
import { exists, writeFileSafe } from "./fs-utils.js";
import type { AcceptanceCriterionState, FlowStage, DiscoverySpecialistId, ArtifactStatus } from "./types.js";

export interface ArtifactFrontmatter {
  slug: string;
  stage: FlowStage | "shipped" | "cancelled";
  status: ArtifactStatus | "cancelled";
  ac?: AcceptanceCriterionState[];
  last_specialist?: DiscoverySpecialistId | null;
  refines?: string | null;
  shipped_at?: string | null;
  ship_commit?: string | null;
  review_iterations?: number;
  security_flag?: boolean;
  [key: string]: unknown;
}

export interface ParsedArtifact {
  frontmatter: ArtifactFrontmatter;
  body: string;
  raw: string;
}

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/u;
const AC_LINE_RE = /^[\s>*+-]*\*{0,2}\s*(AC-\d+)\s*[:\-—)]\s*(.+?)\s*$/iu;
const AC_COMMIT_RE = /\(?(commit\s*[:=]?\s*([0-9a-f]{7,40})|sha\s*[:=]?\s*([0-9a-f]{7,40})|@([0-9a-f]{7,40}))\)?/iu;
const AC_PENDING_RE = /\(commit\s*[:=]?\s*pending\)/iu;

export class FrontmatterError extends Error {
  constructor(message: string, public readonly path?: string) {
    super(message);
    this.name = "FrontmatterError";
  }
}

export function parseArtifact(raw: string, sourcePath?: string): ParsedArtifact {
  const trimmed = raw.replace(/^\uFEFF/u, "");
  const match = FRONTMATTER_RE.exec(trimmed);
  if (!match) {
    throw new FrontmatterError(
      `Artifact is missing the required YAML frontmatter block (---).${sourcePath ? ` (${sourcePath})` : ""}`,
      sourcePath
    );
  }
  const yamlBody = match[1] ?? "";
  const body = match[2] ?? "";
  let parsed: unknown;
  try {
    parsed = YAML.parse(yamlBody);
  } catch (err) {
    throw new FrontmatterError(`Invalid YAML frontmatter: ${(err as Error).message}`, sourcePath);
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new FrontmatterError("Frontmatter must be a YAML object.", sourcePath);
  }
  const frontmatter = parsed as ArtifactFrontmatter;
  if (typeof frontmatter.slug !== "string" || frontmatter.slug.length === 0) {
    throw new FrontmatterError("Frontmatter must declare a non-empty `slug`.", sourcePath);
  }
  if (typeof frontmatter.stage !== "string") {
    throw new FrontmatterError("Frontmatter must declare a `stage` (plan/build/review/ship/shipped/cancelled).", sourcePath);
  }
  if (typeof frontmatter.status !== "string") {
    throw new FrontmatterError("Frontmatter must declare a `status` (active/shipped/cancelled).", sourcePath);
  }
  if (frontmatter.ac !== undefined && !Array.isArray(frontmatter.ac)) {
    throw new FrontmatterError("Frontmatter `ac` must be an array.", sourcePath);
  }
  return { frontmatter, body, raw };
}

export function renderArtifact(parsed: ParsedArtifact): string {
  const yaml = YAML.stringify(parsed.frontmatter, { indent: 2 }).trim();
  const body = parsed.body.startsWith("\n") ? parsed.body : `\n${parsed.body}`;
  return `---\n${yaml}\n---\n${body.replace(/^\n/u, "")}\n`;
}

export async function readArtifact(filePath: string): Promise<ParsedArtifact> {
  const raw = await fs.readFile(filePath, "utf8");
  return parseArtifact(raw, filePath);
}

export async function writeArtifact(filePath: string, parsed: ParsedArtifact): Promise<void> {
  await writeFileSafe(filePath, renderArtifact(parsed));
}

export function extractAcceptanceCriteriaFromBody(body: string): Array<{ id: string; text: string; commit?: string; status: AcceptanceCriterionState["status"] }> {
  const results: Array<{ id: string; text: string; commit?: string; status: AcceptanceCriterionState["status"] }> = [];
  const seen = new Set<string>();
  for (const rawLine of body.split(/\r?\n/u)) {
    const line = rawLine.replace(/<[^>]+>/gu, "").trim();
    const match = AC_LINE_RE.exec(line);
    if (!match) continue;
    const id = match[1].toUpperCase();
    if (seen.has(id)) continue;
    seen.add(id);
    let text = match[2].trim();
    let commit: string | undefined;
    let status: AcceptanceCriterionState["status"] = "pending";
    const commitMatch = AC_COMMIT_RE.exec(text);
    if (commitMatch && !AC_PENDING_RE.test(text)) {
      commit = commitMatch[2] ?? commitMatch[3] ?? commitMatch[4];
      if (commit) status = "committed";
    }
    text = text.replace(AC_COMMIT_RE, "").replace(AC_PENDING_RE, "").replace(/\s{2,}/gu, " ").replace(/[\s\-:—]+$/u, "").trim();
    results.push({ id, text, commit, status });
  }
  return results;
}

export function mergeAcceptanceCriteria(
  fromBody: Array<{ id: string; text: string; commit?: string; status: AcceptanceCriterionState["status"] }>,
  fromFrontmatter: AcceptanceCriterionState[] | undefined
): AcceptanceCriterionState[] {
  const fmIndex = new Map<string, AcceptanceCriterionState>();
  for (const ac of fromFrontmatter ?? []) fmIndex.set(ac.id, ac);
  const merged: AcceptanceCriterionState[] = [];
  for (const item of fromBody) {
    const fm = fmIndex.get(item.id);
    const commit = item.commit ?? fm?.commit;
    const status: AcceptanceCriterionState["status"] = commit ? "committed" : (fm?.status ?? "pending");
    merged.push({
      id: item.id,
      text: item.text || fm?.text || item.id,
      commit,
      status
    });
  }
  for (const [id, ac] of fmIndex) {
    if (!merged.some((entry) => entry.id === id)) merged.push(ac);
  }
  return merged;
}

export interface SyncFrontmatterPatch {
  ac?: AcceptanceCriterionState[];
  last_specialist?: ArtifactFrontmatter["last_specialist"];
  review_iterations?: number;
  security_flag?: boolean;
  shipped_at?: string | null;
  ship_commit?: string | null;
  refines?: string | null;
}

export async function syncFrontmatter(
  projectRoot: string,
  slug: string,
  stage: FlowStage,
  patch: SyncFrontmatterPatch
): Promise<ParsedArtifact> {
  const filePath = activeArtifactPath(projectRoot, stage, slug);
  if (!(await exists(filePath))) {
    throw new FrontmatterError(`Artifact ${stage}/<${slug}>.md not found.`, filePath);
  }
  const parsed = await readArtifact(filePath);
  const next: ArtifactFrontmatter = { ...parsed.frontmatter };
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    (next as Record<string, unknown>)[key] = value;
  }
  const updated: ParsedArtifact = { ...parsed, frontmatter: next };
  await writeArtifact(filePath, updated);
  return updated;
}

export function isFrontmatterCancelled(frontmatter: ArtifactFrontmatter): boolean {
  return frontmatter.status === "cancelled" || frontmatter.stage === "cancelled";
}

export function isFrontmatterShipped(frontmatter: ArtifactFrontmatter): boolean {
  return frontmatter.status === "shipped" || frontmatter.stage === "shipped";
}
