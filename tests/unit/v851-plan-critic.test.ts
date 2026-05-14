import { describe, expect, it } from "vitest";

import {
  PLAN_CRITIC_PROMPT,
  SPECIALIST_PROMPTS
} from "../../src/content/specialist-prompts/index.js";
import { ARTIFACT_TEMPLATES } from "../../src/content/artifact-templates.js";
import {
  CORE_AGENTS,
  SPECIALIST_AGENTS
} from "../../src/content/core-agents.js";
import { ON_DEMAND_RUNBOOKS } from "../../src/content/runbooks-on-demand.js";
import { renderStartCommand } from "../../src/content/start-command.js";
import { SPECIALISTS } from "../../src/types.js";
import { assertFlowStateV8 } from "../../src/flow-state.js";

/**
 * v8.51 — pre-implementation plan-critic specialist.
 *
 * plan-critic is a new on-demand specialist that runs between
 * `ac-author` and `slice-builder` ONLY on the tight gate:
 *   acMode=strict AND complexity=large-risky AND
 *   problemType!=refines AND AC count>=2.
 *
 * It walks five dimensions (goal coverage / granularity / dependency
 * accuracy / parallelism feasibility / risk catalog) plus §6
 * pre-commitment predictions before finalizing. Verdicts: pass /
 * revise / cancel. 1 revise loop max; iteration cap enforced.
 *
 * Distinct from the v8.42 post-impl `critic` (Hop 4.5, post-build);
 * both ship together because they catch different problem classes.
 *
 * These tripwires lock the contract so a future refactor cannot drop
 * the plan-critic, widen its gate silently, soften the 1-revise-loop
 * cap, or break the verdict-routing wiring the orchestrator follows.
 */

const PLAN_CRITIC = "plan-critic" as const;

// ─────────────────────────────────────────────────────────────────────
// Registry membership — SPECIALISTS / SPECIALIST_PROMPTS / SPECIALIST_AGENTS
// ─────────────────────────────────────────────────────────────────────

describe("v8.51 plan-critic — registry membership", () => {
  it("`plan-critic` is registered in the SPECIALISTS array", () => {
    expect((SPECIALISTS as readonly string[]).includes(PLAN_CRITIC)).toBe(true);
  });

  it("SPECIALISTS array carries exactly eight specialists (v8.42 added critic; v8.51 added plan-critic; v8.52 added qa-runner)", () => {
    expect(SPECIALISTS).toHaveLength(8);
  });

  it("plan-critic sits between ac-author and reviewer in the canonical specialist order", () => {
    const planCriticIdx = SPECIALISTS.indexOf(PLAN_CRITIC);
    const acAuthorIdx = SPECIALISTS.indexOf("ac-author");
    const reviewerIdx = SPECIALISTS.indexOf("reviewer");
    expect(planCriticIdx).toBeGreaterThan(acAuthorIdx);
    expect(planCriticIdx).toBeLessThan(reviewerIdx);
  });

  it("SPECIALIST_PROMPTS exposes a non-empty body keyed at `plan-critic`", () => {
    expect(typeof SPECIALIST_PROMPTS[PLAN_CRITIC]).toBe("string");
    expect(SPECIALIST_PROMPTS[PLAN_CRITIC].length).toBeGreaterThan(1000);
  });

  it("PLAN_CRITIC_PROMPT named export matches SPECIALIST_PROMPTS['plan-critic'] (single source of truth)", () => {
    expect(PLAN_CRITIC_PROMPT).toBe(SPECIALIST_PROMPTS[PLAN_CRITIC]);
  });

  it("plan-critic is in SPECIALIST_AGENTS with kind=specialist and activation=on-demand", () => {
    const agent = SPECIALIST_AGENTS.find((a) => a.id === PLAN_CRITIC);
    expect(agent, "plan-critic missing from SPECIALIST_AGENTS").toBeDefined();
    expect(agent!.kind).toBe("specialist");
    expect(agent!.activation).toBe("on-demand");
  });

  it("plan-critic exposes the single mode `pre-impl-review` (no gap/adversarial split — that vocabulary belongs to the post-impl critic)", () => {
    const agent = SPECIALIST_AGENTS.find((a) => a.id === PLAN_CRITIC)!;
    expect(agent.modes).toEqual(["pre-impl-review"]);
  });

  it("plan-critic appears in CORE_AGENTS exactly once", () => {
    const matches = CORE_AGENTS.filter((a) => a.id === PLAN_CRITIC);
    expect(matches).toHaveLength(1);
  });

  it("plan-critic's title is `Plan critic` (the human-readable label used in resume summaries)", () => {
    const agent = SPECIALIST_AGENTS.find((a) => a.id === PLAN_CRITIC)!;
    expect(agent.title).toBe("Plan critic");
  });

  it("plan-critic's description names the v8.51 tight gate verbatim", () => {
    const agent = SPECIALIST_AGENTS.find((a) => a.id === PLAN_CRITIC)!;
    expect(agent.description).toMatch(/acMode=strict/);
    expect(agent.description).toMatch(/large-risky/);
    expect(agent.description).toMatch(/refines/);
    expect(agent.description).toMatch(/AC count.*>=\s*2/);
  });
});

