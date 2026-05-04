import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import {
  CCLAW_VERSION,
  FLOW_VERSION,
  REQUIRED_DIRS,
  RUNTIME_ROOT
} from "./constants.js";
import {
  writeConfig,
  createDefaultConfig,
  readConfig,
  configPath,
  detectAdvancedKeys
} from "./config.js";
import { learnSkillMarkdown } from "./content/learnings.js";
import { stageCommandShimMarkdown } from "./content/stage-command.js";
import { ideaCommandContract, ideaCommandSkillMarkdown } from "./content/idea.js";
import { startCommandContract, startCommandSkillMarkdown } from "./content/start-command.js";
import { viewCommandContract, viewCommandSkillMarkdown } from "./content/view-command.js";
import { cancelCommandContract, cancelCommandSkillMarkdown } from "./content/cancel-command.js";
import { subagentDrivenDevSkill, parallelAgentsSkill } from "./content/subagents.js";
import { sessionHooksSkillMarkdown } from "./content/session-hooks.js";
import { ironLawsSkillMarkdown } from "./content/iron-laws.js";
import {
  stageCompleteScript,
  startFlowScript,
  cancelRunScript,
  runHookCmdScript,
  delegationRecordScript,
  opencodePluginJs,
  claudeHooksJson,
  codexHooksJson,
  cursorHooksJson
} from "./content/hooks.js";
import {
  nodeHookRuntimeScript,
  type NodeHookRuntimeOptions
} from "./content/node-hooks.js";
import { META_SKILL_NAME, usingCclawSkillMarkdown } from "./content/meta-skill.js";
import {
  ARTIFACT_TEMPLATES,
  CURSOR_GUIDELINES_RULE_MDC,
  CURSOR_WORKFLOW_RULE_MDC,
  RULEBOOK_MARKDOWN,
  buildRulesJson
} from "./content/templates.js";
import { STATE_CONTRACTS } from "./content/state-contracts.js";
import { REVIEW_PROMPTS } from "./content/review-prompts.js";
import {
  stageSkillFolder,
  stageSkillMarkdown,
  executingWavesSkillMarkdown
} from "./content/skills.js";
import { adaptiveElicitationSkillMarkdown } from "./content/skills-elicitation.js";
import {
  LANGUAGE_RULE_PACK_DIR,
  LEGACY_LANGUAGE_RULE_PACK_FOLDERS
} from "./content/utility-skills.js";
import { RESEARCH_PLAYBOOKS } from "./content/research-playbooks.js";
import { SUBAGENT_CONTEXT_SKILLS } from "./content/subagent-context-skills.js";
import { CCLAW_AGENTS } from "./content/core-agents.js";
import { createInitialFlowState, effectiveWorktreeExecutionMode, type FlowState } from "./flow-state.js";
import { ensureDir, exists, writeFileSafe } from "./fs-utils.js";
import { ManagedResourceSession, setActiveManagedResourceSession } from "./managed-resources.js";
import { ensureGitignore, removeGitignorePatterns } from "./gitignore.js";
import {
  HARNESS_ADAPTERS,
  harnessShimFileNames,
  harnessShimSkillNames,
  syncHarnessShims,
  removeCclawFromAgentsMd
} from "./harness-adapters.js";
import { validateHookDocument } from "./hook-schema.js";
import { detectHarnesses } from "./init-detect.js";
import {
  classifyCodexHooksFlag,
  codexConfigPath,
  readCodexConfig
} from "./codex-feature-flag.js";
import { CorruptFlowStateError, ensureRunSystem, readFlowState, writeFlowState } from "./runs.js";
import {
  PLAN_SPLIT_DEFAULT_WAVE_SIZE,
  buildParallelExecutionPlanSection,
  formatNextParallelWaveSyncHint,
  mergeParallelWaveDefinitions,
  parseParallelExecutionPlanWaves,
  parseWavePlanDirectory,
  planArtifactLacksV613ParallelMetadata,
  upsertParallelExecutionPlanSection
} from "./internal/plan-split-waves.js";
import type { CclawConfig, FlowTrack, HarnessId } from "./types.js";
import { FLOW_STAGES } from "./types.js";

export interface InitOptions {
  projectRoot: string;
  harnesses?: HarnessId[];
  track?: FlowTrack;
}

export interface SyncOptions {
  harnesses?: HarnessId[];
}

const OPENCODE_PLUGIN_REL_PATH = ".opencode/plugins/cclaw-plugin.mjs";
const CURSOR_RULE_REL_PATH = ".cursor/rules/cclaw-workflow.mdc";
const CURSOR_GUIDELINES_REL_PATH = ".cursor/rules/cclaw-guidelines.mdc";
const INIT_SENTINEL_FILE = ".init-in-progress";
const execFileAsync = promisify(execFile);

function runtimePath(projectRoot: string, ...segments: string[]): string {
  return path.join(projectRoot, RUNTIME_ROOT, ...segments);
}

async function writeInitSentinel(projectRoot: string, operation: string): Promise<string> {
  const sentinelPath = runtimePath(projectRoot, "state", INIT_SENTINEL_FILE);
  await ensureDir(path.dirname(sentinelPath));
  await writeFileSafe(
    sentinelPath,
    `${JSON.stringify({ operation, startedAt: new Date().toISOString() }, null, 2)}\n`
  );
  return sentinelPath;
}

async function warnStaleInitSentinel(projectRoot: string, operation: string): Promise<void> {
  const sentinelPath = runtimePath(projectRoot, "state", INIT_SENTINEL_FILE);
  if (!(await exists(sentinelPath))) return;

  let startedAt = "unknown time";
  try {
    const raw = await fs.readFile(sentinelPath, "utf8");
    const parsed = JSON.parse(raw) as { startedAt?: unknown } | null;
    if (parsed && typeof parsed.startedAt === "string" && parsed.startedAt.trim().length > 0) {
      startedAt = parsed.startedAt;
    }
  } catch {
    // best-effort parse of stale sentinel metadata
  }

  process.stderr.write(
    `[${operation}] Detected stale .init-in-progress sentinel from ${startedAt}; previous run may have crashed. Continuing.\n`
  );
}


async function removeBestEffort(targetPath: string, recursive = false): Promise<void> {
  try {
    await fs.rm(targetPath, { recursive, force: true });
  } catch {
    // best-effort cleanup
  }
}

const DEPRECATED_UTILITY_SKILL_FOLDERS = [
  "project-learnings",
  "auto-orchestration",
  "autoplan",
  "red-first-testing",
  "incremental-implementation",
  "subagent-driven-development",
  "dispatching-parallel-agents",
  "session-guidelines",
  "security-review",
  "documentation",
  "browser-qa-testing",
  "feature-workspaces",
  "security",
  "debugging",
  "performance",
  "ci-cd",
  "docs",
  "executing-plans",
  "verification-before-completion",
  "finishing-a-development-branch",
  "context-engineering",
  "source-driven-development",
  "frontend-accessibility",
  "landscape-check",
  "knowledge-curation",
  "retrospective",
  "document-review",
  "flow-status",
  "flow-tree",
  "flow-diff"
] as const;

const DEPRECATED_STAGE_SKILL_FOLDERS = [
  "brainstorming",
  "scope-shaping",
  "engineering-design-lock",
  "specification-authoring",
  "planning-and-task-breakdown",
  "test-driven-development",
  "two-layer-review",
  "shipping-and-handoff"
] as const;

const DEPRECATED_AGENT_FILES = [
  "securityer.md",
  "spec-reviewer.md",
  "code-reviewer.md",
  "repo-research-analyst.md",
  "learnings-researcher.md",
  "framework-docs-researcher.md",
  "best-practices-researcher.md",
  "git-history-analyzer.md"
] as const;

const DEPRECATED_COMMAND_FILES = [
  "learn.md",
  "finish.md",
  "status.md",
  "tree.md",
  "diff.md",
  "feature.md",
  "ops.md",
  "tdd-log.md",
  "retro.md",
  "compound.md",
  "archive.md",
  "rewind.md"
] as const;

const DEPRECATED_SKILL_FILES = [
  ["flow-finish", "SKILL.md"],
  ["flow-ops", "SKILL.md"],
  ["flow-retro", "SKILL.md"],
  ["flow-compound", "SKILL.md"],
  ["flow-archive", "SKILL.md"],
  ["flow-rewind", "SKILL.md"],
  ["using-git-worktrees", "SKILL.md"]
] as const;

// Skill folders whose entire directory should be removed on sync so the
// abandoned tree doesn't linger in user projects.
const DEPRECATED_SKILL_FOLDERS_FULL = [
  "tdd-cycle-log"
] as const;

const DEPRECATED_STATE_FILES = [
  "checkpoint.json",
  "flow-state.snapshot.json",
  "stage-activity.jsonl",
  "knowledge-digest.md",
  "suggestion-memory.json",
  "harness-gaps.json",
  "context-mode.json",
  "session-digest.md",
  "context-warnings.jsonl",
  // Runtime Honesty 6.9.0 removed the per-run TDD cycle JSONL: gate evidence
  // now reads cycle phase progression directly from the artifact table.
  "tdd-cycle-log.jsonl"
] as const;

// v6.11.0 (R5): files under `<runtime>/artifacts/` that previous releases
// generated and v6.11.0 removed. `cclaw-cli sync` deletes each so existing
// installs lose the obsolete sidecar without requiring manual cleanup.
const DEPRECATED_ARTIFACT_FILES = [
  // v6.10.0 sidecar — replaced in v6.11.0 by phase events in
  // delegation-events.jsonl + auto-rendered tables in 06-tdd.md.
  "06-tdd-slices.jsonl"
] as const;

