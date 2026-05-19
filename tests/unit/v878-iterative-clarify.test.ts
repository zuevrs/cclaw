import { describe, expect, it } from "vitest";

import { ARCHITECT_PROMPT } from "../../src/content/specialist-prompts/architect.js";
import {
  START_COMMAND_BODY,
  renderStartCommand
} from "../../src/content/start-command.js";
import {
  CLARIFY_DIMENSIONS,
  CLARIFY_EXIT_AMBIGUITY_THRESHOLD,
  CLARIFY_ARCHITECT_ROUND_CAP,
  CLARIFY_RESEARCH_ROUND_CAP,
  type ClarifyDimension,
  type ClarifyDimensionScore,
  type ClarifyRoundState
} from "../../src/types.js";
import { assertFlowStateV82, createInitialFlowState } from "../../src/flow-state.js";

/**
 * v8.78 — Iterative-clarify: per-dimension ambiguity scoring.
 *
 * Slimmed in v8.101 (Phase A4): kept the full validator-wiring block
 * (mutation testing showed these tests actively catch flow-state.ts
 * mutants), and slimmed the prompt-grep blocks per the A2 "2-3
 * unique-value rule".
 */

describe("v8.78 — ClarifyDimension constants + thresholds", () => {
  it("exports the four canonical dimensions + the three numeric thresholds (validator + ambiguity exit + round caps)", () => {
    expect([...CLARIFY_DIMENSIONS].sort()).toEqual([
      "constraints",
      "context",
      "criteria",
      "goal"
    ]);
    expect(CLARIFY_DIMENSIONS).toHaveLength(4);
    expect(CLARIFY_EXIT_AMBIGUITY_THRESHOLD).toBe(0.25);
    expect(CLARIFY_ARCHITECT_ROUND_CAP).toBe(5);
    expect(CLARIFY_RESEARCH_ROUND_CAP).toBe(8);
  });

  it("ClarifyDimensionScore + ClarifyRoundState shapes round-trip (compile-time + runtime check)", () => {
    const score: ClarifyDimensionScore = {
      dimension: "goal",
      score: 0.75,
      rationale: "Goal is mostly clear after the user named the target file"
    };
    const dims: ClarifyDimension[] = ["goal", "constraints", "criteria", "context"];
    const round: ClarifyRoundState = {
      round: 1,
      dimensionScores: [
        { dimension: "goal", score: 0.6, rationale: "vague verb still" },
        { dimension: "constraints", score: 0.3, rationale: "no boundaries named" },
        { dimension: "criteria", score: 0.2, rationale: "no AC named" },
        { dimension: "context", score: 0.5, rationale: "unknown repo layout" }
      ],
      ambiguity: 1 - (0.6 * 0.4 + 0.3 * 0.3 + 0.2 * 0.3 + 0.5 * 0.0),
      targetedDimension: "criteria",
      question: "What test would prove the work shipped?"
    };
    expect(score.score).toBe(0.75);
    expect(dims).toHaveLength(4);
    expect(round.dimensionScores).toHaveLength(4);
    expect(round.ambiguity).toBeCloseTo(0.61, 2);
  });
});

