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
  type InvestigatorLaneId,
  type InvestigatorNextStep,
  type TaskShape
} from "../../src/types.js";
import { FLOW_STATE_SCHEMA_VERSION, assertFlowStateV82 } from "../../src/flow-state.js";

/**
 * v8.77 — Investigator (debug-branch).
 *
 * Triage gains a `taskShape: "build" | "debug" | "research"` field. On
 * `taskShape == "debug"` the orchestrator inserts a new investigator
 * specialist BEFORE the architect — read-only, three parallel hypothesis
 * lanes (cause-code / cause-config / cause-measurement), produces an
 * investigation.md with per-lane evidence + working root-cause hypothesis
 * + a next-step recommendation (direct-fix / needs-plan / more-
 * investigation / not-a-bug). On `direct-fix` the orchestrator skips the
 * architect entirely and dispatches the builder with
 * `priorInvestigation` on the envelope (builder reads investigation.md
 * as plan-substitute and writes RED-before-GREEN against the cited
 * symptom). On `needs-plan` the architect's Frame phase copies the cited
 * root cause verbatim instead of re-deriving it. SPECIALISTS grows 8 → 9.
 *
 * Tripwires below pin the v8.77 invariants so a future change that
 * drops the lane discipline, silently un-wires the priorInvestigation
 * propagation, or loses the orthogonality between taskShape and
 * complexity lights up immediately.
 */

describe("v8.77 — SPECIALISTS roster includes `investigator` (9 entries; investigator between triage and architect)", () => {
  it("AC-1 — SPECIALISTS has exactly nine entries (v8.77 added investigator)", () => {
    expect(SPECIALISTS).toHaveLength(9);
  });

  it("AC-1 — `investigator` is the 2nd entry, immediately after `triage` and before `architect`", () => {
    expect([...SPECIALISTS]).toEqual([
      "triage",
      "investigator",
      "architect",
      "builder",
      "plan-critic",
      "plan-design",
      "qa-runner",
      "reviewer",
      "critic"
    ]);
    const triageIdx = (SPECIALISTS as readonly string[]).indexOf("triage");
    const investigatorIdx = (SPECIALISTS as readonly string[]).indexOf("investigator");
    const architectIdx = (SPECIALISTS as readonly string[]).indexOf("architect");
    expect(investigatorIdx).toBe(triageIdx + 1);
    expect(architectIdx).toBe(investigatorIdx + 1);
  });

  it("AC-1 — SPECIALIST_PROMPTS exports a non-empty `investigator` prompt", () => {
    expect(typeof SPECIALIST_PROMPTS["investigator"]).toBe("string");
    expect(SPECIALIST_PROMPTS["investigator"].length).toBeGreaterThan(2000);
    expect(SPECIALIST_PROMPTS["investigator"]).toBe(INVESTIGATOR_PROMPT);
  });

  it("AC-1 — SPECIALIST_AGENTS registers `investigator` with on-demand activation + specialist kind", () => {
    const agent = SPECIALIST_AGENTS.find((a) => a.id === "investigator");
    expect(agent).toBeDefined();
    expect(agent?.kind).toBe("specialist");
    expect(agent?.activation).toBe("on-demand");
    expect(agent?.title.toLowerCase()).toContain("investigator");
    expect(agent?.prompt).toBe(INVESTIGATOR_PROMPT);
  });

  it("AC-1 — CORE_AGENTS has 11 entries (9 specialists + 2 research helpers)", () => {
    const specialists = CORE_AGENTS.filter((a) => a.kind === "specialist");
    const research = CORE_AGENTS.filter((a) => a.kind === "research");
    expect(specialists).toHaveLength(9);
    expect(research).toHaveLength(2);
    expect(CORE_AGENTS).toHaveLength(11);
  });
});

describe("v8.77 — TASK_SHAPES enum + DEFAULT_TASK_SHAPE", () => {
  it("AC-2 — TASK_SHAPES contains exactly three values: build / debug / research", () => {
    expect([...TASK_SHAPES]).toEqual(["build", "debug", "research"]);
    expect(TASK_SHAPES).toHaveLength(3);
  });

  it("AC-2 — DEFAULT_TASK_SHAPE is `build` (pre-v8.77 behaviour preserved on absent field)", () => {
    expect(DEFAULT_TASK_SHAPE).toBe("build");
    const allowed: readonly TaskShape[] = TASK_SHAPES;
    expect(allowed).toContain(DEFAULT_TASK_SHAPE);
  });
});

