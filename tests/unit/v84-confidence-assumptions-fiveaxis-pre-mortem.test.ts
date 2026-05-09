import { describe, expect, it } from "vitest";

import { ARCHITECT_PROMPT } from "../../src/content/specialist-prompts/architect.js";
import { BRAINSTORMER_PROMPT } from "../../src/content/specialist-prompts/brainstormer.js";
import { PLANNER_PROMPT } from "../../src/content/specialist-prompts/planner.js";
import { REVIEWER_PROMPT } from "../../src/content/specialist-prompts/reviewer.js";
import { SECURITY_REVIEWER_PROMPT } from "../../src/content/specialist-prompts/security-reviewer.js";
import { SLICE_BUILDER_PROMPT } from "../../src/content/specialist-prompts/slice-builder.js";
import { AUTO_TRIGGER_SKILLS } from "../../src/content/skills.js";
import { START_COMMAND_BODY } from "../../src/content/start-command.js";
import {
  assertFlowStateV82,
  assumptionsOf,
  createInitialFlowState,
  FLOW_STATE_SCHEMA_VERSION,
  isFlowStage,
  migrateFlowState,
  runModeOf
} from "../../src/flow-state.js";
import type { FlowStateV82 } from "../../src/flow-state.js";
import type { TriageDecision } from "../../src/types.js";

