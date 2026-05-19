import { describe, expect, it } from "vitest";

import {
  AUTO_TRIGGER_SKILLS,
  buildAutoTriggerBlock,
  type GateEnvelope
} from "../../src/content/skills.js";
import { REVIEWER_PROMPT } from "../../src/content/specialist-prompts/reviewer.js";
import {
  ANTI_SLOP_DIMENSIONS,
  renderAntiSlopRubricTable
} from "../../src/content/anti-slop-rubric.js";

/**
 * v8.86 — Anti-slop graded reviewer axis. Slimmed in v8.99 test-slim-down
 * A2 to one WIRING + one BEHAVIOR + one SECTION CONTRACT test.
 */

const ANTI_SLOP_SKILL_ID = "reviewer-axis-anti-slop";

describe("v8.86 — anti-slop axis wiring (rubric module + companion skill + AUTO_TRIGGER_SKILLS + default-on gate)", () => {
  it("WIRING — ANTI_SLOP_DIMENSIONS exports the 4 canonical Karpathy-projection keys with non-trivial anchors, renderAntiSlopRubricTable emits a valid table, the companion skill is registered with stages=['review'] + default-on gate predicate, and GateEnvelope accepts walkAntiSlopAxis", () => {
    expect(ANTI_SLOP_DIMENSIONS).toHaveLength(4);
    const keys = ANTI_SLOP_DIMENSIONS.map((d) => d.key).sort();
    expect(keys).toEqual(
      ["senior-test", "speculative-flexibility", "single-use-abstraction", "orphan-cleanup-discipline"].sort()
    );
    for (const d of ANTI_SLOP_DIMENSIONS) {
      expect(typeof d.key).toBe("string");
      expect(typeof d.anchor10).toBe("string");
      expect(d.anchor10.length).toBeGreaterThan(80);
    }
    const table = renderAntiSlopRubricTable();
    expect(table).toContain("| dimension | what it covers | what a 10 looks like |");
    expect(table).toContain("| --- | --- | --- |");
    for (const dim of ANTI_SLOP_DIMENSIONS) {
      expect(table).toContain(`| **${dim.name}** |`);
    }

    const skill = AUTO_TRIGGER_SKILLS.find((s) => s.id === ANTI_SLOP_SKILL_ID);
    expect(skill, "AUTO_TRIGGER_SKILLS must register reviewer-axis-anti-slop").toBeDefined();
    expect(skill!.stages).toEqual(["review"]);
    expect(typeof skill!.gate).toBe("function");
    expect(skill!.body.length).toBeGreaterThan(3000);
    expect(skill!.fileName).toBe(`${ANTI_SLOP_SKILL_ID}.md`);

    // Default-on gate contract (the key differentiator from v8.83's surface-driven axes)
    const gate = skill!.gate!;
    expect(gate({})).toBe(true);
    expect(gate({ walkAntiSlopAxis: true })).toBe(true);
    expect(gate({ walkAntiSlopAxis: false })).toBe(false);
    expect(
      gate({
        walkQaEvidenceAxis: false,
        walkScopeDriftAxis: false,
        walkAssumptionCoverageAxis: false
      } as GateEnvelope)
    ).toBe(true);

    // reviewer-axis cohort grew to ≥8 with anti-slop in the set
    const reviewerAxisSkills = AUTO_TRIGGER_SKILLS.filter((s) => s.id.startsWith("reviewer-axis-"));
    expect(reviewerAxisSkills.length).toBeGreaterThanOrEqual(8);
    expect(reviewerAxisSkills.map((s) => s.id)).toContain(ANTI_SLOP_SKILL_ID);
  });
});

