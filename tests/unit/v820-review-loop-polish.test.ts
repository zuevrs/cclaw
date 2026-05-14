import { describe, expect, it } from "vitest";
import {
  assertFlowStateV82,
  createInitialFlowState,
  FLOW_STATE_SCHEMA_VERSION
} from "../../src/flow-state.js";
import { START_COMMAND_BODY } from "../../src/content/start-command.js";
import { ON_DEMAND_RUNBOOKS } from "../../src/content/runbooks-on-demand.js";
import { REVIEWER_PROMPT } from "../../src/content/specialist-prompts/reviewer.js";
import { ARTIFACT_TEMPLATES } from "../../src/content/artifact-templates.js";
import type { TriageDecision } from "../../src/types.js";

function runbookBody(id: string): string {
  const r = ON_DEMAND_RUNBOOKS.find((rb) => rb.id === id);
  if (!r) throw new Error(`No on-demand runbook with id=${id}`);
  return r.body;
}

/**
 * v8.20 review-loop polish. The two-reviewer loop introduced in v8.13 is
 * mostly working: it catches more findings than a single pass. But it
 * has three operational papercuts:
 *
 *  1. reviewer-1 and reviewer-2 surface the same finding worded
 *     differently → review.md bloats with duplicates.
 *  2. There is no cap-reached *picker* — only a `cap-reached` decision
 *     that surfaces "residual blockers" and waits. A user who wants to
 *     extend the budget has no first-class way to do so.
 *  3. `severity=required + axis=architecture` carries over as a warn in
 *     soft mode. Architecture-axis findings name structural risks
 *     where shipping-anyway is the wrong default.
 *
 * v8.20 closes all three. The tests below are tripwires for each AC.
 */
