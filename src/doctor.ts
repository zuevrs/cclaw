import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { REQUIRED_DIRS, RUNTIME_ROOT, UTILITY_COMMANDS } from "./constants.js";
import { CCLAW_AGENTS } from "./content/core-agents.js";
import { detectAdvancedKeys, InvalidConfigError, readConfig } from "./config.js";
import { exists } from "./fs-utils.js";
import { gitignoreHasRequiredPatterns } from "./gitignore.js";
import {
  HARNESS_ADAPTERS,
  CCLAW_MARKER_START,
  CCLAW_MARKER_END,
  harnessShimFileNames,
  harnessShimSkillNames
} from "./harness-adapters.js";
import { policyChecks } from "./policy.js";
import { CorruptFlowStateError, readFlowState } from "./runs.js";
import { createInitialFlowState, skippedStagesForTrack } from "./flow-state.js";
import { FLOW_STAGES, TRACK_STAGES } from "./types.js";
import { checkMandatoryDelegations } from "./delegation.js";
import {
  activeFeatureMetaPath,
  ensureFeatureSystem,
  listFeatures,
  readActiveFeature,
  readFeatureWorktreeRegistry,
  resolveFeatureWorkspacePath,
  worktreeRegistryPath
} from "./feature-system.js";
import { buildTraceMatrix } from "./trace-matrix.js";
import {
  classifyReconciliationNotices,
  reconcileAndWriteCurrentStageGateCatalog,
  readReconciliationNotices,
  RECONCILIATION_NOTICES_REL_PATH,
  verifyCompletedStagesGateClosure,
  verifyCurrentStageGateEvidence
} from "./gate-evidence.js";
import { parseTddCycleLog, validateTddCycleOrder } from "./tdd-cycle.js";
import { stageSkillFolder } from "./content/skills.js";
import { doctorCheckMetadata } from "./doctor-registry.js";
import { resolveTrackFromPrompt } from "./track-heuristics.js";
import {
  classifyCodexHooksFlag,
  codexConfigPath,
  readCodexConfig
} from "./codex-feature-flag.js";
import {
  LANGUAGE_RULE_PACK_DIR,
  LANGUAGE_RULE_PACK_FILES,
  LEGACY_LANGUAGE_RULE_PACK_FOLDERS,
  UTILITY_SKILL_FOLDERS
} from "./content/utility-skills.js";
import { CONTEXT_MODES, DEFAULT_CONTEXT_MODE } from "./content/contexts.js";
import { DOCTOR_REFERENCE_MARKDOWN } from "./content/doctor-references.js";
import {
  HARNESS_PLAYBOOKS_DIR,
  harnessPlaybookFileName
} from "./content/harness-playbooks.js";
import { validateHookDocument } from "./hook-schema.js";
import type { HarnessId } from "./types.js";
import type { DoctorSeverity } from "./doctor-registry.js";

const execFileAsync = promisify(execFile);

export interface DoctorCheck {
  name: string;
  ok: boolean;
  details: string;
  severity: DoctorSeverity;
  summary: string;
  fix: string;
  docRef?: string;
}

export interface DoctorOptions {
  /** When true, normalize current-stage gate catalog and persist reconciliation before checks. */
  reconcileCurrentStageGates?: boolean;
}

type PendingDoctorCheck = Omit<DoctorCheck, "severity" | "summary" | "fix" | "docRef"> &
  Partial<Pick<DoctorCheck, "severity" | "summary" | "fix" | "docRef">>;

async function isGitRepo(projectRoot: string): Promise<boolean> {
  try {
    await execFileAsync("git", ["rev-parse", "--is-inside-work-tree"], { cwd: projectRoot });
    return true;
  } catch {
    return false;
  }
}

async function gitWorktreePaths(projectRoot: string): Promise<Set<string>> {
  try {
    const { stdout } = await execFileAsync("git", ["worktree", "list", "--porcelain"], {
      cwd: projectRoot
    });
    const out = new Set<string>();
    for (const line of stdout.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("worktree ")) continue;
      const rawPath = trimmed.slice("worktree ".length).trim();
      if (!rawPath) continue;
      out.add(path.resolve(rawPath));
    }
    return out;
  } catch {
    return new Set<string>();
  }
}

async function resolveGitHooksDir(projectRoot: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync("git", ["rev-parse", "--git-path", "hooks"], { cwd: projectRoot });
    const rel = stdout.trim();
    if (rel.length === 0) {
      return null;
    }
    return path.resolve(projectRoot, rel);
  } catch {
    return null;
  }
}

async function gitIgnoresRuntime(projectRoot: string): Promise<boolean> {
  try {
    await execFileAsync("git", ["check-ignore", "-q", `${RUNTIME_ROOT}/`], { cwd: projectRoot });
    return true;
  } catch {
    return false;
  }
}

function toObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function collectHookCommands(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((item) => collectHookCommands(item));
  }
  const obj = toObject(value);
  if (!obj) return [];
  const direct = typeof obj.command === "string" ? [obj.command] : [];
  const nested = collectHookCommands(obj.hooks);
  return [...direct, ...nested];
}

function extractUserPromptFromIdeaArtifact(markdown: string): string | null {
  const normalized = markdown.replace(/\r\n?/gu, "\n");
  const heading = /^##\s+User prompt\s*$/imu.exec(normalized);
  if (!heading || heading.index === undefined) {
    return null;
  }
  const sectionStart = heading.index + heading[0].length;
  const tail = normalized.slice(sectionStart).replace(/^\s*\n/gu, "");
  const nextHeadingIndex = tail.search(/^##\s+/mu);
  const body = (nextHeadingIndex >= 0 ? tail.slice(0, nextHeadingIndex) : tail).trim();
  return body.length > 0 ? body : null;
}

async function commandAvailable(command: string): Promise<boolean> {
  try {
    await execFileAsync("bash", ["-lc", `command -v ${command} >/dev/null 2>&1`]);
    return true;
  } catch {
    return false;
  }
}

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
      } else if (c === "\"") {
        inString = false;
      }
      i += 1;
      continue;
    }
    if (c === "\"") {
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

function parseJsonLike(raw: string): unknown | null {
  try {
    return JSON.parse(raw);
  } catch {
    // fall through
  }
  try {
    const normalized = stripJsonCommentsOutsideStrings(raw).replace(/,\s*([}\]])/gu, "$1");
    return JSON.parse(normalized);
  } catch {
    return null;
  }
}

async function readHookDocument(filePath: string): Promise<Record<string, unknown> | null> {
  if (!(await exists(filePath))) return null;
  try {
    const raw = await fs.readFile(filePath, "utf8");
    const parsed = parseJsonLike(raw);
    const obj = toObject(parsed);
    return obj ?? null;
  } catch {
    return null;
  }
}

