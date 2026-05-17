import { promises as fs } from "node:fs";
import path from "node:path";
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
 * v8.82 — DevEx lens — pre-build developer-experience audit.
 *
 * The release adds a pre-implementation `plan-devex` specialist that walks
 * plan.md against a six-dimension DevEx rubric when triage detects an
 * SDK / API / CLI / library / public-interface surface. The rubric is
 * extracted to a shared const at `src/content/devex-quality-rubric.ts`
 * so a future post-build reviewer `devex` axis or `research-devex` lens
 * can consume the same canonical dimensions. Below-6 dimension grades
 * become `DX-N` findings appended to plan.md's `## Plan-devex findings`
 * section; severity ≥ medium blocks ship in strict mode.
 *
 * Tripwires below pin the v8.82 invariants so a future change that drops
 * a dimension, re-inlines the rubric back into plan-devex.ts, or silently
 * un-wires plan-devex from the orchestrator lights up immediately.
 */

describe("v8.82 — SPECIALISTS roster includes plan-devex (ten specialists at v8.82)", () => {
  it("AC-1 — SPECIALISTS has exactly ten entries", () => {
    expect(SPECIALISTS).toHaveLength(10);
  });

  it("AC-1 — SPECIALISTS contains `plan-devex` (immediately after `plan-design`, before `qa-runner`)", () => {
    expect(SPECIALISTS).toContain("plan-devex");
    const planDesignIdx = (SPECIALISTS as readonly string[]).indexOf("plan-design");
    const planDevexIdx = (SPECIALISTS as readonly string[]).indexOf("plan-devex");
    const qaRunnerIdx = (SPECIALISTS as readonly string[]).indexOf("qa-runner");
    expect(planDesignIdx).toBeGreaterThan(-1);
    expect(planDevexIdx).toBe(planDesignIdx + 1);
    expect(qaRunnerIdx).toBe(planDevexIdx + 1);
  });

  it("AC-1 — SPECIALIST_PROMPTS exports a non-empty `plan-devex` prompt", () => {
    expect(typeof SPECIALIST_PROMPTS["plan-devex"]).toBe("string");
    expect(SPECIALIST_PROMPTS["plan-devex"].length).toBeGreaterThan(2000);
    expect(SPECIALIST_PROMPTS["plan-devex"]).toBe(PLAN_DEVEX_PROMPT);
  });

  it("AC-1 — CORE_AGENTS registers `plan-devex` as a specialist on-demand sub-agent (modes ⊇ {pre-impl-devex})", () => {
    const planDevexAgent = CORE_AGENTS.find((agent) => agent.id === "plan-devex");
    expect(planDevexAgent).toBeDefined();
    expect(planDevexAgent!.kind).toBe("specialist");
    expect(planDevexAgent!.activation).toBe("on-demand");
    expect(planDevexAgent!.modes).toContain("pre-impl-devex");
  });

  it("AC-1 — SPECIALIST_AGENTS roster shapes match the SPECIALISTS array exactly", () => {
    const specialistIds = SPECIALIST_AGENTS.map((agent) => agent.id).sort();
    expect(specialistIds).toEqual([...SPECIALISTS].sort());
  });
});

