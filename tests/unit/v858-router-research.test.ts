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
        lastSpecialist: "architect",
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

  it("v8.61 — the lightweight-router classification surface (moved-out fields) is documented in the triage sub-agent prompt", () => {
    // v8.61 — the triage prose moved from the orchestrator body into the
    // triage specialist (.cclaw/lib/agents/triage.md). The v8.58 invariant
    // (router decides 5 fields and writes none of the 6 moved-out
    // classification fields) is enforced at the sub-agent contract layer.
    expect(TRIAGE_PROMPT).toMatch(/specialist that consumes them|moved out|moved into the specialists/iu);
    expect(TRIAGE_PROMPT).toContain("assumptions");
    expect(TRIAGE_PROMPT).toContain("surfaces");
    expect(TRIAGE_PROMPT).toContain("priorLearnings");
    expect(TRIAGE_PROMPT).toContain("interpretationForks");
  });

  it("v8.61 — the three override flags (--inline / --soft / --strict) live in the triage sub-agent prompt", () => {
    expect(TRIAGE_PROMPT).toContain("--inline");
    expect(TRIAGE_PROMPT).toContain("--soft");
    expect(TRIAGE_PROMPT).toContain("--strict");
    expect(TRIAGE_PROMPT).toMatch(/mutually exclusive/iu);
  });

  it("documents the /cc research <topic> entry point fork in Detect", () => {
    expect(body).toMatch(/research-mode (entry point|fork)/iu);
    expect(body).toContain("`research `");
    expect(body).toContain("`--research`");
    expect(body).toMatch(/skips? triage (entirely|dispatch entirely)/iu);
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

  it("v8.61 — the v8.52 qa-stage gating contract (surfaces + ceremonyMode != inline) is preserved in body or in the architect specialist (v8.62 unified flow: dead `design`+`ac-author` collapsed into `architect`)", () => {
    expect(body).toMatch(/qa-(stage|runner)/iu);
    // qa gating rule still appears in the body (the surface gate is what triggers qa dispatch).
    expect(body).toMatch(/`triage\.surfaces`[\s\S]{0,80}(includes|∩).{0,40}(`"ui"`|"ui")/u);
  });

  it("v8.61 — no legacy v8.14-v8.57 combined-form combined-ask path remains anywhere", () => {
    // The router is zero-question by default; v8.61 makes that the only
    // contract (the v8.58 'removed' breadcrumb was lifted out alongside
    // the rest of the triage prose).
    expect(body).not.toContain("askUserQuestion(\n  questions:");
    expect(TRIAGE_PROMPT).not.toContain("askUserQuestion(\n  questions:");
  });

  it("v8.61 — the v8.58 zero-question rule moved into the triage sub-agent prompt", () => {
    expect(TRIAGE_PROMPT).toMatch(/Zero-question rule/iu);
    expect(TRIAGE_PROMPT).toMatch(/zero-question/iu);
  });
});

describe("v8.58 — architect specialist absorbs triage responsibilities (v8.62 unified flow: dead `design`+`ac-author` collapsed into `architect`)", () => {
  it("Bootstrap phase owns assumption capture (v8.58 — moved from triage; v8.62 — owner renamed from `design Phase 0` to `architect Bootstrap`)", () => {
    expect(ARCHITECT_PROMPT).toMatch(/triage\.assumptions/);
  });

  it("Frame phase owns interpretation forks (v8.58 — moved from triage; v8.62 — single architect Frame phase)", () => {
    expect(ARCHITECT_PROMPT).toContain("triage.interpretationForks");
  });

  it("v8.62 unified flow — prior-learnings query moved into the architect's dedicated `learnings-research` sub-agent dispatch (v8.58 moved the lookup out of the orchestrator; v8.62 keeps the architect's read-only dispatch as the single owner)", () => {
    // The architect dispatches `learnings-research` (a read-only helper sub-agent)
    // which reads `.cclaw/knowledge.jsonl` and returns lessons in the slim
    // summary. The architect prompt does not re-implement `findNearKnowledge`
    // inline anymore — that contract lives in `learnings-research.ts`.
    expect(ARCHITECT_PROMPT).toMatch(/learnings-research/);
    expect(ARCHITECT_PROMPT).toMatch(/knowledge\.jsonl/);
  });

  it("Frame phase owns surface detection + qa-stage path rewrite (v8.58 — moved from triage; v8.62 — single architect Frame phase)", () => {
    expect(ARCHITECT_PROMPT).toMatch(/Surface detection|surface set|triage\.surfaces/u);
    expect(ARCHITECT_PROMPT).toContain("triage.surfaces");
    // qa-stage insertion contract preserved verbatim (only the writer moved)
    expect(ARCHITECT_PROMPT).toMatch(/insert\s+`"qa"`\s+between\s+`"build"`\s+and\s+`"review"`/u);
  });
});

