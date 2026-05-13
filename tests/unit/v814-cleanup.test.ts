import { describe, expect, it } from "vitest";
import { ARTIFACT_TEMPLATES } from "../../src/content/artifact-templates.js";
import { AUTO_TRIGGER_SKILLS } from "../../src/content/skills.js";
import { SPECIALIST_PROMPTS } from "../../src/content/specialist-prompts/index.js";
import { START_COMMAND_BODY } from "../../src/content/start-command.js";
import { ON_DEMAND_RUNBOOKS } from "../../src/content/runbooks-on-demand.js";
import { CORE_AGENTS } from "../../src/content/core-agents.js";
import { LEGACY_DISCOVERY_SPECIALISTS, SPECIALISTS } from "../../src/types.js";

function runbookBody(id: string): string {
  const r = ON_DEMAND_RUNBOOKS.find((rb) => rb.id === id);
  if (!r) throw new Error(`No on-demand runbook with id=${id}`);
  return r.body;
}

/**
 * v8.14 lock-in tests. The release collapses brainstormer + architect into a
 * single design specialist that runs in the main orchestrator context, retires
 * the separate decisions.md file in favour of inline D-N rows in plan.md, and
 * streamlines the triage gate into a zero-question fast path + a single
 * combined two-question form.
 *
 * Failures mean a future change drifted away from the documented behaviour.
 */
