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
  detectLanguageRulePacks,
  detectAdvancedKeys
} from "./config.js";
import { learnSkillMarkdown } from "./content/learnings.js";
import { nextCommandContract, nextCommandSkillMarkdown } from "./content/next-command.js";
import { ideateCommandContract, ideateCommandSkillMarkdown } from "./content/ideate-command.js";
import { startCommandContract, startCommandSkillMarkdown } from "./content/start-command.js";
import { viewCommandContract, viewCommandSkillMarkdown } from "./content/view-command.js";
import { subagentDrivenDevSkill, parallelAgentsSkill } from "./content/subagents.js";
import { sessionHooksSkillMarkdown } from "./content/session-hooks.js";
import { ironLawRuntimeDocument, ironLawsSkillMarkdown } from "./content/iron-laws.js";
import {
  stageCompleteScript,
  startFlowScript,
  runHookCmdScript,
  opencodePluginJs,
  claudeHooksJson,
  codexHooksJson,
  cursorHooksJson
} from "./content/hooks.js";
import { nodeHookRuntimeScript } from "./content/node-hooks.js";
import { META_SKILL_NAME, usingCclawSkillMarkdown } from "./content/meta-skill.js";
import {
  ARTIFACT_TEMPLATES,
  CURSOR_WORKFLOW_RULE_MDC,
  RULEBOOK_MARKDOWN,
  buildRulesJson
} from "./content/templates.js";
import { STATE_CONTRACTS } from "./content/state-contracts.js";
import { REVIEW_PROMPTS } from "./content/review-prompts.js";
import {
  stageSkillFolder,
  stageSkillMarkdown
} from "./content/skills.js";
import {
  LANGUAGE_RULE_PACK_DIR,
  LANGUAGE_RULE_PACK_FILES,
  LANGUAGE_RULE_PACK_GENERATORS,
  LEGACY_LANGUAGE_RULE_PACK_FOLDERS
} from "./content/utility-skills.js";
import { RESEARCH_PLAYBOOKS } from "./content/research-playbooks.js";
import { SUBAGENT_CONTEXT_SKILLS } from "./content/subagent-context-skills.js";
import { createInitialFlowState, type FlowState } from "./flow-state.js";
import { ensureDir, exists, writeFileSafe } from "./fs-utils.js";
import { ensureGitignore, removeGitignorePatterns } from "./gitignore.js";
import {
  HARNESS_ADAPTERS,
  harnessShimFileNames,
  harnessTier,
  syncHarnessShims,
  removeCclawFromAgentsMd
} from "./harness-adapters.js";
import { validateHookDocument } from "./hook-schema.js";
import { detectHarnesses } from "./init-detect.js";
import { CorruptFlowStateError, ensureRunSystem, readFlowState } from "./runs.js";
import { FLOW_STAGES } from "./types.js";
import type { CclawConfig, FlowTrack, HarnessId } from "./types.js";

export interface InitOptions {
  projectRoot: string;
  harnesses?: HarnessId[];
  track?: FlowTrack;
}

const OPENCODE_PLUGIN_REL_PATH = ".opencode/plugins/cclaw-plugin.mjs";
const CURSOR_RULE_REL_PATH = ".cursor/rules/cclaw-workflow.mdc";
const GIT_HOOK_MANAGED_MARKER = "cclaw-managed-git-hook";
const GIT_HOOK_RUNTIME_REL_DIR = `${RUNTIME_ROOT}/hooks/git`;
const execFileAsync = promisify(execFile);

