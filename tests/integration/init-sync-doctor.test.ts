import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { readConfig, writeConfig } from "../../src/config.js";
import { doctorChecks, doctorSucceeded } from "../../src/doctor.js";
import { initCclaw, syncCclaw, uninstallCclaw } from "../../src/install.js";
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

  it("initializes runtime and passes doctor checks", async () => {
    const root = await createTempProject("init");
    await initCclaw({ projectRoot: root });

    const checks = await doctorChecks(root);
    expect(doctorSucceeded(checks)).toBe(true);

    const flow = JSON.parse(
      await fs.readFile(path.join(root, ".cclaw/state/flow-state.json"), "utf8")
    ) as { activeRunId?: string };
    expect(typeof flow.activeRunId).toBe("string");
    expect(flow.activeRunId).toBe("active");
    await expect(fs.stat(path.join(root, ".cclaw/state/checkpoint.json"))).resolves.toBeDefined();
    await expect(fs.stat(path.join(root, ".cclaw/state/stage-activity.jsonl"))).resolves.toBeDefined();

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
    const customSkillDir = path.join(root, ".cclaw/skills/team-custom-skill");
    const legacySkillDir = path.join(root, ".cclaw/skills/project-learnings");
    const legacyBrowserQaDir = path.join(root, ".cclaw/skills/browser-qa-testing");
    const configPath = path.join(root, ".cclaw/config.yaml");
    await fs.writeFile(staleShim, "# stale shim\n", "utf8");
    await fs.writeFile(staleStartShim, "# stale start shim\n", "utf8");
    await fs.writeFile(customAgent, "# user agent\n", "utf8");
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
    expect(countOccurrences(mergedClaude, "bash .cclaw/hooks/prompt-guard.sh")).toBe(1);
    expect(countOccurrences(mergedClaude, "bash .cclaw/hooks/workflow-guard.sh")).toBe(1);
    expect(countOccurrences(mergedClaude, "bash .cclaw/hooks/context-monitor.sh")).toBe(1);
    expect(countOccurrences(mergedClaude, "bash .cclaw/hooks/stop-checkpoint.sh")).toBe(1);

    expect(mergedCursor).toContain("cursor-user-stop");
    expect(mergedCursor).toContain("cursor-user-pre");
    expect(countOccurrences(mergedCursor, ".cclaw/hooks/prompt-guard.sh")).toBe(1);
    expect(countOccurrences(mergedCursor, ".cclaw/hooks/workflow-guard.sh")).toBe(1);
    expect(countOccurrences(mergedCursor, ".cclaw/hooks/context-monitor.sh")).toBe(1);
    expect(countOccurrences(mergedCursor, ".cclaw/hooks/stop-checkpoint.sh")).toBe(1);
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
    expect(countOccurrences(merged, "bash .cclaw/hooks/prompt-guard.sh")).toBe(1);

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
    await expect(fs.stat(path.join(root, ".codex"))).resolves.toBeDefined();
    await expect(fs.stat(path.join(root, ".opencode"))).resolves.toBeDefined();

    await uninstallCclaw(root);

    await expect(fs.stat(path.join(root, ".claude"))).rejects.toBeDefined();
    await expect(fs.stat(path.join(root, ".cursor"))).rejects.toBeDefined();
    await expect(fs.stat(path.join(root, ".codex"))).rejects.toBeDefined();
    await expect(fs.stat(path.join(root, ".opencode"))).rejects.toBeDefined();
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
