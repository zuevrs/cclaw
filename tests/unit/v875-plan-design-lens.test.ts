import { describe, expect, it } from "vitest";

import {
  DESIGN_QUALITY_AI_SLOP_SIGNALS,
  DESIGN_QUALITY_DIMENSIONS,
  renderDesignQualityAiSlopChecklist,
  renderDesignQualityRubricTable
} from "../../src/content/design-quality-rubric.js";
import {
  PLAN_DESIGN_PROMPT,
  REVIEWER_PROMPT,
  SPECIALIST_PROMPTS
} from "../../src/content/specialist-prompts/index.js";
import { CORE_AGENTS, SPECIALIST_AGENTS } from "../../src/content/core-agents.js";
import { AUTO_TRIGGER_SKILLS } from "../../src/content/skills.js";
import { START_COMMAND_BODY } from "../../src/content/start-command.js";
import { SPECIALISTS } from "../../src/types.js";

/**
 * v8.75 — Plan-design lens. Slimmed in v8.99 test-slim-down A2 to one
 * WIRING + one BEHAVIOR + one SECTION CONTRACT test.
 */

describe("v8.75 — plan-design wiring (SPECIALISTS + CORE_AGENTS + design-quality-discipline skill)", () => {
  it("WIRING — SPECIALISTS contains plan-design between plan-critic and plan-devex, SPECIALIST_PROMPTS exports a non-empty body identical to PLAN_DESIGN_PROMPT, CORE_AGENTS registers plan-design as an on-demand specialist with modes ⊇ {pre-impl-design}, SPECIALIST_AGENTS matches SPECIALISTS shape, and design-quality-discipline skill is registered at plan + review with triggers referencing both plan-design and reviewer", () => {
    expect(SPECIALISTS).toHaveLength(10);
    expect(SPECIALISTS).toContain("plan-design");
    const planCriticIdx = (SPECIALISTS as readonly string[]).indexOf("plan-critic");
    const planDesignIdx = (SPECIALISTS as readonly string[]).indexOf("plan-design");
    const planDevexIdx = (SPECIALISTS as readonly string[]).indexOf("plan-devex");
    expect(planDesignIdx).toBe(planCriticIdx + 1);
    expect(planDevexIdx).toBe(planDesignIdx + 1);

    expect(typeof SPECIALIST_PROMPTS["plan-design"]).toBe("string");
    expect(SPECIALIST_PROMPTS["plan-design"]).toBe(PLAN_DESIGN_PROMPT);

    const planDesignAgent = CORE_AGENTS.find((a) => a.id === "plan-design");
    expect(planDesignAgent).toBeDefined();
    expect(planDesignAgent!.kind).toBe("specialist");
    expect(planDesignAgent!.activation).toBe("on-demand");
    expect(planDesignAgent!.modes).toContain("pre-impl-design");
    expect(SPECIALIST_AGENTS.map((a) => a.id).sort()).toEqual([...SPECIALISTS].sort());

    const skill = AUTO_TRIGGER_SKILLS.find((s) => s.id === "design-quality-discipline");
    expect(skill).toBeDefined();
    expect(skill!.stages).toContain("plan");
    expect(skill!.stages).toContain("review");
    const triggers = skill!.triggers.join("\n");
    expect(triggers).toContain("plan-design");
    expect(triggers).toContain("reviewer");
    expect(skill!.body).toContain("design-quality-rubric.ts");
  });
});

describe("v8.75 — design-quality rubric shared-source-of-truth behavior", () => {
  it("BEHAVIOR — DESIGN_QUALITY_DIMENSIONS exports the 7 canonical dimensions in spec order with name/summary/anchor10, accessibility carries the WCAG AA 4.5:1/3:1 contrast anchors, DESIGN_QUALITY_AI_SLOP_SIGNALS has ≥6 patterns lifted verbatim (3-column grids, gradients, icons in colored circles), renderDesignQualityRubricTable emits the 3-column markdown table embedding every dimension, renderDesignQualityAiSlopChecklist emits one bullet per signal, and BOTH reviewer.ts and plan-design.ts embed the SAME rendered table + checklist (single source of truth)", () => {
    expect(DESIGN_QUALITY_DIMENSIONS).toHaveLength(7);
    expect(DESIGN_QUALITY_DIMENSIONS.map((d) => d.key)).toEqual([
      "visual-hierarchy",
      "type-system",
      "color-system",
      "spacing-rhythm",
      "interaction-affordances",
      "accessibility",
      "responsive"
    ]);
    for (const d of DESIGN_QUALITY_DIMENSIONS) {
      expect(d.summary.length).toBeGreaterThan(20);
      expect(d.anchor10.length).toBeGreaterThan(20);
    }
    const accessibility = DESIGN_QUALITY_DIMENSIONS.find((d) => d.key === "accessibility")!;
    expect(accessibility.name).toContain("WCAG AA");
    expect(accessibility.summary).toContain("4.5:1");
    expect(accessibility.summary).toContain("3:1");

    expect(DESIGN_QUALITY_AI_SLOP_SIGNALS.length).toBeGreaterThanOrEqual(6);
    const joined = DESIGN_QUALITY_AI_SLOP_SIGNALS.join("\n");
    expect(joined).toContain("3-column feature grids");
    expect(joined).toContain("gradients");
    expect(joined).toContain("icons in colored circles");

    const renderedTable = renderDesignQualityRubricTable();
    expect(renderedTable).toContain("| dimension | what it covers | what a 10 looks like |");
    expect(renderedTable).toContain("| --- | --- | --- |");
    for (const d of DESIGN_QUALITY_DIMENSIONS) {
      expect(renderedTable).toContain(`**${d.name}**`);
    }
    const renderedSlop = renderDesignQualityAiSlopChecklist();
    expect(renderedSlop.split("\n").filter((l) => l.startsWith("- "))).toHaveLength(DESIGN_QUALITY_AI_SLOP_SIGNALS.length);

    // both prompts embed both renderings verbatim
    expect(REVIEWER_PROMPT).toContain(renderedTable);
    expect(PLAN_DESIGN_PROMPT).toContain(renderedTable);
    expect(REVIEWER_PROMPT).toContain(renderedSlop);
    expect(PLAN_DESIGN_PROMPT).toContain(renderedSlop);
  });
});

