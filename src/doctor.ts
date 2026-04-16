import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { COMMAND_FILE_ORDER, REQUIRED_DIRS, RUNTIME_ROOT } from "./constants.js";
import { CCLAW_AGENTS } from "./content/agents.js";
import { readConfig } from "./config.js";
import { exists } from "./fs-utils.js";
import { gitignoreHasRequiredPatterns } from "./gitignore.js";
import { HARNESS_ADAPTERS, CCLAW_MARKER_START, CCLAW_MARKER_END } from "./harness-adapters.js";
import { policyChecks } from "./policy.js";
import { readFlowState } from "./runs.js";
import { skippedStagesForTrack } from "./flow-state.js";
import { TRACK_STAGES } from "./types.js";
import { checkMandatoryDelegations } from "./delegation.js";
import { buildTraceMatrix } from "./trace-matrix.js";
import {
  reconcileAndWriteCurrentStageGateCatalog,
  verifyCompletedStagesGateClosure,
  verifyCurrentStageGateEvidence
} from "./gate-evidence.js";
import { stageSkillFolder } from "./content/skills.js";
import {
  LANGUAGE_RULE_PACK_DIR,
  LANGUAGE_RULE_PACK_FILES,
  LEGACY_LANGUAGE_RULE_PACK_FOLDERS,
  UTILITY_SKILL_FOLDERS
} from "./content/utility-skills.js";
import { CONTEXT_MODES, DEFAULT_CONTEXT_MODE } from "./content/contexts.js";
import { validateHookDocument } from "./hook-schema.js";
import type { HarnessId } from "./types.js";

const execFileAsync = promisify(execFile);

export interface DoctorCheck {
  name: string;
  ok: boolean;
  details: string;
}

export interface DoctorOptions {
  /** When true, normalize current-stage gate catalog and persist reconciliation before checks. */
  reconcileCurrentStageGates?: boolean;
}

