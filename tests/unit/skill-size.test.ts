import { describe, expect, it } from "vitest";
import { usingCclawSkillMarkdown } from "../../src/content/meta-skill.js";
import { stageSkillMarkdown } from "../../src/content/skills.js";
import { FLOW_STAGES } from "../../src/types.js";

describe("stage skill size budgets", () => {
  // Keep stage skills compact enough to scan while preserving the process map,
  // gate/evidence lists, artifact validation, closeout instructions, the
  // per-harness lifecycle recipe pointer, and the universal cross-cutting
  // mechanics block. Budget is generous on purpose — the layered structural
  // content (HARD-GATE, premise list, alternatives format, coverage diagram,
  // confidence-calibrated finding format) grows the skill body deliberately.
  it("keeps every stage skill under 480 lines", () => {
    for (const stage of FLOW_STAGES) {
      const markdown = stageSkillMarkdown(stage);
      const lines = markdown.split(/\r?\n/u).length;
      expect(
        lines,
        `stage "${stage}" exceeded 480 lines (${lines})`
      ).toBeLessThanOrEqual(480);
    }
  });

  it("keeps the injected using-cclaw router concise", () => {
    const lines = usingCclawSkillMarkdown().split(/\r?\n/u).length;
    expect(lines, `using-cclaw exceeded 170 lines (${lines})`).toBeLessThanOrEqual(170);
  });
});
