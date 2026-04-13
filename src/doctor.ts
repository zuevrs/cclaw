import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { COMMAND_FILE_ORDER, REQUIRED_DIRS, RUNTIME_ROOT } from "./constants.js";
import { CCLAW_AGENTS } from "./content/agents.js";
import { readConfig } from "./config.js";
import { exists } from "./fs-utils.js";
import { gitignoreHasRequiredPatterns } from "./gitignore.js";
import { HARNESS_ADAPTERS, CCLAW_MARKER_START, CCLAW_MARKER_END } from "./harness-adapters.js";
import { policyChecks } from "./policy.js";
import { readFlowState } from "./runs.js";
import { stageSkillFolder } from "./content/skills.js";

const execFileAsync = promisify(execFile);

export interface DoctorCheck {
  name: string;
  ok: boolean;
  details: string;
}

async function isGitRepo(projectRoot: string): Promise<boolean> {
  try {
    await execFileAsync("git", ["rev-parse", "--is-inside-work-tree"], { cwd: projectRoot });
    return true;
  } catch {
    return false;
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

export async function doctorChecks(projectRoot: string): Promise<DoctorCheck[]> {
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

  let configuredHarnesses: string[] = [];
  try {
    const config = await readConfig(projectRoot);
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
    for (const stage of COMMAND_FILE_ORDER) {
      const shimPath = path.join(projectRoot, adapter.commandDir, `cc-${stage}.md`);
      let shimOk = await exists(shimPath);
      let details = shimPath;

      if (shimOk) {
        const content = await fs.readFile(shimPath, "utf8");
        const hasSkillReference = content.includes(`.cclaw/skills/${stageSkillFolder(stage)}/SKILL.md`);
        const hasCommandReference = content.includes(`.cclaw/commands/${stage}.md`);
        shimOk = hasSkillReference && hasCommandReference;
        details = hasSkillReference && hasCommandReference
          ? `${shimPath} aligned`
          : `${shimPath} missing stage references`;
      }

      checks.push({
        name: `shim:${harness}:${stage}`,
        ok: shimOk,
        details
      });
    }
  }

  const agentsFile = path.join(projectRoot, "AGENTS.md");
  let agentsBlockOk = false;
  if (await exists(agentsFile)) {
    const content = await fs.readFile(agentsFile, "utf8");
    const hasMarkers = content.includes(CCLAW_MARKER_START) && content.includes(CCLAW_MARKER_END);
    const hasAllCommands = COMMAND_FILE_ORDER.every((stage) => content.includes(`/cc-${stage}`));
    const hasRouting = content.includes("Intent → Stage Routing") || content.includes("Intent → Stage");
    const hasVerification = content.includes("Verification Discipline");
    const hasMinimalMarker = content.includes("intentionally minimal for cross-project use");
    const hasMetaSkillPointer = content.includes(".cclaw/skills/using-cclaw/SKILL.md");
    agentsBlockOk = hasMarkers && hasAllCommands && hasRouting && hasVerification && hasMinimalMarker && hasMetaSkillPointer;
  }
  checks.push({
    name: "agents:cclaw_block",
    ok: agentsBlockOk,
    details: `${agentsFile} must contain the managed cclaw marker block with routing, verification, and minimal detail pointer`
  });

  // Utility commands
  for (const cmd of ["learn", "autoplan"]) {
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
    ["autoplan", "autoplan"],
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

  // New utility skills (security, debugging, performance, ci-cd, docs)
  for (const folder of [
    "security",
    "debugging",
    "performance",
    "ci-cd",
    "docs"
  ]) {
    const skillPath = path.join(projectRoot, RUNTIME_ROOT, "skills", folder, "SKILL.md");
    checks.push({
      name: `utility_skill:${folder}`,
      ok: await exists(skillPath),
      details: skillPath
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
    "context-monitor.sh",
    "observe.sh",
    "summarize-observations.sh",
    "summarize-observations.mjs"
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
    }
  }

  // OpenCode plugin source + deployed path
  checks.push({
    name: "hook:opencode_plugin_source",
    ok: await exists(path.join(projectRoot, RUNTIME_ROOT, "hooks", "opencode-plugin.mjs")),
    details: `${RUNTIME_ROOT}/hooks/opencode-plugin.mjs`
  });
  checks.push({
    name: "hook:opencode_plugin_deployed",
    ok: await exists(path.join(projectRoot, ".opencode/plugins/cclaw-plugin.mjs")),
    details: ".opencode/plugins/cclaw-plugin.mjs"
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
      preCommands.some((cmd) => cmd.includes("observe.sh pre")) &&
      postCommands.some((cmd) => cmd.includes("observe.sh post")) &&
      postCommands.some((cmd) => cmd.includes("context-monitor.sh")) &&
      stopCommands.some((cmd) => cmd.includes("summarize-observations.sh")) &&
      stopCommands.some((cmd) => cmd.includes("stop-checkpoint.sh"));
    checks.push({
      name: "hook:wiring:claude",
      ok: wiringOk,
      details: `${file} must wire session-start/prompt-guard/observe/context-monitor/summarize/stop-checkpoint`
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
      preCommands.some((cmd) => cmd.includes("observe.sh pre")) &&
      postCommands.some((cmd) => cmd.includes("observe.sh post")) &&
      postCommands.some((cmd) => cmd.includes("context-monitor.sh")) &&
      stopCommands.some((cmd) => cmd.includes("summarize-observations.sh")) &&
      stopCommands.some((cmd) => cmd.includes("stop-checkpoint.sh"));
    checks.push({
      name: "hook:wiring:cursor",
      ok: wiringOk,
      details: `${file} must wire session-start/prompt-guard/observe/context-monitor/summarize/stop-checkpoint`
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
      preCommands.some((cmd) => cmd.includes("observe.sh pre")) &&
      postCommands.some((cmd) => cmd.includes("observe.sh post")) &&
      postCommands.some((cmd) => cmd.includes("context-monitor.sh")) &&
      stopCommands.some((cmd) => cmd.includes("summarize-observations.sh")) &&
      stopCommands.some((cmd) => cmd.includes("stop-checkpoint.sh"));
    checks.push({
      name: "hook:wiring:codex",
      ok: wiringOk,
      details: `${file} must wire session-start/prompt-guard/observe/context-monitor/summarize/stop-checkpoint`
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
        content.includes('"session.idle"') &&
        content.includes('"session.updated"') &&
        content.includes('"session.resumed"') &&
        content.includes('"session.cleared"') &&
        content.includes('"experimental.chat.system.transform"');
    }
    checks.push({
      name: "lifecycle:opencode:rehydration_events",
      ok,
      details: `${file} must include event lifecycle handler, tool.execute.before/after, session.idle summarization, and transform rehydration`
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

  // Learnings store exists
  checks.push({
    name: "learnings:store_exists",
    ok: await exists(path.join(projectRoot, RUNTIME_ROOT, "learnings.jsonl")),
    details: `${RUNTIME_ROOT}/learnings.jsonl must exist (can be empty)`
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

  const flowState = await readFlowState(projectRoot);
  checks.push({
    name: "flow_state:active_run_id",
    ok: typeof flowState.activeRunId === "string" && flowState.activeRunId.trim().length > 0,
    details: `${RUNTIME_ROOT}/state/flow-state.json must include activeRunId`
  });
  checks.push({
    name: "run:active_artifacts",
    ok: await exists(path.join(projectRoot, RUNTIME_ROOT, "runs", flowState.activeRunId, "artifacts")),
    details: `${RUNTIME_ROOT}/runs/${flowState.activeRunId}/artifacts must exist`
  });
  checks.push({
    name: "run:active_metadata",
    ok: await exists(path.join(projectRoot, RUNTIME_ROOT, "runs", flowState.activeRunId, "run.json")),
    details: `${RUNTIME_ROOT}/runs/${flowState.activeRunId}/run.json must exist`
  });
  checks.push({
    name: "run:active_handoff",
    ok: await exists(path.join(projectRoot, RUNTIME_ROOT, "runs", flowState.activeRunId, "00-handoff.md")),
    details: `${RUNTIME_ROOT}/runs/${flowState.activeRunId}/00-handoff.md must exist`
  });

  // Utility shims in harness dirs
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
    for (const cmd of ["learn", "autoplan"]) {
      const shimPath = path.join(projectRoot, adapter.commandDir, `cc-${cmd}.md`);
      checks.push({
        name: `shim:${harness}:${cmd}`,
        ok: await exists(shimPath),
        details: shimPath
      });
    }
  }

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

  const policy = await policyChecks(projectRoot);
  checks.push(...policy);

  return checks;
}

export function doctorSucceeded(checks: DoctorCheck[]): boolean {
  return checks.every((check) => check.ok);
}
