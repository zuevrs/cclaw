import { describe, expect, it } from "vitest";

import {
  PLAN_CRITIC_PROMPT,
  SPECIALIST_PROMPTS
} from "../../src/content/specialist-prompts/index.js";
import { ARTIFACT_TEMPLATES } from "../../src/content/artifact-templates.js";
import { SPECIALIST_AGENTS } from "../../src/content/core-agents.js";
import { ON_DEMAND_RUNBOOKS } from "../../src/content/runbooks-on-demand.js";
import { renderStartCommand } from "../../src/content/start-command.js";
import { SPECIALISTS } from "../../src/types.js";
import { assertFlowStateV8 } from "../../src/flow-state.js";

/**
 * v8.51 plan-critic — slimmed in v8.54.
 *
 * The full prompt / runbook / template surface is owned by:
 *   - core-agents.test.ts        (registry membership)
 *   - specialist-prompts.test.ts (cross-specialist prompt shape)
 *   - tests/integration/critic-hop.test.ts (install-layer e2e)
 *
 * This file keeps one anchor per contract specific to plan-critic:
 *   - widened gate (v8.54)
 *   - verdict enum + iteration cap
 *   - artifact template shape
 *   - flow-state validators
 *   - orchestrator body wiring
 */

const PLAN_CRITIC = "plan-critic" as const;
const CRITIC_STEPS_FILENAME = "critic-steps.md";

describe("v8.51 plan-critic — registry anchors", () => {
  it("plan-critic is in SPECIALISTS between ac-author and reviewer", () => {
    expect((SPECIALISTS as readonly string[]).includes(PLAN_CRITIC)).toBe(true);
    const planCriticIdx = SPECIALISTS.indexOf(PLAN_CRITIC);
    const acAuthorIdx = SPECIALISTS.indexOf("ac-author");
    const reviewerIdx = SPECIALISTS.indexOf("reviewer");
    expect(planCriticIdx).toBeGreaterThan(acAuthorIdx);
    expect(planCriticIdx).toBeLessThan(reviewerIdx);
  });

  it("plan-critic exposes a single mode `pre-impl-review` (separate vocabulary from post-impl critic)", () => {
    const agent = SPECIALIST_AGENTS.find((a) => a.id === PLAN_CRITIC)!;
    expect(agent.modes).toEqual(["pre-impl-review"]);
    expect(agent.kind).toBe("specialist");
    expect(agent.activation).toBe("on-demand");
  });

  it("PLAN_CRITIC_PROMPT is the same content as SPECIALIST_PROMPTS['plan-critic']", () => {
    expect(PLAN_CRITIC_PROMPT).toBe(SPECIALIST_PROMPTS[PLAN_CRITIC]);
  });
});

describe("v8.51 plan-critic prompt — v8.54 widened gate", () => {
  it("prompt requires ceremonyMode == strict", () => {
    expect(PLAN_CRITIC_PROMPT).toMatch(/ceremonyMode.*strict/);
  });

  it("prompt requires complexity != trivial (v8.54 widened from large-risky)", () => {
    expect(PLAN_CRITIC_PROMPT).toMatch(/triage\.complexity != "trivial"|complexity != trivial/);
    expect(PLAN_CRITIC_PROMPT).toMatch(/widening/i);
  });

  it("prompt requires problemType != refines", () => {
    expect(PLAN_CRITIC_PROMPT).toMatch(/problemType.*refines/);
  });

  it("prompt requires AC count >= 2", () => {
    expect(PLAN_CRITIC_PROMPT).toMatch(/AC count.*≥\s*2|AC count.*>=\s*2/);
  });

  it("prompt declares the 1-revise-loop cap (iteration 0 → 1, no third dispatch)", () => {
    expect(PLAN_CRITIC_PROMPT).toMatch(/(1 revise loop|one revise|1-revise-loop)/i);
  });

  it("prompt names all three verdicts (pass / revise / cancel)", () => {
    expect(PLAN_CRITIC_PROMPT).toMatch(/`pass`/);
    expect(PLAN_CRITIC_PROMPT).toMatch(/`revise`/);
    expect(PLAN_CRITIC_PROMPT).toMatch(/`cancel`/);
  });
});

describe("v8.51 plan-critic template", () => {
  const tpl = ARTIFACT_TEMPLATES.find((t) => t.id === "plan-critic");

  it("plan-critic template is registered with the expected fileName + frontmatter shape", () => {
    expect(tpl).toBeDefined();
    expect(tpl!.fileName).toBe("plan-critic.md");
    const frontmatter = tpl!.body.split("\n---\n")[0]!;
    for (const field of [
      "slug:",
      "stage: plan-critic",
      "ceremony_mode:",
      "ac_count:",
      "iteration:",
      "verdict:"
    ]) {
      expect(frontmatter).toContain(field);
    }
  });

  it("plan-critic template body carries the 5-dimension protocol + verdict + handoff sections", () => {
    expect(tpl!.body).toContain("## §1. Goal coverage");
    expect(tpl!.body).toContain("## §6. Pre-commitment predictions");
    expect(tpl!.body).toContain("## §7. Verdict");
    expect(tpl!.body).toContain("## §8. Hand-off");
  });
});

