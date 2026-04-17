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

  const codexHints = [
    path.join(projectRoot, ".codex"),
    path.join(projectRoot, ".codex/hooks.json")
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

