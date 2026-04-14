import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import {
  COMMAND_FILE_ORDER,
  REQUIRED_DIRS,
  RUNTIME_ROOT,
  UTILITY_COMMANDS
} from "./constants.js";
import { writeConfig, createDefaultConfig, readConfig, configPath } from "./config.js";
import { commandContract } from "./content/contracts.js";
import { autoplanSkillMarkdown, autoplanCommandContract } from "./content/autoplan.js";
import { learnSkillMarkdown, learnCommandContract } from "./content/learnings.js";
import { nextCommandContract, nextCommandSkillMarkdown } from "./content/next-command.js";
import { subagentDrivenDevSkill, parallelAgentsSkill } from "./content/subagents.js";
import { sessionHooksSkillMarkdown } from "./content/session-hooks.js";
import {
  sessionStartScript,
  stopCheckpointScript,
  opencodePluginJs,
  claudeHooksJson,
  cursorHooksJson,
  codexHooksJson
} from "./content/hooks.js";
import {
  contextMonitorScript,
  observeScript,
  promptGuardScript,
  summarizeObservationsRuntimeModule,
  summarizeObservationsScript
} from "./content/observe.js";
import { META_SKILL_NAME, usingCclawSkillMarkdown } from "./content/meta-skill.js";
import {
  ARTIFACT_TEMPLATES,
  CURSOR_WORKFLOW_RULE_MDC,
  RULEBOOK_MARKDOWN,
  buildRulesJson
} from "./content/templates.js";
import { stageSkillFolder, stageSkillMarkdown } from "./content/skills.js";
import { UTILITY_SKILL_FOLDERS, UTILITY_SKILL_MAP } from "./content/utility-skills.js";
import { createInitialFlowState } from "./flow-state.js";
import { ensureDir, exists, writeFileSafe } from "./fs-utils.js";
import { ensureGitignore, removeGitignorePatterns } from "./gitignore.js";
import { HARNESS_ADAPTERS, syncHarnessShims, removeCclawFromAgentsMd } from "./harness-adapters.js";
import { validateHookDocument } from "./hook-schema.js";
import { ensureRunSystem, readFlowState } from "./runs.js";
import type { HarnessId, VibyConfig } from "./types.js";

export interface InitOptions {
  projectRoot: string;
  harnesses?: HarnessId[];
}

const OPENCODE_PLUGIN_REL_PATH = ".opencode/plugins/cclaw-plugin.mjs";
const CURSOR_RULE_REL_PATH = ".cursor/rules/cclaw-workflow.mdc";
const GIT_HOOK_MANAGED_MARKER = "cclaw-managed-git-hook";
const GIT_HOOK_RUNTIME_REL_DIR = `${RUNTIME_ROOT}/hooks/git`;
const execFileAsync = promisify(execFile);

function runtimePath(projectRoot: string, ...segments: string[]): string {
  return path.join(projectRoot, RUNTIME_ROOT, ...segments);
}

function resolveGlobalLearningsPath(projectRoot: string, config: VibyConfig): string | null {
  if (config.globalLearnings !== true) {
    return null;
  }
  const raw = config.globalLearningsPath?.trim() ?? "";
  if (raw.length === 0) {
    return path.join(os.homedir(), ".cclaw-global-learnings.jsonl");
  }
  if (raw.startsWith("~/")) {
    return path.join(os.homedir(), raw.slice(2));
  }
  if (path.isAbsolute(raw)) {
    return raw;
  }
  return path.join(projectRoot, raw);
}

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

function managedGitRuntimeScript(hookName: "pre-commit" | "pre-push"): string {
  const rangeExpression = hookName === "pre-commit"
    ? 'git diff --cached --name-only'
    : 'git diff --name-only @{upstream}...HEAD || git diff --name-only HEAD~1...HEAD';
  return `#!/usr/bin/env bash
# ${GIT_HOOK_MANAGED_MARKER}: runtime ${hookName}
set -euo pipefail

ROOT=$(git rev-parse --show-toplevel 2>/dev/null || pwd)
GUARD_SCRIPT="$ROOT/${RUNTIME_ROOT}/hooks/prompt-guard.sh"
[ -x "$GUARD_SCRIPT" ] || exit 0

FILES=$(${rangeExpression} 2>/dev/null || true)
[ -n "$FILES" ] || exit 0

printf '%s\n' "$FILES" | bash "$GUARD_SCRIPT"
`;
}