describe("v8.4 — Confidence + Assumptions + Five-axis + Pre-mortem", () => {
  // ─────────────────────────────────────────────────────────────────────────
  // D — Confidence calibration
  // ─────────────────────────────────────────────────────────────────────────

  describe("D — Confidence calibration in slim summaries", () => {
    const specialists = [
      { name: "planner", body: PLANNER_PROMPT },
      { name: "slice-builder", body: SLICE_BUILDER_PROMPT },
      { name: "reviewer", body: REVIEWER_PROMPT },
      { name: "brainstormer", body: BRAINSTORMER_PROMPT },
      { name: "architect", body: ARCHITECT_PROMPT },
      { name: "security-reviewer", body: SECURITY_REVIEWER_PROMPT }
    ];

    it.each(specialists)("$name slim summary contract includes Confidence field", ({ body }) => {
      expect(body).toMatch(/Confidence: <high \| medium \| low>/);
    });

    it.each(specialists)("$name explains when to drop confidence to medium / low", ({ body }) => {
      expect(body).toMatch(/Drop to \*\*medium\*\*/i);
      expect(body).toMatch(/Drop to \*\*low\*\*/i);
    });

    it("orchestrator summary template carries the Confidence line", () => {
      expect(START_COMMAND_BODY).toMatch(/Confidence: <high \| medium \| low>/);
    });

    it("orchestrator Hop 4 declares Confidence: low as a hard gate in both modes", () => {
      expect(START_COMMAND_BODY).toMatch(/Confidence as a hard gate \(both modes\)/);
      expect(START_COMMAND_BODY).toMatch(/expand <stage>/);
      expect(START_COMMAND_BODY).toMatch(/is the only word that resumes auto-chaining/i);
    });

    it("auto-mode hard-gate list mentions Confidence: low explicitly", () => {
      expect(START_COMMAND_BODY).toMatch(/Confidence: low\*\*/);
    });

    it("Always-ask rules call out honour Confidence: low", () => {
      expect(START_COMMAND_BODY).toMatch(/Always honour `Confidence: low`/);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // A — ASSUMPTIONS pre-flight (Hop 2.5)
  // ─────────────────────────────────────────────────────────────────────────

  describe("A — Pre-flight assumptions (Hop 2.5)", () => {
    it("flow-state schema accepts triage.assumptions as optional string array", () => {
      const state: FlowStateV82 = {
        ...createInitialFlowState("2026-05-08T12:00:00Z"),
        currentSlug: "demo",
        currentStage: "plan",
        triage: {
          complexity: "small-medium",
          acMode: "soft",
          path: ["plan", "build", "review", "ship"],
          rationale: "demo",
          decidedAt: "2026-05-08T12:00:00Z",
          userOverrode: false,
          runMode: "step",
          assumptions: ["Node 20", "Tailwind 3.4"]
        }
      };
      expect(() => assertFlowStateV82(state)).not.toThrow();
    });

    it("rejects non-string entries in triage.assumptions", () => {
      const state = {
        ...createInitialFlowState("2026-05-08T12:00:00Z"),
        currentSlug: "demo",
        currentStage: "plan",
        triage: {
          complexity: "small-medium",
          acMode: "soft",
          path: ["plan", "build", "review", "ship"],
          rationale: "demo",
          decidedAt: "2026-05-08T12:00:00Z",
          userOverrode: false,
          runMode: "step",
          assumptions: [42, null]
        }
      };
      expect(() => assertFlowStateV82(state)).toThrow(/triage\.assumptions entries must be strings/);
    });

    it("rejects non-array, non-null assumptions", () => {
      const state = {
        ...createInitialFlowState("2026-05-08T12:00:00Z"),
        currentSlug: "demo",
        currentStage: "plan",
        triage: {
          complexity: "small-medium",
          acMode: "soft",
          path: ["plan", "build", "review", "ship"],
          rationale: "demo",
          decidedAt: "2026-05-08T12:00:00Z",
          userOverrode: false,
          runMode: "step",
          assumptions: "Node 20"
        }
      };
      expect(() => assertFlowStateV82(state)).toThrow(/triage\.assumptions must be an array, null, or absent/);
    });

    it("treats null and absent assumptions as no pre-flight ran", () => {
      const triageWithNull: TriageDecision = {
        complexity: "small-medium",
        acMode: "soft",
        path: ["plan", "build", "review", "ship"],
        rationale: "demo",
        decidedAt: "2026-05-08T12:00:00Z",
        userOverrode: false,
        runMode: "step",
        assumptions: null
      };
      expect(assumptionsOf(triageWithNull)).toEqual([]);

      const triageWithoutField: TriageDecision = {
        complexity: "small-medium",
        acMode: "soft",
        path: ["plan", "build", "review", "ship"],
        rationale: "demo",
        decidedAt: "2026-05-08T12:00:00Z",
        userOverrode: false,
        runMode: "step"
      };
      expect(assumptionsOf(triageWithoutField)).toEqual([]);
      expect(assumptionsOf(null)).toEqual([]);
      expect(assumptionsOf(undefined)).toEqual([]);
    });

    it("returns recorded assumptions verbatim", () => {
      const triage: TriageDecision = {
        complexity: "small-medium",
        acMode: "soft",
        path: ["plan", "build", "review", "ship"],
        rationale: "demo",
        decidedAt: "2026-05-08T12:00:00Z",
        userOverrode: false,
        runMode: "step",
        assumptions: ["Node 20", "Tailwind 3.4", "Tests in tests/"]
      };
      expect(assumptionsOf(triage)).toEqual(["Node 20", "Tailwind 3.4", "Tests in tests/"]);
    });

    it("ships pre-flight-assumptions skill registered in AUTO_TRIGGER_SKILLS", () => {
      const skill = AUTO_TRIGGER_SKILLS.find((entry) => entry.id === "pre-flight-assumptions");
      expect(skill).toBeDefined();
      expect(skill!.fileName).toBe("pre-flight-assumptions.md");
      expect(skill!.triggers).toContain("after:triage-gate");
    });

    it("pre-flight skill instructs reading manifest files for stack inference", () => {
      const skill = AUTO_TRIGGER_SKILLS.find((entry) => entry.id === "pre-flight-assumptions")!;
      expect(skill.body).toMatch(/package\.json/);
      expect(skill.body).toMatch(/pyproject\.toml/);
      expect(skill.body).toMatch(/go\.mod/);
      expect(skill.body).toMatch(/Cargo\.toml/);
    });

    it("pre-flight skill caps the list at 3-7 items", () => {
      const skill = AUTO_TRIGGER_SKILLS.find((entry) => entry.id === "pre-flight-assumptions")!;
      expect(skill.body).toMatch(/3-7|3.{0,5}7/);
      expect(skill.body).toMatch(/A long list is noise/i);
    });

    it("pre-flight skill skips on the inline path", () => {
      const skill = AUTO_TRIGGER_SKILLS.find((entry) => entry.id === "pre-flight-assumptions")!;
      expect(skill.body).toMatch(/inline path|path == \["build"\]/);
      expect(skill.body).toMatch(/skip this skill entirely/i);
    });

    it("orchestrator describes Hop 2.5 between Triage and Dispatch", () => {
      expect(START_COMMAND_BODY).toMatch(/Hop 2\.5 — Pre-flight/);
      expect(START_COMMAND_BODY).toMatch(/seven hops, in order/i);
    });

    it("orchestrator instructs Hop 2.5 to skip on inline and on resume", () => {
      expect(START_COMMAND_BODY).toMatch(/triage\.path == \["build"\][^\n]*\(inline\)[^\n]*skip Hop 2\.5/);
      expect(START_COMMAND_BODY).toMatch(/Resume from a paused flow[^\n]*skip Hop 2\.5/);
    });

    it("planner prompt requires copying assumptions verbatim into plan.md", () => {
      expect(PLANNER_PROMPT).toMatch(/Phase 2 — Assumptions cross-check/);
      expect(PLANNER_PROMPT).toMatch(/Copy the list verbatim into.{0,5}plan\.md/);
    });

    it("architect prompt instructs reading triage.assumptions before composing decisions", () => {
      expect(ARCHITECT_PROMPT).toMatch(/Phase 2 — Assumptions cross-check/);
      expect(ARCHITECT_PROMPT).toMatch(/triage\.assumptions/);
      expect(ARCHITECT_PROMPT).toMatch(/D-N[^\n]*you write must be \*\*compatible\*\*/);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // C — Five-axis review with severity tags
  // ─────────────────────────────────────────────────────────────────────────

  describe("C — Five-axis review", () => {
    it("reviewer prompt declares the five axes explicitly", () => {
      expect(REVIEWER_PROMPT).toMatch(/correctness/);
      expect(REVIEWER_PROMPT).toMatch(/readability/);
      expect(REVIEWER_PROMPT).toMatch(/architecture/);
      expect(REVIEWER_PROMPT).toMatch(/\bsecurity\b/);
      expect(REVIEWER_PROMPT).toMatch(/\bperf\b/);
    });

    it("reviewer prompt declares the five severities", () => {
      expect(REVIEWER_PROMPT).toMatch(/critical/);
      expect(REVIEWER_PROMPT).toMatch(/required/);
      expect(REVIEWER_PROMPT).toMatch(/consider/);
      expect(REVIEWER_PROMPT).toMatch(/\bnit\b/);
      expect(REVIEWER_PROMPT).toMatch(/\bfyi\b/);
    });

    it("reviewer prompt has a per-axis checklist", () => {
      expect(REVIEWER_PROMPT).toMatch(/Per-axis checklist/);
      expect(REVIEWER_PROMPT).toMatch(/N\+1/);
      expect(REVIEWER_PROMPT).toMatch(/edge cases/i);
    });

    it("reviewer Concern Ledger schema includes axis and severity columns", () => {
      expect(REVIEWER_PROMPT).toMatch(/\| Axis \| Severity \|/);
    });

    it("reviewer ship-gate maps acMode to severity threshold", () => {
      expect(REVIEWER_PROMPT).toMatch(/strict[^\n]{0,80}critical[^\n]{0,40}required/i);
      expect(REVIEWER_PROMPT).toMatch(/soft[^\n]{0,80}only.{0,5}critical|soft[^\n]{0,80}critical[^\n]{0,40}row blocks/i);
    });

    it("reviewer prompt mentions legacy severity migration", () => {
      expect(REVIEWER_PROMPT).toMatch(/cclaw 8\.0–8\.3 ledgers used/);
      expect(REVIEWER_PROMPT).toMatch(/block → critical \| required/);
    });

    it("reviewer slim summary axes counter cites all five axes", () => {
      expect(REVIEWER_PROMPT).toMatch(/c=N r=N a=N s=N p=N/);
    });

    it("review-loop skill describes the Five-axis pass", () => {
      const skill = AUTO_TRIGGER_SKILLS.find((entry) => entry.id === "review-loop")!;
      expect(skill.body).toMatch(/Five axes \(mandatory walk per iteration\)/);
      expect(skill.body).toMatch(/correctness/);
      expect(skill.body).toMatch(/N\+1/);
    });

    it("review-loop skill maps severity ↔ acMode → ship gate", () => {
      const skill = AUTO_TRIGGER_SKILLS.find((entry) => entry.id === "review-loop")!;
      expect(skill.body).toMatch(/Severity ↔ acMode → ship gate/);
      expect(skill.body).toMatch(/critical.{0,20}OR.{0,20}required/i);
    });

    it("review-loop pitfalls warn about padding severity and missing axis", () => {
      const skill = AUTO_TRIGGER_SKILLS.find((entry) => entry.id === "review-loop")!;
      expect(skill.body).toMatch(/without an axis/i);
      expect(skill.body).toMatch(/Padding severity makes it useless/i);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // G — Cross-flow learning
  // ─────────────────────────────────────────────────────────────────────────

  describe("G — Cross-flow learning from knowledge.jsonl", () => {
    it("planner prompt requires reading .cclaw/knowledge.jsonl", () => {
      expect(PLANNER_PROMPT).toMatch(/\.cclaw\/knowledge\.jsonl/);
      expect(PLANNER_PROMPT).toMatch(/Prior lessons \(cross-flow learning\)/);
    });

    it("planner prompt limits surfaced lessons to 3", () => {
      expect(PLANNER_PROMPT).toMatch(/Do not list more than 3 prior lessons/i);
    });

    it("planner prompt explains how to surface lessons in plan.md", () => {
      expect(PLANNER_PROMPT).toMatch(/## Prior lessons applied/);
      expect(PLANNER_PROMPT).toMatch(/research-learnings\.md/);
    });

    it("planner prompt forbids fabricating lessons and respects user request", () => {
      expect(PLANNER_PROMPT).toMatch(/Do not fabricate a lesson/i);
      expect(PLANNER_PROMPT).toMatch(/do not silently override the user/i);
    });

    it("orchestrator plan-stage envelope mentions knowledge.jsonl", () => {
      expect(START_COMMAND_BODY).toMatch(/knowledge\.jsonl/);
    });

    it("planner dispatches learnings-research as a sub-agent in Phase 3", () => {
      expect(PLANNER_PROMPT).toMatch(/Phase 3 — learnings-research dispatch/);
      expect(PLANNER_PROMPT).toMatch(/Dispatch the .learnings-research. helper/i);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // F — Test impact analysis (commit-helper-aligned guidance)
  // ─────────────────────────────────────────────────────────────────────────

  describe("F — Test impact analysis", () => {
    it("tdd-cycle skill defines two-stage GREEN: affected first, then full suite", () => {
      const skill = AUTO_TRIGGER_SKILLS.find((entry) => entry.id === "tdd-cycle")!;
      expect(skill.body).toMatch(/affected-test suite first/i);
      expect(skill.body).toMatch(/full relevant suite/i);
      expect(skill.body).toMatch(/test impact analysis/i);
    });

    it("tdd-cycle skill names the impact-analysis tools", () => {
      const skill = AUTO_TRIGGER_SKILLS.find((entry) => entry.id === "tdd-cycle")!;
      expect(skill.body).toMatch(/vitest related/);
      expect(skill.body).toMatch(/jest --findRelatedTests/);
    });

    it("tdd-cycle REFACTOR phase still requires the full suite (safety net)", () => {
      const skill = AUTO_TRIGGER_SKILLS.find((entry) => entry.id === "tdd-cycle")!;
      expect(skill.body).toMatch(/REFACTOR is the safety net/i);
      expect(skill.body).toMatch(/full relevant suite.+always.+not just affected/i);
    });

    it("tdd-cycle gate (e) renamed to two-stage suite", () => {
      const skill = AUTO_TRIGGER_SKILLS.find((entry) => entry.id === "tdd-cycle")!;
      expect(skill.body).toMatch(/green_two_stage_suite/);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // B — Source-driven mode
  // ─────────────────────────────────────────────────────────────────────────

  describe("B — Source-driven mode", () => {
    it("registers source-driven skill", () => {
      const skill = AUTO_TRIGGER_SKILLS.find((entry) => entry.id === "source-driven");
      expect(skill).toBeDefined();
      expect(skill!.fileName).toBe("source-driven.md");
    });

    it("source-driven skill describes the four-step process", () => {
      const skill = AUTO_TRIGGER_SKILLS.find((entry) => entry.id === "source-driven")!;
      expect(skill.body).toMatch(/DETECT.{0,5}─.{0,30}FETCH.{0,5}─.{0,30}IMPLEMENT.{0,5}─.{0,30}CITE/);
    });

    it("source-driven skill ranks source authority", () => {
      const skill = AUTO_TRIGGER_SKILLS.find((entry) => entry.id === "source-driven")!;
      expect(skill.body).toMatch(/Source hierarchy/);
      expect(skill.body).toMatch(/Stack Overflow/);
      expect(skill.body).toMatch(/Not authoritative/);
    });

    it("source-driven skill defines the UNVERIFIED marker", () => {
      const skill = AUTO_TRIGGER_SKILLS.find((entry) => entry.id === "source-driven")!;
      expect(skill.body).toMatch(/UNVERIFIED marker/);
      expect(skill.body).toMatch(/unverified: true/);
      expect(skill.body).toMatch(/Honesty about what you couldn't verify/i);
    });

    it("source-driven skill mentions user-context7 MCP integration", () => {
      const skill = AUTO_TRIGGER_SKILLS.find((entry) => entry.id === "source-driven")!;
      expect(skill.body).toMatch(/user-context7/);
      expect(skill.body).toMatch(/mcp_user-context7_get-library-docs/);
    });

    it("source-driven skill triggers on strict + framework code", () => {
      const skill = AUTO_TRIGGER_SKILLS.find((entry) => entry.id === "source-driven")!;
      expect(skill.triggers).toContain("ac_mode:strict");
      expect(skill.triggers).toContain("framework-specific-code-detected");
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // E — Adversarial pre-mortem before ship
  // ─────────────────────────────────────────────────────────────────────────

  describe("E — Adversarial pre-mortem before ship", () => {
    it("orchestrator ship section describes adversarial pre-mortem (strict only)", () => {
      expect(START_COMMAND_BODY).toMatch(/Adversarial pre-mortem \(strict mode only\)/);
      expect(START_COMMAND_BODY).toMatch(/reviewer.{0,5}mode=adversarial/);
    });

    it("pre-mortem.md artifact path is named in start-command", () => {
      expect(START_COMMAND_BODY).toMatch(/flows\/<slug>\/pre-mortem\.md/);
    });

    it("ship gate decision table documents adversarial outcomes", () => {
      expect(START_COMMAND_BODY).toMatch(/reviewer:adversarial/);
    });

    it("orchestrator lists six failure classes for the adversarial pass", () => {
      expect(START_COMMAND_BODY).toMatch(/data-loss/);
      expect(START_COMMAND_BODY).toMatch(/\brace\b/);
      expect(START_COMMAND_BODY).toMatch(/regression/);
      expect(START_COMMAND_BODY).toMatch(/rollback impossibility|rollback-impossibility/);
      expect(START_COMMAND_BODY).toMatch(/accidental scope|accidental-scope/);
      expect(START_COMMAND_BODY).toMatch(/security-edge/);
    });

    it("adversarial pass runs once per ship attempt, not iteratively", () => {
      expect(START_COMMAND_BODY).toMatch(/runs \*\*once per ship attempt\*\*/);
      expect(START_COMMAND_BODY).toMatch(/marginal value drops fast on second run/i);
    });

    it("adversarial mode is skipped in soft mode by default", () => {
      expect(START_COMMAND_BODY).toMatch(/adversarial pass is \*\*skipped\*\*/);
      expect(START_COMMAND_BODY).toMatch(/--adversarial/);
    });

    it("reviewer adversarial mode writes pre-mortem.md with required structure", () => {
      expect(REVIEWER_PROMPT).toMatch(/Adversarial mode — pre-mortem before ship/);
      expect(REVIEWER_PROMPT).toMatch(/flows\/<slug>\/pre-mortem\.md/);
      expect(REVIEWER_PROMPT).toMatch(/Most likely failure modes/);
      expect(REVIEWER_PROMPT).toMatch(/Underexplored axes/);
      expect(REVIEWER_PROMPT).toMatch(/Failure-class checklist/);
    });

    it("reviewer adversarial findings escalate severity for data-loss / security-edge", () => {
      expect(REVIEWER_PROMPT).toMatch(/data-loss \/ security-edge.+critical/i);
      expect(REVIEWER_PROMPT).toMatch(/rollback-impossibility \/ race.+required/i);
    });

    it("reviewer Composition allows pre-mortem.md side effect only in adversarial mode", () => {
      expect(REVIEWER_PROMPT).toMatch(/In `adversarial` mode only.+pre-mortem\.md/);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Migrations / backwards compatibility
  // ─────────────────────────────────────────────────────────────────────────

  describe("v8.4 backwards compatibility", () => {
    it("legacy v2 state migrates and gets runMode=step + no assumptions", () => {
      const legacy = {
        schemaVersion: 2,
        currentSlug: "demo",
        currentStage: "build",
        ac: [],
        lastSpecialist: null,
        startedAt: "2026-04-01T10:00:00Z",
        reviewIterations: 0,
        securityFlag: false
      };
      const migrated = migrateFlowState(legacy);
      expect(migrated.schemaVersion).toBe(FLOW_STATE_SCHEMA_VERSION);
      expect(migrated.triage).not.toBeNull();
      expect(runModeOf(migrated.triage)).toBe("step");
      expect(assumptionsOf(migrated.triage)).toEqual([]);
    });

    it("v8.2 state without assumptions stays valid (assumptions optional)", () => {
      const v82State = {
        ...createInitialFlowState("2026-05-08T12:00:00Z"),
        currentSlug: "demo",
        currentStage: "plan" as const,
        triage: {
          complexity: "small-medium" as const,
          acMode: "soft" as const,
          path: ["plan", "build", "review", "ship"].filter(isFlowStage),
          rationale: "demo",
          decidedAt: "2026-05-08T12:00:00Z",
          userOverrode: false,
          runMode: "step" as const
        }
      };
      expect(() => assertFlowStateV82(v82State)).not.toThrow();
      expect(assumptionsOf(v82State.triage)).toEqual([]);
    });
  });
});
