import { promises as fs } from "node:fs";
import path from "node:path";
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
 * v8.75 — Plan-design-lens — front-loaded design audit.
 *
 * The release adds a pre-implementation `plan-design` specialist that walks
 * plan.md against the same seven-dimension design-quality rubric the v8.70
 * reviewer applies post-build. The rubric is extracted to a shared const at
 * `src/content/design-quality-rubric.ts` so both specialists pin the same
 * canonical dimensions, anchors, and AI-slop signals. Below-6 dimension
 * grades become `PD-N` findings appended to plan.md's `## Plan-design
 * findings` section; severity ≥ medium blocks ship in strict mode.
 *
 * Tripwires below pin the v8.75 invariants so a future change that drops
 * a dimension, re-inlines the rubric back into reviewer.ts, or silently
 * un-wires plan-design from the orchestrator lights up immediately.
 */

describe("v8.75 — SPECIALISTS roster includes plan-design (eight specialists at v8.75; ten at v8.82 after investigator + plan-devex joined)", () => {
  it("AC-1 — SPECIALISTS has exactly ten entries (v8.77 added investigator after triage; v8.82 added plan-devex after plan-design)", () => {
    expect(SPECIALISTS).toHaveLength(10);
  });

  it("AC-1 — SPECIALISTS contains `plan-design` (immediately after `plan-critic`, before `plan-devex`)", () => {
    expect(SPECIALISTS).toContain("plan-design");
    const planCriticIdx = (SPECIALISTS as readonly string[]).indexOf("plan-critic");
    const planDesignIdx = (SPECIALISTS as readonly string[]).indexOf("plan-design");
    const planDevexIdx = (SPECIALISTS as readonly string[]).indexOf("plan-devex");
    expect(planCriticIdx).toBeGreaterThan(-1);
    expect(planDesignIdx).toBe(planCriticIdx + 1);
    expect(planDevexIdx).toBe(planDesignIdx + 1);
  });

  it("AC-1 — SPECIALIST_PROMPTS exports a non-empty `plan-design` prompt", () => {
    expect(typeof SPECIALIST_PROMPTS["plan-design"]).toBe("string");
    expect(SPECIALIST_PROMPTS["plan-design"].length).toBeGreaterThan(2000);
    expect(SPECIALIST_PROMPTS["plan-design"]).toBe(PLAN_DESIGN_PROMPT);
  });

  it("AC-1 — CORE_AGENTS registers `plan-design` as a specialist on-demand sub-agent (modes ⊇ {pre-impl-design})", () => {
    const planDesignAgent = CORE_AGENTS.find((agent) => agent.id === "plan-design");
    expect(planDesignAgent).toBeDefined();
    expect(planDesignAgent!.kind).toBe("specialist");
    expect(planDesignAgent!.activation).toBe("on-demand");
    expect(planDesignAgent!.modes).toContain("pre-impl-design");
  });

  it("AC-1 — SPECIALIST_AGENTS roster shapes match the SPECIALISTS array exactly", () => {
    const specialistIds = SPECIALIST_AGENTS.map((agent) => agent.id).sort();
    expect(specialistIds).toEqual([...SPECIALISTS].sort());
  });
});

describe("v8.75 — design-quality rubric is a single source of truth shared by reviewer + plan-design", () => {
  it("AC-2 — DESIGN_QUALITY_DIMENSIONS exports exactly seven dimensions in the canonical order", () => {
    expect(DESIGN_QUALITY_DIMENSIONS).toHaveLength(7);
    const keys = DESIGN_QUALITY_DIMENSIONS.map((d) => d.key);
    expect(keys).toEqual([
      "visual-hierarchy",
      "type-system",
      "color-system",
      "spacing-rhythm",
      "interaction-affordances",
      "accessibility",
      "responsive"
    ]);
  });

  it("AC-2 — every dimension carries a `name`, `summary`, and `anchor10` (the `what a 10 looks like` reference)", () => {
    for (const dimension of DESIGN_QUALITY_DIMENSIONS) {
      expect(typeof dimension.key).toBe("string");
      expect(dimension.key.length).toBeGreaterThan(0);
      expect(typeof dimension.name).toBe("string");
      expect(dimension.name.length).toBeGreaterThan(0);
      expect(typeof dimension.summary).toBe("string");
      expect(dimension.summary.length).toBeGreaterThan(20);
      expect(typeof dimension.anchor10).toBe("string");
      expect(dimension.anchor10.length).toBeGreaterThan(20);
    }
  });

  it("AC-2 — accessibility carries the WCAG AA contrast anchor (4.5:1 body, 3:1 large/UI)", () => {
    const accessibility = DESIGN_QUALITY_DIMENSIONS.find((d) => d.key === "accessibility");
    expect(accessibility).toBeDefined();
    expect(accessibility!.name).toContain("WCAG AA");
    expect(accessibility!.summary).toContain("4.5:1");
    expect(accessibility!.summary).toContain("3:1");
  });

  it("AC-2 — DESIGN_QUALITY_AI_SLOP_SIGNALS exports at least six canonical patterns (lifted verbatim from v8.70 reviewer.ts)", () => {
    expect(DESIGN_QUALITY_AI_SLOP_SIGNALS.length).toBeGreaterThanOrEqual(6);
    const joined = DESIGN_QUALITY_AI_SLOP_SIGNALS.join("\n");
    expect(joined).toContain("3-column feature grids");
    expect(joined).toContain("gradients");
    expect(joined).toContain("icons in colored circles");
  });

  it("AC-2 — renderDesignQualityRubricTable() emits a 3-column markdown table embedding every dimension", () => {
    const rendered = renderDesignQualityRubricTable();
    expect(rendered).toContain("| dimension | what it covers | what a 10 looks like |");
    expect(rendered).toContain("| --- | --- | --- |");
    for (const dimension of DESIGN_QUALITY_DIMENSIONS) {
      expect(rendered).toContain(`**${dimension.name}**`);
    }
  });

  it("AC-2 — renderDesignQualityAiSlopChecklist() emits one bullet per signal", () => {
    const rendered = renderDesignQualityAiSlopChecklist();
    const bullets = rendered.split("\n").filter((line) => line.startsWith("- "));
    expect(bullets).toHaveLength(DESIGN_QUALITY_AI_SLOP_SIGNALS.length);
  });

  it("AC-2 — both reviewer.ts and plan-design.ts embed the SAME rendered rubric table (single source of truth: edit `design-quality-rubric.ts` only)", () => {
    const renderedTable = renderDesignQualityRubricTable();
    expect(REVIEWER_PROMPT).toContain(renderedTable);
    expect(PLAN_DESIGN_PROMPT).toContain(renderedTable);
  });

  it("AC-2 — both reviewer.ts and plan-design.ts embed the SAME rendered AI-slop checklist", () => {
    const renderedSlop = renderDesignQualityAiSlopChecklist();
    expect(REVIEWER_PROMPT).toContain(renderedSlop);
    expect(PLAN_DESIGN_PROMPT).toContain(renderedSlop);
  });
});

describe("v8.75 — plan-design prompt body discipline", () => {
  it("AC-3 — plan-design opens with the v8.74 force-stance clause (adversarial stance, dimensional)", () => {
    expect(PLAN_DESIGN_PROMPT).toMatch(/Adversarial stance:/);
    expect(PLAN_DESIGN_PROMPT).toMatch(/Look for disqualifying evidence first/);
  });

  it("AC-3 — plan-design declares ## Modes and ## Output schema (the SPECIALIST contract sections)", () => {
    expect(PLAN_DESIGN_PROMPT).toMatch(/##\s+Modes/u);
    expect(PLAN_DESIGN_PROMPT).toMatch(/##\s+Output schema/u);
  });

  it("AC-3 — plan-design ends with the ## Composition footer forbidding nested orchestration", () => {
    expect(PLAN_DESIGN_PROMPT).toMatch(/##\s+Composition/u);
    expect(PLAN_DESIGN_PROMPT).toContain("on-demand specialist");
    expect(PLAN_DESIGN_PROMPT).toContain("Do not spawn");
    expect(PLAN_DESIGN_PROMPT).toMatch(/Stop condition/u);
  });

  it("AC-3 — plan-design declares the seven-dimension rubric `walks the PLAN, not a diff`", () => {
    expect(PLAN_DESIGN_PROMPT).toMatch(/Seven-dimension rubric.*apply to the PLAN/i);
  });

  it("AC-3 — plan-design declares the `PD-N` findings format (Dimension / Severity / Anchor / Description / Suggested fix / Status)", () => {
    expect(PLAN_DESIGN_PROMPT).toContain("PD-N");
    expect(PLAN_DESIGN_PROMPT).toContain("Plan-design findings");
    for (const column of [
      "Dimension",
      "Severity",
      "Anchor",
      "Description",
      "Suggested fix",
      "Status"
    ]) {
      expect(PLAN_DESIGN_PROMPT).toContain(column);
    }
  });

  it("AC-3 — plan-design declares the strict block-ship floor at severity ≥ medium", () => {
    expect(PLAN_DESIGN_PROMPT).toMatch(/block.{0,4}ship.{0,4}on.{0,4}strict|block-ship-on-strict/iu);
    expect(PLAN_DESIGN_PROMPT).toMatch(/severity\s*≥?\s*medium|≥\s*`?medium/u);
  });

  it("AC-3 — plan-design distinguishes itself from the reviewer's design-quality axis (pre-build vs post-build)", () => {
    expect(PLAN_DESIGN_PROMPT).toContain("plan-critic");
    expect(PLAN_DESIGN_PROMPT).toContain("reviewer");
    expect(PLAN_DESIGN_PROMPT).toMatch(/post-build|post-implementation|after the code lands/i);
  });

  it("AC-3 — plan-design gate cites both triage.designSurface and triage.surfaces ∩ {ui,design,frontend,ux}", () => {
    expect(PLAN_DESIGN_PROMPT).toContain("designSurface");
    expect(PLAN_DESIGN_PROMPT).toMatch(/surfaces.*\{?ui|surfaces.*ui.*design/u);
  });

  it("AC-3 — plan-design references DESIGN.md and CONTEXT.md as optional project context", () => {
    expect(PLAN_DESIGN_PROMPT).toContain("DESIGN.md");
    expect(PLAN_DESIGN_PROMPT).toContain("CONTEXT.md");
  });

  it("AC-3 — plan-design verdict surface is pass / revise / block (no `cancel`; cancel is the user's prerogative)", () => {
    expect(PLAN_DESIGN_PROMPT).toMatch(/verdict:\s*pass\s*\|\s*revise\s*\|\s*block/u);
    expect(PLAN_DESIGN_PROMPT).toMatch(/never written by plan-design/i);
  });

  it("AC-3 — plan-design pre-commitment requires 3-5 predictions BEFORE detailed grading (same discipline as plan-critic / post-impl critic)", () => {
    expect(PLAN_DESIGN_PROMPT).toMatch(/Pre-commitment/i);
    expect(PLAN_DESIGN_PROMPT).toMatch(/3-5 predictions/i);
  });

  it("AC-3 — plan-design references the shared cclaw-ethos preamble (auto-prepended via dispatch envelope)", () => {
    expect(PLAN_DESIGN_PROMPT).toContain("cclaw-ethos.md");
    expect(PLAN_DESIGN_PROMPT).toMatch(/auto-prepended/i);
  });
});

