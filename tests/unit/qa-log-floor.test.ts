import { describe, expect, it } from "vitest";
import {
  ELICITATION_STAGES,
  evaluateQaLogFloor,
  extractForcingQuestions
} from "../../src/artifact-linter/shared.js";

/**
 * Wave 23 (v5.0.0) unit fixtures for `evaluateQaLogFloor`. These pin the new
 * `qa_log_unconverged` linter contract that replaces the count-based
 * `qa_log_below_min` rule.
 *
 * Convergence sources (any one is sufficient):
 *   - All forcing-question topics from the stage's checklist appear addressed
 *     in the Q&A Log (substring keyword match in question/answer columns).
 *   - The Ralph-Loop convergence detector reports the last 2 substantive rows
 *     have decision_impact marking `skip` / `continue` / `no-change` / `done`.
 *   - Q&A Log contains an explicit user stop-signal row.
 *   - `--skip-questions` flag was persisted (downgrades to advisory).
 *   - Stage exposes no forcing-questions row (e.g. spec/plan/tdd/review/ship)
 *     AND artifact has at least one substantive row.
 *
 * Wave 23 removed:
 *   - The fixed `min` count constant (10 for standard, 5 for medium, 2 for quick).
 *   - The `CCLAW_ELICITATION_FLOOR=advisory` env override (replaced by
 *     `--skip-questions` advisory).
 *   - The lite-tier short-circuit (quick track no longer needs a special case;
 *     no-forcing convergence covers it).
 *   - `min` field always reports 0; `liteShortCircuit` always reports false.
 */

const FORCING_COVERAGE_QA_LOG = `## Q&A Log
| Turn | Question | User answer (1-line) | Decision impact |
|---|---|---|---|
| 1 | What pain are we solving for users today? | Onboarding takes 30 min. | scope-shaping |
| 2 | What is the direct path to fix it? | Self-serve checklist. | architecture-shaping |
| 3 | What happens if we do nothing? | Churn climbs ~3% MoM. | urgency-shaping |
| 4 | Who is the first operator/user affected? | Solo founder onboarding alone. | persona-shaping |
| 5 | What no-go boundaries are non-negotiable? | No new infra in v1. | scope-shaping |
`;

const NO_NEW_DECISIONS_QA_LOG = `## Q&A Log
| Turn | Question | User answer (1-line) | Decision impact |
|---|---|---|---|
| 1 | Are we OK with markdown only? | Yes | locks-format |
| 2 | Any persistence beyond filesystem? | No | locks-storage |
| 3 | Anything else to add? | no-change | continue |
| 4 | Any final concern? | nothing more | continue |
`;

const STOP_SIGNAL_QA_LOG = `## Q&A Log
| Turn | Question | User answer (1-line) | Decision impact |
|---|---|---|---|
| 1 | (stop-signal) | "достаточно, давай драфт" | stop-and-draft |
`;

const UNCONVERGED_QA_LOG = `## Q&A Log
| Turn | Question | User answer (1-line) | Decision impact |
|---|---|---|---|
| 1 | Casual ping | hi | greeting |
`;

const ALL_SKIPPED_QA_LOG = `## Q&A Log
| Turn | Question | User answer (1-line) | Decision impact |
|---|---|---|---|
| 1 | Q1 | A1 | skipped |
| 2 | Q2 | A2 | waived |
`;