function runtimePath(projectRoot: string, ...segments: string[]): string {
  return path.join(projectRoot, RUNTIME_ROOT, ...segments);
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
  ["flow-ops", "SKILL.md"],
  ["tdd-cycle-log", "SKILL.md"],
  ["flow-retro", "SKILL.md"],
  ["flow-compound", "SKILL.md"],
  ["flow-archive", "SKILL.md"],
  ["flow-rewind", "SKILL.md"],
  ["using-git-worktrees", "SKILL.md"]
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
  "context-warnings.jsonl"
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

function managedGitRuntimeScript(hookName: "pre-commit" | "pre-push"): string {
  return `#!/usr/bin/env node
// ${GIT_HOOK_MANAGED_MARKER}: runtime ${hookName}
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";

const HOOK_NAME = ${JSON.stringify(hookName)};
const RUNTIME_ROOT = ${JSON.stringify(RUNTIME_ROOT)};

function runGit(args, cwd) {
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"]
  });
  return {
    status: typeof result.status === "number" ? result.status : 1,
    stdout: typeof result.stdout === "string" ? result.stdout : ""
  };
}

function resolveRepoRoot() {
  const result = runGit(["rev-parse", "--show-toplevel"], process.cwd());
  if (result.status === 0) {
    const root = result.stdout.trim();
    if (root.length > 0) return root;
  }
  return process.cwd();
}

function resolveChangedFiles(root) {
  if (HOOK_NAME === "pre-commit") {
    const result = runGit(["diff", "--cached", "--name-only"], root);
    return result.status === 0 ? result.stdout : "";
  }
  const upstreamResult = runGit(["diff", "--name-only", "@{upstream}...HEAD"], root);
  if (upstreamResult.status === 0) {
    return upstreamResult.stdout;
  }
  const fallback = runGit(["diff", "--name-only", "HEAD~1...HEAD"], root);
  return fallback.status === 0 ? fallback.stdout : "";
}

const root = resolveRepoRoot();
const runtimeHook = path.join(root, RUNTIME_ROOT, "hooks", "run-hook.mjs");
if (!fs.existsSync(runtimeHook)) {
  // cclaw git relay is installed but the runtime entrypoint is missing —
  // warn visibly (without blocking the commit) so the drift is noticed.
  process.stderr.write(
    "[cclaw] " + HOOK_NAME + ": " + runtimeHook + " not found; run \`cclaw sync\` to reinstall\\n"
  );
  process.exit(0);
}

const changedFiles = resolveChangedFiles(root)
  .split(/\\r?\\n/gu)
  .map((line) => line.trim())
  .filter((line) => line.length > 0);
if (changedFiles.length === 0) {
  process.exit(0);
}

const payload = JSON.stringify({
  tool_name: "Write",
  tool_input: {
    path: changedFiles.join("\\n"),
    paths: changedFiles
  }
});

  const result = spawnSync(process.execPath, [runtimeHook, "prompt-guard"], {
  cwd: root,
  env: process.env,
  input: payload,
  encoding: "utf8",
  stdio: ["pipe", "ignore", "inherit"]
});
process.exit(typeof result.status === "number" ? result.status : 1);
`;
}

function managedGitRelayHook(hookName: "pre-commit" | "pre-push"): string {
  return `#!/usr/bin/env node
// ${GIT_HOOK_MANAGED_MARKER}: relay ${hookName}
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { spawn, spawnSync } from "node:child_process";

const RUNTIME_REL_DIR = ${JSON.stringify(GIT_HOOK_RUNTIME_REL_DIR)};
const HOOK_NAME = ${JSON.stringify(hookName)};

function resolveRepoRoot() {
  const result = spawnSync("git", ["rev-parse", "--show-toplevel"], {
    cwd: process.cwd(),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"]
  });
  if (typeof result.status === "number" && result.status === 0) {
    const root = (result.stdout || "").trim();
    if (root.length > 0) return root;
  }
  return process.cwd();
}

const root = resolveRepoRoot();
const runtimeHook = path.join(root, RUNTIME_REL_DIR, HOOK_NAME + ".mjs");
if (!fs.existsSync(runtimeHook)) {
  process.exit(0);
}

const child = spawn(process.execPath, [runtimeHook, ...process.argv.slice(2)], {
  cwd: root,
  env: process.env,
  stdio: "inherit"
});
child.on("error", () => process.exit(1));
child.on("close", (code, signal) => {
  process.exit(signal ? 1 : typeof code === "number" ? code : 1);
});
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

async function syncManagedGitHooks(projectRoot: string, config: CclawConfig): Promise<void> {
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
    const runtimePathForHook = path.join(runtimeGitHooksDir, `${hookName}.mjs`);
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

async function writeArtifactTemplates(projectRoot: string): Promise<void> {
  await Promise.all(Object.entries(ARTIFACT_TEMPLATES).map(async ([fileName, content]) => {
    await writeFileSafe(runtimePath(projectRoot, "templates", fileName), content);
  }));
  await Promise.all(Object.entries(STATE_CONTRACTS).map(async ([fileName, content]) => {
    await writeFileSafe(runtimePath(projectRoot, "templates", "state-contracts", fileName), content);
  }));
}

async function writeSkills(projectRoot: string, config?: CclawConfig): Promise<void> {
  const skillTrack = config?.defaultTrack ?? "standard";
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
    runtimePath(projectRoot, "skills", "flow-next-step", "SKILL.md"),
    nextCommandSkillMarkdown()
  );
  await writeFileSafe(
    runtimePath(projectRoot, "skills", "flow-ideate", "SKILL.md"),
    ideateCommandSkillMarkdown()
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

  // Language rule packs live under .cclaw/rules/lang/<pack>.md. They are opt-in:
  // only the packs listed in config.languageRulePacks are materialised. Any
  // legacy per-language skill folders from v0.7.0 (.cclaw/skills/language-*)
  // are cleaned up below so the new rules/lang layout is the only truth.
  const enabledPacks = config?.languageRulePacks ?? [];
  const enabledPackFileNames = new Set<string>();
  for (const pack of enabledPacks) {
    const fileName = LANGUAGE_RULE_PACK_FILES[pack];
    const generator = LANGUAGE_RULE_PACK_GENERATORS[pack];
    if (!fileName || !generator) continue;
    enabledPackFileNames.add(fileName);
    await writeFileSafe(
      runtimePath(projectRoot, ...LANGUAGE_RULE_PACK_DIR, fileName),
      generator()
    );
  }

  // Strict idempotence: once a pack is removed from config, its generated
  // file under .cclaw/rules/lang/ must disappear on the next sync. Without
  // this loop the directory accumulates a superset of every pack ever
  // enabled, which silently keeps stale guidance alive.
  const langDir = runtimePath(projectRoot, ...LANGUAGE_RULE_PACK_DIR);
  if (await exists(langDir)) {
    const knownPackFileNames = new Set<string>(Object.values(LANGUAGE_RULE_PACK_FILES));
    let entries: string[] = [];
    try {
      entries = await fs.readdir(langDir);
    } catch {
      entries = [];
    }
    for (const entry of entries) {
      if (!knownPackFileNames.has(entry)) continue;
      if (enabledPackFileNames.has(entry)) continue;
      await fs.rm(path.join(langDir, entry), { force: true });
    }
  }

  for (const legacyFolder of LEGACY_LANGUAGE_RULE_PACK_FOLDERS) {
    const legacyPath = runtimePath(projectRoot, "skills", legacyFolder);
    if (await exists(legacyPath)) {
      await fs.rm(legacyPath, { recursive: true, force: true });
    }
  }

}

async function writeEntryCommands(projectRoot: string): Promise<void> {
  await writeFileSafe(runtimePath(projectRoot, "commands", "start.md"), startCommandContract());
  await writeFileSafe(runtimePath(projectRoot, "commands", "next.md"), nextCommandContract());
  await writeFileSafe(runtimePath(projectRoot, "commands", "ideate.md"), ideateCommandContract());
  await writeFileSafe(runtimePath(projectRoot, "commands", "view.md"), viewCommandContract());
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
  const changed = !normalized.has(pluginRelPath) || !Array.isArray(root.plugin);
  return {
    merged: {
      ...root,
      plugin: pluginsRaw
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

async function writeHooks(projectRoot: string, config: CclawConfig): Promise<void> {
  const harnesses = config.harnesses;
  const hooksDir = runtimePath(projectRoot, "hooks");
  const stateDir = runtimePath(projectRoot, "state");
  await ensureDir(hooksDir);
  await ensureDir(stateDir);

  const effectiveStrictness: "advisory" | "strict" = config.strictness ?? "advisory";
  await writeFileSafe(
    runtimePath(projectRoot, "state", "iron-laws.json"),
    `${JSON.stringify(
      ironLawRuntimeDocument({
        mode: effectiveStrictness,
        strictLaws: config.ironLaws?.strictLaws
      }),
      null,
      2
    )}\n`
  );

  await writeFileSafe(path.join(hooksDir, "stage-complete.mjs"), stageCompleteScript());
  await writeFileSafe(path.join(hooksDir, "start-flow.mjs"), startFlowScript());
  await writeFileSafe(path.join(hooksDir, "run-hook.mjs"), nodeHookRuntimeScript({
    strictness: effectiveStrictness,
    tddTestPathPatterns: config.tdd?.testPathPatterns ?? config.tddTestGlobs,
    tddProductionPathPatterns: config.tdd?.productionPathPatterns,
    compoundRecurrenceThreshold: config.compound?.recurrenceThreshold
  }));
  await writeFileSafe(path.join(hooksDir, "run-hook.cmd"), runHookCmdScript());
  const opencodePluginSource = opencodePluginJs();
  await writeFileSafe(path.join(hooksDir, "opencode-plugin.mjs"), opencodePluginSource);

  try {
    for (const script of [
      "stage-complete.mjs",
      "start-flow.mjs",
      "run-hook.mjs",
      "run-hook.cmd",
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
      // Codex CLI ≥ v0.114 (Mar 2026) supports lifecycle hooks at
      // `.codex/hooks.json`, gated behind the `[features] codex_hooks = true`
      // flag in `~/.codex/config.toml`. cclaw always writes the file so
      // the moment the flag flips on, the cclaw hooks start firing. See
      // `codexHooksJsonWithObservation` for the Bash-only caveat on
      // PreToolUse/PostToolUse. `cclaw doctor` warns if the feature flag
      // is not set.
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
    await removeManagedHookEntries(entry.hookPath);
  }

  if (!enabled.has("opencode")) {
    try {
      await fs.rm(path.join(projectRoot, OPENCODE_PLUGIN_REL_PATH), { force: true });
    } catch {
      // best-effort cleanup
    }
    await removeManagedOpenCodePluginConfig(projectRoot, OPENCODE_PLUGIN_REL_PATH);
  }
}

async function writeState(projectRoot: string, config: CclawConfig, forceReset = false): Promise<void> {
  const statePath = runtimePath(projectRoot, "state", "flow-state.json");
  if (!forceReset && (await exists(statePath))) {
    return;
  }

  const state = createInitialFlowState({ track: config.defaultTrack ?? "standard" });
  await writeFileSafe(statePath, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
}

async function cleanLegacyArtifacts(projectRoot: string): Promise<void> {
  for (const legacyFolder of DEPRECATED_UTILITY_SKILL_FOLDERS) {
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
    ...FLOW_STAGES.map((stage) => runtimePath(projectRoot, "commands", `${stage}.md`)),
    ...DEPRECATED_COMMAND_FILES.map((file) => runtimePath(projectRoot, "commands", file)),
    ...DEPRECATED_SKILL_FILES.map((segments) => runtimePath(projectRoot, "skills", ...segments)),
    ...DEPRECATED_STATE_FILES.map((file) => runtimePath(projectRoot, "state", file)),
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

  // D-4 terminology migration: rename historical ideation artifacts to the
  // canonical ideate-* naming without deleting user-authored content.
  const artifactsDir = runtimePath(projectRoot, "artifacts");
  try {
    const entries = await fs.readdir(artifactsDir);
    for (const entry of entries) {
      const match = /^ideation-(.+\.md)$/u.exec(entry);
      if (!match) continue;
      const nextName = `ideate-${match[1]}`;
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

  for (const adapter of Object.values(HARNESS_ADAPTERS)) {
    // Skill-kind shims (Codex) live in per-skill directories, not flat
    // markdown files, so the regex-based stale sweep below would never
    // match them anyway. The legacy `.codex/commands/` cleanup happens in
    // `cleanupLegacyCodexSurfaces` inside syncHarnessShims().
    if (adapter.shimKind === "skill") continue;

    const commandDir = path.join(projectRoot, adapter.commandDir);
    if (!(await exists(commandDir))) continue;

    let entries: string[] = [];
    try {
      entries = await fs.readdir(commandDir);
    } catch {
      entries = [];
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

async function materializeRuntime(projectRoot: string, config: CclawConfig, forceStateReset: boolean): Promise<void> {
  const harnesses = config.harnesses;
  await ensureStructure(projectRoot);
  await cleanLegacyArtifacts(projectRoot);
  await cleanStaleFiles(projectRoot);
  await Promise.all([
    writeEntryCommands(projectRoot),
    writeSkills(projectRoot, config),
    writeArtifactTemplates(projectRoot),
    writeRulebook(projectRoot)
  ]);
  await writeState(projectRoot, config, forceStateReset);
  await ensureRunSystem(projectRoot, { createIfMissing: false });
  await ensureKnowledgeStore(projectRoot);
  await writeHooks(projectRoot, config);
  await syncDisabledHarnessArtifacts(projectRoot, harnesses);
  await syncManagedGitHooks(projectRoot, config);
  await syncHarnessShims(projectRoot, harnesses);
  await writeCursorWorkflowRule(projectRoot, harnesses);
  await ensureGitignore(projectRoot);
}

export async function initCclaw(options: InitOptions): Promise<void> {
  const baseConfig = createDefaultConfig(options.harnesses, options.track);
  // Best-effort auto-detect: a Node project gets `typescript`, a Go module
  // gets `go`, etc. Skipped entirely when the project root has no manifests.
  const detectedPacks = await detectLanguageRulePacks(options.projectRoot);
  const config: CclawConfig = {
    ...baseConfig,
    languageRulePacks: detectedPacks
  };
  // Write a minimal `config.yaml` — advanced knobs live in docs/config.md
  // and only appear in the on-disk file when the user sets them explicitly
  // or a non-default value was detected (e.g. languageRulePacks).
  await writeConfig(options.projectRoot, config, { mode: "minimal" });
  await materializeRuntime(options.projectRoot, config, true);
}

export async function syncCclaw(projectRoot: string): Promise<void> {
  const configExists = await exists(configPath(projectRoot));
  let config = await readConfig(projectRoot);
  if (!configExists) {
    // Prefer detected harness markers over the hardcoded default list.
    // Without this, a user running `cclaw sync` in a `.claude`-only
    // project ends up with a config that also enables cursor/opencode/
    // codex, which then fails doctor checks for missing shim folders.
    // Fall back to the previous default (config.harnesses) if no markers
    // are found so brand-new projects still bootstrap cleanly.
    const detected = await detectHarnesses(projectRoot);
    const harnesses = detected.length > 0 ? detected : config.harnesses;
    const defaultConfig = createDefaultConfig(harnesses);
    await writeConfig(projectRoot, defaultConfig);
    config = defaultConfig;
  }
  await materializeRuntime(projectRoot, config, false);
}

/**
 * Refresh generated files in `.cclaw/` without touching user-authored
 * artifacts, state, or custom config keys. Only the `version` + `flowVersion`
 * stamps are rewritten so the on-disk config reflects the installed CLI.
 *
 * Shape preservation: if the user previously hand-authored advanced keys
 * (e.g. `tdd`, `compound`, `trackHeuristics`, `sliceReview`), those stay in
 * the yaml. If their existing config is minimal, the upgrade keeps it
 * minimal — advanced knobs are never silently added.
 */
export async function upgradeCclaw(projectRoot: string): Promise<void> {
  const advancedKeysPresent = await detectAdvancedKeys(projectRoot);
  const existing = await readConfig(projectRoot);
  const upgraded: CclawConfig = {
    ...existing,
    version: CCLAW_VERSION,
    flowVersion: FLOW_VERSION
  };
  await writeConfig(projectRoot, upgraded, {
    mode: "minimal",
    advancedKeysPresent
  });
  await materializeRuntime(projectRoot, upgraded, false);
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
    /(^|\s)(?:node\s+)?(?:"|')?(?:\.\/)?\.cclaw\/hooks\/run-hook\.(?:mjs|cmd)(?:"|')?\s+(?:session-start|stop-handoff|stop-checkpoint|pre-compact|prompt-guard|workflow-guard|context-monitor|verify-current-state)(?:\s|$)/u.test(
      normalized
    )
  ) {
    return true;
  }
  // Codex UserPromptSubmit non-blocking state nudge.
  return /internal verify-current-state(?:\s|$)/u.test(normalized);
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
  await removeManagedGitHookRelays(projectRoot);

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
      if (/^(?:cclaw-)?cc(?:-(?:next|view|ops|ideate))?$/u.test(entry)) {
        await fs.rm(path.join(codexSkillsRoot, entry), { recursive: true, force: true });
      }
    }
  } catch {
    // directory not present
  }
  await removeIfEmpty(codexSkillsRoot);
  await removeIfEmpty(path.join(projectRoot, ".agents"));

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

  const managedDirs = [
    ".claude/hooks",
    ".claude/commands",
    ".claude",
    ".cursor/rules",
    ".cursor/commands",
    ".cursor",
    ".codex/commands",
    ".codex",
    ".opencode/plugins",
    ".opencode/commands",
    ".opencode"
  ];
  for (const relDir of managedDirs) {
    await removeIfEmpty(path.join(projectRoot, relDir));
  }
}
