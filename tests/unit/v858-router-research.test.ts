/**
 * v8.58 — Lightweight router + research mode + design standalone.
 *
 * This file is the v8.58 tripwire test suite. It locks the three
 * architectural slugs that ship in v8.58:
 *
 *   1. **Lightweight router** — the orchestrator's triage hop shrinks
 *      to a pure routing decision (complexity / ceremonyMode / path /
 *      runMode / mode). The classification work it used to do
 *      (surface detection, assumption capture, prior-learnings
 *      lookup, interpretation forks) moved to the specialist that
 *      already has the codebase context to do it — design Phase 0-2
 *      on the strict path, ac-author Phase 0-1 on the soft path,
 *      none on inline.
 *   2. **Research mode + design standalone** — `/cc research <topic>`
 *      is a new entry point that invokes the `design` specialist in
 *      standalone activation mode (Phase 0 Bootstrap → Phase 6
 *      Compose; Phase 7 emits a two-option `accept research` /
 *      `revise` picker). Output: `research.md`; no ac-author handoff;
 *      no build / review / critic / ship stages. Optional handoff via
 *      `flowState.priorResearch` into a follow-up `/cc <task>`.
 *   3. **Design unification** — one specialist, two modes. Intra-flow
 *      design (for strict large-risky) and standalone researcher (for
 *      `/cc research`) share Phase 0-6; only Phase 7's picker variant
 *      differs.
 *
 * The tests below check the canonical surfaces — types, frontmatter,
 * artifact paths, prompt body strings — without exercising the actual
 * /cc flow (the orchestrator runs inside the LLM, not in the unit
 * test runner). For end-to-end behaviour, see the smoke harness.
 */
import path from "node:path";
import { describe, expect, it } from "vitest";
import { researchTemplateForSlug, templateBody } from "../../src/content/artifact-templates.js";
import { renderStartCommand } from "../../src/content/start-command.js";
import { DESIGN_PROMPT } from "../../src/content/specialist-prompts/design.js";
import { AC_AUTHOR_PROMPT } from "../../src/content/specialist-prompts/ac-author.js";
import { AUTO_TRIGGER_SKILLS } from "../../src/content/skills.js";
import { assertFlowStateV82, migrateFlowState } from "../../src/flow-state.js";
import { ARTIFACT_FILE_NAMES, activeArtifactPath, shippedArtifactPath } from "../../src/artifact-paths.js";
import {
  RESEARCH_MODES,
  type ResearchMode,
  type TriageDecision
} from "../../src/types.js";

describe("v8.58 — RESEARCH_MODES type surface", () => {
  it("RESEARCH_MODES enumerates exactly two modes — task (default) and research (v8.58 new entry point)", () => {
    expect(RESEARCH_MODES).toEqual(["task", "research"]);
  });

  it("ResearchMode is assignment-compatible with the closed enum", () => {
    const taskMode: ResearchMode = "task";
    const researchMode: ResearchMode = "research";
    expect(taskMode).toBe("task");
    expect(researchMode).toBe("research");
  });

  it("triage.mode validates: missing (back-compat) and 'task' / 'research' (explicit)", () => {
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
    // missing `mode` field — pre-v8.58 state files validate unchanged
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
    // explicit `mode: "task"`
    expect(() =>
      assertFlowStateV82({
        ...base,
        triage: {
          complexity: "small-medium",
          ceremonyMode: "soft",
          path: ["plan", "build", "review", "critic", "ship"],
          mode: "task",
          rationale: "v8.58 fresh task flow",
          decidedAt: "2026-05-15T00:00:00Z"
        }
      })
    ).not.toThrow();
    // explicit `mode: "research"`
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
    // invalid `mode` value — closed enum, must reject
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
  });
});

