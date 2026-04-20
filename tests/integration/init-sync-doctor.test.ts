import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { readConfig, writeConfig } from "../../src/config.js";
import { doctorChecks, doctorSucceeded } from "../../src/doctor.js";
import { initCclaw, syncCclaw, uninstallCclaw, upgradeCclaw } from "../../src/install.js";
import { createTempProject } from "../helpers/index.js";

const execFileAsync = promisify(execFile);

function countOccurrences(value: string, needle: string): number {
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const matches = value.match(new RegExp(escaped, "gu"));
  return matches ? matches.length : 0;
}

describe("install lifecycle", () => {
  it("doctor passes for claude-only harness installs", async () => {
    const root = await createTempProject("claude-only");
    await initCclaw({ projectRoot: root, harnesses: ["claude"] });

    const checks = await doctorChecks(root);
    expect(doctorSucceeded(checks)).toBe(true);

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
    const root = await createTempProject("init");
    await initCclaw({ projectRoot: root });

    const checks = await doctorChecks(root);
    expect(doctorSucceeded(checks)).toBe(true);
    expect(checks.some((check) => check.name === "hook:script:pre-compact.sh" && check.ok)).toBe(true);
    expect(checks.some((check) => check.name === "hook:script:pre-compact.sh:executable" && check.ok)).toBe(true);
    expect(checks.some((check) => check.name === "hook:script:stage-complete.sh" && check.ok)).toBe(true);
    expect(checks.some((check) => check.name === "hook:script:stage-complete.sh:executable" && check.ok)).toBe(true);
    expect(checks.some((check) => check.name === "hook:wiring:codex" && check.ok)).toBe(true);

    const flow = JSON.parse(
      await fs.readFile(path.join(root, ".cclaw/state/flow-state.json"), "utf8")
    ) as { activeRunId?: string };
    expect(typeof flow.activeRunId).toBe("string");
    expect(flow.activeRunId).toBe("active");
    await expect(fs.stat(path.join(root, ".cclaw/state/checkpoint.json"))).resolves.toBeDefined();
    await expect(fs.stat(path.join(root, ".cclaw/state/stage-activity.jsonl"))).resolves.toBeDefined();
    await expect(fs.stat(path.join(root, ".cclaw/state/flow-state.snapshot.json"))).resolves.toBeDefined();
    await expect(fs.stat(path.join(root, ".cclaw/state/harness-gaps.json"))).resolves.toBeDefined();
    await expect(fs.stat(path.join(root, ".cclaw/commands/tree.md"))).resolves.toBeDefined();
    await expect(fs.stat(path.join(root, ".cclaw/commands/diff.md"))).resolves.toBeDefined();
    await expect(fs.stat(path.join(root, ".claude/commands/cc-view.md"))).resolves.toBeDefined();
    await expect(fs.stat(path.join(root, ".claude/commands/cc-ops.md"))).resolves.toBeDefined();
    const claudeShims = (await fs.readdir(path.join(root, ".claude/commands")))
      .filter((name) => /^cc(?:-.*)?\.md$/u.test(name))
      .sort();
    expect(claudeShims).toEqual([
      "cc-ideate.md",
      "cc-next.md",
      "cc-ops.md",
      "cc-view.md",
      "cc.md"
    ]);
    const harnessGaps = JSON.parse(
      await fs.readFile(path.join(root, ".cclaw/state/harness-gaps.json"), "utf8")
    ) as {
      schemaVersion?: number;
      harnesses: Array<{
        harness: string;
        tier: string;
        subagentFallback?: string;
        playbookPath?: string;
        missingCapabilities: string[];
        missingHookEvents?: string[];
        remediation?: string[];
      }>;
    };
    expect(harnessGaps.schemaVersion).toBe(2);
    const codexGap = harnessGaps.harnesses.find((entry) => entry.harness === "codex");
    // Codex regained tier2 in v0.40.0: Codex CLI ≥ v0.114 supports
    // lifecycle hooks (`.codex/hooks.json`, gated by the `codex_hooks`
    // feature flag). PreToolUse/PostToolUse are Bash-only — reported via
    // `hookSurface:limited` instead of `none`. No custom slash commands
    // and no native subagent dispatch persist as gaps.
    expect(codexGap?.tier).toBe("tier2");
    expect(codexGap?.missingCapabilities).toContain("nativeSubagentDispatch:none");
    expect(codexGap?.missingCapabilities).toContain("hookSurface:limited");
    // Wave Q (v0.41.0): Codex exposes `request_user_input` (experimental
    // Plan / Collaboration mode tool), so structuredAsk is no longer a
    // missing capability. Remediation still records the gating note.
    expect(codexGap?.missingCapabilities).not.toContain("structuredAsk:none");
    expect(
      codexGap?.remediation?.some((line) => line.includes("request_user_input"))
    ).toBe(true);
    expect(codexGap?.subagentFallback).toBe("role-switch");
    expect(codexGap?.playbookPath).toBe(".cclaw/references/harnesses/codex-playbook.md");
    expect(codexGap?.remediation?.some((line) => line.includes("role-switch"))).toBe(true);
    // `precompact_digest` must still land in missingHookEvents — Codex
    // has no PreCompact event — but the other five semantic events are
    // now mapped.
    expect(codexGap?.missingHookEvents).toContain("precompact_digest");
    expect(codexGap?.missingHookEvents).not.toContain("session_rehydrate");

    // Wave Q (v0.41.0): OpenCode's native `question` tool is honest as
    // permission-gated, not missing — assert the remediation mentions
    // the config knob.
    const opencodeGap = harnessGaps.harnesses.find(
      (entry) => entry.harness === "opencode"
    );
    expect(opencodeGap?.missingCapabilities).not.toContain("structuredAsk:none");
    expect(
      opencodeGap?.remediation?.some((line) => line.includes("permission.question"))
    ).toBe(true);

    // Parity playbooks must be materialised for every supported harness.
    for (const harness of ["claude", "cursor", "opencode", "codex"] as const) {
      const playbookPath = path.join(
        root,
        `.cclaw/references/harnesses/${harness}-playbook.md`
      );
      const body = await fs.readFile(playbookPath, "utf8");
      expect(body).toContain(`harness: ${harness}`);
      expect(body).toContain("# ");
    }
    await expect(
      fs.stat(path.join(root, ".cclaw/references/harnesses/README.md"))
    ).resolves.toBeDefined();

    const claudeHooks = JSON.parse(
      await fs.readFile(path.join(root, ".claude/hooks/hooks.json"), "utf8")
    ) as { hooks: { SessionStart: Array<{ matcher?: string }> } };
    expect(claudeHooks.hooks.SessionStart[0]?.matcher).toBe("startup|resume|clear|compact");

    const opencodeConfig = JSON.parse(
      await fs.readFile(path.join(root, "opencode.json"), "utf8")
    ) as { plugin?: unknown[] };
    expect(Array.isArray(opencodeConfig.plugin)).toBe(true);
    expect(opencodeConfig.plugin).toContain(".opencode/plugins/cclaw-plugin.mjs");

    const cursorRule = await fs.readFile(path.join(root, ".cursor/rules/cclaw-workflow.mdc"), "utf8");
    expect(cursorRule).toContain("cclaw-managed-cursor-workflow-rule");
    expect(cursorRule).toContain("/cc-next");

    const agentsMd = await fs.readFile(path.join(root, "AGENTS.md"), "utf8");
    expect(agentsMd).toContain("## Cclaw — Workflow Adapter");
    expect(agentsMd).toContain("intentionally minimal for cross-project use");
    expect(agentsMd).not.toContain("### Agent Specialists");
    expect(agentsMd).not.toContain("### Hooks (real lifecycle integration)");
    expect(agentsMd).not.toContain("### Runtime Details (full mode)");

    const generatedAgents = (await fs.readdir(path.join(root, ".cclaw/agents")))
      .filter((fileName) => fileName.endsWith(".md"))
      .sort();
    expect(generatedAgents).toEqual([
      "doc-updater.md",
      "planner.md",
      "reviewer.md",
      "security-reviewer.md",
      "test-author.md"
    ]);

    const researchPlaybook = await fs.readFile(
      path.join(root, ".cclaw/skills/research/repo-scan.md"),
      "utf8"
    );
    expect(researchPlaybook).toContain("# Repo Scan Playbook");
    expect(researchPlaybook.startsWith("---")).toBe(false);
  });

  it("doctor emits severity, fix, and doc references", async () => {
    const root = await createTempProject("doctor-metadata");
    await initCclaw({ projectRoot: root });

    const checks = await doctorChecks(root);
    const configCheck = checks.find((check) => check.name === "config:valid");
    const warningCheck = checks.find((check) => check.name === "warning:capability:jq");

    expect(configCheck).toBeDefined();
    expect(configCheck?.severity).toBe("error");
    expect(configCheck?.fix.length).toBeGreaterThan(0);
    expect(configCheck?.docRef).toContain(".cclaw/references/doctor/");

    expect(warningCheck).toBeDefined();
    expect(warningCheck?.severity).toBe("warning");
  });

  it("doctor classifies all checks in a fresh install", async () => {
    const root = await createTempProject("doctor-classification");
    await initCclaw({ projectRoot: root });

    const checks = await doctorChecks(root);
    const unclassified = checks.filter((check) => check.summary === "Unclassified doctor check.");
    expect(unclassified).toEqual([]);
  });

  it("doctor keeps runtime-integrity check families at error severity", async () => {
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
      "context_mode:",
      "knowledge:",
      "artifacts:",
      "runs:",
      "flow_state:",
      "state:",
      "contexts:",
      "gates:",
      "trace:",
      "delegation:",
      "shim:",
      "dir:",
      "command:",
      "utility_command:",
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
      promptGuardMode: "strict",
      tddEnforcement: "strict",
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
    expect(before.promptGuardMode).toBe("strict");
    expect(before.tddEnforcement).toBe("strict");
    expect(before.gitHookGuards).toBe(true);
    expect(before.languageRulePacks.length).toBeGreaterThan(0);

    const shim = path.join(root, ".claude/commands/cc.md");
    await fs.rm(shim);

    await upgradeCclaw(root);

    const after = await readConfig(root);
    expect(after.promptGuardMode).toBe("strict");
    expect(after.tddEnforcement).toBe("strict");
    expect(after.gitHookGuards).toBe(true);
    expect(after.languageRulePacks).toEqual(before.languageRulePacks);
    expect(after.trackHeuristics?.tracks?.quick?.triggers).toEqual(["hotfix"]);

    await expect(fs.stat(shim)).resolves.toBeDefined();
  });

  it("sync regenerates shim files", async () => {
    const root = await createTempProject("sync");
    await initCclaw({ projectRoot: root });

    const shim = path.join(root, ".claude/commands/cc.md");
    const contract = path.join(root, ".cclaw/commands/plan.md");
    const skill = path.join(root, ".cclaw/skills/planning-and-task-breakdown/SKILL.md");
    await fs.rm(shim);
    await fs.writeFile(contract, "# corrupted\n", "utf8");
    await fs.writeFile(skill, "# corrupted\n", "utf8");
    await syncCclaw(root);

    const restored = await fs.readFile(shim, "utf8");
    const restoredContract = await fs.readFile(contract, "utf8");
    const restoredSkill = await fs.readFile(skill, "utf8");
    expect(restored).toContain(".cclaw/skills/flow-start/SKILL.md");
    expect(restoredContract).toContain("WAIT_FOR_CONFIRM");
    expect(restoredSkill).toContain("## Required Gates");
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
      promptGuardMode: "strict",
      gitHookGuards: true
    });
    await syncCclaw(root);

    const preCommitRelay = await fs.readFile(path.join(root, ".git/hooks/pre-commit"), "utf8");
    const prePushRelay = await fs.readFile(path.join(root, ".git/hooks/pre-push"), "utf8");
    expect(preCommitRelay).toContain("cclaw-managed-git-hook");
    expect(prePushRelay).toContain("cclaw-managed-git-hook");

    const runtimePreCommit = await fs.readFile(path.join(root, ".cclaw/hooks/git/pre-commit.sh"), "utf8");
    const runtimePrePush = await fs.readFile(path.join(root, ".cclaw/hooks/git/pre-push.sh"), "utf8");
    expect(runtimePreCommit).toContain("prompt-guard.sh");
    expect(runtimePrePush).toContain("prompt-guard.sh");

    const promptGuard = await fs.readFile(path.join(root, ".cclaw/hooks/prompt-guard.sh"), "utf8");
    expect(promptGuard).toContain('PROMPT_GUARD_MODE="strict"');
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
    expect(doctorSucceeded(checks)).toBe(true);
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
    expect(countOccurrences(mergedClaude, "bash .cclaw/hooks/run-hook.cmd prompt-guard.sh")).toBe(1);
    expect(countOccurrences(mergedClaude, "bash .cclaw/hooks/run-hook.cmd workflow-guard.sh")).toBe(1);
    expect(countOccurrences(mergedClaude, "bash .cclaw/hooks/run-hook.cmd context-monitor.sh")).toBe(1);
    expect(countOccurrences(mergedClaude, "bash .cclaw/hooks/run-hook.cmd stop-checkpoint.sh")).toBe(1);

    expect(mergedCursor).toContain("cursor-user-stop");
    expect(mergedCursor).toContain("cursor-user-pre");
    expect(countOccurrences(mergedCursor, ".cclaw/hooks/run-hook.cmd prompt-guard.sh")).toBe(1);
    expect(countOccurrences(mergedCursor, ".cclaw/hooks/run-hook.cmd workflow-guard.sh")).toBe(1);
    expect(countOccurrences(mergedCursor, ".cclaw/hooks/run-hook.cmd context-monitor.sh")).toBe(1);
    expect(countOccurrences(mergedCursor, ".cclaw/hooks/run-hook.cmd stop-checkpoint.sh")).toBe(1);
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
    expect(countOccurrences(merged, "bash .cclaw/hooks/run-hook.cmd prompt-guard.sh")).toBe(1);

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
      origin_feature: "payload-hardening",
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
      origin_feature: "payload-hardening",
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

  it("flags unsynced reconciliation notices and clears them with reconcile-gates", async () => {
    const root = await createTempProject("doctor-reconciliation-notices");
    await initCclaw({ projectRoot: root });
    await fs.writeFile(
      path.join(root, ".cclaw/state/reconciliation-notices.json"),
      JSON.stringify({
        schemaVersion: 1,
        notices: [
          {
            id: "active:brainstorm:brainstorm_context_explored:2026-04-20T00:00:00.000Z",
            runId: "active",
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

  it("codex install materializes .agents/skills/cc*/SKILL.md and .codex/hooks.json", async () => {
    const root = await createTempProject("codex-skills-fresh");
    await initCclaw({ projectRoot: root, harnesses: ["codex"] });

    const expectedSkills = ["cc", "cc-next", "cc-view", "cc-ideate", "cc-ops"];
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
    expect(JSON.stringify(codexHooks)).toContain("verify-current-state --quiet");

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

    await syncCclaw(root);

    // .codex/commands/ and the legacy cclaw-cc folder must both be gone.
    await expect(fs.stat(path.join(root, ".codex/commands"))).rejects.toThrow(/ENOENT/);
    await expect(fs.stat(path.join(root, ".agents/skills/cclaw-cc"))).rejects.toThrow(/ENOENT/);

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
            { type: "command", command: "bash .cclaw/hooks/stop-checkpoint.sh" },
            { type: "command", command: "echo user-stop-hook" }
          ]
        }],
        PostToolUse: [{
          matcher: "*",
          hooks: [
            { type: "command", command: "bash .cclaw/hooks/context-monitor.sh" },
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
