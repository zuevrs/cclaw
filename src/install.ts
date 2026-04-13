import fs from "node:fs/promises";
import path from "node:path";
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
import { ARTIFACT_TEMPLATES, RULEBOOK_MARKDOWN, buildRulesJson } from "./content/templates.js";
import { stageSkillFolder, stageSkillMarkdown } from "./content/skills.js";
import { UTILITY_SKILL_FOLDERS, UTILITY_SKILL_MAP } from "./content/utility-skills.js";
import { createInitialFlowState } from "./flow-state.js";
import { ensureDir, exists, writeFileSafe } from "./fs-utils.js";
import { ensureGitignore, removeGitignorePatterns } from "./gitignore.js";
import { HARNESS_ADAPTERS, syncHarnessShims, removeCclawFromAgentsMd } from "./harness-adapters.js";
import { ensureRunSystem, readFlowState } from "./runs.js";
import type { HarnessId } from "./types.js";

export interface InitOptions {
  projectRoot: string;
  harnesses?: HarnessId[];
}

function runtimePath(projectRoot: string, ...segments: string[]): string {
  return path.join(projectRoot, RUNTIME_ROOT, ...segments);
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

function backupFileNameForHook(projectRoot: string, hookFilePath: string): string {
  const rel = path.relative(projectRoot, hookFilePath).replace(/[\\/]/gu, "__");
  const ts = new Date().toISOString().replace(/[:.]/gu, "-");
  return `${rel}.${ts}.bak`;
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
  const mergedDoc = mergeHookDocuments(existingDoc, generatedDoc);
  await writeFileSafe(hookFilePath, `${JSON.stringify(mergedDoc, null, 2)}\n`);
}

async function writeHooks(projectRoot: string, harnesses: HarnessId[]): Promise<void> {
  const hooksDir = runtimePath(projectRoot, "hooks");
  await ensureDir(hooksDir);

  await writeFileSafe(path.join(hooksDir, "session-start.sh"), sessionStartScript());
  await writeFileSafe(path.join(hooksDir, "stop-checkpoint.sh"), stopCheckpointScript());
  await writeFileSafe(path.join(hooksDir, "prompt-guard.sh"), promptGuardScript());
  await writeFileSafe(path.join(hooksDir, "context-monitor.sh"), contextMonitorScript());
  await writeFileSafe(path.join(hooksDir, "observe.sh"), observeScript());
  await writeFileSafe(path.join(hooksDir, "summarize-observations.sh"), summarizeObservationsScript());
  await writeFileSafe(path.join(hooksDir, "summarize-observations.mjs"), summarizeObservationsRuntimeModule());
  const opencodePluginSource = opencodePluginJs();
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
    const opencodePluginPath = path.join(opencodePluginsDir, "cclaw-plugin.mjs");
    await ensureDir(opencodePluginsDir);
    await writeFileSafe(opencodePluginPath, opencodePluginSource);
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
    // OpenCode: plugin.mjs is in .cclaw/hooks/ — user registers in opencode.json
  }
}

async function ensureLearningsStore(projectRoot: string): Promise<void> {
  const storePath = runtimePath(projectRoot, "learnings.jsonl");
  if (!(await exists(storePath))) {
    await writeFileSafe(storePath, "");
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
    path.join(projectRoot, ".opencode/plugins/cclaw-plugin.mjs")
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

async function materializeRuntime(projectRoot: string, harnesses: HarnessId[], forceStateReset: boolean): Promise<void> {
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
  await writeHooks(projectRoot, harnesses);
  await syncHarnessShims(projectRoot, harnesses);
  await ensureGitignore(projectRoot);
}

export async function initCclaw(options: InitOptions): Promise<void> {
  const config = createDefaultConfig(options.harnesses);
  await writeConfig(options.projectRoot, config);
  await materializeRuntime(options.projectRoot, config.harnesses, true);
}

export async function syncCclaw(projectRoot: string): Promise<void> {
  const config = await readConfig(projectRoot);
  if (!(await exists(configPath(projectRoot)))) {
    await writeConfig(projectRoot, createDefaultConfig(config.harnesses));
  }
  await materializeRuntime(projectRoot, config.harnesses, false);
}

export async function upgradeCclaw(projectRoot: string): Promise<void> {
  const config = await readConfig(projectRoot);
  const upgradedConfig = createDefaultConfig(config.harnesses);
  await writeConfig(projectRoot, upgradedConfig);
  await materializeRuntime(projectRoot, upgradedConfig.harnesses, false);
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
    const onlyHooksShell = Object.keys(root).every((key) => key === "hooks" || key === "version");
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
    path.join(projectRoot, ".opencode/plugins/cclaw-plugin.mjs")
  ]) {
    try {
      await fs.rm(pluginPath, { force: true });
    } catch {
      // best-effort cleanup
    }
  }
}