describe("v8.58 — soft-deprecated TriageDecision fields", () => {
  // The router does NOT write surfaces / assumptions / priorLearnings /
  // interpretationForks / criticOverride / notes on a v8.58 fresh flow.
  // But the type tolerates them (back-compat) and the validator accepts
  // them when present — pre-v8.58 state files MUST continue to validate.
  it("validator accepts a pre-v8.58 triage with all deprecated fields populated", () => {
    expect(() =>
      assertFlowStateV82({
        schemaVersion: 3,
        currentSlug: "20260515-prev858",
        currentStage: "build" as const,
        ac: [],
        lastSpecialist: "ac-author",
        startedAt: "2026-05-15T00:00:00Z",
        reviewIterations: 0,
        securityFlag: false,
        triage: {
          complexity: "small-medium",
          ceremonyMode: "soft",
          path: ["plan", "build", "review", "critic", "ship"],
          rationale: "pre-v8.58 state — all classification fields populated by orchestrator",
          decidedAt: "2026-05-15T00:00:00Z",
          // soft-deprecated fields — readers continue to consume them verbatim
          surfaces: ["ui"],
          assumptions: ["Vue 3 + composition API", "Vitest test runner"],
          priorLearnings: [{ slug: "20260510-prior-similar" }],
          interpretationForks: ["user chose the dashboard-widget variant"],
          criticOverride: false,
          notes: "small-medium UI slug; no auth touch"
        } satisfies Partial<TriageDecision> as TriageDecision
      })
    ).not.toThrow();
  });

  it("validator accepts a v8.58 fresh triage with none of the deprecated fields", () => {
    expect(() =>
      assertFlowStateV82({
        schemaVersion: 3,
        currentSlug: "20260515-v858",
        currentStage: "plan" as const,
        ac: [],
        lastSpecialist: null,
        startedAt: "2026-05-15T00:00:00Z",
        reviewIterations: 0,
        securityFlag: false,
        triage: {
          complexity: "small-medium",
          ceremonyMode: "soft",
          path: ["plan", "build", "review", "critic", "ship"],
          mode: "task",
          rationale: "v8.58 router decision — no classification fields written",
          decidedAt: "2026-05-15T00:00:00Z"
          // no surfaces, no assumptions, no priorLearnings, no interpretationForks,
          // no criticOverride, no notes — the router stays lightweight.
        }
      })
    ).not.toThrow();
  });
});

describe("v8.58 — flowState.priorResearch handoff field", () => {
  // The optional handoff that links a research-mode flow to the
  // follow-up task flow. Present when the user accepted the "Ready to
  // plan?" prompt at the end of a research flow; absent otherwise.
  it("validator accepts priorResearch absent (default) and null (explicitly cleared)", () => {
    const base = {
      schemaVersion: 3,
      currentSlug: "20260515-followup",
      currentStage: "plan" as const,
      ac: [],
      lastSpecialist: null,
      startedAt: "2026-05-15T00:00:00Z",
      reviewIterations: 0,
      securityFlag: false,
      triage: null
    };
    expect(() => assertFlowStateV82(base)).not.toThrow();
    expect(() => assertFlowStateV82({ ...base, priorResearch: null })).not.toThrow();
  });

  it("validator accepts a fully-populated priorResearch and rejects malformed variants", () => {
    const base = {
      schemaVersion: 3,
      currentSlug: "20260515-followup",
      currentStage: "plan" as const,
      ac: [],
      lastSpecialist: null,
      startedAt: "2026-05-15T00:00:00Z",
      reviewIterations: 0,
      securityFlag: false,
      triage: null
    };
    expect(() =>
      assertFlowStateV82({
        ...base,
        priorResearch: {
          slug: "20260514-research-storage",
          topic: "storage strategy for shared agent memory",
          path: "/projects/foo/.cclaw/flows/shipped/20260514-research-storage/research.md"
        }
      })
    ).not.toThrow();
    // empty slug
    expect(() =>
      assertFlowStateV82({
        ...base,
        priorResearch: { slug: "", topic: "topic", path: "/path" }
      })
    ).toThrow(/priorResearch\.slug/u);
    // missing topic
    expect(() =>
      assertFlowStateV82({
        ...base,
        priorResearch: { slug: "x", path: "/path" }
      })
    ).toThrow(/priorResearch\.topic/u);
    // array instead of object
    expect(() => assertFlowStateV82({ ...base, priorResearch: [] })).toThrow(
      /priorResearch must be an object/u
    );
  });

  it("migrateFlowState passes priorResearch through unchanged when present on a v8.58 state file", () => {
    const v858 = {
      schemaVersion: 3,
      currentSlug: "20260515-followup",
      currentStage: "plan" as const,
      ac: [],
      lastSpecialist: null,
      startedAt: "2026-05-15T00:00:00Z",
      reviewIterations: 0,
      securityFlag: false,
      triage: null,
      priorResearch: {
        slug: "20260514-research-storage",
        topic: "storage strategy",
        path: "/path/to/research.md"
      }
    };
    const migrated = migrateFlowState(v858);
    expect(migrated.priorResearch).toEqual(v858.priorResearch);
  });

  it("migrateFlowState leaves priorResearch absent on a pre-v8.58 state file (the field is brand-new)", () => {
    const preV858 = {
      schemaVersion: 3,
      currentSlug: "20260515-old",
      currentStage: "plan" as const,
      ac: [],
      lastSpecialist: null,
      startedAt: "2026-05-15T00:00:00Z",
      reviewIterations: 0,
      securityFlag: false,
      triage: null
      // no priorResearch — pre-v8.58 state file
    };
    const migrated = migrateFlowState(preV858);
    expect(migrated.priorResearch).toBeUndefined();
  });
});

