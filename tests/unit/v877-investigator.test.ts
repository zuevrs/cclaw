import { describe, expect, it } from "vitest";

import {
  ARCHITECT_PROMPT,
  BUILDER_PROMPT,
  INVESTIGATOR_PROMPT,
  SPECIALIST_PROMPTS,
  TRIAGE_PROMPT
} from "../../src/content/specialist-prompts/index.js";
import { CORE_AGENTS, SPECIALIST_AGENTS } from "../../src/content/core-agents.js";
import { ARTIFACT_TEMPLATES } from "../../src/content/artifact-templates.js";
import { AUTO_TRIGGER_SKILLS } from "../../src/content/skills.js";
import {
  ON_DEMAND_RUNBOOKS,
  ON_DEMAND_RUNBOOKS_INDEX_SECTION
} from "../../src/content/runbooks-on-demand.js";
import { START_COMMAND_BODY } from "../../src/content/start-command.js";
import {
  DEFAULT_TASK_SHAPE,
  INVESTIGATOR_LANES,
  INVESTIGATOR_NEXT_STEPS,
  SPECIALISTS,
  TASK_SHAPES,
  type TaskShape
} from "../../src/types.js";
import { FLOW_STATE_SCHEMA_VERSION, assertFlowStateV82 } from "../../src/flow-state.js";

/**
 * v8.77 — Investigator (debug-branch). Slimmed in v8.99 test-slim-down A2
 * to one WIRING + one BEHAVIOR + one SECTION CONTRACT test, keeping the
 * orthogonality + skill-wiring tripwires that catch regressions the
 * prompt-grep tests duplicated.
 */

describe("v8.77 — investigator wiring", () => {
  it("WIRING — SPECIALISTS roster registers `investigator` at index 1 (between triage and architect), SPECIALIST_AGENTS exposes it as an on-demand specialist, and the investigation-discipline skill auto-triggers on it", () => {
    expect([...SPECIALISTS]).toEqual([
      "triage",
      "investigator",
      "architect",
      "builder",
      "plan-critic",
      "qa-runner",
      "reviewer",
      "critic"
    ]);
    expect(SPECIALISTS).toHaveLength(8);
    const agent = SPECIALIST_AGENTS.find((a) => a.id === "investigator");
    expect(agent).toBeDefined();
    expect(agent?.kind).toBe("specialist");
    expect(agent?.activation).toBe("on-demand");
    expect(agent?.prompt).toBe(INVESTIGATOR_PROMPT);
    expect(SPECIALIST_PROMPTS["investigator"]).toBe(INVESTIGATOR_PROMPT);
    expect(CORE_AGENTS.filter((a) => a.kind === "specialist")).toHaveLength(8);

    const skill = AUTO_TRIGGER_SKILLS.find((s) => s.id === "investigation-discipline");
    expect(skill).toBeDefined();
    expect(skill?.triggers).toContain("specialist:investigator");
    expect(skill?.triggers).toContain("taskShape:debug");
    expect(skill?.body).toContain("cause-code");
    expect(skill?.body).toContain("cause-config");
    expect(skill?.body).toContain("cause-measurement");
  });
});

