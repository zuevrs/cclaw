/**
 * v8.58 — Lightweight router + research mode + design standalone. Slimmed in
 * v8.99 test-slim-down A2 to one WIRING + one BEHAVIOR + one SECTION CONTRACT.
 */
import path from "node:path";
import { describe, expect, it } from "vitest";
import { researchTemplateForSlug, templateBody } from "../../src/content/artifact-templates.js";
import { renderStartCommand } from "../../src/content/start-command.js";
import { ARCHITECT_PROMPT } from "../../src/content/specialist-prompts/architect.js";
import { TRIAGE_PROMPT } from "../../src/content/specialist-prompts/triage.js";
import { AUTO_TRIGGER_SKILLS } from "../../src/content/skills.js";
import { assertFlowStateV82, migrateFlowState } from "../../src/flow-state.js";
import { ARTIFACT_FILE_NAMES, activeArtifactPath, shippedArtifactPath } from "../../src/artifact-paths.js";
import {
  RESEARCH_MODES,
  type ResearchMode,
  type TriageDecision
} from "../../src/types.js";

describe("v8.58 — lightweight router + research mode wiring", () => {
  it("WIRING — RESEARCH_MODES = [task, research] type surface; assertFlowStateV82 validates triage.mode missing (back-compat) + 'task' + 'research', rejects invalid; priorResearch (absent / null / full / malformed); migrateFlowState passes priorResearch through and preserves pre-v8.58 deprecated triage fields (surfaces/assumptions/priorLearnings/interpretationForks); ARTIFACT_FILE_NAMES.research = research.md + activeArtifactPath / shippedArtifactPath resolve under .cclaw/flows/...", () => {
    expect(RESEARCH_MODES).toEqual(["task", "research"]);
    const taskMode: ResearchMode = "task";
    const researchMode: ResearchMode = "research";
    expect(taskMode).toBe("task");
    expect(researchMode).toBe("research");

    const base = {
      schemaVersion: 3,
      currentSlug: "20260515-router-research",
      currentStage: "plan" as const,
      ac: [],
      lastSpecialist: null,
      startedAt: "2026-05-15T00:00:00Z",
      reviewIterations: 0,
      securityFlag: false
    };
    expect(() =>
      assertFlowStateV82({
        ...base,
        triage: {
          complexity: "small-medium",
          ceremonyMode: "soft",
          path: ["plan", "build", "review", "critic", "ship"],
          rationale: "no mode field — pre-v8.58 state",
          decidedAt: "2026-05-15T00:00:00Z"
        }
      })
    ).not.toThrow();
    expect(() =>
      assertFlowStateV82({
        ...base,
        triage: {
          complexity: "large-risky",
          ceremonyMode: "strict",
          path: ["plan"],
          mode: "research",
          rationale: "research-mode entry point",
          decidedAt: "2026-05-15T00:00:00Z"
        }
      })
    ).not.toThrow();
    expect(() =>
      assertFlowStateV82({
        ...base,
        triage: {
          complexity: "small-medium",
          ceremonyMode: "soft",
          path: ["plan", "build", "review", "critic", "ship"],
          mode: "explore",
          rationale: "invalid mode",
          decidedAt: "2026-05-15T00:00:00Z"
        }
      })
    ).toThrow(/Invalid triage\.mode/u);

    // Deprecated triage fields tolerated when present
    expect(() =>
      assertFlowStateV82({
        ...base,
        triage: {
          complexity: "small-medium",
          ceremonyMode: "soft",
          path: ["plan", "build", "review", "critic", "ship"],
          rationale: "pre-v8.58",
          decidedAt: "2026-05-15T00:00:00Z",
          surfaces: ["ui"],
          assumptions: ["Vue 3"],
          priorLearnings: [{ slug: "20260510-prior-similar" }],
          interpretationForks: ["chose variant A"],
          criticOverride: false,
          notes: "small UI slug"
        } satisfies Partial<TriageDecision> as TriageDecision
      })
    ).not.toThrow();

    // priorResearch handoff
    const fbase = { ...base, currentSlug: "20260515-followup", triage: null };
    expect(() => assertFlowStateV82(fbase)).not.toThrow();
    expect(() => assertFlowStateV82({ ...fbase, priorResearch: null })).not.toThrow();
    expect(() =>
      assertFlowStateV82({
        ...fbase,
        priorResearch: {
          slug: "20260514-research-storage",
          topic: "storage strategy",
          path: "/p/.cclaw/flows/shipped/20260514-research-storage/research.md"
        }
      })
    ).not.toThrow();
    expect(() =>
      assertFlowStateV82({ ...fbase, priorResearch: { slug: "", topic: "t", path: "/p" } })
    ).toThrow(/priorResearch\.slug/u);
    expect(() =>
      assertFlowStateV82({ ...fbase, priorResearch: { slug: "x", path: "/p" } })
    ).toThrow(/priorResearch\.topic/u);
    expect(() => assertFlowStateV82({ ...fbase, priorResearch: [] })).toThrow(
      /priorResearch must be an object/u
    );

    // migrateFlowState pass-through
    const v858 = {
      ...fbase,
      priorResearch: { slug: "20260514-research", topic: "t", path: "/path" }
    };
    expect(migrateFlowState(v858).priorResearch).toEqual(v858.priorResearch);
    const preV858 = {
      schemaVersion: 3,
      currentSlug: "20260510-prev858-resume",
      currentStage: "review" as const,
      ac: [],
      lastSpecialist: "reviewer",
      startedAt: "2026-05-10T00:00:00Z",
      reviewIterations: 1,
      securityFlag: false,
      triage: {
        complexity: "small-medium",
        ceremonyMode: "soft",
        path: ["plan", "build", "review", "critic", "ship"],
        rationale: "pre-v8.58",
        decidedAt: "2026-05-10T00:00:00Z",
        surfaces: ["api"],
        assumptions: ["Express + TypeScript"],
        priorLearnings: [{ slug: "20260505-similar" }],
        interpretationForks: ["chose JSON-API"]
      }
    };
    const migrated = migrateFlowState(preV858);
    expect(migrated.triage?.surfaces).toEqual(["api"]);
    expect(migrated.triage?.priorLearnings).toEqual([{ slug: "20260505-similar" }]);

    // research.md artifact paths
    expect(ARTIFACT_FILE_NAMES.research).toBe("research.md");
    expect(activeArtifactPath("/p", "research", "20260515-research-foo")).toBe(
      path.join("/p", ".cclaw", "flows", "20260515-research-foo", "research.md")
    );
    expect(shippedArtifactPath("/p", "20260515-research-foo", "research")).toBe(
      path.join("/p", ".cclaw", "flows", "shipped", "20260515-research-foo", "research.md")
    );
  });
});