describe("v8.58 — start-command body (lightweight router prose)", () => {
  const body = renderStartCommand();

  it("describes triage as a 'lightweight router'", () => {
    expect(body).toMatch(/lightweight router/iu);
  });

  it("explicitly enumerates the five fields the router still writes (complexity / ceremonyMode / path / runMode / mode)", () => {
    expect(body).toMatch(/EXACTLY five fields/iu);
    expect(body).toMatch(/`complexity`/u);
    expect(body).toMatch(/`ceremonyMode`/u);
    expect(body).toMatch(/`path`/u);
    expect(body).toMatch(/`runMode`/u);
    expect(body).toMatch(/`mode`/u);
  });

  it("documents the moved-out classification fields (surfaces / assumptions / priorLearnings / interpretationForks / criticOverride / notes)", () => {
    expect(body).toMatch(/moved out/iu);
    expect(body).toContain("`surfaces`");
    expect(body).toContain("`assumptions`");
    expect(body).toContain("`priorLearnings`");
    expect(body).toContain("`interpretationForks`");
    expect(body).toContain("`criticOverride`");
    expect(body).toContain("`notes`");
  });

  it("documents the three override flags (--inline / --soft / --strict) as the explicit-choice short-circuit", () => {
    expect(body).toContain("`/cc --inline <task>`");
    expect(body).toContain("`/cc --soft <task>`");
    expect(body).toContain("`/cc --strict <task>`");
    expect(body).toMatch(/mutually exclusive/iu);
  });

  it("documents the /cc research <topic> entry point fork in Detect", () => {
    expect(body).toMatch(/research-mode (entry point|fork)/iu);
    expect(body).toContain("`research `");
    expect(body).toContain("`--research`");
    expect(body).toMatch(/skips? triage entirely/iu);
  });

  it("documents the v8.58 sentinel triage block for research-mode flows (mode: research / strict / path: [plan])", () => {
    expect(body).toMatch(/mode:\s*"research"/u);
    expect(body).toMatch(/ceremonyMode:\s*"strict"/u);
    expect(body).toMatch(/path:\s*\["plan"\]/u);
  });

  it("documents the priorResearch handoff prompt for the optional research → task transition", () => {
    expect(body).toMatch(/Ready to plan/iu);
    expect(body).toMatch(/priorResearch/u);
  });

  it("preserves the v8.52 qa-stage gating contract (surfaces + ceremonyMode != inline) — only the writer moved", () => {
    expect(body).toMatch(/qa-(stage|runner)/iu);
    expect(body).toMatch(/surfaces include[s]? `"ui"` or `"web"`/u);
  });

  it("removes the legacy v8.14-v8.57 combined-form combined-ask path (kept only as a 'removed' breadcrumb)", () => {
    // The router is zero-question by default. The legacy
    // "Combined-form structured ask" header is gone; the body retains
    // at most one breadcrumb noting the removal so harness operators
    // upgrading from v8.57 see the contract change.
    const combinedFormMentions = body.match(/combined-form/giu) ?? [];
    expect(combinedFormMentions.length).toBeLessThanOrEqual(2);
    expect(body).toMatch(/combined-form[\s\S]{0,80}removed/u);
    // No actual two-question structured-ask invocation remains.
    expect(body).not.toContain("askUserQuestion(\n  questions:");
  });

  it("describes the v8.58 zero-question announcement (one-line, no structured ask)", () => {
    expect(body).toMatch(/one-line announcement/iu);
    expect(body).toMatch(/zero-question/iu);
  });
});

