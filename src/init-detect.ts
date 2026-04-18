import path from "node:path";
import { exists } from "./fs-utils.js";
import type { HarnessId } from "./types.js";

export async function detectHarnesses(projectRoot: string): Promise<HarnessId[]> {
  const detected: HarnessId[] = [];

  const claudeHints = [
    path.join(projectRoot, ".claude"),
    path.join(projectRoot, "CLAUDE.md")
  ];
  if (await anyExists(claudeHints)) {
    detected.push("claude");
  }

  const cursorHints = [
    path.join(projectRoot, ".cursor"),
    path.join(projectRoot, ".cursor/rules")
  ];
  if (await anyExists(cursorHints)) {
    detected.push("cursor");
  }

  const opencodeHints = [
    path.join(projectRoot, ".opencode"),
    path.join(projectRoot, "opencode.json"),
    path.join(projectRoot, "opencode.jsonc"),
    path.join(projectRoot, ".opencode/opencode.json"),
    path.join(projectRoot, ".opencode/opencode.jsonc")
  ];
  if (await anyExists(opencodeHints)) {
    detected.push("opencode");
  }

  // Codex CLI doesn't require a persistent per-project directory. We
  // detect via `.agents/skills/` (the universal path Codex 0.89+ reads;
  // Jan 2026) or the legacy `.codex/` marker left by pre-v0.39 cclaw.
  // AGENTS.md is intentionally *not* a codex hint because every other
  // harness in cclaw's list also reads AGENTS.md.
  const codexHints = [
    path.join(projectRoot, ".agents/skills"),
    path.join(projectRoot, ".codex")
  ];
  if (await anyExists(codexHints)) {
    detected.push("codex");
  }

  return detected;
}

async function anyExists(paths: string[]): Promise<boolean> {
  for (const candidate of paths) {
    if (await exists(candidate)) {
      return true;
    }
  }
  return false;
}