describe("v8.58 — lightweight router + research mode behavior (research template + triage-gate skill)", () => {
  it("BEHAVIOR — templateBody('research') carries v8.58 frontmatter (mode: research, topic/generated_at placeholders); researchTemplateForSlug fills placeholders, declares v8.65/v8.76 6-lens roster, emits the multi-lens section layout (Discovery dialogue / Engineer / Product / Architecture / History / Skeptic / Synthesis / Recommended next step), and drops the retired design-portion sections; AUTO_TRIGGER_SKILLS.triage-gate skill body documents the routing contract (5 router fields + override flags + research-mode skip + moved-out fields list + REMOVED v8.14-v8.57 combined-form + no-git auto-downgrade)", () => {
    const tpl = templateBody("research");
    expect(tpl).toMatch(/^---\n/u);
    expect(tpl).toContain("mode: research");
    expect(tpl).toContain("topic: TOPIC-PLACEHOLDER");
    expect(tpl).toContain("generated_at: GENERATED-AT-PLACEHOLDER");

    const out = researchTemplateForSlug(
      "20260515-research-storage",
      "storage strategy for shared agent memory",
      "2026-05-15T12:34:56Z"
    );
    expect(out).toContain("slug: 20260515-research-storage");
    expect(out).toContain("topic: storage strategy for shared agent memory");
    expect(out).toContain("generated_at: 2026-05-15T12:34:56Z");
    expect(out).toContain("mode: research");
    expect(out).toMatch(
      /lenses:\s*\[engineer,\s*product,\s*architecture,\s*history,\s*skeptic,\s*design\]/u
    );
    for (const placeholder of ["SLUG-PLACEHOLDER", "TOPIC-PLACEHOLDER", "GENERATED-AT-PLACEHOLDER"]) {
      expect(out).not.toContain(placeholder);
    }
    for (const section of [
      /^## Discovery dialogue summary$/mu,
      /^## Engineer lens$/mu,
      /^## Product lens$/mu,
      /^## Architecture lens$/mu,
      /^## History lens$/mu,
      /^## Skeptic lens$/mu,
      /^## Synthesis$/mu,
      /^## Recommended next step$/mu
    ]) {
      expect(out).toMatch(section);
    }
    // Retired sections
    for (const retired of [
      /^## Frame$/mu,
      /^## Spec$/mu,
      /^## Approaches$/mu,
      /^## Selected Direction$/mu,
      /^## Summary — architect/mu,
      /^## Acceptance Criteria/mu,
      /^## Topology/mu,
      /^## Traceability/mu
    ]) {
      expect(out).not.toMatch(retired);
    }

    // triage-gate skill
    const triageSkill = AUTO_TRIGGER_SKILLS.find((s) => s.id === "triage-gate");
    expect(triageSkill, "triage-gate skill missing").toBeDefined();
    const skillBody = triageSkill!.body;
    expect(skillBody).toMatch(/routing contract/u);
    expect(skillBody).toMatch(/complexity.+ceremonyMode.+path.+runMode.+mode/u);
    expect(skillBody).toContain("--inline");
    expect(skillBody).toContain("--soft");
    expect(skillBody).toContain("--strict");
    expect(skillBody).toMatch(/mutually exclusive/iu);
    expect(skillBody).toMatch(/REMOVED in v8\.58/u);
    expect(skillBody).toMatch(/research-mode entry point/iu);
    expect(skillBody).toMatch(/router runs no heuristics/u);
    expect(skillBody).toMatch(/router does NOT decide/iu);
    for (const field of [
      "`surfaces`",
      "`assumptions`",
      "`priorLearnings`",
      "`interpretationForks`",
      "`criticOverride`",
      "`notes`"
    ]) {
      expect(skillBody).toContain(field);
    }
    expect(skillBody).toMatch(/no-git auto-downgrade/iu);
    expect(skillBody).toMatch(/downgradeReason/u);
  });
});