describe("v8.51 plan-critic — critic-steps runbook (v8.54 merged)", () => {
  const runbook = ON_DEMAND_RUNBOOKS.find((rb) => rb.fileName === CRITIC_STEPS_FILENAME);

  it("critic-steps.md is registered (v8.54 merged plan-critic-stage + critic-stage)", () => {
    expect(runbook?.body).toMatch(/^# On-demand runbook — /m);
    expect(runbook!.body).toContain("Pre-implementation pass (plan-critic, v8.51)");
    expect(runbook!.body).toContain("Post-implementation pass (critic, v8.42)");
  });

  it("critic-steps runbook declares the v8.54 widened plan-critic gate (complexity != trivial)", () => {
    expect(runbook!.body).toMatch(/triage\.complexity != "trivial"/);
    expect(runbook!.body).toMatch(/widening/i);
  });

  it("critic-steps runbook declares verdict routing (pass → slice-builder; revise → ac-author; cancel → stop-and-report under v8.61 always-auto)", () => {
    expect(runbook!.body).toMatch(/pass.*slice-builder/i);
    expect(runbook!.body).toMatch(/revise.*ac-author/i);
    expect(runbook!.body).toMatch(/cancel[\s\S]*stop and report|cancel[\s\S]*always-auto-failure-handling/i);
  });

  it("critic-steps runbook declares the planCritic flow-state patches", () => {
    expect(runbook!.body).toContain("planCriticVerdict");
    expect(runbook!.body).toContain("planCriticIteration");
    expect(runbook!.body).toContain("planCriticDispatchedAt");
  });

  it("orchestrator body references the merged critic-steps.md", () => {
    expect(renderStartCommand()).toContain(CRITIC_STEPS_FILENAME);
  });
});

describe("v8.51 plan-critic — flow-state validator surface", () => {
  const BASE = {
    schemaVersion: 3 as const,
    currentSlug: "v851-plan-critic",
    currentStage: "plan" as const,
    ac: [],
    lastSpecialist: "ac-author" as const,
    startedAt: "2026-05-14T18:00:00.000Z",
    reviewIterations: 0,
    securityFlag: false,
    triage: null
  };

  it("validator accepts pre-v8.51 flow-state (no planCritic fields)", () => {
    expect(() => assertFlowStateV8(BASE)).not.toThrow();
  });

  it("validator accepts each valid planCriticVerdict (null / pass / revise / cancel)", () => {
    for (const verdict of [null, "pass", "revise", "cancel"] as const) {
      expect(() => assertFlowStateV8({ ...BASE, planCriticVerdict: verdict })).not.toThrow();
    }
  });

  it("validator rejects post-impl critic verdicts (`block-ship`, `iterate`) — separate vocabulary", () => {
    expect(() => assertFlowStateV8({ ...BASE, planCriticVerdict: "block-ship" })).toThrow(
      /Invalid planCriticVerdict/
    );
    expect(() => assertFlowStateV8({ ...BASE, planCriticVerdict: "iterate" })).toThrow(
      /Invalid planCriticVerdict/
    );
  });

  it("validator caps planCriticIteration at 0 | 1 (one revise loop max)", () => {
    expect(() => assertFlowStateV8({ ...BASE, planCriticIteration: 0 })).not.toThrow();
    expect(() => assertFlowStateV8({ ...BASE, planCriticIteration: 1 })).not.toThrow();
    expect(() => assertFlowStateV8({ ...BASE, planCriticIteration: 2 })).toThrow(
      /planCriticIteration.*0 or 1|revise-loop cap/
    );
  });

  it("validator accepts the happy-path full state (verdict + iteration + dispatchedAt)", () => {
    expect(() =>
      assertFlowStateV8({
        ...BASE,
        planCriticVerdict: "pass",
        planCriticIteration: 0,
        planCriticDispatchedAt: "2026-05-14T18:10:00.000Z"
      })
    ).not.toThrow();
  });
});

describe("v8.51 plan-critic — orchestrator body wiring (v8.54: widened gate)", () => {
  const body = renderStartCommand();

  it("body lists plan-critic in the lastSpecialist enum surface", () => {
    expect(body).toContain("plan-critic");
    expect(body).toContain("lastSpecialist");
  });

  it("body declares the v8.54 widened gate (ceremonyMode=strict + complexity != trivial + problemType != refines + AC count >= 2)", () => {
    expect(body).toMatch(/ceremonyMode.*strict/);
    expect(body).toMatch(/triage\.complexity != "trivial"/);
    expect(body).toMatch(/triage\.problemType != "refines"/);
    expect(body).toMatch(/AC count.*≥\s*2|AC count.*>=\s*2/);
  });

  it("body names the v8.54 widening explicitly (drops the large-risky requirement)", () => {
    expect(body).toMatch(/widening/i);
  });
});

describe("v8.51 plan-critic vs critic — separate specialists", () => {
  it("plan-critic and critic are distinct specialists with distinct prompts", () => {
    const planCritic = SPECIALIST_AGENTS.find((a) => a.id === PLAN_CRITIC)!;
    const critic = SPECIALIST_AGENTS.find((a) => a.id === "critic")!;
    expect(planCritic.prompt).not.toBe(critic.prompt);
    expect(planCritic.modes).not.toEqual(critic.modes);
  });
});