describe("v8.58 — design specialist absorbs triage responsibilities (Phase 0/1/2)", () => {
  it("Phase 0 owns assumption capture (v8.58 — moved from triage)", () => {
    // Phase 0 header explicitly mentions assumption capture
    expect(DESIGN_PROMPT).toMatch(/Phase 0 — Bootstrap[\s\S]+assumption capture/u);
    // Phase 0 body documents the v8.58 ownership move
    expect(DESIGN_PROMPT).toMatch(/moved from triage/u);
    // Phase 0 generates assumptions when triage.assumptions is empty
    // (the v8.58 default: router doesn't pre-seed)
    expect(DESIGN_PROMPT).toMatch(/3-7 stack \/ convention \/ target-platform assumptions/u);
  });

  it("Phase 1 owns interpretation forks (v8.58 — moved from triage)", () => {
    expect(DESIGN_PROMPT).toMatch(/Interpretation-forks ownership/u);
    expect(DESIGN_PROMPT).toContain("triage.interpretationForks");
  });

  it("Phase 1 owns the prior-learnings query via findNearKnowledge (replaces the v8.18 orchestrator-side Hop 2.5 lookup)", () => {
    expect(DESIGN_PROMPT).toMatch(/prior-learnings query/u);
    expect(DESIGN_PROMPT).toContain("findNearKnowledge");
  });

  it("Phase 2 owns surface detection + qa-stage path rewrite (v8.58 — moved from triage)", () => {
    expect(DESIGN_PROMPT).toMatch(/Surface-detection ownership/u);
    expect(DESIGN_PROMPT).toMatch(/moved from triage/u);
    expect(DESIGN_PROMPT).toContain("triage.surfaces");
    // qa-stage insertion contract preserved verbatim (only the writer moved)
    expect(DESIGN_PROMPT).toMatch(/insert\s+`"qa"`\s+between\s+`"build"`\s+and\s+`"review"`/u);
  });
});

