import fs from "node:fs/promises";
import path from "node:path";
import { exists, writeFileSafe } from "./fs-utils.js";

/**
 * cclaw .gitignore patterns.
 *
 * Only the *transient* parts of .cclaw/ are ignored. The artifact tree
 * (`.cclaw/flows/`, `.cclaw/lib/`, `.cclaw/config.yaml`,
 * `.cclaw/knowledge.jsonl`, etc.) is meant to be committed so the
 * team and graph tools can index the work history.
 *
 * - `.cclaw/state/` — per-developer flow-state.json. Mutates every session.
 * - `.cclaw/worktrees/` — transient git worktrees created by the
 *   parallel-build pattern. These already contain regular checked-out trees;
 *   never commit them as nested data.
 * - `.cclaw/cache/` — local-only fetch cache for the source-driven skill
 *   (HTML bodies, ETag, Last-Modified). Re-derivable from the original URLs;
 *   never useful to commit.
 */
const SECTION_HEADER = "# cclaw transient state";
export const REQUIRED_GITIGNORE_PATTERNS = [
  SECTION_HEADER,
  ".cclaw/state/",
  ".cclaw/worktrees/",
  ".cclaw/cache/"
] as const;

function gitignorePath(projectRoot: string): string {
  return path.join(projectRoot, ".gitignore");
}

export async function ensureGitignorePatterns(projectRoot: string): Promise<void> {
  const target = gitignorePath(projectRoot);
  const current = (await exists(target)) ? await fs.readFile(target, "utf8") : "";
  const lines = current.split(/\r?\n/);
  const present = new Set(lines.map((line) => line.trim()).filter(Boolean));
  const missing = REQUIRED_GITIGNORE_PATTERNS.filter((pattern) => !present.has(pattern));
  if (missing.length === 0) return;

  const trimmedBase = current.replace(/\s+$/u, "");
  const separator = trimmedBase.length > 0 ? "\n\n" : "";
  const next = `${trimmedBase}${separator}${missing.join("\n")}\n`;
  await writeFileSafe(target, next);
}

export async function removeGitignorePatterns(projectRoot: string): Promise<void> {
  const target = gitignorePath(projectRoot);
  if (!(await exists(target))) return;
  const current = await fs.readFile(target, "utf8");
  const drop = new Set<string>(REQUIRED_GITIGNORE_PATTERNS);
  const cleaned = current
    .split(/\r?\n/)
    .filter((line) => !drop.has(line.trim()))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (cleaned.length === 0) {
    await fs.rm(target, { force: true });
    return;
  }
  await writeFileSafe(target, `${cleaned}\n`);
}

export async function gitignoreHasRequiredPatterns(projectRoot: string): Promise<boolean> {
  const target = gitignorePath(projectRoot);
  if (!(await exists(target))) return false;
  const current = await fs.readFile(target, "utf8");
  return REQUIRED_GITIGNORE_PATTERNS.every((pattern) => current.includes(pattern));
}
