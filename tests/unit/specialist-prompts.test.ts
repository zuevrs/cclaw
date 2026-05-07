import { describe, expect, it } from "vitest";
import { SPECIALIST_PROMPTS } from "../../src/content/specialist-prompts/index.js";
import { CORE_AGENTS, renderAgentMarkdown } from "../../src/content/core-agents.js";
import { SPECIALISTS } from "../../src/types.js";

describe("specialist prompts", () => {
  it("ships a prompt for every specialist id", () => {
    for (const id of SPECIALISTS) {
      expect(typeof SPECIALIST_PROMPTS[id]).toBe("string");
      expect(SPECIALIST_PROMPTS[id].length).toBeGreaterThan(800);
    }
  });

  it("each prompt declares modes and an output schema", () => {
    for (const id of SPECIALISTS) {
      const prompt = SPECIALIST_PROMPTS[id];
      expect(prompt).toMatch(/##\s+Modes/u);
      expect(prompt).toMatch(/Output schema|Output\b/u);
    }
  });

  it("reviewer prompt references the Five Failure Modes", () => {
    const prompt = SPECIALIST_PROMPTS["reviewer"];
    expect(prompt).toContain("Hallucinated actions");
    expect(prompt).toContain("Tool misuse");
  });

  it("slice-builder prompt enforces commit-helper.mjs invocation", () => {
    expect(SPECIALIST_PROMPTS["slice-builder"]).toContain("commit-helper.mjs");
  });

  it("CORE_AGENTS use the deep specialist prompts", () => {
    for (const agent of CORE_AGENTS) {
      expect(agent.prompt).toBe(SPECIALIST_PROMPTS[agent.id]);
    }
  });

  it("renderAgentMarkdown emits a frontmatter with name + activation", () => {
    const md = renderAgentMarkdown(CORE_AGENTS[0]);
    expect(md.startsWith("---\n")).toBe(true);
    expect(md).toContain("activation: on-demand");
    expect(md).toContain("## Modes");
  });
});