const DEPRECATED_HOOK_FILES = [
  "observe.sh",
  "summarize-observations.sh",
  "summarize-observations.mjs",
  "_lib.sh",
  "session-start.sh",
  "stop-checkpoint.sh",
  "stage-complete.sh",
  "pre-compact.sh",
  "prompt-guard.sh",
  "workflow-guard.sh",
  "context-monitor.sh"
] as const;

const DEPRECATED_RUNTIME_ROOT_FILES = ["learnings.jsonl", "observations.jsonl"] as const;
const DEPRECATED_RUNTIME_DIRS = ["evals", "worktrees", "references", "contexts"] as const;

async function resolveGitHooksDir(projectRoot: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync("git", ["rev-parse", "--git-path", "hooks"], {
      cwd: projectRoot
    });
    const rel = stdout.trim();
    if (rel.length === 0) {
      return null;
    }
    return path.resolve(projectRoot, rel);
  } catch {
    return null;
  }
}


// Legacy cleanup: prior versions installed Node-based git pre-commit/pre-push relays
// under .git/hooks/* and a runtime tree at .cclaw/hooks/git/. Runtime Honesty 6.9.0
// removed managed git hooks entirely; the cleanup below stays so existing installs
// shed the leftover files on next sync/uninstall.
const LEGACY_GIT_HOOK_MANAGED_MARKER = "cclaw-managed-git-hook";
const LEGACY_GIT_HOOK_RUNTIME_REL_DIR = `${RUNTIME_ROOT}/hooks/git`;

async function cleanupLegacyManagedGitHookRelays(projectRoot: string): Promise<void> {
  const hooksDir = await resolveGitHooksDir(projectRoot);
  if (hooksDir) {
    for (const hookName of ["pre-commit", "pre-push"] as const) {
      const hookPath = path.join(hooksDir, hookName);
      if (!(await exists(hookPath))) continue;
      let content = "";
      try {
        content = await fs.readFile(hookPath, "utf8");
      } catch {
        content = "";
      }
      if (!content.includes(LEGACY_GIT_HOOK_MANAGED_MARKER)) continue;
      await fs.rm(hookPath, { force: true });
    }
  }
  try {
    await fs.rm(path.join(projectRoot, LEGACY_GIT_HOOK_RUNTIME_REL_DIR), { recursive: true, force: true });
  } catch {
    // best-effort cleanup
  }
}

async function ensureStructure(projectRoot: string): Promise<void> {
  for (const dir of REQUIRED_DIRS) {
    await ensureDir(path.join(projectRoot, dir));
  }
}

async function writeArtifactTemplates(projectRoot: string): Promise<void> {
  await Promise.all(Object.entries(ARTIFACT_TEMPLATES).map(async ([fileName, content]) => {
    await writeFileSafe(runtimePath(projectRoot, "templates", fileName), content);
  }));
  await Promise.all(Object.entries(STATE_CONTRACTS).map(async ([fileName, content]) => {
    await writeFileSafe(runtimePath(projectRoot, "templates", "state-contracts", fileName), content);
  }));
}

async function writeWavePlansScaffold(projectRoot: string): Promise<void> {
  await writeFileSafe(runtimePath(projectRoot, "wave-plans", ".gitkeep"), "");
}

async function writeSkills(projectRoot: string, config?: CclawConfig): Promise<void> {
  void config;
  const skillTrack = "standard";
  for (const stage of FLOW_STAGES) {
    const folder = stageSkillFolder(stage);
    await writeFileSafe(
      runtimePath(projectRoot, "skills", folder, "SKILL.md"),
      stageSkillMarkdown(stage, skillTrack)
    );
  }

  // Utility skills (not flow stages)
  await writeFileSafe(
    runtimePath(projectRoot, "skills", "learnings", "SKILL.md"),
    learnSkillMarkdown()
  );
  await writeFileSafe(
    runtimePath(projectRoot, "skills", "flow-idea", "SKILL.md"),
    ideaCommandSkillMarkdown()
  );
  await writeFileSafe(
    runtimePath(projectRoot, "skills", "flow-start", "SKILL.md"),
    startCommandSkillMarkdown()
  );
  await writeFileSafe(
    runtimePath(projectRoot, "skills", "flow-view", "SKILL.md"),
    viewCommandSkillMarkdown()
  );
  await writeFileSafe(
    runtimePath(projectRoot, "skills", "flow-cancel", "SKILL.md"),
    cancelCommandSkillMarkdown()
  );

  await writeFileSafe(
    runtimePath(projectRoot, "skills", "subagent-dev", "SKILL.md"),
    subagentDrivenDevSkill()
  );
  await writeFileSafe(
    runtimePath(projectRoot, "skills", "parallel-dispatch", "SKILL.md"),
    parallelAgentsSkill()
  );
  await writeFileSafe(
    runtimePath(projectRoot, "skills", "session", "SKILL.md"),
    sessionHooksSkillMarkdown()
  );
  await writeFileSafe(
    runtimePath(projectRoot, "skills", "iron-laws", "SKILL.md"),
    ironLawsSkillMarkdown()
  );
  await writeFileSafe(
    runtimePath(projectRoot, "skills", "executing-waves", "SKILL.md"),
    executingWavesSkillMarkdown()
  );
  await writeFileSafe(
    runtimePath(projectRoot, "skills", "adaptive-elicitation", "SKILL.md"),
    adaptiveElicitationSkillMarkdown()
  );
  await writeFileSafe(
    runtimePath(projectRoot, "skills", META_SKILL_NAME, "SKILL.md"),
    usingCclawSkillMarkdown()
  );
  // In-thread research procedures (no YAML frontmatter, not delegated personas).
  for (const [fileName, markdown] of Object.entries(RESEARCH_PLAYBOOKS)) {
    await writeFileSafe(runtimePath(projectRoot, "skills", "research", fileName), markdown);
  }
  for (const [fileName, markdown] of Object.entries(REVIEW_PROMPTS)) {
    await writeFileSafe(runtimePath(projectRoot, "skills", "review-prompts", fileName), markdown);
  }
  for (const [folderName, markdown] of Object.entries(SUBAGENT_CONTEXT_SKILLS)) {
    await writeFileSafe(runtimePath(projectRoot, "skills", folderName, "SKILL.md"), markdown);
  }

  // Wave 21: language packs are no longer materialized from config.
  await fs.rm(runtimePath(projectRoot, ...LANGUAGE_RULE_PACK_DIR), { recursive: true, force: true });

  for (const legacyFolder of LEGACY_LANGUAGE_RULE_PACK_FOLDERS) {
    const legacyPath = runtimePath(projectRoot, "skills", legacyFolder);
    if (await exists(legacyPath)) {
      await fs.rm(legacyPath, { recursive: true, force: true });
    }
  }

}

async function writeEntryCommands(projectRoot: string): Promise<void> {
  await writeFileSafe(runtimePath(projectRoot, "commands", "start.md"), startCommandContract());
  await writeFileSafe(runtimePath(projectRoot, "commands", "idea.md"), ideaCommandContract());
  await writeFileSafe(runtimePath(projectRoot, "commands", "view.md"), viewCommandContract());
  await writeFileSafe(runtimePath(projectRoot, "commands", "cancel.md"), cancelCommandContract());
  for (const stage of FLOW_STAGES) {
    await writeFileSafe(
      runtimePath(projectRoot, "commands", `${stage}.md`),
      stageCommandShimMarkdown(stage)
    );
  }
}

function toObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

/**
 * Removes // and /* *\/ comments only outside JSON strings (double-quoted).
 * Used for recovering user-edited hook JSON without corrupting string contents.
 */
function stripJsonCommentsOutsideStrings(input: string): string {
  let out = "";
  let i = 0;
  let inString = false;
  let escape = false;
  while (i < input.length) {
    const c = input[i]!;
    if (inString) {
      out += c;
      if (escape) {
        escape = false;
      } else if (c === "\\") {
        escape = true;
      } else if (c === '"') {
        inString = false;
      }
      i += 1;
      continue;
    }
    if (c === '"') {
      inString = true;
      out += c;
      i += 1;
      continue;
    }
    const next = input[i + 1];
    if (c === "/" && next === "/") {
      while (i < input.length && input[i] !== "\n" && input[i] !== "\r") i += 1;
      continue;
    }
    if (c === "/" && next === "*") {
      i += 2;
      while (i < input.length - 1 && !(input[i] === "*" && input[i + 1] === "/")) i += 1;
      i = Math.min(i + 2, input.length);
      continue;
    }
    out += c;
    i += 1;
  }
  return out;
}

function normalizeJsonLike(raw: string): string {
  return stripJsonCommentsOutsideStrings(raw).replace(/,\s*([}\]])/gu, "$1");
}

function tryParseHookDocument(raw: string): { parsed: unknown; recovered: boolean } | null {
  try {
    return { parsed: JSON.parse(raw), recovered: false };
  } catch {
    // continue with relaxed parse
  }

  try {
    return { parsed: JSON.parse(normalizeJsonLike(raw)), recovered: true };
  } catch {
    return null;
  }
}

function opencodeConfigCandidates(projectRoot: string): string[] {
  return [
    path.join(projectRoot, "opencode.json"),
    path.join(projectRoot, "opencode.jsonc"),
    path.join(projectRoot, ".opencode", "opencode.json"),
    path.join(projectRoot, ".opencode", "opencode.jsonc")
  ];
}

function normalizeOpenCodePluginEntry(entry: unknown): string | null {
  if (typeof entry === "string" && entry.trim().length > 0) {
    return entry.trim();
  }
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
    return null;
  }
  const obj = entry as Record<string, unknown>;
  for (const key of ["path", "src", "plugin"] as const) {
    const value = obj[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }
  return null;
}

