/**
 * Per-case sandbox for the Tier B with-tools agent.
 *
 * Every case gets its own `os.tmpdir()/cclaw-eval-<uuid>/` directory. Any
 * `contextFiles` the case declares are copied in relative to the project
 * root, and every tool invocation resolves paths against the sandbox
 * root with a defensive check that refuses symlinks and `..` escapes.
 *
 * Design notes:
 *
 * - The sandbox is intentionally tiny (one directory, no symlink
 *   creation, no executable bits). We rely on `fs.realpath` on every
 *   resolved path so hostile tool output that creates a symlink to
 *   `/etc/passwd` and then tries to read it still trips the boundary
 *   check.
 * - Cleanup is handled by `dispose()`; callers (runner, tests) must
 *   invoke it in a `try/finally` so leftover temp directories never
 *   accumulate.
 * - The sandbox does not preserve the project's directory structure
 *   verbatim. Each entry in `contextFiles` is copied flat into
 *   `sandboxRoot/<basename>` unless it contains path separators, in
 *   which case the full relative layout is recreated. That keeps demo
 *   cases portable while still letting richer cases place files under
 *   subdirectories (e.g. `.cclaw/skills/brainstorming/SKILL.md`).
 */
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export class SandboxEscapeError extends Error {
  readonly requestedPath: string;

  constructor(requestedPath: string, reason: string) {
    super(`Sandbox refused path "${requestedPath}": ${reason}.`);
    this.name = "SandboxEscapeError";
    this.requestedPath = requestedPath;
  }
}

export interface SandboxOptions {
  /** Project root that `contextFiles` are resolved against. */
  projectRoot: string;
  /** Case-relative paths to copy into the sandbox before the agent starts. */
  contextFiles?: string[];
  /**
   * Base directory that will host the per-case tmpdir. Defaults to
   * `os.tmpdir()`. Tests inject a repo-local path so CI leaves no
   * traces in `/tmp` when assertions fail.
   */
  baseDir?: string;
  /** Override the per-case suffix. Primarily for deterministic tests. */
  idOverride?: string;
}

export interface Sandbox {
  /** Absolute path to the sandbox root directory. */
  root: string;
  /**
   * Resolve `requested` relative to the sandbox root and return the
   * absolute, realpath'd filesystem path. Throws
   * `SandboxEscapeError` when the resolution crosses the boundary.
   *
   * `allowMissing: true` lets callers pre-resolve a destination for a
   * write where the final component doesn't exist yet — the parent
   * directory is realpath'd to still catch symlink escapes.
   */
  resolve(requested: string, options?: { allowMissing?: boolean }): Promise<string>;
  /** Remove the sandbox directory. Idempotent. */
  dispose(): Promise<void>;
}

/** Create and prep a fresh sandbox. Callers own cleanup via `dispose()`. */
export async function createSandbox(options: SandboxOptions): Promise<Sandbox> {
  const baseDir = options.baseDir ?? os.tmpdir();
  const id = options.idOverride ?? randomUUID();
  const root = path.join(baseDir, `cclaw-eval-${id}`);
  await fs.mkdir(root, { recursive: true });
  const realRoot = await fs.realpath(root);

  if (options.contextFiles && options.contextFiles.length > 0) {
    for (const rel of options.contextFiles) {
      await copyContextFile(options.projectRoot, realRoot, rel);
    }
  }

  async function resolveInside(
    requested: string,
    opts: { allowMissing?: boolean } = {}
  ): Promise<string> {
    if (typeof requested !== "string" || requested.length === 0) {
      throw new SandboxEscapeError(String(requested), "path must be a non-empty string");
    }
    if (path.isAbsolute(requested)) {
      throw new SandboxEscapeError(requested, "absolute paths are not allowed");
    }
    if (requested.includes("\0")) {
      throw new SandboxEscapeError(requested, "NUL byte in path");
    }
    const joined = path.resolve(realRoot, requested);
    const relative = path.relative(realRoot, joined);
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
      throw new SandboxEscapeError(requested, "resolves outside the sandbox");
    }
    let finalPath: string;
    try {
      finalPath = await fs.realpath(joined);
    } catch (err) {
      if (!opts.allowMissing) {
        throw new SandboxEscapeError(
          requested,
          `realpath failed: ${(err as Error).message}`
        );
      }
      const parent = path.dirname(joined);
      let parentReal: string;
      try {
        parentReal = await fs.realpath(parent);
      } catch (parentErr) {
        throw new SandboxEscapeError(
          requested,
          `parent directory missing: ${(parentErr as Error).message}`
        );
      }
      const parentRel = path.relative(realRoot, parentReal);
      if (parentRel.startsWith("..") || path.isAbsolute(parentRel)) {
        throw new SandboxEscapeError(
          requested,
          "parent resolves outside the sandbox"
        );
      }
      finalPath = path.join(parentReal, path.basename(joined));
    }
    const finalRel = path.relative(realRoot, finalPath);
    if (finalRel.startsWith("..") || path.isAbsolute(finalRel)) {
      throw new SandboxEscapeError(requested, "realpath escapes the sandbox");
    }
    return finalPath;
  }

  return {
    root: realRoot,
    resolve: resolveInside,
    async dispose() {
      await fs.rm(realRoot, { recursive: true, force: true });
    }
  };
}

async function copyContextFile(
  projectRoot: string,
  sandboxRoot: string,
  relPath: string
): Promise<void> {
  if (path.isAbsolute(relPath)) {
    throw new Error(`context_files must be project-relative: ${relPath}`);
  }
  const src = path.resolve(projectRoot, relPath);
  const srcReal = await fs.realpath(src);
  const projectReal = await fs.realpath(projectRoot);
  const inside = path.relative(projectReal, srcReal);
  if (inside.startsWith("..") || path.isAbsolute(inside)) {
    throw new Error(
      `context_files entry resolves outside the project: ${relPath}`
    );
  }
  const stat = await fs.stat(srcReal);
  if (stat.isDirectory()) {
    const dest = path.join(sandboxRoot, relPath);
    await fs.mkdir(dest, { recursive: true });
    await fs.cp(srcReal, dest, { recursive: true });
    return;
  }
  const dest = path.join(sandboxRoot, relPath);
  await fs.mkdir(path.dirname(dest), { recursive: true });
  await fs.copyFile(srcReal, dest);
}