describe("v8.82 — devex-quality rubric is a single source of truth ready for future consumers", () => {
  it("AC-2 — DEVEX_QUALITY_DIMENSIONS exports exactly six dimensions in the canonical order", () => {
    expect(DEVEX_QUALITY_DIMENSIONS).toHaveLength(6);
    const keys = DEVEX_QUALITY_DIMENSIONS.map((d) => d.key);
    expect(keys).toEqual([
      "getting-started",
      "api-ergonomics",
      "error-messages",
      "docs",
      "upgrade-path",
      "measurement"
    ]);
  });

  it("AC-2 — every dimension carries a `name`, `summary`, and `anchor10` (the `what a 10 looks like` reference)", () => {
    for (const dimension of DEVEX_QUALITY_DIMENSIONS) {
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

  it("AC-2 — getting-started carries the TTHW anchor (time to Hello World)", () => {
    const gs = DEVEX_QUALITY_DIMENSIONS.find((d) => d.key === "getting-started");
    expect(gs).toBeDefined();
    expect(gs!.name).toMatch(/getting started|TTHW/i);
    expect(gs!.summary).toMatch(/Hello World|first-run|TTHW/i);
  });

  it("AC-2 — upgrade-path carries the breaking-change / migration anchor", () => {
    const up = DEVEX_QUALITY_DIMENSIONS.find((d) => d.key === "upgrade-path");
    expect(up).toBeDefined();
    expect(up!.summary).toMatch(/breaking|migration|codemod/i);
  });

  it("AC-2 — DEVEX_QUALITY_AI_SLOP_SIGNALS exports at least six canonical patterns", () => {
    expect(DEVEX_QUALITY_AI_SLOP_SIGNALS.length).toBeGreaterThanOrEqual(6);
  });

  it("AC-2 — renderDevexQualityRubricTable() emits a 3-column markdown table embedding every dimension", () => {
    const rendered = renderDevexQualityRubricTable();
    expect(rendered).toContain("| dimension | what it covers | what a 10 looks like |");
    expect(rendered).toContain("| --- | --- | --- |");
    for (const dimension of DEVEX_QUALITY_DIMENSIONS) {
      expect(rendered).toContain(`**${dimension.name}**`);
    }
  });

  it("AC-2 — renderDevexQualityAiSlopChecklist() emits one bullet per signal", () => {
    const rendered = renderDevexQualityAiSlopChecklist();
    const bullets = rendered.split("\n").filter((line) => line.startsWith("- "));
    expect(bullets).toHaveLength(DEVEX_QUALITY_AI_SLOP_SIGNALS.length);
  });

  it("AC-2 — plan-devex.ts embeds the SAME rendered rubric table (single source of truth: edit `devex-quality-rubric.ts` only)", () => {
    const renderedTable = renderDevexQualityRubricTable();
    expect(PLAN_DEVEX_PROMPT).toContain(renderedTable);
  });

  it("AC-2 — plan-devex.ts embeds the SAME rendered AI-slop checklist", () => {
    const renderedSlop = renderDevexQualityAiSlopChecklist();
    expect(PLAN_DEVEX_PROMPT).toContain(renderedSlop);
  });
});

describe("v8.82 — plan-devex prompt body discipline", () => {
  it("AC-3 — plan-devex opens with the adversarial-stance clause (force-stance, DevEx flavour)", () => {
    expect(PLAN_DEVEX_PROMPT).toMatch(/Adversarial stance:/);
    expect(PLAN_DEVEX_PROMPT).toMatch(/Look for disqualifying evidence first/);
  });

  it("AC-3 — plan-devex declares ## Modes and ## Output schema (the SPECIALIST contract sections)", () => {
    expect(PLAN_DEVEX_PROMPT).toMatch(/##\s+Modes/u);
    expect(PLAN_DEVEX_PROMPT).toMatch(/##\s+Output schema/u);
  });

  it("AC-3 — plan-devex ends with the ## Composition footer forbidding nested orchestration", () => {
    expect(PLAN_DEVEX_PROMPT).toMatch(/##\s+Composition/u);
    expect(PLAN_DEVEX_PROMPT).toContain("on-demand specialist");
    expect(PLAN_DEVEX_PROMPT).toContain("Do not spawn");
    expect(PLAN_DEVEX_PROMPT).toMatch(/Stop condition/u);
  });

  it("AC-3 — plan-devex declares the six-dimension rubric `walks the PLAN, not a diff`", () => {
    expect(PLAN_DEVEX_PROMPT).toMatch(/Six-dimension rubric.*apply to the PLAN/i);
  });

  it("AC-3 — plan-devex declares the `DX-N` findings format (Dimension / Severity / Anchor / Description / Suggested fix / Status)", () => {
    expect(PLAN_DEVEX_PROMPT).toContain("DX-N");
    expect(PLAN_DEVEX_PROMPT).toContain("Plan-devex findings");
    for (const column of [
      "Dimension",
      "Severity",
      "Anchor",
      "Description",
      "Suggested fix",
      "Status"
    ]) {
      expect(PLAN_DEVEX_PROMPT).toContain(column);
    }
  });

  it("AC-3 — plan-devex declares the strict block-ship floor at severity ≥ medium", () => {
    expect(PLAN_DEVEX_PROMPT).toMatch(/block.{0,4}ship.{0,4}on.{0,4}strict|block-ship-on-strict/iu);
    expect(PLAN_DEVEX_PROMPT).toMatch(/severity\s*≥?\s*medium|≥\s*`?medium/u);
  });

  it("AC-3 — plan-devex distinguishes itself from plan-design (DevEx surfaces vs visual surfaces)", () => {
    expect(PLAN_DEVEX_PROMPT).toContain("plan-design");
    expect(PLAN_DEVEX_PROMPT).toMatch(/SDK|API|CLI|library|public-interface/);
  });

  it("AC-3 — plan-devex gate cites both triage.devexSurface and triage.surfaces ∩ {cli,library,api}", () => {
    expect(PLAN_DEVEX_PROMPT).toContain("devexSurface");
    expect(PLAN_DEVEX_PROMPT).toMatch(/surfaces.*\{?cli|surfaces.*cli.*library/u);
  });

  it("AC-3 — plan-devex references README.md and CONTEXT.md as optional project context (README is the persona signal)", () => {
    expect(PLAN_DEVEX_PROMPT).toContain("README.md");
    expect(PLAN_DEVEX_PROMPT).toContain("CONTEXT.md");
    expect(PLAN_DEVEX_PROMPT).toMatch(/persona/i);
  });

  it("AC-3 — plan-devex verdict surface is pass / revise / block (no `cancel`; cancel is the user's prerogative)", () => {
    expect(PLAN_DEVEX_PROMPT).toMatch(/verdict:\s*pass\s*\|\s*revise\s*\|\s*block/u);
    expect(PLAN_DEVEX_PROMPT).toMatch(/never written by plan-devex/i);
  });

  it("AC-3 — plan-devex pre-commitment requires 3-5 predictions BEFORE detailed grading (same discipline as plan-design / plan-critic / post-impl critic)", () => {
    expect(PLAN_DEVEX_PROMPT).toMatch(/Pre-commitment/i);
    expect(PLAN_DEVEX_PROMPT).toMatch(/3-5 predictions/i);
  });

  it("AC-3 — plan-devex escalates getting-started severity one tier (TTHW is load-bearing)", () => {
    expect(PLAN_DEVEX_PROMPT).toMatch(/getting-started.*one tier|escalate one tier — TTHW/i);
  });

  it("AC-3 — plan-devex caps upgrade-path at high on breaking changes (ships-a-regression baseline)", () => {
    expect(PLAN_DEVEX_PROMPT).toMatch(/upgrade-path.*high.*breaking|breaking.*high/i);
  });

  it("AC-3 — plan-devex references the shared cclaw-ethos preamble (auto-prepended via dispatch envelope)", () => {
    expect(PLAN_DEVEX_PROMPT).toContain("cclaw-ethos.md");
    expect(PLAN_DEVEX_PROMPT).toMatch(/auto-prepended/i);
  });
});

describe("v8.82 — triage gains `devexSurface` detection", () => {
  it("AC-4 — triage prompt declares the `devex_surface` boolean and the `Devex surface:` slim summary line", () => {
    expect(TRIAGE_PROMPT).toMatch(/devex_surface/i);
    expect(TRIAGE_PROMPT).toMatch(/Devex surface:/);
  });

  it("AC-4 — triage prompt names the SDK / API / CLI / library / public-interface keyword set", () => {
    expect(TRIAGE_PROMPT).toMatch(/SDK/);
    expect(TRIAGE_PROMPT).toMatch(/API/);
    expect(TRIAGE_PROMPT).toMatch(/CLI/);
    expect(TRIAGE_PROMPT).toMatch(/library/);
  });

  it("AC-4 — triage prompt notes `devexSurface` is independent of `designSurface` (both can fire on the same slug)", () => {
    expect(TRIAGE_PROMPT).toMatch(/independent of [`]?designSurface[`]?|BOTH/i);
  });

  it("AC-4 — triage prompt persists `triage.devexSurface` into flow-state.json", () => {
    expect(TRIAGE_PROMPT).toMatch(/triage\.devexSurface/);
  });
});

describe("v8.82 — orchestrator dispatches plan-devex after plan-design on the devex-surface gate", () => {
  it("AC-5 — start-command body carries a `#### plan-devex` sub-step section", () => {
    expect(START_COMMAND_BODY).toContain("#### plan-devex");
  });

  it("AC-5 — start-command names the devex-surface gate (triage.devexSurface OR triage.surfaces ∩ {cli,library,api})", () => {
    const planDevexIdx = START_COMMAND_BODY.indexOf("#### plan-devex");
    expect(planDevexIdx).toBeGreaterThan(0);
    const planDevexBlock = START_COMMAND_BODY.slice(planDevexIdx, planDevexIdx + 8000);
    expect(planDevexBlock).toContain("triage.devexSurface");
    expect(planDevexBlock).toMatch(/surfaces.*\b(cli|library|api)\b/u);
    expect(planDevexBlock).toMatch(/ceremonyMode.*\b(soft|strict)\b/u);
  });

  it("AC-5 — start-command names the dispatch ordering (after plan-critic AND after plan-design — sequential, not parallel)", () => {
    const planDevexIdx = START_COMMAND_BODY.indexOf("#### plan-devex");
    const planDevexBlock = START_COMMAND_BODY.slice(planDevexIdx, planDevexIdx + 8000);
    expect(planDevexBlock).toMatch(/after\s+plan-critic|plan-critic\s+(?:returns|gate fires|when)/u);
    expect(planDevexBlock).toMatch(/after\s+plan-design|plan-design\s+(?:returns|gate fires|when)/u);
  });

  it("AC-5 — start-command names the verdict-routing semantics (pass → builder; revise → architect; block → stop-and-report)", () => {
    const planDevexIdx = START_COMMAND_BODY.indexOf("#### plan-devex");
    const planDevexBlock = START_COMMAND_BODY.slice(planDevexIdx, planDevexIdx + 8000);
    expect(planDevexBlock).toMatch(/pass.{0,80}builder/u);
    expect(planDevexBlock).toMatch(/revise.{0,80}architect/u);
    expect(planDevexBlock).toMatch(/block.{0,80}stop-and-report/u);
  });

  it("AC-5 — start-command flow-state patches name planDevexVerdict / planDevexIteration / planDevexFindingsCount / planDevexDispatchedAt", () => {
    expect(START_COMMAND_BODY).toContain("planDevexVerdict");
    expect(START_COMMAND_BODY).toContain("planDevexIteration");
    expect(START_COMMAND_BODY).toContain("planDevexFindingsCount");
    expect(START_COMMAND_BODY).toContain("planDevexDispatchedAt");
  });

  it("AC-5 — start-command stage→specialist mapping table carries a `plan-devex` row gated on the devex-surface gate", () => {
    expect(START_COMMAND_BODY).toMatch(/\|\s*`plan-devex`\s*\*\(gated/u);
  });
});

describe("v8.82 — devex-quality-discipline skill auto-triggers at plan on devex-surface flows", () => {
  it("AC-6 — AUTO_TRIGGER_SKILLS registers `devex-quality-discipline` with stage plan", () => {
    const skill = AUTO_TRIGGER_SKILLS.find((s) => s.id === "devex-quality-discipline");
    expect(skill).toBeDefined();
    expect(skill!.stages).toContain("plan");
  });

  it("AC-6 — devex-quality-discipline triggers reference the `plan-devex` specialist", () => {
    const skill = AUTO_TRIGGER_SKILLS.find((s) => s.id === "devex-quality-discipline");
    expect(skill).toBeDefined();
    const triggers = skill!.triggers.join("\n");
    expect(triggers).toContain("plan-devex");
  });

  it("AC-6 — devex-quality-discipline body cites the shared rubric source of truth (devex-quality-rubric.ts)", () => {
    const skill = AUTO_TRIGGER_SKILLS.find((s) => s.id === "devex-quality-discipline");
    expect(skill).toBeDefined();
    expect(skill!.body).toContain("devex-quality-rubric.ts");
    expect(skill!.body).toContain("plan-devex");
  });
});

describe("v8.82 — version bump", () => {
  it("AC-7 — package.json bumps to 8.82.0 (or higher; v8.82 slug ships as 8.85.0 due to parallel-shipping race)", async () => {
    const pkg = JSON.parse(
      await fs.readFile(path.join(process.cwd(), "package.json"), "utf-8")
    ) as { version: string };
    const [major, minor] = pkg.version.split(".").map((n) => Number.parseInt(n, 10));
    expect(major).toBe(8);
    expect(minor).toBeGreaterThanOrEqual(82);
  });

  it("AC-7 — CHANGELOG.md carries a v8.85.0 entry (the v8.82 slug ships at 8.85.0)", async () => {
    const changelog = await fs.readFile(
      path.join(process.cwd(), "CHANGELOG.md"),
      "utf-8"
    );
    expect(changelog).toMatch(/##\s*\[?8\.85\.0\]?/);
  });
});