function mergeOpenCodePluginConfig(
  existingDoc: unknown,
  pluginRelPath: string
): { merged: Record<string, unknown>; changed: boolean } {
  const root = toObject(existingDoc) ?? {};
  const pluginsRaw = Array.isArray(root.plugin) ? [...root.plugin] : [];
  const normalized = new Set(pluginsRaw.map((entry) => normalizeOpenCodePluginEntry(entry)).filter(Boolean));
  if (!normalized.has(pluginRelPath)) {
    pluginsRaw.push(pluginRelPath);
  }
  const permission = toObject(root.permission) ?? {};
  const permissionChanged = permission.question !== "allow";
  const changed =
    !normalized.has(pluginRelPath) ||
    !Array.isArray(root.plugin) ||
    permissionChanged ||
    !toObject(root.permission);
  return {
    merged: {
      ...root,
      plugin: pluginsRaw,
      permission: {
        ...permission,
        question: "allow"
      }
    },
    changed
  };
}

async function resolveOpenCodeConfigPath(projectRoot: string): Promise<string> {
  for (const candidate of opencodeConfigCandidates(projectRoot)) {
    if (await exists(candidate)) {
      return candidate;
    }
  }
  return path.join(projectRoot, "opencode.json");
}

async function writeMergedOpenCodePluginConfig(
  projectRoot: string,
  pluginRelPath: string
): Promise<void> {
  const configPath = await resolveOpenCodeConfigPath(projectRoot);
  await ensureDir(path.dirname(configPath));
  let existingDoc: unknown = {};
  if (await exists(configPath)) {
    try {
      const raw = await fs.readFile(configPath, "utf8");
      const parsed = tryParseHookDocument(raw);
      existingDoc = parsed?.parsed ?? {};
    } catch {
      existingDoc = {};
    }
  }
  const { merged, changed } = mergeOpenCodePluginConfig(existingDoc, pluginRelPath);
  if (changed || !(await exists(configPath))) {
    await writeFileSafe(configPath, `${JSON.stringify(merged, null, 2)}\n`);
  }
}

async function removeManagedOpenCodePluginConfig(projectRoot: string, pluginRelPath: string): Promise<void> {
  for (const configPath of opencodeConfigCandidates(projectRoot)) {
    if (!(await exists(configPath))) continue;
    let parsed: unknown = null;
    try {
      const raw = await fs.readFile(configPath, "utf8");
      parsed = tryParseHookDocument(raw)?.parsed ?? null;
    } catch {
      parsed = null;
    }
    const root = toObject(parsed);
    if (!root || !Array.isArray(root.plugin)) continue;
    const filtered = root.plugin.filter((entry) => normalizeOpenCodePluginEntry(entry) !== pluginRelPath);
    if (filtered.length === root.plugin.length) {
      continue;
    }
    root.plugin = filtered;
    const remainingKeys = Object.keys(root).filter((k) => k !== "plugin" || filtered.length > 0);
    if (remainingKeys.length === 0 || (remainingKeys.length === 1 && remainingKeys[0] === "plugin" && filtered.length === 0)) {
      await fs.rm(configPath, { force: true });
    } else {
      if (filtered.length === 0) {
        delete root.plugin;
      }
      await writeFileSafe(configPath, `${JSON.stringify(root, null, 2)}\n`);
    }
  }
}

function backupFileNameForHook(projectRoot: string, hookFilePath: string): string {
  const rel = path.relative(projectRoot, hookFilePath).replace(/[\\/]/gu, "__");
  const ts = new Date().toISOString().replace(/[:.]/gu, "-");
  return `${rel}.${ts}.bak`;
}

function harnessForHookFile(projectRoot: string, hookFilePath: string): "claude" | "cursor" | "codex" | null {
  const rel = path.relative(projectRoot, hookFilePath).replace(/\\/gu, "/");
  if (rel === ".claude/hooks/hooks.json") return "claude";
  if (rel === ".cursor/hooks.json") return "cursor";
  if (rel === ".codex/hooks.json") return "codex";
  return null;
}

async function pruneOldHookBackups(backupsDir: string, maxBackups = 20): Promise<void> {
  let entries: string[] = [];
  try {
    entries = await fs.readdir(backupsDir);
  } catch {
    entries = [];
  }
  if (entries.length <= maxBackups) return;

  const withStats = await Promise.all(entries.map(async (entry) => {
    const fullPath = path.join(backupsDir, entry);
    const stat = await fs.stat(fullPath);
    return { fullPath, mtimeMs: stat.mtimeMs };
  }));
  withStats.sort((a, b) => b.mtimeMs - a.mtimeMs);
  const stale = withStats.slice(maxBackups);
  await Promise.all(stale.map(async (item) => {
    await fs.rm(item.fullPath, { force: true });
  }));
}

async function backupHookFile(projectRoot: string, hookFilePath: string, rawContent: string): Promise<string> {
  const backupsDir = runtimePath(projectRoot, "backups", "hooks");
  await ensureDir(backupsDir);
  const fileName = backupFileNameForHook(projectRoot, hookFilePath);
  const backupPath = path.join(backupsDir, fileName);
  await writeFileSafe(backupPath, rawContent);
  await pruneOldHookBackups(backupsDir);
  return backupPath;
}

function normalizeHookCommandForDedupe(command: string): string {
  return command.trim().replace(/\s+/gu, " ").replace(/\\/gu, "/");
}

function dedupeHookEntryByCommand(entry: unknown, seenCommands: Set<string>): unknown | undefined {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
    return entry;
  }

  const obj = entry as Record<string, unknown>;
  let changed = false;
  if (typeof obj.command === "string") {
    const normalized = normalizeHookCommandForDedupe(obj.command);
    if (seenCommands.has(normalized)) {
      return undefined;
    }
    seenCommands.add(normalized);
  }

  if (Array.isArray(obj.hooks)) {
    const hooks: unknown[] = [];
    for (const nested of obj.hooks) {
      const deduped = dedupeHookEntryByCommand(nested, seenCommands);
      if (deduped !== undefined) {
        hooks.push(deduped);
      } else {
        changed = true;
      }
    }
    if (hooks.length !== obj.hooks.length) {
      changed = true;
    }
    if (hooks.length === 0 && typeof obj.command !== "string") {
      return undefined;
    }
    return changed ? { ...obj, hooks } : entry;
  }

  return entry;
}

function dedupeHookEntriesByCommand(entries: unknown[]): unknown[] {
  const seenCommands = new Set<string>();
  const deduped: unknown[] = [];
  for (const entry of entries) {
    const next = dedupeHookEntryByCommand(entry, seenCommands);
    if (next !== undefined) {
      deduped.push(next);
    }
  }
  return deduped;
}

function mergeHookDocuments(existingDoc: unknown, generatedDoc: unknown): Record<string, unknown> {
  const generatedRoot = toObject(generatedDoc) ?? {};
  const generatedHooks = toObject(generatedRoot.hooks) ?? {};

  const strippedExisting = stripManagedHookCommands(existingDoc).updated;
  const existingRoot = toObject(strippedExisting) ?? {};
  const existingHooks = toObject(existingRoot.hooks) ?? {};
  const mergedHooks: Record<string, unknown> = { ...existingHooks };

  for (const [eventName, generatedEntries] of Object.entries(generatedHooks)) {
    const existingEntries = existingHooks[eventName];
    if (Array.isArray(generatedEntries)) {
      const preservedEntries = Array.isArray(existingEntries) ? existingEntries : [];
      mergedHooks[eventName] = dedupeHookEntriesByCommand([...generatedEntries, ...preservedEntries]);
      continue;
    }
    // Defensive: malformed generated event payload must not wipe user hooks.
    if (Array.isArray(existingEntries)) {
      mergedHooks[eventName] = existingEntries;
    } else {
      mergedHooks[eventName] = generatedEntries;
    }
  }

  const mergedRoot: Record<string, unknown> = {
    ...existingRoot,
    hooks: mergedHooks
  };

  for (const [key, value] of Object.entries(generatedRoot)) {
    if (key === "hooks") continue;
    if (!(key in mergedRoot)) {
      mergedRoot[key] = value;
    }
  }

  return mergedRoot;
}

async function writeMergedHookJson(
  projectRoot: string,
  hookFilePath: string,
  generatedJson: string
): Promise<void> {
  let existingDoc: unknown = {};
  if (await exists(hookFilePath)) {
    try {
      const raw = await fs.readFile(hookFilePath, "utf8");
      const parsed = tryParseHookDocument(raw);
      if (parsed) {
        existingDoc = parsed.parsed;
        if (parsed.recovered) {
          await backupHookFile(projectRoot, hookFilePath, raw);
        }
      } else {
        await backupHookFile(projectRoot, hookFilePath, raw);
        existingDoc = {};
      }
    } catch {
      existingDoc = {};
    }
  }

  const generatedDoc = JSON.parse(generatedJson) as Record<string, unknown>;
  const harness = harnessForHookFile(projectRoot, hookFilePath);
  if (harness) {
    const generatedSchema = validateHookDocument(harness, generatedDoc);
    if (!generatedSchema.ok) {
      throw new Error(
        `[sync fail-fast] Hook document drift detected for ${harness}: generated hook document is invalid (${generatedSchema.errors.join("; ")}). ` +
        "Run `npx cclaw-cli sync` to regenerate managed hooks or repair the generated hook shape manually."
      );
    }
  }

  const mergedDoc = mergeHookDocuments(existingDoc, generatedDoc);
  if (harness) {
    const mergedSchema = validateHookDocument(harness, mergedDoc);
    if (!mergedSchema.ok) {
      throw new Error(
        `[sync fail-fast] Hook document drift detected for ${harness}: merged hook document is invalid (${mergedSchema.errors.join("; ")}). ` +
        "Run `npx cclaw-cli sync` after fixing the custom hook entry or remove the malformed user-authored hook block."
      );
    }
  }
  await writeFileSafe(hookFilePath, `${JSON.stringify(mergedDoc, null, 2)}\n`);
}

