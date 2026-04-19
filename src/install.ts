import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import {
  CCLAW_VERSION,
  COMMAND_FILE_ORDER,
  FLOW_VERSION,
  REQUIRED_DIRS,
  RUNTIME_ROOT,
  UTILITY_COMMANDS
} from "./constants.js";
import {
  writeConfig,
  createDefaultConfig,
  readConfig,
  configPath,
  detectLanguageRulePacks,
  detectAdvancedKeys
} from "./config.js";
import { commandContract } from "./content/contracts.js";
import { contextModeFiles, createInitialContextModeState } from "./content/contexts.js";
import { learnSkillMarkdown, learnCommandContract } from "./content/learnings.js";
import { nextCommandContract, nextCommandSkillMarkdown } from "./content/next-command.js";
import { ideateCommandContract, ideateCommandSkillMarkdown } from "./content/ideate-command.js";
import { startCommandContract, startCommandSkillMarkdown } from "./content/start-command.js";
import { statusCommandContract, statusCommandSkillMarkdown } from "./content/status-command.js";
import { treeCommandContract, treeCommandSkillMarkdown } from "./content/tree-command.js";
import { diffCommandContract, diffCommandSkillMarkdown } from "./content/diff-command.js";
import { viewCommandContract, viewCommandSkillMarkdown } from "./content/view-command.js";
import { opsCommandContract, opsCommandSkillMarkdown } from "./content/ops-command.js";
import { featureCommandContract, featureCommandSkillMarkdown } from "./content/feature-command.js";
import { tddLogCommandContract, tddLogCommandSkillMarkdown } from "./content/tdd-log-command.js";
import { retroCommandContract, retroCommandSkillMarkdown } from "./content/retro-command.js";
import { compoundCommandContract, compoundCommandSkillMarkdown } from "./content/compound-command.js";
import { archiveCommandContract, archiveCommandSkillMarkdown } from "./content/archive-command.js";
import {
  rewindCommandContract,
  rewindCommandSkillMarkdown
} from "./content/rewind-command.js";
import { subagentDrivenDevSkill, parallelAgentsSkill } from "./content/subagents.js";
import { sessionHooksSkillMarkdown } from "./content/session-hooks.js";
import {
  sessionStartScript,
  stopCheckpointScript,
  preCompactScript,
  opencodePluginJs,
  claudeHooksJson,
  codexHooksJson,
  cursorHooksJson
} from "./content/hooks.js";
import {
  contextMonitorScript,
  promptGuardScript,
  workflowGuardScript
} from "./content/observe.js";
import { META_SKILL_NAME, usingCclawSkillMarkdown } from "./content/meta-skill.js";
import {
  decisionProtocolMarkdown,
  completionProtocolMarkdown,
  ethosProtocolMarkdown
} from "./content/protocols.js";
import {
  ARTIFACT_TEMPLATES,
  CURSOR_WORKFLOW_RULE_MDC,
  RULEBOOK_MARKDOWN,
  buildRulesJson
} from "./content/templates.js";
import {
  EVAL_BASELINES_README,
  EVAL_CONFIG_YAML,
  EVAL_CORPUS_README,
  EVAL_REPORTS_README,
  EVAL_RUBRIC_FILES,
  EVAL_RUBRICS_README
} from "./content/eval-scaffold.js";
import { TDD_BATCH_WALKTHROUGH_MARKDOWN, stageSkillFolder, stageSkillMarkdown } from "./content/skills.js";
import { stageCommonGuidanceMarkdown } from "./content/stage-common-guidance.js";
import {
  STAGE_EXAMPLES_REFERENCE_DIR,
  stageExamplesReferenceMarkdown
} from "./content/examples.js";
import {
  LANGUAGE_RULE_PACK_DIR,
  LANGUAGE_RULE_PACK_FILES,
  LANGUAGE_RULE_PACK_GENERATORS,
  LEGACY_LANGUAGE_RULE_PACK_FOLDERS,
  UTILITY_SKILL_FOLDERS,
  UTILITY_SKILL_MAP
} from "./content/utility-skills.js";
import { RESEARCH_PLAYBOOKS } from "./content/research-playbooks.js";
import {
  HARNESS_TOOL_REFS_DIR,
  HARNESS_TOOL_REFS_INDEX_MD,
  harnessToolRefMarkdown
} from "./content/harness-tool-refs.js";
import { DOCTOR_REFERENCE_MARKDOWN } from "./content/doctor-references.js";
import { harnessIntegrationDocMarkdown } from "./content/harnesses-doc.js";
import {
  HARNESS_PLAYBOOKS_DIR,
  harnessPlaybookFileName,
  harnessPlaybookMarkdown,
  harnessPlaybooksIndexMarkdown
} from "./content/harness-playbooks.js";
import { HOOK_EVENTS_BY_HARNESS, HOOK_SEMANTIC_EVENTS } from "./content/hook-events.js";
import { createInitialFlowState } from "./flow-state.js";
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
import { ensureRunSystem, readFlowState } from "./runs.js";
import type { FlowTrack, HarnessId, VibyConfig } from "./types.js";

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
  }
}

