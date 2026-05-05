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
  // The TDD skill carries the largest body (per-slice ritual, wave batch mode,
  // controller dispatch ordering, slice-builder appendix). Adjust the cap only
  // when a real protocol expansion lands — not drive-by prose.
  it("keeps every stage skill under 548 lines (default render)", () => {
    for (const stage of FLOW_STAGES) {
      const markdown = stageSkillMarkdown(stage);
      const lines = markdown.split(/\r?\n/u).length;
      expect(
        lines,
        `stage "${stage}" exceeded 548 lines (${lines})`
      ).toBeLessThanOrEqual(548);
    }
  });

  it("keeps the injected using-cclaw router concise", () => {
    const lines = usingCclawSkillMarkdown().split(/\r?\n/u).length;
    expect(lines, `using-cclaw exceeded 170 lines (${lines})`).toBeLessThanOrEqual(170);
  });
});