describe("v8.58 — design specialist standalone mode (research mode)", () => {
  it("design.ts defines two activation modes — intra-flow (task) and standalone (research)", () => {
    expect(DESIGN_PROMPT).toMatch(/### Activation modes/u);
    // Intra-flow mode (the historical default)
    expect(DESIGN_PROMPT).toMatch(/Intra-flow \(`triage\.mode == "task"`/u);
    // Standalone research mode
    expect(DESIGN_PROMPT).toMatch(/Standalone research \(`triage\.mode == "research"`/u);
  });

  it("Phase 6 writes to research.md (not plan.md) when triage.mode == 'research'", () => {
    expect(DESIGN_PROMPT).toMatch(/On standalone research mode \(`triage\.mode == "research"`\)/u);
    expect(DESIGN_PROMPT).toContain("research.md");
  });

  it("Phase 7 emits a two-option picker (accept research / revise) on standalone mode", () => {
    expect(DESIGN_PROMPT).toMatch(/Standalone research picker/u);
    expect(DESIGN_PROMPT).toContain("`accept research");
    expect(DESIGN_PROMPT).toContain("`revise");
  });

  it("Phase 7 'accept research' finalises immediately (no ac-author handoff)", () => {
    expect(DESIGN_PROMPT).toMatch(/accept research[\s\S]+finalises the flow IMMEDIATELY/u);
    expect(DESIGN_PROMPT).toMatch(/no further specialist dispatch/u);
    expect(DESIGN_PROMPT).toMatch(/Ready to plan/u);
    expect(DESIGN_PROMPT).toContain("priorResearch");
  });

  it("design.ts preserves the v8.14-v8.57 intra-flow three-option picker (approve / request-changes / reject)", () => {
    expect(DESIGN_PROMPT).toMatch(/Intra-flow picker/u);
    expect(DESIGN_PROMPT).toContain("`approve");
    expect(DESIGN_PROMPT).toContain("`request-changes");
    expect(DESIGN_PROMPT).toContain("`reject");
  });
});

describe("v8.58 — ac-author absorbs soft-path triage responsibilities", () => {
  it("ac-author Phase 0 owns assumption capture on the soft path (v8.58 — moved from triage)", () => {
    // Phase 0 header references the v8.58 ownership
    expect(AC_AUTHOR_PROMPT).toMatch(/v8\.58 — soft-path assumption-capture owner/u);
    // Phase 0 fires as the common case (router doesn't pre-seed)
    expect(AC_AUTHOR_PROMPT).toMatch(/v8\.58 default/u);
  });

  it("ac-author Phase 1.5 owns surface detection on the soft path", () => {
    expect(AC_AUTHOR_PROMPT).toMatch(/Phase 1\.5 — Surface scan/u);
    expect(AC_AUTHOR_PROMPT).toContain("triage.surfaces");
    // qa-stage insertion contract preserved verbatim
    expect(AC_AUTHOR_PROMPT).toMatch(/insert\s+`"qa"`\s+between\s+`"build"`\s+and\s+`"review"`/u);
  });

  it("ac-author Phase 1 reads flowState.priorResearch when present (v8.58 research → task handoff)", () => {
    expect(AC_AUTHOR_PROMPT).toContain("flowState.priorResearch");
    expect(AC_AUTHOR_PROMPT).toMatch(/priorResearch\.path/u);
  });
});

describe("v8.58 — research.md artifact template", () => {
  it("ARTIFACT_FILE_NAMES contains research → research.md", () => {
    expect(ARTIFACT_FILE_NAMES.research).toBe("research.md");
  });

  it("activeArtifactPath resolves research.md under .cclaw/flows/<slug>/", () => {
    expect(activeArtifactPath("/p", "research", "20260515-research-foo")).toBe(
      path.join("/p", ".cclaw", "flows", "20260515-research-foo", "research.md")
    );
  });

  it("shippedArtifactPath resolves research.md under .cclaw/flows/shipped/<slug>/", () => {
    expect(shippedArtifactPath("/p", "20260515-research-foo", "research")).toBe(
      path.join("/p", ".cclaw", "flows", "shipped", "20260515-research-foo", "research.md")
    );
  });

  it("templateBody('research') returns the v8.58 frontmatter shape", () => {
    const tpl = templateBody("research");
    expect(tpl).toMatch(/^---\n/u);
    expect(tpl).toContain("mode: research");
    expect(tpl).toContain("topic: TOPIC-PLACEHOLDER");
    expect(tpl).toContain("generated_at: GENERATED-AT-PLACEHOLDER");
  });

  it("researchTemplateForSlug fills the placeholders and preserves the section layout", () => {
    const out = researchTemplateForSlug(
      "20260515-research-storage",
      "storage strategy for shared agent memory",
      "2026-05-15T12:34:56Z"
    );
    // Frontmatter
    expect(out).toContain("slug: 20260515-research-storage");
    expect(out).toContain("topic: storage strategy for shared agent memory");
    expect(out).toContain("generated_at: 2026-05-15T12:34:56Z");
    expect(out).toContain("mode: research");
    // No leftover placeholders
    expect(out).not.toContain("SLUG-PLACEHOLDER");
    expect(out).not.toContain("TOPIC-PLACEHOLDER");
    expect(out).not.toContain("GENERATED-AT-PLACEHOLDER");
    // Same design-portion section layout
    expect(out).toMatch(/^## Frame$/mu);
    expect(out).toMatch(/^## Spec$/mu);
    expect(out).toMatch(/^## Approaches$/mu);
    expect(out).toMatch(/^## Selected Direction$/mu);
    expect(out).toMatch(/^## Decisions$/mu);
    expect(out).toMatch(/^## Pre-mortem$/mu);
    expect(out).toMatch(/^## Not Doing$/mu);
    expect(out).toMatch(/^## Open questions$/mu);
    expect(out).toMatch(/^## Summary — design \(research mode\)$/mu);
    // No AC table / Topology / Traceability — those belong to the
    // follow-up `/cc <task>` flow that consumes this research.
    expect(out).not.toMatch(/^## Acceptance Criteria/mu);
    expect(out).not.toMatch(/^## Topology/mu);
    expect(out).not.toMatch(/^## Traceability/mu);
  });
});

describe("v8.58 — triage-gate skill (lightweight router contract)", () => {
  const triageSkill = AUTO_TRIGGER_SKILLS.find((s) => s.id === "triage-gate");
  if (!triageSkill) {
    throw new Error("triage-gate skill not found in AUTO_TRIGGER_SKILLS — v8.58 skill registry regressed");
  }
  const skillBody = triageSkill.body;

  it("describes the v8.58 routing contract (5 fields the router decides)", () => {
    expect(skillBody).toMatch(/routing contract/u);
    expect(skillBody).toMatch(/complexity.+ceremonyMode.+path.+runMode.+mode/u);
  });

  it("documents the override flags (--inline / --soft / --strict)", () => {
    expect(skillBody).toContain("--inline");
    expect(skillBody).toContain("--soft");
    expect(skillBody).toContain("--strict");
    expect(skillBody).toMatch(/mutually exclusive/iu);
  });

  it("calls out that the legacy v8.14-v8.57 combined-form ask is REMOVED", () => {
    expect(skillBody).toMatch(/REMOVED in v8\.58/u);
    expect(skillBody).toMatch(/v8\.14-v8\.57 combined-form ask/u);
  });

  it("documents that research-mode entry-point skips the router entirely", () => {
    expect(skillBody).toMatch(/research-mode entry point/iu);
    expect(skillBody).toMatch(/router runs no heuristics/u);
  });

  it("documents the v8.58 moved-out fields (surfaces / assumptions / priorLearnings / interpretationForks / criticOverride / notes)", () => {
    expect(skillBody).toMatch(/router does NOT decide/iu);
    expect(skillBody).toContain("`surfaces`");
    expect(skillBody).toContain("`assumptions`");
    expect(skillBody).toContain("`priorLearnings`");
    expect(skillBody).toContain("`interpretationForks`");
    expect(skillBody).toContain("`criticOverride`");
    expect(skillBody).toContain("`notes`");
  });

  it("documents that the no-git auto-downgrade still fires regardless of override flag", () => {
    expect(skillBody).toMatch(/no-git auto-downgrade/iu);
    expect(skillBody).toMatch(/downgradeReason/u);
  });
});

describe("v8.58 — pre-v8.58 state-file back-compat (migration)", () => {
  // The v8.58 router doesn't write the moved fields, but pre-v8.58
  // state files MUST continue to validate verbatim. The migration is
  // a no-op for these fields (they stay readable on the optional
  // @deprecated v8.58 surface for one release).
  it("a pre-v8.58 mid-flight state file with surfaces/assumptions/priorLearnings/interpretationForks survives migrateFlowState verbatim", () => {
    const preV858 = {
      schemaVersion: 3,
      currentSlug: "20260510-prev858-resume",
      currentStage: "review" as const,
      ac: [
        {
          id: "AC-1",
          text: "first criterion",
          status: "pending" as const,
          parallelSafe: true,
          touchSurface: ["src/foo.ts"],
          dependsOn: []
        }
      ],
      lastSpecialist: "reviewer",
      startedAt: "2026-05-10T00:00:00Z",
      reviewIterations: 1,
      securityFlag: false,
      triage: {
        complexity: "small-medium",
        ceremonyMode: "soft",
        path: ["plan", "build", "review", "critic", "ship"],
        rationale: "pre-v8.58 — all four classification fields seeded by the orchestrator",
        decidedAt: "2026-05-10T00:00:00Z",
        surfaces: ["api"],
        assumptions: ["Express + TypeScript", "Vitest"],
        priorLearnings: [{ slug: "20260505-similar-endpoint" }],
        interpretationForks: ["user chose the JSON-API variant over RPC"]
      }
    };
    const migrated = migrateFlowState(preV858);
    expect(migrated.triage?.surfaces).toEqual(["api"]);
    expect(migrated.triage?.assumptions).toEqual(["Express + TypeScript", "Vitest"]);
    expect(migrated.triage?.priorLearnings).toEqual([{ slug: "20260505-similar-endpoint" }]);
    expect(migrated.triage?.interpretationForks).toEqual([
      "user chose the JSON-API variant over RPC"
    ]);
  });

  it("a pre-v8.58 state file (no triage.mode field) reads as task-mode by default", () => {
    const preV858 = {
      schemaVersion: 3,
      currentSlug: "20260510-prev858",
      currentStage: "plan" as const,
      ac: [],
      lastSpecialist: null,
      startedAt: "2026-05-10T00:00:00Z",
      reviewIterations: 0,
      securityFlag: false,
      triage: {
        complexity: "small-medium",
        ceremonyMode: "soft",
        path: ["plan", "build", "review", "critic", "ship"],
        rationale: "pre-v8.58 — no mode field",
        decidedAt: "2026-05-10T00:00:00Z"
      }
    };
    const migrated = migrateFlowState(preV858);
    // The mode field is absent on a pre-v8.58 state file. Readers MUST
    // default to "task" (the historical single-mode behaviour).
    expect(migrated.triage?.mode).toBeUndefined();
  });
});