function managedGitRelayHook(hookName: "pre-commit" | "pre-push"): string {
  return `#!/usr/bin/env bash
# ${GIT_HOOK_MANAGED_MARKER}: relay ${hookName}
set -euo pipefail

ROOT=$(git rev-parse --show-toplevel 2>/dev/null || pwd)
RUNTIME_HOOK="$ROOT/${GIT_HOOK_RUNTIME_REL_DIR}/${hookName}.sh"
[ -x "$RUNTIME_HOOK" ] || exit 0
exec bash "$RUNTIME_HOOK" "$@"
`;
}

async function removeManagedGitHookRelays(projectRoot: string): Promise<void> {
  const hooksDir = await resolveGitHooksDir(projectRoot);
  if (!hooksDir) {
    return;
  }
  for (const hookName of ["pre-commit", "pre-push"] as const) {
    const hookPath = path.join(hooksDir, hookName);
    if (!(await exists(hookPath))) continue;
    let content = "";
    try {
      content = await fs.readFile(hookPath, "utf8");
    } catch {
      content = "";
    }
    if (!content.includes(GIT_HOOK_MANAGED_MARKER)) {
      continue;
    }
    await fs.rm(hookPath, { force: true });
  }
}

async function syncManagedGitHooks(projectRoot: string, config: VibyConfig): Promise<void> {
  const hooksDir = await resolveGitHooksDir(projectRoot);
  if (!hooksDir) {
    return;
  }

  if (config.gitHookGuards !== true) {
    await removeManagedGitHookRelays(projectRoot);
    try {
      await fs.rm(path.join(projectRoot, GIT_HOOK_RUNTIME_REL_DIR), { recursive: true, force: true });
    } catch {
      // best-effort cleanup
    }
    return;
  }

  const runtimeGitHooksDir = path.join(projectRoot, GIT_HOOK_RUNTIME_REL_DIR);
  await ensureDir(runtimeGitHooksDir);
  for (const hookName of ["pre-commit", "pre-push"] as const) {
    const runtimePathForHook = path.join(runtimeGitHooksDir, `${hookName}.sh`);
    await writeFileSafe(runtimePathForHook, managedGitRuntimeScript(hookName));
    try {
      await fs.chmod(runtimePathForHook, 0o755);
    } catch {
      // best effort on constrained filesystems
    }
  }

  await ensureDir(hooksDir);
  for (const hookName of ["pre-commit", "pre-push"] as const) {
    const hookPath = path.join(hooksDir, hookName);
    let canWriteRelay = true;
    if (await exists(hookPath)) {
      try {
        const existing = await fs.readFile(hookPath, "utf8");
        canWriteRelay = existing.includes(GIT_HOOK_MANAGED_MARKER);
      } catch {
        canWriteRelay = false;
      }
    }
    if (!canWriteRelay) {
      continue;
    }
    await writeFileSafe(hookPath, managedGitRelayHook(hookName));
    try {
      await fs.chmod(hookPath, 0o755);
    } catch {
      // best effort on constrained filesystems
    }
  }
}

async function ensureStructure(projectRoot: string): Promise<void> {
  for (const dir of REQUIRED_DIRS) {
    await ensureDir(path.join(projectRoot, dir));
  }
}

async function writeCommandContracts(projectRoot: string): Promise<void> {
  for (const stage of COMMAND_FILE_ORDER) {
    await writeFileSafe(
      runtimePath(projectRoot, "commands", `${stage}.md`),
      commandContract(stage)
    );
  }
}

async function writeArtifactTemplates(projectRoot: string): Promise<void> {
  for (const [fileName, content] of Object.entries(ARTIFACT_TEMPLATES)) {
    await writeFileSafe(runtimePath(projectRoot, "templates", fileName), content);
    const artifactPath = runtimePath(projectRoot, "artifacts", fileName);
    if (!(await exists(artifactPath))) {
      await writeFileSafe(artifactPath, content);
    }
  }
}

async function writeSkills(projectRoot: string): Promise<void> {
  for (const stage of COMMAND_FILE_ORDER) {
    const folder = stageSkillFolder(stage);
    await writeFileSafe(
      runtimePath(projectRoot, "skills", folder, "SKILL.md"),
      stageSkillMarkdown(stage)
    );
  }

  // Utility skills (not flow stages)
  await writeFileSafe(
    runtimePath(projectRoot, "skills", "learnings", "SKILL.md"),
    learnSkillMarkdown()
  );
  await writeFileSafe(
    runtimePath(projectRoot, "skills", "autoplan", "SKILL.md"),
    autoplanSkillMarkdown()
  );
  await writeFileSafe(
    runtimePath(projectRoot, "skills", "flow-next-step", "SKILL.md"),
    nextCommandSkillMarkdown()
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
    runtimePath(projectRoot, "skills", META_SKILL_NAME, "SKILL.md"),
    usingCclawSkillMarkdown()
  );

  for (const folder of UTILITY_SKILL_FOLDERS) {
    const generator = UTILITY_SKILL_MAP[folder];
    await writeFileSafe(runtimePath(projectRoot, "skills", folder, "SKILL.md"), generator());
  }
}