describe("v8.14 strong-design + streamlined-gate", () => {
  describe("D1 — design specialist replaces brainstormer + architect", () => {
    it("ships exactly six specialists (v8.42 added critic between security-reviewer and slice-builder), design among them, brainstormer + architect retired", () => {
      expect([...SPECIALISTS]).toEqual(["design", "ac-author", "reviewer", "security-reviewer", "critic", "slice-builder"]);
      for (const legacy of LEGACY_DISCOVERY_SPECIALISTS) {
        expect(SPECIALISTS as readonly string[]).not.toContain(legacy);
      }
    });

    it("design runs in main orchestrator context, not as a sub-agent", () => {
      const design = CORE_AGENTS.find((agent) => agent.id === "design");
      expect(design).toBeDefined();
      expect(design?.activation).toBe("main-context");
      expect(design?.prompt).toMatch(/main orchestrator context/iu);
    });

    it("every other specialist remains on-demand (sub-agent) — v8.42 added critic as on-demand", () => {
      for (const id of ["ac-author", "slice-builder", "reviewer", "security-reviewer", "critic"] as const) {
        const agent = CORE_AGENTS.find((entry) => entry.id === id);
        expect(agent).toBeDefined();
        expect(agent?.activation).toBe("on-demand");
      }
    });

    it("design prompt covers the full seven phases (Clarify → Sign-off)", () => {
      const prompt = SPECIALIST_PROMPTS["design"];
      expect(prompt).toBeDefined();
      for (const phase of [
        /Phase\s+0/u,
        /Phase\s+1.*Clarify/iu,
        /Phase\s+2.*Frame/iu,
        /Phase\s+3.*Approaches/iu,
        /Phase\s+4.*Decisions/iu,
        /Phase\s+5.*Pre-?mortem/iu,
        /Phase\s+6/u,
        /Phase\s+7.*Sign-?off/iu
      ]) {
        expect(prompt).toMatch(phase);
      }
    });

    it("legacy lastSpecialist values are recognised and rewritten to null on read", () => {
      // The migration logic itself is exercised in flow-state tests; here we
      // just lock in that the type-level constant still names the two retired
      // ids so the migration path stays connected.
      expect(LEGACY_DISCOVERY_SPECIALISTS).toEqual(["brainstormer", "architect"]);
    });
  });

  describe("D2 — inline D-N in plan.md replaces decisions.md", () => {
    it("plan template includes a ## Decisions section authored by design Phase 4", () => {
      const plan = ARTIFACT_TEMPLATES.find((template) => template.id === "plan");
      expect(plan).toBeDefined();
      expect(plan?.body).toMatch(/##\s+Decisions/u);
      expect(plan?.body).toMatch(/Design Phase 4/iu);
      expect(plan?.body).toMatch(/D-1/u);
    });

    it("plan template includes a ## Pre-mortem section from design Phase 5", () => {
      const plan = ARTIFACT_TEMPLATES.find((template) => template.id === "plan");
      expect(plan?.body).toMatch(/##\s+Pre-mortem/u);
      expect(plan?.body).toMatch(/Design Phase 5/iu);
    });

    it("decisions template is marked legacy / pre-v8.14 only", () => {
      const decisions = ARTIFACT_TEMPLATES.find((template) => template.id === "decisions");
      expect(decisions).toBeDefined();
      expect(decisions?.body).toMatch(/legacy/iu);
      expect(decisions?.body).toMatch(/pre-v8\.14|v8\.14\+|inline/iu);
      expect(decisions?.description).toMatch(/legacy/iu);
    });

    it("reviewer reads inline D-N from plan.md first, decisions.md only as legacy", () => {
      const reviewer = SPECIALIST_PROMPTS["reviewer"];
      expect(reviewer).toMatch(/##\s+Decisions/u);
      expect(reviewer).toMatch(/inline D-N/iu);
      expect(reviewer).toMatch(/legacy.*decisions\.md|decisions\.md.*legacy/iu);
    });

    it("ac-author's plan.md section list reflects design's inline contributions", () => {
      const acAuthor = SPECIALIST_PROMPTS["ac-author"];
      expect(acAuthor).toMatch(/inline D-N/iu);
      expect(acAuthor).toMatch(/Pre-?mortem/iu);
      expect(acAuthor).toMatch(/Selected Direction/iu);
    });
  });

  describe("D3 — streamlined triage gate", () => {
    it("zero-question fast path exists for trivial / high-confidence", () => {
      expect(START_COMMAND_BODY).toMatch(/Zero-question fast path/iu);
      expect(START_COMMAND_BODY).toMatch(/autoExecuted:\s*true/u);
    });

    it("combined-form ask packs path + run-mode into one structured call", () => {
      expect(START_COMMAND_BODY).toMatch(/Combined-form structured ask/iu);
      expect(START_COMMAND_BODY).toMatch(/TWO questions in one form/iu);
      expect(START_COMMAND_BODY).toMatch(/saves one round-trip per non-inline flow start/u);
    });

    it("triage state shape includes runMode (nullable) and autoExecuted", () => {
      expect(START_COMMAND_BODY).toMatch(/"autoExecuted":\s*false/u);
      expect(START_COMMAND_BODY).toMatch(/runMode.*null.*inline/iu);
    });

    it("triage-gate skill documents both modes (fast path + combined form)", () => {
      const skill = AUTO_TRIGGER_SKILLS.find((entry) => entry.id === "triage-gate");
      expect(skill).toBeDefined();
      expect(skill?.body).toMatch(/zero[- ]question fast path/iu);
      expect(skill?.body).toMatch(/combined[- ]form ask/iu);
      expect(skill?.body).toMatch(/autoExecuted/u);
    });
  });

  describe("D4 — start-command resume + dispatch reflect design + inline decisions", () => {
    it("design appears in the resume summary's Last specialist enum", () => {
      expect(START_COMMAND_BODY).toMatch(/Last specialist.*design/iu);
    });

    it("Plan stage on large-risky describes the design → ac-author sub-phase", () => {
      expect(START_COMMAND_BODY).toMatch(/design.*main context.*multi-?turn/iu);
      expect(START_COMMAND_BODY).toMatch(/ac-author.*sub-?agent/iu);
    });

    it("legacy lastSpecialist values are migrated explicitly (v8.22: in discovery runbook)", () => {
      const discovery = runbookBody("discovery");
      expect(discovery).toMatch(/Legacy migration/iu);
      expect(discovery).toMatch(/lastSpecialist:\s*"brainstormer".+"architect"/u);
      expect(START_COMMAND_BODY).toContain("discovery.md");
    });
  });
});