interface BundledRunHookModule {
  buildRunHookRuntimeScript?: (options?: NodeHookRuntimeOptions) => string;
  default?: (options?: NodeHookRuntimeOptions) => string;
}

async function readBundledRunHookRuntimeScript(
  options: NodeHookRuntimeOptions
): Promise<string | null> {
  const bundleUrl = new URL("./runtime/run-hook.mjs", import.meta.url);
  try {
    await fs.stat(bundleUrl);
  } catch {
    return null;
  }

  try {
    const moduleUrl = `${bundleUrl.href}?ts=${Date.now()}`;
    const loaded = await import(moduleUrl) as BundledRunHookModule;
    const factory = typeof loaded.buildRunHookRuntimeScript === "function"
      ? loaded.buildRunHookRuntimeScript
      : typeof loaded.default === "function"
        ? loaded.default
        : null;
    if (!factory) return null;
    const script = factory(options);
    if (typeof script !== "string") return null;
    return script.trim().length > 0 ? script : null;
  } catch {
    return null;
  }
}

async function writeHooks(projectRoot: string, config: CclawConfig): Promise<void> {
  const harnesses = config.harnesses;
  const hooksDir = runtimePath(projectRoot, "hooks");
  const stateDir = runtimePath(projectRoot, "state");
  await ensureDir(hooksDir);
  await ensureDir(stateDir);

  await writeFileSafe(path.join(hooksDir, "stage-complete.mjs"), stageCompleteScript());
  await writeFileSafe(path.join(hooksDir, "start-flow.mjs"), startFlowScript());
  await writeFileSafe(path.join(hooksDir, "cancel-run.mjs"), cancelRunScript());
  const hookRuntimeOptions: NodeHookRuntimeOptions = {};
  const bundledHookRuntime = await readBundledRunHookRuntimeScript(hookRuntimeOptions);
  await writeFileSafe(
    path.join(hooksDir, "run-hook.mjs"),
    bundledHookRuntime ?? nodeHookRuntimeScript(hookRuntimeOptions)
  );
  await writeFileSafe(path.join(hooksDir, "run-hook.cmd"), runHookCmdScript());
  await writeFileSafe(path.join(hooksDir, "delegation-record.mjs"), delegationRecordScript());
  const opencodePluginSource = opencodePluginJs();
  await writeFileSafe(path.join(hooksDir, "opencode-plugin.mjs"), opencodePluginSource);

  try {
    for (const script of [
      "stage-complete.mjs",
      "start-flow.mjs",
      "run-hook.mjs",
      "run-hook.cmd",
      "delegation-record.mjs",
      "opencode-plugin.mjs",
      "cancel-run.mjs"
    ]) {
      await fs.chmod(path.join(hooksDir, script), 0o755);
    }
  } catch {
    // chmod may fail on some filesystems
  }

  if (harnesses.includes("opencode")) {
    const opencodePluginsDir = path.join(projectRoot, ".opencode/plugins");
    const opencodePluginPath = path.join(projectRoot, OPENCODE_PLUGIN_REL_PATH);
    await ensureDir(opencodePluginsDir);
    await writeFileSafe(opencodePluginPath, opencodePluginSource);
    await writeMergedOpenCodePluginConfig(projectRoot, OPENCODE_PLUGIN_REL_PATH);
    try {
      await fs.chmod(opencodePluginPath, 0o755);
    } catch {
      // chmod may fail on some filesystems
    }
  }

  for (const harness of harnesses) {
    if (harness === "claude") {
      const dir = path.join(projectRoot, ".claude/hooks");
      await ensureDir(dir);
      await writeMergedHookJson(projectRoot, path.join(dir, "hooks.json"), claudeHooksJson());
    } else if (harness === "cursor") {
      const cursorDir = path.join(projectRoot, ".cursor");
      await ensureDir(cursorDir);
      await writeMergedHookJson(projectRoot, path.join(cursorDir, "hooks.json"), cursorHooksJson());
    } else if (harness === "codex") {
      // Codex CLI ≥ v0.114 (Mar 2026) supports lifecycle hooks at
      // `.codex/hooks.json`, gated behind the `[features] codex_hooks = true`
      // flag in `~/.codex/config.toml`. cclaw always writes the file so
      // the moment the flag flips on, the cclaw hooks start firing. See
      // `codexHooksJsonWithObservation` for the Bash-only caveat on
      // PreToolUse/PostToolUse. If the feature flag is off, hooks remain
      // inert until the user enables codex_hooks in ~/.codex/config.toml.
      const codexDir = path.join(projectRoot, ".codex");
      await ensureDir(codexDir);
      await writeMergedHookJson(projectRoot, path.join(codexDir, "hooks.json"), codexHooksJson());
    }
    // OpenCode registration is auto-managed via opencode.json/opencode.jsonc.
  }
}

async function ensureKnowledgeStore(projectRoot: string): Promise<void> {
  const storePath = runtimePath(projectRoot, "knowledge.jsonl");
  if (!(await exists(storePath))) {
    await writeFileSafe(storePath, "", { mode: 0o600 });
  }
  const legacyMdPath = runtimePath(projectRoot, "knowledge.md");
  if (await exists(legacyMdPath)) {
    await fs.rm(legacyMdPath, { force: true });
  }
}



async function writeRulebook(projectRoot: string): Promise<void> {
  await writeFileSafe(runtimePath(projectRoot, "rules", "RULES.md"), RULEBOOK_MARKDOWN);
  await writeFileSafe(
    runtimePath(projectRoot, "rules", "rules.json"),
    `${JSON.stringify(buildRulesJson(), null, 2)}\n`
  );
}

async function writeCursorWorkflowRule(projectRoot: string, harnesses: HarnessId[]): Promise<void> {
  const rulePath = path.join(projectRoot, CURSOR_RULE_REL_PATH);
  const guidelinesPath = path.join(projectRoot, CURSOR_GUIDELINES_REL_PATH);
  if (!harnesses.includes("cursor")) {
    for (const target of [rulePath, guidelinesPath]) {
      try {
        await fs.rm(target, { force: true });
      } catch {
        // best-effort cleanup
      }
    }
    return;
  }
  await ensureDir(path.dirname(rulePath));
  await writeFileSafe(rulePath, CURSOR_WORKFLOW_RULE_MDC);
  await ensureDir(path.dirname(guidelinesPath));
  await writeFileSafe(guidelinesPath, CURSOR_GUIDELINES_RULE_MDC);
}

async function syncDisabledHarnessArtifacts(projectRoot: string, harnesses: HarnessId[]): Promise<void> {
  const enabled = new Set<HarnessId>(harnesses);
  // v0.40.0: `.codex/hooks.json` is back on the managed list now that
  // Codex CLI actually consumes it (v0.114+, Mar 2026). Legacy
  // `.codex/commands/` cleanup still happens unconditionally from
  // `cleanupLegacyCodexSurfaces` inside `syncHarnessShims`.
  const managedHookFiles: Array<{ harness: HarnessId; hookPath: string }> = [
    { harness: "claude", hookPath: path.join(projectRoot, ".claude/hooks/hooks.json") },
    { harness: "cursor", hookPath: path.join(projectRoot, ".cursor/hooks.json") },
    { harness: "codex", hookPath: path.join(projectRoot, ".codex/hooks.json") }
  ];

  for (const entry of managedHookFiles) {
    if (enabled.has(entry.harness)) continue;
    await removeManagedHookEntries(entry.hookPath, { failOnParseError: true });
  }

  if (!enabled.has("opencode")) {
    try {
      await fs.rm(path.join(projectRoot, OPENCODE_PLUGIN_REL_PATH), { force: true });
    } catch {
      // best-effort cleanup
    }
    try {
      await fs.rm(path.join(projectRoot, ".opencode/agents"), { recursive: true, force: true });
    } catch {
      // best-effort cleanup
    }
    await removeManagedOpenCodePluginConfig(projectRoot, OPENCODE_PLUGIN_REL_PATH);
  }

  if (!enabled.has("codex")) {
    try {
      await fs.rm(path.join(projectRoot, ".codex/agents"), { recursive: true, force: true });
    } catch {
      // best-effort cleanup
    }
  }
}

