import { describe, expect, it } from "vitest";

import {
  BUILDER_PROMPT,
  INVESTIGATOR_PROMPT
} from "../../src/content/specialist-prompts/index.js";
import { START_COMMAND_BODY } from "../../src/content/start-command.js";
import {
  FLOW_STATE_SCHEMA_VERSION,
  assertFlowStateV82,
  createInitialFlowState
} from "../../src/flow-state.js";
import type { BuilderEnvelope } from "../../src/types.js";

/**
 * v8.81 — Investigator v2: assumption audit + defense-in-depth + post-mortem.
 *
 * Slimmed in v8.99 test-slim-down A2 to one WIRING + one BEHAVIOR +
 * one SECTION CONTRACT test. The defense-in-depth envelope propagation
 * (v8.85.1 fix) is kept as the BEHAVIOR test — it's the only end-to-end
 * runtime wiring; the rest of the v8.81 tripwires were prompt-grep coverage.
 */

describe("v8.81 — investigator v2 wiring (BuilderEnvelope type + flow-state validator + start-command propagation)", () => {
  it("WIRING — BuilderEnvelope accepts `defenseInDepth: 'yes' | 'no'` (compile-time witness), assertFlowStateV82 accepts both values + absent + empty envelope but rejects bogus values, and start-command body names builderEnvelope.defenseInDepth + the back-compat default", () => {
    const yes: BuilderEnvelope = { defenseInDepth: "yes" };
    const no: BuilderEnvelope = { defenseInDepth: "no" };
    const absent: BuilderEnvelope = {};
    expect(yes.defenseInDepth).toBe("yes");
    expect(no.defenseInDepth).toBe("no");
    expect(absent.defenseInDepth).toBeUndefined();

    const state = createInitialFlowState("2026-05-18T00:00:00Z");
    expect(() => assertFlowStateV82(state)).not.toThrow();
    expect(() => assertFlowStateV82({ ...state, builderEnvelope: {} })).not.toThrow();
    expect(() =>
      assertFlowStateV82({ ...state, builderEnvelope: { defenseInDepth: "yes" as const } })
    ).not.toThrow();
    expect(() =>
      assertFlowStateV82({ ...state, builderEnvelope: { defenseInDepth: "no" as const } })
    ).not.toThrow();
    expect(() => assertFlowStateV82({ ...state, builderEnvelope: { defenseInDepth: "maybe" } })).toThrow(
      /builderEnvelope\.defenseInDepth/
    );
    expect(() => assertFlowStateV82({ ...state, builderEnvelope: "yes" })).toThrow(/builderEnvelope/);
    expect(() => assertFlowStateV82({ ...state, builderEnvelope: null })).toThrow(/builderEnvelope/);
    expect(FLOW_STATE_SCHEMA_VERSION).toBe(3);

    expect(START_COMMAND_BODY).toMatch(/builderEnvelope\.defenseInDepth/);
    expect(START_COMMAND_BODY).toMatch(/defense-in-depth/);
    const idx = START_COMMAND_BODY.indexOf("Defense-in-depth envelope propagation");
    expect(idx).toBeGreaterThan(0);
    const section = START_COMMAND_BODY.slice(idx, idx + 4000);
    expect(section).toMatch(/pre-v8\.81/);
    expect(section).toMatch(/default(s)? to (`?no`?|absent)/i);
  });
});

