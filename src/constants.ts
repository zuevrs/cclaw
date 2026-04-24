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

/**
 * Evals subtree. Scaffolds the directory layout and a default config.yaml; the
 * structural verifier, rule verifiers, and LLM wiring layer on incrementally.
 * Keeping this separate from the main REQUIRED_DIRS list makes it explicit that
 * the evals runtime is additive and does not affect non-eval cclaw behavior.
 */
export const EVALS_ROOT = `${RUNTIME_ROOT}/evals`;
export const EVALS_CONFIG_PATH = `${EVALS_ROOT}/config.yaml`;
export const EVALS_DIRS = [
  EVALS_ROOT,
  `${EVALS_ROOT}/corpus`,
  `${EVALS_ROOT}/rubrics`,
  `${EVALS_ROOT}/baselines`,
  `${EVALS_ROOT}/reports`
] as const;

export const REQUIRED_DIRS = [
  RUNTIME_ROOT,
  `${RUNTIME_ROOT}/commands`,
  `${RUNTIME_ROOT}/skills`,
  `${RUNTIME_ROOT}/contexts`,
  `${RUNTIME_ROOT}/templates`,
  `${RUNTIME_ROOT}/artifacts`,
  `${RUNTIME_ROOT}/worktrees`,
  `${RUNTIME_ROOT}/state`,
  `${RUNTIME_ROOT}/runs`,
  `${RUNTIME_ROOT}/rules`,
  `${RUNTIME_ROOT}/agents`,
  `${RUNTIME_ROOT}/hooks`,
  ...EVALS_DIRS
] as const;

export const REQUIRED_GITIGNORE_PATTERNS = [
  "# cclaw generated artifacts",
  `${RUNTIME_ROOT}/`,
  "# cclaw evals: user-owned, track in git",
  `!${EVALS_ROOT}/`,
  `!${EVALS_ROOT}/config.yaml`,
  `!${EVALS_ROOT}/corpus/`,
  `!${EVALS_ROOT}/corpus/**`,
  `!${EVALS_ROOT}/rubrics/`,
  `!${EVALS_ROOT}/rubrics/**`,
  `!${EVALS_ROOT}/baselines/`,
  `!${EVALS_ROOT}/baselines/**`,
  ".claude/commands/cc-*.md",
  ".claude/commands/cc.md",
  ".cursor/commands/cc-*.md",
  ".cursor/commands/cc.md",
  ".opencode/commands/cc-*.md",
  ".opencode/commands/cc.md",
  // Codex uses skill-kind shims under `.agents/skills/cc*/` since
  // v0.40.0 (renamed from the `cclaw-cc*` layout in v0.39.0/v0.39.1).
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
 *
 * Intentional divergence from stage ids:
 * - stage ids stay short and flow-oriented (`spec`, `tdd`, `ship`)
 * - skill folders stay descriptive and user-facing for `.cclaw/skills/*`.
 *
 * Keep this map as the single source of truth for generated skill paths.
 */
export const STAGE_TO_SKILL_FOLDER: Record<FlowStage, string> = {
  brainstorm: "brainstorming",
  scope: "scope-shaping",
  design: "engineering-design-lock",
  spec: "specification-authoring",
  plan: "planning-and-task-breakdown",
  tdd: "test-driven-development",
  review: "two-layer-review",
  ship: "shipping-and-handoff"
};

export const UTILITY_COMMANDS = [
  "learn",
  "next",
  "ideate",
  "view",
  "status",
  "tree",
  "diff",
  "ops",
  "feature",
  "tdd-log",
  "retro",
  "compound",
  "archive",
  "rewind"
] as const;

export const SUBAGENT_SKILL_FOLDERS = [
  "subagent-dev",
  "parallel-dispatch"
] as const;
export type UtilityCommand = (typeof UTILITY_COMMANDS)[number];