async function writeState(projectRoot: string, config: CclawConfig, forceReset = false): Promise<void> {
  void config;
  // Fresh init no longer materializes flow-state.json. The first managed
  // `/cc <idea>` start-flow call creates the state file.
  if (!forceReset) {
    return;
  }
  const statePath = runtimePath(projectRoot, "state", "flow-state.json");
  if (await exists(statePath)) {
    return;
  }

  const state = createInitialFlowState({ track: "standard" });
  await writeFileSafe(statePath, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
}

/**
 * v6.12.0 — TDD auto-cutover sync. When sync detects a legacy `06-tdd.md`
 * (no auto-render markers) carrying observable slice activity (e.g. `S-N`
 * referenced ≥3 times in slice-section bodies), insert the v6.11.0 marker
 * skeleton + a one-line cutover banner and stamp the highest legacy slice
 * id into `flow-state.json::tddCutoverSliceId`. Idempotent: re-running sync
 * is byte-stable once markers are present.
 *
 * Design notes:
 *   - Best-effort: read failures, missing flow-state, or unparseable JSON
 *     all short-circuit silently. We never throw inside sync for migration
 *     bookkeeping.
 *   - We use `writeFlowState({ allowReset: true })` so we don't trip
 *     `validateFlowTransition` (the only field we mutate is the new
 *     additive `tddCutoverSliceId`; transition rules don't apply).
 *   - The banner mirrors the language in the `## Per-Slice Ritual`
 *     skill section so a reader of `06-tdd.md` who hasn't seen v6.12.0
 *     understands the contract change.
 */
async function applyTddCutoverIfNeeded(projectRoot: string): Promise<void> {
  const tddArtifactPath = runtimePath(projectRoot, "artifacts", "06-tdd.md");
  let existing: string;
  try {
    existing = await fs.readFile(tddArtifactPath, "utf8");
  } catch {
    return;
  }
  if (existing.includes("<!-- auto-start: tdd-slice-summary -->")) {
    return;
  }

  const sliceMatches = [...existing.matchAll(/\bS-(\d+)\b/gu)];
  if (sliceMatches.length < 3) {
    return;
  }
  let maxSliceNum = 0;
  for (const match of sliceMatches) {
    const n = Number.parseInt(match[1]!, 10);
    if (Number.isFinite(n) && n > maxSliceNum) {
      maxSliceNum = n;
    }
  }
  if (maxSliceNum <= 0) {
    return;
  }
  const cutoverSliceId = `S-${maxSliceNum}`;

  const banner = [
    `<!-- v6.12.0 cutover: slices S-1..${cutoverSliceId} use legacy per-slice tables.`,
    `     New slices (S-${maxSliceNum + 1}+) use phase events + tdd-slices/<id>.md.`,
    "     Controller MUST NOT add new rows to legacy sections. -->"
  ].join("\n");
  const slicesIndexBlock = [
    "<!-- auto-start: slices-index -->",
    "## Slices Index",
    "",
    "_Auto-rendered from `tdd-slices/S-*.md` once slice-documenter or controller writes per-slice files. Do not edit by hand._",
    "<!-- auto-end: slices-index -->"
  ].join("\n");
  const summaryBlock = [
    "<!-- auto-start: tdd-slice-summary -->",
    "<!-- auto-end: tdd-slice-summary -->"
  ].join("\n");

  let nextRaw: string;
  if (existing.startsWith("---\n")) {
    const fmEnd = existing.indexOf("\n---", 4);
    if (fmEnd >= 0) {
      const fmClose = fmEnd + 4;
      const head = existing.slice(0, fmClose);
      const tail = existing.slice(fmClose);
      nextRaw = `${head}\n\n${banner}\n\n${slicesIndexBlock}\n\n${summaryBlock}\n${tail}`;
    } else {
      nextRaw = `${banner}\n\n${slicesIndexBlock}\n\n${summaryBlock}\n\n${existing}`;
    }
  } else {
    nextRaw = `${banner}\n\n${slicesIndexBlock}\n\n${summaryBlock}\n\n${existing}`;
  }

  await writeFileSafe(tddArtifactPath, nextRaw);
  const slicesDir = runtimePath(projectRoot, "artifacts", "tdd-slices");
  await ensureDir(slicesDir);

  const flowStatePath = runtimePath(projectRoot, "state", "flow-state.json");
  let flowStateRaw: string;
  try {
    flowStateRaw = await fs.readFile(flowStatePath, "utf8");
  } catch {
    return;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(flowStateRaw);
  } catch {
    return;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return;
  }
  const obj = parsed as Record<string, unknown>;
  if (typeof obj.tddCutoverSliceId === "string" && obj.tddCutoverSliceId.length > 0) {
    return;
  }
  // v6.14.3 — refresh the SHA256 sidecar by writing through
  // `writeFlowState`. The previous direct `writeFileSafe` invocation
  // left the sidecar stale, so the very next guarded hook on a synced
  // legacy project rejected its own `tddCutoverSliceId` stamp.
  try {
    const state = await readFlowState(projectRoot);
    await writeFlowState(
      projectRoot,
      { ...state, tddCutoverSliceId: cutoverSliceId },
      {
        allowReset: true,
        writerSubsystem: "sync-v6.12-tdd-cutover-stamp"
      }
    );
  } catch {
    // Best-effort: corrupt/missing state is handled elsewhere on sync.
  }
}

const V613_LEGACY_PLAN_BANNER =
  "<!-- legacy-continuation: predates v6.13 parallel metadata. New units MAY add dependsOn/claimedPaths/parallelizable; existing units treated as best-effort serial. -->";

/**
 * v6.13.0 — when `05-plan.md` lacks parallel-metadata bullets on any
 * implementation unit, stamp `flow-state.json::legacyContinuation`, insert
 * a banner + managed Parallel Execution Plan stub, and keep behavior idempotent.
 */
async function applyPlanLegacyContinuationIfNeeded(projectRoot: string): Promise<void> {
  const planArtifactPath = runtimePath(projectRoot, "artifacts", "05-plan.md");
  let existingPlan: string;
  try {
    existingPlan = await fs.readFile(planArtifactPath, "utf8");
  } catch {
    return;
  }
  if (!planArtifactLacksV613ParallelMetadata(existingPlan)) {
    return;
  }
  let nextPlan = existingPlan;
  if (!nextPlan.includes("legacy-continuation: predates v6.13")) {
    if (nextPlan.startsWith("---\n")) {
      const fmEnd = nextPlan.indexOf("\n---", 4);
      if (fmEnd >= 0) {
        const fmClose = fmEnd + 4;
        const head = nextPlan.slice(0, fmClose);
        const tail = nextPlan.slice(fmClose);
        nextPlan = `${head}\n\n${V613_LEGACY_PLAN_BANNER}\n${tail}`;
      } else {
        nextPlan = `${V613_LEGACY_PLAN_BANNER}\n\n${nextPlan}`;
      }
    } else {
      nextPlan = `${V613_LEGACY_PLAN_BANNER}\n\n${nextPlan}`;
    }
  }
  const parallelStub = buildParallelExecutionPlanSection([], PLAN_SPLIT_DEFAULT_WAVE_SIZE);
  if (!nextPlan.includes("<!-- parallel-exec-managed-start -->")) {
    nextPlan = upsertParallelExecutionPlanSection(nextPlan, parallelStub);
  }
  if (nextPlan !== existingPlan) {
    await writeFileSafe(planArtifactPath, nextPlan);
  }
  const flowStatePath = runtimePath(projectRoot, "state", "flow-state.json");
  if (!(await exists(flowStatePath))) {
    return;
  }
  try {
    const state = await readFlowState(projectRoot);
    if (state.legacyContinuation === true) {
      return;
    }
    await writeFlowState(projectRoot, { ...state, legacyContinuation: true }, {
      allowReset: true,
      writerSubsystem: "plan-legacy-continuation-sync"
    });
  } catch {
    // Best-effort: corrupt/missing state is handled elsewhere on sync.
  }
}

/**
 * v6.14.0 — set stream-style defaults on `cclaw-cli sync` and print a
 * one-line hint when defaults change.
 *
 * v6.14.2 update — flip the legacyContinuation defaults from
 * `global-red`/`always` to `per-slice`/`conditional`. Rationale: hox-shape
 * projects ran into S-17 misroutes precisely because the default
 * preserved the v6.12 wave barrier even after the project itself had
 * moved to stream-mode. Existing flow-state values are NEVER overwritten
 * — operators who want to pin `global-red`/`always` may set them
 * explicitly via `cclaw-cli internal set-checkpoint-mode global-red` and
 * `set-integration-overseer-mode always`.
 *
 * Strategy:
 *
 * - When `legacyContinuation: true` and `tddCheckpointMode` is unset,
 *   default to `tddCheckpointMode: "per-slice"` (v6.14.2 — was
 *   `global-red` in v6.14.0/v6.14.1).
 * - When `legacyContinuation: true` and `integrationOverseerMode` is
 *   unset, default to `integrationOverseerMode: "conditional"` (v6.14.2
 *   — was `always` in v6.14.0/v6.14.1).
 * - When `legacyContinuation` is NOT true (new / standard projects) and
 *   neither field is set, default to `tddCheckpointMode: "per-slice"`,
 *   `integrationOverseerMode: "conditional"`. Also default
 *   `worktreeExecutionMode: "worktree-first"` if unset.
 *
 * Returns a one-line hint string (or `null` if nothing changed) so callers
 * can print it through the standard sync hint surface.
 */
async function applyV614DefaultsIfNeeded(projectRoot: string): Promise<string | null> {
  // Defensive read — match `applyTddCutoverIfNeeded`'s pattern (raw +
  // JSON.parse) so corrupt state is left untouched for the downstream
  // fail-fast check in `materializeRuntime` (which expects to see the
  // CorruptFlowStateError surfaced via `ensureRunSystem`). Calling
  // `readFlowState` directly would quarantine the corrupt file and hide
  // the failure from the caller.
  const flowStatePath = runtimePath(projectRoot, "state", "flow-state.json");
  let flowStateRaw: string;
  try {
    flowStateRaw = await fs.readFile(flowStatePath, "utf8");
  } catch {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(flowStateRaw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return null;
  }
  const obj = parsed as Record<string, unknown>;
  const updates: Record<string, unknown> = {};
  const summary: string[] = [];

  const tddCheckpointModeSet =
    obj.tddCheckpointMode === "per-slice" || obj.tddCheckpointMode === "global-red";
  const integrationOverseerModeSet =
    obj.integrationOverseerMode === "conditional" || obj.integrationOverseerMode === "always";
  const worktreeExecutionModeSet =
    obj.worktreeExecutionMode === "worktree-first" || obj.worktreeExecutionMode === "single-tree";
  const legacyContinuation = obj.legacyContinuation === true;

  if (legacyContinuation) {
    if (!tddCheckpointModeSet) {
      updates.tddCheckpointMode = "per-slice";
      summary.push("tddCheckpointMode=per-slice (legacyContinuation, v6.14.2 default flip)");
    }
    if (!integrationOverseerModeSet) {
      updates.integrationOverseerMode = "conditional";
      summary.push("integrationOverseerMode=conditional (legacyContinuation, v6.14.2 default flip)");
    }
  } else {
    if (!tddCheckpointModeSet) {
      updates.tddCheckpointMode = "per-slice";
      summary.push("tddCheckpointMode=per-slice");
    }
    if (!integrationOverseerModeSet) {
      updates.integrationOverseerMode = "conditional";
      summary.push("integrationOverseerMode=conditional");
    }
    if (!worktreeExecutionModeSet) {
      updates.worktreeExecutionMode = "worktree-first";
      summary.push("worktreeExecutionMode=worktree-first");
    }
  }

  if (summary.length === 0) {
    return null;
  }

  // v6.14.3 — refresh the SHA256 sidecar in lockstep so guarded reads
  // (verify-current-state, advance-stage, etc.) don't trip a guard
  // mismatch immediately after `cclaw-cli sync`/`upgrade` writes the
  // v6.14.2 stream-style defaults.
  try {
    const state = await readFlowState(projectRoot);
    await writeFlowState(
      projectRoot,
      { ...state, ...(updates as Partial<FlowState>) },
      {
        allowReset: true,
        writerSubsystem: "sync-v6.14.2-stream-defaults"
      }
    );
  } catch {
    return null;
  }

  return `v6.14.2 stream-style defaults applied: ${summary.join(", ")}. To opt out, run cclaw-cli internal set-checkpoint-mode global-red --reason="..." and/or cclaw-cli internal set-integration-overseer-mode always --reason="...".`;
}

/**
 * v6.14.2 — auto-stamp `tddWorktreeCutoverSliceId` for legacyContinuation
 * projects in worktree-first mode that haven't yet recorded a boundary.
 *
 * Detection ("any-metadata" rule): scan the active run's
 * `slice-implementer` rows. The boundary is the highest `S-N` whose
 * rows for the active run lack ALL of `claimToken`, `ownerLaneId`, and
 * `leasedUntil`. When no such slice exists (every slice carries at
 * least one worktree field), fall back to `tddCutoverSliceId` so the
 * v6.12 cutover marker still confers exemption.
 *
 * Idempotent: when the field is already set, returns null without
 * writing. Best-effort: read failures, missing ledger, or unparseable
 * rows all short-circuit silently — the existing flow-state.json is
 * never corrupted.
 *
 * Returns a one-line hint string (or `null` if nothing changed).
 */
async function applyV6142WorktreeCutoverIfNeeded(
  projectRoot: string
): Promise<string | null> {
  const flowStatePath = runtimePath(projectRoot, "state", "flow-state.json");
  let flowStateRaw: string;
  try {
    flowStateRaw = await fs.readFile(flowStatePath, "utf8");
  } catch {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(flowStateRaw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return null;
  }
  const obj = parsed as Record<string, unknown>;
  if (obj.legacyContinuation !== true) return null;
  if (obj.worktreeExecutionMode !== "worktree-first") return null;
  if (
    typeof obj.tddWorktreeCutoverSliceId === "string" &&
    obj.tddWorktreeCutoverSliceId.trim().length > 0
  ) {
    return null;
  }

  const ledgerPath = runtimePath(projectRoot, "state", "delegation-log.json");
  const activeRunId = typeof obj.activeRunId === "string" ? obj.activeRunId : "";
  let ledgerRaw: string;
  try {
    ledgerRaw = await fs.readFile(ledgerPath, "utf8");
  } catch {
    ledgerRaw = "";
  }
  let ledgerParsed: unknown = null;
  if (ledgerRaw.length > 0) {
    try {
      ledgerParsed = JSON.parse(ledgerRaw);
    } catch {
      ledgerParsed = null;
    }
  }
  const entries =
    ledgerParsed &&
    typeof ledgerParsed === "object" &&
    !Array.isArray(ledgerParsed) &&
    Array.isArray((ledgerParsed as Record<string, unknown>).entries)
      ? ((ledgerParsed as Record<string, unknown>).entries as Array<Record<string, unknown>>)
      : [];

  let boundary = -1;
  for (const entry of entries) {
    if (entry.agent !== "slice-implementer") continue;
    if (entry.status !== "completed") continue;
    if (typeof entry.sliceId !== "string") continue;
    if (activeRunId && entry.runId && entry.runId !== activeRunId) continue;
    const tok = typeof entry.claimToken === "string" ? entry.claimToken.trim() : "";
    const lane = typeof entry.ownerLaneId === "string" ? entry.ownerLaneId.trim() : "";
    const lease =
      typeof entry.leasedUntil === "string" ? entry.leasedUntil.trim() : "";
    if (tok.length > 0 || lane.length > 0 || lease.length > 0) continue;
    const m = /^S-(\d+)$/u.exec(entry.sliceId);
    if (!m) continue;
    const n = Number.parseInt(m[1]!, 10);
    if (!Number.isFinite(n)) continue;
    if (n > boundary) boundary = n;
  }

  let stamped: string | null = null;
  if (boundary >= 0) {
    stamped = `S-${boundary}`;
  } else if (
    typeof obj.tddCutoverSliceId === "string" &&
    /^S-\d+$/u.test(obj.tddCutoverSliceId)
  ) {
    stamped = obj.tddCutoverSliceId;
  }
  if (!stamped) return null;

  // v6.14.3 — go through `writeFlowState` so the SHA256 sidecar
  // (`.cclaw/.flow-state.guard.json`) is refreshed in lockstep with
  // the on-disk flow-state.json. The previous v6.14.2 implementation
  // wrote the field via `writeFileSafe` directly, which left the
  // sidecar pointing at the pre-stamp digest; the next guarded hook
  // (e.g. `cclaw internal verify-current-state`) then failed with
  // `flow-state guard mismatch` and demanded a manual repair.
  try {
    const state = await readFlowState(projectRoot);
    await writeFlowState(
      projectRoot,
      { ...state, tddWorktreeCutoverSliceId: stamped },
      {
        allowReset: true,
        writerSubsystem: "sync-v6.14.2-worktree-cutover-stamp"
      }
    );
  } catch {
    return null;
  }
  return (
    `v6.14.2 stamped tddWorktreeCutoverSliceId=${stamped}; closed slices ≤ ${stamped} ` +
    "are exempt from worktree-first findings under legacyContinuation. " +
    "Edit .cclaw/state/flow-state.json to override (advisory)."
  );
}

async function cleanLegacyArtifacts(projectRoot: string): Promise<void> {
  for (const legacyFolder of DEPRECATED_UTILITY_SKILL_FOLDERS) {
    await removeBestEffort(runtimePath(projectRoot, "skills", legacyFolder), true);
  }
  for (const legacyFolder of DEPRECATED_STAGE_SKILL_FOLDERS) {
    await removeBestEffort(runtimePath(projectRoot, "skills", legacyFolder), true);
  }
  for (const legacyFolder of DEPRECATED_SKILL_FOLDERS_FULL) {
    await removeBestEffort(runtimePath(projectRoot, "skills", legacyFolder), true);
  }

  for (const legacyAgentFile of DEPRECATED_AGENT_FILES) {
    await removeBestEffort(runtimePath(projectRoot, "agents", legacyAgentFile));
  }

  for (const legacyPlugin of [
    path.join(projectRoot, ".opencode/plugins/viby-plugin.mjs"),
    path.join(projectRoot, ".opencode/plugins/opencode-plugin.mjs"),
    path.join(projectRoot, OPENCODE_PLUGIN_REL_PATH)
  ]) {
    await removeBestEffort(legacyPlugin);
  }

  for (const legacyRuntimeFile of [
    ...DEPRECATED_COMMAND_FILES.map((file) => runtimePath(projectRoot, "commands", file)),
    ...DEPRECATED_SKILL_FILES.map((segments) => runtimePath(projectRoot, "skills", ...segments)),
    ...DEPRECATED_STATE_FILES.map((file) => runtimePath(projectRoot, "state", file)),
    ...DEPRECATED_ARTIFACT_FILES.map((file) => runtimePath(projectRoot, "artifacts", file)),
    ...DEPRECATED_RUNTIME_ROOT_FILES.map((file) => runtimePath(projectRoot, file)),
    ...DEPRECATED_HOOK_FILES.map((file) => runtimePath(projectRoot, "hooks", file))
  ]) {
    await removeBestEffort(legacyRuntimeFile);
  }

  // Runtime simplification cleanup: these folders were generated in older
  // releases and are now intentionally removed from user projects.
  for (const legacyRuntimeDir of DEPRECATED_RUNTIME_DIRS) {
    await removeBestEffort(runtimePath(projectRoot, legacyRuntimeDir), true);
  }

  // Archive storage migration: `.cclaw/runs` is legacy and no longer a valid
  // archive root. Remove only when empty; otherwise keep it so users can
  // manually migrate or inspect old data.
  const legacyRunsDir = runtimePath(projectRoot, "runs");
  try {
    const entries = await fs.readdir(legacyRunsDir);
    if (entries.length === 0) {
      await fs.rm(legacyRunsDir, { recursive: true, force: true });
    }
  } catch {
    // missing or unreadable legacy dir; keep best-effort behavior
  }

  // D-4 terminology migration: rename historical ideation artifact prefixes to
  // the canonical idea-* naming without deleting user-authored content.
  const legacyIdeaArtifactPattern = /^ideation-(.+\.md)$/u;
  const artifactsDir = runtimePath(projectRoot, "artifacts");
  try {
    const entries = await fs.readdir(artifactsDir);
    for (const entry of entries) {
      const match = legacyIdeaArtifactPattern.exec(entry);
      if (!match) continue;
      const nextName = `idea-${match[1]}`;
      const from = path.join(artifactsDir, entry);
      const to = path.join(artifactsDir, nextName);
      if (await exists(to)) {
        continue;
      }
      await fs.rename(from, to);
    }
  } catch {
    // no artifacts directory yet (fresh init) or read-only FS
  }
}

async function cleanStaleFiles(projectRoot: string): Promise<void> {
  const expectedShimFiles = new Set<string>(harnessShimFileNames());
  const expectedShimSkills = new Set<string>(harnessShimFileNames().map((fileName) => fileName.replace(/\.md$/u, "")));

  for (const adapter of Object.values(HARNESS_ADAPTERS)) {
    const commandDir = path.join(projectRoot, adapter.commandDir);
    if (!(await exists(commandDir))) continue;

    let entries: string[] = [];
    try {
      entries = await fs.readdir(commandDir);
    } catch {
      entries = [];
    }

    if (adapter.shimKind === "skill") {
      for (const entry of entries) {
        if (!/^cc(?:-.*)?$/u.test(entry)) continue;
        if (expectedShimSkills.has(entry)) continue;
        await fs.rm(path.join(commandDir, entry), { recursive: true, force: true });
      }
      continue;
    }

    for (const entry of entries) {
      if (!/^cc(?:-.*)?\.md$/u.test(entry)) continue;
      if (expectedShimFiles.has(entry)) continue;
      await fs.rm(path.join(commandDir, entry), { force: true });
    }
  }
  // Keep user-owned custom assets under .cclaw/agents and .cclaw/skills.
  // Legacy managed removals happen in cleanLegacyArtifacts() with explicit paths.
}



async function assertExpectedHarnessShims(
  projectRoot: string,
  harnesses: readonly HarnessId[]
): Promise<void> {
  const expectedFiles = harnessShimFileNames();
  const expectedSkillFolders = harnessShimSkillNames();
  for (const harness of harnesses) {
    const adapter = HARNESS_ADAPTERS[harness];
    const base = path.join(projectRoot, adapter.commandDir);
    for (const fileName of expectedFiles) {
      const target = adapter.shimKind === "skill"
        ? path.join(base, fileName.replace(/\.md$/u, ""), "SKILL.md")
        : path.join(base, fileName);
      if (!(await exists(target))) {
        throw new Error(
          `[sync fail-fast] Harness shim drift detected for ${harness}: missing ${target}. ` +
          `Run \`npx cclaw-cli sync\` again; if the file is still missing, inspect harness permissions/paths.`
        );
      }
    }
    if (adapter.shimKind === "skill") {
      for (const folder of expectedSkillFolders) {
        const skillPath = path.join(base, folder, "SKILL.md");
        if (!(await exists(skillPath))) {
          throw new Error(
            `[sync fail-fast] Harness skill shim drift detected for ${harness}: missing ${skillPath}. ` +
            `Run \`npx cclaw-cli sync\` again; if the issue persists, inspect generated .agents/skills surfaces.`
          );
        }
      }
    }
  }
}

async function maybeLogParallelWaveDispatchHint(projectRoot: string): Promise<void> {
  const flowPath = runtimePath(projectRoot, "state", "flow-state.json");
  if (!(await exists(flowPath))) return;
  try {
    const state = await readFlowState(projectRoot);
    if (effectiveWorktreeExecutionMode(state) !== "worktree-first") return;
    const planPath = runtimePath(projectRoot, "artifacts", "05-plan.md");
    if (!(await exists(planPath))) return;
    const planRaw = await fs.readFile(planPath, "utf8");
    const merged = mergeParallelWaveDefinitions(
      parseParallelExecutionPlanWaves(planRaw),
      await parseWavePlanDirectory(runtimePath(projectRoot, "artifacts"))
    );
    const hint = formatNextParallelWaveSyncHint(merged);
    if (hint) {
      process.stdout.write(`cclaw: ${hint}\n`);
    }
  } catch {
    // best-effort note only
  }
}

async function materializeRuntime(
  projectRoot: string,
  config: CclawConfig,
  forceStateReset: boolean,
  operation = "sync"
): Promise<void> {
  await warnStaleInitSentinel(projectRoot, operation);
  const sentinelPath = await writeInitSentinel(projectRoot, operation);
  const managedSession = await ManagedResourceSession.create({ projectRoot, operation });
  setActiveManagedResourceSession(managedSession);
  try {
    const harnesses = config.harnesses;
    await ensureStructure(projectRoot);
    await cleanLegacyArtifacts(projectRoot);
    await cleanStaleFiles(projectRoot);
    await Promise.all([
      writeEntryCommands(projectRoot),
      writeSkills(projectRoot, config),
      writeArtifactTemplates(projectRoot),
      writeWavePlansScaffold(projectRoot),
      writeRulebook(projectRoot)
    ]);
    await writeState(projectRoot, config, forceStateReset);
    if (operation === "sync" || operation === "upgrade") {
      await applyTddCutoverIfNeeded(projectRoot);
      await applyPlanLegacyContinuationIfNeeded(projectRoot);
      const v614Hint = await applyV614DefaultsIfNeeded(projectRoot);
      if (v614Hint) {
        process.stdout.write(`cclaw: ${v614Hint}\n`);
      }
      const v6142Hint = await applyV6142WorktreeCutoverIfNeeded(projectRoot);
      if (v6142Hint) {
        process.stdout.write(`cclaw: ${v6142Hint}\n`);
      }
    }
    try {
      await ensureRunSystem(projectRoot, { createIfMissing: false });
    } catch (error) {
      if (error instanceof CorruptFlowStateError) {
        throw new Error(
          `[sync fail-fast] Corrupt flow state detected: ${error.message} ` +
          `Resolve the quarantined flow-state file and re-run \`npx cclaw-cli sync\`.`
        );
      }
      throw error;
    }
    await ensureKnowledgeStore(projectRoot);
    await writeHooks(projectRoot, config);
    await syncDisabledHarnessArtifacts(projectRoot, harnesses);
    await cleanupLegacyManagedGitHookRelays(projectRoot);
    await syncHarnessShims(projectRoot, harnesses);
    await assertExpectedHarnessShims(projectRoot, harnesses);
    await writeCursorWorkflowRule(projectRoot, harnesses);
    await ensureGitignore(projectRoot);
    if (operation === "sync" || operation === "upgrade") {
      await maybeLogParallelWaveDispatchHint(projectRoot);
    }
    await managedSession.commit();
    await fs.unlink(sentinelPath).catch(() => undefined);
  } catch (error) {
    // Leave the sentinel in place so the interrupted run is visible.
    throw error;
  } finally {
    setActiveManagedResourceSession(null);
  }
}

async function warnCodexHooksFeatureFlagIfDisabled(harnesses: readonly HarnessId[]): Promise<void> {
  if (!harnesses.includes("codex")) return;
  const codexTomlPath = codexConfigPath();
  let existing: string | null;
  try {
    existing = await readCodexConfig(codexTomlPath);
  } catch (error) {
    process.stderr.write(
      `cclaw: could not read ${codexTomlPath} to validate codex_hooks flag: ${
        error instanceof Error ? error.message : String(error)
      }\n`
    );
    return;
  }

  if (classifyCodexHooksFlag(existing) === "enabled") return;
  process.stderr.write(
    `cclaw: Codex hooks file written, but [features] codex_hooks is not true in ${codexTomlPath} — hooks are inert until you enable it.\n`
  );
}

export async function initCclaw(options: InitOptions): Promise<void> {
  if (options.harnesses !== undefined && options.harnesses.length === 0) {
    throw new Error("Select at least one harness.");
  }
  const config = createDefaultConfig(options.harnesses, options.track);
  // Wave 21: config is always minimal and harness-only.
  await writeConfig(options.projectRoot, config, { mode: "minimal" });
  // Init should scaffold runtime surfaces but leave flow-state creation to the
  // first managed start-flow invocation.
  await materializeRuntime(options.projectRoot, config, false, "init");
}

export async function syncCclaw(projectRoot: string, options: SyncOptions = {}): Promise<void> {
  if (options.harnesses !== undefined && options.harnesses.length === 0) {
    throw new Error("Select at least one harness.");
  }
  const configExists = await exists(configPath(projectRoot));
  let config = await readConfig(projectRoot);
  if (!configExists) {
    // Prefer detected harness markers over the hardcoded default list.
    // Without this, a user running `cclaw sync` in a `.claude`-only
    // project ends up with a config that also enables cursor/opencode/
    // codex, which then creates invalid harness expectations.
    // Fall back to the previous default (config.harnesses) if no markers
    // are found so brand-new projects still bootstrap cleanly.
    const detected = await detectHarnesses(projectRoot);
    const harnesses = options.harnesses ?? (detected.length > 0 ? detected : config.harnesses);
    const defaultConfig = createDefaultConfig(harnesses);
    await writeConfig(projectRoot, defaultConfig);
    config = defaultConfig;
  } else if (options.harnesses !== undefined) {
    config = {
      ...config,
      harnesses: options.harnesses
    };
    await writeConfig(projectRoot, config, {
      mode: "minimal",
      advancedKeysPresent: await detectAdvancedKeys(projectRoot)
    });
  }
  await materializeRuntime(projectRoot, config, false, "sync");
  await warnCodexHooksFeatureFlagIfDisabled(config.harnesses);
}

/**
 * Refresh generated files in `.cclaw/` without touching user-authored
 * artifacts or state. Config remains harness-only with managed version
 * stamps.
 */
export async function upgradeCclaw(projectRoot: string): Promise<void> {
  const configExists = await exists(configPath(projectRoot));
  const advancedKeysPresent = await detectAdvancedKeys(projectRoot);
  const detectedHarnesses = configExists ? [] : await detectHarnesses(projectRoot);
  const existing = configExists
    ? await readConfig(projectRoot)
    : createDefaultConfig(detectedHarnesses.length > 0 ? detectedHarnesses : undefined);
  const upgraded: CclawConfig = {
    ...existing,
    version: CCLAW_VERSION,
    flowVersion: FLOW_VERSION
  };
  await writeConfig(projectRoot, upgraded, {
    mode: "minimal",
    advancedKeysPresent
  });
  await materializeRuntime(projectRoot, upgraded, false, "upgrade");
}

function stripManagedHookCommands(value: unknown): { updated: unknown; changed: boolean } {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { updated: value, changed: false };
  }

  const root = { ...(value as Record<string, unknown>) };
  const hooks = root.hooks;
  if (!hooks || typeof hooks !== "object" || Array.isArray(hooks)) {
    return { updated: root, changed: false };
  }

  let changed = false;
  const cleanedHooks: Record<string, unknown> = {};
  for (const [eventName, entries] of Object.entries(hooks as Record<string, unknown>)) {
    if (!Array.isArray(entries)) {
      cleanedHooks[eventName] = entries;
      continue;
    }

    const cleanedEntries = entries.flatMap((entry) => {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
        return [entry];
      }

      const obj = entry as Record<string, unknown>;
      if (typeof obj.command === "string" && isManagedRuntimeHookCommand(obj.command)) {
        changed = true;
        return [];
      }

      if (Array.isArray(obj.hooks)) {
        const nested = obj.hooks.filter((nestedHook) => {
          if (!nestedHook || typeof nestedHook !== "object" || Array.isArray(nestedHook)) return true;
          const nestedObj = nestedHook as Record<string, unknown>;
          return !(typeof nestedObj.command === "string" && isManagedRuntimeHookCommand(nestedObj.command));
        });

        if (nested.length !== obj.hooks.length) {
          changed = true;
        }
        if (nested.length === 0) {
          changed = true;
          return [];
        }
        return [{ ...obj, hooks: nested }];
      }

      return [entry];
    });

    if (cleanedEntries.length > 0) {
      cleanedHooks[eventName] = cleanedEntries;
    } else if (entries.length > 0) {
      changed = true;
    }
  }

  if (!changed) {
    return { updated: root, changed: false };
  }

  root.hooks = cleanedHooks;
  return { updated: root, changed: true };
}

function isManagedRuntimeHookCommand(command: string): boolean {
  // Normalize whitespace and collapse any Windows-style backslash path
  // separators to forward slashes so user-edited hook configs on Windows
  // (e.g. `node .cclaw\hooks\run-hook.mjs ...`) still round-trip through
  // sync without being duplicated alongside freshly generated entries.
  const normalized = command.trim().replace(/\s+/gu, " ").replace(/\\/gu, "/");
  if (
    /(^|\s)(?:node\s+)?(?:"|')?(?:\.\/)?\.cclaw\/hooks\/run-hook\.(?:mjs|cmd)(?:"|')?\s+(?:session-start|stop-handoff|stop-checkpoint|pre-compact|prompt-guard|workflow-guard|pre-tool-pipeline|prompt-pipeline|context-monitor|verify-current-state)(?:\s|$)/u.test(
      normalized
    )
  ) {
    return true;
  }
  // Codex UserPromptSubmit non-blocking state nudge.
  return /internal verify-current-state(?:\s|$)/u.test(normalized);
}

async function removeManagedHookEntries(
  hookFilePath: string,
  options: { failOnParseError?: boolean } = {}
): Promise<void> {
  if (!(await exists(hookFilePath))) return;

  let parsed: unknown = null;
  try {
    const raw = await fs.readFile(hookFilePath, "utf8");
    const recovered = tryParseHookDocument(raw);
    if (recovered === null) {
      if (options.failOnParseError === true) {
        throw new Error(
          `[sync fail-fast] Cannot strip managed hook entries from ${hookFilePath} — JSON is unparseable. ` +
          `Run \`rm ${hookFilePath}\` and rerun \`npx cclaw-cli sync\`.`
        );
      }
      return;
    }
    parsed = recovered.parsed;
  } catch (error) {
    if (options.failOnParseError === true) {
      throw new Error(
        `[sync fail-fast] Cannot strip managed hook entries from ${hookFilePath} — ${
          error instanceof Error ? error.message : String(error)
        }. Run \`rm ${hookFilePath}\` and rerun \`npx cclaw-cli sync\`.`
      );
    }
    return;
  }

  const { updated, changed } = stripManagedHookCommands(parsed);
  if (!changed) return;

  const root = updated as Record<string, unknown>;
  const hooks = root.hooks;
  const hasHooks =
    typeof hooks === "object" &&
    hooks !== null &&
    !Array.isArray(hooks) &&
    Object.keys(hooks as Record<string, unknown>).length > 0;

  if (!hasHooks) {
    const onlyHooksShell = Object.keys(root).every(
      (key) => key === "hooks" || key === "version" || key === "cclawHookSchemaVersion"
    );
    if (onlyHooksShell) {
      await fs.rm(hookFilePath, { force: true });
      return;
    }
    root.hooks = {};
  }

  await writeFileSafe(hookFilePath, `${JSON.stringify(root, null, 2)}\n`);
}

async function removeIfEmpty(dirPath: string): Promise<void> {
  try {
    const entries = await fs.readdir(dirPath);
    if (entries.length === 0) {
      await fs.rmdir(dirPath);
    }
  } catch {
    // directory not present or not removable
  }
}

export async function uninstallCclaw(projectRoot: string): Promise<void> {
  const fullRuntimePath = path.join(projectRoot, RUNTIME_ROOT);
  try {
    await fs.rm(fullRuntimePath, { recursive: true, force: true });
  } catch {
    // path not present
  }

  await removeCclawFromAgentsMd(projectRoot);
  await removeGitignorePatterns(projectRoot);
  await cleanupLegacyManagedGitHookRelays(projectRoot);

  const hookFiles = [
    ".claude/hooks/hooks.json",
    ".cursor/hooks.json",
    ".codex/hooks.json"
  ];
  for (const hf of hookFiles) {
    await removeManagedHookEntries(path.join(projectRoot, hf));
  }

  const commandDirs = [
    ".claude/commands",
    ".cursor/commands",
    ".opencode/commands",
    ".codex/commands"
  ];

  for (const relDir of commandDirs) {
    const fullDir = path.join(projectRoot, relDir);
    try {
      const entries = await fs.readdir(fullDir);
      for (const entry of entries) {
        if (/^(?:viby|cc)(?:-.*)?\.md$/u.test(entry)) {
          await fs.rm(path.join(fullDir, entry), { force: true });
        }
      }
    } catch {
      // directory not present
    }
  }

  // Codex shim location history:
  // - < v0.39.0: `.codex/commands/cc*.md` (never consumed by Codex CLI)
  // - v0.39.0 / v0.39.1: `.agents/skills/cclaw-cc*/SKILL.md`
  // - ≥ v0.40.0: `.agents/skills/cc*/SKILL.md` (matches Codex's `/use cc`
  //   prompt verbatim)
  // Remove all three legacy layouts on uninstall so orphans can't linger.
  // We only touch cclaw-owned folder names — other tools share
  // `.agents/skills/` with us.
  const codexSkillsRoot = path.join(projectRoot, ".agents/skills");
  try {
    const entries = await fs.readdir(codexSkillsRoot);
    for (const entry of entries) {
      if (/^(?:cclaw-)?cc(?:-(?:next|view|finish|cancel|ops|idea|brainstorm|scope|design|spec|plan|tdd|review|ship))?$/u.test(entry)) {
        await fs.rm(path.join(codexSkillsRoot, entry), { recursive: true, force: true });
      }
    }
  } catch {
    // directory not present
  }
  await removeIfEmpty(codexSkillsRoot);
  await removeIfEmpty(path.join(projectRoot, ".agents"));


  const managedAgentNames = CCLAW_AGENTS.map((agent) => agent.name);
  for (const agentName of managedAgentNames) {
    await removeBestEffort(path.join(projectRoot, ".opencode/agents", `${agentName}.md`));
    await removeBestEffort(path.join(projectRoot, ".codex/agents", `${agentName}.toml`));
  }

  for (const pluginPath of [
    path.join(projectRoot, ".opencode/plugins/viby-plugin.mjs"),
    path.join(projectRoot, ".opencode/plugins/opencode-plugin.mjs"),
    path.join(projectRoot, OPENCODE_PLUGIN_REL_PATH)
  ]) {
    try {
      await fs.rm(pluginPath, { force: true });
    } catch {
      // best-effort cleanup
    }
  }

  await removeManagedOpenCodePluginConfig(projectRoot, OPENCODE_PLUGIN_REL_PATH);
  for (const target of [
    path.join(projectRoot, CURSOR_RULE_REL_PATH),
    path.join(projectRoot, CURSOR_GUIDELINES_REL_PATH)
  ]) {
    try {
      await fs.rm(target, { force: true });
    } catch {
      // best-effort cleanup
    }
  }

  const managedDirs = [
    ".claude/hooks",
    ".claude/commands",
    ".claude",
    ".cursor/rules",
    ".cursor/commands",
    ".cursor",
    ".codex/agents",
    ".codex/commands",
    ".codex",
    ".opencode/agents",
    ".opencode/plugins",
    ".opencode/commands",
    ".opencode"
  ];
  for (const relDir of managedDirs) {
    await removeIfEmpty(path.join(projectRoot, relDir));
  }
}