describe("v8.20 review-loop polish", () => {
  describe("AC-1 — finding dedup inside review.md (reviewer prompt instructions)", () => {
    it("reviewer prompt instructs dedup by (axis, surface, normalized_one_liner)", () => {
      expect(REVIEWER_PROMPT).toContain("Finding dedup");
      expect(REVIEWER_PROMPT).toContain("axis");
      expect(REVIEWER_PROMPT).toContain("normalized_one_liner");
    });

    it("reviewer prompt names a stopword list inline for one-liner normalisation", () => {
      // Dedup happens in prose; the prompt MUST inline the stopword list so
      // the reviewer doesn't drift to a different (whitespace-only) shape.
      expect(REVIEWER_PROMPT).toMatch(/stopwords?[^.]*the[^.]*and[^.]*or/iu);
    });

    it("reviewer prompt specifies the seen-by line on a dedup merge", () => {
      expect(REVIEWER_PROMPT).toContain("seen-by");
    });

    it("reviewer prompt specifies severity bump on dedup merge (higher wins)", () => {
      expect(REVIEWER_PROMPT).toMatch(/higher of the two|higher.*wins|severity.*higher/iu);
    });

    it("reviewer prompt tells the reviewer to record pre- and post-dedup counts", () => {
      // The orchestrator stamps these into review.md frontmatter
      // (`total_findings`, `deduped_from`). The reviewer must surface them
      // in the iteration block.
      expect(REVIEWER_PROMPT).toMatch(/deduped from|deduped_from|pre-dedup/iu);
    });
  });

  describe("AC-2 — hard cap with picker", () => {
    it("flow-state.json includes reviewCounter in createInitialFlowState", () => {
      const state = createInitialFlowState("2026-05-11T00:00:00Z");
      expect(state.reviewCounter).toBe(0);
    });

    it("assertFlowStateV82 accepts state with reviewCounter set", () => {
      const state = {
        schemaVersion: FLOW_STATE_SCHEMA_VERSION,
        currentSlug: null,
        currentStage: null,
        ac: [],
        lastSpecialist: null,
        startedAt: "2026-05-11T00:00:00Z",
        reviewIterations: 5,
        reviewCounter: 5,
        securityFlag: false,
        triage: null
      };
      expect(() => assertFlowStateV82(state)).not.toThrow();
    });

    it("assertFlowStateV82 rejects state with negative reviewCounter", () => {
      const state = {
        schemaVersion: FLOW_STATE_SCHEMA_VERSION,
        currentSlug: null,
        currentStage: null,
        ac: [],
        lastSpecialist: null,
        startedAt: "2026-05-11T00:00:00Z",
        reviewIterations: 0,
        reviewCounter: -1,
        securityFlag: false,
        triage: null
      };
      expect(() => assertFlowStateV82(state)).toThrow(/reviewCounter/u);
    });

    it("v8.19 state without reviewCounter validates unchanged (back-compat)", () => {
      const v819State = {
        schemaVersion: FLOW_STATE_SCHEMA_VERSION,
        currentSlug: null,
        currentStage: null,
        ac: [],
        lastSpecialist: null,
        startedAt: "2026-05-11T00:00:00Z",
        reviewIterations: 3,
        securityFlag: false,
        triage: null
      };
      expect(() => assertFlowStateV82(v819State)).not.toThrow();
    });

    it("cap-reached picker options live in the cap-reached-recovery runbook (v8.22 split)", () => {
      const cr = runbookBody("cap-reached-recovery");
      expect(cr).toMatch(/reviewCounter.*reach[^.]*5|cap[^.]*5/iu);
      expect(cr).toContain("cancel-and-replan");
      expect(cr).toContain("accept-warns-and-ship");
      expect(cr).toContain("keep-iterating-anyway");
      expect(START_COMMAND_BODY).toContain("cap-reached-recovery.md");
    });

    it("cap-reached runbook specifies keep-iterating-anyway resets reviewCounter to 3", () => {
      const cr = runbookBody("cap-reached-recovery");
      expect(cr).toMatch(/keep-iterating-anyway[\s\S]*reset[\s\S]*?3/iu);
    });

    it("cap-reached runbook specifies keep-iterating-anyway stamps triage.iterationOverride", () => {
      const cr = runbookBody("cap-reached-recovery");
      expect(cr).toContain("triage.iterationOverride");
    });

    it("TriageDecision schema accepts iterationOverride boolean", () => {
      const triage = {
        complexity: "small-medium",
        acMode: "soft",
        path: ["plan", "build", "review", "ship"],
        rationale: "test",
        decidedAt: "2026-05-11T00:00:00Z",
        userOverrode: false,
        iterationOverride: true
      } satisfies TriageDecision;
      const state = {
        schemaVersion: FLOW_STATE_SCHEMA_VERSION,
        currentSlug: "test",
        currentStage: "review",
        ac: [],
        lastSpecialist: null,
        startedAt: "2026-05-11T00:00:00Z",
        reviewIterations: 5,
        reviewCounter: 3,
        securityFlag: false,
        triage
      };
      expect(() => assertFlowStateV82(state)).not.toThrow();
    });
  });

  describe("AC-3 — severity=required + axis=architecture gates ship across acModes", () => {
    it("reviewer prompt names the architecture-severity priors rule", () => {
      expect(REVIEWER_PROMPT).toContain("Architecture severity priors");
      expect(REVIEWER_PROMPT).toMatch(/required[^.]*architecture[^.]*ship/iu);
    });

    it("reviewer prompt says the gate applies across every acMode (not just strict)", () => {
      expect(REVIEWER_PROMPT).toMatch(/across every acMode|every ac[\s-]?mode|all ac[\s-]?modes/iu);
    });

    it("start-command's ship gate enforces the architecture finding rule", () => {
      expect(START_COMMAND_BODY).toMatch(/architecture[^\n]*gate|ship_gate.*architecture/iu);
    });

    it("start-command lists accept-warns-and-ship as the path past the architecture gate", () => {
      expect(START_COMMAND_BODY).toMatch(/architecture[\s\S]*accept-warns-and-ship/iu);
    });
  });

  describe("AC-4 — two-reviewer mode stays default (no removal)", () => {
    it("orchestrator still mentions the parallel reviewer + security-reviewer dispatch (v8.22: in review section + ship-gate runbook)", () => {
      const inBody = START_COMMAND_BODY.includes("parallel reviewer + security-reviewer");
      const inRunbook = runbookBody("handoff-gates").includes("security-reviewer") ||
        runbookBody("handoff-gates").includes("security_flag");
      expect(inBody || inRunbook).toBe(true);
    });

    it("reviewer prompt still names the adversarial mode (Model A writes / Model B reviews)", () => {
      expect(REVIEWER_PROMPT).toContain("Model A writes, Model B reviews");
    });
  });

  describe("AC-5 — review.md frontmatter telemetry", () => {
    const reviewTemplate = ARTIFACT_TEMPLATES.find((t) => t.id === "review")?.body ?? "";

    it("REVIEW_TEMPLATE frontmatter includes iteration: 0", () => {
      expect(reviewTemplate).toMatch(/^iteration: 0$/mu);
    });

    it("REVIEW_TEMPLATE frontmatter includes total_findings: 0", () => {
      expect(reviewTemplate).toMatch(/^total_findings: 0$/mu);
    });

    it("REVIEW_TEMPLATE frontmatter includes deduped_from: 0", () => {
      expect(reviewTemplate).toMatch(/^deduped_from: 0$/mu);
    });

    it("REVIEW_TEMPLATE frontmatter preserves the legacy review_iterations counter", () => {
      // The orchestrator stamps both: review_iterations is the monotonic
      // lifetime count; the new fields are per-iteration telemetry.
      expect(reviewTemplate).toMatch(/^review_iterations: 0$/mu);
    });
  });
});