/**
 * Seed the `.cclaw/evals/` scaffold. Only writes files that do not already
 * exist so that user-authored config.yaml / corpus / rubrics / baselines are
 * never clobbered by `cclaw sync`.
 */
async function writeEvalScaffold(projectRoot: string): Promise<void> {
  const targets: Array<{ rel: string; content: string }> = [
    { rel: "evals/config.yaml", content: EVAL_CONFIG_YAML },
    { rel: "evals/corpus/README.md", content: EVAL_CORPUS_README },
    { rel: "evals/rubrics/README.md", content: EVAL_RUBRICS_README },
    { rel: "evals/baselines/README.md", content: EVAL_BASELINES_README },
    { rel: "evals/reports/README.md", content: EVAL_REPORTS_README }
  ];
  for (const rubric of EVAL_RUBRIC_FILES) {
    targets.push({
      rel: `evals/rubrics/${rubric.stage}.yaml`,
      content: rubric.contents
    });
  }
  for (const target of targets) {
    const absolute = runtimePath(projectRoot, ...target.rel.split("/"));
    if (await exists(absolute)) continue;
    await writeFileSafe(absolute, target.content);
  }
}

async function writeSkills(projectRoot: string, config?: VibyConfig): Promise<void> {
  for (const stage of COMMAND_FILE_ORDER) {
    const folder = stageSkillFolder(stage);
    await writeFileSafe(
      runtimePath(projectRoot, "skills", folder, "SKILL.md"),
      stageSkillMarkdown(stage)
    );

    // Progressive disclosure (A.2#8): materialize the full example artifact as
    // a sibling reference file. The stage skill only links to it; agents load
    // the reference on demand.
    const referenceMarkdown = stageExamplesReferenceMarkdown(stage);
    if (referenceMarkdown) {
      const referenceDir = STAGE_EXAMPLES_REFERENCE_DIR.split("/");
      await writeFileSafe(
        runtimePath(projectRoot, ...referenceDir, `${stage}-examples.md`),
        referenceMarkdown
      );
    }
  }

  // Progressive disclosure for the TDD Batch Execution walkthrough (A.1#1).
  // The detailed 3-task transcript lives next to stage examples so the
  // always-rendered TDD skill stays under the line-budget and the reference
  // is loaded on demand.
  await writeFileSafe(
    runtimePath(projectRoot, ...STAGE_EXAMPLES_REFERENCE_DIR.split("/"), "tdd-batch-walkthrough.md"),
    TDD_BATCH_WALKTHROUGH_MARKDOWN
  );
  await writeFileSafe(
    runtimePath(projectRoot, ...STAGE_EXAMPLES_REFERENCE_DIR.split("/"), "common-guidance.md"),
    stageCommonGuidanceMarkdown()
  );

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
    runtimePath(projectRoot, "skills", "flow-status", "SKILL.md"),
    statusCommandSkillMarkdown()
  );
  await writeFileSafe(
    runtimePath(projectRoot, "skills", "flow-tree", "SKILL.md"),
    treeCommandSkillMarkdown()
  );
  await writeFileSafe(
    runtimePath(projectRoot, "skills", "flow-diff", "SKILL.md"),
    diffCommandSkillMarkdown()
  );
  await writeFileSafe(
    runtimePath(projectRoot, "skills", "flow-ops", "SKILL.md"),
    opsCommandSkillMarkdown()
  );
  await writeFileSafe(
    runtimePath(projectRoot, "skills", "using-git-worktrees", "SKILL.md"),
    featureCommandSkillMarkdown()
  );
  await writeFileSafe(
    runtimePath(projectRoot, "skills", "tdd-cycle-log", "SKILL.md"),
    tddLogCommandSkillMarkdown()
  );
  await writeFileSafe(
    runtimePath(projectRoot, "skills", "flow-retro", "SKILL.md"),
    retroCommandSkillMarkdown()
  );
  await writeFileSafe(
    runtimePath(projectRoot, "skills", "flow-compound", "SKILL.md"),
    compoundCommandSkillMarkdown()
  );
  await writeFileSafe(
    runtimePath(projectRoot, "skills", "flow-rewind", "SKILL.md"),
    rewindCommandSkillMarkdown()
  );
  await writeFileSafe(
    runtimePath(projectRoot, "skills", "flow-archive", "SKILL.md"),
    archiveCommandSkillMarkdown()
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
  await writeFileSafe(
    runtimePath(projectRoot, "references", "protocols", "decision.md"),
    decisionProtocolMarkdown()
  );
  await writeFileSafe(
    runtimePath(projectRoot, "references", "protocols", "completion.md"),
    completionProtocolMarkdown()
  );
  await writeFileSafe(
    runtimePath(projectRoot, "references", "protocols", "ethos.md"),
    ethosProtocolMarkdown()
  );

  for (const folder of UTILITY_SKILL_FOLDERS) {
    const generator = UTILITY_SKILL_MAP[folder];
    await writeFileSafe(runtimePath(projectRoot, "skills", folder, "SKILL.md"), generator());
  }

  // In-thread research procedures (no YAML frontmatter, not delegated personas).
  for (const [fileName, markdown] of Object.entries(RESEARCH_PLAYBOOKS)) {
    await writeFileSafe(runtimePath(projectRoot, "skills", "research", fileName), markdown);
  }

  // Language rule packs live under .cclaw/rules/lang/<pack>.md. They are opt-in:
  // only the packs listed in config.languageRulePacks are materialised. Any
  // legacy per-language skill folders from v0.7.0 (.cclaw/skills/language-*)
  // are cleaned up below so the new rules/lang layout is the only truth.
  const enabledPacks = config?.languageRulePacks ?? [];
  for (const pack of enabledPacks) {
    const fileName = LANGUAGE_RULE_PACK_FILES[pack];
    const generator = LANGUAGE_RULE_PACK_GENERATORS[pack];
    if (!fileName || !generator) continue;
    await writeFileSafe(
      runtimePath(projectRoot, ...LANGUAGE_RULE_PACK_DIR, fileName),
      generator()
    );
  }

  for (const legacyFolder of LEGACY_LANGUAGE_RULE_PACK_FOLDERS) {
    const legacyPath = runtimePath(projectRoot, "skills", legacyFolder);
    if (await exists(legacyPath)) {
      await fs.rm(legacyPath, { recursive: true, force: true });
    }
  }

  // Per-harness tool maps (A.1#4). One reference file per supported harness
  // plus an index; stage/utility skills cite these instead of hardcoding
  // tool names inline.
  const harnessIds: HarnessId[] = ["claude", "cursor", "opencode", "codex"];
  const harnessRefsDir = HARNESS_TOOL_REFS_DIR.split("/");
  await writeFileSafe(
    runtimePath(projectRoot, ...harnessRefsDir, "README.md"),
    HARNESS_TOOL_REFS_INDEX_MD
  );
  for (const harness of harnessIds) {
    await writeFileSafe(
      runtimePath(projectRoot, ...harnessRefsDir, `${harness}.md`),
      harnessToolRefMarkdown(harness)
    );
  }

  const doctorRefsDir = ["references", "doctor"] as const;
  for (const [fileName, markdown] of Object.entries(DOCTOR_REFERENCE_MARKDOWN)) {
    await writeFileSafe(runtimePath(projectRoot, ...doctorRefsDir, fileName), markdown);
  }

  await writeFileSafe(
    runtimePath(projectRoot, "references", "harnesses.md"),
    harnessIntegrationDocMarkdown()
  );

  // Per-harness parity playbooks. Generated for every supported harness
  // regardless of which harnesses the project installed — the index always
  // resolves, and doctor only asserts presence of the installed harnesses'
  // playbooks (see runtime-integrity checks).
  const playbookDirSegments = HARNESS_PLAYBOOKS_DIR.split("/");
  await writeFileSafe(
    runtimePath(projectRoot, ...playbookDirSegments, "README.md"),
    harnessPlaybooksIndexMarkdown()
  );
  for (const harness of harnessIds) {
    await writeFileSafe(
      runtimePath(projectRoot, ...playbookDirSegments, harnessPlaybookFileName(harness)),
      harnessPlaybookMarkdown(harness)
    );
  }
}

