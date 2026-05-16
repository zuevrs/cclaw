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

  it("each prompt declares postures/modes and an output schema (v8.62 — `architect` uses Posture (lite/standard/strict) because it absorbed the dead `design` specialist's posture-driven phase scaling)", () => {
    for (const id of SPECIALISTS) {
      const prompt = SPECIALIST_PROMPTS[id];
      if (id === "architect") {
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

  it("builder prompt uses plain `git commit` with posture-driven prefixes (v8.63 — slice work commits use SL-N; AC verification commits use AC-N)", () => {
    const prompt = SPECIALIST_PROMPTS["builder"];
    expect(prompt).toContain("git commit");
    expect(prompt).toContain("red(SL-");
    expect(prompt).toContain("green(SL-");
    expect(prompt).toContain("refactor(SL-");
    expect(prompt).toContain("verify(AC-");
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

  it("every specialist prompt ends with a Composition footer that forbids nested orchestration (v8.62 — no specialist activates main-context any more; `architect` writes plan.md silently as an on-demand sub-agent, the mid-plan dialogue protocol is dead)", () => {
    for (const id of SPECIALISTS) {
      const prompt = SPECIALIST_PROMPTS[id];
      expect(prompt).toMatch(/##\s+Composition/u);
      expect(prompt).toContain("on-demand specialist");
      expect(prompt).toContain("Do not spawn");
      expect(prompt).toMatch(/Stop condition/u);
    }
  });

  it("builder Composition footer mentions parallel-build dispatch contract (v8.63 — slice-based assignment, AC verification runs serially)", () => {
    expect(SPECIALIST_PROMPTS["builder"]).toContain("Parallel-dispatch contract");
    expect(SPECIALIST_PROMPTS["builder"]).toContain("assigned_slices");
    expect(SPECIALIST_PROMPTS["builder"]).toContain("Surface");
  });

  it("builder hard rules forbid env shims and redundant verification", () => {
    const prompt = SPECIALIST_PROMPTS["builder"];
    expect(prompt).toContain("No redundant verification");
    expect(prompt).toContain("No environment shims");
    expect(prompt).toContain(".cclaw/lib/skills/anti-slop.md");
  });

  it("renderAgentMarkdown emits a frontmatter with name + activation (v8.62 — `architect` and `builder` both render as on-demand sub-agents)", () => {
    const architect = SPECIALIST_AGENTS.find((agent) => agent.id === "architect")!;
    const md = renderAgentMarkdown(architect);
    expect(md.startsWith("---\n")).toBe(true);
    expect(md).toContain("activation: on-demand");
    expect(md).toContain("## Posture");

    const builder = SPECIALIST_AGENTS.find((agent) => agent.id === "builder")!;
    const builderMd = renderAgentMarkdown(builder);
    expect(builderMd.startsWith("---\n")).toBe(true);
    expect(builderMd).toContain("activation: on-demand");
    expect(builderMd).toContain("## Modes");
  });
});
