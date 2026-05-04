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
  // v6.12.0 — bumped 480 → 520 to fit the new top-of-tdd-skill `## Per-Slice
  // Ritual` and `## Wave Batch Mode` blocks. Adjust again only if a real
  // protocol expansion (not drive-by prose) lands in a future release.
  // v6.14.1 — bumped 520 → 528 to fit four real protocol expansions in the
  // tdd checklist: controller dispatch ordering, wave-closure
  // integration-overseer decision, inline-DOC opt-in for single-slice
  // non-deep waves, and stale active-span recovery (--allow-parallel).
  // These are not drive-by prose; each row is referenced by an enforcement
  // surface (linter rule, `delegation-record --audit-kind` hook, or
  // `--finalize-doc` invocation).
  it("keeps every stage skill under 528 lines", () => {
    for (const stage of FLOW_STAGES) {
      const markdown = stageSkillMarkdown(stage);
      const lines = markdown.split(/\r?\n/u).length;
      expect(
        lines,
        `stage "${stage}" exceeded 528 lines (${lines})`
      ).toBeLessThanOrEqual(528);
    }
  });

  it("keeps the injected using-cclaw router concise", () => {
    const lines = usingCclawSkillMarkdown().split(/\r?\n/u).length;
    expect(lines, `using-cclaw exceeded 170 lines (${lines})`).toBeLessThanOrEqual(170);
  });
});
