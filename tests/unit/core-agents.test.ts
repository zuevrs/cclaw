import { describe, expect, it } from "vitest";
import {
  CORE_AGENTS,
  RESEARCH_AGENTS,
  SPECIALIST_AGENTS,
  renderAgentMarkdown
} from "../../src/content/core-agents.js";

describe("core agents", () => {
  it("ships seven specialists (one main-context, six on-demand) and two research helpers — v8.42 added critic; v8.51 added plan-critic", () => {
    expect(SPECIALIST_AGENTS).toHaveLength(7);
    for (const agent of SPECIALIST_AGENTS) {
      expect(agent.kind).toBe("specialist");
    }
    const designAgent = SPECIALIST_AGENTS.find((agent) => agent.id === "design")!;
    expect(designAgent.activation).toBe("main-context");
    const subAgentSpecialists = SPECIALIST_AGENTS.filter((agent) => agent.id !== "design");
    expect(subAgentSpecialists).toHaveLength(6);
    for (const agent of subAgentSpecialists) {
      expect(agent.activation).toBe("on-demand");
    }
    expect(RESEARCH_AGENTS).toHaveLength(2);
    for (const agent of RESEARCH_AGENTS) {
      expect(agent.activation).toBe("on-demand");
      expect(agent.kind).toBe("research");
    }
    expect(CORE_AGENTS).toHaveLength(SPECIALIST_AGENTS.length + RESEARCH_AGENTS.length);
  });

  it("none of the legacy specialists survive (v8.42 reclaimed the legacy `critic` id for the new adversarial critic specialist; the legacy `critic` was a pre-v8.14 OMC-style id that never shipped in cclaw)", () => {
    const ids = new Set(CORE_AGENTS.map((agent) => agent.id));
    // v8.42 — `critic` is now a live specialist id, removed from this
    // legacy-survival assertion list. The remaining entries below are
    // genuine legacy ids that were retired across v8.7-v8.14.
    for (const legacy of [
      "researcher",
      "product-discovery",
      "divergent-thinker",
      "spec-validator",
      "spec-document-reviewer",
      "coherence-reviewer",
      "scope-guardian-reviewer",
      "feasibility-reviewer",
      "integration-overseer",
      "release-reviewer",
      "fixer",
      "doc-updater",
      "brainstormer",
      "architect"
    ]) {
      expect(ids.has(legacy as never)).toBe(false);
    }
  });

  it("v8.42 — `critic` is registered as an on-demand specialist with gap / adversarial modes", () => {
    const critic = SPECIALIST_AGENTS.find((agent) => agent.id === "critic");
    expect(critic, "critic specialist must be registered in SPECIALIST_AGENTS").toBeDefined();
    expect(critic!.activation).toBe("on-demand");
    expect(critic!.kind).toBe("specialist");
    expect(critic!.modes).toEqual(["gap", "adversarial"]);
  });

  it("reviewer exposes five modes", () => {
    const reviewer = SPECIALIST_AGENTS.find((agent) => agent.id === "reviewer")!;
    expect(reviewer.modes).toEqual(["code", "text-review", "integration", "release", "adversarial"]);
  });

  it("slice-builder includes a fix-only mode", () => {
    const slice = SPECIALIST_AGENTS.find((agent) => agent.id === "slice-builder")!;
    expect(slice.modes).toContain("fix-only");
  });

  it("renders agent markdown with the agent's activation value", () => {
    const designAgent = SPECIALIST_AGENTS.find((agent) => agent.id === "design")!;
    const designMd = renderAgentMarkdown(designAgent);
    expect(designMd).toContain("activation: main-context");
    expect(designMd).toContain("# ");

    const acAuthorAgent = SPECIALIST_AGENTS.find((agent) => agent.id === "ac-author")!;
    const acAuthorMd = renderAgentMarkdown(acAuthorAgent);
    expect(acAuthorMd).toContain("activation: on-demand");
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
