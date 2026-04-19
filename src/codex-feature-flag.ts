/**
 * Manage the `codex_hooks` feature flag in `~/.codex/config.toml`.
 *
 * Codex CLI ≥ v0.114 (Mar 2026) exposes lifecycle hooks via
 * `.codex/hooks.json`, but the hooks engine is inert unless the user has
 * opted into it with:
 *
 * ```toml
 * [features]
 * codex_hooks = true
 * ```
 *
 * in `$CODEX_HOME/config.toml` (default: `~/.codex/config.toml`).
 * cclaw's `init --codex` prompts the user to flip this flag for them;
 * this module owns the detection / mutation code so the prompt logic in
 * `cli.ts` stays small and testable.
 *
 * The TOML mutations here are intentionally surgical — we never reparse
 * or rewrite the whole document. A deliberately narrow regex based
 * approach lets the function stay dependency-free and preserves the
 * user's comments, whitespace, and custom key ordering.
 */

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

/**
 * Absolute path of the Codex config file. Respects `$CODEX_HOME` when
 * present (the only override Codex CLI documents); falls back to
 * `~/.codex/config.toml` otherwise.
 */
export function codexConfigPath(env: NodeJS.ProcessEnv = process.env): string {
  const codexHome = env.CODEX_HOME && env.CODEX_HOME.trim().length > 0
    ? env.CODEX_HOME
    : path.join(os.homedir(), ".codex");
  return path.join(codexHome, "config.toml");
}

export type CodexHooksFlagState =
  | "enabled"       // [features] codex_hooks = true  ← all good
  | "disabled"      // present but set to false (or any non-true literal)
  | "missing-key"   // [features] section exists but no codex_hooks inside
  | "missing-section" // file exists without a [features] section
  | "missing-file"; // file does not exist

/**
 * Inspect a TOML document and decide which of the five canonical states
 * it represents. Comments and blank lines are ignored. Only the first
 * `[features]` section is considered — duplicates are technically invalid
 * TOML and Codex rejects them, so cclaw does not try to be clever there.
 */
export function classifyCodexHooksFlag(toml: string | null): CodexHooksFlagState {
  if (toml === null) {
    return "missing-file";
  }

  const lines = toml.split(/\r?\n/);
  let inFeaturesSection = false;
  let sawFeaturesHeader = false;

  for (const rawLine of lines) {
    const stripped = stripTomlComment(rawLine).trim();
    if (stripped.length === 0) continue;

    const headerMatch = /^\[\s*([A-Za-z0-9_.-]+)\s*\]$/u.exec(stripped);
    if (headerMatch) {
      const section = headerMatch[1];
      if (section === "features") {
        inFeaturesSection = true;
        sawFeaturesHeader = true;
      } else {
        inFeaturesSection = false;
      }
      continue;
    }

    if (inFeaturesSection) {
      const keyMatch = /^codex_hooks\s*=\s*(.*)$/u.exec(stripped);
      if (keyMatch) {
        const value = keyMatch[1]!.trim().toLowerCase();
        return value === "true" ? "enabled" : "disabled";
      }
    }
  }

  if (sawFeaturesHeader) return "missing-key";
  return "missing-section";
}

function stripTomlComment(line: string): string {
  // Naive but sufficient for our narrow use case: we only read cclaw's
  // own writes back, and cclaw never emits `=` after a `#` inside a
  // string literal in config.toml. If a user has complex string values
  // with `#` inside them, worst case we trip `classifyCodexHooksFlag`
  // and prompt them again — non-destructive.
  const hashIndex = line.indexOf("#");
  return hashIndex === -1 ? line : line.slice(0, hashIndex);
}

/**
 * Return a TOML document with `[features] codex_hooks = true` set.
 * Preserves all other content verbatim:
 *   - If the document lacks a `[features]` section, we append one at the
 *     end of the file (separated by a blank line).
 *   - If `[features]` exists without `codex_hooks`, we insert the key
 *     immediately after the header.
 *   - If `codex_hooks` exists with any non-`true` value, we rewrite
 *     just that line.
 *   - If the flag is already `true`, the input is returned unchanged.
 */
