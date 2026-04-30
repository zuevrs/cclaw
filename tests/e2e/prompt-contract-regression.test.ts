import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { initCclaw } from "../../src/install.js";
import { createTempProject } from "../helpers/index.js";

const execFileAsync = promisify(execFile);

describe("prompt-contract regression harness", () => {
  it("keeps stage behavior contracts for plan/review/tdd", async () => {
    const root = await createTempProject("behavior-contract");
    await initCclaw({ projectRoot: root });

    const planSkill = await fs.readFile(
      path.join(root, ".cclaw/skills/plan/SKILL.md"),
      "utf8"
    );
    const reviewSkill = await fs.readFile(
      path.join(root, ".cclaw/skills/review/SKILL.md"),
      "utf8"
    );
    const tddSkill = await fs.readFile(
      path.join(root, ".cclaw/skills/tdd/SKILL.md"),
      "utf8"
    );
    expect(planSkill).toContain("Dependency Batches");
    expect(planSkill).toContain("WAIT_FOR_CONFIRM");
    expect(planSkill).toContain("/cc");
    expect(tddSkill).toContain("RED");
    expect(tddSkill).toContain("GREEN");
    expect(tddSkill).toContain("REFACTOR");
    expect(tddSkill).toContain("Run full suite");
    expect(reviewSkill).toContain("Layer 1");
    expect(reviewSkill).toContain("Layer 2");
    expect(reviewSkill).toContain("07-review-army.json");
  });

  it("keeps advisory hooks wired for guards, context monitor, and suggestion memory", async () => {
    const root = await createTempProject("behavior-hooks");
    await initCclaw({ projectRoot: root });

    const claudeHooks = await fs.readFile(path.join(root, ".claude/hooks/hooks.json"), "utf8");
    const cursorHooks = await fs.readFile(path.join(root, ".cursor/hooks.json"), "utf8");
    const hookRuntime = await fs.readFile(path.join(root, ".cclaw/hooks/run-hook.mjs"), "utf8");

    expect(claudeHooks).toContain(".cclaw/hooks/run-hook.cmd prompt-guard");
    expect(claudeHooks).toContain(".cclaw/hooks/run-hook.cmd workflow-guard");
    expect(claudeHooks).toContain(".cclaw/hooks/run-hook.cmd context-monitor");
    expect(cursorHooks).toContain(".cclaw/hooks/run-hook.cmd prompt-guard");
    expect(cursorHooks).toContain(".cclaw/hooks/run-hook.cmd workflow-guard");
    expect(cursorHooks).toContain(".cclaw/hooks/run-hook.cmd context-monitor");
    expect(hookRuntime).not.toContain("suggestion-memory.json");
    expect(hookRuntime).not.toContain("context-warnings.jsonl");
    expect(hookRuntime).toContain("knowledge.jsonl");
    expect(hookRuntime).toContain("write_to_cclaw_runtime");
    expect(hookRuntime).toContain("stage_invocation_without_recent_flow_read");
    expect(hookRuntime).toContain("context remaining is");
  });

  it("generates native agent ACK contracts and delegation helper", async () => {
    const root = await createTempProject("generated-agent-ack-contracts");
    await initCclaw({ projectRoot: root, harnesses: ["opencode", "codex"] });

    const opencodePlanner = await fs.readFile(path.join(root, ".opencode/agents/planner.md"), "utf8");
    const codexPlanner = await fs.readFile(path.join(root, ".codex/agents/planner.toml"), "utf8");
    const helper = await fs.readFile(path.join(root, ".cclaw/hooks/delegation-record.mjs"), "utf8");
    const stageSkill = await fs.readFile(
      path.join(root, ".cclaw/skills/plan/SKILL.md"),
      "utf8"
    );

    for (const content of [opencodePlanner, codexPlanner, stageSkill]) {
      expect(content).toContain("Worker ACK Contract");
      expect(content).toContain("dispatchId");
      expect(content).toContain("dispatchSurface");
      expect(content).toContain("agentDefinitionPath");
      expect(content).toContain("spanId");
    }
    for (const content of [opencodePlanner, codexPlanner]) {
      expect(content).toContain("STRICT_RETURN_SCHEMA");
      expect(content).toContain("workerRunId");
    }
    expect(stageSkill).toContain("delegation helper recipe");
    expect(stageSkill).toContain("--status=scheduled");
    expect(stageSkill).toContain("--status=launched");
    expect(stageSkill).toContain("--status=acknowledged");
    expect(stageSkill).toContain("--status=completed");
    expect(stageSkill).toContain("--ack-ts=<iso>");
    expect(helper).toContain("delegation-events.jsonl");
    expect(helper).toContain("completed isolated/generic status requires");
    expect(helper).toContain("prior acknowledged event for same span or --ack-ts");
  });

  it("generated delegation helper rejects completion without ACK and accepts the ACK lifecycle", async () => {
    const root = await createTempProject("delegation-record-helper-contract");
    await initCclaw({ projectRoot: root, harnesses: ["opencode"] });

    const helper = path.join(root, ".cclaw/hooks/delegation-record.mjs");
    const common = [
      helper,
      "--stage=scope",
      "--agent=planner",
      "--mode=mandatory",
      "--span-id=span-helper",
      "--dispatch-id=dispatch-helper",
      "--dispatch-surface=opencode-agent",
      "--agent-definition-path=.opencode/agents/planner.md",
      "--json"
    ];

    await expect(
      execFileAsync(process.execPath, [...common, "--status=completed"], {
        cwd: root,
        env: { ...process.env, CCLAW_PROJECT_ROOT: root }
      })
    ).rejects.toMatchObject({
      stdout: expect.stringContaining("prior acknowledged event for same span or --ack-ts")
    });

    for (const status of ["scheduled", "launched", "acknowledged", "completed"]) {
      const result = await execFileAsync(process.execPath, [...common, `--status=${status}`], {
        cwd: root,
        env: { ...process.env, CCLAW_PROJECT_ROOT: root }
      });
      expect(result.stdout).toContain('"ok": true');
      expect(result.stdout).toContain(`"event": "${status}"`);
    }

    const events = await fs.readFile(path.join(root, ".cclaw/state/delegation-events.jsonl"), "utf8");
    expect(events).toContain('"event":"acknowledged"');
    expect(events).toContain('"event":"completed"');

    const ledger = JSON.parse(await fs.readFile(path.join(root, ".cclaw/state/delegation-log.json"), "utf8")) as { entries: Array<{ status: string; spanId: string; ackTs?: string; completedTs?: string }> };
    expect(ledger.entries.map((entry) => entry.status)).toEqual([
      "scheduled",
      "launched",
      "acknowledged",
      "completed"
    ]);
    expect(ledger.entries.find((entry) => entry.status === "acknowledged")?.ackTs).toBeTruthy();
    expect(ledger.entries.find((entry) => entry.status === "completed")?.completedTs).toBeTruthy();
  });

  it("documents the subagent flow with mermaid diagrams", async () => {
    const doc = await fs.readFile(path.join(process.cwd(), "docs/subagent-flow.md"), "utf8");

    expect(doc).toContain("## Current Model");
    expect(doc).toContain("## Target Model");
    expect(doc).toContain("## OpenCode Standard Flow");
    expect(doc).toContain("## Proof Sequence");
    expect(doc).toContain("## Relation to `docs/harnesses.md`");
    expect(doc).toContain("```mermaid");
    expect(doc).toContain("flowchart TD");
    expect(doc).toContain("sequenceDiagram");
  });

});
