import { describe, expect, it } from "vitest";
import { startCommandContract, startCommandSkillMarkdown } from "../../src/content/start-command.js";

describe("e2e: start command wave detection prose ", () => {
  it("start command contract references Parallel Execution Plan and resume behavior", () => {
    const c = startCommandContract();
    expect(c).toContain("Parallel Execution Plan");
    expect(c).toContain("wave-plans");
    expect(c).toContain("remaining");
  });

  it("start skill markdown binds TDD entry to plan + wave sources before routing", () => {
    const s = startCommandSkillMarkdown();
    expect(s).toContain("Parallel Execution Plan");
    expect(s).toContain("wave-plans");
    expect(s).toContain("Wave resume");
  });
});
