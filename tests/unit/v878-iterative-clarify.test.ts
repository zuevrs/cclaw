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
 * Pins the contract end-to-end so any regression (dropped dimension,
 * broken formula, missing challenge-mode rotation, dropped per-round
 * table, broken type field, broken validator) lights up immediately.
 *
 * Each `describe` block here corresponds to one of the four
 * implementation phases in the v8.78 spec (types / architect / research /
 * version-bump).
 */

describe("v8.78 — ClarifyDimension enum + canonical 4-value vocabulary", () => {
  it("CLARIFY_DIMENSIONS exports exactly four values (goal/constraints/criteria/context)", () => {
    expect([...CLARIFY_DIMENSIONS].sort()).toEqual([
      "constraints",
      "context",
      "criteria",
      "goal"
    ]);
    expect(CLARIFY_DIMENSIONS).toHaveLength(4);
  });

  it("ClarifyDimension type accepts each of the 4 canonical values", () => {
    const dims: ClarifyDimension[] = ["goal", "constraints", "criteria", "context"];
    expect(dims).toHaveLength(4);
  });

  it("CLARIFY_EXIT_AMBIGUITY_THRESHOLD is the math-gated exit threshold (0.25)", () => {
    expect(CLARIFY_EXIT_AMBIGUITY_THRESHOLD).toBe(0.25);
  });

  it("CLARIFY_ARCHITECT_ROUND_CAP is 5 (v8.67 contract preserved)", () => {
    expect(CLARIFY_ARCHITECT_ROUND_CAP).toBe(5);
  });

  it("CLARIFY_RESEARCH_ROUND_CAP is 8 (research has more axes to pin)", () => {
    expect(CLARIFY_RESEARCH_ROUND_CAP).toBe(8);
  });
});