async function writeUtilityCommands(projectRoot: string): Promise<void> {
  await writeFileSafe(runtimePath(projectRoot, "commands", "learn.md"), learnCommandContract());
  await writeFileSafe(runtimePath(projectRoot, "commands", "autoplan.md"), autoplanCommandContract());
  await writeFileSafe(runtimePath(projectRoot, "commands", "next.md"), nextCommandContract());

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
  const pluginsRaw = Array.isArray(root.plugins) ? [...root.plugins] : [];
  const normalized = new Set(pluginsRaw.map((entry) => normalizeOpenCodePluginEntry(entry)).filter(Boolean));
  if (!normalized.has(pluginRelPath)) {
    pluginsRaw.push(pluginRelPath);
  }
  const changed = !normalized.has(pluginRelPath) || !Array.isArray(root.plugins);
  return {
    merged: {
      ...root,
      plugins: pluginsRaw
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
    if (!root || !Array.isArray(root.plugins)) continue;
    const filtered = root.plugins.filter((entry) => normalizeOpenCodePluginEntry(entry) !== pluginRelPath);
    if (filtered.length === root.plugins.length) {
      continue;
    }
    root.plugins = filtered;
    await writeFileSafe(configPath, `${JSON.stringify(root, null, 2)}\n`);
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
      mergedHooks[eventName] = [...generatedEntries, ...preservedEntries];
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
        `Generated ${harness} hook document failed schema validation: ${generatedSchema.errors.join("; ")}`
      );
    }
  }

  const mergedDoc = mergeHookDocuments(existingDoc, generatedDoc);
  if (harness) {
    const mergedSchema = validateHookDocument(harness, mergedDoc);
    if (!mergedSchema.ok) {
      throw new Error(
        `Merged ${harness} hook document failed schema validation: ${mergedSchema.errors.join("; ")}`
      );
    }
  }
  await writeFileSafe(hookFilePath, `${JSON.stringify(mergedDoc, null, 2)}\n`);
}