describe("v8.58 — architect standalone mode (v8.65 superseded: research-mode rebuilt as a multi-lens main-context orchestrator; architect now intra-flow only)", () => {
  // v8.65 rebuilt research as a multi-lens main-context orchestrator
  // (`/cc research <topic>` → open-ended discovery dialogue → five
  // parallel research lenses → synthesised research.md). The architect
  // no longer handles research-mode dispatch — its contract is
  // intra-flow plan authoring only. The block below pins the v8.65
  // supersession invariant: the architect's prompt drops the v8.58
  // two-mode `## Activation modes` section and explicitly notes the
  // research-mode handoff lives in the orchestrator.
  it("v8.65 — architect prompt declares intra-flow `task` mode is the only mode it handles (research-mode rebuilt as the main-context orchestrator)", () => {
    expect(ARCHITECT_PROMPT).toMatch(/intra-flow `mode: "task"` is the only mode you handle post-v8\.65/u);
    expect(ARCHITECT_PROMPT).not.toMatch(/Standalone research \(`triage\.mode == "research"`/u);
  });

  it("v8.65 — architect prompt references the multi-lens research orchestrator without dispatching it (legacy migration breadcrumb)", () => {
    // The architect still mentions research.md as a back-compat / legacy
    // migration breadcrumb (the orchestrator now owns research-mode
    // dispatch directly), and explicitly states the architect no longer
    // handles research-mode dispatch envelopes.
    expect(ARCHITECT_PROMPT).toContain("research.md");
    expect(ARCHITECT_PROMPT).toMatch(/architect no longer handles research-mode dispatch/u);
    expect(ARCHITECT_PROMPT).toMatch(/research-engineer|research-product|research-architecture|research-history|research-skeptic/u);
  });

  it("v8.65 — architect no longer carries the v8.58 research-mode finalise prose (orchestrator owns research finalisation directly)", () => {
    // The Phase 7-research / "Ready to plan" handoff prose moved out of
    // the architect into the orchestrator's research-mode fork in
    // start-command.ts. The architect's contract reads
    // `flowState.priorResearch` (when a previous research flow shipped
    // and the user follows up with `/cc <task>`) as Bootstrap context,
    // but the architect itself does not author the handoff prompt.
    expect(ARCHITECT_PROMPT).not.toMatch(/Phase 7-research/u);
    expect(ARCHITECT_PROMPT).not.toMatch(/finalises the research flow immediately/u);
    // priorResearch consumption (Bootstrap context read) still lives in
    // the architect — this is the research → task handoff contract.
    expect(ARCHITECT_PROMPT).toContain("priorResearch");
  });

  it("v8.62 — no mid-plan dialogue / Phase 7 picker (v8.61 always-auto removed all pickers; v8.62 enforces it across the unified flow)", () => {
    expect(ARCHITECT_PROMPT).not.toMatch(/Intra-flow picker/u);
    expect(ARCHITECT_PROMPT).not.toMatch(/`approve`/u);
    expect(ARCHITECT_PROMPT).not.toMatch(/`request-changes`/u);
    expect(ARCHITECT_PROMPT).not.toMatch(/`reject`/u);
    expect(ARCHITECT_PROMPT).not.toMatch(/`revise`/u);
  });
});

describe("v8.58 — architect absorbs soft-path triage responsibilities (v8.62 — single architect for both paths)", () => {
  it("architect prompt owns surface detection (writer ownership moved from triage; canonical vocabulary preserved)", () => {
    expect(ARCHITECT_PROMPT).toContain("triage.surfaces");
    // qa-stage insertion contract preserved verbatim
    expect(ARCHITECT_PROMPT).toMatch(/insert\s+`"qa"`\s+between\s+`"build"`\s+and\s+`"review"`/u);
  });

  it("architect prompt reads flowState.priorResearch when present (v8.58 research → task handoff)", () => {
    expect(ARCHITECT_PROMPT).toContain("flowState.priorResearch");
    expect(ARCHITECT_PROMPT).toMatch(/priorResearch\.path/u);
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

  it("researchTemplateForSlug fills the placeholders and preserves the v8.65 multi-lens section layout", () => {
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
    // v8.65 — lenses frontmatter declares the canonical 5-lens roster
    expect(out).toMatch(/lenses:\s*\[engineer,\s*product,\s*architecture,\s*history,\s*skeptic\]/u);
    // No leftover placeholders
    expect(out).not.toContain("SLUG-PLACEHOLDER");
    expect(out).not.toContain("TOPIC-PLACEHOLDER");
    expect(out).not.toContain("GENERATED-AT-PLACEHOLDER");
    // v8.65 multi-lens section layout — five lens sections + discovery
    // dialogue summary + cross-lens synthesis + recommended next step.
    expect(out).toMatch(/^## Discovery dialogue summary$/mu);
    expect(out).toMatch(/^## Engineer lens$/mu);
    expect(out).toMatch(/^## Product lens$/mu);
    expect(out).toMatch(/^## Architecture lens$/mu);
    expect(out).toMatch(/^## History lens$/mu);
    expect(out).toMatch(/^## Skeptic lens$/mu);
    expect(out).toMatch(/^## Synthesis$/mu);
    expect(out).toMatch(/^## Recommended next step$/mu);
    // v8.65 retired the v8.58 design-portion sections (Frame / Spec /
    // Approaches / Selected Direction / Decisions / Pre-mortem / Not
    // Doing / Open questions / Summary). Those belonged to the
    // architect-as-researcher contract that the multi-lens orchestrator
    // replaces.
    expect(out).not.toMatch(/^## Frame$/mu);
    expect(out).not.toMatch(/^## Spec$/mu);
    expect(out).not.toMatch(/^## Approaches$/mu);
    expect(out).not.toMatch(/^## Selected Direction$/mu);
    expect(out).not.toMatch(/^## Summary — architect/mu);
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
