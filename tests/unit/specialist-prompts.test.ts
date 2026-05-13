import { describe, expect, it } from "vitest";
import { SPECIALIST_PROMPTS } from "../../src/content/specialist-prompts/index.js";
import {
  CORE_AGENTS,
  RESEARCH_AGENTS,
  SPECIALIST_AGENTS,
  renderAgentMarkdown
} from "../../src/content/core-agents.js";
import { RESEARCH_AGENT_IDS, SPECIALISTS } from "../../src/types.js";

describe("specialist prompts", () => {
  it("ships a prompt for every specialist id", () => {
    for (const id of SPECIALISTS) {
      expect(typeof SPECIALIST_PROMPTS[id]).toBe("string");
      expect(SPECIALIST_PROMPTS[id].length).toBeGreaterThan(800);
    }
  });

  it("each prompt declares postures/modes and an output schema", () => {
    for (const id of SPECIALISTS) {
      const prompt = SPECIALIST_PROMPTS[id];
      // v8.14: design uses "Posture" instead of "Modes" (guided/deep)
      if (id === "design") {
        expect(prompt).toMatch(/##\s+Posture/u);
      } else {
        expect(prompt).toMatch(/##\s+Modes/u);
      }
      expect(prompt).toMatch(/Output schema|Output\b/u);
    }
  });

  it("reviewer prompt references the Five Failure Modes", () => {
    const prompt = SPECIALIST_PROMPTS["reviewer"];
    expect(prompt).toContain("Hallucinated actions");
    expect(prompt).toContain("Tool misuse");
  });

  it("slice-builder prompt uses plain `git commit` with posture-driven prefixes (v8.40: commit-helper retired)", () => {
    const prompt = SPECIALIST_PROMPTS["slice-builder"];
    expect(prompt).toContain("git commit");
    expect(prompt).toContain("red(AC-");
    expect(prompt).toContain("green(AC-");
    expect(prompt).toContain("refactor(AC-");
    expect(prompt).not.toContain("commit-helper");
  });

  it("SPECIALIST_AGENTS use the deep specialist prompts", () => {
    for (const agent of SPECIALIST_AGENTS) {
      expect(agent.prompt).toBe(SPECIALIST_PROMPTS[agent.id]);
    }
  });

  it("RESEARCH_AGENTS ship a non-empty prompt body", () => {
    for (const agent of RESEARCH_AGENTS) {
      expect(typeof agent.prompt).toBe("string");
      expect(agent.prompt.length).toBeGreaterThan(800);
      expect(agent.prompt).toMatch(/##\s+Composition/u);
    }
  });

  it("RESEARCH_AGENTS cover every research-helper id", () => {
    const ids = new Set(RESEARCH_AGENTS.map((agent) => agent.id));
    for (const id of RESEARCH_AGENT_IDS) {
      expect(ids.has(id)).toBe(true);
    }
  });

  it("CORE_AGENTS rendering produces both kinds", () => {
    const kinds = new Set(CORE_AGENTS.map((agent) => agent.kind));
    expect(kinds.has("specialist")).toBe(true);
    expect(kinds.has("research")).toBe(true);
  });

  it("every specialist prompt ends with a Composition footer that forbids nested orchestration", () => {
    for (const id of SPECIALISTS) {
      const prompt = SPECIALIST_PROMPTS[id];
      expect(prompt).toMatch(/##\s+Composition/u);
      // v8.14: design is the one main-context specialist; everyone else is on-demand
      if (id === "design") {
        expect(prompt).toContain("main orchestrator context");
      } else {
        expect(prompt).toContain("on-demand specialist");
      }
      expect(prompt).toContain("Do not spawn");
      expect(prompt).toMatch(/Stop condition/u);
    }
  });

  it("slice-builder Composition footer mentions parallel-build dispatch contract", () => {
    expect(SPECIALIST_PROMPTS["slice-builder"]).toContain("Parallel-dispatch contract");
    expect(SPECIALIST_PROMPTS["slice-builder"]).toContain("touchSurface");
  });

  it("slice-builder hard rules forbid env shims and redundant verification", () => {
    const prompt = SPECIALIST_PROMPTS["slice-builder"];
    expect(prompt).toContain("No redundant verification");
    expect(prompt).toContain("No environment shims");
    expect(prompt).toContain(".cclaw/lib/skills/anti-slop.md");
  });

  it("renderAgentMarkdown emits a frontmatter with name + activation", () => {
    const acAuthor = SPECIALIST_AGENTS.find((agent) => agent.id === "ac-author")!;
    const md = renderAgentMarkdown(acAuthor);
    expect(md.startsWith("---\n")).toBe(true);
    expect(md).toContain("activation: on-demand");
    expect(md).toContain("## Modes");

    const design = SPECIALIST_AGENTS.find((agent) => agent.id === "design")!;
    const designMd = renderAgentMarkdown(design);
    expect(designMd.startsWith("---\n")).toBe(true);
    expect(designMd).toContain("activation: main-context");
  });
});
