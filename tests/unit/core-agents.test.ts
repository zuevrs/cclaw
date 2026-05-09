import { describe, expect, it } from "vitest";
import {
  CORE_AGENTS,
  RESEARCH_AGENTS,
  SPECIALIST_AGENTS,
  renderAgentMarkdown
} from "../../src/content/core-agents.js";

describe("core agents", () => {
  it("ships six on-demand specialists and two research helpers", () => {
    expect(SPECIALIST_AGENTS).toHaveLength(6);
    for (const agent of SPECIALIST_AGENTS) {
      expect(agent.activation).toBe("on-demand");
      expect(agent.kind).toBe("specialist");
    }
    expect(RESEARCH_AGENTS).toHaveLength(2);
    for (const agent of RESEARCH_AGENTS) {
      expect(agent.activation).toBe("on-demand");
      expect(agent.kind).toBe("research");
    }
    expect(CORE_AGENTS).toHaveLength(SPECIALIST_AGENTS.length + RESEARCH_AGENTS.length);
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
    const reviewer = SPECIALIST_AGENTS.find((agent) => agent.id === "reviewer")!;
    expect(reviewer.modes).toEqual(["code", "text-review", "integration", "release", "adversarial"]);
  });

  it("slice-builder includes a fix-only mode", () => {
    const slice = SPECIALIST_AGENTS.find((agent) => agent.id === "slice-builder")!;
    expect(slice.modes).toContain("fix-only");
  });

  it("renders agent markdown with activation:on-demand", () => {
    const md = renderAgentMarkdown(SPECIALIST_AGENTS[0]);
    expect(md).toContain("activation: on-demand");
    expect(md).toContain("# ");
  });

  it("research helpers render with kind: research-helper in frontmatter", () => {
    const md = renderAgentMarkdown(RESEARCH_AGENTS[0]);
    expect(md).toContain("kind: research-helper");
    expect(md).toContain("activation: on-demand");
  });

  it("research helper ids are stable", () => {
    const ids = RESEARCH_AGENTS.map((agent) => agent.id).sort();
    expect(ids).toEqual(["learnings-research", "repo-research"]);
  });
});