async function writeHooks(projectRoot: string, config: VibyConfig): Promise<void> {
  const harnesses = config.harnesses;
  const hooksDir = runtimePath(projectRoot, "hooks");
  await ensureDir(hooksDir);

  await writeFileSafe(path.join(hooksDir, "session-start.sh"), sessionStartScript({
    globalLearningsEnabled: config.globalLearnings === true,
    globalLearningsPath: config.globalLearningsPath
  }));
  await writeFileSafe(path.join(hooksDir, "stop-checkpoint.sh"), stopCheckpointScript());
  await writeFileSafe(path.join(hooksDir, "prompt-guard.sh"), promptGuardScript({
    strictMode: config.promptGuardMode === "strict"
  }));
  await writeFileSafe(path.join(hooksDir, "context-monitor.sh"), contextMonitorScript());
  await writeFileSafe(path.join(hooksDir, "observe.sh"), observeScript());
  await writeFileSafe(path.join(hooksDir, "summarize-observations.sh"), summarizeObservationsScript());
  await writeFileSafe(path.join(hooksDir, "summarize-observations.mjs"), summarizeObservationsRuntimeModule());
  const opencodePluginSource = opencodePluginJs({
    globalLearningsEnabled: config.globalLearnings === true,
    globalLearningsPath: config.globalLearningsPath
  });
  await writeFileSafe(path.join(hooksDir, "opencode-plugin.mjs"), opencodePluginSource);

  try {
    for (const script of [
      "session-start.sh",
      "stop-checkpoint.sh",
      "prompt-guard.sh",
      "context-monitor.sh",
      "observe.sh",
      "summarize-observations.sh",
      "summarize-observations.mjs",
      "opencode-plugin.mjs"
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
      const dir = path.join(projectRoot, ".codex");
      await ensureDir(dir);
      await writeMergedHookJson(projectRoot, path.join(dir, "hooks.json"), codexHooksJson());
    }
    // OpenCode registration is auto-managed via opencode.json/opencode.jsonc.
  }
}

async function ensureLearningsStore(projectRoot: string): Promise<void> {
  const storePath = runtimePath(projectRoot, "learnings.jsonl");
  if (!(await exists(storePath))) {
    await writeFileSafe(storePath, "");
  }
}

async function ensureGlobalLearningsStore(projectRoot: string, config: VibyConfig): Promise<void> {
  const globalPath = resolveGlobalLearningsPath(projectRoot, config);
  if (!globalPath) {
    return;
  }
  await ensureDir(path.dirname(globalPath));
  if (!(await exists(globalPath))) {
    await writeFileSafe(globalPath, "");
  }
}

async function ensureSessionStateFiles(projectRoot: string): Promise<void> {
  const stateDir = runtimePath(projectRoot, "state");
  await ensureDir(stateDir);

  const activityPath = path.join(stateDir, "stage-activity.jsonl");
  if (!(await exists(activityPath))) {
    await writeFileSafe(activityPath, "");
  }

  const checkpointPath = path.join(stateDir, "checkpoint.json");
  if (!(await exists(checkpointPath))) {
    const flow = await readFlowState(projectRoot);
    const initialCheckpoint = {
      stage: flow.currentStage,
      runId: flow.activeRunId,
      status: "not_started",
      lastCompletedStep: "",
      remainingSteps: [] as string[],
      blockers: [] as string[],
      timestamp: new Date().toISOString()
    };
    await writeFileSafe(checkpointPath, `${JSON.stringify(initialCheckpoint, null, 2)}\n`);
  }

  const suggestionMemoryPath = path.join(stateDir, "suggestion-memory.json");
  if (!(await exists(suggestionMemoryPath))) {
    const suggestionMemory = {
      enabled: true,
      mutedStages: [] as string[],
      lastSuggestedStage: "",
      lastSuggestedAt: ""
    };
    await writeFileSafe(suggestionMemoryPath, `${JSON.stringify(suggestionMemory, null, 2)}\n`);
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
  if (!harnesses.includes("cursor")) {
    try {
      await fs.rm(rulePath, { force: true });
    } catch {
      // best-effort cleanup
    }
    return;
  }
  await ensureDir(path.dirname(rulePath));
  await writeFileSafe(rulePath, CURSOR_WORKFLOW_RULE_MDC);
}

async function writeState(projectRoot: string, forceReset = false): Promise<void> {
  const statePath = runtimePath(projectRoot, "state", "flow-state.json");
  if (!forceReset && (await exists(statePath))) {
    return;
  }

  const state = createInitialFlowState();
  await writeFileSafe(statePath, `${JSON.stringify(state, null, 2)}\n`);
}

async function writeAdapterManifest(projectRoot: string, harnesses: HarnessId[]): Promise<void> {
  const manifest = {
    generatedAt: new Date().toISOString(),
    harnesses,
    commandSource: `${RUNTIME_ROOT}/commands/*.md`,
    skillSource: `${RUNTIME_ROOT}/skills/*/SKILL.md`
  };

  await writeFileSafe(
    runtimePath(projectRoot, "adapters", "manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`
  );
}

async function cleanLegacyArtifacts(projectRoot: string): Promise<void> {
  // Remove deprecated utility skill folders from older releases.
  for (const legacyFolder of [
    "project-learnings",
    "auto-orchestration",
    "subagent-driven-development",
    "dispatching-parallel-agents",
    "session-guidelines",
    "security-review",
    "documentation",
    "browser-qa-testing"
  ]) {
    try {
      await fs.rm(runtimePath(projectRoot, "skills", legacyFolder), {
        recursive: true,
        force: true
      });
    } catch {
      // best-effort cleanup
    }
  }

  // Remove legacy duplicate security agent file when present.
  try {
    await fs.rm(runtimePath(projectRoot, "agents", "securityer.md"), { force: true });
  } catch {
    // best-effort cleanup
  }

  for (const legacyPlugin of [
    path.join(projectRoot, ".opencode/plugins/viby-plugin.mjs"),
    path.join(projectRoot, ".opencode/plugins/opencode-plugin.mjs"),
    path.join(projectRoot, OPENCODE_PLUGIN_REL_PATH)
  ]) {
    try {
      await fs.rm(legacyPlugin, { force: true });
    } catch {
      // best-effort cleanup
    }
  }
}

async function cleanStaleFiles(projectRoot: string): Promise<void> {
  const expectedShimFiles = new Set<string>([
    ...COMMAND_FILE_ORDER.map((stage) => `viby-${stage}.md`),
    ...UTILITY_COMMANDS.map((cmd) => `viby-${cmd}.md`),
    ...COMMAND_FILE_ORDER.map((stage) => `cc-${stage}.md`),
    ...UTILITY_COMMANDS.map((cmd) => `cc-${cmd}.md`)
  ]);

  for (const adapter of Object.values(HARNESS_ADAPTERS)) {
    const commandDir = path.join(projectRoot, adapter.commandDir);
    if (!(await exists(commandDir))) continue;

    let entries: string[] = [];
    try {
      entries = await fs.readdir(commandDir);
    } catch {
      entries = [];
    }

    for (const entry of entries) {
      if (!/^cc-.*\.md$/u.test(entry)) continue;
      if (expectedShimFiles.has(entry)) continue;
      await fs.rm(path.join(commandDir, entry), { force: true });
    }
  }
  // Keep user-owned custom assets under .cclaw/agents and .cclaw/skills.
  // Legacy managed removals happen in cleanLegacyArtifacts() with explicit paths.
}

async function materializeRuntime(projectRoot: string, config: VibyConfig, forceStateReset: boolean): Promise<void> {
  const harnesses = config.harnesses;
  await ensureStructure(projectRoot);
  await cleanLegacyArtifacts(projectRoot);
  await cleanStaleFiles(projectRoot);
  await writeCommandContracts(projectRoot);
  await writeUtilityCommands(projectRoot);
  await writeSkills(projectRoot);
  await writeArtifactTemplates(projectRoot);
  await writeRulebook(projectRoot);
  await writeState(projectRoot, forceStateReset);
  await ensureRunSystem(projectRoot);
  await ensureSessionStateFiles(projectRoot);
  await writeAdapterManifest(projectRoot, harnesses);
  await ensureLearningsStore(projectRoot);
  await ensureGlobalLearningsStore(projectRoot, config);
  await writeHooks(projectRoot, config);
  await syncManagedGitHooks(projectRoot, config);
  await syncHarnessShims(projectRoot, harnesses);
  await writeCursorWorkflowRule(projectRoot, harnesses);
  await ensureGitignore(projectRoot);
}

export async function initCclaw(options: InitOptions): Promise<void> {
  const config = createDefaultConfig(options.harnesses);
  await writeConfig(options.projectRoot, config);
  await materializeRuntime(options.projectRoot, config, true);
}

export async function syncCclaw(projectRoot: string): Promise<void> {
  const config = await readConfig(projectRoot);
  if (!(await exists(configPath(projectRoot)))) {
    await writeConfig(projectRoot, createDefaultConfig(config.harnesses));
  }
  await materializeRuntime(projectRoot, config, false);
}

export async function upgradeCclaw(projectRoot: string): Promise<void> {
  const config = await readConfig(projectRoot);
  const upgradedConfig = createDefaultConfig(config.harnesses);
  await writeConfig(projectRoot, upgradedConfig);
  await materializeRuntime(projectRoot, upgradedConfig, false);
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
  const normalized = command.trim().replace(/\s+/gu, " ");
  return /(^|\s)(?:bash\s+)?(?:\.\/)?\.cclaw\/hooks\/(?:session-start|stop-checkpoint|prompt-guard|context-monitor|observe|summarize-observations)\.sh(?:\s|$)/u.test(
    normalized
  );
}

async function removeManagedHookEntries(hookFilePath: string): Promise<void> {
  if (!(await exists(hookFilePath))) return;

  let parsed: unknown = null;
  try {
    const raw = await fs.readFile(hookFilePath, "utf8");
    const recovered = tryParseHookDocument(raw);
    parsed = recovered?.parsed ?? null;
  } catch {
    return;
  }
  if (parsed === null) return;

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

export async function uninstallCclaw(projectRoot: string): Promise<void> {
  const fullRuntimePath = path.join(projectRoot, RUNTIME_ROOT);
  try {
    await fs.rm(fullRuntimePath, { recursive: true, force: true });
  } catch {
    // path not present
  }

  await removeCclawFromAgentsMd(projectRoot);
  await removeGitignorePatterns(projectRoot);
  await removeManagedGitHookRelays(projectRoot);

  // Clean hook files
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
        if (/^(?:viby|cc)-.*\.md$/u.test(entry)) {
          await fs.rm(path.join(fullDir, entry), { force: true });
        }
      }
    } catch {
      // directory not present
    }
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
  try {
    await fs.rm(path.join(projectRoot, CURSOR_RULE_REL_PATH), { force: true });
  } catch {
    // best-effort cleanup
  }
}
