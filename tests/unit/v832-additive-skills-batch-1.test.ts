import { describe, expect, it } from "vitest";

import {
  AUTO_TRIGGER_SKILLS,
  type AutoTriggerStage
} from "../../src/content/skills.js";

/**
 * v8.32 — additive skills batch I.
 *
 * The five-audit review picked two addy-osmani skill patterns the cclaw
 * skill set was missing: `context-engineering` (context hierarchy +
 * packing strategies + confusion management) and `performance-
 * optimization` (Core Web Vitals + measurement-first workflow + N+1 query
 * catalogue + bundle budget). Both are additive, follow the same shape as
 * the v8.27 `code-simplification` lift, and complement the existing skill
 * set without re-targeting any existing surface.
 *
 * The new tripwire pins:
 *   AC-1 — both new skills are registered in AUTO_TRIGGER_SKILLS with the
 *          v8.26-required anatomy (Overview + When + ≥2 depth + When NOT).
 *   AC-2 — stage windowing matches the spec (context-engineering on
 *          `["always"]`; performance-optimization on `["build","review"]`).
 *   AC-3 — content presence: each skill names the load-bearing primitives
 *          from the audit (context hierarchy / packing strategies for
 *          context-engineering; Core Web Vitals + measurement-first + N+1
 *          + bundle budget for performance-optimization).
 *   AC-4 — total skill count went 18 → 20 and the descriptions stayed in
 *          sync with the body's identity.
 *
 * The v8.26 anatomy tripwire and the v8.30 anatomy-gaps tripwire continue
 * to fire over the full 20-skill set; v8.32 does not modify either.
 */

const SKILLS = AUTO_TRIGGER_SKILLS;
const CONTEXT_ENG = SKILLS.find((s) => s.id === "context-engineering");
const PERF_OPT = SKILLS.find((s) => s.id === "performance-optimization");

describe("v8.32 additive skills batch I — registration", () => {
  it("AC-1 — `context-engineering` is registered in AUTO_TRIGGER_SKILLS", () => {
    expect(CONTEXT_ENG, "context-engineering must be registered").toBeDefined();
    expect(CONTEXT_ENG!.fileName).toBe("context-engineering.md");
    expect(CONTEXT_ENG!.body.length, "skill body must be non-trivial").toBeGreaterThan(2000);
  });

  it("AC-1 — `performance-optimization` is registered in AUTO_TRIGGER_SKILLS", () => {
    expect(PERF_OPT, "performance-optimization must be registered").toBeDefined();
    expect(PERF_OPT!.fileName).toBe("performance-optimization.md");
    expect(PERF_OPT!.body.length, "skill body must be non-trivial").toBeGreaterThan(2000);
  });

  it("AC-1 — both v8.32 skills survive (count grew 18→20 in v8.32, then 20→22 in v8.33)", () => {
    expect(
      SKILLS.find((s) => s.id === "context-engineering"),
      "context-engineering must survive subsequent slugs"
    ).toBeDefined();
    expect(
      SKILLS.find((s) => s.id === "performance-optimization"),
      "performance-optimization must survive subsequent slugs"
    ).toBeDefined();
    expect(
      SKILLS.length,
      `expected at least 20 skills (v8.32 baseline); v8.33 pins the next-step count of 22 in v833-additive-skills-batch-2.test.ts`
    ).toBeGreaterThanOrEqual(20);
  });
});

