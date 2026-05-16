import { describe, expect, it } from "vitest";
import {
  CORE_AGENTS,
  RESEARCH_AGENTS,
  SPECIALIST_AGENTS,
  renderAgentMarkdown
} from "../../src/content/core-agents.js";

describe("core agents", () => {
  it("ships seven specialists (all on-demand) and two research helpers — v8.62 unified flow drops `design` (absorbed into `architect`, renamed from `ac-author`) and `security-reviewer` (absorbed into `reviewer`'s `security` axis), renames `slice-builder` → `builder`, and demotes every specialist (including `architect`) to on-demand activation since v8.61 dropped the main-context dialogue protocol", () => {
    expect(SPECIALIST_AGENTS).toHaveLength(7);
    for (const agent of SPECIALIST_AGENTS) {
      expect(agent.kind).toBe("specialist");
      expect(agent.activation).toBe("on-demand");
    }
    expect(RESEARCH_AGENTS).toHaveLength(2);
    for (const agent of RESEARCH_AGENTS) {
      expect(agent.activation).toBe("on-demand");
      expect(agent.kind).toBe("research");
    }
    expect(CORE_AGENTS).toHaveLength(SPECIALIST_AGENTS.length + RESEARCH_AGENTS.length);
  });

  it("none of the legacy specialists survive — v8.62 retired `design`, `ac-author`, `slice-builder`, `security-reviewer`; earlier retirements still off the roster", () => {
    const ids = new Set(CORE_AGENTS.map((agent) => agent.id));
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
      // v8.62 retirements:
      "design",
      "ac-author",
      "slice-builder",
      "security-reviewer"
    ]) {
      expect(ids.has(legacy as never)).toBe(false);
    }
  });

  it("v8.62 — `architect` (renamed from `ac-author`, absorbing dead `design`'s Phase 0/2-6 work) is registered as an on-demand specialist", () => {
    const architect = SPECIALIST_AGENTS.find((agent) => agent.id === "architect");
    expect(architect, "architect specialist must be registered in SPECIALIST_AGENTS").toBeDefined();
    expect(architect!.activation).toBe("on-demand");
    expect(architect!.kind).toBe("specialist");
  });

  it("v8.62 — `builder` (renamed from `slice-builder`, AC-as-unit semantics unchanged) is registered as an on-demand specialist with a fix-only mode", () => {
    const builder = SPECIALIST_AGENTS.find((agent) => agent.id === "builder");
    expect(builder, "builder specialist must be registered in SPECIALIST_AGENTS").toBeDefined();
    expect(builder!.activation).toBe("on-demand");
    expect(builder!.modes).toContain("fix-only");
  });

  it("v8.42 — `critic` is registered as an on-demand specialist with gap / adversarial modes", () => {
    const critic = SPECIALIST_AGENTS.find((agent) => agent.id === "critic");
    expect(critic, "critic specialist must be registered in SPECIALIST_AGENTS").toBeDefined();
    expect(critic!.activation).toBe("on-demand");
    expect(critic!.kind).toBe("specialist");
    expect(critic!.modes).toEqual(["gap", "adversarial"]);
  });

  it("reviewer exposes five modes (v8.62 — security-reviewer's threat-model / taint / secrets / supply-chain prose absorbed into the reviewer's `security` axis, not into a new mode)", () => {
    const reviewer = SPECIALIST_AGENTS.find((agent) => agent.id === "reviewer")!;
    expect(reviewer.modes).toEqual(["code", "text-review", "integration", "release", "adversarial"]);
  });

  it("renders agent markdown with the agent's activation value (v8.62 — `architect` and `builder` both render as on-demand sub-agents)", () => {
    const architectAgent = SPECIALIST_AGENTS.find((agent) => agent.id === "architect")!;
    const architectMd = renderAgentMarkdown(architectAgent);
    expect(architectMd).toContain("activation: on-demand");
    expect(architectMd).toContain("# ");

    const builderAgent = SPECIALIST_AGENTS.find((agent) => agent.id === "builder")!;
    const builderMd = renderAgentMarkdown(builderAgent);
    expect(builderMd).toContain("activation: on-demand");
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
