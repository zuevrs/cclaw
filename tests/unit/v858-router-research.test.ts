/**
 * v8.58 — Lightweight router + research mode + design standalone.
 * Slimmed in v8.99 test-slim-down A2 to one WIRING + one BEHAVIOR +
 * one SECTION CONTRACT test.
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
import { RESEARCH_MODES, type ResearchMode } from "../../src/types.js";

describe("v8.58 — router + research-mode wiring (types + artifact paths + triage-gate skill)", () => {
  it("WIRING — RESEARCH_MODES enumerates exactly ['task','research'], ResearchMode is closed-enum, ARTIFACT_FILE_NAMES.research = research.md, active/shipped artifact paths resolve correctly, triage-gate skill is registered with the v8.58 routing contract", () => {
    expect(RESEARCH_MODES).toEqual(["task", "research"]);
    const taskMode: ResearchMode = "task";
    const researchMode: ResearchMode = "research";
    expect([taskMode, researchMode]).toEqual(["task", "research"]);

    expect(ARTIFACT_FILE_NAMES.research).toBe("research.md");
    expect(activeArtifactPath("/p", "research", "20260515-research-foo")).toBe(
      path.join("/p", ".cclaw", "flows", "20260515-research-foo", "research.md")
    );
    expect(shippedArtifactPath("/p", "20260515-research-foo", "research")).toBe(
      path.join("/p", ".cclaw", "flows", "shipped", "20260515-research-foo", "research.md")
    );

    const triageSkill = AUTO_TRIGGER_SKILLS.find((s) => s.id === "triage-gate");
    expect(triageSkill).toBeDefined();
    expect(triageSkill!.body).toMatch(/routing contract/u);
    expect(triageSkill!.body).toMatch(/complexity.+ceremonyMode.+path.+runMode.+mode/u);
    expect(triageSkill!.body).toContain("--inline");
    expect(triageSkill!.body).toContain("--soft");
    expect(triageSkill!.body).toContain("--strict");
    expect(triageSkill!.body).toMatch(/REMOVED in v8\.58/u);
    expect(triageSkill!.body).toMatch(/research-mode entry point/iu);
    expect(triageSkill!.body).toMatch(/router does NOT decide/iu);
  });
});

describe("v8.58 — router + research-mode behavior (validators + migration + template rendering)", () => {
  it("BEHAVIOR — assertFlowStateV82 accepts triage.mode missing/task/research and rejects invalid enum values, accepts a pre-v8.58 triage with all soft-deprecated fields populated, accepts/rejects priorResearch shapes correctly, and migrateFlowState passes priorResearch + deprecated triage fields through verbatim — researchTemplateForSlug fills placeholders + preserves the v8.65 multi-lens section layout", () => {
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
    // mode missing (pre-v8.58) / task / research
    expect(() =>
      assertFlowStateV82({
        ...base,
        triage: {
          complexity: "small-medium",
          ceremonyMode: "soft",
          path: ["plan", "build", "review", "critic", "ship"],
          rationale: "pre-v8.58",
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
          rationale: "research mode",
          decidedAt: "2026-05-15T00:00:00Z"
        }
      })
    ).not.toThrow();
    // invalid mode rejected
    expect(() =>
      assertFlowStateV82({
        ...base,
        triage: {
          complexity: "small-medium",
          ceremonyMode: "soft",
          path: ["plan", "build", "review", "critic", "ship"],
          mode: "explore",
          rationale: "invalid",
          decidedAt: "2026-05-15T00:00:00Z"
        }
      })
    ).toThrow(/Invalid triage\.mode/u);

    // priorResearch handoff
    expect(() => assertFlowStateV82({ ...base, triage: null })).not.toThrow();
    expect(() => assertFlowStateV82({ ...base, triage: null, priorResearch: null })).not.toThrow();
    expect(() =>
      assertFlowStateV82({
        ...base,
        triage: null,
        priorResearch: {
          slug: "20260514-research-storage",
          topic: "storage strategy",
          path: "/p/.cclaw/flows/shipped/20260514-research-storage/research.md"
        }
      })
    ).not.toThrow();
    expect(() =>
      assertFlowStateV82({ ...base, triage: null, priorResearch: { slug: "", topic: "t", path: "/p" } })
    ).toThrow(/priorResearch\.slug/u);
    expect(() =>
      assertFlowStateV82({ ...base, triage: null, priorResearch: { slug: "x", path: "/p" } })
    ).toThrow(/priorResearch\.topic/u);
    expect(() => assertFlowStateV82({ ...base, triage: null, priorResearch: [] })).toThrow(
      /priorResearch must be an object/u
    );

    // migration preserves deprecated fields verbatim
    const preV858 = {
      schemaVersion: 3,
      currentSlug: "20260510-prev858",
      currentStage: "review" as const,
      ac: [],
      lastSpecialist: "reviewer",
      startedAt: "2026-05-10T00:00:00Z",
      reviewIterations: 1,
      securityFlag: false,
      triage: {
        complexity: "small-medium" as const,
        ceremonyMode: "soft" as const,
        path: ["plan", "build", "review", "critic", "ship"] as const,
        rationale: "pre-v8.58",
        decidedAt: "2026-05-10T00:00:00Z",
        surfaces: ["api"],
        assumptions: ["Express + TypeScript"],
        priorLearnings: [{ slug: "20260505-similar" }],
        interpretationForks: ["user chose JSON-API"]
      }
    };
    const migrated = migrateFlowState(preV858);
    expect(migrated.triage?.surfaces).toEqual(["api"]);
    expect(migrated.triage?.priorLearnings).toEqual([{ slug: "20260505-similar" }]);

    // research template
    const tpl = templateBody("research");
    expect(tpl).toContain("mode: research");
    expect(tpl).toContain("topic: TOPIC-PLACEHOLDER");
    const out = researchTemplateForSlug(
      "20260515-research-storage",
      "storage strategy",
      "2026-05-15T12:34:56Z"
    );
    expect(out).toContain("slug: 20260515-research-storage");
    expect(out).toContain("topic: storage strategy");
    expect(out).toContain("generated_at: 2026-05-15T12:34:56Z");
    expect(out).not.toContain("SLUG-PLACEHOLDER");
    expect(out).toMatch(/lenses:\s*\[engineer,\s*product,\s*architecture,\s*history,\s*skeptic,\s*design\]/u);
    expect(out).toMatch(/^## Discovery dialogue summary$/mu);
    expect(out).toMatch(/^## Engineer lens$/mu);
    expect(out).toMatch(/^## Synthesis$/mu);
    expect(out).not.toMatch(/^## Acceptance Criteria/mu);
    expect(out).not.toMatch(/^## Topology/mu);
  });
});

describe("v8.58 — router + research-mode section contract (start-command + triage + architect prompts)", () => {
  it("SECTION CONTRACT — start-command body describes the lightweight router (5 fields, /cc research entry point + sentinel triage block, priorResearch handoff prompt, qa-stage gating preserved); triage sub-agent prompt owns the moved-out classification fields + override flags + zero-question rule; architect Bootstrap absorbed triage responsibilities and consumes flowState.priorResearch as the research → task handoff", () => {
    const body = renderStartCommand();
    expect(body).toMatch(/lightweight router/iu);
    expect(body).toMatch(/EXACTLY five fields/iu);
    for (const field of ["`complexity`", "`ceremonyMode`", "`path`", "`runMode`", "`mode`"]) {
      expect(body).toMatch(new RegExp(field.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    }
    expect(body).toMatch(/research-mode (entry point|fork)/iu);
    expect(body).toContain("`research `");
    expect(body).toContain("`--research`");
    expect(body).toMatch(/mode:\s*"research"/u);
    expect(body).toMatch(/ceremonyMode:\s*"strict"/u);
    expect(body).toMatch(/path:\s*\["plan"\]/u);
    expect(body).toMatch(/Ready to plan/iu);
    expect(body).toMatch(/priorResearch/u);
    expect(body).toMatch(/qa-(stage|runner)/iu);
    expect(body).not.toContain("askUserQuestion(\n  questions:");

    // triage sub-agent prompt owns the moved-out classification surface + zero-question rule
    expect(TRIAGE_PROMPT).toMatch(/specialist that consumes them|moved out|moved into the specialists/iu);
    for (const fld of ["assumptions", "surfaces", "priorLearnings", "interpretationForks"]) {
      expect(TRIAGE_PROMPT).toContain(fld);
    }
    for (const flag of ["--inline", "--soft", "--strict"]) {
      expect(TRIAGE_PROMPT).toContain(flag);
    }
    expect(TRIAGE_PROMPT).toMatch(/mutually exclusive/iu);
    expect(TRIAGE_PROMPT).toMatch(/Zero-question rule/iu);
    expect(TRIAGE_PROMPT).not.toContain("askUserQuestion(\n  questions:");

    // architect Bootstrap absorbed triage responsibilities
    expect(ARCHITECT_PROMPT).toMatch(/triage\.assumptions/);
    expect(ARCHITECT_PROMPT).toContain("triage.interpretationForks");
    expect(ARCHITECT_PROMPT).toMatch(/learnings-research/);
    expect(ARCHITECT_PROMPT).toContain("triage.surfaces");
    expect(ARCHITECT_PROMPT).toMatch(/insert\s+`"qa"`\s+between\s+`"build"`\s+and\s+`"review"`/u);
    expect(ARCHITECT_PROMPT).toContain("flowState.priorResearch");
    expect(ARCHITECT_PROMPT).toMatch(/priorResearch\.path/u);
    expect(ARCHITECT_PROMPT).toMatch(/architect no longer handles research-mode dispatch/u);
    expect(ARCHITECT_PROMPT).not.toMatch(/Phase 7-research/u);
    expect(ARCHITECT_PROMPT).not.toMatch(/Intra-flow picker/u);
  });
});
