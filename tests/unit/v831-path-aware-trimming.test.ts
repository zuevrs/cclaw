import { describe, expect, it } from "vitest";
import { renderStartCommand } from "../../src/content/start-command.js";

/**
 * v8.31 path-aware orchestrator — body-budget tripwires.
 *
 * Slimmed in v8.100: kept only the rendered-body size budgets
 * (renderStartCommand). The content-grep tripwires on STAGE_PLAYBOOKS,
 * ON_DEMAND_RUNBOOKS, and PLAN_PLAYBOOK prose were removed.
 */
describe("v8.31 path-aware orchestrator — body-only budget", () => {
  it("start-command body stays ≤ 145000 chars", () => {
    expect(renderStartCommand().length).toBeLessThanOrEqual(145000);
  });

  it("start-command body stays ≤ 830 lines", () => {
    expect(renderStartCommand().split("\n").length).toBeLessThanOrEqual(830);
  });
});