// ─────────────────────────────────────────────────────────────────────
// Specialist prompt — structure, sections, verdicts, anti-rationalization
// ─────────────────────────────────────────────────────────────────────

describe("v8.51 plan-critic prompt — structural shape", () => {
  it("prompt opens with `# plan-critic` header", () => {
    expect(PLAN_CRITIC_PROMPT.startsWith("# plan-critic\n")).toBe(true);
  });

  it("prompt declares the canonical sections § (1-8) for the artifact body", () => {
    for (const heading of [
      "§1. Goal coverage",
      "§2. Granularity",
      "§3. Dependency accuracy",
      "§4. Parallelism feasibility",
      "§5. Risk catalog",
      "§6. Pre-commitment predictions",
      "§7. Verdict",
      "§8. Anti-rationalization"
    ]) {
      expect(
        PLAN_CRITIC_PROMPT,
        `plan-critic prompt missing section heading: ${heading}`
      ).toContain(heading);
    }
  });

  it("prompt declares `## Modes`, `## Composition`, `Output schema`, and `Stop condition` (the four cross-specialist sections enforced by the registry tests)", () => {
    expect(PLAN_CRITIC_PROMPT).toMatch(/^##\s+Modes\s*$/m);
    expect(PLAN_CRITIC_PROMPT).toMatch(/^##\s+Composition\s*$/m);
    expect(PLAN_CRITIC_PROMPT).toMatch(/Output schema/);
    expect(PLAN_CRITIC_PROMPT).toMatch(/Stop condition/);
  });

  it("prompt's Composition section names plan-critic as an `on-demand specialist` (not main-context)", () => {
    expect(PLAN_CRITIC_PROMPT).toContain("on-demand specialist");
  });

  it("prompt declares the `Do not spawn` clause that forbids dispatching other specialists", () => {
    expect(PLAN_CRITIC_PROMPT).toContain("Do not spawn");
  });

  it("prompt declares the iron law tying every finding to a `plan.md > §section` citation", () => {
    expect(PLAN_CRITIC_PROMPT).toMatch(/Iron Law.*plan-critic/i);
    expect(PLAN_CRITIC_PROMPT).toMatch(/EVIDENCE FROM THE PLAN/i);
  });
});

describe("v8.51 plan-critic prompt — gate (when to run / when NOT to run)", () => {
  it("prompt names all four gate conditions in the `When to run` section", () => {
    expect(PLAN_CRITIC_PROMPT).toMatch(/##\s+When to run/);
    // condition 1: acMode == strict
    expect(PLAN_CRITIC_PROMPT).toMatch(/acMode.*strict/);
    // condition 2: complexity == large-risky
    expect(PLAN_CRITIC_PROMPT).toMatch(/complexity.*large-risky/);
    // condition 3: problemType != refines
    expect(PLAN_CRITIC_PROMPT).toMatch(/problemType.*refines/);
    // condition 4: AC count >= 2
    expect(PLAN_CRITIC_PROMPT).toMatch(/AC count.*≥\s*2|AC count.*>=\s*2/);
  });

  it("prompt declares a `When NOT to run` section as the explicit negative space of the gate", () => {
    expect(PLAN_CRITIC_PROMPT).toMatch(/##\s+When NOT to run/);
  });

  it("prompt enumerates the negative-case acMode values (inline, soft) and the negative-case complexity values (trivial, small-medium)", () => {
    expect(PLAN_CRITIC_PROMPT).toMatch(/inline/);
    expect(PLAN_CRITIC_PROMPT).toMatch(/soft/);
    expect(PLAN_CRITIC_PROMPT).toMatch(/trivial/);
    expect(PLAN_CRITIC_PROMPT).toMatch(/small-medium/);
  });

  it("prompt rejects the meta-tactic of widening the gate from inside a finding", () => {
    expect(PLAN_CRITIC_PROMPT).toMatch(/do not propose widening|do not widen|never propose widening|the only correct combination/i);
  });
});

describe("v8.51 plan-critic prompt — verdict enum + routing", () => {
  it("prompt names the three verdicts: pass, revise, cancel", () => {
    expect(PLAN_CRITIC_PROMPT).toMatch(/`pass`/);
    expect(PLAN_CRITIC_PROMPT).toMatch(/`revise`/);
    expect(PLAN_CRITIC_PROMPT).toMatch(/`cancel`/);
  });

  it("prompt distinguishes plan-critic's verdict vocabulary from the post-impl critic's `block-ship` / `iterate` / `fyi`", () => {
    // The post-impl critic uses block-ship / iterate / fyi as verdict
    // OR severity labels. plan-critic borrows block-ship / iterate /
    // fyi as SEVERITY labels but the verdict enum is pass/revise/cancel.
    // The prompt must explicitly note this so a reader does not
    // collapse the two vocabularies.
    expect(PLAN_CRITIC_PROMPT).toMatch(/(do NOT merge|distinct from|separate.*vocabulary).*(post-impl|critic)/i);
  });

  it("prompt declares the 1-revise-loop cap (iteration 0 → 1, no third dispatch)", () => {
    expect(PLAN_CRITIC_PROMPT).toMatch(/1 revise loop|1-revise-loop|one revise|one revision/i);
    expect(PLAN_CRITIC_PROMPT).toMatch(/iteration.*max|max.*iteration|iter 1|iteration 1/i);
  });

  it("prompt declares the user picker triggered on revise-iter-1 (cancel / accept-warnings-and-proceed / re-design)", () => {
    expect(PLAN_CRITIC_PROMPT).toMatch(/cancel/);
    expect(PLAN_CRITIC_PROMPT).toMatch(/accept-warnings-and-proceed/);
    expect(PLAN_CRITIC_PROMPT).toMatch(/re-design/);
  });

  it("prompt declares that `cancel` surfaces a user picker IMMEDIATELY at any iteration (no silent fallback)", () => {
    expect(PLAN_CRITIC_PROMPT).toMatch(/cancel.*(any iteration|immediately|silent fallback)/i);
  });

  it("prompt declares that the orchestrator (not plan-critic) routes on the verdict (composition discipline)", () => {
    expect(PLAN_CRITIC_PROMPT).toMatch(/orchestrator.*dispatch|orchestrator.*advances|orchestrator.*decides/i);
  });
});

describe("v8.51 plan-critic prompt — read-only contract", () => {
  it("prompt forbids editing source / test / plan / build / review files", () => {
    expect(PLAN_CRITIC_PROMPT).toMatch(/(NOT|never|do not).*edit.*(src\/|tests\/|plan\.md|build\.md|review\.md)/i);
  });

  it("prompt names the ONLY file plan-critic writes (`flows/<slug>/plan-critic.md`)", () => {
    expect(PLAN_CRITIC_PROMPT).toMatch(/flows\/<slug>\/plan-critic\.md/);
  });

  it("prompt forbids dispatching other specialists or research helpers", () => {
    expect(PLAN_CRITIC_PROMPT).toMatch(/(NOT|never|forbid|do not).*(dispatch|spawn).*(specialist|sub-?agent|research)/i);
  });

  it("prompt forbids proposing alternative approaches (that lane belongs to design)", () => {
    expect(PLAN_CRITIC_PROMPT).toMatch(/(NOT|never|do not).*propose.*(alternative|approach)/i);
  });

  it("prompt forbids exceeding the 7k token cap", () => {
    expect(PLAN_CRITIC_PROMPT).toMatch(/(NOT|never|do not).*exceed.*7k|7k.*(cap|exceed)/i);
  });

  it("prompt forbids multi-perspective lens findings (that's the post-impl critic's surface)", () => {
    expect(PLAN_CRITIC_PROMPT).toMatch(/multi-perspective/i);
  });
});

describe("v8.51 plan-critic prompt — pre-commitment + token budget", () => {
  it("prompt declares the §6 pre-commitment block must be authored BEFORE the §1-§5 detailed pass", () => {
    expect(PLAN_CRITIC_PROMPT).toMatch(/BEFORE.*§1-§5|before.*detailed/i);
  });

  it("prompt caps pre-commitment predictions at 3-5 (exactly the discipline shape — too few skips deliberate search, too many is fishing)", () => {
    expect(PLAN_CRITIC_PROMPT).toMatch(/3-5 predictions/);
  });

  it("prompt declares the 3-5k target token budget AND the 7k hard cap", () => {
    expect(PLAN_CRITIC_PROMPT).toMatch(/3-5k tokens|3 ?- ?5k tokens/);
    expect(PLAN_CRITIC_PROMPT).toMatch(/7k tokens|7k.*cap|cap.*7k/i);
  });

  it("prompt declares the slim summary is ≤7 lines", () => {
    expect(PLAN_CRITIC_PROMPT).toMatch(/(≤|<=)\s*7\s*lines/);
  });

  it("prompt declares the Confidence field with the enum high/medium/low (matches the other specialists' slim-summary shape)", () => {
    expect(PLAN_CRITIC_PROMPT).toMatch(/[Cc]onfidence/);
    expect(PLAN_CRITIC_PROMPT).toMatch(/high.*medium.*low|low.*medium.*high/i);
  });

  it("prompt's slim summary block declares all six required fields (specialist, verdict, findings, iteration, confidence, notes)", () => {
    expect(PLAN_CRITIC_PROMPT).toMatch(/specialist:\s*plan-critic/);
    expect(PLAN_CRITIC_PROMPT).toMatch(/verdict:\s*pass\s*\|\s*revise\s*\|\s*cancel/);
    expect(PLAN_CRITIC_PROMPT).toMatch(/findings:/);
    expect(PLAN_CRITIC_PROMPT).toMatch(/iteration:/);
    expect(PLAN_CRITIC_PROMPT).toMatch(/confidence:/);
    expect(PLAN_CRITIC_PROMPT).toMatch(/notes:/);
  });
});

describe("v8.51 plan-critic prompt — anti-rationalization catalog references", () => {
  it("prompt references the shared anti-rationalizations catalog at .cclaw/lib/anti-rationalizations.md (v8.49 lifted them into a shared file; plan-critic must cite-not-duplicate)", () => {
    expect(PLAN_CRITIC_PROMPT).toContain(".cclaw/lib/anti-rationalizations.md");
  });

  it("prompt declares plan-critic-specific rationalization rows (not duplicated in the shared catalog)", () => {
    // The unique-to-plan-critic rows cover: trust-ac-author bias,
    // post-hoc-prediction (also in post-impl critic but with
    // different phrasing), first-read pass = sycophancy,
    // relitigating alternatives.
    expect(PLAN_CRITIC_PROMPT).toMatch(/ac-author.*trust|trust.*ac-author/i);
    expect(PLAN_CRITIC_PROMPT).toMatch(/post-hoc|after.*detailed/i);
    expect(PLAN_CRITIC_PROMPT).toMatch(/first-read.*pass|first read.*pass/i);
    expect(PLAN_CRITIC_PROMPT).toMatch(/relitigate|approach.*design/i);
  });
});

// ─────────────────────────────────────────────────────────────────────
// Artifact template — registration + structure
// ─────────────────────────────────────────────────────────────────────

describe("v8.51 plan-critic.md artifact template", () => {
  it("PLAN_CRITIC template is registered in ARTIFACT_TEMPLATES with id=`plan-critic`, fileName=`plan-critic.md`", () => {
    const tpl = ARTIFACT_TEMPLATES.find((t) => t.id === "plan-critic");
    expect(tpl, "plan-critic template must exist in ARTIFACT_TEMPLATES").toBeDefined();
    expect(tpl!.fileName).toBe("plan-critic.md");
    expect(tpl!.description).toMatch(/v8\.51|pre-implementation|plan-critic/i);
  });

  it("PLAN_CRITIC template body opens with frontmatter delimited by --- ... ---", () => {
    const tpl = ARTIFACT_TEMPLATES.find((t) => t.id === "plan-critic")!;
    expect(tpl.body.startsWith("---\n")).toBe(true);
    expect(tpl.body).toMatch(/^---\n[\s\S]+?\n---\n/);
  });

  it("PLAN_CRITIC template frontmatter carries every required field", () => {
    const tpl = ARTIFACT_TEMPLATES.find((t) => t.id === "plan-critic")!;
    const frontmatter = tpl.body.split("\n---\n")[0]!;
    for (const field of [
      "slug:",
      "stage: plan-critic",
      "posture_inherited:",
      "ac_mode:",
      "ac_count:",
      "dispatched_at:",
      "iteration:",
      "predictions_made:",
      "findings:",
      "verdict:"
    ]) {
      expect(
        frontmatter,
        `plan-critic.md frontmatter missing required field: ${field}`
      ).toContain(field);
    }
  });

  it("PLAN_CRITIC template body contains the eight § sections + summary", () => {
    const tpl = ARTIFACT_TEMPLATES.find((t) => t.id === "plan-critic")!;
    for (const section of [
      "## §1. Goal coverage",
      "## §2. Granularity",
      "## §3. Dependency accuracy",
      "## §4. Parallelism feasibility",
      "## §5. Risk catalog",
      "## §6. Pre-commitment predictions",
      "## §7. Verdict",
      "## §8. Hand-off"
    ]) {
      expect(
        tpl.body,
        `plan-critic.md template missing required section: ${section}`
      ).toContain(section);
    }
  });

  it("PLAN_CRITIC template names the severity vocabulary (block-ship / iterate / fyi)", () => {
    const tpl = ARTIFACT_TEMPLATES.find((t) => t.id === "plan-critic")!;
    expect(tpl.body).toContain("block-ship");
    expect(tpl.body).toContain("iterate");
    expect(tpl.body).toContain("fyi");
  });

  it("PLAN_CRITIC template names the verdict enum (pass / revise / cancel)", () => {
    const tpl = ARTIFACT_TEMPLATES.find((t) => t.id === "plan-critic")!;
    expect(tpl.body).toMatch(/pass\s*\|\s*revise\s*\|\s*cancel|pass.*revise.*cancel/);
  });
});

// ─────────────────────────────────────────────────────────────────────
// Runbook — registration + cross-reference
// ─────────────────────────────────────────────────────────────────────

describe("v8.51 plan-critic-stage runbook", () => {
  it("`plan-critic-stage.md` is registered in ON_DEMAND_RUNBOOKS", () => {
    const r = ON_DEMAND_RUNBOOKS.find((rb) => rb.fileName === "plan-critic-stage.md");
    expect(r, "plan-critic-stage.md must be present in ON_DEMAND_RUNBOOKS").toBeDefined();
    expect(r!.body.length, "plan-critic-stage.md body cannot be empty").toBeGreaterThan(2000);
    expect(
      r!.body,
      "plan-critic-stage.md should open with the on-demand runbook heading prefix"
    ).toMatch(/^# On-demand runbook — /m);
  });

  it("runbook body declares the 4-AND gate conditions verbatim", () => {
    const r = ON_DEMAND_RUNBOOKS.find((rb) => rb.fileName === "plan-critic-stage.md")!;
    expect(r.body).toMatch(/acMode.*strict/);
    expect(r.body).toMatch(/complexity.*large-risky/);
    expect(r.body).toMatch(/problemType.*refines/);
    expect(r.body).toMatch(/AC count.*≥\s*2|AC count.*>=\s*2/);
  });

  it("runbook body declares the verdict-routing table (pass → slice-builder, revise → ac-author, cancel → user picker)", () => {
    const r = ON_DEMAND_RUNBOOKS.find((rb) => rb.fileName === "plan-critic-stage.md")!;
    expect(r.body).toMatch(/pass.*slice-builder/i);
    expect(r.body).toMatch(/revise.*ac-author/i);
    expect(r.body).toMatch(/cancel.*user picker|cancel picker|cancel-slug|re-design/i);
  });

  it("runbook body declares the iteration cap (1 revise loop max; iteration 0 → 1; no third dispatch)", () => {
    const r = ON_DEMAND_RUNBOOKS.find((rb) => rb.fileName === "plan-critic-stage.md")!;
    expect(r.body).toMatch(/1 revise loop|one revise loop|revise loop max/i);
    expect(r.body).toMatch(/iteration/i);
  });

  it("runbook body declares the flow-state patches (planCriticVerdict / planCriticIteration / planCriticDispatchedAt)", () => {
    const r = ON_DEMAND_RUNBOOKS.find((rb) => rb.fileName === "plan-critic-stage.md")!;
    expect(r.body).toContain("planCriticVerdict");
    expect(r.body).toContain("planCriticIteration");
    expect(r.body).toContain("planCriticDispatchedAt");
  });

  it("runbook body declares the legacy migration for pre-v8.51 flow-state files", () => {
    const r = ON_DEMAND_RUNBOOKS.find((rb) => rb.fileName === "plan-critic-stage.md")!;
    expect(r.body).toMatch(/legacy|pre-v8\.51|migration/i);
  });

  it("orchestrator body references `plan-critic-stage.md` from the dispatch table or trigger surface", () => {
    const body = renderStartCommand();
    expect(
      body,
      "start-command body must reference `plan-critic-stage.md` so the orchestrator opens it on the gated dispatch"
    ).toContain("plan-critic-stage.md");
  });
});

// ─────────────────────────────────────────────────────────────────────
// Flow state — type validators + backwards compat
// ─────────────────────────────────────────────────────────────────────

const BASE_FLOW_STATE = {
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

describe("v8.51 flow-state additions — planCritic{Verdict, Iteration, DispatchedAt}", () => {
  it("validator accepts state without any planCritic fields (backwards compat with pre-v8.51 flows)", () => {
    expect(() => assertFlowStateV8(BASE_FLOW_STATE)).not.toThrow();
  });

  it("validator accepts state with planCriticVerdict=null (explicit not-yet-run / skipped marker)", () => {
    const state = { ...BASE_FLOW_STATE, planCriticVerdict: null };
    expect(() => assertFlowStateV8(state)).not.toThrow();
  });

  for (const verdict of ["pass", "revise", "cancel"] as const) {
    it(`validator accepts state with planCriticVerdict=${verdict}`, () => {
      const state = { ...BASE_FLOW_STATE, planCriticVerdict: verdict };
      expect(() => assertFlowStateV8(state)).not.toThrow();
    });
  }

  it("validator rejects state with an invalid planCriticVerdict (e.g. `block-ship` — that's the post-impl critic's vocabulary)", () => {
    const state = { ...BASE_FLOW_STATE, planCriticVerdict: "block-ship" };
    expect(() => assertFlowStateV8(state)).toThrow(/Invalid planCriticVerdict/);
  });

  it("validator rejects state with planCriticVerdict=`iterate` (post-impl critic's vocabulary)", () => {
    const state = { ...BASE_FLOW_STATE, planCriticVerdict: "iterate" };
    expect(() => assertFlowStateV8(state)).toThrow(/Invalid planCriticVerdict/);
  });

  it("validator rejects state with planCriticVerdict=`unknown`", () => {
    const state = { ...BASE_FLOW_STATE, planCriticVerdict: "unknown" };
    expect(() => assertFlowStateV8(state)).toThrow(/Invalid planCriticVerdict/);
  });

  it("validator accepts state with planCriticIteration=0", () => {
    const state = { ...BASE_FLOW_STATE, planCriticIteration: 0 };
    expect(() => assertFlowStateV8(state)).not.toThrow();
  });

  it("validator accepts state with planCriticIteration=1 (the maximum allowed under the 1-revise-loop cap)", () => {
    const state = { ...BASE_FLOW_STATE, planCriticIteration: 1 };
    expect(() => assertFlowStateV8(state)).not.toThrow();
  });

  it("validator rejects state with planCriticIteration=2 (third dispatch is structurally not allowed)", () => {
    const state = { ...BASE_FLOW_STATE, planCriticIteration: 2 };
    expect(() => assertFlowStateV8(state)).toThrow(/planCriticIteration.*0 or 1|revise-loop cap/);
  });

  it("validator rejects state with planCriticIteration=-1 (counts are non-negative)", () => {
    const state = { ...BASE_FLOW_STATE, planCriticIteration: -1 };
    expect(() => assertFlowStateV8(state)).toThrow(/planCriticIteration/);
  });

  it("validator rejects state with planCriticIteration as a string", () => {
    const state = { ...BASE_FLOW_STATE, planCriticIteration: "1" };
    expect(() => assertFlowStateV8(state)).toThrow(/planCriticIteration/);
  });

  it("validator accepts state with planCriticDispatchedAt as an ISO timestamp string", () => {
    const state = {
      ...BASE_FLOW_STATE,
      planCriticDispatchedAt: "2026-05-14T18:10:00.000Z"
    };
    expect(() => assertFlowStateV8(state)).not.toThrow();
  });

  it("validator rejects state with planCriticDispatchedAt as a non-string (e.g. number epoch)", () => {
    const state = { ...BASE_FLOW_STATE, planCriticDispatchedAt: 1715706600 };
    expect(() => assertFlowStateV8(state)).toThrow(/planCriticDispatchedAt/);
  });

  it("validator accepts the full happy-path state with all three planCritic fields populated", () => {
    const state = {
      ...BASE_FLOW_STATE,
      planCriticVerdict: "pass" as const,
      planCriticIteration: 0,
      planCriticDispatchedAt: "2026-05-14T18:10:00.000Z"
    };
    expect(() => assertFlowStateV8(state)).not.toThrow();
  });

  it("validator accepts a revise-bounce state (iteration=1, verdict=revise, dispatchedAt set)", () => {
    const state = {
      ...BASE_FLOW_STATE,
      planCriticVerdict: "revise" as const,
      planCriticIteration: 1,
      planCriticDispatchedAt: "2026-05-14T18:10:00.000Z"
    };
    expect(() => assertFlowStateV8(state)).not.toThrow();
  });

  it("validator accepts a cancel state (iteration=0, verdict=cancel) — cancel surfaces immediately, iteration does not advance", () => {
    const state = {
      ...BASE_FLOW_STATE,
      planCriticVerdict: "cancel" as const,
      planCriticIteration: 0,
      planCriticDispatchedAt: "2026-05-14T18:10:00.000Z"
    };
    expect(() => assertFlowStateV8(state)).not.toThrow();
  });
});

// ─────────────────────────────────────────────────────────────────────
// Orchestrator wiring — start-command.ts body declares the plan-critic step
// ─────────────────────────────────────────────────────────────────────

describe("v8.51 orchestrator wiring — start-command body declares the plan-critic sub-step", () => {
  it("start-command body names the `plan-critic` specialist", () => {
    const body = renderStartCommand();
    expect(body).toContain("plan-critic");
  });

  it("start-command body declares the 4-AND gate in the prose (acMode=strict + complexity=large-risky + problemType!=refines + AC count >= 2)", () => {
    const body = renderStartCommand();
    expect(body).toMatch(/acMode.*strict.*large-risky|strict.*large-risky.*refines/);
    expect(body).toMatch(/AC count.*≥\s*2|AC count.*>=\s*2|AC count.*\bgte\b\s*2/);
  });

  it("start-command body declares that plan-critic is a SUB-STEP of `plan` (not a separate stage in FLOW_STAGES / triage.path)", () => {
    const body = renderStartCommand();
    expect(body).toMatch(/sub-step|sub_step|sub step/i);
  });

  it("start-command body declares the three verdicts (pass / revise / cancel) in the routing prose", () => {
    const body = renderStartCommand();
    expect(body).toMatch(/`pass`/);
    expect(body).toMatch(/`revise`/);
    expect(body).toMatch(/`cancel`/);
  });

  it("start-command body adds `plan-critic` to the `lastSpecialist` enum surface so resume reads it", () => {
    const body = renderStartCommand();
    // The lastSpecialist enum appears in the dispatch-envelope prose
    // (resume summary surface). Don't pin the exact line — assert
    // the value appears at least once in the body alongside the
    // other lastSpecialist values.
    expect(body).toContain("lastSpecialist");
    expect(body).toContain("plan-critic");
    expect(body).toContain("ac-author");
    expect(body).toContain("critic");
  });
});

// ─────────────────────────────────────────────────────────────────────
// Cross-specialist count tripwires (final consistency check)
// ─────────────────────────────────────────────────────────────────────

describe("v8.51 cross-specialist consistency — counts line up across registries", () => {
  it("SPECIALISTS, SPECIALIST_PROMPTS keys, and SPECIALIST_AGENTS are all in lockstep at exactly 8 specialists (v8.52 added qa-runner)", () => {
    expect(SPECIALISTS).toHaveLength(8);
    expect(Object.keys(SPECIALIST_PROMPTS)).toHaveLength(8);
    expect(SPECIALIST_AGENTS).toHaveLength(8);
    for (const id of SPECIALISTS) {
      expect(SPECIALIST_PROMPTS[id], `prompt missing for specialist ${id}`).toBeDefined();
      const agent = SPECIALIST_AGENTS.find((a) => a.id === id);
      expect(agent, `agent missing for specialist ${id}`).toBeDefined();
    }
  });

  it("plan-critic and critic are SEPARATE specialists (v8.51 deliberately does NOT collapse the post-impl critic into plan-critic)", () => {
    expect((SPECIALISTS as readonly string[]).includes(PLAN_CRITIC)).toBe(true);
    expect((SPECIALISTS as readonly string[]).includes("critic")).toBe(true);
    expect(PLAN_CRITIC).not.toBe("critic");
    const planCritic = SPECIALIST_AGENTS.find((a) => a.id === PLAN_CRITIC)!;
    const critic = SPECIALIST_AGENTS.find((a) => a.id === "critic")!;
    expect(planCritic.prompt).not.toBe(critic.prompt);
    expect(planCritic.modes).not.toEqual(critic.modes);
  });
});