async function writeUtilityCommands(projectRoot: string): Promise<void> {
  await writeFileSafe(runtimePath(projectRoot, "commands", "learn.md"), learnCommandContract());
  await writeFileSafe(runtimePath(projectRoot, "commands", "next.md"), nextCommandContract());
  await writeFileSafe(runtimePath(projectRoot, "commands", "ideate.md"), ideateCommandContract());
  await writeFileSafe(runtimePath(projectRoot, "commands", "view.md"), viewCommandContract());
  await writeFileSafe(runtimePath(projectRoot, "commands", "start.md"), startCommandContract());
  await writeFileSafe(runtimePath(projectRoot, "commands", "status.md"), statusCommandContract());
  await writeFileSafe(runtimePath(projectRoot, "commands", "tree.md"), treeCommandContract());
  await writeFileSafe(runtimePath(projectRoot, "commands", "diff.md"), diffCommandContract());
  await writeFileSafe(runtimePath(projectRoot, "commands", "ops.md"), opsCommandContract());
  await writeFileSafe(runtimePath(projectRoot, "commands", "feature.md"), featureCommandContract());
  await writeFileSafe(runtimePath(projectRoot, "commands", "tdd-log.md"), tddLogCommandContract());
  await writeFileSafe(runtimePath(projectRoot, "commands", "retro.md"), retroCommandContract());
  await writeFileSafe(runtimePath(projectRoot, "commands", "compound.md"), compoundCommandContract());
  await writeFileSafe(runtimePath(projectRoot, "commands", "archive.md"), archiveCommandContract());
  await writeFileSafe(runtimePath(projectRoot, "commands", "rewind.md"), rewindCommandContract());
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

async function writeHooks(projectRoot: string, config: VibyConfig): Promise<void> {
  const harnesses = config.harnesses;
  const hooksDir = runtimePath(projectRoot, "hooks");
  await ensureDir(hooksDir);

  await writeFileSafe(path.join(hooksDir, "session-start.sh"), sessionStartScript());
  await writeFileSafe(path.join(hooksDir, "stop-checkpoint.sh"), stopCheckpointScript());
  await writeFileSafe(path.join(hooksDir, "pre-compact.sh"), preCompactScript());
  await writeFileSafe(path.join(hooksDir, "prompt-guard.sh"), promptGuardScript({
    strictMode: config.promptGuardMode === "strict"
  }));
  await writeFileSafe(
    path.join(hooksDir, "workflow-guard.sh"),
    workflowGuardScript({
      tddEnforcementMode: config.tddEnforcement ?? "advisory",
      tddTestGlobs: config.tddTestGlobs
    })
  );
  await writeFileSafe(path.join(hooksDir, "context-monitor.sh"), contextMonitorScript());
  const opencodePluginSource = opencodePluginJs();
  await writeFileSafe(path.join(hooksDir, "opencode-plugin.mjs"), opencodePluginSource);

  try {
    for (const script of [
      "session-start.sh",
      "stop-checkpoint.sh",
      "pre-compact.sh",
      "prompt-guard.sh",
      "workflow-guard.sh",
      "context-monitor.sh",
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
    await writeFileSafe(storePath, "");
  }
  const legacyMdPath = runtimePath(projectRoot, "knowledge.md");
  if (await exists(legacyMdPath)) {
    await fs.rm(legacyMdPath, { force: true });
  }
}

async function ensureCustomSkillsScaffold(projectRoot: string): Promise<void> {
  const customDir = runtimePath(projectRoot, "custom-skills");
  await ensureDir(customDir);
  const readmePath = path.join(customDir, "README.md");
  if (!(await exists(readmePath))) {
    await writeFileSafe(readmePath, CUSTOM_SKILLS_README);
  }
  const examplePath = path.join(customDir, "example", "SKILL.md");
  if (!(await exists(examplePath))) {
    await writeFileSafe(examplePath, CUSTOM_SKILLS_EXAMPLE);
  }
}

const CUSTOM_SKILLS_README = `# Custom Skills (sync-safe)

This directory is **never overwritten** by \`cclaw sync\` or \`cclaw upgrade\`. Use it
to add project-specific skills that complement the managed skills under
\`.cclaw/skills/\`.

## When to add a custom skill

- A repeatable lens specific to **this project** (e.g. "billing-domain", "kafka-message-contracts").
- A team convention you want every agent session to load.
- A domain checklist that does not generalize to other projects.

If the skill is general (security, performance, accessibility, etc.) prefer
contributing it upstream instead — the managed skills receive maintenance.

## File format — public API (stable contract)

Each skill lives at \`.cclaw/custom-skills/<folder>/SKILL.md\`. The format is a
**stable public API**: \`cclaw sync\` and \`cclaw upgrade\` will not rewrite
custom skills, and the fields below are guaranteed to be respected by the
meta-skill router and the stage hooks.

### Frontmatter (YAML, required)

\`\`\`yaml
---
# Required fields
name: <kebab-case-skill-name>
description: >
  One sentence (≤180 chars) that triggers semantic routing. Include the
  concrete situation and the expected action
  (e.g. "Audit Kafka topic contracts when a producer or consumer signature changes").

# Optional fields (omit when not applicable)
stages: [design, spec, tdd, review]    # flow stages this skill applies to
triggers:
  - "kafka topic"
  - "producer.schema"
  - "consumer.schema"
hardGate: false                        # true => skill body MUST include a ## HARD-GATE section
owners: ["@team-messaging"]            # informational routing hint, not enforced
version: 0.1.0                         # semver; bump when hardGate or algorithm changes
---
\`\`\`

### Field contract

| Field | Type | Required | Meaning |
|---|---|---|---|
| \`name\` | string (kebab-case) | yes | Unique id used by the router and by \`/cc-view status\` diagnostics. |
| \`description\` | string ≤180 chars (single line OR YAML \`>\` folded) | yes | Drives semantic routing. Include trigger + action. |
| \`stages\` | array of flow stages | no | When present, the meta-skill only surfaces this skill during those stages. Omit for "any stage". |
| \`triggers\` | array of strings | no | Extra literal substrings that route to this skill when found in the user prompt or the active artifact. |
| \`hardGate\` | boolean | no | When \`true\`, the body MUST include a \`## HARD-GATE\` section; the agent treats the rule as non-skippable. |
| \`owners\` | array of strings | no | Informational only — surfaced to the user, never enforced. |
| \`version\` | semver string | no | Bump when you change the HARD-GATE or algorithm so reviewers can spot changes. |

### Body sections (markdown, recommended order)

\`\`\`markdown
# <Skill title>

## Overview
One-paragraph summary; context for when this skill is loaded.

## When to use
- Bullet list of situations where this skill adds value.

## When NOT to use
- Situations where loading this skill is context bloat or wrong.

## HARD-GATE   (REQUIRED when frontmatter hardGate: true)
Phrase it as a refusal:
> Do not <X> while <Y>.

## Algorithm / checklist
1. Concrete, observable steps with evidence (file:line, artifact, or knowledge entry).

## Output protocol
Where the artifact / chat output lives and what shape it takes.

## Anti-patterns
- Common failure modes to reject.
\`\`\`

### Stage association semantics

- \`stages: []\` or missing → skill is available at any stage. The meta-skill still only surfaces it when \`description\` or \`triggers\` match the prompt.
- \`stages: [review]\` → skill is offered only during the review stage.
- Custom skills **never** become mandatory delegations. They are opt-in lenses. If you need a mandatory dispatch, add a proper managed specialist under \`.cclaw/skills/\` instead.

## Routing

Custom skills are surfaced via the \`using-cclaw\` meta-skill at session start.
Mention the skill name in your prompt or let the agent semantic-route to it
based on the description + triggers + stages frontmatter.

## Versioning & removal

Custom skills are user-owned. Bump \`version\` when you change the HARD-GATE or
algorithm; delete or edit them at any time — \`cclaw sync\` will not touch them.
`;

const CUSTOM_SKILLS_EXAMPLE = `---
name: example-custom-skill
description: "Replace this with a one-sentence description that triggers when the skill should be used. Delete or rename this folder when you add a real skill."
---

# Example Custom Skill

This is a placeholder. Use it as a starting template, then delete or rename
the \`example/\` folder.

## When to use

- A real, repeatable situation in **this** project that needs a consistent lens.

## HARD-GATE (optional)

Drop this section if no hard rule applies. Keep it crisp:

> Do not <X> while <Y>.

## Algorithm

1. Step one — observable, file:line evidence required.
2. Step two — produce a named artifact, not a vibe.
3. Step three — escalate / hand off / record knowledge entry.

## Anti-patterns

- Treating this skill as advisory when the situation matches the trigger.
- Loading this skill when the situation clearly does not match (context bloat).
`;


async function ensureSessionStateFiles(projectRoot: string): Promise<void> {
  const stateDir = runtimePath(projectRoot, "state");
  await ensureDir(stateDir);
  const flow = await readFlowState(projectRoot);

  const activityPath = path.join(stateDir, "stage-activity.jsonl");
  if (!(await exists(activityPath))) {
    await writeFileSafe(activityPath, "");
  }

  const checkpointPath = path.join(stateDir, "checkpoint.json");
  if (!(await exists(checkpointPath))) {
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

  const contextModePath = path.join(stateDir, "context-mode.json");
  if (!(await exists(contextModePath))) {
    await writeFileSafe(
      contextModePath,
      `${JSON.stringify(createInitialContextModeState(), null, 2)}\n`
    );
  }

  const knowledgeDigestPath = path.join(stateDir, "knowledge-digest.md");
  if (!(await exists(knowledgeDigestPath))) {
    await writeFileSafe(
      knowledgeDigestPath,
      "# Knowledge digest (auto-generated)\n\n(no entries yet)\n"
    );
  }

  const tddCycleLogPath = path.join(stateDir, "tdd-cycle-log.jsonl");
  if (!(await exists(tddCycleLogPath))) {
    await writeFileSafe(tddCycleLogPath, "");
  }

  const flowSnapshotPath = path.join(stateDir, "flow-state.snapshot.json");
  if (!(await exists(flowSnapshotPath))) {
    await writeFileSafe(flowSnapshotPath, `${JSON.stringify({
      capturedAt: new Date().toISOString(),
      state: flow
    }, null, 2)}\n`);
  }
}

async function writeRulebook(projectRoot: string): Promise<void> {
  await writeFileSafe(runtimePath(projectRoot, "rules", "RULES.md"), RULEBOOK_MARKDOWN);
  await writeFileSafe(
    runtimePath(projectRoot, "rules", "rules.json"),
    `${JSON.stringify(buildRulesJson(), null, 2)}\n`
  );
}

async function writeContextModes(projectRoot: string): Promise<void> {
  for (const [mode, content] of Object.entries(contextModeFiles())) {
    await writeFileSafe(runtimePath(projectRoot, "contexts", `${mode}.md`), content);
  }
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

async function writeState(projectRoot: string, config: VibyConfig, forceReset = false): Promise<void> {
  const statePath = runtimePath(projectRoot, "state", "flow-state.json");
  if (!forceReset && (await exists(statePath))) {
    return;
  }

  const state = createInitialFlowState("active", config.defaultTrack ?? "standard");
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

async function writeHarnessGapsState(projectRoot: string, harnesses: HarnessId[]): Promise<void> {
  const report = harnesses.map((harness) => {
    const capabilities = HARNESS_ADAPTERS[harness].capabilities;
    const hookMap = HOOK_EVENTS_BY_HARNESS[harness];
    const missingHookEvents = HOOK_SEMANTIC_EVENTS.filter((eventName) => !hookMap[eventName]);
    const missingCapabilities: string[] = [];
    if (capabilities.nativeSubagentDispatch !== "full") {
      missingCapabilities.push(`nativeSubagentDispatch:${capabilities.nativeSubagentDispatch}`);
    }
    if (capabilities.hookSurface !== "full") {
      missingCapabilities.push(`hookSurface:${capabilities.hookSurface}`);
    }
    if (capabilities.structuredAsk === "plain-text") {
      missingCapabilities.push("structuredAsk:none");
    }

    const remediation: string[] = [];
    switch (capabilities.subagentFallback) {
      case "native":
        // nothing to remediate — harness has first-class dispatch
        break;
      case "generic-dispatch":
        remediation.push(
          `subagent dispatch → map named cclaw agents onto generic Task subagent_type per ${HARNESS_PLAYBOOKS_DIR}/${harness}-playbook.md`
        );
        break;
      case "role-switch":
        remediation.push(
          `subagent dispatch → role-switch in-session with evidenceRefs per ${HARNESS_PLAYBOOKS_DIR}/${harness}-playbook.md`
        );
        break;
      case "waiver":
        remediation.push(
          `subagent dispatch → record explicit harness_limitation waiver; no parity path available`
        );
        break;
    }
    // Per-harness structuredAsk remediation: record either the fallback
    // requirement (plain-text) or the gating / experimental status of the
    // native primitive so `cclaw doctor` and harness-gaps.json stay
    // honest about *why* a primitive might silently not fire.
    switch (capabilities.structuredAsk) {
      case "plain-text":
        remediation.push(
          "structured ask → fall back to a numbered plain-text list; first option is default"
        );
        break;
      case "question":
        remediation.push(
          `structured ask → OpenCode \`question\` tool; enable with \`permission.question: "allow"\` in \`opencode.json\` (ACP clients additionally need \`OPENCODE_ENABLE_QUESTION_TOOL=1\`). Fallback: shared plain-text lettered list.`
        );
        break;
      case "request_user_input":
        remediation.push(
          "structured ask → Codex `request_user_input` tool (experimental; surfaced in Plan / Collaboration mode). Fallback: shared plain-text lettered list when the tool is hidden."
        );
        break;
      case "AskUserQuestion":
      case "AskQuestion":
        // Native first-class ask — no remediation required.
        break;
    }
    for (const event of missingHookEvents) {
      remediation.push(`hook event ${event} → schedule the corresponding script manually or accept reduced observability`);
    }

    return {
      harness,
      tier: harnessTier(harness),
      subagentFallback: capabilities.subagentFallback,
      playbookPath: `${RUNTIME_ROOT}/${HARNESS_PLAYBOOKS_DIR}/${harness}-playbook.md`,
      missingCapabilities,
      missingHookEvents,
      remediation
    };
  });

  await writeFileSafe(
    runtimePath(projectRoot, "state", "harness-gaps.json"),
    `${JSON.stringify({
      generatedAt: new Date().toISOString(),
      schemaVersion: 2,
      harnesses: report
    }, null, 2)}\n`
  );
}

async function cleanLegacyArtifacts(projectRoot: string): Promise<void> {
  // Remove deprecated utility skill folders from older releases.
  for (const legacyFolder of [
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
    "feature-workspaces"
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
  // Core-5 migration: remove deprecated generated agent personas.
  for (const legacyAgentFile of [
    "spec-reviewer.md",
    "code-reviewer.md",
    "repo-research-analyst.md",
    "learnings-researcher.md",
    "framework-docs-researcher.md",
    "best-practices-researcher.md",
    "git-history-analyzer.md"
  ]) {
    try {
      await fs.rm(runtimePath(projectRoot, "agents", legacyAgentFile), { force: true });
    } catch {
      // best-effort cleanup
    }
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

  for (const legacyRuntimeFile of [
    runtimePath(projectRoot, "learnings.jsonl"),
    runtimePath(projectRoot, "observations.jsonl"),
    runtimePath(projectRoot, "hooks", "observe.sh"),
    runtimePath(projectRoot, "hooks", "summarize-observations.sh"),
    runtimePath(projectRoot, "hooks", "summarize-observations.mjs")
  ]) {
    try {
      await fs.rm(legacyRuntimeFile, { force: true });
    } catch {
      // best-effort cleanup
    }
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

async function materializeRuntime(projectRoot: string, config: VibyConfig, forceStateReset: boolean): Promise<void> {
  const harnesses = config.harnesses;
  await ensureStructure(projectRoot);
  await cleanLegacyArtifacts(projectRoot);
  await cleanStaleFiles(projectRoot);
  await writeCommandContracts(projectRoot);
  await writeUtilityCommands(projectRoot);
  await writeSkills(projectRoot, config);
  await writeContextModes(projectRoot);
  await writeArtifactTemplates(projectRoot);
  await writeEvalScaffold(projectRoot);
  await writeRulebook(projectRoot);
  await writeState(projectRoot, config, forceStateReset);
  await ensureRunSystem(projectRoot, { createIfMissing: false });
  await ensureSessionStateFiles(projectRoot);
  await writeAdapterManifest(projectRoot, harnesses);
  await writeHarnessGapsState(projectRoot, harnesses);
  await ensureKnowledgeStore(projectRoot);
  await ensureCustomSkillsScaffold(projectRoot);
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
  const config: VibyConfig = {
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
  const config = await readConfig(projectRoot);
  if (!configExists) {
    await writeConfig(projectRoot, createDefaultConfig(config.harnesses));
  }
  await materializeRuntime(projectRoot, config, false);
}

/**
 * Refresh generated files in `.cclaw/` without touching user-authored
 * artifacts, state, or custom config keys. Only the `version` + `flowVersion`
 * stamps are rewritten so the on-disk config reflects the installed CLI.
 *
 * Shape preservation: if the user previously hand-authored advanced keys
 * (e.g. `tddTestGlobs`, `trackHeuristics`, `sliceReview`), those stay in the
 * yaml. If their existing config is minimal, the upgrade keeps it minimal —
 * advanced knobs are never silently added.
 */
export async function upgradeCclaw(projectRoot: string): Promise<void> {
  const advancedKeysPresent = await detectAdvancedKeys(projectRoot);
  const existing = await readConfig(projectRoot);
  const upgraded: VibyConfig = {
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
  const normalized = command.trim().replace(/\s+/gu, " ");
  return /(^|\s)(?:bash\s+)?(?:\.\/)?\.cclaw\/hooks\/(?:session-start|stop-checkpoint|pre-compact|prompt-guard|workflow-guard|context-monitor)\.sh(?:\s|$)/u.test(
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
