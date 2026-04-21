import fs from "node:fs/promises";
import path from "node:path";
import { REQUIRED_GITIGNORE_PATTERNS } from "./constants.js";
import { exists, writeFileSafe } from "./fs-utils.js";

export async function ensureGitignore(projectRoot: string): Promise<void> {
  const gitignorePath = path.join(projectRoot, ".gitignore");
  const currentContent = (await exists(gitignorePath))
    ? await fs.readFile(gitignorePath, "utf8")
    : "";

  const lines = currentContent.split(/\r?\n/);
  const normalized = new Set(lines.map((line) => line.trim()).filter(Boolean));

  const missing = REQUIRED_GITIGNORE_PATTERNS.filter((pattern) => !normalized.has(pattern));
  if (missing.length === 0) {
    return;
  }

  const base = lines.join("\n").replace(/\s+$/u, "");
  const suffix = `${base.length > 0 ? "\n" : ""}${missing.join("\n")}\n`;
  // `writeFileSafe` performs a tmp-file + rename so a crash mid-write
  // cannot leave `.gitignore` in a half-written state; the previous
  // direct `fs.writeFile` could truncate the file on SIGKILL.
  await writeFileSafe(gitignorePath, `${base}${suffix}`);
}

export async function removeGitignorePatterns(projectRoot: string): Promise<void> {
  const gitignorePath = path.join(projectRoot, ".gitignore");
  if (!(await exists(gitignorePath))) return;

  const content = await fs.readFile(gitignorePath, "utf8");
  const lines = content.split(/\r?\n/);
  const patternsSet = new Set<string>(REQUIRED_GITIGNORE_PATTERNS);
  const cleaned = lines.filter((line) => !patternsSet.has(line.trim()));
  const result = cleaned.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  if (result.length === 0) {
    await fs.rm(gitignorePath, { force: true });
  } else {
    await writeFileSafe(gitignorePath, `${result}\n`);
  }
}

export async function gitignoreHasRequiredPatterns(projectRoot: string): Promise<boolean> {
  const gitignorePath = path.join(projectRoot, ".gitignore");
  if (!(await exists(gitignorePath))) {
    return false;
  }

  const content = await fs.readFile(gitignorePath, "utf8");
  return REQUIRED_GITIGNORE_PATTERNS.every((pattern) => content.includes(pattern));
}