async function isGitRepo(projectRoot: string): Promise<boolean> {
  try {
    await execFileAsync("git", ["rev-parse", "--is-inside-work-tree"], { cwd: projectRoot });
    return true;
  } catch {
    return false;
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

  for (const configPath of candidates) {
    if (!(await exists(configPath))) {
      continue;
    }
    const parsed = await readHookDocument(configPath);
    if (!parsed) {
      continue;
    }
    const plugins = Array.isArray(parsed.plugin) ? parsed.plugin : [];
    const registered = plugins.some((entry) => normalizeOpenCodePluginEntry(entry) === expected);
    if (registered) {
      return { ok: true, details: `${path.relative(projectRoot, configPath)} registers ${expected}` };
    }
    return { ok: false, details: `${path.relative(projectRoot, configPath)} missing plugin ${expected}` };
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

    await (plugin.event as (payload: unknown) => Promise<void>)({ event: { type: "session.updated", data: {} } });
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
  const checks: DoctorCheck[] = [];

  for (const dir of REQUIRED_DIRS) {
    const fullPath = path.join(projectRoot, dir);
    checks.push({
      name: `dir:${dir}`,
      ok: await exists(fullPath),
      details: fullPath
    });
  }

  for (const stage of COMMAND_FILE_ORDER) {
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
      checks.push({
        name: `skill:${stage}:min_lines`,
        ok: lineCount >= MIN_SKILL_LINES,
        details: `${skillPath} has ${lineCount} lines (minimum ${MIN_SKILL_LINES})`
      });
    }
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
      details: error instanceof Error ? error.message : "Invalid config"
    });
  }

  if (parsedConfig) {
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
    const adapter = (HARNESS_ADAPTERS as Record<string, { commandDir: string }>)[harness];
    if (!adapter) {
      checks.push({
        name: `harness:${harness}:supported`,
        ok: false,
        details: `Unsupported harness "${harness}" in ${RUNTIME_ROOT}/config.yaml`
      });
      continue;
    }
    for (const shim of ["cc.md", "cc-next.md", "cc-learn.md"]) {
      const shimPath = path.join(projectRoot, adapter.commandDir, shim);
      checks.push({
        name: `shim:${harness}:${shim.replace(".md", "")}`,
        ok: await exists(shimPath),
        details: shimPath
      });
    }
  }

  const agentsFile = path.join(projectRoot, "AGENTS.md");
  let agentsBlockOk = false;
  if (await exists(agentsFile)) {
    const content = await fs.readFile(agentsFile, "utf8");
    const hasMarkers = content.includes(CCLAW_MARKER_START) && content.includes(CCLAW_MARKER_END);
    const hasCcCommand = content.includes("/cc");
    const hasCcNext = content.includes("/cc-next");
    const hasCcLearn = content.includes("/cc-learn");
    const hasVerification = content.includes("Verification Discipline");
    const hasMinimalMarker = content.includes("intentionally minimal for cross-project use");
    const hasMetaSkillPointer = content.includes(".cclaw/skills/using-cclaw/SKILL.md");
    agentsBlockOk = hasMarkers && hasCcCommand && hasCcNext && hasCcLearn && hasVerification && hasMinimalMarker && hasMetaSkillPointer;
  }
  checks.push({
    name: "agents:cclaw_block",
    ok: agentsBlockOk,
    details: `${agentsFile} must contain the managed cclaw marker block with routing, verification, and minimal detail pointer`
  });

  // Utility commands
  for (const cmd of ["learn"]) {
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
    "session-start.sh",
    "stop-checkpoint.sh",
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

  // Hook JSON files per harness
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
    const file = path.join(projectRoot, ".codex/hooks.json");
    const parsed = await readHookDocument(file);
    const hooks = toObject(parsed?.hooks) ?? {};
    const sessionStart = hooks.SessionStart;
    const ok = JSON.stringify(sessionStart ?? "").includes("startup|resume|clear|compact");
    checks.push({
      name: "lifecycle:codex:rehydration_matcher",
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
      name: "hook:wiring:codex",
      ok: wiringOk,
      details: `${file} must wire session-start/prompt-guard/workflow-guard/context-monitor/stop-checkpoint`
    });
  }

  if (configuredHarnesses.includes("opencode")) {
    const file = path.join(projectRoot, ".opencode/plugins/cclaw-plugin.mjs");
    let ok = false;
    if (await exists(file)) {
      const content = await fs.readFile(file, "utf8");
      ok =
        content.includes("event: async") &&
        content.includes('"tool.execute.before"') &&
        content.includes('"tool.execute.after"') &&
        content.includes("prompt-guard.sh") &&
        content.includes("workflow-guard.sh") &&
        content.includes("context-monitor.sh") &&
        content.includes('"session.idle"') &&
        content.includes('"session.resumed"') &&
        content.includes('"session.cleared"') &&
        content.includes('"experimental.chat.system.transform"');
    }
    checks.push({
      name: "lifecycle:opencode:rehydration_events",
      ok,
      details: `${file} must include event lifecycle handler, tool.execute.before/after with prompt/workflow/context hooks, session.idle checkpoint, and transform rehydration`
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
  checks.push({
    name: "state:suggestion_memory_exists",
    ok: await exists(path.join(projectRoot, RUNTIME_ROOT, "state", "suggestion-memory.json")),
    details: `${RUNTIME_ROOT}/state/suggestion-memory.json must exist for proactive suggestion memory`
  });
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

  let flowState = await readFlowState(projectRoot);
  if (options.reconcileCurrentStageGates === true) {
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
  }
  const activeRunId = typeof flowState.activeRunId === "string" ? flowState.activeRunId.trim() : "";
  checks.push({
    name: "flow_state:active_run_id",
    ok: activeRunId.length > 0,
    details: `${RUNTIME_ROOT}/state/flow-state.json must include activeRunId`
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
      ? `active track "${activeTrack}" (${trackStageList.length}/${COMMAND_FILE_ORDER.length} stages: ${trackStageList.join(" → ")})${
          expectedSkipped.length > 0 ? `; skippedStages=${expectedSkipped.join(", ")}` : ""
        }`
      : `track "${activeTrack}" expects skippedStages=[${expectedSkipped.join(", ")}] but flow-state has [${skippedFromState.join(", ")}] — run \`cclaw sync\` to repair`
  });
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
  checks.push({
    name: "runs:archive_root",
    ok: await exists(path.join(projectRoot, RUNTIME_ROOT, "runs")),
    details: `${RUNTIME_ROOT}/runs must exist for archived feature snapshots`
  });

  const delegation = await checkMandatoryDelegations(projectRoot, flowState.currentStage);
  checks.push({
    name: "delegation:mandatory:current_stage",
    ok: delegation.satisfied,
    details: delegation.satisfied
      ? `All mandatory delegations satisfied for stage "${flowState.currentStage}"`
      : `Missing mandatory delegations for stage "${flowState.currentStage}": ${delegation.missing.join(", ")}`
  });
  checks.push({
    name: "warning:delegation:waived",
    ok: true,
    details: delegation.waived.length > 0
      ? `warning: waived mandatory delegations for stage "${flowState.currentStage}": ${delegation.waived.join(", ")}`
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

  const gateEvidence = await verifyCurrentStageGateEvidence(projectRoot, flowState);
  checks.push({
    name: "gates:evidence:current_stage",
    ok: gateEvidence.ok,
    details: gateEvidence.ok
      ? `stage "${gateEvidence.stage}" gate evidence is consistent (required=${gateEvidence.requiredCount}, passed=${gateEvidence.passedCount}, blocked=${gateEvidence.blockedCount})`
      : gateEvidence.issues.join(" ")
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

  // Self-improvement block in stage skills
  for (const stage of COMMAND_FILE_ORDER) {
    const skillPath = path.join(projectRoot, RUNTIME_ROOT, "skills", stageSkillFolder(stage), "SKILL.md");
    if (await exists(skillPath)) {
      const content = await fs.readFile(skillPath, "utf8");
      checks.push({
        name: `skill:${stage}:self_improvement`,
        ok: content.includes("## Operational Self-Improvement"),
        details: `${skillPath} must contain self-improvement block`
      });
    }
  }

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
        COMMAND_FILE_ORDER.every((stage) => stageOrder.includes(stage));
      const hasStageGates =
        typeof stageGates === "object" &&
        stageGates !== null &&
        COMMAND_FILE_ORDER.every((stage) =>
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

  return checks;
}

export function doctorSucceeded(checks: DoctorCheck[]): boolean {
  return checks.every((check) => check.ok);
}
