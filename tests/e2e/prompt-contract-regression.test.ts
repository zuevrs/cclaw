import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { initCclaw } from "../../src/install.js";
import { createTempProject } from "../helpers/index.js";

describe("prompt-contract regression harness", () => {
  it("keeps stage behavior contracts for plan/review/tdd", async () => {
    const root = await createTempProject("behavior-contract");
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

    expect(planSkill).toContain("Dependency Batches");
    expect(planSkill).toContain("WAIT_FOR_CONFIRM");
    expect(planSkill).toContain("/cc-next");
    expect(planContract).toContain("Dependency Batches");
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
    const root = await createTempProject("behavior-hooks");
    await initCclaw({ projectRoot: root });

    const claudeHooks = await fs.readFile(path.join(root, ".claude/hooks/hooks.json"), "utf8");
    const cursorHooks = await fs.readFile(path.join(root, ".cursor/hooks.json"), "utf8");
    const hookRuntime = await fs.readFile(path.join(root, ".cclaw/hooks/run-hook.mjs"), "utf8");

    expect(claudeHooks).toContain("node .cclaw/hooks/run-hook.mjs prompt-guard");
    expect(claudeHooks).toContain("node .cclaw/hooks/run-hook.mjs workflow-guard");
    expect(claudeHooks).toContain("node .cclaw/hooks/run-hook.mjs context-monitor");
    expect(cursorHooks).toContain("node .cclaw/hooks/run-hook.mjs prompt-guard");
    expect(cursorHooks).toContain("node .cclaw/hooks/run-hook.mjs workflow-guard");
    expect(cursorHooks).toContain("node .cclaw/hooks/run-hook.mjs context-monitor");
    expect(hookRuntime).toContain("suggestion-memory.json");
    expect(hookRuntime).toContain("context-warnings.jsonl");
    expect(hookRuntime).toContain("knowledge.jsonl");
    expect(hookRuntime).toContain("write_to_cclaw_runtime");
    expect(hookRuntime).toContain("stage_invocation_without_recent_flow_read");
    expect(hookRuntime).toContain("context remaining is");
  });
});
