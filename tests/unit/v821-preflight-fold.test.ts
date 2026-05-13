import { describe, expect, it } from "vitest";
import { assertFlowStateV82, FLOW_STATE_SCHEMA_VERSION } from "../../src/flow-state.js";
import { START_COMMAND_BODY } from "../../src/content/start-command.js";
import { DESIGN_PROMPT } from "../../src/content/specialist-prompts/design.js";
import { AC_AUTHOR_PROMPT } from "../../src/content/specialist-prompts/ac-author.js";
import { AUTO_TRIGGER_SKILLS } from "../../src/content/skills.js";
import type { TriageDecision } from "../../src/types.js";

/**
 * v8.21 preflight-fold. The legacy orchestrator Hop 2.5 produced two
 * back-to-back assumption asks on large-risky flows (Hop 2.5 then
 * design Phase 0 / Phase 1) and a friction-only hop on small-medium
 * (Hop 2.5 with no corresponding design phase). v8.21 folds the
 * surface into the first specialist's first turn:
 *
 *  - large-risky → design Phase 0 / Phase 1 owns the assumption surface
 *  - small-medium → ac-author Phase 0 owns it (new mini-section)
 *  - inline → unchanged, no surface
 *
 * `triage.assumptions` stays a first-class field on flow-state.json;
 * the wire format is identical to v8.20. Only the capture surface
 * moved.
 */
