import { describe, expect, it } from "vitest";
import { assertFlowStateV82, FLOW_STATE_SCHEMA_VERSION } from "../../src/flow-state.js";
import { ARCHITECT_PROMPT } from "../../src/content/specialist-prompts/architect.js";
import { AUTO_TRIGGER_SKILLS } from "../../src/content/skills.js";
import type { TriageDecision } from "../../src/types.js";

/**
 * v8.21 preflight-fold — re-pinned for v8.62 unified flow.
 *
 * Pre-v8.21 the orchestrator's Hop 2.5 ran a separate `pre-flight-
 * assumptions` ask before dispatching the first specialist. v8.21 folded
 * the surface into the first specialist's first turn (design Phase 0 on
 * large-risky, ac-author Phase 0 on small-medium).
 *
 * v8.61 retired mid-plan dialogue (always-auto). v8.62 unified flow goes
 * further: there is no more design / ac-author split, no more Phase 0
 * user ask. The single `architect` specialist's Bootstrap phase owns
 * assumption capture for every non-inline flow, and resolves vagueness
 * silently using best judgment. The skill-body fold from v8.21 still
 * stands — what changed is the fold target (single architect Bootstrap
 * phase instead of two phase-0 surfaces).
 *
 * `triage.assumptions` stays a first-class field on flow-state.json so
 * a state file written by any pre-v8.62 release continues to validate.
 */
describe("v8.21 preflight-fold (v8.62 unified flow re-pin)", () => {
  const preFlightSkill = AUTO_TRIGGER_SKILLS.find((s) => s.id === "pre-flight-assumptions");
  const triageGateSkill = AUTO_TRIGGER_SKILLS.find((s) => s.id === "triage-gate");

  describe("AC-1 — v8.62 unified flow: the architect's Bootstrap phase owns assumption capture for every non-inline flow (no separate preflight ask, no mid-plan dialogue)", () => {
    it("architect prompt declares assumption-capture ownership in the Bootstrap phase (replaces both design Phase 0 and ac-author Phase 0)", () => {
      expect(ARCHITECT_PROMPT).toMatch(/Bootstrap|Phase 0|assumption-capture|assumption capture/i);
      expect(ARCHITECT_PROMPT).toContain("triage.assumptions");
    });

    it("architect resolves assumptions silently — no clarifying questions, no dialogue (v8.62 unified flow forbids mid-plan dialogue)", () => {
      expect(ARCHITECT_PROMPT).toMatch(/(silently|silent|no.*clarifying|no.*dialogue|best judgment)/i);
      // The dead Phase 1 (Clarify) dialogue surface must NOT be reinstated.
      expect(ARCHITECT_PROMPT).not.toMatch(/Phase 1 — Clarify/);
      expect(ARCHITECT_PROMPT).not.toMatch(/at most three clarifying questions/i);
    });
  });

  describe("AC-4 — triage.assumptions stays a first-class field", () => {
    it("TriageDecision schema still accepts triage.assumptions as a string array", () => {
      const triage = {
        complexity: "small-medium",
        ceremonyMode: "soft",
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
        ceremonyMode: "inline",
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
        ceremonyMode: "soft",
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

  describe("AC-5 — migration: pre-populated triage.assumptions is treated as ground truth", () => {
    it("architect Bootstrap reads pre-populated triage.assumptions as ground truth (no re-capture)", () => {
      expect(ARCHITECT_PROMPT).toMatch(/already populated|already filled|pre-populated|round-trip/i);
    });
  });

  describe("AC-8 — skill bodies updated (v8.62)", () => {
    it("pre-flight-assumptions.md becomes a thin reference doc (no separate user-facing ask)", () => {
      expect(preFlightSkill).toBeDefined();
      expect(preFlightSkill!.body).toContain("reference doc");
      expect(preFlightSkill!.body).toMatch(/fold/iu);
    });

    it("pre-flight-assumptions.md names the v8.62 fold target (architect Bootstrap)", () => {
      // v8.62 — the v8.21 fold targeted both `design Phase 0` and
      // `ac-author Phase 0`; v8.62 collapses both into the single
      // `architect` Bootstrap phase.
      expect(preFlightSkill!.body).toMatch(/architect.*Bootstrap|Bootstrap.*architect/i);
    });

    it("triage-gate.md no longer claims a separate 'Hop 2.5' step in the flow diagram", () => {
      expect(triageGateSkill).toBeDefined();
      expect(triageGateSkill!.body).not.toMatch(/pre-flight-assumptions.*\(Hop 2\.5\)/u);
      // v8.62 — the legacy phrasing "first specialist's first turn"
      // was rewritten to ``architect`'s first dispatch`` (with code-
      // spanning backticks around `architect`) after the unified-flow
      // collapse. The regex tolerates optional code-span backticks
      // and any apostrophe between `architect` and "s first dispatch".
      expect(triageGateSkill!.body).toMatch(
        /no separate "Hop 2\.5"|first specialist.s first turn|architect`?.s first dispatch/
      );
    });
  });
});
