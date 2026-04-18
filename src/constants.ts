import type { FlowStage, HarnessId } from "./types.js";

/** Hidden runtime directory at project root (dot-prefixed). */
export const RUNTIME_ROOT = ".cclaw";

export const CCLAW_VERSION = "0.1.1";
export const FLOW_VERSION = "1.0.0";

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
  `${RUNTIME_ROOT}/adapters`,
  `${RUNTIME_ROOT}/agents`,
  `${RUNTIME_ROOT}/hooks`,
  `${RUNTIME_ROOT}/custom-skills`,
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
  ".codex/commands/cc-*.md",
  ".codex/commands/cc.md",
  ".claude/hooks/hooks.json",
  ".cursor/hooks.json",
  ".codex/hooks.json",
  ".opencode/plugins/cclaw-plugin.mjs",
  ".cursor/rules/cclaw-workflow.mdc"
] as const;

export const COMMAND_FILE_ORDER: FlowStage[] = [
  "brainstorm",
  "scope",
  "design",
  "spec",
  "plan",
  "tdd",
  "review",
  "ship"
];

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