describe("v8.21 preflight-fold", () => {
  const preFlightSkill = AUTO_TRIGGER_SKILLS.find((s) => s.id === "pre-flight-assumptions");
  const triageGateSkill = AUTO_TRIGGER_SKILLS.find((s) => s.id === "triage-gate");

  describe("AC-1 — large-risky removes the separate preflight ask", () => {
    it("start-command body documents the fold (no separate preflight AskQuestion)", () => {
      // The legacy step ran `pre-flight-assumptions.md` and surfaced a
      // structured ask with Proceed / Edit one / Edit several. v8.21
      // names the fold explicitly so the orchestrator does not run
      // both surfaces in series.
      expect(START_COMMAND_BODY).toContain("## Preflight (folded into specialist Phase 0)");
      expect(START_COMMAND_BODY).toMatch(/no separate preflight/iu);
    });

    it("start-command names design Phase 0 as the large-risky owner", () => {
      expect(START_COMMAND_BODY).toMatch(/large-risky[\s\S]*?design Phase 0/u);
    });

    it("design.ts Phase 0 explicitly mentions the v8.21 fold (assumption-surface ownership)", () => {
      expect(DESIGN_PROMPT).toContain("Assumption-surface ownership");
      expect(DESIGN_PROMPT).toContain("triage.assumptions");
    });
  });

  describe("AC-2 — small-medium inlines into ac-author's first turn", () => {
    it("ac-author.ts has a Phase 0 mini-section for small-medium", () => {
      expect(AC_AUTHOR_PROMPT).toContain("Phase 0 — Assumption confirmation");
    });

    it("ac-author Phase 0 only runs on triage.complexity == 'small-medium'", () => {
      expect(AC_AUTHOR_PROMPT).toMatch(/small-medium[\s\S]*?Phase 0/u);
    });

    it("ac-author Phase 0 opens with the assumptions ask and waits one turn", () => {
      expect(AC_AUTHOR_PROMPT).toContain("I'm working from these assumptions");
      expect(AC_AUTHOR_PROMPT).toMatch(/Tell me if any is wrong/iu);
    });

    it("ac-author Phase 0 persists the agreed list to triage.assumptions", () => {
      expect(AC_AUTHOR_PROMPT).toMatch(/Persist[\s\S]*?triage\.assumptions/iu);
    });

    it("ac-author Phase 0 skips when triage.assumptions is already populated", () => {
      expect(AC_AUTHOR_PROMPT).toContain("Skip Phase 0 silently");
      expect(AC_AUTHOR_PROMPT).toMatch(/triage\.assumptions[^\n]*already populated/u);
    });
  });

  describe("AC-3 — inline path bypass unchanged", () => {
    it("start-command says the inline path has no assumption surface", () => {
      expect(START_COMMAND_BODY).toMatch(/inline.*no assumption surface|inline path has no assumption|inline.*has no/iu);
    });

    it("start-command's trivial path section still skips plan/review/ship", () => {
      expect(START_COMMAND_BODY).toMatch(/Skip plan\/review\/ship/u);
    });
  });

  describe("AC-4 — triage.assumptions stays a first-class field", () => {
    it("TriageDecision schema still accepts triage.assumptions as a string array", () => {
      const triage = {
        complexity: "small-medium",
        acMode: "soft",
        path: ["plan", "build", "review", "ship"],
        rationale: "test",
        decidedAt: "2026-05-11T00:00:00Z",
        userOverrode: false,
        assumptions: ["Node 20", "tests/ live alongside source"]
      } satisfies TriageDecision;
      const state = {
        schemaVersion: FLOW_STATE_SCHEMA_VERSION,
        currentSlug: "test",
        currentStage: "plan",
        ac: [],
        lastSpecialist: null,
        startedAt: "2026-05-11T00:00:00Z",
        reviewIterations: 0,
        reviewCounter: 0,
        securityFlag: false,
        triage
      };
      expect(() => assertFlowStateV82(state)).not.toThrow();
    });

    it("TriageDecision validator still accepts triage.assumptions: null (legacy + inline path)", () => {
      const triage = {
        complexity: "trivial",
        acMode: "inline",
        path: ["build"],
        rationale: "test",
        decidedAt: "2026-05-11T00:00:00Z",
        userOverrode: false,
        assumptions: null
      } satisfies TriageDecision;
      const state = {
        schemaVersion: FLOW_STATE_SCHEMA_VERSION,
        currentSlug: "test",
        currentStage: "build",
        ac: [],
        lastSpecialist: null,
        startedAt: "2026-05-11T00:00:00Z",
        reviewIterations: 0,
        reviewCounter: 0,
        securityFlag: false,
        triage
      };
      expect(() => assertFlowStateV82(state)).not.toThrow();
    });

    it("TriageDecision validator rejects non-string entries in triage.assumptions", () => {
      const triage = {
        complexity: "small-medium",
        acMode: "soft",
        path: ["plan", "build", "review", "ship"],
        rationale: "test",
        decidedAt: "2026-05-11T00:00:00Z",
        userOverrode: false,
        assumptions: ["fine", 42 as unknown as string]
      };
      const state = {
        schemaVersion: FLOW_STATE_SCHEMA_VERSION,
        currentSlug: "test",
        currentStage: "plan",
        ac: [],
        lastSpecialist: null,
        startedAt: "2026-05-11T00:00:00Z",
        reviewIterations: 0,
        reviewCounter: 0,
        securityFlag: false,
        triage
      };
      expect(() => assertFlowStateV82(state)).toThrow(/triage\.assumptions/u);
    });
  });

  describe("AC-5 — migration: pre-populated triage.assumptions short-circuits Phase 0", () => {
    it("ac-author Phase 0 says 'skip silently' when triage.assumptions is populated", () => {
      expect(AC_AUTHOR_PROMPT).toContain("Skip Phase 0 silently");
      expect(AC_AUTHOR_PROMPT).toMatch(/already populated/u);
    });

    it("design Phase 0 reads pre-populated triage.assumptions as ground truth", () => {
      expect(DESIGN_PROMPT).toMatch(/already populated[\s\S]*?read it verbatim|read it verbatim[\s\S]*?ground truth/u);
    });

    it("start-command's skip rules include resume-from-paused and mid-flight migration", () => {
      expect(START_COMMAND_BODY).toMatch(/Resume from a paused flow[\s\S]*?Phase 0[\s\S]*?does not re-prompt/u);
      expect(START_COMMAND_BODY).toMatch(/pre-v8\.21[\s\S]*?legacy preflight[\s\S]*?captured/u);
    });
  });

  describe("AC-8 — skill bodies updated", () => {
    it("pre-flight-assumptions.md becomes a thin reference doc (no separate user-facing ask)", () => {
      expect(preFlightSkill).toBeDefined();
      expect(preFlightSkill!.body).toContain("reference doc");
      expect(preFlightSkill!.body).toMatch(/v8\.21 fold/iu);
    });

    it("pre-flight-assumptions.md names both fold targets (design Phase 0 + ac-author Phase 0)", () => {
      expect(preFlightSkill!.body).toContain("design Phase 0");
      expect(preFlightSkill!.body).toContain("ac-author Phase 0");
    });

    it("triage-gate.md no longer claims a separate 'Hop 2.5' step in the flow diagram", () => {
      expect(triageGateSkill).toBeDefined();
      // The flow-diagram phrasing pre-v8.21 was: "runs the `pre-flight-
      // assumptions` skill (Hop 2.5) before dispatching the first
      // specialist". v8.21 drops the parenthetical step name and
      // re-routes the surface to the first specialist's first turn.
      expect(triageGateSkill!.body).not.toMatch(/pre-flight-assumptions.*\(Hop 2\.5\)/u);
      expect(triageGateSkill!.body).toMatch(/no separate "Hop 2\.5"|first specialist's first turn/u);
    });
  });
});