export function patchCodexHooksFlag(toml: string | null): { updated: string; changed: boolean } {
  const initial = toml ?? "";
  const state = classifyCodexHooksFlag(toml);

  if (state === "enabled") {
    return { updated: initial, changed: false };
  }

  if (state === "missing-file" || state === "missing-section") {
    const prefix = initial.length === 0
      ? ""
      : initial.endsWith("\n") ? initial : `${initial}\n`;
    const separator = initial.trim().length === 0 ? "" : "\n";
    const block = `${separator}[features]\ncodex_hooks = true\n`;
    return { updated: `${prefix}${block}`, changed: true };
  }

  if (state === "missing-key") {
    const updated = insertKeyInFeaturesSection(initial);
    return { updated, changed: true };
  }

  const updated = replaceCodexHooksLineInFeaturesSection(initial);
  return { updated, changed: true };
}

function insertKeyInFeaturesSection(toml: string): string {
  // Walk into `[features]`, remember the index of the last key / non-blank
  // line inside that section, and splice `codex_hooks = true` immediately
  // after it. This keeps the inserted key adjacent to existing features,
  // never stranded after a blank line or pushed down past a later section
  // header. If `[features]` is empty, we insert right after its header.
  const lines = toml.split(/\r?\n/);
  let inFeaturesSection = false;
  let featuresHeaderIndex = -1;
  let lastFeatureKeyIndex = -1;

  for (let index = 0; index < lines.length; index += 1) {
    const rawLine = lines[index]!;
    const stripped = stripTomlComment(rawLine).trim();
    const headerMatch = /^\[\s*([A-Za-z0-9_.-]+)\s*\]$/u.exec(stripped);
    if (headerMatch) {
      if (inFeaturesSection) break;
      if (headerMatch[1] === "features") {
        inFeaturesSection = true;
        featuresHeaderIndex = index;
        lastFeatureKeyIndex = index;
      }
      continue;
    }
    if (inFeaturesSection && stripped.length > 0) {
      lastFeatureKeyIndex = index;
    }
  }

  if (featuresHeaderIndex === -1) {
    // caller should have short-circuited before getting here; defensive
    return toml;
  }

  lines.splice(lastFeatureKeyIndex + 1, 0, "codex_hooks = true");

  const joined = lines.join("\n");
  return joined.endsWith("\n") ? joined : `${joined}\n`;
}

function replaceCodexHooksLineInFeaturesSection(toml: string): string {
  const lines = toml.split(/\r?\n/);
  let inFeaturesSection = false;

  for (let index = 0; index < lines.length; index += 1) {
    const rawLine = lines[index]!;
    const stripped = stripTomlComment(rawLine).trim();
    const headerMatch = /^\[\s*([A-Za-z0-9_.-]+)\s*\]$/u.exec(stripped);
    if (headerMatch) {
      inFeaturesSection = headerMatch[1] === "features";
      continue;
    }
    if (inFeaturesSection && /^codex_hooks\s*=/u.test(stripped)) {
      const indent = /^\s*/u.exec(rawLine)?.[0] ?? "";
      lines[index] = `${indent}codex_hooks = true`;
    }
  }

  const joined = lines.join("\n");
  return joined.endsWith("\n") ? joined : `${joined}\n`;
}

/**
 * Read the Codex config, return `null` when the file does not exist.
 * All other read errors propagate so callers can surface a useful
 * message instead of silently degrading.
 */
export async function readCodexConfig(configPath: string): Promise<string | null> {
  try {
    return await fs.readFile(configPath, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw err;
  }
}

export async function writeCodexConfig(configPath: string, content: string): Promise<void> {
  await fs.mkdir(path.dirname(configPath), { recursive: true });
  await fs.writeFile(configPath, content, "utf8");
}