describe("v8.77 — INVESTIGATOR_LANES is the canonical 3-lane MECE roster", () => {
  it("AC-3 — INVESTIGATOR_LANES has exactly three lanes in canonical order (cause-code / cause-config / cause-measurement)", () => {
    expect([...INVESTIGATOR_LANES]).toEqual([
      "cause-code",
      "cause-config",
      "cause-measurement"
    ]);
    expect(INVESTIGATOR_LANES).toHaveLength(3);
  });

  it("AC-3 — every lane id is a valid InvestigatorLaneId at the type level", () => {
    for (const lane of INVESTIGATOR_LANES) {
      const typed: InvestigatorLaneId = lane;
      expect(typed).toBe(lane);
    }
  });
});

describe("v8.77 — INVESTIGATOR_NEXT_STEPS is exactly four values", () => {
  it("AC-4 — INVESTIGATOR_NEXT_STEPS contains exactly the four canonical verdicts", () => {
    expect([...INVESTIGATOR_NEXT_STEPS]).toEqual([
      "direct-fix",
      "needs-plan",
      "more-investigation",
      "not-a-bug"
    ]);
    expect(INVESTIGATOR_NEXT_STEPS).toHaveLength(4);
  });

  it("AC-4 — every verdict is a valid InvestigatorNextStep at the type level", () => {
    for (const verdict of INVESTIGATOR_NEXT_STEPS) {
      const typed: InvestigatorNextStep = verdict;
      expect(typed).toBe(verdict);
    }
  });
});