describe("v8.78 — FlowState.clarifyRounds[] persistence + validator", () => {
  it("a fresh flow state validates with no clarifyRounds (back-compat default absent)", () => {
    const state = createInitialFlowState("2026-05-17T00:00:00Z");
    expect(state.clarifyRounds).toBeUndefined();
    expect(() => assertFlowStateV82(state)).not.toThrow();
  });

  it("a state with valid clarifyRounds[] passes the validator", () => {
    const state = createInitialFlowState("2026-05-17T00:00:00Z");
    const round: ClarifyRoundState = {
      round: 1,
      dimensionScores: [
        { dimension: "goal", score: 0.7, rationale: "verb pinned" },
        { dimension: "constraints", score: 0.5, rationale: "partial" },
        { dimension: "criteria", score: 0.4, rationale: "thin" },
        { dimension: "context", score: 0.8, rationale: "known repo" }
      ],
      ambiguity: 0.42,
      targetedDimension: "criteria",
      question: "What's the pass/fail signal?"
    };
    const withRounds = { ...state, clarifyRounds: [round] };
    expect(() => assertFlowStateV82(withRounds)).not.toThrow();
  });

  it("the validator rejects an out-of-range score (negative)", () => {
    const state = createInitialFlowState("2026-05-17T00:00:00Z");
    const bad = {
      ...state,
      clarifyRounds: [
        {
          round: 1,
          dimensionScores: [
            { dimension: "goal", score: -0.1, rationale: "" },
            { dimension: "constraints", score: 0.5, rationale: "" },
            { dimension: "criteria", score: 0.5, rationale: "" },
            { dimension: "context", score: 0.5, rationale: "" }
          ],
          ambiguity: 0.5,
          targetedDimension: "goal",
          question: "x"
        }
      ]
    };
    expect(() => assertFlowStateV82(bad)).toThrow();
  });

  it("the validator rejects an out-of-range score (>1)", () => {
    const state = createInitialFlowState("2026-05-17T00:00:00Z");
    const bad = {
      ...state,
      clarifyRounds: [
        {
          round: 1,
          dimensionScores: [
            { dimension: "goal", score: 1.5, rationale: "" },
            { dimension: "constraints", score: 0.5, rationale: "" },
            { dimension: "criteria", score: 0.5, rationale: "" },
            { dimension: "context", score: 0.5, rationale: "" }
          ],
          ambiguity: 0.5,
          targetedDimension: "goal",
          question: "x"
        }
      ]
    };
    expect(() => assertFlowStateV82(bad)).toThrow();
  });

  it("the validator rejects an unknown dimension token", () => {
    const state = createInitialFlowState("2026-05-17T00:00:00Z");
    const bad = {
      ...state,
      clarifyRounds: [
        {
          round: 1,
          dimensionScores: [
            { dimension: "vibe", score: 0.5, rationale: "" }
          ],
          ambiguity: 0.5,
          targetedDimension: "vibe",
          question: "x"
        }
      ]
    };
    expect(() => assertFlowStateV82(bad)).toThrow();
  });

  it("the validator rejects an out-of-range ambiguity scalar", () => {
    const state = createInitialFlowState("2026-05-17T00:00:00Z");
    const bad = {
      ...state,
      clarifyRounds: [
        {
          round: 1,
          dimensionScores: [
            { dimension: "goal", score: 0.5, rationale: "" },
            { dimension: "constraints", score: 0.5, rationale: "" },
            { dimension: "criteria", score: 0.5, rationale: "" },
            { dimension: "context", score: 0.5, rationale: "" }
          ],
          ambiguity: 1.5,
          targetedDimension: "goal",
          question: "x"
        }
      ]
    };
    expect(() => assertFlowStateV82(bad)).toThrow();
  });

  it("the validator rejects a non-positive round number", () => {
    const state = createInitialFlowState("2026-05-17T00:00:00Z");
    const bad = {
      ...state,
      clarifyRounds: [
        {
          round: 0,
          dimensionScores: [
            { dimension: "goal", score: 0.5, rationale: "" },
            { dimension: "constraints", score: 0.5, rationale: "" },
            { dimension: "criteria", score: 0.5, rationale: "" },
            { dimension: "context", score: 0.5, rationale: "" }
          ],
          ambiguity: 0.5,
          targetedDimension: "goal",
          question: "x"
        }
      ]
    };
    expect(() => assertFlowStateV82(bad)).toThrow();
  });
});

describe("v8.78 — architect + start-command surfaces declare per-dimension scoring", () => {
  it("architect prompt declares the 4 dimensions, the ambiguity formula, the exit threshold, and the round-5 challenge cap", () => {
    expect(ARCHITECT_PROMPT).toMatch(/\bgoal\b/i);
    expect(ARCHITECT_PROMPT).toMatch(/\bconstraints?\b/i);
    expect(ARCHITECT_PROMPT).toMatch(/\bcriteria\b/i);
    expect(ARCHITECT_PROMPT).toMatch(/\bcontext\b/i);
    expect(ARCHITECT_PROMPT).toMatch(
      /goal\s*\*\s*0\.4\s*\+\s*constraints\s*\*\s*0\.3\s*\+\s*criteria\s*\*\s*0\.3\s*\+\s*context\s*\*\s*0\.0/
    );
    expect(ARCHITECT_PROMPT).toMatch(/ambiguity\s*<\s*0\.25/);
    expect(ARCHITECT_PROMPT).toMatch(/weakest\s+dimension/i);
    expect(ARCHITECT_PROMPT).toMatch(/Round\s*4\s*[—–-]\s*Contrarian/i);
    expect(ARCHITECT_PROMPT).toMatch(/Round\s*5\s*[—–-]\s*Simplifier/i);
    expect(ARCHITECT_PROMPT).toMatch(/clarifyRounds/);
  });

  it("start-command body declares the same per-dimension scoring in research-mode Phase 1 (8-round cap, /cc research go force-exit)", () => {
    expect(START_COMMAND_BODY).toMatch(/per[- ]dimension scoring/i);
    expect(START_COMMAND_BODY).toMatch(
      /goal\s*\*\s*0\.4\s*\+\s*constraints\s*\*\s*0\.3\s*\+\s*criteria\s*\*\s*0\.3\s*\+\s*context\s*\*\s*0\.0/
    );
    expect(START_COMMAND_BODY).toMatch(/ambiguity\s*<\s*0\.25/);
    expect(START_COMMAND_BODY).toMatch(/8\s+rounds?/i);
    expect(START_COMMAND_BODY).toMatch(/\/cc research go/);
    expect(START_COMMAND_BODY).toMatch(/clarifyRounds/);
    expect(renderStartCommand()).toBe(START_COMMAND_BODY);
  });
});

describe("v8.78 — version + cross-cutting checks", () => {
  it("CHANGELOG.md contains a v8.78 entry naming the per-dimension scoring work", async () => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const { fileURLToPath } = await import("node:url");
    const here = path.dirname(fileURLToPath(import.meta.url));
    const changelog = await fs.readFile(path.join(here, "../../CHANGELOG.md"), "utf8");
    expect(changelog).toMatch(/v8\.78/);
    expect(changelog).toMatch(/per[- ]dimension/i);
    expect(changelog).toMatch(/iterative[- ]clarify/i);
  });
});