describe("v8.86 — anti-slop axis behavior (buildAutoTriggerBlock honors default-on contract + AS-N finding format)", () => {
  it("BEHAVIOR — buildAutoTriggerBlock emits the anti-slop pointer in legacy/empty/true envelopes, filters out ONLY on explicit walkAntiSlopAxis:false, and the canonical AS-N finding grammar parses for all four dimensions", () => {
    expect(buildAutoTriggerBlock("review")).toContain(ANTI_SLOP_SKILL_ID);
    expect(buildAutoTriggerBlock("review", {})).toContain(ANTI_SLOP_SKILL_ID);
    expect(buildAutoTriggerBlock("review", { walkAntiSlopAxis: true })).toContain(ANTI_SLOP_SKILL_ID);
    expect(buildAutoTriggerBlock("review", { walkAntiSlopAxis: false })).not.toContain(ANTI_SLOP_SKILL_ID);

    const explicitDisable = buildAutoTriggerBlock("review", {
      walkAntiSlopAxis: false,
      walkScopeDriftAxis: true,
      walkAssumptionCoverageAxis: true
    });
    expect(explicitDisable).not.toContain(ANTI_SLOP_SKILL_ID);
    expect(explicitDisable).toContain("reviewer-axis-scope-drift");
    expect(explicitDisable).toContain("reviewer-axis-assumption-coverage");

    const VALID_FINDING_LINE_RE = /^AS-(\d+):\s*([a-z-]+)\s+at\s+(\d{1,2})\/10:\s*(.+)$/;
    const cases = [
      "AS-1: senior-test at 4/10: foo",
      "AS-2: speculative-flexibility at 3/10: bar",
      "AS-3: single-use-abstraction at 5/10: baz",
      "AS-4: orphan-cleanup-discipline at 2/10: qux"
    ];
    for (const line of cases) {
      const match = VALID_FINDING_LINE_RE.exec(line);
      expect(match, `expected ${line} to parse`).not.toBeNull();
      expect(ANTI_SLOP_DIMENSIONS.map((d) => d.key)).toContain(match![2]);
    }
    expect(VALID_FINDING_LINE_RE.exec("F-7: senior-test at 3/10: foo")).toBeNull();
    expect(VALID_FINDING_LINE_RE.exec("AS-1: senior-test: foo")).toBeNull();
  });
});

describe("v8.86 — anti-slop axis section contract (reviewer prompt declares Fourteen-axis intro + gated stub + AS-N namespace + slim counter + dedup enum)", () => {
  it("SECTION CONTRACT — reviewer prompt declares Fourteen-axis intro, gated `anti-slop` axis-table row, `### Anti-slop axis (gated; default-on; v8.86)` stub naming the companion skill + AS-N finding + Karpathy Simplicity First link, embeds the rendered rubric table, and slim-summary `as=N` counter is documented + listed in the dedup enum", () => {
    expect(REVIEWER_PROMPT).toMatch(/Fourteen-axis review/);
    expect(REVIEWER_PROMPT).not.toMatch(/Thirteen-axis review/);
    expect(REVIEWER_PROMPT).toMatch(/Fourteen axes; five severities/);
    expect(REVIEWER_PROMPT).toMatch(/\|\s*`anti-slop`\s*\(\*\*gated\*\*\)\s*—\s*v8\.86/);
    expect(REVIEWER_PROMPT).toMatch(/^###\s+Anti-slop axis \(gated;\s*default-on;\s*v8\.86\)/m);
    expect(REVIEWER_PROMPT).toContain(ANTI_SLOP_SKILL_ID);
    expect(REVIEWER_PROMPT).toContain(`.cclaw/lib/skills/${ANTI_SLOP_SKILL_ID}.md`);
    expect(REVIEWER_PROMPT).toMatch(/AS-N:\s*<dimension>\s*at\s*<grade>:\s*<description>/);
    expect(REVIEWER_PROMPT).toMatch(/Simplicity First/);
    expect(REVIEWER_PROMPT).toMatch(/Karpathy/i);
    for (const dim of ANTI_SLOP_DIMENSIONS) {
      expect(REVIEWER_PROMPT).toContain(`| **${dim.name}** |`);
    }
    expect(REVIEWER_PROMPT).toMatch(/as=N/);
    expect(REVIEWER_PROMPT).toMatch(/`as=N` is \*\*only\*\* present when the anti-slop gate fired/);
    expect(REVIEWER_PROMPT).toMatch(/\[as=N\]/);
    expect(REVIEWER_PROMPT).toMatch(/\/\s*`anti-slop`\s*\)\./);
  });
});
