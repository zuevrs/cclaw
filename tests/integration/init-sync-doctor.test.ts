import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { doctorChecks, doctorSucceeded } from "../../src/doctor.js";
import { initCclaw, syncCclaw, uninstallCclaw } from "../../src/install.js";

function countOccurrences(value: string, needle: string): number {
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const matches = value.match(new RegExp(escaped, "gu"));
  return matches ? matches.length : 0;
}

describe("install lifecycle", () => {
  it("initializes runtime and passes doctor checks", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "cclaw-init-"));
    await initCclaw({ projectRoot: root });

    const checks = await doctorChecks(root);
    expect(doctorSucceeded(checks)).toBe(true);

    const flow = JSON.parse(
      await fs.readFile(path.join(root, ".cclaw/state/flow-state.json"), "utf8")
    ) as { activeRunId?: string };
    expect(typeof flow.activeRunId).toBe("string");
    expect(flow.activeRunId).toMatch(/^run-/);
    await expect(
      fs.stat(path.join(root, ".cclaw/runs", flow.activeRunId as string, "run.json"))
    ).resolves.toBeDefined();
    await expect(fs.stat(path.join(root, ".cclaw/state/checkpoint.json"))).resolves.toBeDefined();
    await expect(fs.stat(path.join(root, ".cclaw/state/stage-activity.jsonl"))).resolves.toBeDefined();

    const claudeHooks = JSON.parse(
      await fs.readFile(path.join(root, ".claude/hooks/hooks.json"), "utf8")
    ) as { hooks: { SessionStart: Array<{ matcher?: string }> } };
    expect(claudeHooks.hooks.SessionStart[0]?.matcher).toBe("startup|resume|clear|compact");

    const opencodeConfig = JSON.parse(
      await fs.readFile(path.join(root, "opencode.json"), "utf8")
    ) as { plugins?: unknown[] };
    expect(Array.isArray(opencodeConfig.plugins)).toBe(true);
    expect(opencodeConfig.plugins).toContain(".opencode/plugins/cclaw-plugin.mjs");

    const agentsMd = await fs.readFile(path.join(root, "AGENTS.md"), "utf8");
    expect(agentsMd).toContain("## Cclaw — Workflow Adapter");
    expect(agentsMd).toContain("intentionally minimal for cross-project use");
    expect(agentsMd).not.toContain("### Agent Specialists");
    expect(agentsMd).not.toContain("### Hooks (real lifecycle integration)");
    expect(agentsMd).not.toContain("### Runtime Details (full mode)");
  });

  it("sync regenerates shim files", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "cclaw-sync-"));
    await initCclaw({ projectRoot: root });

    const shim = path.join(root, ".claude/commands/cc-brainstorm.md");
    const contract = path.join(root, ".cclaw/commands/plan.md");
    const skill = path.join(root, ".cclaw/skills/planning-and-task-breakdown/SKILL.md");
    await fs.rm(shim);
    await fs.writeFile(contract, "# corrupted\n", "utf8");
    await fs.writeFile(skill, "# corrupted\n", "utf8");
    await syncCclaw(root);

    const restored = await fs.readFile(shim, "utf8");
    const restoredContract = await fs.readFile(contract, "utf8");
    const restoredSkill = await fs.readFile(skill, "utf8");
    expect(restored).toContain(".cclaw/commands/brainstorm.md");
    expect(restoredContract).toContain("WAIT_FOR_CONFIRM");
    expect(restoredSkill).toContain("## Required Gates");
  });

  it("sync removes stale generated shims, persists config, and keeps user-owned assets", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "cclaw-cleanup-"));
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

  it("sync merges generated hooks with user hooks without duplication", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "cclaw-hooks-merge-"));
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
    expect(countOccurrences(mergedClaude, "bash .cclaw/hooks/observe.sh pre")).toBe(1);
    expect(countOccurrences(mergedClaude, "bash .cclaw/hooks/observe.sh post")).toBe(1);
    expect(countOccurrences(mergedClaude, "bash .cclaw/hooks/stop-checkpoint.sh")).toBe(1);

    expect(mergedCursor).toContain("cursor-user-stop");
    expect(mergedCursor).toContain("cursor-user-pre");
    expect(countOccurrences(mergedCursor, ".cclaw/hooks/observe.sh pre")).toBe(1);
    expect(countOccurrences(mergedCursor, ".cclaw/hooks/observe.sh post")).toBe(1);
    expect(countOccurrences(mergedCursor, ".cclaw/hooks/stop-checkpoint.sh")).toBe(1);
  });

  it("sync recovers relaxed JSON hooks and preserves user commands", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "cclaw-hooks-recover-"));
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
    expect(countOccurrences(merged, "bash .cclaw/hooks/observe.sh pre")).toBe(1);

    const backupsDir = path.join(root, ".cclaw/backups/hooks");
    const backups = await fs.readdir(backupsDir);
    expect(backups.length).toBeGreaterThan(0);
  });

  it("sync backs up unrecoverable hook json before rewriting", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "cclaw-hooks-backup-"));
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
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "cclaw-uninstall-"));
    await initCclaw({ projectRoot: root });

    await uninstallCclaw(root);

    await expect(fs.stat(path.join(root, ".cclaw"))).rejects.toBeDefined();
    await expect(fs.stat(path.join(root, ".claude/commands/cc-brainstorm.md"))).rejects.toBeDefined();
    await expect(fs.stat(path.join(root, ".cursor/hooks.json"))).rejects.toBeDefined();
  });

  it("uninstall strips only cclaw hooks and preserves user hooks", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "cclaw-uninstall-hooks-"));
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
            { type: "command", command: "bash .cclaw/hooks/observe.sh post" },
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
