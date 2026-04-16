import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

/**
 * Create an isolated, per-test temp directory with a stable prefix.
 *
 * Use this instead of inlining `fs.mkdtemp(path.join(os.tmpdir(), ...))`
 * everywhere so the temp-root shape stays consistent across the suite and
 * we have one place to change (e.g. to switch to `vitest.test.task.id`).
 *
 * The returned path is an absolute, pre-created directory. Cleanup is
 * left to the OS unless you pass {cleanup: true}; most tests do not need
 * to clean up because each call uses a fresh mkdtemp path.
 */
export async function createTempProject(tag: string): Promise<string> {
  const safeTag = tag.replace(/[^a-zA-Z0-9_-]+/gu, "-").slice(0, 48) || "test";
  return fs.mkdtemp(path.join(os.tmpdir(), `cclaw-${safeTag}-`));
}

/**
 * Write a file inside a temp project, creating parent directories.
 * Returns the absolute path of the written file so callers can chain.
 */
export async function writeProjectFile(
  projectRoot: string,
  relativePath: string,
  contents: string
): Promise<string> {
  const absolute = path.join(projectRoot, relativePath);
  await fs.mkdir(path.dirname(absolute), { recursive: true });
  await fs.writeFile(absolute, contents, "utf8");
  return absolute;
}

/**
 * Read a project file as UTF-8 text. Re-exported for symmetry with the
 * helpers above so tests can use a single import surface.
 */
export async function readProjectFile(
  projectRoot: string,
  relativePath: string
): Promise<string> {
  return fs.readFile(path.join(projectRoot, relativePath), "utf8");
}

/**
 * Assert-style existence check that returns a boolean instead of throwing.
 * Useful inside `expect(...).toBe(true/false)` without importing fs.
 */
export async function projectPathExists(
  projectRoot: string,
  relativePath: string
): Promise<boolean> {
  try {
    await fs.stat(path.join(projectRoot, relativePath));
    return true;
  } catch {
    return false;
  }
}