describe("v8.32 additive skills batch I — stage windowing", () => {
  it("AC-2 — `context-engineering` is stage-windowed on `[\"always\"]`", () => {
    expect(CONTEXT_ENG!.stages).toBeDefined();
    expect(
      CONTEXT_ENG!.stages as ReadonlyArray<AutoTriggerStage>,
      "context-engineering rides every stage because every dispatch is a context-construction event"
    ).toEqual(["always"]);
  });

  it("AC-2 — `performance-optimization` is stage-windowed on `[\"build\",\"review\"]`", () => {
    expect(PERF_OPT!.stages).toBeDefined();
    const stages = PERF_OPT!.stages as ReadonlyArray<AutoTriggerStage>;
    expect(stages).toContain("build");
    expect(stages).toContain("review");
    expect(stages, "perf is not relevant outside build/review — triage/plan/ship/compound should not see it").not.toContain("triage");
    expect(stages).not.toContain("ship");
    expect(stages).not.toContain("compound");
  });

  it("AC-2 — `performance-optimization` triggers include `touch-surface:ui` and `finding:perf`", () => {
    const triggers = PERF_OPT!.triggers;
    expect(triggers).toContain("touch-surface:ui");
    expect(triggers).toContain("finding:perf");
  });
});

describe("v8.32 additive skills batch I — content presence", () => {
  it("AC-3 — `context-engineering` body names the five-layer hierarchy (rules / specs / source / errors / conversation)", () => {
    const body = CONTEXT_ENG!.body;
    expect(body).toMatch(/rules/i);
    expect(body).toMatch(/specs/i);
    expect(body).toMatch(/source/i);
    expect(body).toMatch(/errors/i);
    expect(body).toMatch(/conversation/i);
    expect(
      body,
      "the body should declare the hierarchy explicitly so the order is unambiguous"
    ).toMatch(/rules.{0,40}specs.{0,40}source.{0,40}errors.{0,40}conversation/su);
  });

  it("AC-3 — `context-engineering` body names the three packing strategies", () => {
    const body = CONTEXT_ENG!.body;
    expect(body).toMatch(/brain[- ]?dump/i);
    expect(body).toMatch(/selective include/i);
    expect(body).toMatch(/hierarchical summary/i);
  });

  it("AC-3 — `context-engineering` body names the three confusion-management sources", () => {
    const body = CONTEXT_ENG!.body;
    expect(body).toMatch(/internal conflict|two inputs disagree/i);
    expect(body).toMatch(/missing requirement|missing context/i);
    expect(body).toMatch(/drift|stale/i);
  });

  it("AC-3 — `performance-optimization` body names Core Web Vitals targets (LCP / INP / CLS)", () => {
    const body = PERF_OPT!.body;
    expect(body).toMatch(/Core Web Vitals/i);
    expect(body).toMatch(/LCP/);
    expect(body).toMatch(/INP/);
    expect(body).toMatch(/CLS/);
    expect(body, "thresholds should be cited with units").toMatch(/2\.5s|2500/);
    expect(body).toMatch(/200ms/);
    expect(body).toMatch(/0\.1/);
  });

  it("AC-3 — `performance-optimization` body names the iron rule (don't optimise without numbers)", () => {
    const body = PERF_OPT!.body;
    expect(
      body,
      "the iron rule should be named explicitly so the orchestrator can cite it back to the user"
    ).toMatch(/don'?t optimi[sz]e without numbers/i);
  });

  it("AC-3 — `performance-optimization` body covers the N+1 anti-pattern catalogue with at least 4 entries", () => {
    const body = PERF_OPT!.body;
    expect(body).toMatch(/N\+1/);
    const nMatch = body.match(/N\+1 query anti-patterns/i);
    expect(nMatch, "N+1 anti-pattern section must exist").not.toBeNull();
    const slice = body.slice(nMatch!.index!);
    const rowMatches = slice.match(/^\| \*\*[^|]+\*\* /gm);
    expect(
      rowMatches?.length ?? 0,
      "N+1 anti-pattern table should enumerate at least 4 patterns with bolded names"
    ).toBeGreaterThanOrEqual(4);
  });

  it("AC-3 — `performance-optimization` body carries a bundle budget table with at least 4 entries", () => {
    const body = PERF_OPT!.body;
    expect(body).toMatch(/Bundle budget/i);
    expect(body).toMatch(/Initial JS/i);
    expect(body).toMatch(/Initial CSS/i);
    expect(body).toMatch(/lazy chunk/i);
  });

  it("AC-3 — `performance-optimization` body names the measurement-first workflow as baseline → RED → GREEN → REFACTOR", () => {
    const body = PERF_OPT!.body;
    expect(body).toMatch(/baseline/i);
    expect(body).toMatch(/\bRED\b/);
    expect(body).toMatch(/\bGREEN\b/);
    expect(body).toMatch(/\bREFACTOR\b/);
  });
});

describe("v8.32 additive skills batch I — descriptions stay in sync with bodies", () => {
  it("AC-4 — `context-engineering` description names addy + context hierarchy + packing strategies", () => {
    const desc = CONTEXT_ENG!.description;
    expect(desc).toMatch(/addy/i);
    expect(desc).toMatch(/hierarchy/i);
    expect(desc).toMatch(/packing/i);
  });

  it("AC-4 — `performance-optimization` description names addy + Core Web Vitals + iron rule", () => {
    const desc = PERF_OPT!.description;
    expect(desc).toMatch(/addy/i);
    expect(desc).toMatch(/Core Web Vitals/i);
    expect(desc).toMatch(/don'?t optimi[sz]e without numbers/i);
  });

  it("AC-4 — both new skills declare their stages explicitly (not falling back to default `[\"always\"]`)", () => {
    expect(CONTEXT_ENG!.stages).toBeDefined();
    expect(PERF_OPT!.stages).toBeDefined();
  });
});

describe("v8.32 additive skills batch I — v8.30 invariants preserved on new skills", () => {
  it("AC-5 — both new skills carry `## When NOT to apply` (v8.30 invariant)", () => {
    for (const skill of [CONTEXT_ENG!, PERF_OPT!]) {
      expect(
        skill.body,
        `${skill.fileName} must have a \`## When NOT to apply\` H2 (v8.30 invariant from skill-anatomy-gaps slug)`
      ).toMatch(/^##\s+When NOT to apply\b/m);
    }
  });

  it("AC-5 — both new skills carry `## When to use` (v8.26 anatomy invariant)", () => {
    for (const skill of [CONTEXT_ENG!, PERF_OPT!]) {
      expect(skill.body).toMatch(/^##\s+When (to use|to apply|to invoke|to detect)\b/m);
    }
  });

  it("AC-5 — both new skills open with `# Skill: <id>` H1 (v8.26 anatomy invariant)", () => {
    expect(CONTEXT_ENG!.body).toMatch(/^# Skill: context-engineering\b/m);
    expect(PERF_OPT!.body).toMatch(/^# Skill: performance-optimization\b/m);
  });

  it("AC-5 — both new skills carry at least two depth sections (Process / Rationalizations / Red Flags / Verification, v8.26 invariant)", () => {
    const depthHeadings =
      /^##\s+(Process\b|Phase \d|Rules\b|Rules for |The (three|four|five) (phases|steps|rules)|How to run|Heuristics\b|.*-step process|Format\b|Execution\b|Steps\b|How to invoke|How to apply|How to detect|Detection\b|Anti-rationalization|Common rationalizations|Anti-patterns\b|What to refuse|Rationalizations\b|Smell check\b|Red flags\b|Common pitfalls\b|Hard rules\b|Forbidden\b|Iron rule\b|Two iron rules\b|Stop-the-line\b|Hyrum's Law\b|Verification\b|Worked example|Gates\b|.*checklist|Verification log|How .*verifies|Test-design checklist|Outcome\b|Context hierarchy|Packing strategies|Confusion management|Core Web Vitals|Measurement-first|N\+1|Bundle budget|Five principles)/gm;
    for (const skill of [CONTEXT_ENG!, PERF_OPT!]) {
      const matches = skill.body.match(depthHeadings) ?? [];
      expect(
        matches.length,
        `${skill.fileName} should carry at least two depth-section headings (process / rationalizations / red-flags / verification or skill-specific equivalents). Matched headings: ${matches.join(", ")}`
      ).toBeGreaterThanOrEqual(2);
    }
  });
});
