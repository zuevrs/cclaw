import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { readConfig, writeConfig } from "../../src/config.js";
import { doctorChecks, doctorSucceeded } from "../../src/doctor.js";
import { initCclaw, syncCclaw, uninstallCclaw, upgradeCclaw } from "../../src/install.js";
import { HARNESS_ADAPTERS } from "../../src/harness-adapters.js";
import { FLOW_STAGES } from "../../src/types.js";
import { createTempProject } from "../helpers/index.js";

const execFileAsync = promisify(execFile);
const ORIGINAL_CODEX_HOME = process.env.CODEX_HOME;

afterEach(() => {
  if (ORIGINAL_CODEX_HOME === undefined) {
    delete process.env.CODEX_HOME;
  } else {
    process.env.CODEX_HOME = ORIGINAL_CODEX_HOME;
  }
});

async function enableCodexHooksForDoctor(): Promise<void> {
  const root = await createTempProject("codex-home");
  process.env.CODEX_HOME = root;
  await fs.writeFile(path.join(root, "config.toml"), "[features]\ncodex_hooks = true\n", "utf8");
}

function countOccurrences(value: string, needle: string): number {
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const matches = value.match(new RegExp(escaped, "gu"));
  return matches ? matches.length : 0;
}

describe("install lifecycle", { timeout: 30_000 }, () => {
  it("doctor passes for claude-only harness installs", async () => {
    const root = await createTempProject("claude-only");
    await initCclaw({ projectRoot: root, harnesses: ["claude"] });

    const checks = await doctorChecks(root);
    expect(doctorSucceeded(checks)).toBe(false);
    const delegation = checks.find((c) => c.name === "delegation:mandatory:current_stage");
    expect(delegation?.ok).toBe(false);

    await expect(
      fs.stat(path.join(root, ".cclaw/adapters"))
    ).rejects.toBeDefined();

    await expect(fs.stat(path.join(root, ".cursor/rules/cclaw-workflow.mdc"))).rejects.toBeDefined();
    await expect(fs.stat(path.join(root, ".opencode/plugins/cclaw-plugin.mjs"))).rejects.toBeDefined();
  });

  it("doctor fails-closed when spec artifact exists but produces an empty trace matrix", async () => {
    const root = await createTempProject("doctor-empty-trace");
    await initCclaw({ projectRoot: root });

    await fs.writeFile(
      path.join(root, ".cclaw/artifacts/04-spec.md"),
      `# Specification Artifact\n\n## Acceptance Criteria\nNothing measurable here.\n`,
      "utf8"
    );

    const checks = await doctorChecks(root);
    const traceMatrix = checks.find((c) => c.name === "trace:matrix_populated");
    expect(traceMatrix).toBeDefined();
    expect(traceMatrix?.ok).toBe(false);
    expect(traceMatrix?.details).toMatch(/empty but artifacts exist/);
  });

  it("initializes runtime and passes doctor checks", async () => {
    await enableCodexHooksForDoctor();
    const root = await createTempProject("init");
    await initCclaw({ projectRoot: root });

    const checks = await doctorChecks(root);
    expect(doctorSucceeded(checks)).toBe(false);
    const delegation = checks.find((c) => c.name === "delegation:mandatory:current_stage");
    expect(delegation?.ok).toBe(false);
    expect(checks.some((check) => check.name === "hook:script:run-hook.mjs" && check.ok)).toBe(true);
    expect(checks.some((check) => check.name === "hook:script:run-hook.mjs:executable" && check.ok)).toBe(true);
    expect(checks.some((check) => check.name === "hook:script:run-hook.cmd" && check.ok)).toBe(true);
    expect(checks.some((check) => check.name === "hook:script:run-hook.cmd:executable" && check.ok)).toBe(true);
    expect(checks.some((check) => check.name === "hook:script:stage-complete.mjs" && check.ok)).toBe(true);
    expect(checks.some((check) => check.name === "hook:script:stage-complete.mjs:executable" && check.ok)).toBe(true);
    expect(checks.some((check) => check.name === "hook:script:start-flow.mjs" && check.ok)).toBe(true);
    expect(checks.some((check) => check.name === "hook:script:start-flow.mjs:executable" && check.ok)).toBe(true);
    expect(checks.some((check) => check.name === "hook:wiring:codex" && check.ok)).toBe(true);

    const runtimeEntries = (await fs.readdir(path.join(root, ".cclaw"))).sort();
    expect(runtimeEntries).toEqual([
      "agents",
      "artifacts",
      "commands",
      "config.yaml",
      "hooks",
      "knowledge.jsonl",
      "rules",
      "runs",
      "skills",
      "state",
      "templates"
    ]);
    const stateEntries = (await fs.readdir(path.join(root, ".cclaw/state"))).sort();
    expect(stateEntries).toEqual(["flow-state.json", "iron-laws.json"]);
    const skillEntries = (await fs.readdir(path.join(root, ".cclaw/skills"))).sort();
    expect(skillEntries).toContain("flow-view");
    expect(skillEntries).not.toContain("flow-status");
    expect(skillEntries).not.toContain("flow-tree");
    expect(skillEntries).not.toContain("flow-diff");

    const flow = JSON.parse(
      await fs.readFile(path.join(root, ".cclaw/state/flow-state.json"), "utf8")
    ) as { activeRunId?: string };
    expect(typeof flow.activeRunId).toBe("string");
    expect(flow.activeRunId).toMatch(/^run-/);
    await expect(fs.stat(path.join(root, ".cclaw/state/stage-activity.jsonl"))).rejects.toBeDefined();
    await expect(fs.stat(path.join(root, ".cclaw/state/tdd-cycle-log.jsonl"))).rejects.toBeDefined();
    await expect(fs.stat(path.join(root, ".cclaw/state/reconciliation-notices.json"))).rejects.toBeDefined();
    await expect(fs.stat(path.join(root, ".cclaw/state/checkpoint.json"))).rejects.toBeDefined();
    await expect(fs.stat(path.join(root, ".cclaw/state/flow-state.snapshot.json"))).rejects.toBeDefined();
    await expect(fs.stat(path.join(root, ".cclaw/state/harness-gaps.json"))).rejects.toBeDefined();
    const commandFiles = (await fs.readdir(path.join(root, ".cclaw/commands"))).sort();
    expect(commandFiles).toEqual([
      "brainstorm.md",
      "design.md",
      "ideate.md",
      "next.md",
      "plan.md",
      "review.md",
      "scope.md",
      "ship.md",
      "spec.md",
      "start.md",
      "tdd.md",
      "view.md"
    ]);
    await expect(fs.stat(path.join(root, ".claude/commands/cc-view.md"))).resolves.toBeDefined();
    const claudeShims = (await fs.readdir(path.join(root, ".claude/commands")))
      .filter((name) => /^cc(?:-.*)?\.md$/u.test(name))
      .sort();
    expect(claudeShims).toEqual([
      "cc-brainstorm.md",
      "cc-design.md",
      "cc-ideate.md",
      "cc-next.md",
      "cc-plan.md",
      "cc-review.md",
      "cc-scope.md",
      "cc-ship.md",
      "cc-spec.md",
      "cc-tdd.md",
      "cc-view.md",
      "cc.md"
    ]);
    const codexAdapter = HARNESS_ADAPTERS.codex;
    expect(codexAdapter.capabilities.nativeSubagentDispatch).toBe("full");
    expect(codexAdapter.capabilities.hookSurface).toBe("limited");
    expect(codexAdapter.capabilities.structuredAsk).toBe("request_user_input");
    expect(codexAdapter.capabilities.subagentFallback).toBe("native");

    // Wave Q (v0.41.0): OpenCode's native `question` tool is honest as
    // permission-gated, not missing — assert the remediation mentions
    // the config knob.
    const opencodeAdapter = HARNESS_ADAPTERS.opencode;
    expect(opencodeAdapter.capabilities.structuredAsk).toBe("question");

    // Runtime simplification: `.cclaw/references/` is no longer materialized.
    await expect(
      fs.stat(path.join(root, ".cclaw/references"))
    ).rejects.toBeDefined();

    const claudeHooks = JSON.parse(
      await fs.readFile(path.join(root, ".claude/hooks/hooks.json"), "utf8")
    ) as { hooks: { SessionStart: Array<{ matcher?: string }> } };
    expect(claudeHooks.hooks.SessionStart[0]?.matcher).toBe("startup|resume|clear|compact");

    const opencodeConfig = JSON.parse(
      await fs.readFile(path.join(root, "opencode.json"), "utf8")
    ) as { plugin?: unknown[]; permission?: { question?: unknown } };
    expect(Array.isArray(opencodeConfig.plugin)).toBe(true);
    expect(opencodeConfig.plugin).toContain(".opencode/plugins/cclaw-plugin.mjs");
    expect(opencodeConfig.permission?.question).toBe("allow");

    const cursorRule = await fs.readFile(path.join(root, ".cursor/rules/cclaw-workflow.mdc"), "utf8");
    expect(cursorRule).toContain("cclaw-managed-cursor-workflow-rule");
    expect(cursorRule).toContain("/cc-next");

    const agentsMd = await fs.readFile(path.join(root, "AGENTS.md"), "utf8");
    expect(agentsMd).toContain("## Cclaw — Workflow Adapter");
    expect(agentsMd).toContain("intentionally minimal for cross-project use");
    expect(agentsMd).toContain("then closeout: retro > compound > archive");
    expect(agentsMd).not.toContain("### Agent Specialists");
    expect(agentsMd).not.toContain("### Hooks (real lifecycle integration)");
    expect(agentsMd).not.toContain("### Runtime Details (full mode)");

    const generatedAgents = (await fs.readdir(path.join(root, ".cclaw/agents")))
      .filter((fileName) => fileName.endsWith(".md"))
      .sort();
    expect(generatedAgents).toEqual([
      "architect.md",
      "compatibility-reviewer.md",
      "critic.md",
      "doc-updater.md",
      "fixer.md",
      "implementer.md",
      "observability-reviewer.md",
      "performance-reviewer.md",
      "planner.md",
      "product-manager.md",
      "release-reviewer.md",
      "researcher.md",
      "reviewer.md",
      "security-reviewer.md",
      "slice-implementer.md",
      "spec-validator.md",
      "test-author.md"
    ]);
    const generatedOpenCodeAgents = (await fs.readdir(path.join(root, ".opencode/agents")))
      .filter((fileName) => fileName.endsWith(".md"))
      .sort();
    expect(generatedOpenCodeAgents).toEqual(generatedAgents);
    const generatedCodexAgents = (await fs.readdir(path.join(root, ".codex/agents")))
      .filter((fileName) => fileName.endsWith(".toml"))
      .sort();
    expect(generatedCodexAgents).toEqual([
      "architect.toml",
      "compatibility-reviewer.toml",
      "critic.toml",
      "doc-updater.toml",
      "fixer.toml",
      "implementer.toml",
      "observability-reviewer.toml",
      "performance-reviewer.toml",
      "planner.toml",
      "product-manager.toml",
      "release-reviewer.toml",
      "researcher.toml",
      "reviewer.toml",
      "security-reviewer.toml",
      "slice-implementer.toml",
      "spec-validator.toml",
      "test-author.toml"
    ]);
    const codexPlanner = await fs.readFile(path.join(root, ".codex/agents/planner.toml"), "utf8");
    expect(codexPlanner).toContain('name = "planner"');
    expect(codexPlanner).toContain("developer_instructions");
    const generatedImplementer = await fs.readFile(path.join(root, ".cclaw/agents/implementer.md"), "utf8");
    expect(generatedImplementer).toContain("STRICT_RETURN_SCHEMA");

    const researchPlaybook = await fs.readFile(
      path.join(root, ".cclaw/skills/research/repo-scan.md"),
      "utf8"
    );
    expect(researchPlaybook).toContain("# Repo Scan Playbook");
    expect(researchPlaybook.startsWith("---")).toBe(false);
  });

  it("init removes crash-recovery sentinel after successful materialization and doctor flags leftovers", async () => {
    const root = await createTempProject("init-recovery-sentinel");
    await initCclaw({ projectRoot: root });

    const sentinelPath = path.join(root, ".cclaw/state/.init-in-progress");
    await expect(fs.stat(sentinelPath)).rejects.toBeDefined();

    await fs.writeFile(
      sentinelPath,
      `${JSON.stringify({ operation: "init", startedAt: "2026-04-27T00:00:00Z" }, null, 2)}
`,
      "utf8"
    );
    const checks = await doctorChecks(root);
    const recovery = checks.find((check) => check.name === "state:init_recovery");
    expect(recovery).toBeDefined();
    expect(recovery?.ok).toBe(false);
    expect(recovery?.details).toContain(".init-in-progress");
  });

  it("materializes state contracts and calibrated review prompts", async () => {
    const root = await createTempProject("init-state-contracts");
    await initCclaw({ projectRoot: root });
    for (const stage of FLOW_STAGES) {
      const raw = await fs.readFile(path.join(root, ".cclaw/templates/state-contracts", `${stage}.json`), "utf8");
      const parsed = JSON.parse(raw) as { stage?: string; requiredTopLevelFields?: unknown[]; taxonomies?: object; derivedMarkdownPath?: string };
      expect(parsed.stage).toBe(stage);
      expect(parsed.derivedMarkdownPath).toContain(".cclaw/artifacts/");
      expect(Array.isArray(parsed.requiredTopLevelFields)).toBe(true);
      expect(parsed.requiredTopLevelFields?.length).toBeGreaterThan(0);
      expect(parsed.taxonomies && typeof parsed.taxonomies).toBe("object");
    }
    for (const file of ["brainstorm-self-review.md", "scope-ceo-review.md", "design-eng-review.md"]) {
      const prompt = await fs.readFile(path.join(root, ".cclaw/skills/review-prompts", file), "utf8");
      expect(prompt).toContain("## Calibration");
    }
  });

  it("doctor reports broken generated CLI entrypoints in hook scripts", async () => {
    const root = await createTempProject("doctor-local-cli-entrypoint-broken");
    await initCclaw({ projectRoot: root });

    const stageCompletePath = path.join(root, ".cclaw/hooks/stage-complete.mjs");
    const original = await fs.readFile(stageCompletePath, "utf8");
    await fs.writeFile(
      stageCompletePath,
      original.replace(
        /const CCLAW_CLI_ENTRYPOINT = .*?;/u,
        `const CCLAW_CLI_ENTRYPOINT = ${JSON.stringify(path.join(root, "missing-cli.mjs"))};`
      ),
      "utf8"
    );

    const checks = await doctorChecks(root);
    const localCli = checks.find((c) => c.name === "hook:script:local_cli_entrypoint");
    expect(localCli).toBeDefined();
    expect(localCli?.ok).toBe(false);
    expect(localCli?.details).toContain("points to missing");
    expect(doctorSucceeded(checks)).toBe(false);
  });

  it("doctor warns about duplicate active stage artifacts", async () => {
    const root = await createTempProject("doctor-duplicate-artifacts");
    await initCclaw({ projectRoot: root });
    await fs.writeFile(path.join(root, ".cclaw/artifacts/03-design.md"), "# legacy design\n", "utf8");
    await fs.writeFile(path.join(root, ".cclaw/artifacts/03-design-runtime-polish.md"), "# slugged design\n", "utf8");

    const checks = await doctorChecks(root);
    const duplicateArtifacts = checks.find((c) => c.name === "warning:artifacts:duplicate_stage_artifacts");
    expect(duplicateArtifacts).toBeDefined();
    expect(duplicateArtifacts?.ok).toBe(false);
    expect(duplicateArtifacts?.details).toContain("design: 03-design-runtime-polish.md, 03-design.md");
    expect(doctorSucceeded(checks)).toBe(false);
  });

  it("doctor reports node and git binary/version checks", async () => {
    const root = await createTempProject("doctor-binary-version-checks");
    await initCclaw({ projectRoot: root, harnesses: ["claude"] });

    const checks = await doctorChecks(root);
    for (const name of [
      "capability:required:node",
      "capability:required:node_version",
      "capability:required:git",
      "capability:required:git_version"
    ]) {
      const check = checks.find((candidate) => candidate.name === name);
      expect(check).toBeDefined();
      expect(check?.ok).toBe(true);
    }
  });

  it("doctor reports semantic hook wiring drift for Codex", async () => {
    const root = await createTempProject("doctor-codex-wiring-drift");
    await initCclaw({ projectRoot: root, harnesses: ["codex"] });

    const codexHooksPath = path.join(root, ".codex/hooks.json");
    const codexHooks = JSON.parse(await fs.readFile(codexHooksPath, "utf8")) as {
      hooks: Record<string, unknown>;
    };
    codexHooks.hooks.UserPromptSubmit = [];
    await fs.writeFile(codexHooksPath, JSON.stringify(codexHooks, null, 2), "utf8");

    const checks = await doctorChecks(root);
    const wiring = checks.find((c) => c.name === "hook:wiring:codex");
    expect(wiring).toBeDefined();
    expect(wiring?.ok).toBe(false);
    expect(wiring?.details).toContain("verify-current-state");
    expect(doctorSucceeded(checks)).toBe(false);
  });

  it("doctor detects non-Bash Codex PreToolUse matcher drift structurally", async () => {
    await enableCodexHooksForDoctor();
    const root = await createTempProject("doctor-codex-matcher-drift");
    await initCclaw({ projectRoot: root, harnesses: ["codex"] });

    const codexHooksPath = path.join(root, ".codex/hooks.json");
    const codexHooks = JSON.parse(await fs.readFile(codexHooksPath, "utf8")) as {
      hooks: { PreToolUse: Array<{ matcher?: string }> };
    };
    if (codexHooks.hooks.PreToolUse[0]) {
      codexHooks.hooks.PreToolUse[0].matcher = "*";
    }
    await fs.writeFile(codexHooksPath, JSON.stringify(codexHooks, null, 2), "utf8");

    const checks = await doctorChecks(root);
    const structure = checks.find((c) => c.name === "hook:wiring:codex:structure");
    expect(structure).toBeDefined();
    expect(structure?.ok).toBe(false);
    expect(structure?.details).toContain("Bash-only");
    expect(doctorSucceeded(checks)).toBe(false);
  });

  it("doctor fails strict Codex installs when codex_hooks is inactive", async () => {
    const codexHome = await createTempProject("codex-home-inactive");
    process.env.CODEX_HOME = codexHome;
    await fs.writeFile(path.join(codexHome, "config.toml"), "[features]\ncodex_hooks = false\n", "utf8");
    const root = await createTempProject("doctor-codex-flag-strict");
    await initCclaw({ projectRoot: root, harnesses: ["codex"] });
    const current = await readConfig(root);
    await writeConfig(root, { ...current, strictness: "strict" });

    const checks = await doctorChecks(root);
    const flag = checks.find((c) => c.name === "hook:codex:feature_flag_active");
    expect(flag).toBeDefined();
    expect(flag?.ok).toBe(false);
    expect(flag?.summary).toContain("inactive");
    expect(flag?.details).toContain("inactive");
    expect(doctorSucceeded(checks)).toBe(false);
  });

  it("doctor warns advisory Codex installs when codex_hooks is inactive", async () => {
    const codexHome = await createTempProject("codex-home-advisory-inactive");
    process.env.CODEX_HOME = codexHome;
    await fs.writeFile(path.join(codexHome, "config.toml"), "[features]\ncodex_hooks = false\n", "utf8");
    const root = await createTempProject("doctor-codex-flag-advisory");
    await initCclaw({ projectRoot: root, harnesses: ["codex"] });

    const checks = await doctorChecks(root);
    const flag = checks.find((c) => c.name === "warning:codex:feature_flag");
    expect(flag).toBeDefined();
    expect(flag?.ok).toBe(false);
    expect(flag?.severity).toBe("warning");
    expect(flag?.summary).toContain("inactive");
    expect(flag?.details).toContain("inactive");
    expect(doctorSucceeded(checks)).toBe(false);
  });

  it("doctor treats legacy origin_feature as compatibility-only and warns canonical origin_run is missing", async () => {
    const root = await createTempProject("doctor-legacy-origin-feature");
    await initCclaw({ projectRoot: root, harnesses: ["claude"] });
    await fs.writeFile(
      path.join(root, ".cclaw/knowledge.jsonl"),
      `${JSON.stringify({
        type: "pattern",
        trigger: "legacy origin",
        action: "rewrite canonical origin_run",
        confidence: "medium",
        domain: null,
        stage: "plan",
        origin_stage: "plan",
        origin_feature: "legacy-run",
        frequency: 1,
        universality: "project",
        maturity: "raw",
        created: "2026-04-20T11:00:00Z",
        first_seen_ts: "2026-04-20T11:00:00Z",
        last_seen_ts: "2026-04-20T11:00:00Z",
        project: "cclaw"
      })}
`,
      "utf8"
    );

    const checks = await doctorChecks(root);
    const parseable = checks.find((check) => check.name === "knowledge:jsonl_parseable");
    const schemaFields = checks.find((check) => check.name === "warning:knowledge:schema_v2_fields");
    expect(parseable?.ok).toBe(true);
    expect(schemaFields?.details).toContain("miss schema v2 fields");
  });

  it("doctor emits severity, fix, and doc references", async () => {
    await enableCodexHooksForDoctor();
    const root = await createTempProject("doctor-metadata");
    await initCclaw({ projectRoot: root });

    const checks = await doctorChecks(root);
    const configCheck = checks.find((check) => check.name === "config:valid");
    const warningCheck = checks.find(
      (check) => check.name === "warning:windows:hook_dispatch_node_only"
    );

    expect(configCheck).toBeDefined();
    expect(configCheck?.severity).toBe("error");
    expect(configCheck?.fix.length).toBeGreaterThan(0);
    expect(configCheck?.docRef).toContain("docs/config.md");

    expect(warningCheck).toBeDefined();
    expect(warningCheck?.severity).toBe("warning");
  });

  it("doctor classifies all checks in a fresh install", async () => {
    await enableCodexHooksForDoctor();
    const root = await createTempProject("doctor-classification");
    await initCclaw({ projectRoot: root });

    const checks = await doctorChecks(root);
    const unclassified = checks.filter((check) => check.summary === "Unclassified doctor check.");
    expect(unclassified).toEqual([]);
  });

  it("doctor keeps runtime-integrity check families at error severity", async () => {
    await enableCodexHooksForDoctor();
    const root = await createTempProject("doctor-integrity-severity");
    await initCclaw({ projectRoot: root });

    const checks = await doctorChecks(root);

    const integrityPrefixes = [
      "hook:",
      "hooks:",
      "lifecycle:",
      "git_hooks:",
      "meta_skill:",
      "protocol:",
      "stage_skill:",
      "knowledge:",
      "artifacts:",
      "runs:",
      "flow_state:",
      "state:",
      "gates:",
      "trace:",
      "delegation:",
      "shim:",
      "dir:",
      "command:",
      "utility_command:",
      "stage_command:",
      "utility_skill:",
      "agent:",
      "harness_tool_ref:",
      "harness_ref:",
      "stage_examples_ref:",
      "doctor_ref:"
    ];

    const infoAllowlist = new Set(["gates:reconcile:writeback"]);

    const offenders = checks.filter((check) => {
      if (infoAllowlist.has(check.name)) return false;
      if (!integrityPrefixes.some((prefix) => check.name.startsWith(prefix))) return false;
      if (check.name.startsWith("warning:")) return false;
      if (/^skill:.*:(max_lines|min_lines|canonical_sections)$/u.test(check.name)) return false;
      return check.severity !== "error";
    });

    if (offenders.length > 0) {
      const detail = offenders
        .map((check) => `${check.name} -> severity=${check.severity}`)
        .join("\n");
      throw new Error(
        `Runtime-integrity checks must be error severity so doctor fails closed.\n${detail}`
      );
    }
  });

  it("doctor classifies every emitted check via an explicit registry rule", async () => {
    await enableCodexHooksForDoctor();
    const root = await createTempProject("doctor-fallback-free");
    await initCclaw({ projectRoot: root });

    const checks = await doctorChecks(root);

    const fallbackFix = "Report this check name to cclaw maintainers";
    const fellThrough = checks.filter((check) => check.fix.startsWith(fallbackFix));

    if (fellThrough.length > 0) {
      const detail = fellThrough.map((check) => check.name).sort().join("\n");
      throw new Error(
        `Doctor emitted checks that fell through to the fallback classifier:\n${detail}`
      );
    }
  });

  it("upgrade preserves user-authored strict config and only refreshes generated files", async () => {
    const root = await createTempProject("upgrade-preserve");
    await initCclaw({ projectRoot: root });

    const initial = await readConfig(root);
    await writeConfig(root, {
      ...initial,
      strictness: "strict",
      gitHookGuards: true,
      languageRulePacks: ["typescript", "python", "go"],
      trackHeuristics: {
        fallback: "standard",
        tracks: {
          quick: { triggers: ["hotfix"], veto: undefined },
          medium: undefined,
          standard: undefined
        }
      }
    });

    const before = await readConfig(root);
    expect(before.strictness).toBe("strict");
    expect(before.gitHookGuards).toBe(true);
    expect(before.languageRulePacks.length).toBeGreaterThan(0);

    const shim = path.join(root, ".claude/commands/cc.md");
    await fs.rm(shim);

    await upgradeCclaw(root);

    const after = await readConfig(root);
    expect(after.strictness).toBe("strict");
    expect(after.gitHookGuards).toBe(true);
    expect(after.languageRulePacks).toEqual(before.languageRulePacks);
    expect(after.trackHeuristics?.tracks?.quick?.triggers).toEqual(["hotfix"]);

    await expect(fs.stat(shim)).resolves.toBeDefined();
  });

  it("sync regenerates shim files, stage commands, and stage skills", async () => {
    const root = await createTempProject("sync");
    await initCclaw({ projectRoot: root });

    const shim = path.join(root, ".claude/commands/cc.md");
    const stageContract = path.join(root, ".cclaw/commands/plan.md");
    const skill = path.join(root, ".cclaw/skills/planning-and-task-breakdown/SKILL.md");
    await fs.rm(shim);
    await fs.writeFile(stageContract, "# corrupted stage shim\n", "utf8");
    await fs.writeFile(skill, "# corrupted\n", "utf8");
    await syncCclaw(root);

    const restored = await fs.readFile(shim, "utf8");
    const restoredStageContract = await fs.readFile(stageContract, "utf8");
    const restoredSkill = await fs.readFile(skill, "utf8");
    expect(restored).toContain(".cclaw/skills/flow-start/SKILL.md");
    expect(restoredStageContract).toContain(".cclaw/skills/planning-and-task-breakdown/SKILL.md");
    expect(restoredStageContract).toContain("Normal stage resume and advancement uses `/cc-next`");
    expect(restoredSkill).toContain("## Required Gates");
  });

  it("sync regenerates stage skills when defaultTrack changes", async () => {
    const root = await createTempProject("sync-track-contracts");
    await initCclaw({ projectRoot: root });
    const initialConfig = await readConfig(root);
    await writeConfig(root, {
      ...initialConfig,
      defaultTrack: "quick"
    });
    await syncCclaw(root);
    const quickTddSkill = await fs.readFile(path.join(root, ".cclaw/skills/test-driven-development/SKILL.md"), "utf8");
    expect(quickTddSkill).not.toContain("tdd_traceable_to_plan");

    await writeConfig(root, {
      ...(await readConfig(root)),
      defaultTrack: "standard"
    });
    await syncCclaw(root);
    const standardTddSkill = await fs.readFile(path.join(root, ".cclaw/skills/test-driven-development/SKILL.md"), "utf8");
    expect(standardTddSkill).toContain("tdd_traceable_to_plan");
  });

  it("sync removes stale generated shims, persists config, and keeps user-owned assets", async () => {
    const root = await createTempProject("cleanup");
    await initCclaw({ projectRoot: root });

    const staleShim = path.join(root, ".claude/commands/cc-obsolete.md");
    const staleStartShim = path.join(root, ".claude/commands/cc-start.md");
    const customAgent = path.join(root, ".cclaw/agents/custom-team-reviewer.md");
    const legacyGeneratedAgent = path.join(root, ".cclaw/agents/repo-research-analyst.md");
    const customSkillDir = path.join(root, ".cclaw/skills/team-custom-skill");
    const legacySkillDir = path.join(root, ".cclaw/skills/project-learnings");
    const legacyBrowserQaDir = path.join(root, ".cclaw/skills/browser-qa-testing");
    const configPath = path.join(root, ".cclaw/config.yaml");
    await fs.writeFile(staleShim, "# stale shim\n", "utf8");
    await fs.writeFile(staleStartShim, "# stale start shim\n", "utf8");
    await fs.writeFile(customAgent, "# user agent\n", "utf8");
    await fs.writeFile(legacyGeneratedAgent, "# legacy generated agent\n", "utf8");
    await fs.mkdir(customSkillDir, { recursive: true });
    await fs.writeFile(path.join(customSkillDir, "SKILL.md"), "# user skill\n", "utf8");
    await fs.mkdir(legacySkillDir, { recursive: true });
    await fs.writeFile(path.join(legacySkillDir, "SKILL.md"), "# legacy\n", "utf8");
    await fs.mkdir(legacyBrowserQaDir, { recursive: true });
    await fs.writeFile(path.join(legacyBrowserQaDir, "SKILL.md"), "# legacy browser qa\n", "utf8");
    await fs.rm(configPath);

    await syncCclaw(root);

    await expect(fs.stat(staleShim)).rejects.toBeDefined();
    await expect(fs.stat(staleStartShim)).rejects.toBeDefined();
    await expect(fs.stat(customAgent)).resolves.toBeDefined();
    await expect(fs.stat(legacyGeneratedAgent)).rejects.toBeDefined();
    await expect(fs.stat(customSkillDir)).resolves.toBeDefined();
    await expect(fs.stat(legacySkillDir)).rejects.toBeDefined();
    await expect(fs.stat(legacyBrowserQaDir)).rejects.toBeDefined();
    await expect(fs.stat(configPath)).resolves.toBeDefined();
  });

  it("sync installs managed git hooks when opt-in is enabled", async () => {
    const root = await createTempProject("git-hooks");
    await execFileAsync("git", ["init"], { cwd: root });
    await initCclaw({ projectRoot: root });

    const current = await readConfig(root);
    await writeConfig(root, {
      ...current,
      strictness: "strict",
      gitHookGuards: true
    });
    await syncCclaw(root);

    const preCommitRelay = await fs.readFile(path.join(root, ".git/hooks/pre-commit"), "utf8");
    const prePushRelay = await fs.readFile(path.join(root, ".git/hooks/pre-push"), "utf8");
    expect(preCommitRelay).toContain("cclaw-managed-git-hook");
    expect(prePushRelay).toContain("cclaw-managed-git-hook");

    const runtimePreCommit = await fs.readFile(path.join(root, ".cclaw/hooks/git/pre-commit.mjs"), "utf8");
    const runtimePrePush = await fs.readFile(path.join(root, ".cclaw/hooks/git/pre-push.mjs"), "utf8");
    expect(runtimePreCommit).toContain("run-hook.mjs");
    expect(runtimePrePush).toContain("run-hook.mjs");
    expect(runtimePrePush).toContain("changedFilesFromPrePushStdin");
    expect(runtimePrePush).toContain('remoteSha + ".." + localSha');
    expect(runtimePrePush).toContain("changedFilesFromUnpushedCommits");

    const hookRuntime = await fs.readFile(path.join(root, ".cclaw/hooks/run-hook.mjs"), "utf8");
    expect(hookRuntime).toContain('const DEFAULT_STRICTNESS = "strict";');
  });

  it("sync removes managed artifacts for harnesses removed from config", async () => {
    const root = await createTempProject("harness-remove");
    await initCclaw({ projectRoot: root });

    const current = await readConfig(root);
    await writeConfig(root, {
      ...current,
      harnesses: ["claude", "codex"]
    });
    await syncCclaw(root);

    await expect(fs.stat(path.join(root, ".opencode/plugins/cclaw-plugin.mjs"))).rejects.toBeDefined();
    await expect(fs.stat(path.join(root, ".cursor/rules/cclaw-workflow.mdc"))).rejects.toBeDefined();

    const opencodeConfigPath = path.join(root, "opencode.json");
    const opencodeConfigExists = await fs.stat(opencodeConfigPath).then(() => true).catch(() => false);
    if (opencodeConfigExists) {
      const opencodeConfigRaw = await fs.readFile(opencodeConfigPath, "utf8");
      expect(opencodeConfigRaw).not.toContain(".opencode/plugins/cclaw-plugin.mjs");
    }

    const cursorHooksPath = path.join(root, ".cursor/hooks.json");
    const cursorHooksExists = await fs.stat(cursorHooksPath).then(() => true).catch(() => false);
    if (cursorHooksExists) {
      const cursorHooksRaw = await fs.readFile(cursorHooksPath, "utf8");
      expect(cursorHooksRaw).not.toContain(".cclaw/hooks/");
    }

    const checks = await doctorChecks(root);
    expect(doctorSucceeded(checks)).toBe(false);
  });

  it("sync merges generated hooks with user hooks without duplication", async () => {
    const root = await createTempProject("hooks-merge");
    await initCclaw({ projectRoot: root });

    const claudeHooksPath = path.join(root, ".claude/hooks/hooks.json");
    const cursorHooksPath = path.join(root, ".cursor/hooks.json");

    await fs.writeFile(claudeHooksPath, JSON.stringify({
      hooks: {
        Stop: [{
          hooks: [{ type: "command", command: "echo user-stop-hook" }]
        }],
        UserPromptSubmit: [{
          hooks: [{ type: "command", command: "echo user-prompt-submit" }]
        }]
      }
    }, null, 2), "utf8");

    await fs.writeFile(cursorHooksPath, JSON.stringify({
      version: 1,
      hooks: {
        stop: [{ command: "echo cursor-user-stop" }],
        preToolUse: [{ matcher: "*", command: "echo cursor-user-pre" }]
      }
    }, null, 2), "utf8");

    await syncCclaw(root);
    await syncCclaw(root);

    const mergedClaude = await fs.readFile(claudeHooksPath, "utf8");
    const mergedCursor = await fs.readFile(cursorHooksPath, "utf8");

    expect(mergedClaude).toContain("user-stop-hook");
    expect(mergedClaude).toContain("user-prompt-submit");
    expect(countOccurrences(mergedClaude, ".cclaw/hooks/run-hook.cmd prompt-guard")).toBe(1);
    expect(countOccurrences(mergedClaude, ".cclaw/hooks/run-hook.cmd workflow-guard")).toBe(1);
    expect(countOccurrences(mergedClaude, ".cclaw/hooks/run-hook.cmd context-monitor")).toBe(1);
    expect(countOccurrences(mergedClaude, ".cclaw/hooks/run-hook.cmd stop-handoff")).toBe(1);

    expect(mergedCursor).toContain("cursor-user-stop");
    expect(mergedCursor).toContain("cursor-user-pre");
    expect(countOccurrences(mergedCursor, ".cclaw/hooks/run-hook.cmd prompt-guard")).toBe(1);
    expect(countOccurrences(mergedCursor, ".cclaw/hooks/run-hook.cmd workflow-guard")).toBe(1);
    expect(countOccurrences(mergedCursor, ".cclaw/hooks/run-hook.cmd context-monitor")).toBe(1);
    expect(countOccurrences(mergedCursor, ".cclaw/hooks/run-hook.cmd stop-handoff")).toBe(1);
  });

  it("sync collapses duplicate user-preserved hook commands during merge", async () => {
    const root = await createTempProject("hooks-merge-command-dedupe");
    await initCclaw({ projectRoot: root, harnesses: ["cursor"] });

    const cursorHooksPath = path.join(root, ".cursor/hooks.json");
    await fs.writeFile(cursorHooksPath, JSON.stringify({
      version: 1,
      hooks: {
        stop: [
          { command: "echo duplicate-user-hook" },
          { command: " echo   duplicate-user-hook " }
        ]
      }
    }, null, 2), "utf8");

    await syncCclaw(root);
    const merged = await fs.readFile(cursorHooksPath, "utf8");
    expect(countOccurrences(merged, "duplicate-user-hook")).toBe(1);
  });

  it("sync recovers relaxed JSON hooks and preserves user commands", async () => {
    const root = await createTempProject("hooks-recover");
    await initCclaw({ projectRoot: root });

    const claudeHooksPath = path.join(root, ".claude/hooks/hooks.json");
    await fs.writeFile(claudeHooksPath, `{
  // user custom hook
  "hooks": {
    "Stop": [{
      "hooks": [
        { "type": "command", "command": "echo user-relaxed-stop" },
      ],
    }],
  },
}
`, "utf8");

    await syncCclaw(root);
    const merged = await fs.readFile(claudeHooksPath, "utf8");
    expect(merged).toContain("user-relaxed-stop");
    expect(countOccurrences(merged, ".cclaw/hooks/run-hook.cmd prompt-guard")).toBe(1);

    const backupsDir = path.join(root, ".cclaw/backups/hooks");
    const backups = await fs.readdir(backupsDir);
    expect(backups.length).toBeGreaterThan(0);
  });

  it("sync backs up unrecoverable hook json before rewriting", async () => {
    const root = await createTempProject("hooks-backup");
    await initCclaw({ projectRoot: root });

    const cursorHooksPath = path.join(root, ".cursor/hooks.json");
    const brokenContent = "{ broken::json<<<";
    await fs.writeFile(cursorHooksPath, brokenContent, "utf8");

    await syncCclaw(root);

    const rewritten = JSON.parse(await fs.readFile(cursorHooksPath, "utf8")) as {
      hooks?: unknown;
    };
    expect(typeof rewritten.hooks).toBe("object");
    expect(rewritten.hooks).not.toBeNull();

    const backupsDir = path.join(root, ".cclaw/backups/hooks");
    const backups = await fs.readdir(backupsDir);
    expect(backups.length).toBeGreaterThan(0);
    const contents = await Promise.all(backups.map(async (entry) => (
      await fs.readFile(path.join(backupsDir, entry), "utf8")
    )));
    expect(contents.some((value) => value.includes("{ broken::json<<<"))).toBe(true);
  });

  it("uninstall removes runtime and generated shim files", async () => {
    const root = await createTempProject("uninstall");
    await initCclaw({ projectRoot: root });

    await uninstallCclaw(root);

    await expect(fs.stat(path.join(root, ".cclaw"))).rejects.toBeDefined();
    await expect(fs.stat(path.join(root, ".claude/commands/cc-brainstorm.md"))).rejects.toBeDefined();
    await expect(fs.stat(path.join(root, ".cursor/hooks.json"))).rejects.toBeDefined();
    await expect(fs.stat(path.join(root, ".cursor/rules/cclaw-workflow.mdc"))).rejects.toBeDefined();
  });

  it("uninstall removes empty harness directories created by cclaw", async () => {
    const root = await createTempProject("uninstall-dirs");
    await initCclaw({ projectRoot: root });

    await expect(fs.stat(path.join(root, ".claude"))).resolves.toBeDefined();
    await expect(fs.stat(path.join(root, ".cursor"))).resolves.toBeDefined();
    // Codex in v0.40.0: skills under `.agents/skills/cc*/SKILL.md` and
    // hooks at `.codex/hooks.json`. Both must be present after init.
    await expect(fs.stat(path.join(root, ".agents/skills/cc/SKILL.md"))).resolves.toBeDefined();
    await expect(fs.stat(path.join(root, ".codex/hooks.json"))).resolves.toBeDefined();
    await expect(fs.stat(path.join(root, ".opencode"))).resolves.toBeDefined();

    await uninstallCclaw(root);

    await expect(fs.stat(path.join(root, ".claude"))).rejects.toBeDefined();
    await expect(fs.stat(path.join(root, ".cursor"))).rejects.toBeDefined();
    await expect(fs.stat(path.join(root, ".agents"))).rejects.toBeDefined();
    await expect(fs.stat(path.join(root, ".codex"))).rejects.toBeDefined();
    await expect(fs.stat(path.join(root, ".opencode"))).rejects.toBeDefined();
  });

  it("language rule packs: disabled by default, sync only materializes enabled packs", async () => {
    const root = await createTempProject("lang-rule-packs");
    await initCclaw({ projectRoot: root });

    await expect(
      fs.stat(path.join(root, ".cclaw/rules/lang/typescript.md"))
    ).rejects.toBeDefined();
    await expect(
      fs.stat(path.join(root, ".cclaw/rules/lang/python.md"))
    ).rejects.toBeDefined();
    await expect(
      fs.stat(path.join(root, ".cclaw/rules/lang/go.md"))
    ).rejects.toBeDefined();

    const current = await readConfig(root);
    await writeConfig(root, { ...current, languageRulePacks: ["typescript", "go"] });
    await syncCclaw(root);

    await expect(
      fs.stat(path.join(root, ".cclaw/rules/lang/typescript.md"))
    ).resolves.toBeDefined();
    await expect(
      fs.stat(path.join(root, ".cclaw/rules/lang/go.md"))
    ).resolves.toBeDefined();
    await expect(
      fs.stat(path.join(root, ".cclaw/rules/lang/python.md"))
    ).rejects.toBeDefined();

    const checks = await doctorChecks(root);
    expect(checks.some((c) => c.name === "language_rule_pack:typescript" && c.ok)).toBe(true);
    expect(checks.some((c) => c.name === "language_rule_pack:go" && c.ok)).toBe(true);
    expect(checks.some((c) => c.name === "language_rule_pack:python")).toBe(false);
  });

  it("sync removes language pack files when their pack is disabled in config", async () => {
    const root = await createTempProject("lang-rule-packs-disable");
    await initCclaw({ projectRoot: root });

    const current = await readConfig(root);
    await writeConfig(root, {
      ...current,
      languageRulePacks: ["typescript", "python", "go"]
    });
    await syncCclaw(root);

    await expect(
      fs.stat(path.join(root, ".cclaw/rules/lang/typescript.md"))
    ).resolves.toBeDefined();
    await expect(
      fs.stat(path.join(root, ".cclaw/rules/lang/python.md"))
    ).resolves.toBeDefined();
    await expect(
      fs.stat(path.join(root, ".cclaw/rules/lang/go.md"))
    ).resolves.toBeDefined();

    await writeConfig(root, { ...current, languageRulePacks: ["typescript"] });
    await syncCclaw(root);

    await expect(
      fs.stat(path.join(root, ".cclaw/rules/lang/typescript.md"))
    ).resolves.toBeDefined();
    await expect(
      fs.stat(path.join(root, ".cclaw/rules/lang/python.md"))
    ).rejects.toBeDefined();
    await expect(
      fs.stat(path.join(root, ".cclaw/rules/lang/go.md"))
    ).rejects.toBeDefined();
  });

  it("sync migrates legacy .cclaw/skills/language-* folders to .cclaw/rules/lang/", async () => {
    const root = await createTempProject("lang-rule-packs-legacy");
    await initCclaw({ projectRoot: root });

    const legacyPath = path.join(root, ".cclaw/skills/language-typescript/SKILL.md");
    await fs.mkdir(path.dirname(legacyPath), { recursive: true });
    await fs.writeFile(legacyPath, "# legacy\n", "utf8");

    const current = await readConfig(root);
    await writeConfig(root, { ...current, languageRulePacks: ["typescript"] });
    await syncCclaw(root);

    await expect(fs.stat(legacyPath)).rejects.toBeDefined();
    await expect(
      fs.stat(path.join(root, ".cclaw/skills/language-typescript"))
    ).rejects.toBeDefined();
    await expect(
      fs.stat(path.join(root, ".cclaw/rules/lang/typescript.md"))
    ).resolves.toBeDefined();

    const checks = await doctorChecks(root);
    expect(
      checks.some(
        (c) => c.name === "language_rule_pack:no_legacy:language-typescript" && c.ok
      )
    ).toBe(true);
  });

  it("uninstall preserves harness directories that contain user files", async () => {
    const root = await createTempProject("uninstall-preserve");
    await initCclaw({ projectRoot: root });

    await fs.writeFile(path.join(root, ".claude/commands/my-custom.md"), "# user\n", "utf8");
    await fs.writeFile(path.join(root, ".cursor/settings.json"), "{}", "utf8");

    await uninstallCclaw(root);

    await expect(fs.stat(path.join(root, ".claude/commands/my-custom.md"))).resolves.toBeDefined();
    await expect(fs.stat(path.join(root, ".cursor/settings.json"))).resolves.toBeDefined();
    await expect(fs.stat(path.join(root, ".codex"))).rejects.toBeDefined();
    await expect(fs.stat(path.join(root, ".opencode"))).rejects.toBeDefined();
  });

  it("warns when sliceReview is enabled and tdd artifact lacks Per-Slice Review", async () => {
    const root = await createTempProject("slice-review-warn-missing");
    await initCclaw({ projectRoot: root });

    const current = await readConfig(root);
    await writeConfig(root, {
      ...current,
      sliceReview: { enabled: true, filesChangedThreshold: 5, touchTriggers: [], enforceOnTracks: ["standard"] }
    });

    await fs.writeFile(
      path.join(root, ".cclaw/artifacts/06-tdd.md"),
      `# TDD\n\n## Acceptance Mapping\n- T-001 → R-001\n\n### Slice T-001\n\n## RED\nfailing output\n\n## GREEN\npassing output\n`,
      "utf8"
    );

    const checks = await doctorChecks(root);
    const warning = checks.find((c) => c.name === "warning:slice_review:missing_section");
    expect(warning).toBeDefined();
    expect(warning?.ok).toBe(false);
    expect(warning?.severity).toBe("warning");
    expect(warning?.details).toMatch(/Per-Slice Review/);
  });

  it("stays silent when Per-Slice Review section is present", async () => {
    const root = await createTempProject("slice-review-warn-present");
    await initCclaw({ projectRoot: root });

    const current = await readConfig(root);
    await writeConfig(root, {
      ...current,
      sliceReview: { enabled: true, filesChangedThreshold: 5, touchTriggers: [], enforceOnTracks: ["standard"] }
    });

    await fs.writeFile(
      path.join(root, ".cclaw/artifacts/06-tdd.md"),
      `# TDD\n\n## Acceptance Mapping\n- T-001 → R-001\n\n### Slice T-001\n\n## RED\nfailing output\n\n## GREEN\npassing output\n\n## Per-Slice Review\n- Slice T-001: not triggered (touchCount=2).\n`,
      "utf8"
    );

    const checks = await doctorChecks(root);
    const warning = checks.find((c) => c.name === "warning:slice_review:missing_section");
    expect(warning).toBeDefined();
    expect(warning?.ok).toBe(true);
  });

  it("does not evaluate slice review when feature is disabled", async () => {
    const root = await createTempProject("slice-review-warn-disabled");
    await initCclaw({ projectRoot: root });

    await fs.writeFile(
      path.join(root, ".cclaw/artifacts/06-tdd.md"),
      `# TDD\n\n## Acceptance Mapping\n- T-001 → R-001\n\n## RED\nfailing output\n`,
      "utf8"
    );

    const checks = await doctorChecks(root);
    expect(checks.find((c) => c.name === "warning:slice_review:missing_section")).toBeUndefined();
  });

  it("warns when configured track heuristics disagree with active track", async () => {
    const root = await createTempProject("track-heuristics-mismatch");
    await initCclaw({ projectRoot: root });

    const current = await readConfig(root);
    await writeConfig(root, {
      ...current,
      trackHeuristics: {
        fallback: "standard",
        tracks: {
          quick: { triggers: ["hotfix"], veto: undefined },
          medium: undefined,
          standard: undefined
        }
      }
    });
    await fs.writeFile(
      path.join(root, ".cclaw/artifacts/00-idea.md"),
      `Class: software-bugfix\nTrack: standard\nStack: unknown\n\n## User prompt\n\nhotfix login typo in auth flow\n`,
      "utf8"
    );

    const checks = await doctorChecks(root);
    const warning = checks.find((c) => c.name === "warning:track_heuristics:advisory_alignment");
    expect(warning).toBeDefined();
    expect(warning?.ok).toBe(false);
    expect(warning?.details).toMatch(/predicts "quick"/);
    expect(warning?.details).toMatch(/flow-state track is "standard"/);
  });

  it("stays green when configured track heuristics align with active track", async () => {
    const root = await createTempProject("track-heuristics-aligned");
    await initCclaw({ projectRoot: root });

    const current = await readConfig(root);
    await writeConfig(root, {
      ...current,
      trackHeuristics: {
        fallback: "standard",
        tracks: {
          quick: { triggers: ["hotfix"], veto: undefined },
          medium: undefined,
          standard: undefined
        }
      }
    });
    await fs.writeFile(
      path.join(root, ".cclaw/artifacts/00-idea.md"),
      `Class: software-standard\nTrack: standard\nStack: unknown\n\n## User prompt\n\nnew feature: billing workflow redesign\n`,
      "utf8"
    );

    const checks = await doctorChecks(root);
    const warning = checks.find((c) => c.name === "warning:track_heuristics:advisory_alignment");
    expect(warning).toBeDefined();
    expect(warning?.ok).toBe(true);
    expect(warning?.details).toMatch(/matches active track "standard"/);
  });

  it("warns about stale raw knowledge entries older than 90 days", async () => {
    const root = await createTempProject("knowledge-stale-raw");
    await initCclaw({ projectRoot: root });

    const tenYearsAgo = new Date(Date.now() - 3650 * 24 * 60 * 60 * 1000).toISOString();
    const staleLine = JSON.stringify({
      type: "pattern",
      trigger: "when payload is unchecked",
      action: "parse through zod",
      confidence: "medium",
      domain: "api",
      stage: "review",
      origin_stage: "review",
      origin_run: "payload-hardening",
      frequency: 1,
      universality: "project",
      maturity: "raw",
      created: tenYearsAgo,
      first_seen_ts: tenYearsAgo,
      last_seen_ts: tenYearsAgo,
      project: "demo"
    });
    await fs.writeFile(path.join(root, ".cclaw/knowledge.jsonl"), staleLine + "\n", "utf8");

    const checks = await doctorChecks(root);
    const warning = checks.find((c) => c.name === "warning:knowledge:stale_raw_entries");
    expect(warning).toBeDefined();
    expect(warning?.ok).toBe(true);
    expect(warning?.details).toMatch(/1 raw knowledge entry/);
    expect(warning?.details).toMatch(/older than 90 days/);
  });

  it("stays silent about stale entries when raw entries are fresh", async () => {
    const root = await createTempProject("knowledge-fresh-raw");
    await initCclaw({ projectRoot: root });

    const nowIso = new Date().toISOString();
    const freshLine = JSON.stringify({
      type: "pattern",
      trigger: "when payload is unchecked",
      action: "parse through zod",
      confidence: "high",
      domain: "api",
      stage: "review",
      origin_stage: "review",
      origin_run: "payload-hardening",
      frequency: 1,
      universality: "project",
      maturity: "raw",
      created: nowIso,
      first_seen_ts: nowIso,
      last_seen_ts: nowIso,
      project: "demo"
    });
    await fs.writeFile(path.join(root, ".cclaw/knowledge.jsonl"), freshLine + "\n", "utf8");

    const checks = await doctorChecks(root);
    const warning = checks.find((c) => c.name === "warning:knowledge:stale_raw_entries");
    expect(warning).toBeDefined();
    expect(warning?.ok).toBe(true);
    expect(warning?.details).toMatch(/no raw knowledge entries older than 90 days/);
  });

  it("warns when knowledge entries violate the current schema", async () => {
    const root = await createTempProject("knowledge-current-schema");
    await initCclaw({ projectRoot: root });

    const nowIso = new Date().toISOString().replace(/\.\d{3}Z$/u, "Z");
    const invalidLine = JSON.stringify({
      type: "note",
      trigger: "",
      action: "parse through zod",
      confidence: "medium",
      domain: "api",
      stage: "review",
      origin_stage: "review",
      origin_run: "payload-hardening",
      frequency: 1,
      universality: "project",
      maturity: "raw",
      created: nowIso,
      first_seen_ts: nowIso,
      last_seen_ts: nowIso,
      project: "demo"
    });
    await fs.writeFile(path.join(root, ".cclaw/knowledge.jsonl"), invalidLine + "\n", "utf8");

    const checks = await doctorChecks(root);
    const warning = checks.find((c) => c.name === "warning:knowledge:current_schema");
    expect(warning).toBeDefined();
    expect(warning?.ok).toBe(false);
    expect(warning?.severity).toBe("warning");
    expect(warning?.details).toMatch(/type must be one of: rule, pattern, lesson, compound/);
    expect(doctorSucceeded(checks)).toBe(false);
  });

  it("warns when routing docs do not surface knowledge store usage", async () => {
    const root = await createTempProject("knowledge-discoverability");
    await initCclaw({ projectRoot: root });

    await fs.writeFile(path.join(root, "AGENTS.md"), "# Agents\n\nUse the workflow.\n", "utf8");
    await fs.writeFile(path.join(root, "CLAUDE.md"), "# Claude\n\nUse the workflow.\n", "utf8");

    const checks = await doctorChecks(root);
    const warning = checks.find((c) => c.name === "warning:knowledge:discoverability");
    expect(warning).toBeDefined();
    expect(warning?.ok).toBe(false);
    expect(warning?.severity).toBe("warning");
    expect(warning?.details).toContain(".cclaw/knowledge.jsonl");
    expect(warning?.details).toContain("type/trigger/action/origin_run");
  });

  it("accepts routing docs that surface knowledge store usage", async () => {
    const root = await createTempProject("knowledge-discoverability-ok");
    await initCclaw({ projectRoot: root });

    await fs.writeFile(
      path.join(root, "AGENTS.md"),
      "# Agents\n\nKnowledge lives in .cclaw/knowledge.jsonl. Use type rule|pattern|lesson|compound with trigger, action, and origin_run fields.\n",
      "utf8"
    );
    await fs.rm(path.join(root, "CLAUDE.md"), { force: true });

    const checks = await doctorChecks(root);
    const warning = checks.find((c) => c.name === "warning:knowledge:discoverability");
    expect(warning).toBeDefined();
    expect(warning?.ok).toBe(true);
    expect(warning?.details).toContain("AGENTS.md");
  });

  it("warns about orphan seed shelf entries", async () => {
    const root = await createTempProject("knowledge-orphan-seeds");
    await initCclaw({ projectRoot: root });

    const seedPath = path.join(root, ".cclaw/seeds/SEED-2026-04-25-api-shape.md");
    await fs.mkdir(path.dirname(seedPath), { recursive: true });
    await fs.writeFile(
      seedPath,
      `---
title: API shape
trigger_when:
  - api
---
# API shape

Capture this later.
`,
      "utf8"
    );

    const checks = await doctorChecks(root);
    const warning = checks.find((c) => c.name === "warning:knowledge:orphan_seeds");
    expect(warning).toBeDefined();
    expect(warning?.ok).toBe(false);
    expect(warning?.severity).toBe("warning");
    expect(warning?.details.replace(/\\/gu, "/")).toContain(".cclaw/seeds/SEED-2026-04-25-api-shape.md");
  });

  it("accepts discoverable seed shelf entries", async () => {
    const root = await createTempProject("knowledge-seeds-ok");
    await initCclaw({ projectRoot: root });

    const seedPath = path.join(root, ".cclaw/seeds/SEED-2026-04-25-api-shape.md");
    await fs.mkdir(path.dirname(seedPath), { recursive: true });
    await fs.writeFile(
      seedPath,
      `---
title: API shape
source_artifact: .cclaw/artifacts/00-idea.md
trigger_when:
  - api
action: Revisit the API shape before spec.
---
# API shape

Capture this later.
`,
      "utf8"
    );

    const checks = await doctorChecks(root);
    const warning = checks.find((c) => c.name === "warning:knowledge:orphan_seeds");
    expect(warning).toBeDefined();
    expect(warning?.ok).toBe(true);
    expect(warning?.details).toMatch(/all 1 seed shelf entry is discoverable/);
  });

  it("flags unsynced reconciliation notices and clears them with reconcile-gates", async () => {
    const root = await createTempProject("doctor-reconciliation-notices");
    await initCclaw({ projectRoot: root });
    const flow = JSON.parse(
      await fs.readFile(path.join(root, ".cclaw/state/flow-state.json"), "utf8")
    ) as { activeRunId?: string };
    const runId = typeof flow.activeRunId === "string" && flow.activeRunId.length > 0
      ? flow.activeRunId
      : "active";
    await fs.writeFile(
      path.join(root, ".cclaw/state/reconciliation-notices.json"),
      JSON.stringify({
        schemaVersion: 1,
        notices: [
          {
            id: "active:brainstorm:brainstorm_context_explored:2026-04-20T00:00:00.000Z",
            runId,
            stage: "brainstorm",
            gateId: "brainstorm_context_explored",
            reason: "demoted from passed to blocked during gate reconciliation (missing evidence)",
            demotedAt: "2026-04-20T00:00:00.000Z"
          }
        ]
      }, null, 2),
      "utf8"
    );

    const checks = await doctorChecks(root);
    const staleNotice = checks.find((c) => c.name === "state:reconciliation_notices");
    expect(staleNotice).toBeDefined();
    expect(staleNotice?.ok).toBe(false);
    expect(staleNotice?.details).toMatch(/brainstorm\.brainstorm_context_explored/);

    const reconciledChecks = await doctorChecks(root, { reconcileCurrentStageGates: true });
    const cleared = reconciledChecks.find((c) => c.name === "state:reconciliation_notices");
    expect(cleared).toBeDefined();
    expect(cleared?.ok).toBe(true);
    expect(cleared?.details).toMatch(/no active reconciliation notices/i);
  });

  it("reports reconciliation notices parse errors explicitly", async () => {
    const root = await createTempProject("doctor-reconciliation-notices-parse");
    await initCclaw({ projectRoot: root });
    await fs.writeFile(
      path.join(root, ".cclaw/state/reconciliation-notices.json"),
      "{not-valid-json",
      "utf8"
    );

    const checks = await doctorChecks(root);
    const parseCheck = checks.find((c) => c.name === "state:reconciliation_notices_parse");
    expect(parseCheck).toBeDefined();
    expect(parseCheck?.ok).toBe(false);
    expect(parseCheck?.details).toMatch(/unable to parse/i);
  });

  it("does not crash doctor on corrupt flow-state.json and reports a readable-state error", async () => {
    const root = await createTempProject("doctor-corrupt-flow-state");
    await initCclaw({ projectRoot: root });
    await fs.writeFile(path.join(root, ".cclaw/state/flow-state.json"), "{broken-json", "utf8");

    const checks = await doctorChecks(root);
    const flowReadable = checks.find((c) => c.name === "flow_state:readable");
    expect(flowReadable).toBeDefined();
    expect(flowReadable?.ok).toBe(false);
    expect(flowReadable?.details).toMatch(/Corrupt flow-state\.json detected/i);
  });

  it("checks OpenCode structured-question prerequisites", async () => {
    const root = await createTempProject("doctor-opencode-question-prereqs");
    await initCclaw({ projectRoot: root });
    await fs.writeFile(
      path.join(root, "opencode.json"),
      JSON.stringify({ plugin: [] }, null, 2),
      "utf8"
    );
    await fs.mkdir(path.join(root, ".opencode"), { recursive: true });
    await fs.writeFile(
      path.join(root, ".opencode/opencode.json"),
      JSON.stringify({ plugin: [".opencode/plugins/cclaw-plugin.mjs"] }, null, 2),
      "utf8"
    );

    const previousQuestionToolEnv = process.env.OPENCODE_ENABLE_QUESTION_TOOL;
    delete process.env.OPENCODE_ENABLE_QUESTION_TOOL;
    try {
      const checks = await doctorChecks(root);
      const registration = checks.find((c) => c.name === "hook:opencode:config_registration");
      const permission = checks.find((c) => c.name === "hook:opencode:question_permission");
      const env = checks.find((c) => c.name === "warning:opencode:question_tool_env");
      expect(registration).toBeDefined();
      expect(registration?.ok).toBe(true);
      expect(permission).toBeDefined();
      expect(permission?.ok).toBe(false);
      expect(permission?.details).toContain('permission.question to "allow"');
      expect(env).toBeDefined();
      expect(env?.ok).toBe(false);
      expect(env?.severity).toBe("warning");
      expect(env?.details).toContain("OPENCODE_ENABLE_QUESTION_TOOL=1");
    } finally {
      if (previousQuestionToolEnv === undefined) {
        delete process.env.OPENCODE_ENABLE_QUESTION_TOOL;
      } else {
        process.env.OPENCODE_ENABLE_QUESTION_TOOL = previousQuestionToolEnv;
      }
    }
  });

  it("codex install materializes .agents/skills/cc*/SKILL.md and .codex/hooks.json", async () => {
    const root = await createTempProject("codex-skills-fresh");
    await initCclaw({ projectRoot: root, harnesses: ["codex"] });

    const expectedSkills = ["cc", "cc-next", "cc-view", "cc-ideate"];
    for (const slug of expectedSkills) {
      const skillPath = path.join(root, ".agents/skills", slug, "SKILL.md");
      const body = await fs.readFile(skillPath, "utf8");
      expect(body.startsWith("---\n")).toBe(true);
      const frontmatter = body.split("\n---\n")[0] ?? "";
      expect(frontmatter).toMatch(new RegExp(`^name:\\s*${slug}$`, "m"));
      expect(frontmatter).toMatch(/^description:\s+.+/m);
      expect(body).toContain(".cclaw/");
    }

    // Codex hooks are managed again in v0.40.0 — gated by the
    // `codex_hooks` feature flag in `~/.codex/config.toml`.
    const codexHooks = JSON.parse(
      await fs.readFile(path.join(root, ".codex/hooks.json"), "utf8")
    ) as {
      hooks: Record<string, unknown>;
    };
    expect(codexHooks.hooks).toHaveProperty("SessionStart");
    expect(codexHooks.hooks).toHaveProperty("UserPromptSubmit");
    expect(codexHooks.hooks).toHaveProperty("PreToolUse");
    expect(codexHooks.hooks).toHaveProperty("PostToolUse");
    expect(codexHooks.hooks).toHaveProperty("Stop");
    expect(JSON.stringify(codexHooks)).toContain("verify-current-state");
    expect(JSON.stringify(codexHooks.hooks.UserPromptSubmit)).not.toContain("workflow-guard");

    // `.codex/commands/*` is still never consumed by Codex.
    await expect(fs.stat(path.join(root, ".codex/commands"))).rejects.toThrow(/ENOENT/);

    // AGENTS.md should explicitly explain Codex's /use activation.
    const agentsMd = await fs.readFile(path.join(root, "AGENTS.md"), "utf8");
    expect(agentsMd).toMatch(/Codex users/i);
    expect(agentsMd).toContain("/use cc");
  });

  it("sync cleans up legacy .codex/commands and legacy cclaw-cc* skills from older cclaw versions", async () => {
    const root = await createTempProject("codex-legacy-cleanup");
    await initCclaw({ projectRoot: root, harnesses: ["codex"] });

    // Plant legacy artefacts that older cclaw versions would have written.
    await fs.mkdir(path.join(root, ".codex/commands"), { recursive: true });
    await fs.writeFile(
      path.join(root, ".codex/commands/cc.md"),
      "# legacy cc prompt\n",
      "utf8"
    );
    // v0.39.x layout that v0.40.0 renames: `.agents/skills/cclaw-cc*/`.
    await fs.mkdir(path.join(root, ".agents/skills/cclaw-cc"), { recursive: true });
    await fs.writeFile(
      path.join(root, ".agents/skills/cclaw-cc/SKILL.md"),
      "---\nname: cclaw-cc\ndescription: legacy\n---\nlegacy body\n",
      "utf8"
    );
    await fs.mkdir(path.join(root, ".agents/skills/cclaw-cc-obsolete"), { recursive: true });
    await fs.writeFile(
      path.join(root, ".agents/skills/cclaw-cc-obsolete/SKILL.md"),
      "---\nname: cclaw-cc-obsolete\ndescription: legacy\n---\nlegacy body\n",
      "utf8"
    );

    await syncCclaw(root);

    // .codex/commands/ and the legacy cclaw-cc folder must both be gone.
    await expect(fs.stat(path.join(root, ".codex/commands"))).rejects.toThrow(/ENOENT/);
    await expect(fs.stat(path.join(root, ".agents/skills/cclaw-cc"))).rejects.toThrow(/ENOENT/);
    await expect(fs.stat(path.join(root, ".agents/skills/cclaw-cc-obsolete"))).rejects.toThrow(/ENOENT/);

    // The managed .codex/hooks.json must still be in place, and the
    // fresh v0.40.0 skills must exist under the new `cc*` layout.
    await expect(
      fs.stat(path.join(root, ".codex/hooks.json"))
    ).resolves.toBeDefined();
    await expect(
      fs.stat(path.join(root, ".agents/skills/cc/SKILL.md"))
    ).resolves.toBeDefined();
  });

  it("uninstall strips only cclaw hooks and preserves user hooks", async () => {
    const root = await createTempProject("uninstall-hooks");
    await initCclaw({ projectRoot: root });

    const claudeHooksPath = path.join(root, ".claude/hooks/hooks.json");
    await fs.writeFile(claudeHooksPath, JSON.stringify({
      version: 1,
      hooks: {
        Stop: [{
          hooks: [
            { type: "command", command: "node .cclaw/hooks/run-hook.mjs stop-handoff" },
            { type: "command", command: "echo user-stop-hook" }
          ]
        }],
        PostToolUse: [{
          matcher: "*",
          hooks: [
            { type: "command", command: "node .cclaw/hooks/run-hook.mjs context-monitor" },
            { type: "command", command: "echo user-post-hook" }
          ]
        }]
      }
    }, null, 2), "utf8");

    await uninstallCclaw(root);

    const cleaned = JSON.parse(await fs.readFile(claudeHooksPath, "utf8")) as {
      hooks: Record<string, unknown>;
    };
    const serialized = JSON.stringify(cleaned);
    expect(serialized).not.toContain(".cclaw/hooks/");
    expect(serialized).toContain("user-stop-hook");
    expect(serialized).toContain("user-post-hook");
  });
});