describe("evaluateQaLogFloor (Wave 23 / v5.0.0 convergence contract)", () => {
  it("fails standard/brainstorm with empty Q&A Log (no convergence sources)", () => {
    const result = evaluateQaLogFloor(null, "standard", "brainstorm");
    expect(result.ok).toBe(false);
    expect(result.count).toBe(0);
    expect(result.min).toBe(0);
    expect(result.liteShortCircuit).toBe(false);
    expect(result.hasStopSignal).toBe(false);
    expect(result.noNewDecisions).toBe(false);
    expect(result.skipQuestionsAdvisory).toBe(false);
    expect(result.details).toMatch(/unconverged/iu);
  });

  it("passes standard/brainstorm when all forcing-question topics are covered", () => {
    const result = evaluateQaLogFloor(FORCING_COVERAGE_QA_LOG, "standard", "brainstorm");
    expect(result.ok).toBe(true);
    expect(result.forcingPending).toEqual([]);
    expect(result.forcingCovered.length).toBeGreaterThan(0);
    expect(result.details).toMatch(/converged/iu);
  });

  it("passes via Ralph-Loop convergence (last 2 rows produce no decision changes)", () => {
    const result = evaluateQaLogFloor(NO_NEW_DECISIONS_QA_LOG, "standard", "brainstorm");
    expect(result.noNewDecisions).toBe(true);
    expect(result.ok).toBe(true);
    expect(result.details).toMatch(/no-new-decisions|Ralph/iu);
  });

  it("passes via stop-signal escape hatch even with only 1 row", () => {
    const result = evaluateQaLogFloor(STOP_SIGNAL_QA_LOG, "standard", "brainstorm");
    expect(result.ok).toBe(true);
    expect(result.hasStopSignal).toBe(true);
    expect(result.details).toMatch(/stop-signal/iu);
  });

  it("downgrades unconverged Q&A to advisory under --skip-questions", () => {
    const result = evaluateQaLogFloor(UNCONVERGED_QA_LOG, "standard", "brainstorm", {
      skipQuestions: true
    });
    expect(result.ok).toBe(false);
    expect(result.skipQuestionsAdvisory).toBe(true);
    expect(result.details).toMatch(/--skip-questions/iu);
    expect(result.details).toMatch(/advisory/iu);
  });

  it("excludes skipped/waived rows from the substantive count", () => {
    const result = evaluateQaLogFloor(ALL_SKIPPED_QA_LOG, "standard", "brainstorm");
    expect(result.count).toBe(0);
    expect(result.ok).toBe(false);
    expect(result.hasStopSignal).toBe(false);
  });

  it("returns trivially ok=true for non-elicitation stages (no forcing questions)", () => {
    const result = evaluateQaLogFloor(null, "standard", "spec");
    expect(result.min).toBe(0);
    // Spec exposes no forcing-questions row but artifact has 0 substantive
    // rows — convergence requires at least 1 row when no forcing topics exist.
    expect(result.ok).toBe(false);
  });

  it("non-elicitation stage with at least one substantive row converges", () => {
    const result = evaluateQaLogFloor(
      `## Q&A Log\n| Turn | Question | Answer | Decision impact |\n|---|---|---|---|\n| 1 | sample | yes | locks-something |\n`,
      "standard",
      "spec"
    );
    expect(result.ok).toBe(true);
    expect(result.count).toBe(1);
  });

  it("recognizes RU stop-signal phrases (хватит, достаточно, давай драфт)", () => {
    const ruStopSignal = `## Q&A Log
| Turn | Question | Answer | Disposition |
|---|---|---|---|
| 1 | sample | хватит | stop |
`;
    const result = evaluateQaLogFloor(ruStopSignal, "standard", "scope");
    expect(result.ok).toBe(true);
    expect(result.hasStopSignal).toBe(true);
  });

  it("recognizes UA stop-signal phrases (досить, вистачить, рухаємось далі)", () => {
    const uaStopSignal = `## Q&A Log
| Turn | Question | Answer | Disposition |
|---|---|---|---|
| 1 | sample | досить | stop |
`;
    const result = evaluateQaLogFloor(uaStopSignal, "standard", "design");
    expect(result.ok).toBe(true);
    expect(result.hasStopSignal).toBe(true);
  });

  it("CCLAW_ELICITATION_FLOOR env override is removed (env value has no effect)", () => {
    const original = process.env.CCLAW_ELICITATION_FLOOR;
    process.env.CCLAW_ELICITATION_FLOOR = "advisory";
    try {
      const result = evaluateQaLogFloor(null, "standard", "brainstorm");
      expect(result.ok).toBe(false);
      // Env override no longer downgrades to advisory; only --skip-questions does.
      expect(result.skipQuestionsAdvisory).toBe(false);
    } finally {
      if (original === undefined) {
        delete process.env.CCLAW_ELICITATION_FLOOR;
      } else {
        process.env.CCLAW_ELICITATION_FLOOR = original;
      }
    }
  });

  it("ELICITATION_STAGES is exactly brainstorm/scope/design", () => {
    expect(Array.from(ELICITATION_STAGES).sort()).toEqual(["brainstorm", "design", "scope"]);
  });

  it("extractForcingQuestions(brainstorm) returns the brainstorm forcing topics", () => {
    const topics = extractForcingQuestions("brainstorm");
    expect(topics.length).toBeGreaterThan(0);
    // Brainstorm checklist row: "what pain are we solving, what is the direct
    // path, what happens if we do nothing, who is the first operator/user
    // affected, and what no-go boundaries are non-negotiable."
    const all = topics.join(" ").toLowerCase();
    expect(all).toMatch(/pain/u);
    expect(all).toMatch(/direct path|path/u);
    expect(all).toMatch(/operator|user/u);
  });

  it("extractForcingQuestions returns [] for stages without forcing-questions row", () => {
    expect(extractForcingQuestions("plan")).toEqual([]);
    expect(extractForcingQuestions("ship")).toEqual([]);
  });
});
