import { describe, expect, it } from "vitest";
import {
  ELICITATION_STAGES,
  evaluateQaLogFloor
} from "../../src/artifact-linter/shared.js";

/**
 * Wave 22 unit fixtures for `evaluateQaLogFloor`. These pin the contract for
 * the new `qa_log_below_min` linter rule:
 *
 *   - 0 rows + standard track + brainstorm => FAIL (count < min, no escape).
 *   - >= 10 rows + standard track + brainstorm => PASS (count >= min).
 *   - 0 rows + stop-signal phrase => PASS via stop-signal escape hatch.
 *   - 0 rows + `--skip-questions` => FAIL semantically but downgraded to
 *     advisory; `skipQuestionsAdvisory` flag is set so the linter marks the
 *     finding non-blocking.
 *   - quick track + 1 substantive row => PASS via lite short-circuit.
 *   - non-elicitation stage (e.g. spec) => PASS trivially with min=0.
 *   - rows whose disposition column is `skipped`/`waived` only do NOT count
 *     toward the substantive total.
 */

const STANDARD_QA_LOG = `## Q&A Log
| Turn | Question | User answer (1-line) | Decision impact |
|---|---|---|---|
| 1 | Q1 | A1 | impact-1 |
| 2 | Q2 | A2 | impact-2 |
| 3 | Q3 | A3 | impact-3 |
| 4 | Q4 | A4 | impact-4 |
| 5 | Q5 | A5 | impact-5 |
| 6 | Q6 | A6 | impact-6 |
| 7 | Q7 | A7 | impact-7 |
| 8 | Q8 | A8 | impact-8 |
| 9 | Q9 | A9 | impact-9 |
| 10 | Q10 | A10 | impact-10 |
`;

const STOP_SIGNAL_QA_LOG = `## Q&A Log
| Turn | Question | User answer (1-line) | Decision impact |
|---|---|---|---|
| 1 | (stop-signal) | "достаточно, давай драфт" | stop-and-draft |
`;

const SINGLE_SUBSTANTIVE_QA_LOG = `## Q&A Log
| Turn | Question | User answer (1-line) | Decision impact |
|---|---|---|---|
| 1 | Static or dynamic? | Static | removes backend/CMS from v1 |
`;

const ALL_SKIPPED_QA_LOG = `## Q&A Log
| Turn | Question | User answer (1-line) | Decision impact |
|---|---|---|---|
| 1 | Q1 | A1 | skipped |
| 2 | Q2 | A2 | waived |
`;

describe("evaluateQaLogFloor (Wave 22 contract)", () => {
  it("fails standard/brainstorm with empty Q&A Log (no escape hatches)", () => {
    const result = evaluateQaLogFloor(null, "standard", "brainstorm");
    expect(result.ok).toBe(false);
    expect(result.count).toBe(0);
    expect(result.min).toBe(10);
    expect(result.hasStopSignal).toBe(false);
    expect(result.liteShortCircuit).toBe(false);
    expect(result.skipQuestionsAdvisory).toBe(false);
    expect(result.details).toContain("0 substantive entries");
    expect(result.details).toContain("minimum for standard/brainstorm is 10");
  });

  it("passes standard/brainstorm when count >= min (10 substantive rows)", () => {
    const result = evaluateQaLogFloor(STANDARD_QA_LOG, "standard", "brainstorm");
    expect(result.ok).toBe(true);
    expect(result.count).toBe(10);
    expect(result.min).toBe(10);
    expect(result.hasStopSignal).toBe(false);
    expect(result.liteShortCircuit).toBe(false);
  });

  it("passes via stop-signal escape hatch even with only 1 row", () => {
    const result = evaluateQaLogFloor(STOP_SIGNAL_QA_LOG, "standard", "brainstorm");
    expect(result.ok).toBe(true);
    expect(result.count).toBe(1);
    expect(result.hasStopSignal).toBe(true);
    expect(result.details).toContain("explicit user stop-signal row recorded");
  });

  it("downgrades empty Q&A Log to advisory under --skip-questions (skipQuestionsAdvisory=true)", () => {
    const result = evaluateQaLogFloor(null, "standard", "brainstorm", {
      skipQuestions: true
    });
    expect(result.ok).toBe(false);
    expect(result.skipQuestionsAdvisory).toBe(true);
    expect(result.details).toContain("--skip-questions flag was set");
    expect(result.details).toContain("downgraded to advisory");
  });

  it("passes quick-track / lite short-circuit when at least 1 substantive row exists", () => {
    const result = evaluateQaLogFloor(SINGLE_SUBSTANTIVE_QA_LOG, "quick", "brainstorm");
    expect(result.ok).toBe(true);
    expect(result.count).toBe(1);
    expect(result.min).toBe(2);
    expect(result.liteShortCircuit).toBe(true);
    expect(result.details).toContain("lightweight track short-circuit");
  });

  it("does NOT short-circuit medium track with only 1 row (lite path is quick-only)", () => {
    const result = evaluateQaLogFloor(SINGLE_SUBSTANTIVE_QA_LOG, "medium", "brainstorm");
    expect(result.ok).toBe(false);
    expect(result.count).toBe(1);
    expect(result.min).toBe(5);
    expect(result.liteShortCircuit).toBe(false);
    expect(result.hasStopSignal).toBe(false);
  });

  it("excludes skipped/waived rows from the substantive count", () => {
    const result = evaluateQaLogFloor(ALL_SKIPPED_QA_LOG, "standard", "brainstorm");
    expect(result.count).toBe(0);
    expect(result.ok).toBe(false);
    expect(result.hasStopSignal).toBe(false);
  });

  it("returns trivially ok=true for non-elicitation stages (min=0)", () => {
    const result = evaluateQaLogFloor(null, "standard", "spec");
    expect(result.min).toBe(0);
    expect(result.ok).toBe(true);
    expect(result.count).toBe(0);
  });

  it("ELICITATION_STAGES is exactly brainstorm/scope/design", () => {
    expect(Array.from(ELICITATION_STAGES).sort()).toEqual(["brainstorm", "design", "scope"]);
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

  it("emergency CCLAW_ELICITATION_FLOOR=advisory env var downgrades empty Q&A to advisory", () => {
    const original = process.env.CCLAW_ELICITATION_FLOOR;
    process.env.CCLAW_ELICITATION_FLOOR = "advisory";
    try {
      const result = evaluateQaLogFloor(null, "standard", "brainstorm");
      expect(result.ok).toBe(false);
      expect(result.skipQuestionsAdvisory).toBe(true);
      expect(result.details).toContain("CCLAW_ELICITATION_FLOOR=advisory env override is active");
    } finally {
      if (original === undefined) {
        delete process.env.CCLAW_ELICITATION_FLOOR;
      } else {
        process.env.CCLAW_ELICITATION_FLOOR = original;
      }
    }
  });

  it("CCLAW_ELICITATION_FLOOR with any other value does NOT downgrade", () => {
    const original = process.env.CCLAW_ELICITATION_FLOOR;
    process.env.CCLAW_ELICITATION_FLOOR = "blocking";
    try {
      const result = evaluateQaLogFloor(null, "standard", "brainstorm");
      expect(result.ok).toBe(false);
      expect(result.skipQuestionsAdvisory).toBe(false);
      expect(result.details).toContain("Continue the elicitation loop");
    } finally {
      if (original === undefined) {
        delete process.env.CCLAW_ELICITATION_FLOOR;
      } else {
        process.env.CCLAW_ELICITATION_FLOOR = original;
      }
    }
  });
});