describe("v8.58 — lightweight router + research mode section contract (start-command + triage + architect prompts)", () => {
  it("SECTION CONTRACT — start-command body declares triage as 'lightweight router' with EXACTLY five fields (complexity / ceremonyMode / path / runMode / mode), documents the `/cc research` entry-point fork + sentinel triage block + priorResearch handoff prompt + qa-stage surface gating, and rejects the legacy v8.14-v8.57 combined-form ask; triage prompt owns the moved-out classification surface (assumptions / surfaces / priorLearnings / interpretationForks) + override flags + zero-question rule; architect prompt absorbs Bootstrap-phase assumption capture + Frame-phase interpretation forks / surface detection / qa-stage path rewrite + learnings-research dispatch + flowState.priorResearch consumption + drops v8.58 two-mode `## Activation modes` (research is now the orchestrator's multi-lens fork). v8.103 — lightweight-router prose and the research-mode 4-phase detail moved to runbooks/triage-gate.md and runbooks/research-mode.md; start-command keeps the one-paragraph pointers and the sentinel triage block.", async () => {
    const body = renderStartCommand();
    const { ON_DEMAND_RUNBOOKS } = await import("../../src/content/runbooks-on-demand.js");
    const triageRunbook = ON_DEMAND_RUNBOOKS.find((r) => r.id === "triage-gate");
    const researchRunbook = ON_DEMAND_RUNBOOKS.find((r) => r.id === "research-mode");
    expect(triageRunbook, "triage-gate runbook must exist").toBeDefined();
    expect(researchRunbook, "research-mode runbook must exist").toBeDefined();
    const triageBody = triageRunbook?.body ?? "";
    const researchBody = researchRunbook?.body ?? "";

    // v8.103 — start-command keeps high-level pointers; per-field detail moved to the triage-gate runbook.
    expect(triageBody).toMatch(/lightweight router|router/iu);
    for (const field of ["complexity", "ceremonyMode", "path", "runMode", "mode"]) {
      expect(triageBody).toContain(field);
    }
    expect(body).toMatch(/research-mode (entry point|fork)/iu);
    expect(body).toContain("`research `");
    expect(body).toContain("`--research`");
    expect(body).toMatch(/skips? triage (entirely|dispatch entirely)/iu);
    expect(body).toMatch(/mode:\s*"research"/u);
    expect(body).toMatch(/ceremonyMode:\s*"strict"/u);
    expect(body).toMatch(/path:\s*\["plan"\]/u);
    // v8.103 — Phase 4 handoff prompt moved to research-mode runbook.
    expect(researchBody).toMatch(/Ready to plan/iu);
    expect(body).toMatch(/priorResearch/u);
    expect(body).toMatch(/qa-(stage|runner)/iu);
    expect(body).toMatch(/`triage\.surfaces`[\s\S]{0,80}(includes|∩).{0,40}(`"ui"`|"ui")/u);
    expect(body).not.toContain("askUserQuestion(\n  questions:");

    // triage prompt
    expect(TRIAGE_PROMPT).toMatch(/specialist that consumes them|moved out|moved into the specialists/iu);
    for (const moved of ["assumptions", "surfaces", "priorLearnings", "interpretationForks"]) {
      expect(TRIAGE_PROMPT).toContain(moved);
    }
    for (const flag of ["--inline", "--soft", "--strict"]) {
      expect(TRIAGE_PROMPT).toContain(flag);
    }
    expect(TRIAGE_PROMPT).toMatch(/mutually exclusive/iu);
    expect(TRIAGE_PROMPT).toMatch(/Zero-question rule/iu);
    expect(TRIAGE_PROMPT).not.toContain("askUserQuestion(\n  questions:");

    // architect prompt
    expect(ARCHITECT_PROMPT).toMatch(/triage\.assumptions/);
    expect(ARCHITECT_PROMPT).toContain("triage.interpretationForks");
    expect(ARCHITECT_PROMPT).toMatch(/learnings-research/);
    expect(ARCHITECT_PROMPT).toMatch(/knowledge\.jsonl/);
    expect(ARCHITECT_PROMPT).toMatch(/Surface detection|surface set|triage\.surfaces/u);
    expect(ARCHITECT_PROMPT).toContain("triage.surfaces");
    expect(ARCHITECT_PROMPT).toMatch(/insert\s+`"qa"`\s+between\s+`"build"`\s+and\s+`"review"`/u);
    expect(ARCHITECT_PROMPT).toContain("flowState.priorResearch");
    expect(ARCHITECT_PROMPT).toMatch(/priorResearch\.path/u);
    expect(ARCHITECT_PROMPT).toMatch(/intra-flow `mode: "task"` is the only mode you handle post-v8\.65/u);
    expect(ARCHITECT_PROMPT).not.toMatch(/Standalone research \(`triage\.mode == "research"`/u);
    expect(ARCHITECT_PROMPT).toContain("research.md");
    expect(ARCHITECT_PROMPT).toMatch(/architect no longer handles research-mode dispatch/u);
    expect(ARCHITECT_PROMPT).not.toMatch(/Phase 7-research/u);
    expect(ARCHITECT_PROMPT).not.toMatch(/finalises the research flow immediately/u);
    expect(ARCHITECT_PROMPT).toContain("priorResearch");
    // v8.62 no mid-plan pickers
    for (const picker of [
      /Intra-flow picker/u,
      /`approve`/u,
      /`request-changes`/u,
      /`reject`/u,
      /`revise`/u
    ]) {
      expect(ARCHITECT_PROMPT).not.toMatch(picker);
    }
  });
});