describe("v8.75 — orchestrator dispatches plan-design after plan-critic on the design-surface gate", () => {
  it("AC-4 — start-command body carries a `#### plan-design` sub-step section", () => {
    expect(START_COMMAND_BODY).toContain("#### plan-design");
  });

  it("AC-4 — start-command names the design-surface gate (triage.designSurface OR triage.surfaces ∩ {ui,design,frontend,ux})", () => {
    const planDesignIdx = START_COMMAND_BODY.indexOf("#### plan-design");
    expect(planDesignIdx).toBeGreaterThan(0);
    const planDesignBlock = START_COMMAND_BODY.slice(planDesignIdx, planDesignIdx + 8000);
    expect(planDesignBlock).toContain("triage.designSurface");
    expect(planDesignBlock).toMatch(/surfaces.*\b(ui|design|frontend|ux)\b/u);
    expect(planDesignBlock).toMatch(/ceremonyMode.*\b(soft|strict)\b/u);
  });

  it("AC-4 — start-command names the dispatch ordering (after plan-critic, OR directly after architect when plan-critic is gated off)", () => {
    const planDesignIdx = START_COMMAND_BODY.indexOf("#### plan-design");
    const planDesignBlock = START_COMMAND_BODY.slice(planDesignIdx, planDesignIdx + 8000);
    expect(planDesignBlock).toMatch(/after\s+plan-critic|plan-critic\s+(?:returns|gate fires|when)/u);
    expect(planDesignBlock).toMatch(/(?:after architect|directly after architect)/u);
  });

  it("AC-4 — start-command names the verdict-routing semantics (pass → builder; revise → architect; block → stop-and-report)", () => {
    const planDesignIdx = START_COMMAND_BODY.indexOf("#### plan-design");
    const planDesignBlock = START_COMMAND_BODY.slice(planDesignIdx, planDesignIdx + 8000);
    expect(planDesignBlock).toMatch(/pass.{0,80}builder/u);
    expect(planDesignBlock).toMatch(/revise.{0,80}architect/u);
    expect(planDesignBlock).toMatch(/block.{0,80}stop-and-report/u);
  });

  it("AC-4 — start-command flow-state patches name planDesignVerdict / planDesignIteration / planDesignFindingsCount / planDesignDispatchedAt", () => {
    expect(START_COMMAND_BODY).toContain("planDesignVerdict");
    expect(START_COMMAND_BODY).toContain("planDesignIteration");
    expect(START_COMMAND_BODY).toContain("planDesignFindingsCount");
    expect(START_COMMAND_BODY).toContain("planDesignDispatchedAt");
  });

  it("AC-4 — start-command stage→specialist mapping table carries a `plan-design` row gated on the design-surface gate", () => {
    expect(START_COMMAND_BODY).toMatch(/\|\s*`plan-design`\s*\*\(gated/u);
  });
});

describe("v8.75 — design-quality-discipline skill auto-triggers at plan + review on design-surface flows", () => {
  it("AC-5 — AUTO_TRIGGER_SKILLS registers `design-quality-discipline` with stages plan + review", () => {
    const skill = AUTO_TRIGGER_SKILLS.find((s) => s.id === "design-quality-discipline");
    expect(skill).toBeDefined();
    expect(skill!.stages).toContain("plan");
    expect(skill!.stages).toContain("review");
  });

  it("AC-5 — design-quality-discipline triggers reference both `plan-design` and `reviewer` specialists", () => {
    const skill = AUTO_TRIGGER_SKILLS.find((s) => s.id === "design-quality-discipline");
    expect(skill).toBeDefined();
    const triggers = skill!.triggers.join("\n");
    expect(triggers).toContain("plan-design");
    expect(triggers).toContain("reviewer");
  });

  it("AC-5 — design-quality-discipline body cites the shared rubric source of truth (design-quality-rubric.ts)", async () => {
    const skill = AUTO_TRIGGER_SKILLS.find((s) => s.id === "design-quality-discipline");
    expect(skill).toBeDefined();
    expect(skill!.body).toContain("design-quality-rubric.ts");
    expect(skill!.body).toContain("plan-design");
    expect(skill!.body).toContain("reviewer");
  });
});

describe("v8.75 — version bump", () => {
  it("AC-6 — package.json bumps to 8.75.0 (or higher; subsequent releases are back-compat)", async () => {
    const pkg = JSON.parse(
      await fs.readFile(path.join(process.cwd(), "package.json"), "utf-8")
    ) as { version: string };
    const [major, minor] = pkg.version.split(".").map((n) => Number.parseInt(n, 10));
    expect(major).toBe(8);
    expect(minor).toBeGreaterThanOrEqual(75);
  });

  it("AC-6 — CHANGELOG.md carries a v8.75 entry", async () => {
    const changelog = await fs.readFile(
      path.join(process.cwd(), "CHANGELOG.md"),
      "utf-8"
    );
    expect(changelog).toMatch(/##\s*\[?8\.75\.0\]?/);
  });
});
