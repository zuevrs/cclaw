import { describe, expect, it } from "vitest";
import { ARTIFACT_TEMPLATES, planTemplateForSlug, templateBody } from "../../src/content/artifact-templates.js";
import { NODE_HOOKS } from "../../src/content/node-hooks.js";
import { AUTO_TRIGGER_SKILLS } from "../../src/content/skills.js";
import { renderStartCommand } from "../../src/content/start-command.js";
import { ARCHITECT_PROMPT } from "../../src/content/specialist-prompts/architect.js";
import { BRAINSTORMER_PROMPT } from "../../src/content/specialist-prompts/brainstormer.js";
import { PLANNER_PROMPT } from "../../src/content/specialist-prompts/planner.js";
import { REVIEWER_PROMPT } from "../../src/content/specialist-prompts/reviewer.js";
import { SECURITY_REVIEWER_PROMPT } from "../../src/content/specialist-prompts/security-reviewer.js";
import { SLICE_BUILDER_PROMPT } from "../../src/content/specialist-prompts/slice-builder.js";

describe("v8.2 orchestrator redesign — triage gate + sub-agent dispatch + graduated AC", () => {
  describe("triage gate skill", () => {
    const skill = AUTO_TRIGGER_SKILLS.find((entry) => entry.id === "triage-gate");
    it("ships as a registered skill with start:/cc trigger", () => {
      expect(skill).toBeDefined();
      expect(skill!.triggers).toContain("start:/cc");
    });

    it("documents the structured output (Triage block + four numbered options)", () => {
      expect(skill!.body).toMatch(/Complexity:/);
      expect(skill!.body).toMatch(/Recommended path:/);
      expect(skill!.body).toMatch(/AC mode:/);
      expect(skill!.body).toMatch(/\[1\] Proceed as recommended/);
      expect(skill!.body).toMatch(/\[2\] Switch to trivial/);
      expect(skill!.body).toMatch(/\[3\] Escalate to large-risky/);
      expect(skill!.body).toMatch(/\[4\] Custom/);
    });

    it("states heuristics for trivial / small-medium / large-risky classification", () => {
      expect(skill!.body).toMatch(/trivial \/ inline/);
      expect(skill!.body).toMatch(/small\/medium \/ soft/);
      expect(skill!.body).toMatch(/large-risky \/ strict/);
    });

    it("requires the orchestrator to persist the decision to flow-state.json", () => {
      expect(skill!.body).toMatch(/triage/);
      expect(skill!.body).toMatch(/userOverrode/);
      expect(skill!.body).toMatch(/decidedAt/);
      expect(skill!.body).toMatch(/immutable/);
    });

    it("escalates one class on low confidence", () => {
      expect(skill!.body).toMatch(/low confidence/i);
      expect(skill!.body).toMatch(/escalate one class/i);
    });
  });

  describe("flow-resume skill", () => {
    const skill = AUTO_TRIGGER_SKILLS.find((entry) => entry.id === "flow-resume");
    it("ships with active-flow-detected trigger", () => {
      expect(skill).toBeDefined();
      expect(skill!.triggers).toContain("active-flow-detected");
    });

    it("presents r/s/c choices with optional [n] for collisions", () => {
      expect(skill!.body).toMatch(/\[r\] Resume/);
      expect(skill!.body).toMatch(/\[s\] Show/);
      expect(skill!.body).toMatch(/\[c\] Cancel/);
      expect(skill!.body).toMatch(/\[n\] New/);
    });

    it("preserves triage decision on resume (no re-prompt)", () => {
      expect(skill!.body).toMatch(/Triage is preserved/);
      expect(skill!.body).toMatch(/does not re-pick/);
    });

    it("infers next step per stage", () => {
      expect(skill!.body).toMatch(/Inferring next step/);
      expect(skill!.body).toMatch(/currentStage/);
    });
  });

  describe("/cc orchestrator hop sequence", () => {
    const body = renderStartCommand();
    it("renders the five-hop sequence", () => {
      expect(body).toMatch(/Hop 1 — Detect/);
      expect(body).toMatch(/Hop 2 — Triage/);
      expect(body).toMatch(/Hop 3 — Dispatch/);
      expect(body).toMatch(/Hop 4 — Pause/);
      expect(body).toMatch(/Hop 5 — Compound/);
    });

    it("calls out the dispatch envelope and slim summary contract", () => {
      expect(body).toMatch(/Dispatch <specialist>/);
      expect(body).toMatch(/Slim summary/i);
      expect(body).toMatch(/inline-fallback/);
    });

    it("requires triage on every fresh /cc and respects user overrides", () => {
      expect(body).toMatch(/triage[- ]gate/i);
      expect(body).toMatch(/triage decision is \*\*immutable\*\*/i);
    });

    it("documents the trivial path as inline edit + commit, no plan/review", () => {
      expect(body).toMatch(/Trivial path/);
      expect(body).toMatch(/skip plan\/review\/ship/i);
    });

    it("describes per-stage sub-agent dispatch and forbidden actions", () => {
      expect(body).toMatch(/dispatch other specialists/);
      expect(body).toMatch(/composition is your job, not theirs/);
    });

    it("describes parallel fan-out for ship (canonical fan-out pattern)", () => {
      expect(body).toMatch(/parallel fan-out \+ merge/);
    });
  });

  describe("graduated AC (commit-helper acMode-conditional)", () => {
    const hook = NODE_HOOKS.find((entry) => entry.id === "commit-helper")!;
    it("reads triage.acMode and proxies plain commit in soft / inline modes", () => {
      expect(hook.body).toMatch(/state\.triage\?\.acMode/);
      expect(hook.body).toMatch(/acMode !== "strict"/);
      expect(hook.body).toContain("advisory passthrough");
    });

    it("preserves strict-mode TDD enforcement (RED files, --phase, AC trace)", () => {
      expect(hook.body).toMatch(/RED phase rejects production files/);
      expect(hook.body).toMatch(/--phase is required in strict mode/);
      expect(hook.body).toMatch(/cycle complete/);
    });

    it("rejects unknown schemaVersion, accepts both 2 and 3", () => {
      expect(hook.body).toMatch(/schemaVersion !== 3 && state\.schemaVersion !== 2/);
    });
  });

  describe("ac-traceability skill is conditional on strict mode", () => {
    const skill = AUTO_TRIGGER_SKILLS.find((entry) => entry.id === "ac-traceability");
    it("opens with a strict-mode-only declaration", () => {
      expect(skill!.body).toMatch(/applies only when the active flow's `ac_mode` is `strict`/);
    });

    it("describes soft / inline behaviour as advisory", () => {
      expect(skill!.body).toMatch(/In soft \/ inline modes/);
      expect(skill!.body).toMatch(/advisory\*\*, not blocking/);
    });

    it("registers the ac_mode:strict trigger", () => {
      expect(skill!.triggers).toContain("ac_mode:strict");
    });
  });

  describe("tdd-cycle skill scales with acMode", () => {
    const skill = AUTO_TRIGGER_SKILLS.find((entry) => entry.id === "tdd-cycle");
    it("documents granularity table (inline / soft / strict)", () => {
      expect(skill!.body).toMatch(/granularity, not whether to write tests/);
      expect(skill!.body).toMatch(/\| `inline` \(trivial\) \|/);
      expect(skill!.body).toMatch(/\| `soft` \(small\/medium\) \|/);
      expect(skill!.body).toMatch(/\| `strict` \(large-risky.*\) \|/);
    });

    it("preserves the Iron Law in every mode", () => {
      expect(skill!.body).toMatch(/Iron Law:/);
      expect(skill!.body).toMatch(/holds in every mode/);
    });
  });

  describe("templates support both modes", () => {
    it("ships strict and soft variants for plan and build", () => {
      const ids = ARTIFACT_TEMPLATES.map((t) => t.id);
      expect(ids).toContain("plan");
      expect(ids).toContain("plan-soft");
      expect(ids).toContain("build");
      expect(ids).toContain("build-soft");
    });

    it("strict plan template still has the AC table", () => {
      const strict = templateBody("plan", { "SLUG-PLACEHOLDER": "demo" });
      expect(strict).toMatch(/Acceptance Criteria/);
      expect(strict).toMatch(/parallelSafe/);
      expect(strict).toMatch(/touchSurface/);
      expect(strict).toMatch(/Topology/);
    });

    it("soft plan template uses bullet-list testable conditions, no AC IDs / topology", () => {
      const soft = templateBody("plan-soft", { "SLUG-PLACEHOLDER": "demo" });
      expect(soft).toMatch(/Testable conditions/);
      expect(soft).toMatch(/ac_mode: soft/);
      expect(soft).not.toMatch(/Acceptance Criteria/);
      expect(soft).not.toMatch(/parallelSafe/);
      expect(soft).not.toMatch(/topology:/);
      expect(soft).not.toMatch(/AC-1/);
    });

    it("soft build template is single-cycle, plain git commit, no commit-helper invocations", () => {
      const soft = templateBody("build-soft", { "SLUG-PLACEHOLDER": "demo" });
      expect(soft).toMatch(/ac_mode: soft/);
      expect(soft).toMatch(/Build log/);
      expect(soft).not.toMatch(/six-column/);
      expect(soft).not.toMatch(/--phase=red/);
      expect(soft).not.toMatch(/Watched-RED proofs/);
    });
  });

  describe("specialist prompts know they run in sub-agents", () => {
    it("planner declares Sub-agent context + acMode awareness + slim summary", () => {
      expect(PLANNER_PROMPT).toMatch(/Sub-agent context/);
      expect(PLANNER_PROMPT).toMatch(/acMode awareness/);
      expect(PLANNER_PROMPT).toMatch(/Slim summary \(returned to orchestrator\)/);
    });

    it("planner produces different output for soft vs strict mode", () => {
      expect(PLANNER_PROMPT).toMatch(/Output \(soft mode\)/);
      expect(PLANNER_PROMPT).toMatch(/no AC table/);
    });

    it("slice-builder declares Sub-agent context + acMode awareness + slim summary", () => {
      expect(SLICE_BUILDER_PROMPT).toMatch(/Sub-agent context/);
      expect(SLICE_BUILDER_PROMPT).toMatch(/acMode awareness/);
      expect(SLICE_BUILDER_PROMPT).toMatch(/Slim summary \(returned to orchestrator\)/);
    });

    it("slice-builder describes soft-mode flow (single cycle, plain git commit)", () => {
      expect(SLICE_BUILDER_PROMPT).toMatch(/Soft-mode flow/);
      expect(SLICE_BUILDER_PROMPT).toMatch(/plain `git commit`/);
    });

    it("reviewer declares Sub-agent context + acMode awareness + slim summary", () => {
      expect(REVIEWER_PROMPT).toMatch(/Sub-agent context/);
      expect(REVIEWER_PROMPT).toMatch(/acMode awareness/);
      expect(REVIEWER_PROMPT).toMatch(/Slim summary \(returned to orchestrator\)/);
    });

    it("brainstormer / architect / security-reviewer declare sub-agent context + slim summary", () => {
      for (const prompt of [BRAINSTORMER_PROMPT, ARCHITECT_PROMPT, SECURITY_REVIEWER_PROMPT]) {
        expect(prompt).toMatch(/Sub-agent context/);
        expect(prompt).toMatch(/Slim summary/);
      }
    });

    it("every Composition footer points at the orchestrator's Hop 3 dispatch", () => {
      for (const prompt of [BRAINSTORMER_PROMPT, ARCHITECT_PROMPT, PLANNER_PROMPT, SLICE_BUILDER_PROMPT, REVIEWER_PROMPT, SECURITY_REVIEWER_PROMPT]) {
        expect(prompt).toMatch(/Hop 3 — \*Dispatch\*/);
      }
    });
  });

  describe("planTemplateForSlug uses the strict template by default (back-compat)", () => {
    it("renders the strict-mode plan body for the given slug", () => {
      const body = planTemplateForSlug("approval-page");
      expect(body).toMatch(/^---/);
      expect(body).toContain("approval-page");
      expect(body).toMatch(/Acceptance Criteria/);
    });
  });
});
