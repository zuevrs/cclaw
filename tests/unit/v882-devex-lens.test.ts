import { describe, expect, it } from "vitest";

import {
  DEVEX_QUALITY_AI_SLOP_SIGNALS,
  DEVEX_QUALITY_DIMENSIONS,
  renderDevexQualityAiSlopChecklist,
  renderDevexQualityRubricTable
} from "../../src/content/devex-quality-rubric.js";
import {
  PLAN_DEVEX_PROMPT,
  SPECIALIST_PROMPTS,
  TRIAGE_PROMPT
} from "../../src/content/specialist-prompts/index.js";
import { CORE_AGENTS, SPECIALIST_AGENTS } from "../../src/content/core-agents.js";
import { AUTO_TRIGGER_SKILLS } from "../../src/content/skills.js";
import { START_COMMAND_BODY } from "../../src/content/start-command.js";
import { SPECIALISTS } from "../../src/types.js";

/**
 * v8.82 — plan-devex specialist + DevEx rubric. Slimmed in v8.99
 * test-slim-down A2 to one WIRING + one BEHAVIOR + one SECTION CONTRACT.
 */

describe("v8.82 — plan-devex wiring (SPECIALISTS roster + CORE_AGENTS + devex-quality-discipline skill)", () => {
  it("WIRING — SPECIALISTS registers plan-devex (immediately after plan-design, before qa-runner), SPECIALIST_PROMPTS exports a non-empty prompt, CORE_AGENTS registers it as on-demand specialist with modes ⊇ {pre-impl-devex}, and devex-quality-discipline skill triggers reference plan-devex", () => {
    expect(SPECIALISTS).toHaveLength(10);
    expect(SPECIALISTS).toContain("plan-devex");
    const planDesignIdx = (SPECIALISTS as readonly string[]).indexOf("plan-design");
    const planDevexIdx = (SPECIALISTS as readonly string[]).indexOf("plan-devex");
    const qaRunnerIdx = (SPECIALISTS as readonly string[]).indexOf("qa-runner");
    expect(planDevexIdx).toBe(planDesignIdx + 1);
    expect(qaRunnerIdx).toBe(planDevexIdx + 1);

    expect(typeof SPECIALIST_PROMPTS["plan-devex"]).toBe("string");
    expect(SPECIALIST_PROMPTS["plan-devex"]).toBe(PLAN_DEVEX_PROMPT);

    const planDevexAgent = CORE_AGENTS.find((a) => a.id === "plan-devex");
    expect(planDevexAgent).toBeDefined();
    expect(planDevexAgent!.kind).toBe("specialist");
    expect(planDevexAgent!.activation).toBe("on-demand");
    expect(planDevexAgent!.modes).toContain("pre-impl-devex");
    expect(SPECIALIST_AGENTS.map((a) => a.id).sort()).toEqual([...SPECIALISTS].sort());

    const skill = AUTO_TRIGGER_SKILLS.find((s) => s.id === "devex-quality-discipline");
    expect(skill).toBeDefined();
    expect(skill!.stages).toContain("plan");
    expect(skill!.triggers.join("\n")).toContain("plan-devex");
    expect(skill!.body).toContain("devex-quality-rubric.ts");
  });
});

describe("v8.82 — DevEx rubric shared-source-of-truth behavior (6 dimensions + AI-slop signals + renderers)", () => {
  it("BEHAVIOR — DEVEX_QUALITY_DIMENSIONS exports the 6 canonical dimensions in order with name/summary/anchor10, DEVEX_QUALITY_AI_SLOP_SIGNALS has ≥6 patterns, renderDevexQualityRubricTable emits the 3-column table embedding every dimension, renderDevexQualityAiSlopChecklist emits one bullet per signal, and plan-devex.ts embeds BOTH rendered outputs verbatim (single source of truth)", () => {
    expect(DEVEX_QUALITY_DIMENSIONS).toHaveLength(6);
    expect(DEVEX_QUALITY_DIMENSIONS.map((d) => d.key)).toEqual([
      "getting-started",
      "api-ergonomics",
      "error-messages",
      "docs",
      "upgrade-path",
      "measurement"
    ]);
    for (const d of DEVEX_QUALITY_DIMENSIONS) {
      expect(d.summary.length).toBeGreaterThan(20);
      expect(d.anchor10.length).toBeGreaterThan(20);
    }
    expect(DEVEX_QUALITY_DIMENSIONS.find((d) => d.key === "getting-started")!.summary).toMatch(
      /Hello World|first-run|TTHW/i
    );
    expect(DEVEX_QUALITY_DIMENSIONS.find((d) => d.key === "upgrade-path")!.summary).toMatch(
      /breaking|migration|codemod/i
    );
    expect(DEVEX_QUALITY_AI_SLOP_SIGNALS.length).toBeGreaterThanOrEqual(6);

    const renderedTable = renderDevexQualityRubricTable();
    expect(renderedTable).toContain("| dimension | what it covers | what a 10 looks like |");
    expect(renderedTable).toContain("| --- | --- | --- |");
    for (const d of DEVEX_QUALITY_DIMENSIONS) {
      expect(renderedTable).toContain(`**${d.name}**`);
    }
    const renderedSlop = renderDevexQualityAiSlopChecklist();
    expect(renderedSlop.split("\n").filter((l) => l.startsWith("- "))).toHaveLength(DEVEX_QUALITY_AI_SLOP_SIGNALS.length);

    // plan-devex.ts embeds both
    expect(PLAN_DEVEX_PROMPT).toContain(renderedTable);
    expect(PLAN_DEVEX_PROMPT).toContain(renderedSlop);
  });
});