describe("v8.78 — ClarifyDimensionScore + ClarifyRoundState type shape", () => {
  it("ClarifyDimensionScore carries dimension, score (0.0-1.0 float), rationale", () => {
    const s: ClarifyDimensionScore = {
      dimension: "goal",
      score: 0.75,
      rationale: "Goal is mostly clear after the user named the target file"
    };
    expect(s.dimension).toBe("goal");
    expect(s.score).toBe(0.75);
    expect(s.rationale).toContain("clear");
  });

  it("ClarifyRoundState carries round / dimensionScores / ambiguity / targetedDimension / question", () => {
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
    expect(round.round).toBe(1);
    expect(round.dimensionScores).toHaveLength(4);
    expect(round.ambiguity).toBeCloseTo(0.61, 2);
    expect(round.targetedDimension).toBe("criteria");
    expect(round.question.length).toBeGreaterThan(0);
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

describe("v8.78 — architect Phase −1 prompt declares per-dimension scoring", () => {
  it("architect prompt names all 4 dimensions verbatim", () => {
    expect(ARCHITECT_PROMPT).toMatch(/\bgoal\b/i);
    expect(ARCHITECT_PROMPT).toMatch(/\bconstraints?\b/i);
    expect(ARCHITECT_PROMPT).toMatch(/\bcriteria\b/i);
    expect(ARCHITECT_PROMPT).toMatch(/\bcontext\b/i);
  });

  it("architect prompt names the ambiguity formula with the canonical weights", () => {
    expect(ARCHITECT_PROMPT).toMatch(
      /goal\s*\*\s*0\.4\s*\+\s*constraints\s*\*\s*0\.3\s*\+\s*criteria\s*\*\s*0\.3\s*\+\s*context\s*\*\s*0\.0/
    );
    expect(ARCHITECT_PROMPT).toMatch(/ambiguity\s*=\s*1\s*-/i);
  });

  it("architect prompt anchors the math-gated exit threshold (ambiguity < 0.25)", () => {
    expect(ARCHITECT_PROMPT).toMatch(/ambiguity\s*<\s*0\.25/);
  });

  it("architect prompt explicitly targets the weakest dimension on the next question", () => {
    expect(ARCHITECT_PROMPT).toMatch(/weakest\s+dimension/i);
  });

  it("architect prompt surfaces a per-round table to the user", () => {
    expect(ARCHITECT_PROMPT).toMatch(/per[- ]round\s+table/i);
    expect(ARCHITECT_PROMPT).toMatch(/Round\s*<n>/);
    expect(ARCHITECT_PROMPT).toMatch(/Next target:/);
  });

  it("architect prompt declares the challenge-mode rotation (round 4 Contrarian, round 5 Simplifier)", () => {
    expect(ARCHITECT_PROMPT).toMatch(/Round\s*4\s*[—–-]\s*Contrarian/i);
    expect(ARCHITECT_PROMPT).toMatch(/Round\s*5\s*[—–-]\s*Simplifier/i);
    expect(ARCHITECT_PROMPT).toMatch(/what if the opposite/i);
    expect(ARCHITECT_PROMPT).toMatch(/simplest version/i);
  });

  it("architect prompt persists per-round entries to clarifyRounds[]", () => {
    expect(ARCHITECT_PROMPT).toMatch(/clarifyRounds/);
  });

  it("architect prompt preserves the round cap (5 questions)", () => {
    expect(ARCHITECT_PROMPT).toMatch(/(max|maximum|cap)[\s\S]{0,40}5/i);
  });

  it("architect prompt preserves the early-exit signals (go/ready/proceed)", () => {
    expect(ARCHITECT_PROMPT).toMatch(/\bgo\b/);
    expect(ARCHITECT_PROMPT).toMatch(/\bready\b/);
    expect(ARCHITECT_PROMPT).toMatch(/\bproceed\b/);
  });
});

describe("v8.78 — research-mode Phase 1 prompt declares same per-dimension scoring", () => {
  it("start-command body documents per-dimension scoring in research mode Phase 1", () => {
    expect(START_COMMAND_BODY).toMatch(/per[- ]dimension scoring/i);
    expect(START_COMMAND_BODY).toMatch(/\bgoal\b/i);
    expect(START_COMMAND_BODY).toMatch(/\bconstraints?\b/i);
    expect(START_COMMAND_BODY).toMatch(/\bcriteria\b/i);
    expect(START_COMMAND_BODY).toMatch(/\bcontext\b/i);
  });

  it("start-command body names the same ambiguity formula in research mode", () => {
    expect(START_COMMAND_BODY).toMatch(
      /goal\s*\*\s*0\.4\s*\+\s*constraints\s*\*\s*0\.3\s*\+\s*criteria\s*\*\s*0\.3\s*\+\s*context\s*\*\s*0\.0/
    );
  });

  it("start-command body names the same math-gated exit (ambiguity < 0.25) in research mode", () => {
    expect(START_COMMAND_BODY).toMatch(/ambiguity\s*<\s*0\.25/);
  });

  it("start-command body names the higher research round cap (8) distinct from architect (5)", () => {
    expect(START_COMMAND_BODY).toMatch(/8\s+rounds?/i);
  });

  it("start-command body declares the same challenge-mode rotation (round 4 Contrarian, round 5 Simplifier)", () => {
    expect(START_COMMAND_BODY).toMatch(/Round\s*4\s*[—–-]\s*Contrarian/i);
    expect(START_COMMAND_BODY).toMatch(/Round\s*5\s*[—–-]\s*Simplifier/i);
  });

  it("start-command body surfaces a per-round table in research mode", () => {
    expect(START_COMMAND_BODY).toMatch(/Round\s*<n>/);
    expect(START_COMMAND_BODY).toMatch(/Next target:/);
  });

  it("start-command body documents the /cc research go force-exit sub-command", () => {
    expect(START_COMMAND_BODY).toMatch(/\/cc research go/);
  });

  it("start-command body persists per-round entries to the shared clarifyRounds[] field", () => {
    expect(START_COMMAND_BODY).toMatch(/clarifyRounds/);
  });

  it("renderStartCommand stays identical to the exported body string", () => {
    expect(renderStartCommand()).toBe(START_COMMAND_BODY);
  });
});

describe("v8.78 — version + cross-cutting checks", () => {
  it("CHANGELOG.md contains a v8.78 entry naming the per-dimension scoring", async () => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const { fileURLToPath } = await import("node:url");
    const here = path.dirname(fileURLToPath(import.meta.url));
    const changelog = await fs.readFile(path.join(here, "../../CHANGELOG.md"), "utf8");
    expect(changelog).toMatch(/v8\.78/);
    expect(changelog).toMatch(/per[- ]dimension/i);
    expect(changelog).toMatch(/iterative[- ]clarify/i);
  });

  it("package.json version is 8.78.x or later (forward-compat with future patch / minor bumps)", async () => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const { fileURLToPath } = await import("node:url");
    const here = path.dirname(fileURLToPath(import.meta.url));
    const pkg = JSON.parse(
      await fs.readFile(path.join(here, "../../package.json"), "utf8")
    );
    const parts = String(pkg.version).split(".");
    expect(parts).toHaveLength(3);
    const major = Number(parts[0]);
    const minor = Number(parts[1]);
    expect(major).toBe(8);
    expect(minor).toBeGreaterThanOrEqual(78);
  });
});