describe("v8.81 — investigator v2 behavior (envelope propagation from investigator → orchestrator → builder)", () => {
  it("BEHAVIOR — orchestrator copies the `Defense-in-depth: yes` slim-summary line onto builderEnvelope.defenseInDepth, and the builder prompt declares the read-then-implement protocol against `## Defense-in-depth (4 layers)` (all named layers shipped in the root-cause fix commit, NOT a follow-up)", () => {
    expect(START_COMMAND_BODY).toMatch(/Defense-in-depth:\s*<?\s*yes/i);
    expect(START_COMMAND_BODY).toMatch(/slim[-\s]summary/i);
    expect(START_COMMAND_BODY).toMatch(
      /(copies?|copy|stamp(s|ed)?|reads?) .*(Defense-in-depth|defense-in-depth|builderEnvelope)/i
    );

    expect(BUILDER_PROMPT).toMatch(/defense-in-depth/);
    expect(BUILDER_PROMPT).toMatch(/## Defense-in-depth \(4 layers\)/);
    expect(BUILDER_PROMPT).toMatch(/read[-\s].*investigation\.md|reads? .*investigation\.md/i);
    expect(BUILDER_PROMPT).toMatch(/all (named )?\(?non-n\/a\)? layers|every (named )?\(?non-n\/a\)? layer/i);
    expect(BUILDER_PROMPT).toMatch(/root-cause fix commit/i);
    expect(BUILDER_PROMPT).toMatch(/NOT as a follow-up|not a follow-up|part of (the )?root-cause fix/i);
  });
});

describe("v8.81 — investigator v2 section contract (Phase 0.5 audit + Phase 4 defense-in-depth + Phase 5 post-mortem)", () => {
  it("SECTION CONTRACT — investigator prompt declares the three v8.81 phases in canonical order (audit before lanes, defense-in-depth conditional on ≥3 files OR catastrophic-if-prod, post-mortem conditional on prod keywords), all four defense-in-depth layers, all four post-mortem questions, and preserves the v8.77 three-lane + four-verdict + slim-summary contract", () => {
    const auditIdx = INVESTIGATOR_PROMPT.indexOf("Phase 0.5 — Assumption audit");
    const phase1Idx = INVESTIGATOR_PROMPT.indexOf("Phase 1 — Hypothesis lane fan-out");
    expect(auditIdx).toBeGreaterThan(0);
    expect(phase1Idx).toBeGreaterThan(0);
    expect(auditIdx).toBeLessThan(phase1Idx);
    const auditSection = INVESTIGATOR_PROMPT.slice(auditIdx, auditIdx + 6000);
    expect(auditSection).toMatch(/`verified`/);
    expect(auditSection).toMatch(/`assumed`/);
    expect(auditSection).toMatch(/probe command|one-line probe|Probe/);
    expect(auditSection).toMatch(/short-circuit/i);
    expect(auditSection).toMatch(/not-a-bug/);

    const phase4Idx = INVESTIGATOR_PROMPT.indexOf("Phase 4 — Defense-in-depth tier");
    expect(phase4Idx).toBeGreaterThan(0);
    const phase4 = INVESTIGATOR_PROMPT.slice(phase4Idx, phase4Idx + 8000);
    expect(phase4).toMatch(/CONDITIONAL|conditional/);
    expect(phase4).toMatch(/≥3 OTHER files|≥3 other files|3\+? other files|3\+? OTHER files/);
    expect(phase4).toMatch(/[Cc]atastrophic-if-prod/);
    expect(phase4).toMatch(/either|OR/);
    expect(phase4).toMatch(/Layer 1 — Entry validation/);
    expect(phase4).toMatch(/Layer 2 — Invariant check/);
    expect(phase4).toMatch(/Layer 3 — Environment guard/);
    expect(phase4).toMatch(/Layer 4 — Diagnostic breadcrumb/);
    expect(INVESTIGATOR_PROMPT).toMatch(/## Defense-in-depth \(4 layers\)/);

    const phase5Idx = INVESTIGATOR_PROMPT.indexOf("Phase 5 — Post-mortem");
    expect(phase5Idx).toBeGreaterThan(0);
    const phase5 = INVESTIGATOR_PROMPT.slice(phase5Idx, phase5Idx + 8000);
    expect(phase5).toMatch(/CONDITIONAL|conditional/);
    expect(phase5).toMatch(/advisory/i);
    for (const keyword of ["production", "live", "users reported", "incident"]) {
      expect(phase5).toContain(keyword);
    }
    expect(phase5).toMatch(/How was this introduced\?/);
    expect(phase5).toMatch(/How did this survive review\?/);
    expect(phase5).toMatch(/What review axis would have caught it\?/);
    expect(phase5).toMatch(/Prevent-recurrence/);

    for (const lane of ["cause-code", "cause-config", "cause-measurement"]) {
      expect(INVESTIGATOR_PROMPT).toContain(lane);
    }
    for (const verdict of ["direct-fix", "needs-plan", "more-investigation", "not-a-bug"]) {
      expect(INVESTIGATOR_PROMPT).toContain(verdict);
    }
    const slimIdx = INVESTIGATOR_PROMPT.indexOf("Output — slim summary");
    const slim = INVESTIGATOR_PROMPT.slice(slimIdx, slimIdx + 4000);
    for (const field of ["Stage:", "Artifact:", "Lanes:", "Root cause:", "Next step:", "Iteration:", "Confidence:"]) {
      expect(slim).toContain(field);
    }
    expect(slim).toMatch(/Defense-in-depth:\s*<yes\s*\|\s*no>/);
  });
});