describe("v8.75 — plan-design section contract (prompt body + start-command dispatch)", () => {
  it("SECTION CONTRACT — plan-design prompt opens with v8.74 adversarial-stance clause, declares ## Modes + ## Output schema + ## Composition footer (forbidding nested orchestration), the 7-dimension rubric walking the plan (not a diff), PD-N findings format with the canonical columns, block-ship floor at severity ≥ medium, pre-commitment requirement (3-5 predictions), designSurface gate, DESIGN.md + CONTEXT.md references, verdict pass|revise|block, cclaw-ethos.md preamble; start-command carries a `#### plan-design` sub-step with the design-surface gate, dispatch ordering after plan-critic / directly after architect, verdict routing, flow-state field patches, and a stage→specialist mapping row", () => {
    expect(PLAN_DESIGN_PROMPT).toMatch(/Adversarial stance:/);
    expect(PLAN_DESIGN_PROMPT).toMatch(/##\s+Modes/u);
    expect(PLAN_DESIGN_PROMPT).toMatch(/##\s+Output schema/u);
    expect(PLAN_DESIGN_PROMPT).toMatch(/##\s+Composition/u);
    expect(PLAN_DESIGN_PROMPT).toContain("on-demand specialist");
    expect(PLAN_DESIGN_PROMPT).toContain("Do not spawn");
    expect(PLAN_DESIGN_PROMPT).toMatch(/Seven-dimension rubric.*apply to the PLAN/i);
    expect(PLAN_DESIGN_PROMPT).toContain("PD-N");
    expect(PLAN_DESIGN_PROMPT).toContain("Plan-design findings");
    for (const column of ["Dimension", "Severity", "Anchor", "Description", "Suggested fix", "Status"]) {
      expect(PLAN_DESIGN_PROMPT).toContain(column);
    }
    expect(PLAN_DESIGN_PROMPT).toMatch(/block.{0,4}ship.{0,4}on.{0,4}strict|block-ship-on-strict/iu);
    expect(PLAN_DESIGN_PROMPT).toMatch(/severity\s*≥?\s*medium|≥\s*`?medium/u);
    expect(PLAN_DESIGN_PROMPT).toMatch(/Pre-commitment/i);
    expect(PLAN_DESIGN_PROMPT).toMatch(/3-5 predictions/i);
    expect(PLAN_DESIGN_PROMPT).toContain("designSurface");
    expect(PLAN_DESIGN_PROMPT).toContain("DESIGN.md");
    expect(PLAN_DESIGN_PROMPT).toContain("CONTEXT.md");
    expect(PLAN_DESIGN_PROMPT).toMatch(/verdict:\s*pass\s*\|\s*revise\s*\|\s*block/u);
    expect(PLAN_DESIGN_PROMPT).toContain("cclaw-ethos.md");

    // start-command dispatch
    expect(START_COMMAND_BODY).toContain("#### plan-design");
    const planDesignIdx = START_COMMAND_BODY.indexOf("#### plan-design");
    const planDesignBlock = START_COMMAND_BODY.slice(planDesignIdx, planDesignIdx + 8000);
    expect(planDesignBlock).toContain("triage.designSurface");
    expect(planDesignBlock).toMatch(/surfaces.*\b(ui|design|frontend|ux)\b/u);
    expect(planDesignBlock).toMatch(/after\s+plan-critic|plan-critic\s+(?:returns|gate fires|when)/u);
    expect(planDesignBlock).toMatch(/pass.{0,80}builder/u);
    expect(planDesignBlock).toMatch(/revise.{0,80}architect/u);
    expect(planDesignBlock).toMatch(/block.{0,80}stop-and-report/u);
    expect(START_COMMAND_BODY).toContain("planDesignVerdict");
    expect(START_COMMAND_BODY).toMatch(/\|\s*`plan-design`\s*\*\(gated/u);
  });
});