describe("v8.82 — plan-devex section contract (prompt body discipline + triage devexSurface + start-command dispatch)", () => {
  it("SECTION CONTRACT — plan-devex prompt declares adversarial stance, ## Modes, ## Output schema, ## Composition footer, six-dimension rubric walking the plan (not a diff), DX-N findings format, strict block-ship floor at severity ≥ medium, pre-commitment requirement, getting-started escalation + upgrade-path cap; triage prompt declares devex_surface detection + Devex surface slim-summary line; start-command body carries `#### plan-devex` sub-step with devex-surface gate, sequential ordering after plan-design, verdict routing, and flow-state field patches", () => {
    expect(PLAN_DEVEX_PROMPT).toMatch(/Adversarial stance:/);
    expect(PLAN_DEVEX_PROMPT).toMatch(/##\s+Modes/u);
    expect(PLAN_DEVEX_PROMPT).toMatch(/##\s+Output schema/u);
    expect(PLAN_DEVEX_PROMPT).toMatch(/##\s+Composition/u);
    expect(PLAN_DEVEX_PROMPT).toContain("on-demand specialist");
    expect(PLAN_DEVEX_PROMPT).toContain("Do not spawn");
    expect(PLAN_DEVEX_PROMPT).toMatch(/Six-dimension rubric.*apply to the PLAN/i);
    expect(PLAN_DEVEX_PROMPT).toContain("DX-N");
    expect(PLAN_DEVEX_PROMPT).toContain("Plan-devex findings");
    for (const column of ["Dimension", "Severity", "Anchor", "Description", "Suggested fix", "Status"]) {
      expect(PLAN_DEVEX_PROMPT).toContain(column);
    }
    expect(PLAN_DEVEX_PROMPT).toMatch(/block.{0,4}ship.{0,4}on.{0,4}strict|block-ship-on-strict/iu);
    expect(PLAN_DEVEX_PROMPT).toMatch(/severity\s*≥?\s*medium|≥\s*`?medium/u);
    expect(PLAN_DEVEX_PROMPT).toMatch(/Pre-commitment/i);
    expect(PLAN_DEVEX_PROMPT).toMatch(/3-5 predictions/i);
    expect(PLAN_DEVEX_PROMPT).toMatch(/verdict:\s*pass\s*\|\s*revise\s*\|\s*block/u);
    expect(PLAN_DEVEX_PROMPT).toContain("devexSurface");
    expect(PLAN_DEVEX_PROMPT).toContain("cclaw-ethos.md");

    expect(TRIAGE_PROMPT).toMatch(/devex_surface/i);
    expect(TRIAGE_PROMPT).toMatch(/Devex surface:/);
    expect(TRIAGE_PROMPT).toMatch(/triage\.devexSurface/);

    expect(START_COMMAND_BODY).toContain("#### plan-devex");
    const planDevexIdx = START_COMMAND_BODY.indexOf("#### plan-devex");
    const planDevexBlock = START_COMMAND_BODY.slice(planDevexIdx, planDevexIdx + 8000);
    expect(planDevexBlock).toContain("triage.devexSurface");
    expect(planDevexBlock).toMatch(/after\s+plan-design|plan-design\s+(?:returns|gate fires|when)/u);
    expect(planDevexBlock).toMatch(/pass.{0,80}builder/u);
    expect(planDevexBlock).toMatch(/revise.{0,80}architect/u);
    expect(planDevexBlock).toMatch(/block.{0,80}stop-and-report/u);
    expect(START_COMMAND_BODY).toContain("planDevexVerdict");
    expect(START_COMMAND_BODY).toMatch(/\|\s*`plan-devex`\s*\*\(gated/u);
  });
});
