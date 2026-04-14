import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { initCclaw } from "../../src/install.js";

describe("prompt-contract regression harness", () => {
  it("keeps stage behavior contracts for plan/review/tdd", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "cclaw-behavior-contract-"));
    await initCclaw({ projectRoot: root });

    const planSkill = await fs.readFile(
      path.join(root, ".cclaw/skills/planning-and-task-breakdown/SKILL.md"),
      "utf8"
    );
    const reviewSkill = await fs.readFile(
      path.join(root, ".cclaw/skills/two-layer-review/SKILL.md"),
      "utf8"
    );
    const tddSkill = await fs.readFile(
      path.join(root, ".cclaw/skills/test-driven-development/SKILL.md"),
      "utf8"
    );
    const planContract = await fs.readFile(path.join(root, ".cclaw/commands/plan.md"), "utf8");
    const reviewContract = await fs.readFile(path.join(root, ".cclaw/commands/review.md"), "utf8");

    expect(planSkill).toContain("Dependency Waves");
    expect(planSkill).toContain("WAIT_FOR_CONFIRM");
    expect(planSkill).toContain("/cc-next");
    expect(planContract).toContain("Dependency Waves");
    expect(planContract).toContain("Context Hydration");

    expect(tddSkill).toContain("RED");
    expect(tddSkill).toContain("GREEN");
    expect(tddSkill).toContain("REFACTOR");
    expect(tddSkill).toContain("Run full suite");
    expect(reviewSkill).toContain("Layer 1");
    expect(reviewSkill).toContain("Layer 2");
    expect(reviewSkill).toContain("07-review-army.json");
    expect(reviewContract).toContain("Review Army");
  });

  it("keeps advisory hooks wired for guards, context monitor, and suggestion memory", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "cclaw-behavior-hooks-"));
    await initCclaw({ projectRoot: root });

    const claudeHooks = await fs.readFile(path.join(root, ".claude/hooks/hooks.json"), "utf8");
    const cursorHooks = await fs.readFile(path.join(root, ".cursor/hooks.json"), "utf8");
    const sessionStart = await fs.readFile(path.join(root, ".cclaw/hooks/session-start.sh"), "utf8");
    const promptGuard = await fs.readFile(path.join(root, ".cclaw/hooks/prompt-guard.sh"), "utf8");
    const workflowGuard = await fs.readFile(path.join(root, ".cclaw/hooks/workflow-guard.sh"), "utf8");
    const contextMonitor = await fs.readFile(path.join(root, ".cclaw/hooks/context-monitor.sh"), "utf8");
    const summarizeRuntime = await fs.readFile(path.join(root, ".cclaw/hooks/summarize-observations.mjs"), "utf8");

    expect(claudeHooks).toContain("prompt-guard.sh");
    expect(claudeHooks).toContain("workflow-guard.sh");
    expect(claudeHooks).toContain("context-monitor.sh");
    expect(cursorHooks).toContain("prompt-guard.sh");
    expect(cursorHooks).toContain("workflow-guard.sh");
    expect(cursorHooks).toContain("context-monitor.sh");
    expect(sessionStart).toContain("suggestion-memory.json");
    expect(sessionStart).toContain("context-warnings.jsonl");
    expect(promptGuard).toContain("write_to_cclaw_runtime");
    expect(workflowGuard).toContain("stage_invocation_without_recent_flow_read");
    expect(contextMonitor).toContain("remaining is");
    expect(summarizeRuntime).toContain("frequent-errors-");
  });
});
