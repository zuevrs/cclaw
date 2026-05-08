import { describe, expect, it } from "vitest";
import { CORE_AGENTS, renderAgentMarkdown } from "../../src/content/core-agents.js";

describe("core agents", () => {
  it("includes exactly six on-demand specialists", () => {
    expect(CORE_AGENTS).toHaveLength(6);
    for (const agent of CORE_AGENTS) {
      expect(agent.activation).toBe("on-demand");
    }
  });

  it("none of the legacy specialists survive", () => {
    const ids = new Set(CORE_AGENTS.map((agent) => agent.id));
    for (const legacy of [
      "researcher",
      "product-discovery",
      "divergent-thinker",
      "critic",
      "spec-validator",
      "spec-document-reviewer",
      "coherence-reviewer",
      "scope-guardian-reviewer",
      "feasibility-reviewer",
      "integration-overseer",
      "release-reviewer",
      "fixer",
      "doc-updater"
    ]) {
      expect(ids.has(legacy as never)).toBe(false);
    }
  });

  it("reviewer exposes five modes", () => {
    const reviewer = CORE_AGENTS.find((agent) => agent.id === "reviewer")!;
    expect(reviewer.modes).toEqual(["code", "text-review", "integration", "release", "adversarial"]);
  });

  it("slice-builder includes a fix-only mode", () => {
    const slice = CORE_AGENTS.find((agent) => agent.id === "slice-builder")!;
    expect(slice.modes).toContain("fix-only");
  });

  it("renders agent markdown with activation:on-demand", () => {
    const md = renderAgentMarkdown(CORE_AGENTS[0]);
    expect(md).toContain("activation: on-demand");
    expect(md).toContain("# ");
  });
});