describe("v8.77 — investigator behavior (end-to-end debug-branch routing)", () => {
  it("BEHAVIOR — flow-state validator accepts taskShape on triage, start-command routes debug-shape → investigator → verdict matrix, and the debug-branch runbook + investigation template carry the four verdicts", () => {
    expect([...TASK_SHAPES]).toEqual(["build", "debug", "research"]);
    expect(DEFAULT_TASK_SHAPE).toBe("build");

    const baseState = {
      schemaVersion: FLOW_STATE_SCHEMA_VERSION,
      currentSlug: "20260517-debug-test",
      currentStage: "plan" as const,
      ac: [],
      lastSpecialist: null,
      startedAt: "2026-05-17T12:00:00Z",
      triage: {
        complexity: "small-medium" as const,
        ceremonyMode: "soft" as const,
        path: ["plan", "build", "review", "critic", "ship"] as const,
        mode: "task" as const,
        rationale: "debug task — bug shape",
        decidedAt: "2026-05-17T12:00:00Z",
        taskShape: "debug" as const
      },
      reviewIterations: 0,
      securityFlag: false
    };
    expect(() => assertFlowStateV82(baseState)).not.toThrow();
    expect(() => assertFlowStateV82({ ...baseState, triage: { ...baseState.triage, taskShape: "build" } })).not.toThrow();
    expect(() =>
      assertFlowStateV82({ ...baseState, triage: { ...baseState.triage, taskShape: "invalid-shape" as TaskShape } })
    ).toThrow(/Invalid triage\.taskShape/);

    expect(START_COMMAND_BODY).toMatch(/## Debug-branch routing/);
    expect(START_COMMAND_BODY).toContain("debug-branch.md");
    expect(START_COMMAND_BODY).toMatch(/priorInvestigation/);
    for (const verdict of INVESTIGATOR_NEXT_STEPS) {
      expect(START_COMMAND_BODY).toContain(verdict);
    }

    const runbook = ON_DEMAND_RUNBOOKS.find((r) => r.fileName === "debug-branch.md");
    expect(runbook).toBeDefined();
    expect(ON_DEMAND_RUNBOOKS_INDEX_SECTION).toContain("debug-branch.md");
    for (const verdict of INVESTIGATOR_NEXT_STEPS) {
      expect(runbook?.body).toContain(verdict);
    }
    expect(runbook?.body).toMatch(/priorInvestigation/);

    const investigationTemplate = ARTIFACT_TEMPLATES.find((t) => t.id === "investigation");
    expect(investigationTemplate?.fileName).toBe("investigation.md");
    expect(investigationTemplate?.body).toMatch(/task_shape:\s*debug/);

    // priorInvestigation propagation downstream into architect + builder
    expect(ARCHITECT_PROMPT).toMatch(/priorInvestigation|prior-investigation linkage/);
    expect(BUILDER_PROMPT).toMatch(/Debug-branch direct-fix|direct-fix flow|direct-fix mode/i);
    expect(BUILDER_PROMPT).toContain("investigation-discipline.md");
  });
});

describe("v8.77 — investigator prompt canonical section contract", () => {
  it("SECTION CONTRACT — investigator prompt declares the 3-lane MECE roster, read-only contract, all four next-steps, `## Composition` footer, and the seven-field slim summary", () => {
    expect([...INVESTIGATOR_LANES]).toEqual(["cause-code", "cause-config", "cause-measurement"]);
    for (const lane of INVESTIGATOR_LANES) {
      expect(INVESTIGATOR_PROMPT).toContain(lane);
    }
    expect(INVESTIGATOR_PROMPT).toMatch(/PARALLEL|parallel/);
    expect(INVESTIGATOR_PROMPT).toMatch(/read-only/i);
    for (const value of INVESTIGATOR_NEXT_STEPS) {
      expect(INVESTIGATOR_PROMPT).toContain(value);
    }
    expect(INVESTIGATOR_PROMPT).toMatch(/##\s+Composition/u);
    expect(INVESTIGATOR_PROMPT).toContain("on-demand specialist");
    expect(INVESTIGATOR_PROMPT).toContain("Do not spawn");

    const slimIdx = INVESTIGATOR_PROMPT.indexOf("Output — slim summary");
    expect(slimIdx).toBeGreaterThan(0);
    const after = INVESTIGATOR_PROMPT.slice(slimIdx, slimIdx + 4000);
    for (const field of ["Stage:", "Artifact:", "Lanes:", "Root cause:", "Next step:", "Iteration:", "Confidence:"]) {
      expect(after).toContain(field);
    }

    // triage detection orthogonal to complexity (anti-entanglement tripwire)
    expect(TRIAGE_PROMPT).toMatch(/task[\s_-]?shape/i);
    expect(TRIAGE_PROMPT).toMatch(/orthogonal|independent/i);
  });
});