describe("v8.77 — Investigator prompt declares 3-lane fan-out + read-only contract", () => {
  it("AC-5 — investigator prompt names the three canonical lanes (cause-code / cause-config / cause-measurement) verbatim", () => {
    for (const lane of INVESTIGATOR_LANES) {
      expect(INVESTIGATOR_PROMPT).toContain(lane);
    }
  });

  it("AC-5 — investigator prompt requires PARALLEL fan-out (not sequential)", () => {
    expect(INVESTIGATOR_PROMPT).toMatch(/PARALLEL|parallel/);
    expect(INVESTIGATOR_PROMPT).toMatch(/three\s+(parallel\s+)?hypothesis\s+lanes/i);
    expect(INVESTIGATOR_PROMPT).toMatch(/same tool-call batch|single tool-call batch|fan out three/i);
  });

  it("AC-5 — investigator prompt is read-only (no code edits / no plan / no commits)", () => {
    expect(INVESTIGATOR_PROMPT).toMatch(/read-only/i);
    expect(INVESTIGATOR_PROMPT).toMatch(/no code edits|no edit|no .* writ/i);
  });

  it("AC-5 — investigator prompt names all four next-step values verbatim", () => {
    for (const value of INVESTIGATOR_NEXT_STEPS) {
      expect(INVESTIGATOR_PROMPT).toContain(value);
    }
  });

  it("AC-5 — investigator prompt names the v8.77 debug-branch gate (triage.taskShape == \"debug\")", () => {
    expect(INVESTIGATOR_PROMPT).toMatch(/triage\.taskShape\s*==\s*"debug"|taskShape:debug|task_shape:debug/);
  });

  it("AC-5 — investigator prompt declares ## Composition + forbids nested orchestration (sub-agent contract)", () => {
    expect(INVESTIGATOR_PROMPT).toMatch(/##\s+Composition/u);
    expect(INVESTIGATOR_PROMPT).toContain("on-demand specialist");
    expect(INVESTIGATOR_PROMPT).toContain("Do not spawn");
    expect(INVESTIGATOR_PROMPT).toMatch(/Stop condition/u);
  });

  it("AC-5 — investigator prompt declares its iteration cap (max 1 re-dispatch per slug)", () => {
    expect(INVESTIGATOR_PROMPT).toMatch(/iteration.*1|cap|2 investigator dispatches/i);
  });

  it("AC-5 — investigator slim summary declares all seven required lines plus optional Notes", () => {
    const slimIdx = INVESTIGATOR_PROMPT.indexOf("Output — slim summary");
    expect(slimIdx).toBeGreaterThan(0);
    const after = INVESTIGATOR_PROMPT.slice(slimIdx, slimIdx + 4000);
    for (const field of [
      "Stage:",
      "Artifact:",
      "Lanes:",
      "Root cause:",
      "Next step:",
      "Iteration:",
      "Confidence:"
    ]) {
      expect(after).toContain(field);
    }
  });
});

describe("v8.77 — investigation.md artifact template carries the three lanes + synthesis + verdict", () => {
  const investigationTemplate = ARTIFACT_TEMPLATES.find((t) => t.id === "investigation");

  it("AC-6 — investigation template is registered as 'investigation' id", () => {
    expect(investigationTemplate, "investigation template missing from ARTIFACT_TEMPLATES").toBeTruthy();
    expect(investigationTemplate?.fileName).toBe("investigation.md");
  });

  it("AC-6 — investigation template body covers all three lanes (### Lane: cause-code / cause-config / cause-measurement)", () => {
    expect(investigationTemplate?.body).toMatch(/### Lane: cause-code/);
    expect(investigationTemplate?.body).toMatch(/### Lane: cause-config/);
    expect(investigationTemplate?.body).toMatch(/### Lane: cause-measurement/);
  });

  it("AC-6 — investigation template body carries the synthesis + next-step + convergence sections", () => {
    expect(investigationTemplate?.body).toMatch(/## Root cause \(working hypothesis\)/);
    expect(investigationTemplate?.body).toMatch(/## Next step recommendation/);
    expect(investigationTemplate?.body).toMatch(/## Convergence/);
  });

  it("AC-6 — investigation template carries the conditional ## Fix scope section (direct-fix verdict only)", () => {
    expect(investigationTemplate?.body).toMatch(/## Fix scope/);
  });

  it("AC-6 — investigation template frontmatter carries verdict + confidence + task_shape fields", () => {
    expect(investigationTemplate?.body).toMatch(/verdict:/);
    expect(investigationTemplate?.body).toMatch(/confidence:/);
    expect(investigationTemplate?.body).toMatch(/task_shape:\s*debug/);
    expect(investigationTemplate?.body).toMatch(/specialist:\s*investigator/);
  });

  it("AC-6 — investigation template lists all four canonical verdict values inline", () => {
    for (const verdict of INVESTIGATOR_NEXT_STEPS) {
      expect(investigationTemplate?.body).toContain(verdict);
    }
  });
});

describe("v8.77 — Triage prompt detects task shape (build / debug / research)", () => {
  it("AC-7 — triage prompt names task_shape / taskShape detection rule", () => {
    expect(TRIAGE_PROMPT).toMatch(/task[\s_-]?shape/i);
  });

  it("AC-7 — triage prompt names the AND gate (bug keyword AND repo-anchored evidence)", () => {
    for (const keyword of ["regression", "error", "broken", "failing", "crash", "slow"]) {
      expect(TRIAGE_PROMPT).toContain(keyword);
    }
    for (const evidence of ["file:line", "commit SHA", "log excerpt", "stack trace"]) {
      expect(TRIAGE_PROMPT).toContain(evidence);
    }
  });

  it("AC-7 — triage prompt declares taskShape orthogonal to complexity (do not entangle)", () => {
    expect(TRIAGE_PROMPT).toMatch(/orthogonal|independent/i);
    expect(TRIAGE_PROMPT).toMatch(/complexity/);
  });

  it("AC-7 — triage prompt slim summary carries the `Task shape:` line", () => {
    expect(TRIAGE_PROMPT).toMatch(/Task shape:\s*<build\s*\|\s*debug>/);
  });

  it("AC-7 — triage prompt lists at least 3 worked debug examples", () => {
    const debugExamples = (TRIAGE_PROMPT.match(/task_shape:\s*debug/g) ?? []).length;
    expect(debugExamples).toBeGreaterThanOrEqual(3);
  });
});

describe("v8.77 — flow-state validator accepts taskShape on triage block", () => {
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
      runMode: "auto" as const,
      mode: "task" as const,
      rationale: "debug task — bug shape",
      decidedAt: "2026-05-17T12:00:00Z",
      taskShape: "debug" as const
    },
    reviewIterations: 0,
    securityFlag: false
  };

  it("AC-8 — flow-state validator accepts taskShape: \"debug\"", () => {
    expect(() => assertFlowStateV82(baseState)).not.toThrow();
  });

  it("AC-8 — flow-state validator accepts taskShape: \"build\"", () => {
    expect(() =>
      assertFlowStateV82({ ...baseState, triage: { ...baseState.triage, taskShape: "build" } })
    ).not.toThrow();
  });

  it("AC-8 — flow-state validator accepts taskShape: \"research\"", () => {
    expect(() =>
      assertFlowStateV82({ ...baseState, triage: { ...baseState.triage, taskShape: "research" } })
    ).not.toThrow();
  });

  it("AC-8 — flow-state validator accepts absent taskShape (pre-v8.77 back-compat)", () => {
    const { taskShape, ...triageWithoutShape } = baseState.triage;
    expect(() =>
      assertFlowStateV82({ ...baseState, triage: triageWithoutShape })
    ).not.toThrow();
  });

  it("AC-8 — flow-state validator rejects invalid taskShape value", () => {
    expect(() =>
      assertFlowStateV82({
        ...baseState,
        triage: { ...baseState.triage, taskShape: "invalid-shape" as TaskShape }
      })
    ).toThrow(/Invalid triage\.taskShape/);
  });
});

describe("v8.77 — Architect prompt accepts priorInvestigation envelope field (debug-branch context)", () => {
  it("AC-9 — architect Bootstrap names the v8.77 prior-investigation linkage", () => {
    expect(ARCHITECT_PROMPT).toMatch(/prior-investigation linkage|priorInvestigation/);
    expect(ARCHITECT_PROMPT).toMatch(/investigation\.md/);
  });

  it("AC-9 — architect prompt names the v8.77 debug-branch Frame flavour", () => {
    expect(ARCHITECT_PROMPT).toMatch(/debug-branch|debug branch/i);
    expect(ARCHITECT_PROMPT).toMatch(/root cause|root-cause/i);
    expect(ARCHITECT_PROMPT).toMatch(/VERBATIM|verbatim/);
  });

  it("AC-9 — architect prompt cites investigation.md path in the Bootstrap envelope read step", () => {
    expect(ARCHITECT_PROMPT).toMatch(/priorInvestigation\.path|flows\/<slug>\/investigation\.md/);
  });
});

describe("v8.77 — Builder prompt accepts priorInvestigation envelope field (direct-fix path)", () => {
  it("AC-10 — builder prompt names the v8.77 direct-fix mode + investigation as plan-substitute", () => {
    expect(BUILDER_PROMPT).toMatch(/Debug-branch direct-fix|direct-fix flow|direct-fix mode/i);
    expect(BUILDER_PROMPT).toMatch(/investigation\.md/);
    expect(BUILDER_PROMPT).toMatch(/plan-substitute|plan substitute/i);
  });

  it("AC-10 — builder prompt names the `fix(<scope>):` commit prefix convention on direct-fix", () => {
    expect(BUILDER_PROMPT).toMatch(/fix\(<scope>\):|fix\(<.*>\):/);
  });

  it("AC-10 — builder prompt cites ## Fix scope as the bounds gate", () => {
    expect(BUILDER_PROMPT).toMatch(/## Fix scope/);
  });

  it("AC-10 — builder prompt preserves RED-before-GREEN on the direct-fix path", () => {
    const directFixIdx = BUILDER_PROMPT.indexOf("Debug-branch direct-fix");
    expect(directFixIdx).toBeGreaterThan(0);
    const section = BUILDER_PROMPT.slice(directFixIdx, directFixIdx + 5000);
    expect(section).toMatch(/RED/);
    expect(section).toMatch(/GREEN/);
  });

  it("AC-10 — builder prompt references investigation-discipline.md skill", () => {
    expect(BUILDER_PROMPT).toContain("investigation-discipline.md");
  });
});

describe("v8.77 — Orchestrator routes debug-shape → investigator → verdict matrix", () => {
  it("AC-11 — start-command body has a Debug-branch routing section", () => {
    expect(START_COMMAND_BODY).toMatch(/## Debug-branch routing/);
  });

  it("AC-11 — start-command body lists all four verdict values in the routing matrix", () => {
    const debugIdx = START_COMMAND_BODY.indexOf("## Debug-branch routing");
    expect(debugIdx).toBeGreaterThan(0);
    const section = START_COMMAND_BODY.slice(debugIdx, debugIdx + 4000);
    for (const verdict of INVESTIGATOR_NEXT_STEPS) {
      expect(section).toContain(verdict);
    }
  });

  it("AC-11 — start-command body names the investigator stage-table row gated on taskShape=debug", () => {
    expect(START_COMMAND_BODY).toMatch(/`investigator`.*taskShape\s*==\s*"debug"|investigator.*debug-branch/);
  });

  it("AC-11 — start-command body includes a #### investigator stage-details section", () => {
    expect(START_COMMAND_BODY).toMatch(/#### investigator/);
  });

  it("AC-11 — start-command body documents the priorInvestigation envelope propagation", () => {
    expect(START_COMMAND_BODY).toMatch(/priorInvestigation/);
  });

  it("AC-11 — start-command body declares the investigator iteration cap (2 dispatches per slug)", () => {
    expect(START_COMMAND_BODY).toMatch(/2 dispatches per slug|iteration cap|cap.*1/i);
  });

  it("AC-11 — start-command body declares the v8.77 wiring is additive (back-compat with pre-v8.77 state files)", () => {
    expect(START_COMMAND_BODY).toMatch(/additive|back-compat|legacy|pre-v8\.77/i);
  });

  it("AC-11 — start-command body points at runbooks/debug-branch.md for the full routing procedure", () => {
    expect(START_COMMAND_BODY).toContain("debug-branch.md");
  });
});

describe("v8.77 — runbooks/debug-branch.md ships in ON_DEMAND_RUNBOOKS", () => {
  const runbook = ON_DEMAND_RUNBOOKS.find((r) => r.fileName === "debug-branch.md");

  it("AC-12 — debug-branch runbook is registered", () => {
    expect(runbook).toBeDefined();
    expect(runbook?.id).toBe("debug-branch");
    expect(runbook?.body.length).toBeGreaterThan(2000);
  });

  it("AC-12 — debug-branch runbook opens with the On-demand runbook header", () => {
    expect(runbook?.body).toMatch(/^# On-demand runbook — debug-branch/m);
  });

  it("AC-12 — debug-branch runbook covers all four verdicts in the routing matrix", () => {
    for (const verdict of INVESTIGATOR_NEXT_STEPS) {
      expect(runbook?.body).toContain(verdict);
    }
  });

  it("AC-12 — debug-branch runbook is listed in the index section", () => {
    expect(ON_DEMAND_RUNBOOKS_INDEX_SECTION).toContain("debug-branch.md");
  });

  it("AC-12 — debug-branch runbook documents the priorInvestigation envelope propagation", () => {
    expect(runbook?.body).toMatch(/priorInvestigation/);
  });

  it("AC-12 — debug-branch runbook declares the legacy pre-v8.77 migration (no-op; additive)", () => {
    expect(runbook?.body).toMatch(/Legacy.*pre-v8\.77|pre-v8\.77.*legacy|additive/i);
  });
});

describe("v8.77 — investigation-discipline skill is registered + auto-triggers on investigator dispatches", () => {
  const skill = AUTO_TRIGGER_SKILLS.find((s) => s.id === "investigation-discipline");

  it("AC-13 — investigation-discipline skill is registered", () => {
    expect(skill).toBeDefined();
    expect(skill?.fileName).toBe("investigation-discipline.md");
    expect(skill?.body.length).toBeGreaterThan(2000);
  });

  it("AC-13 — investigation-discipline skill auto-triggers on investigator + debug-shape signals", () => {
    expect(skill?.triggers).toContain("specialist:investigator");
    expect(skill?.triggers).toContain("taskShape:debug");
  });

  it("AC-13 — investigation-discipline skill names the three canonical lanes (MECE)", () => {
    expect(skill?.body).toContain("cause-code");
    expect(skill?.body).toContain("cause-config");
    expect(skill?.body).toContain("cause-measurement");
    expect(skill?.body).toMatch(/MECE|three-lane discipline|hard rules/i);
  });

  it("AC-13 — investigation-discipline skill carries the 5-shape evidence rubric", () => {
    for (const shape of [
      "file:line",
      "command output",
      "log excerpt",
      "commit SHA",
      "config snippet"
    ]) {
      expect(skill?.body).toContain(shape);
    }
  });

  it("AC-13 — investigation-discipline skill declares the 0-10 confidence ladder", () => {
    expect(skill?.body).toMatch(/0-10|confidence ladder/i);
  });

  it("AC-13 — investigation-discipline skill carries a `When NOT to apply` section (v8.30 anatomy gate)", () => {
    expect(skill?.body).toMatch(/## When NOT to apply/);
  });
});

describe("v8.77 — taskShape orthogonality (does NOT entangle with the complexity classifier)", () => {
  it("AC-14 — triage prompt restates orthogonality between taskShape and complexity", () => {
    const taskShapeIdx = TRIAGE_PROMPT.indexOf("Task shape detection");
    expect(taskShapeIdx).toBeGreaterThan(0);
    const section = TRIAGE_PROMPT.slice(taskShapeIdx, taskShapeIdx + 6000);
    expect(section).toMatch(/orthogonal|independent.*complexity|complexity.*independent/i);
    expect(section).toMatch(/do NOT|don't/i);
  });

  it("AC-14 — debug-branch runbook restates orthogonality (anti-rationalization)", () => {
    const runbook = ON_DEMAND_RUNBOOKS.find((r) => r.fileName === "debug-branch.md");
    expect(runbook?.body).toMatch(/orthogonal|ORTHOGONAL|orthogonality/);
  });
});
