import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { FlowStage, HarnessId } from "./types.js";

/** Hidden runtime directory at project root (dot-prefixed). */
export const RUNTIME_ROOT = ".cclaw";

/**
 * Resolved once at module load from the cclaw-cli package.json. Walking a
 * short list of candidates keeps the helper working in both the compiled
 * `dist/` layout and the in-repo `src/` layout (tests, ts-node).
 */
function readPackageVersion(): string {
  try {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const candidates = [
      path.resolve(here, "../package.json"),
      path.resolve(here, "../../package.json")
    ];
    for (const candidate of candidates) {
      try {
        const raw = readFileSync(candidate, "utf8");
        const parsed = JSON.parse(raw) as { name?: string; version?: string };
        if (parsed.name === "cclaw-cli" && typeof parsed.version === "string") {
          return parsed.version;
        }
      } catch {
        continue;
      }
    }
  } catch {
    // Fall through to dev fallback.
  }
  return "0.0.0-dev";
}

export const CCLAW_VERSION = readPackageVersion();
export const FLOW_VERSION = "1.0.0";

/**
 * Canonical ship finalization enums used across stage schema, linting, and
 * runtime gate evidence checks.
 */
export const SHIP_FINALIZATION_MODES = [
  "FINALIZE_MERGE_LOCAL",
  "FINALIZE_OPEN_PR",
  "FINALIZE_KEEP_BRANCH",
  "FINALIZE_DISCARD_BRANCH",
  "FINALIZE_NO_VCS"
] as const;
export type ShipFinalizationMode = (typeof SHIP_FINALIZATION_MODES)[number];

export const DEFAULT_HARNESSES: HarnessId[] = [
  "claude",
  "cursor",
  "opencode",
  "codex"
];

export const REQUIRED_DIRS = [
  RUNTIME_ROOT,
  `${RUNTIME_ROOT}/commands`,
  `${RUNTIME_ROOT}/skills`,
  `${RUNTIME_ROOT}/templates`,
  `${RUNTIME_ROOT}/templates/state-contracts`,
  `${RUNTIME_ROOT}/artifacts`,
  `${RUNTIME_ROOT}/wave-plans`,
  `${RUNTIME_ROOT}/archive`,
  `${RUNTIME_ROOT}/state`,
  `${RUNTIME_ROOT}/rules`,
  `${RUNTIME_ROOT}/agents`,
  `${RUNTIME_ROOT}/hooks`,
  `${RUNTIME_ROOT}/skills/review-prompts`
] as const;

export const REQUIRED_GITIGNORE_PATTERNS = [
  "# cclaw generated artifacts",
  `${RUNTIME_ROOT}/`,
  ".claude/commands/cc-*.md",
  ".claude/commands/cc.md",
  ".cursor/commands/cc-*.md",
  ".cursor/commands/cc.md",
  ".opencode/commands/cc-*.md",
  ".opencode/commands/cc.md",
  // Codex uses skill-kind shims under `.agents/skills/cc*/` since
  // Codex shim layout (renamed from the older `cclaw-cc*` layout).
  // `cclaw sync` and `cclaw uninstall` both auto-remove the legacy
  // `cclaw-cc*` directories.
  ".agents/skills/cc/SKILL.md",
  ".agents/skills/cc-*/SKILL.md",
  ".claude/hooks/hooks.json",
  ".cursor/hooks.json",
  ".codex/hooks.json",
  ".opencode/plugins/cclaw-plugin.mjs",
  ".cursor/rules/cclaw-workflow.mdc"
] as const;

/**
 * Canonical stage -> skill folder mapping.
 */
export const STAGE_TO_SKILL_FOLDER: Record<FlowStage, string> = {
  brainstorm: "brainstorm",
  scope: "scope",
  design: "design",
  spec: "spec",
  plan: "plan",
  tdd: "tdd",
  review: "review",
  ship: "ship"
};

export const SUBAGENT_SKILL_FOLDERS = [
  "subagent-dev",
  "parallel-dispatch"
] as const;