async function readJsonObjectStatus(filePath: string): Promise<{
  exists: boolean;
  ok: boolean;
  error?: string;
}> {
  if (!(await exists(filePath))) {
    return { exists: false, ok: false, error: "file is missing" };
  }
  try {
    const parsed = JSON.parse(await fs.readFile(filePath, "utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { exists: true, ok: false, error: "JSON root must be an object" };
    }
    return { exists: true, ok: true };
  } catch (error) {
    return {
      exists: true,
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

async function readPermissionBits(filePath: string): Promise<number | null> {
  try {
    const stat = await fs.stat(filePath);
    return stat.mode & 0o777;
  } catch {
    return null;
  }
}

function normalizeOpenCodePluginEntry(entry: unknown): string | null {
  if (typeof entry === "string" && entry.trim().length > 0) return entry.trim();
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) return null;
  const obj = entry as Record<string, unknown>;
  for (const key of ["path", "src", "plugin"] as const) {
    const value = obj[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }
  return null;
}

async function opencodeRegistrationCheck(projectRoot: string): Promise<{ ok: boolean; details: string }> {
  const expected = ".opencode/plugins/cclaw-plugin.mjs";
  const candidates = [
    path.join(projectRoot, "opencode.json"),
    path.join(projectRoot, "opencode.jsonc"),
    path.join(projectRoot, ".opencode/opencode.json"),
    path.join(projectRoot, ".opencode/opencode.jsonc")
  ];

  const mismatches: string[] = [];
  let foundAnyConfig = false;
  for (const configPath of candidates) {
    if (!(await exists(configPath))) {
      continue;
    }
    foundAnyConfig = true;
    const parsed = await readHookDocument(configPath);
    if (!parsed) {
      mismatches.push(`${path.relative(projectRoot, configPath)} is unreadable or invalid JSON`);
      continue;
    }
    const plugins = Array.isArray(parsed.plugin) ? parsed.plugin : [];
    const registered = plugins.some((entry) => normalizeOpenCodePluginEntry(entry) === expected);
    if (registered) {
      return { ok: true, details: `${path.relative(projectRoot, configPath)} registers ${expected}` };
    }
    mismatches.push(`${path.relative(projectRoot, configPath)} missing plugin ${expected}`);
  }

  if (foundAnyConfig) {
    return { ok: false, details: mismatches.join(" | ") };
  }
  return { ok: false, details: `No opencode.json/opencode.jsonc found with plugin ${expected}` };
}

async function opencodePluginRuntimeShapeCheck(projectRoot: string): Promise<{ ok: boolean; details: string }> {
  const pluginPath = path.join(projectRoot, ".opencode/plugins/cclaw-plugin.mjs");
  if (!(await exists(pluginPath))) {
    return { ok: false, details: `${path.relative(projectRoot, pluginPath)} not found` };
  }

  try {
    const moduleUrl = `${pathToFileURL(pluginPath).href}?doctor=${Date.now()}`;
    const imported = await import(moduleUrl) as { default?: unknown };
    if (typeof imported.default !== "function") {
      return {
        ok: false,
        details: `${path.relative(projectRoot, pluginPath)} must export a default plugin factory function`
      };
    }

    const plugin = imported.default({ directory: projectRoot }) as Record<string, unknown>;
    if (!plugin || typeof plugin !== "object" || Array.isArray(plugin)) {
      return {
        ok: false,
        details: `${path.relative(projectRoot, pluginPath)} factory must return a plugin object`
      };
    }
    const requiredHandlers = [
      "event",
      "tool.execute.before",
      "tool.execute.after",
      "experimental.chat.system.transform"
    ];
    const missing = requiredHandlers.filter((name) => typeof plugin?.[name] !== "function");
    if (missing.length > 0) {
      return {
        ok: false,
        details: `${path.relative(projectRoot, pluginPath)} missing runtime handlers: ${missing.join(", ")}`
      };
    }
    return {
      ok: true,
      details: `${path.relative(projectRoot, pluginPath)} exports compatible runtime handler shape`
    };
  } catch (error) {
    return {
      ok: false,
      details: `runtime load failed for .opencode/plugins/cclaw-plugin.mjs: ${error instanceof Error ? error.message : String(error)}`
    };
  }
}

export async function doctorChecks(projectRoot: string, options: DoctorOptions = {}): Promise<DoctorCheck[]> {
  const checks: PendingDoctorCheck[] = [];

  for (const dir of REQUIRED_DIRS) {
    const fullPath = path.join(projectRoot, dir);
    checks.push({
      name: `dir:${dir}`,
      ok: await exists(fullPath),
      details: fullPath
    });
  }

  for (const stage of FLOW_STAGES) {
    const commandPath = path.join(projectRoot, RUNTIME_ROOT, "commands", `${stage}.md`);
    checks.push({
      name: `command:${stage}`,
      ok: await exists(commandPath),
      details: commandPath
    });

    const skillPath = path.join(projectRoot, RUNTIME_ROOT, "skills", stageSkillFolder(stage), "SKILL.md");
    const skillExists = await exists(skillPath);
    checks.push({
      name: `skill:${stage}`,
      ok: skillExists,
      details: skillPath
    });

    if (skillExists) {
      const skillContent = await fs.readFile(skillPath, "utf8");
      const lineCount = skillContent.split("\n").length;
      const MIN_SKILL_LINES = 110;
      // Soft max tightened from 650 → 500 after externalising the TDD
      // batch-execution walkthrough and collapsing the duplicate "what
      // goes wrong" lists. Stage skills beyond 500 lines drift into unread
      // bloat; long-form content belongs under `.cclaw/references/` instead.
      const MAX_SKILL_LINES = 500;
      checks.push({
        name: `skill:${stage}:min_lines`,
        ok: lineCount >= MIN_SKILL_LINES,
        details: `${skillPath} has ${lineCount} lines (minimum ${MIN_SKILL_LINES})`
      });
      checks.push({
        name: `skill:${stage}:max_lines`,
        ok: lineCount <= MAX_SKILL_LINES,
        details: `${skillPath} has ${lineCount} lines (soft max ${MAX_SKILL_LINES}; stage skills beyond this drift into unread bloat)`
      });

      const canonicalSections: Array<{ id: string; pattern: RegExp; label: string }> = [
        { id: "frontmatter", pattern: /^---\nname: [\w-]+\ndescription: /m, label: "YAML frontmatter (name + description)" },
        { id: "iron_law", pattern: /^\*\*IRON LAW — [A-Z]+:\*\* .+$/m, label: "Iron Law punchcard (<EXTREMELY-IMPORTANT> wrapper)" },
        { id: "hard_gate", pattern: /^## HARD-GATE$/m, label: "## HARD-GATE" },
        { id: "checklist", pattern: /^## Checklist$/m, label: "## Checklist" },
        { id: "completion_parameters", pattern: /^## Completion Parameters$/m, label: "## Completion Parameters" },
        { id: "shared_guidance", pattern: /^## Shared Stage Guidance$/m, label: "## Shared Stage Guidance" },
        { id: "good_vs_bad", pattern: /Good vs Bad/i, label: "Good vs Bad examples" },
        { id: "anti_patterns", pattern: /^## Anti-Patterns & Red Flags$/m, label: "## Anti-Patterns & Red Flags" }
      ];
      const missingSections = canonicalSections
        .filter((section) => !section.pattern.test(skillContent))
        .map((section) => section.label);
      checks.push({
        name: `skill:${stage}:canonical_sections`,
        ok: missingSections.length === 0,
        details:
          missingSections.length === 0
            ? `${skillPath} contains all canonical sections`
            : `${skillPath} missing sections: ${missingSections.join(", ")}`
      });
    }
  }

  // Meta-skill health — the using-cclaw routing brain must always contain the
  // signals that stage skills reference. When one of these drifts, every stage
  // citation breaks silently.
  const metaSkillPath = path.join(projectRoot, RUNTIME_ROOT, "skills", "using-cclaw", "SKILL.md");
  if (await exists(metaSkillPath)) {
    const metaContent = await fs.readFile(metaSkillPath, "utf8");
    const requiredSignals: Array<{ id: string; pattern: RegExp; label: string }> = [
      { id: "instruction_priority", pattern: /Instruction Priority/i, label: "Instruction Priority" },
      { id: "routing_flow", pattern: /Routing flow/i, label: "Routing flow" },
      { id: "task_classification", pattern: /Task classification/i, label: "Task classification" },
      { id: "stage_map", pattern: /Stage quick map/i, label: "Stage quick map" },
      { id: "protocol_refs", pattern: /Protocol references/i, label: "Protocol references" },
      { id: "knowledge_guidance", pattern: /Knowledge guidance/i, label: "Knowledge guidance" },
      { id: "failure_guardrails", pattern: /Failure guardrails/i, label: "Failure guardrails" }
    ];
    const missingMeta = requiredSignals
      .filter((signal) => !signal.pattern.test(metaContent))
      .map((signal) => signal.label);
    checks.push({
      name: "skill:meta:signals",
      ok: missingMeta.length === 0,
      details:
        missingMeta.length === 0
          ? `${metaSkillPath} contains all required routing signals`
          : `${metaSkillPath} missing signals: ${missingMeta.join(", ")}`
    });
  }

  // Harness tool-map references (A.1#4) must always be present — stage skills
  // cite the paths by name.
  const harnessRefDir = path.join(projectRoot, RUNTIME_ROOT, "references", "harness-tools");
  const harnessRefFiles = ["README.md", "claude.md", "cursor.md", "opencode.md", "codex.md"];
  for (const fileName of harnessRefFiles) {
    const refPath = path.join(harnessRefDir, fileName);
    checks.push({
      name: `harness_tool_ref:${fileName.replace(/\.md$/, "")}`,
      ok: await exists(refPath),
      details: refPath
    });
  }

  // Per-stage example references (A.2#8, progressive disclosure). Each stage
  // skill's Examples section points here; the file MUST exist or the pointer
  // is a dangling link.
  const stageRefDir = path.join(projectRoot, RUNTIME_ROOT, "references", "stages");
  for (const stage of FLOW_STAGES) {
    const refPath = path.join(stageRefDir, `${stage}-examples.md`);
    checks.push({
      name: `stage_examples_ref:${stage}`,
      ok: await exists(refPath),
      details: refPath
    });
  }
  checks.push({
    name: "harness_ref:matrix",
    ok: await exists(path.join(projectRoot, RUNTIME_ROOT, "references", "harnesses.md")),
    details: `${RUNTIME_ROOT}/references/harnesses.md`
  });

  const playbookDir = path.join(projectRoot, RUNTIME_ROOT, ...HARNESS_PLAYBOOKS_DIR.split("/"));
  checks.push({
    name: "harness_ref:playbooks_index",
    ok: await exists(path.join(playbookDir, "README.md")),
    details: `${RUNTIME_ROOT}/${HARNESS_PLAYBOOKS_DIR}/README.md`
  });

  const doctorRefDir = path.join(projectRoot, RUNTIME_ROOT, "references", "doctor");
  for (const fileName of Object.keys(DOCTOR_REFERENCE_MARKDOWN)) {
    const refPath = path.join(doctorRefDir, fileName);
    checks.push({
      name: `doctor_ref:${fileName.replace(/\.md$/, "")}`,
      ok: await exists(refPath),
      details: refPath
    });
  }

  checks.push({
    name: "gitignore:required_patterns",
    ok: await gitignoreHasRequiredPatterns(projectRoot),
    details: ".gitignore must include cclaw ignore block"
  });

  let configuredHarnesses: HarnessId[] = [];
  let parsedConfig: Awaited<ReturnType<typeof readConfig>> | null = null;
  try {
    const config = await readConfig(projectRoot);
    parsedConfig = config;
    configuredHarnesses = config.harnesses;
    checks.push({
      name: "config:valid",
      ok: true,
      details: `${RUNTIME_ROOT}/config.yaml parsed successfully`
    });
  } catch (error) {
    checks.push({
      name: "config:valid",
      ok: false,
      severity: error instanceof InvalidConfigError ? "error" : "warning",
      details: error instanceof Error ? error.message : "Invalid config"
    });
  }

  if (parsedConfig) {
    const advancedKeys = await detectAdvancedKeys(projectRoot).catch(() => new Set());
    const hasLegacyTddTestGlobs = advancedKeys.has("tddTestGlobs");
    const hasModernTddConfig = advancedKeys.has("tdd");
    checks.push({
      name: "warning:config:deprecated_tdd_test_globs",
      ok: !hasLegacyTddTestGlobs,
      details: hasLegacyTddTestGlobs
        ? hasModernTddConfig
          ? `warning: ${RUNTIME_ROOT}/config.yaml sets deprecated "tddTestGlobs" alongside "tdd.*"; "tdd.testPathPatterns" takes precedence. Remove legacy key.`
          : `warning: ${RUNTIME_ROOT}/config.yaml uses deprecated "tddTestGlobs". Migrate to "tdd.testPathPatterns".`
        : `no deprecated "tddTestGlobs" key detected in ${RUNTIME_ROOT}/config.yaml`
    });

    const expectedMode = parsedConfig.promptGuardMode === "strict" ? "strict" : "advisory";
    const promptGuardPath = path.join(projectRoot, RUNTIME_ROOT, "hooks", "prompt-guard.sh");
    let promptGuardModeOk = false;
    if (await exists(promptGuardPath)) {
      const promptGuardContent = await fs.readFile(promptGuardPath, "utf8");
      promptGuardModeOk = promptGuardContent.includes(`PROMPT_GUARD_MODE="${expectedMode}"`);
    }
    checks.push({
      name: "hook:prompt_guard:mode",
      ok: promptGuardModeOk,
      details: `${promptGuardPath} must match promptGuardMode=${expectedMode}`
    });

    if (parsedConfig.gitHookGuards === true) {
      const runtimePreCommit = path.join(projectRoot, RUNTIME_ROOT, "hooks", "git", "pre-commit.sh");
      const runtimePrePush = path.join(projectRoot, RUNTIME_ROOT, "hooks", "git", "pre-push.sh");
      const runtimeScriptsOk = (await exists(runtimePreCommit)) && (await exists(runtimePrePush));
      checks.push({
        name: "git_hooks:managed:runtime_scripts",
        ok: runtimeScriptsOk,
        details: `${RUNTIME_ROOT}/hooks/git/pre-commit.sh and pre-push.sh must exist when gitHookGuards=true`
      });

      const gitHooksDir = await resolveGitHooksDir(projectRoot);
      if (!gitHooksDir) {
        checks.push({
          name: "git_hooks:managed:relays",
          ok: true,
          details: "git repository not detected; relay hook check skipped"
        });
      } else {
        const preCommitHookPath = path.join(gitHooksDir, "pre-commit");
        const prePushHookPath = path.join(gitHooksDir, "pre-push");
        let relaysOk = false;
        if ((await exists(preCommitHookPath)) && (await exists(prePushHookPath))) {
          const preCommitHook = await fs.readFile(preCommitHookPath, "utf8");
          const prePushHook = await fs.readFile(prePushHookPath, "utf8");
          relaysOk =
            preCommitHook.includes("cclaw-managed-git-hook") &&
            prePushHook.includes("cclaw-managed-git-hook");
        }
        checks.push({
          name: "git_hooks:managed:relays",
          ok: relaysOk,
          details: `${path.relative(projectRoot, gitHooksDir)}/pre-commit and pre-push must contain managed relay marker`
        });
      }
    }
  }

  for (const harness of configuredHarnesses) {
    const adapter = HARNESS_ADAPTERS[harness];
    if (!adapter) {
      checks.push({
        name: `harness:${harness}:supported`,
        ok: false,
        details: `Unsupported harness "${harness}" in ${RUNTIME_ROOT}/config.yaml`
      });
      continue;
    }
    // For command-kind harnesses we check flat files; skill-kind (codex) is
    // validated in the codex-specific block below (`shim:codex:<name>:*`).
    if (adapter.shimKind === "command") {
      for (const shim of harnessShimFileNames()) {
        const shimPath = path.join(projectRoot, adapter.commandDir, shim);
        checks.push({
          name: `shim:${harness}:${shim.replace(".md", "")}`,
          ok: await exists(shimPath),
          details: shimPath
        });
      }
    }
    const playbookFile = path.join(
      projectRoot,
      RUNTIME_ROOT,
      ...HARNESS_PLAYBOOKS_DIR.split("/"),
      harnessPlaybookFileName(harness)
    );
    checks.push({
      name: `harness_ref:playbook:${harness}`,
      ok: await exists(playbookFile),
      details: `${RUNTIME_ROOT}/${HARNESS_PLAYBOOKS_DIR}/${harnessPlaybookFileName(harness)}`
    });
  }

  const agentsFile = path.join(projectRoot, "AGENTS.md");
  let agentsBlockOk = false;
  if (await exists(agentsFile)) {
    const content = await fs.readFile(agentsFile, "utf8");
    const hasMarkers = content.includes(CCLAW_MARKER_START) && content.includes(CCLAW_MARKER_END);
    const hasCcCommand = content.includes("/cc");
    const hasCcNext = content.includes("/cc-next");
    const hasCcIdeate = content.includes("/cc-ideate");
    const hasCcView = content.includes("/cc-view");
    const hasCcOps = content.includes("/cc-ops");
    const hasVerification = content.includes("Verification Discipline");
    const hasMinimalMarker = content.includes("intentionally minimal for cross-project use");
    const hasMetaSkillPointer = content.includes(".cclaw/skills/using-cclaw/SKILL.md");
    agentsBlockOk = hasMarkers
      && hasCcCommand
      && hasCcNext
      && hasCcIdeate
      && hasCcView
      && hasCcOps
      && hasVerification
      && hasMinimalMarker
      && hasMetaSkillPointer;
  }
  checks.push({
    name: "agents:cclaw_block",
    ok: agentsBlockOk,
    details: `${agentsFile} must contain the managed cclaw marker block with routing, verification, and minimal detail pointer`
  });

  // Utility commands — keep in sync with UTILITY_COMMANDS (src/constants.ts)
  for (const cmd of UTILITY_COMMANDS) {
    const cmdPath = path.join(projectRoot, RUNTIME_ROOT, "commands", `${cmd}.md`);
    checks.push({
      name: `utility_command:${cmd}`,
      ok: await exists(cmdPath),
      details: cmdPath
    });
  }

  // Utility skills
  for (const [folder, label] of [
    ["learnings", "learnings"],
    ["flow-ideate", "flow-ideate"],
    ["flow-tree", "flow-tree"],
    ["flow-diff", "flow-diff"],
    ["using-git-worktrees", "using-git-worktrees"],
    ["tdd-cycle-log", "tdd-cycle-log"],
    ["flow-retro", "flow-retro"],
    ["flow-compound", "flow-compound"],
    ["flow-rewind", "flow-rewind"],
    ["verification-before-completion", "verification-before-completion"],
    ["finishing-a-development-branch", "finishing-a-development-branch"],
    ["subagent-dev", "sdd"],
    ["parallel-dispatch", "parallel-agents"],
    ["session", "session"],
    ["using-cclaw", "meta-skill"]
  ] as const) {
    const skillPath = path.join(projectRoot, RUNTIME_ROOT, "skills", folder, "SKILL.md");
    checks.push({
      name: `utility_skill:${label}`,
      ok: await exists(skillPath),
      details: skillPath
    });
  }

  // Extended utility skills generated from utility skill map.
  for (const folder of UTILITY_SKILL_FOLDERS) {
    const skillPath = path.join(projectRoot, RUNTIME_ROOT, "skills", folder, "SKILL.md");
    checks.push({
      name: `utility_skill:${folder}`,
      ok: await exists(skillPath),
      details: skillPath
    });
  }

  // Opt-in language rule packs: only check presence for packs the user enabled.
  // Canonical location is .cclaw/rules/lang/<pack>.md.
  for (const pack of parsedConfig?.languageRulePacks ?? []) {
    const fileName = LANGUAGE_RULE_PACK_FILES[pack];
    if (!fileName) continue;
    const packPath = path.join(projectRoot, RUNTIME_ROOT, ...LANGUAGE_RULE_PACK_DIR, fileName);
    checks.push({
      name: `language_rule_pack:${pack}`,
      ok: await exists(packPath),
      details: packPath
    });
  }

  // Drift: legacy per-language skill folders from v0.7.0 must not coexist with
  // the new rules/lang/ layout. `cclaw sync` removes them on the next run.
  for (const legacyFolder of LEGACY_LANGUAGE_RULE_PACK_FOLDERS) {
    const legacyPath = path.join(projectRoot, RUNTIME_ROOT, "skills", legacyFolder);
    const legacyPresent = await exists(legacyPath);
    checks.push({
      name: `language_rule_pack:no_legacy:${legacyFolder}`,
      ok: !legacyPresent,
      details: legacyPresent
        ? `legacy ${legacyPath} must be removed — language packs moved to ${RUNTIME_ROOT}/${LANGUAGE_RULE_PACK_DIR.join("/")}/. Run \`cclaw sync\`.`
        : `no legacy ${legacyFolder} skill folder`
    });
  }

  // Agent definition files
  for (const agent of CCLAW_AGENTS) {
    const agentPath = path.join(projectRoot, RUNTIME_ROOT, "agents", `${agent.name}.md`);
    let agentOk = await exists(agentPath);
    if (agentOk) {
      const content = await fs.readFile(agentPath, "utf8");
      agentOk = content.includes(`name: ${agent.name}`) && content.includes("tools:");
    }
    checks.push({
      name: `agent:${agent.name}`,
      ok: agentOk,
      details: agentPath
    });
  }

  // Hook scripts
  for (const script of [
    "_lib.sh",
    "session-start.sh",
    "stop-checkpoint.sh",
    "run-hook.cmd",
    "stage-complete.sh",
    "pre-compact.sh",
    "prompt-guard.sh",
    "workflow-guard.sh",
    "context-monitor.sh"
  ]) {
    const scriptPath = path.join(projectRoot, RUNTIME_ROOT, "hooks", script);
    const scriptExists = await exists(scriptPath);
    checks.push({
      name: `hook:script:${script}`,
      ok: scriptExists,
      details: scriptPath
    });
    if (scriptExists) {
      let executable = false;
      try {
        const stat = await fs.stat(scriptPath);
        executable = (stat.mode & 0o111) !== 0;
      } catch {
        executable = false;
      }
      checks.push({
        name: `hook:script:${script}:executable`,
        ok: executable,
        details: `${scriptPath} must be executable`
      });
    }
  }

  // Hook JSON files per harness. OpenCode ships hooks through its plugin
  // system (covered below). Codex joined the managed list in v0.40.0 — Codex
  // CLI ≥ v0.114 consumes `.codex/hooks.json` behind the `codex_hooks`
  // feature flag.
  const hookPaths: Record<string, string> = {
    claude: ".claude/hooks/hooks.json",
    cursor: ".cursor/hooks.json",
    codex: ".codex/hooks.json"
  };
  for (const harness of configuredHarnesses) {
    const hp = hookPaths[harness];
    if (!hp && harness !== "opencode") {
      checks.push({
        name: `hook:json:${harness}`,
        ok: false,
        details: `Unsupported harness "${harness}" in ${RUNTIME_ROOT}/config.yaml`
      });
      continue;
    }
    if (hp) {
      const fullPath = path.join(projectRoot, hp);
      const parsed = await readHookDocument(fullPath);
      const hookOk = !!(parsed && typeof parsed.hooks === "object" && parsed.hooks !== null);
      checks.push({
        name: `hook:json:${harness}`,
        ok: hookOk,
        details: fullPath
      });
      if (harness === "claude" || harness === "cursor" || harness === "codex") {
        const schema = validateHookDocument(harness, parsed);
        checks.push({
          name: `hook:schema:${harness}`,
          ok: schema.ok,
          details: schema.ok
            ? `${fullPath} matches cclaw hook schema v1`
            : `${fullPath} schema issues: ${schema.errors.join("; ")}`
        });
      }
    }
  }

  // OpenCode plugin source + deployed path
  checks.push({
    name: "hook:opencode_plugin_source",
    ok: await exists(path.join(projectRoot, RUNTIME_ROOT, "hooks", "opencode-plugin.mjs")),
    details: `${RUNTIME_ROOT}/hooks/opencode-plugin.mjs`
  });
  const opencodeEnabled = configuredHarnesses.includes("opencode");
  const opencodeDeployed = await exists(path.join(projectRoot, ".opencode/plugins/cclaw-plugin.mjs"));
  checks.push({
    name: "hook:opencode_plugin_deployed",
    ok: opencodeEnabled ? opencodeDeployed : true,
    details: opencodeEnabled
      ? ".opencode/plugins/cclaw-plugin.mjs"
      : "opencode harness disabled; deployed plugin check skipped"
  });

  if (configuredHarnesses.includes("claude")) {
    const file = path.join(projectRoot, ".claude/hooks/hooks.json");
    const parsed = await readHookDocument(file);
    const hooks = toObject(parsed?.hooks) ?? {};
    const sessionStart = hooks.SessionStart;
    const ok = JSON.stringify(sessionStart ?? "").includes("startup|resume|clear|compact");
    checks.push({
      name: "lifecycle:claude:rehydration_matcher",
      ok,
      details: `${file} must include SessionStart matcher startup|resume|clear|compact`
    });

    const sessionCommands = collectHookCommands(hooks.SessionStart);
    const preCommands = collectHookCommands(hooks.PreToolUse);
    const postCommands = collectHookCommands(hooks.PostToolUse);
    const stopCommands = collectHookCommands(hooks.Stop);
    const wiringOk =
      sessionCommands.some((cmd) => cmd.includes("session-start.sh")) &&
      preCommands.some((cmd) => cmd.includes("prompt-guard.sh")) &&
      preCommands.some((cmd) => cmd.includes("workflow-guard.sh")) &&
      postCommands.some((cmd) => cmd.includes("context-monitor.sh")) &&
      stopCommands.some((cmd) => cmd.includes("stop-checkpoint.sh"));
    checks.push({
      name: "hook:wiring:claude",
      ok: wiringOk,
      details: `${file} must wire session-start/prompt-guard/workflow-guard/context-monitor/stop-checkpoint`
    });
  }

  if (configuredHarnesses.includes("cursor")) {
    const file = path.join(projectRoot, ".cursor/hooks.json");
    const parsed = await readHookDocument(file);
    const hooks = toObject(parsed?.hooks) ?? {};
    const hasLifecycleKeys =
      Array.isArray(hooks.sessionStart) &&
      Array.isArray(hooks.sessionResume) &&
      Array.isArray(hooks.sessionClear) &&
      Array.isArray(hooks.sessionCompact);
    checks.push({
      name: "lifecycle:cursor:rehydration_events",
      ok: hasLifecycleKeys,
      details: `${file} must include sessionStart/sessionResume/sessionClear/sessionCompact hooks`
    });

    const sessionCommands = [
      ...collectHookCommands(hooks.sessionStart),
      ...collectHookCommands(hooks.sessionResume),
      ...collectHookCommands(hooks.sessionClear),
      ...collectHookCommands(hooks.sessionCompact)
    ];
    const preCommands = collectHookCommands(hooks.preToolUse);
    const postCommands = collectHookCommands(hooks.postToolUse);
    const stopCommands = collectHookCommands(hooks.stop);
    const wiringOk =
      sessionCommands.some((cmd) => cmd.includes("session-start.sh")) &&
      preCommands.some((cmd) => cmd.includes("prompt-guard.sh")) &&
      preCommands.some((cmd) => cmd.includes("workflow-guard.sh")) &&
      postCommands.some((cmd) => cmd.includes("context-monitor.sh")) &&
      stopCommands.some((cmd) => cmd.includes("stop-checkpoint.sh"));
    checks.push({
      name: "hook:wiring:cursor",
      ok: wiringOk,
      details: `${file} must wire session-start/prompt-guard/workflow-guard/context-monitor/stop-checkpoint`
    });

    const cursorRulePath = path.join(projectRoot, ".cursor/rules/cclaw-workflow.mdc");
    let cursorRuleOk = false;
    if (await exists(cursorRulePath)) {
      const content = await fs.readFile(cursorRulePath, "utf8");
      cursorRuleOk =
        content.includes("cclaw-managed-cursor-workflow-rule") &&
        content.includes(".cclaw/state/flow-state.json") &&
        content.includes("/cc-next");
    }
    checks.push({
      name: "rules:cursor:workflow",
      ok: cursorRuleOk,
      details: `${cursorRulePath} must include managed marker and core cclaw workflow guardrails`
    });
  }

  if (configuredHarnesses.includes("codex")) {
    // Codex CLI has no custom slash-command discovery (`.codex/commands/*`
    // was never read, even historically). cclaw ships codex entry points
    // as skills under `.agents/skills/cc*/SKILL.md`; Codex v0.114+ also
    // supports lifecycle hooks at `.codex/hooks.json` (gated by the
    // `codex_hooks` feature flag in `~/.codex/config.toml`).
    const skillsRoot = path.join(projectRoot, ".agents/skills");
    for (const skillName of harnessShimSkillNames()) {
      const skillPath = path.join(skillsRoot, skillName, "SKILL.md");
      let ok = false;
      let frontmatterOk = false;
      if (await exists(skillPath)) {
        ok = true;
        const content = await fs.readFile(skillPath, "utf8");
        frontmatterOk = new RegExp(`^---[\\s\\S]*?\\nname: ${skillName}\\b`, "u").test(content);
      }
      checks.push({
        name: `shim:codex:${skillName}:present`,
        ok,
        details: skillPath
      });
      checks.push({
        name: `shim:codex:${skillName}:frontmatter`,
        ok: frontmatterOk,
        details: frontmatterOk
          ? `${skillPath} has \`name: ${skillName}\` frontmatter`
          : ok
            ? `${skillPath} present but \`name: ${skillName}\` frontmatter is missing`
            : `${skillPath} absent; cannot validate frontmatter`
      });
    }

    // Hook wiring: the generated `.codex/hooks.json` must reference every
    // runtime script cclaw needs. Separate from the schema check above;
    // schema covers structure, this check covers semantic wiring.
    const codexHooksFile = path.join(projectRoot, ".codex/hooks.json");
    const codexDoc = await readHookDocument(codexHooksFile);
    const codexHooks = toObject(codexDoc?.hooks) ?? {};
    const codexSessionCmds = collectHookCommands(codexHooks.SessionStart);
    const codexUserPromptCmds = collectHookCommands(codexHooks.UserPromptSubmit);
    const codexPreCmds = collectHookCommands(codexHooks.PreToolUse);
    const codexPostCmds = collectHookCommands(codexHooks.PostToolUse);
    const codexStopCmds = collectHookCommands(codexHooks.Stop);
    const codexWiringOk =
      codexSessionCmds.some((cmd) => cmd.includes("session-start.sh")) &&
      codexUserPromptCmds.some((cmd) => cmd.includes("prompt-guard.sh")) &&
      codexUserPromptCmds.some((cmd) => cmd.includes("workflow-guard.sh")) &&
      codexUserPromptCmds.some((cmd) => cmd.includes("verify-current-state")) &&
      codexPreCmds.some((cmd) => cmd.includes("prompt-guard.sh")) &&
      codexPreCmds.some((cmd) => cmd.includes("workflow-guard.sh")) &&
      codexPostCmds.some((cmd) => cmd.includes("context-monitor.sh")) &&
      codexStopCmds.some((cmd) => cmd.includes("stop-checkpoint.sh"));
    checks.push({
      name: "hook:wiring:codex",
      ok: codexWiringOk,
      details: `${codexHooksFile} must wire SessionStart, UserPromptSubmit(prompt/workflow/verify-current-state), PreToolUse(prompt/workflow), PostToolUse(context-monitor), and Stop(stop-checkpoint). PreToolUse/PostToolUse run Bash-only in Codex v0.114+`
    });

    // Feature flag warning: Codex ignores `.codex/hooks.json` unless the
    // user has `[features] codex_hooks = true` in `~/.codex/config.toml`.
    // Advisory warning — not a hard failure, because the skills still
    // work without the flag.
    const codexConfig = codexConfigPath();
    let featureFlagNote = "";
    try {
      const content = await readCodexConfig(codexConfig);
      const state = classifyCodexHooksFlag(content);
      featureFlagNote =
        state === "enabled"
          ? `codex_hooks feature flag is enabled in ${codexConfig}`
          : state === "missing-file"
            ? `warning: ${codexConfig} does not exist; .codex/hooks.json will be ignored until you create it with \`[features]\\ncodex_hooks = true\\n\`.`
            : state === "missing-section"
              ? `warning: ${codexConfig} has no [features] section; add \`[features]\\ncodex_hooks = true\\n\` to enable cclaw hooks.`
              : state === "missing-key"
                ? `warning: ${codexConfig} is missing the codex_hooks key under [features]. Add \`codex_hooks = true\` to enable cclaw hooks.`
                : `warning: ${codexConfig} sets codex_hooks to a non-true value; set \`codex_hooks = true\` under [features] to enable cclaw hooks.`;
    } catch (err) {
      featureFlagNote = `warning: could not read ${codexConfig}: ${err instanceof Error ? err.message : String(err)}`;
    }
    checks.push({
      name: "warning:codex:feature_flag",
      ok: true,
      details: featureFlagNote
    });

    // Legacy `.codex/commands/*` must not linger from older cclaw installs.
    // (The `.codex/hooks.json` path is now managed and is validated above,
    // so there is no longer a legacy_hooks_json warning.)
    const legacyCommandsDir = path.join(projectRoot, ".codex/commands");
    const legacyCommandsPresent = await exists(legacyCommandsDir);
    checks.push({
      name: "warning:codex:legacy_commands_dir",
      ok: true,
      details: legacyCommandsPresent
        ? `warning: ${legacyCommandsDir} still present; Codex never consumed this directory — run \`cclaw sync\` to remove it.`
        : `no legacy ${legacyCommandsDir} detected`
    });

    // Legacy v0.39.x skill layout under `.agents/skills/cclaw-cc*/`
    // must have been removed — cclaw sync deletes these automatically,
    // but flag leftovers so users notice an upgrade issue.
    const legacyCodexSkills: string[] = [];
    try {
      const entries = await fs.readdir(skillsRoot);
      for (const entry of entries) {
        if (/^cclaw-cc(?:-.*)?$/u.test(entry)) {
          legacyCodexSkills.push(entry);
        }
      }
    } catch {
      // skills root absent; nothing to warn about
    }
    checks.push({
      name: "warning:codex:legacy_cclaw_cc_skills",
      ok: legacyCodexSkills.length === 0,
      details: legacyCodexSkills.length === 0
        ? `no legacy cclaw-cc* skill folders detected under .agents/skills/`
        : `warning: legacy skill folders from cclaw v0.39.x present (${legacyCodexSkills.join(", ")}); run \`cclaw sync\` to remove them.`
    });
  }

  if (configuredHarnesses.includes("opencode")) {
    const file = path.join(projectRoot, ".opencode/plugins/cclaw-plugin.mjs");
    let ok = false;
    let singleHandlerPathOk = false;
    let precompactHookOk = false;
    if (await exists(file)) {
      const content = await fs.readFile(file, "utf8");
      ok =
        content.includes("event: async") &&
        content.includes('"tool.execute.before"') &&
        content.includes('"tool.execute.after"') &&
        content.includes("prompt-guard.sh") &&
        content.includes("workflow-guard.sh") &&
        content.includes("context-monitor.sh") &&
        content.includes("pre-compact.sh") &&
        content.includes('"session.created"') &&
        content.includes('"session.idle"') &&
        content.includes('"session.resumed"') &&
        content.includes('"session.compacted"') &&
        content.includes('"session.cleared"') &&
        content.includes('"session.updated"') &&
        content.includes('"experimental.chat.system.transform"');
      singleHandlerPathOk =
        !content.includes('eventType === "tool.execute.before"') &&
        !content.includes('eventType === "tool.execute.after"') &&
        content.includes('"tool.execute.before": async') &&
        content.includes('"tool.execute.after": async');
      precompactHookOk =
        content.includes('eventType === "session.compacted"') &&
        content.includes('runHookScript("pre-compact.sh"');
    }
    checks.push({
      name: "lifecycle:opencode:rehydration_events",
      ok,
      details: `${file} must include event lifecycle handler, session.created/updated/resumed/cleared/compacted rehydration, tool.execute.before/after with prompt/workflow/context hooks, session.idle checkpoint, and transform rehydration`
    });
    checks.push({
      name: "hook:opencode:single_tool_handler_path",
      ok: singleHandlerPathOk,
      details: `${file} must route tool.execute.before/after through dedicated handlers exactly once (no duplicate event() branches).`
    });
    checks.push({
      name: "hook:opencode:precompact_digest",
      ok: precompactHookOk,
      details: `${file} must run pre-compact.sh on session.compacted before bootstrap refresh.`
    });
    const runtimeShape = await opencodePluginRuntimeShapeCheck(projectRoot);
    checks.push({
      name: "hook:opencode:runtime_shape",
      ok: runtimeShape.ok,
      details: runtimeShape.details
    });
    const registration = await opencodeRegistrationCheck(projectRoot);
    checks.push({
      name: "hook:opencode:config_registration",
      ok: registration.ok,
      details: registration.details
    });
  }

  const hasBash = await commandAvailable("bash");
  const hasNode = await commandAvailable("node");
  const hasPython = await commandAvailable("python3");
  const hasJq = await commandAvailable("jq");
  checks.push({
    name: "capability:required:bash",
    ok: hasBash,
    details: "bash is required to execute cclaw hook scripts"
  });
  checks.push({
    name: "capability:required:node",
    ok: hasNode,
    details: "node is required for cclaw runtime scripts and CLI wiring"
  });
  checks.push({
    name: "capability:runtime:json_parser",
    ok: hasPython || hasJq,
    details: "at least one of python3 or jq must be available for hook JSON parsing fallbacks"
  });
  checks.push({
    name: "warning:capability:jq",
    ok: true,
    details: hasJq ? "jq available" : "warning: jq not found, python/node fallbacks will be used"
  });
  checks.push({
    name: "warning:capability:python3",
    ok: true,
    details: hasPython ? "python3 available" : "warning: python3 not found, jq/node paths must stay healthy"
  });

  // Knowledge store exists (canonical JSONL, no markdown mirror)
  checks.push({
    name: "knowledge:store_exists",
    ok: await exists(path.join(projectRoot, RUNTIME_ROOT, "knowledge.jsonl")),
    details: `${RUNTIME_ROOT}/knowledge.jsonl must exist`
  });
  checks.push({
    name: "knowledge:digest_exists",
    ok: await exists(path.join(projectRoot, RUNTIME_ROOT, "state", "knowledge-digest.md")),
    details: `${RUNTIME_ROOT}/state/knowledge-digest.md must exist`
  });

  // There must be NO legacy markdown knowledge store — JSONL is the only store.
  const legacyKnowledgeMdPath = path.join(projectRoot, RUNTIME_ROOT, "knowledge.md");
  const legacyExists = await exists(legacyKnowledgeMdPath);
  checks.push({
    name: "knowledge:no_legacy_markdown",
    ok: !legacyExists,
    details: legacyExists
      ? `legacy ${RUNTIME_ROOT}/knowledge.md must be removed — cclaw is JSONL-native`
      : `no legacy markdown store present`
  });
  const knowledgePath = path.join(projectRoot, RUNTIME_ROOT, "knowledge.jsonl");
  if (await exists(knowledgePath)) {
    let malformedKnowledgeLines = 0;
    let missingSchemaV2Fields = 0;
    let parsedKnowledgeLines = 0;
    let lowConfidenceLines = 0;
    let staleRawEntries = 0;
    const triggerActionCounts = new Map<string, number>();
    // Stale threshold for raw entries: ~90 days with no re-observation.
    // Chosen to match the compound drift checklist language; anything newer is
    // recent enough to trust, anything older deserves a curate/supersede pass.
    const STALE_RAW_THRESHOLD_MS = 90 * 24 * 60 * 60 * 1000;
    const now = Date.now();
    const requiredV2Fields = [
      "type",
      "trigger",
      "action",
      "confidence",
      "domain",
      "stage",
      "origin_stage",
      "origin_feature",
      "frequency",
      "universality",
      "maturity",
      "created",
      "first_seen_ts",
      "last_seen_ts",
      "project"
    ];
    try {
      const raw = await fs.readFile(knowledgePath, "utf8");
      const lines = raw
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.length > 0);
      for (const line of lines) {
        try {
          const parsed = JSON.parse(line) as Record<string, unknown>;
          if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
            malformedKnowledgeLines += 1;
            continue;
          }
          parsedKnowledgeLines += 1;
          const confidence = typeof parsed.confidence === "string" ? parsed.confidence.toLowerCase() : "";
          if (confidence === "low") {
            lowConfidenceLines += 1;
          }
          const trigger = typeof parsed.trigger === "string" ? parsed.trigger.trim().toLowerCase() : "";
          const action = typeof parsed.action === "string" ? parsed.action.trim().toLowerCase() : "";
          if (trigger.length > 0 && action.length > 0) {
            const key = `${trigger} => ${action}`;
            triggerActionCounts.set(key, (triggerActionCounts.get(key) ?? 0) + 1);
          }
          const missing = requiredV2Fields.some((field) => !Object.prototype.hasOwnProperty.call(parsed, field));
          if (missing) {
            missingSchemaV2Fields += 1;
          }
          const maturity = typeof parsed.maturity === "string" ? parsed.maturity.toLowerCase() : "";
          const lastSeenRaw = typeof parsed.last_seen_ts === "string" ? parsed.last_seen_ts : "";
          if (maturity === "raw" && lastSeenRaw.length > 0) {
            const lastSeenMs = Date.parse(lastSeenRaw);
            if (Number.isFinite(lastSeenMs) && now - lastSeenMs > STALE_RAW_THRESHOLD_MS) {
              staleRawEntries += 1;
            }
          }
        } catch {
          malformedKnowledgeLines += 1;
        }
      }
    } catch {
      malformedKnowledgeLines += 1;
    }
    checks.push({
      name: "knowledge:jsonl_parseable",
      ok: malformedKnowledgeLines === 0,
      details:
        malformedKnowledgeLines === 0
          ? "knowledge.jsonl lines parse as JSON objects"
          : `knowledge.jsonl contains ${malformedKnowledgeLines} malformed line(s)`
    });
    checks.push({
      name: "warning:knowledge:schema_v2_fields",
      ok: true,
      details:
        parsedKnowledgeLines === 0
          ? "knowledge.jsonl is empty"
          : missingSchemaV2Fields === 0
            ? `all ${parsedKnowledgeLines} knowledge line(s) include schema v2 fields`
            : `warning: ${missingSchemaV2Fields}/${parsedKnowledgeLines} knowledge line(s) miss schema v2 fields (origin/maturity/frequency metadata)`
    });
    const lowConfidenceRatio = parsedKnowledgeLines === 0 ? 0 : lowConfidenceLines / parsedKnowledgeLines;
    checks.push({
      name: "warning:knowledge:low_confidence_density",
      ok: true,
      details:
        parsedKnowledgeLines === 0
          ? "knowledge.jsonl is empty"
          : lowConfidenceRatio <= 0.35
            ? `low-confidence entries: ${lowConfidenceLines}/${parsedKnowledgeLines}`
            : `warning: low-confidence entries are high (${lowConfidenceLines}/${parsedKnowledgeLines}, ${(lowConfidenceRatio * 100).toFixed(1)}%). Consider /cc-learn curate before adding more.`
    });
    const repeatedClusters = [...triggerActionCounts.entries()].filter(([, count]) => count >= 3);
    checks.push({
      name: "warning:knowledge:repeat_clusters",
      ok: true,
      details:
        repeatedClusters.length === 0
          ? "no high-frequency repeated trigger/action clusters detected"
          : `warning: ${repeatedClusters.length} repeated learning cluster(s) detected (>=3 repeats). Consider /cc-ops compound to lift them into rules/skills.`
    });
    checks.push({
      name: "warning:knowledge:stale_raw_entries",
      ok: true,
      details:
        parsedKnowledgeLines === 0
          ? "knowledge.jsonl is empty"
          : staleRawEntries === 0
            ? `no raw knowledge entries older than 90 days`
            : `warning: ${staleRawEntries} raw knowledge entry(ies) have last_seen_ts older than 90 days. Run /cc-learn curate or append a superseding entry before the next /cc-ops compound pass.`
    });
  }

  checks.push({
    name: "state:checkpoint_exists",
    ok: await exists(path.join(projectRoot, RUNTIME_ROOT, "state", "checkpoint.json")),
    details: `${RUNTIME_ROOT}/state/checkpoint.json must exist`
  });
  checks.push({
    name: "state:stage_activity_exists",
    ok: await exists(path.join(projectRoot, RUNTIME_ROOT, "state", "stage-activity.jsonl")),
    details: `${RUNTIME_ROOT}/state/stage-activity.jsonl must exist`
  });
  const stageActivityPath = path.join(projectRoot, RUNTIME_ROOT, "state", "stage-activity.jsonl");
  if (await exists(stageActivityPath)) {
    let malformedActivityLines = 0;
    let missingSchemaVersion = 0;
    let parsedActivityLines = 0;
    try {
      const raw = await fs.readFile(stageActivityPath, "utf8");
      const lines = raw
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.length > 0);
      for (const line of lines) {
        try {
          const parsed = JSON.parse(line) as Record<string, unknown>;
          if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
            malformedActivityLines += 1;
            continue;
          }
          parsedActivityLines += 1;
          if (parsed.schemaVersion !== 1) {
            missingSchemaVersion += 1;
          }
        } catch {
          malformedActivityLines += 1;
        }
      }
    } catch {
      malformedActivityLines += 1;
    }
    checks.push({
      name: "state:stage_activity_jsonl_parseable",
      ok: malformedActivityLines === 0,
      details:
        malformedActivityLines === 0
          ? "stage-activity.jsonl lines parse as JSON objects"
          : `stage-activity.jsonl contains ${malformedActivityLines} malformed line(s)`
    });
    checks.push({
      name: "warning:state:stage_activity_schema_version",
      ok: true,
      details:
        parsedActivityLines === 0
          ? "stage-activity.jsonl is empty"
          : missingSchemaVersion === 0
            ? `all ${parsedActivityLines} stage-activity line(s) include schemaVersion=1`
            : `warning: ${missingSchemaVersion}/${parsedActivityLines} stage-activity line(s) missing schemaVersion=1`
    });
  }
  checks.push({
    name: "state:suggestion_memory_exists",
    ok: await exists(path.join(projectRoot, RUNTIME_ROOT, "state", "suggestion-memory.json")),
    details: `${RUNTIME_ROOT}/state/suggestion-memory.json must exist for proactive suggestion memory`
  });
  checks.push({
    name: "state:harness_gaps_exists",
    ok: await exists(path.join(projectRoot, RUNTIME_ROOT, "state", "harness-gaps.json")),
    details: `${RUNTIME_ROOT}/state/harness-gaps.json must exist for tiered harness capability tracking`
  });
  const adapterManifestPath = path.join(projectRoot, RUNTIME_ROOT, "adapters", "manifest.json");
  const adapterManifestExists = await exists(adapterManifestPath);
  checks.push({
    name: "state:adapter_manifest_exists",
    ok: adapterManifestExists,
    details: `${RUNTIME_ROOT}/adapters/manifest.json must exist for harness adapter provenance`
  });
  if (adapterManifestExists) {
    let harnessesOk = false;
    let harnessesDetails = "";
    let sourcesOk = false;
    let sourcesDetails = "";
    try {
      const parsed = JSON.parse(await fs.readFile(adapterManifestPath, "utf8")) as {
        harnesses?: unknown;
        commandSource?: unknown;
        skillSource?: unknown;
      };
      const manifestHarnesses =
        Array.isArray(parsed.harnesses)
          ? parsed.harnesses.filter((entry): entry is string => typeof entry === "string")
          : [];
      const expectedHarnesses =
        configuredHarnesses.length > 0
          ? [...new Set(configuredHarnesses)].sort()
          : null;
      const actualHarnesses = [...new Set(manifestHarnesses)].sort();
      harnessesOk = expectedHarnesses
        ? actualHarnesses.length === expectedHarnesses.length &&
          actualHarnesses.every((harness, index) => harness === expectedHarnesses[index])
        : actualHarnesses.length > 0;
      harnessesDetails = expectedHarnesses
        ? harnessesOk
          ? `adapter manifest harnesses match config.yaml: ${actualHarnesses.join(", ")}`
          : `adapter manifest harnesses [${actualHarnesses.join(", ")}] do not match config.yaml [${expectedHarnesses.join(", ")}]`
        : harnessesOk
          ? `adapter manifest declares harnesses: ${actualHarnesses.join(", ")}`
          : "adapter manifest must declare at least one harness";
      const commandSource = typeof parsed.commandSource === "string" ? parsed.commandSource.trim() : "";
      const skillSource = typeof parsed.skillSource === "string" ? parsed.skillSource.trim() : "";
      sourcesOk = commandSource.length > 0 && skillSource.length > 0;
      sourcesDetails = sourcesOk
        ? `adapter manifest source globs are set (commandSource=${commandSource}; skillSource=${skillSource})`
        : "adapter manifest must include non-empty commandSource and skillSource";
    } catch {
      harnessesOk = false;
      harnessesDetails = "adapter manifest must be valid JSON with a harnesses array";
      sourcesOk = false;
      sourcesDetails = "adapter manifest must be valid JSON with source globs";
    }
    checks.push({
      name: "state:adapter_manifest_harnesses",
      ok: harnessesOk,
      details: harnessesDetails
    });
    checks.push({
      name: "state:adapter_manifest_sources",
      ok: sourcesOk,
      details: sourcesDetails
    });
  }
  const contextModeStatePath = path.join(projectRoot, RUNTIME_ROOT, "state", "context-mode.json");
  checks.push({
    name: "state:context_mode_exists",
    ok: await exists(contextModeStatePath),
    details: `${RUNTIME_ROOT}/state/context-mode.json must exist for context mode switching`
  });
  if (await exists(contextModeStatePath)) {
    let contextModeOk = false;
    try {
      const parsed = JSON.parse(await fs.readFile(contextModeStatePath, "utf8")) as Record<string, unknown>;
      const activeMode = typeof parsed.activeMode === "string" ? parsed.activeMode : "";
      contextModeOk = activeMode.length > 0 && Object.prototype.hasOwnProperty.call(CONTEXT_MODES, activeMode);
    } catch {
      contextModeOk = false;
    }
    checks.push({
      name: "state:context_mode_valid",
      ok: contextModeOk,
      details: `${RUNTIME_ROOT}/state/context-mode.json must reference one of: ${Object.keys(CONTEXT_MODES).join(", ")} (default=${DEFAULT_CONTEXT_MODE})`
    });
  }
  for (const mode of Object.keys(CONTEXT_MODES)) {
    const modePath = path.join(projectRoot, RUNTIME_ROOT, "contexts", `${mode}.md`);
    checks.push({
      name: `contexts:mode:${mode}`,
      ok: await exists(modePath),
      details: modePath
    });
  }

  await ensureFeatureSystem(projectRoot, { repair: false });
  const activeFeature = await readActiveFeature(projectRoot, { repair: false });
  let flowState = createInitialFlowState();
  let flowStateCorruptError: CorruptFlowStateError | null = null;
  try {
    flowState = await readFlowState(projectRoot, { repairFeatureSystem: false });
  } catch (error) {
    if (error instanceof CorruptFlowStateError) {
      flowStateCorruptError = error;
      checks.push({
        name: "flow_state:readable",
        ok: false,
        severity: "error",
        details: error.message
      });
    } else {
      throw error;
    }
  }
  if (options.reconcileCurrentStageGates === true && !flowStateCorruptError) {
    const reconciliation = await reconcileAndWriteCurrentStageGateCatalog(projectRoot);
    if (reconciliation.wrote) {
      flowState = {
        ...flowState,
        stageGateCatalog: {
          ...flowState.stageGateCatalog,
          [reconciliation.stage]: reconciliation.after
        }
      };
    }
    checks.push({
      name: "gates:reconcile:writeback",
      ok: true,
      details: reconciliation.wrote
        ? `reconciled gate catalog for stage "${reconciliation.stage}": ${reconciliation.notes.join("; ")}`
        : `no gate reconciliation changes needed for stage "${reconciliation.stage}"`
    });
  } else if (options.reconcileCurrentStageGates === true && flowStateCorruptError) {
    checks.push({
      name: "gates:reconcile:writeback",
      ok: false,
      details: "skipped gate reconciliation because flow-state.json is corrupt"
    });
  }
  const activeRunId = typeof flowState.activeRunId === "string" ? flowState.activeRunId.trim() : "";
  checks.push({
    name: "flow_state:active_run_id",
    ok: activeRunId.length > 0,
    details: `${RUNTIME_ROOT}/state/flow-state.json must include activeRunId`
  });
  const sensitivePermissionTargets = [
    path.join(projectRoot, RUNTIME_ROOT, "state", "flow-state.json"),
    path.join(projectRoot, RUNTIME_ROOT, "state", "delegation-log.json"),
    path.join(projectRoot, RUNTIME_ROOT, "state", "reconciliation-notices.json"),
    path.join(projectRoot, RUNTIME_ROOT, "state", "worktrees.json"),
    path.join(projectRoot, RUNTIME_ROOT, "state", "active-feature.json"),
    path.join(projectRoot, RUNTIME_ROOT, "knowledge.jsonl")
  ];
  const permissiveStateFiles: string[] = [];
  for (const targetPath of sensitivePermissionTargets) {
    const bits = await readPermissionBits(targetPath);
    if (bits === null) continue;
    if (bits > 0o640) {
      permissiveStateFiles.push(`${path.relative(projectRoot, targetPath)}:${bits.toString(8)}`);
    }
  }
  checks.push({
    name: "warning:state:file_permissions",
    ok: true,
    details: permissiveStateFiles.length === 0
      ? "sensitive state files are <=0640 permissions"
      : `warning: sensitive state files are overly permissive (${permissiveStateFiles.join(", ")}). Run \`chmod 600 .cclaw/state/*.json .cclaw/state/*.jsonl .cclaw/knowledge.jsonl\` if this machine is multi-user.`
  });
  const reconciliationNotices = await readReconciliationNotices(projectRoot);
  checks.push({
    name: "state:reconciliation_notices_parse",
    ok: reconciliationNotices.parseOk && reconciliationNotices.schemaOk,
    details: !reconciliationNotices.parseOk
      ? `unable to parse ${RECONCILIATION_NOTICES_REL_PATH}; reset with \`cclaw sync\` or repair JSON by hand`
      : !reconciliationNotices.schemaOk
        ? `${RECONCILIATION_NOTICES_REL_PATH} schemaVersion mismatch; expected ${reconciliationNotices.schemaVersion}`
        : `${RECONCILIATION_NOTICES_REL_PATH} parsed successfully`
  });
  const noticeBuckets = classifyReconciliationNotices(flowState, reconciliationNotices.notices);
  const formatNoticeList = (items: typeof noticeBuckets.activeBlocked): string =>
    items
      .slice(0, 8)
      .map((notice) => `${notice.stage}.${notice.gateId}`)
      .join(", ");
  checks.push({
    name: "state:reconciliation_notices",
    ok: noticeBuckets.unsynced.length === 0,
    details: noticeBuckets.unsynced.length > 0
      ? `reconciliation notices out of sync in ${RECONCILIATION_NOTICES_REL_PATH}: ${formatNoticeList(noticeBuckets.unsynced)}. Run \`cclaw doctor --reconcile-gates\` to resync and clear stale entries.`
      : noticeBuckets.currentStageBlocked.length > 0
        ? `active reconciliation notices for current stage "${flowState.currentStage}": ${formatNoticeList(noticeBuckets.currentStageBlocked)}`
        : noticeBuckets.activeBlocked.length > 0
          ? `active reconciliation notices for run "${flowState.activeRunId}": ${formatNoticeList(noticeBuckets.activeBlocked)}`
          : `no active reconciliation notices in ${RECONCILIATION_NOTICES_REL_PATH}`
  });

  const activeTrack = flowState.track ?? "standard";
  const trackStageList = TRACK_STAGES[activeTrack];
  const skippedFromState = Array.isArray(flowState.skippedStages) ? flowState.skippedStages : [];
  const expectedSkipped = skippedStagesForTrack(activeTrack);
  const skippedConsistent =
    expectedSkipped.length === skippedFromState.length &&
    expectedSkipped.every((stage) => skippedFromState.includes(stage));
  checks.push({
    name: "flow_state:track",
    ok: skippedConsistent,
    details: skippedConsistent
      ? `active track "${activeTrack}" (${trackStageList.length}/${FLOW_STAGES.length} stages: ${trackStageList.join(" → ")})${
          expectedSkipped.length > 0 ? `; skippedStages=${expectedSkipped.join(", ")}` : ""
        }`
      : `track "${activeTrack}" expects skippedStages=[${expectedSkipped.join(", ")}] but flow-state has [${skippedFromState.join(", ")}] — run \`cclaw sync\` to repair`
  });
  if (parsedConfig?.trackHeuristics) {
    const ideaArtifactPath = path.join(projectRoot, RUNTIME_ROOT, "artifacts", "00-idea.md");
    let heuristicsAligned = true;
    let heuristicsDetails = "trackHeuristics configured; advisory alignment check skipped.";

    if (!(await exists(ideaArtifactPath))) {
      heuristicsDetails = `trackHeuristics configured but ${RUNTIME_ROOT}/artifacts/00-idea.md is missing; advisory alignment check skipped.`;
    } else {
      const ideaMarkdown = await fs.readFile(ideaArtifactPath, "utf8");
      if (/^Reclassification:\s*/imu.test(ideaMarkdown)) {
        heuristicsDetails = "00-idea.md contains Reclassification entry; advisory heuristic mismatch check skipped.";
      } else {
        const userPrompt = extractUserPromptFromIdeaArtifact(ideaMarkdown);
        if (!userPrompt) {
          heuristicsDetails = "00-idea.md has no `## User prompt` section; advisory heuristic mismatch check skipped.";
        } else {
          const resolution = resolveTrackFromPrompt(userPrompt, parsedConfig.trackHeuristics);
          const tokenNote =
            resolution.matchedTokens.length > 0
              ? `matched: ${resolution.matchedTokens.join(", ")}`
              : "matched: none (fallback)";
          heuristicsAligned = resolution.track === activeTrack;
          heuristicsDetails = heuristicsAligned
            ? `trackHeuristics advisory matches active track "${activeTrack}" (${tokenNote}).`
            : `warning: trackHeuristics advisory predicts "${resolution.track}" (${tokenNote}; ${resolution.reason}) but flow-state track is "${activeTrack}". Re-run classification or add Reclassification in 00-idea.md if override was intentional.`;
        }
      }
    }
    checks.push({
      name: "warning:track_heuristics:advisory_alignment",
      ok: heuristicsAligned,
      details: heuristicsDetails
    });
  }
  checks.push({
    name: "flow_state:track_completed_in_track",
    ok: flowState.completedStages.every((stage) => trackStageList.includes(stage) || expectedSkipped.includes(stage)),
    details: (() => {
      const offTrack = flowState.completedStages.filter((stage) => !trackStageList.includes(stage) && !expectedSkipped.includes(stage));
      return offTrack.length === 0
        ? `every completed stage belongs to track "${activeTrack}" or its skipped set`
        : `completed stages contain entries outside track "${activeTrack}" and not in skipped set: ${offTrack.join(", ")}`;
    })()
  });
  checks.push({
    name: "artifacts:active_root",
    ok: await exists(path.join(projectRoot, RUNTIME_ROOT, "artifacts")),
    details: `${RUNTIME_ROOT}/artifacts must exist as the active artifact root`
  });
  const artifactsRoot = path.join(projectRoot, RUNTIME_ROOT, "artifacts");
  let artifactPlaceholderHits: string[] = [];
  if (await exists(artifactsRoot)) {
    try {
      const entries = await fs.readdir(artifactsRoot, { withFileTypes: true });
      const placeholderPattern = /\b(?:TODO|TBD|FIXME)\b|<fill-in>|<your-.*-here>/giu;
      for (const entry of entries) {
        if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
        const filePath = path.join(artifactsRoot, entry.name);
        const content = await fs.readFile(filePath, "utf8");
        const matchCount = (content.match(placeholderPattern) ?? []).length;
        if (matchCount > 0) {
          artifactPlaceholderHits.push(`${entry.name}:${matchCount}`);
        }
      }
    } catch {
      artifactPlaceholderHits = [];
    }
  }
  checks.push({
    name: "warning:artifacts:stale_placeholders",
    ok: true,
    details: artifactPlaceholderHits.length === 0
      ? "no TODO/TBD/FIXME placeholder markers found in active artifacts"
      : `warning: placeholder markers detected in active artifacts (${artifactPlaceholderHits.join(", ")}). Clear before marking completion.`
  });
  const activeMetaStatus = await readJsonObjectStatus(activeFeatureMetaPath(projectRoot));
  const worktreeRegistryStatus = await readJsonObjectStatus(worktreeRegistryPath(projectRoot));
  const features = await listFeatures(projectRoot, { repair: false });
  const worktreeRegistry = await readFeatureWorktreeRegistry(projectRoot, { repair: false });
  const activeFeatureEntry = worktreeRegistry.entries.find((entry) => entry.featureId === activeFeature);
  const activeFeatureWorkspacePath = activeFeatureEntry
    ? resolveFeatureWorkspacePath(projectRoot, activeFeatureEntry)
    : "";
  checks.push({
    name: "state:active_feature_meta",
    ok: activeMetaStatus.exists,
    details: `${RUNTIME_ROOT}/state/active-feature.json must exist`
  });
  checks.push({
    name: "state:active_feature_meta_valid_json",
    ok: activeMetaStatus.ok,
    details: activeMetaStatus.ok
      ? `${RUNTIME_ROOT}/state/active-feature.json parsed successfully`
      : `${RUNTIME_ROOT}/state/active-feature.json is invalid: ${activeMetaStatus.error ?? "unknown error"}`
  });
  checks.push({
    name: "state:worktree_registry_exists",
    ok: worktreeRegistryStatus.exists,
    details: `${RUNTIME_ROOT}/state/worktrees.json must exist and track feature->worktree mapping`
  });
  checks.push({
    name: "state:worktree_registry_valid_json",
    ok: worktreeRegistryStatus.ok,
    details: worktreeRegistryStatus.ok
      ? `${RUNTIME_ROOT}/state/worktrees.json parsed successfully`
      : `${RUNTIME_ROOT}/state/worktrees.json is invalid: ${worktreeRegistryStatus.error ?? "unknown error"}`
  });
  checks.push({
    name: "state:active_feature_exists",
    ok: features.includes(activeFeature),
    details: features.includes(activeFeature)
      ? `active feature "${activeFeature}" is present in ${RUNTIME_ROOT}/state/worktrees.json`
      : `active feature "${activeFeature}" is missing from ${RUNTIME_ROOT}/state/worktrees.json`
  });
  checks.push({
    name: "state:features_nonempty",
    ok: features.length > 0,
    details: features.length > 0
      ? `${features.length} registered feature workspace(s): ${features.join(", ")}`
      : `no feature workspaces found in ${RUNTIME_ROOT}/state/worktrees.json`
  });
  checks.push({
    name: "state:active_feature_workspace_path",
    ok: activeFeatureEntry ? await exists(activeFeatureWorkspacePath) : false,
    details: activeFeatureEntry
      ? `active feature "${activeFeature}" maps to workspace path ${activeFeatureEntry.path} (${activeFeatureEntry.source})`
      : `active feature "${activeFeature}" has no worktree registry entry`
  });
  const missingRegistryPaths: string[] = [];
  for (const entry of worktreeRegistry.entries) {
    const workspacePath = resolveFeatureWorkspacePath(projectRoot, entry);
    if (!(await exists(workspacePath))) {
      missingRegistryPaths.push(`${entry.featureId}:${entry.path}`);
    }
  }
  checks.push({
    name: "state:worktree_registry_paths_exist",
    ok: missingRegistryPaths.length === 0,
    details: missingRegistryPaths.length === 0
      ? "all worktree registry entries resolve to existing paths"
      : `missing worktree paths for registry entries: ${missingRegistryPaths.join(", ")}`
  });
  const gitTrackedPaths = await gitWorktreePaths(projectRoot);
  const registryGitPaths = worktreeRegistry.entries
    .filter((entry) => entry.source === "git-worktree")
    .map((entry) => resolveFeatureWorkspacePath(projectRoot, entry));
  const missingFromGitList = registryGitPaths.filter((workspacePath) => !gitTrackedPaths.has(path.resolve(workspacePath)));
  checks.push({
    name: "warning:state:worktree_registry_git_drift",
    ok: true,
    details: missingFromGitList.length === 0
      ? "git-worktree registry entries align with `git worktree list`"
      : `warning: ${missingFromGitList.length} registry worktree path(s) are missing from \`git worktree list\`: ${missingFromGitList.join(", ")}`
  });
  const managedWorktreeRoot = path.join(projectRoot, RUNTIME_ROOT, "worktrees");
  const unregisteredManagedWorktrees = [...gitTrackedPaths]
    .filter((workspacePath) => workspacePath.startsWith(path.resolve(managedWorktreeRoot)))
    .filter((workspacePath) => !registryGitPaths.some((registeredPath) => path.resolve(registeredPath) === workspacePath));
  checks.push({
    name: "warning:state:worktree_unregistered_paths",
    ok: true,
    details: unregisteredManagedWorktrees.length === 0
      ? "no unmanaged git worktrees under .cclaw/worktrees"
      : `warning: unregistered git worktree paths detected: ${unregisteredManagedWorktrees.map((value) => path.relative(projectRoot, value)).join(", ")}`
  });
  const legacyWorkspaceEntries = worktreeRegistry.entries
    .filter((entry) => entry.source === "legacy-snapshot")
    .map((entry) => entry.featureId);
  checks.push({
    name: "warning:state:legacy_feature_snapshots",
    ok: legacyWorkspaceEntries.length === 0,
    details: legacyWorkspaceEntries.length === 0
      ? "no legacy .cclaw/features snapshot entries remain"
      : `legacy snapshot entries still present (read-only): ${legacyWorkspaceEntries.join(", ")}`
  });
  const staleStages = Object.keys(flowState.staleStages).filter((value) =>
    FLOW_STAGES.includes(value as (typeof FLOW_STAGES)[number])
  );
  checks.push({
    name: "state:stale_stages_resolved",
    ok: staleStages.length === 0,
    details: staleStages.length === 0
      ? "no stale stages pending acknowledgement"
      : `stale stages must be acknowledged via /cc-ops rewind --ack <stage>: ${staleStages.join(", ")}`
  });
  const retroRequired = flowState.completedStages.includes("ship");
  const retroComplete =
    !retroRequired ||
    (typeof flowState.retro.completedAt === "string" && flowState.retro.compoundEntries > 0);
  checks.push({
    name: "state:retro_gate",
    ok: retroComplete,
    details: retroComplete
      ? retroRequired
        ? `retro gate complete (${flowState.retro.compoundEntries} compound entries)`
        : "retro gate not required yet (ship not completed)"
      : "retro gate incomplete: run /cc-ops retro and record at least one compound knowledge entry"
  });
  const flowSnapshotPath = path.join(projectRoot, RUNTIME_ROOT, "state", "flow-state.snapshot.json");
  const flowSnapshotExists = await exists(flowSnapshotPath);
  let flowSnapshotValid = flowSnapshotExists;
  if (flowSnapshotExists) {
    try {
      JSON.parse(await fs.readFile(flowSnapshotPath, "utf8"));
      flowSnapshotValid = true;
    } catch {
      flowSnapshotValid = false;
    }
  }
  checks.push({
    name: "state:flow_snapshot",
    ok: flowSnapshotExists && flowSnapshotValid,
    details: flowSnapshotExists
      ? flowSnapshotValid
        ? `${RUNTIME_ROOT}/state/flow-state.snapshot.json exists and is valid JSON`
        : `${RUNTIME_ROOT}/state/flow-state.snapshot.json exists but is invalid JSON`
      : `${RUNTIME_ROOT}/state/flow-state.snapshot.json is missing`
  });
  const tddLogPath = path.join(projectRoot, RUNTIME_ROOT, "state", "tdd-cycle-log.jsonl");
  const tddLogExists = await exists(tddLogPath);
  checks.push({
    name: "state:tdd_cycle_log_exists",
    ok: tddLogExists,
    details: `${RUNTIME_ROOT}/state/tdd-cycle-log.jsonl must exist`
  });
  const tddCompleted = flowState.completedStages.includes("tdd")
    || (flowState.currentStage === "review" || flowState.currentStage === "ship");
  if (tddLogExists) {
    const tddLogRaw = await fs.readFile(tddLogPath, "utf8");
    const parsedCycles = parseTddCycleLog(tddLogRaw);
    const validation = validateTddCycleOrder(parsedCycles, { runId: activeRunId || undefined });
    const hasCoverage = validation.sliceCount > 0;
    checks.push({
      name: "state:tdd_cycle_order",
      ok: validation.ok && (!tddCompleted || hasCoverage),
      details: validation.ok
        ? tddCompleted && !hasCoverage
          ? "tdd stage complete but no RED/GREEN cycle evidence logged"
          : `tdd cycle log valid (${validation.sliceCount} slice(s), open_red=${validation.openRedSlices.length})`
        : `tdd cycle order issues: ${validation.issues.join("; ")}${
            validation.openRedSlices.length > 0
              ? ` | open red slices: ${validation.openRedSlices.join(", ")}`
              : ""
          }`
    });
  } else {
    checks.push({
      name: "state:tdd_cycle_order",
      ok: !tddCompleted,
      details: tddCompleted
        ? "tdd stage complete but tdd-cycle-log.jsonl is missing"
        : "tdd cycle order deferred until tdd stage evidence is generated"
    });
  }
  checks.push({
    name: "runs:archive_root",
    ok: await exists(path.join(projectRoot, RUNTIME_ROOT, "runs")),
    details: `${RUNTIME_ROOT}/runs must exist for archived feature snapshots`
  });

  const delegation = await checkMandatoryDelegations(projectRoot, flowState.currentStage, {
    repairFeatureSystem: false
  });
  const missingEvidenceNote =
    delegation.missingEvidence && delegation.missingEvidence.length > 0
      ? ` (role-switch rows without evidenceRefs: ${delegation.missingEvidence.join(", ")})`
      : "";
  checks.push({
    name: "delegation:mandatory:current_stage",
    ok: delegation.satisfied,
    details: delegation.satisfied
      ? `All mandatory delegations satisfied for stage "${flowState.currentStage}" (mode: ${delegation.expectedMode})`
      : `Missing mandatory delegations for stage "${flowState.currentStage}": ${delegation.missing.join(", ")}${missingEvidenceNote}`
  });
  checks.push({
    name: "warning:delegation:waived",
    ok: true,
    details: delegation.waived.length > 0
      ? `warning: waived mandatory delegations for stage "${flowState.currentStage}": ${delegation.waived.join(", ")}${
          delegation.autoWaived.length > 0
            ? ` (auto-waived due to harness limitation: ${delegation.autoWaived.join(", ")})`
            : ""
        }`
      : "no waived mandatory delegations for current stage"
  });
  checks.push({
    name: "warning:delegation:stale_runs",
    ok: true,
    details: delegation.staleIgnored.length > 0
      ? `warning: ${delegation.staleIgnored.length} delegation entries from other runs were ignored: ${delegation.staleIgnored.join(", ")}`
      : "no stale delegation entries from prior runs"
  });

  const trace = await buildTraceMatrix(projectRoot);
  const artifactsDir = path.join(projectRoot, RUNTIME_ROOT, "artifacts");
  const specExists = await exists(path.join(artifactsDir, "04-spec.md"));
  const planExists = await exists(path.join(artifactsDir, "05-plan.md"));
  const tddExists = await exists(path.join(artifactsDir, "06-tdd.md"));
  const traceHasSignal =
    trace.entries.length > 0 ||
    trace.orphanedCriteria.length > 0 ||
    trace.orphanedTasks.length > 0 ||
    trace.orphanedTests.length > 0;
  const artifactsPresent = specExists || planExists || tddExists;
  const emptyMatrixWithArtifacts = !traceHasSignal && artifactsPresent;
  checks.push({
    name: "trace:matrix_populated",
    ok: !emptyMatrixWithArtifacts,
    details: emptyMatrixWithArtifacts
      ? `trace matrix is empty but artifacts exist (${[
          specExists ? "04-spec.md" : null,
          planExists ? "05-plan.md" : null,
          tddExists ? "06-tdd.md" : null
        ].filter(Boolean).join(", ")}). The extractors found no criterion/task/slice IDs — check heading conventions and ID formats.`
      : artifactsPresent
        ? `trace matrix parsed ${trace.entries.length} criterion(s) from present artifacts`
        : "no downstream artifacts to trace yet"
  });
  checks.push({
    name: "trace:criteria_coverage",
    ok: !traceHasSignal || trace.orphanedCriteria.length === 0,
    details: trace.orphanedCriteria.length === 0
      ? "all spec criteria are linked to plan tasks"
      : `orphaned criteria: ${trace.orphanedCriteria.join(", ")}`
  });
  checks.push({
    name: "trace:task_to_test_coverage",
    ok: !traceHasSignal || trace.orphanedTasks.length === 0,
    details: trace.orphanedTasks.length === 0
      ? "all plan tasks are linked to test slices"
      : `orphaned tasks: ${trace.orphanedTasks.join(", ")}`
  });
  checks.push({
    name: "trace:test_to_criteria_coverage",
    ok: !traceHasSignal || trace.orphanedTests.length === 0,
    details: trace.orphanedTests.length === 0
      ? "all test slices map to acceptance-linked tasks"
      : `orphaned test slices: ${trace.orphanedTests.join(", ")}`
  });

  // Slice-review warning (opt-in via config.sliceReview.enabled).
  // Fires when:
  //   - sliceReview.enabled is true
  //   - current track is listed in sliceReview.enforceOnTracks
  //   - 06-tdd.md exists (so the slice loop actually started)
  //   - artifact contains at least one slice marker (look for the tdd
  //     "Acceptance Mapping" or any `### Slice` heading) AND the Per-Slice
  //     Review heading is absent
  // Non-blocking — warnings guide the user toward adding the review
  // section without failing doctor.
  const sliceReviewConfig = parsedConfig?.sliceReview;
  const sliceReviewEnabled = sliceReviewConfig?.enabled === true;
  const sliceReviewEnforcedTracks = sliceReviewConfig?.enforceOnTracks ?? ["standard"];
  const sliceReviewEnforcedHere =
    sliceReviewEnabled && sliceReviewEnforcedTracks.includes(activeTrack);
  if (sliceReviewEnforcedHere && tddExists) {
    const tddMarkdown = await fs.readFile(path.join(artifactsDir, "06-tdd.md"), "utf8");
    const hasSliceSignal = /^###\s+Slice\b/im.test(tddMarkdown)
      || /^##\s+Acceptance Mapping\b/im.test(tddMarkdown)
      || /^##\s+RED\b/im.test(tddMarkdown);
    const hasReviewHeading = /^##\s+Per-Slice Review\b/im.test(tddMarkdown);
    const missing = hasSliceSignal && !hasReviewHeading;
    checks.push({
      name: "warning:slice_review:missing_section",
      ok: !missing,
      details: missing
        ? `warning: sliceReview is enabled for track "${activeTrack}" and 06-tdd.md contains slice evidence but no "## Per-Slice Review" section. Add a Per-Slice Review entry for every triggered slice (touchCount >= ${sliceReviewConfig?.filesChangedThreshold ?? 5}, touchPaths match, or highRisk=true), or record "not triggered" explicitly.`
        : hasReviewHeading
          ? `sliceReview section present in 06-tdd.md (track "${activeTrack}")`
          : `sliceReview enabled but no slice evidence yet in 06-tdd.md (track "${activeTrack}")`
    });
  }

  const gateEvidence = await verifyCurrentStageGateEvidence(projectRoot, flowState);
  checks.push({
    name: "gates:evidence:current_stage",
    ok: gateEvidence.ok,
    details: gateEvidence.ok
      ? `stage "${gateEvidence.stage}" gate evidence is consistent (required=${gateEvidence.requiredCount}, recommended=${gateEvidence.recommendedCount}, conditional=${gateEvidence.conditionalCount}, triggered=${gateEvidence.triggeredConditionalCount}, passed=${gateEvidence.passedCount}, blocked=${gateEvidence.blockedCount})`
      : gateEvidence.issues.join(" ")
  });
  checks.push({
    name: "warning:gates:recommended:current_stage",
    ok: true,
    details: gateEvidence.missingRecommended.length > 0
      ? `warning: stage "${gateEvidence.stage}" has unmet recommended gates: ${gateEvidence.missingRecommended.join(", ")}`
      : `no unmet recommended gates for stage "${gateEvidence.stage}"`
  });

  const completedClosure = verifyCompletedStagesGateClosure(flowState);
  checks.push({
    name: "gates:closure:completed_stages",
    ok: completedClosure.ok,
    details: completedClosure.ok
      ? flowState.completedStages.length === 0
        ? "no completed stages yet"
        : `all ${flowState.completedStages.length} completed stages have every required gate passed`
      : completedClosure.issues.join(" ")
  });

  const isRepo = await isGitRepo(projectRoot);
  checks.push({
    name: "git:cclaw_ignored_runtime",
    ok: isRepo ? await gitIgnoresRuntime(projectRoot) : true,
    details: isRepo
      ? `git check-ignore must pass for ${RUNTIME_ROOT}/`
      : "repository not initialized; check skipped"
  });

  const rulesJsonPath = path.join(projectRoot, RUNTIME_ROOT, "rules", "rules.json");
  let hasRules = false;
  if (await exists(rulesJsonPath)) {
    try {
      const parsed = JSON.parse(await fs.readFile(rulesJsonPath, "utf8")) as Record<string, unknown>;
      const hasCoreLists = Array.isArray(parsed.MUST_ALWAYS) && Array.isArray(parsed.MUST_NEVER);
      const stageOrder = parsed.stage_order;
      const stageGates = parsed.stage_gates;
      const hasStageOrder =
        Array.isArray(stageOrder) &&
        FLOW_STAGES.every((stage) => stageOrder.includes(stage));
      const hasStageGates =
        typeof stageGates === "object" &&
        stageGates !== null &&
        FLOW_STAGES.every((stage) =>
          Array.isArray((stageGates as Record<string, unknown[]>)[stage])
        );

      hasRules = hasCoreLists && hasStageOrder && hasStageGates;
    } catch {
      hasRules = false;
    }
  }
  checks.push({
    name: "rules:policy_schema",
    ok: hasRules,
    details: rulesJsonPath
  });

  const policy = await policyChecks(projectRoot, { harnesses: configuredHarnesses });
  checks.push(...policy);

  return checks.map((check): DoctorCheck => {
    const metadata = doctorCheckMetadata(check.name);
    return {
      ...check,
      severity: check.severity ?? metadata.severity,
      summary: check.summary ?? metadata.summary,
      fix: check.fix ?? metadata.fix,
      docRef: check.docRef ?? metadata.docRef
    };
  });
}

export function doctorSucceeded(checks: DoctorCheck[]): boolean {
  return checks.every((check) => check.ok || check.severity !== "error");
}
