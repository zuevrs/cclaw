import { describe, expect, it } from "vitest";

import { ARTIFACT_TEMPLATES } from "../../src/content/artifact-templates.js";
import { ON_DEMAND_RUNBOOKS } from "../../src/content/runbooks-on-demand.js";
import { START_COMMAND_BODY } from "../../src/content/start-command.js";
import { assertFlowStateV82 } from "../../src/flow-state.js";
import { RESEARCH_STATES, type FlowState, type ResearchRevision, type ResearchState } from "../../src/types.js";

/**
 * v8.71 — Research revision loop (revise / push-back / accept).
 * Slimmed in v8.99 test-slim-down A2 to one WIRING + one BEHAVIOR + one
 * SECTION CONTRACT test.
 */

const RESEARCH_TEMPLATE_BODY = ARTIFACT_TEMPLATES.find((t) => t.id === "research")!.body;
const RESEARCH_REVISION_RUNBOOK = ON_DEMAND_RUNBOOKS.find((r) => r.fileName === "research-revision.md");

describe("v8.71 — research revision loop wiring (RESEARCH_STATES + types + runbook + template)", () => {
  it("WIRING — RESEARCH_STATES exports the 6 canonical lifecycle states in spec order, ResearchState + ResearchRevision types accept the canonical literals, research-revision.md runbook is registered, and RESEARCH_TEMPLATE carries the `## Revision history` closing section", () => {
    expect([...RESEARCH_STATES]).toEqual([
      "discovery",
      "lens-dispatch",
      "synthesis",
      "awaiting-user-review",
      "revising",
      "accepted"
    ]);
    const s: ResearchState = "accepted";
    expect(s).toBe("accepted");
    const r: ResearchRevision = {
      kind: "revise",
      at: "2026-05-17T19:32:00Z",
      area: "engineer",
      lensesRedispatched: ["research-engineer"]
    };
    expect(r.kind).toBe("revise");

    expect(RESEARCH_REVISION_RUNBOOK).toBeTruthy();
    expect(RESEARCH_REVISION_RUNBOOK!.body).toMatch(/^# On-demand runbook — /u);

    expect(RESEARCH_TEMPLATE_BODY).toMatch(/^## Revision history$/mu);
    expect(RESEARCH_TEMPLATE_BODY).toMatch(
      /\| timestamp \| kind \| area \/ claim \| lenses re-dispatched \| change \|/
    );
  });
});

describe("v8.71 — research revision loop behavior (validators accept/reject + FlowState shape)", () => {
  it("BEHAVIOR — assertFlowStateV82 accepts researchState absent / each canonical value / null, rejects unknown values; accepts revisions[] with revise/push-back/accept variants; rejects invalid revision.kind, unknown lens ids, missing timestamp; FlowState carries the typed researchState + revisions fields end-to-end", () => {
    const baseState = {
      schemaVersion: 3 as const,
      currentSlug: "20260517-research-foo",
      currentStage: "plan" as const,
      ac: [],
      lastSpecialist: null,
      startedAt: "2026-05-17T00:00:00Z",
      reviewIterations: 0,
      securityFlag: false,
      triage: null
    };

    expect(() => assertFlowStateV82({ ...baseState })).not.toThrow();
    for (const s of RESEARCH_STATES) {
      expect(() => assertFlowStateV82({ ...baseState, researchState: s })).not.toThrow();
    }
    expect(() => assertFlowStateV82({ ...baseState, researchState: null })).not.toThrow();
    expect(() =>
      assertFlowStateV82({ ...baseState, researchState: "completed" })
    ).toThrow(/Invalid researchState/);

    expect(() => assertFlowStateV82({ ...baseState, revisions: [] })).not.toThrow();
    expect(() =>
      assertFlowStateV82({
        ...baseState,
        revisions: [
          { kind: "revise", at: "2026-05-17T19:32:00Z", area: "engineer", lensesRedispatched: ["research-engineer"], change: "x" },
          {
            kind: "push-back",
            at: "2026-05-17T19:48:00Z",
            area: "claim",
            lensesRedispatched: ["research-skeptic", "research-engineer"]
          },
          { kind: "accept", at: "2026-05-17T19:55:00Z", area: "", lensesRedispatched: [], change: "accepted" }
        ]
      })
    ).not.toThrow();

    expect(() =>
      assertFlowStateV82({
        ...baseState,
        revisions: [{ kind: "reject", at: "2026-05-17T00:00:00Z", area: "x", lensesRedispatched: [] }]
      })
    ).toThrow(/Invalid revision\.kind/);
    expect(() =>
      assertFlowStateV82({
        ...baseState,
        revisions: [
          {
            kind: "revise",
            at: "2026-05-17T00:00:00Z",
            area: "x",
            lensesRedispatched: ["research-engineer", "research-bogus"]
          }
        ]
      })
    ).toThrow(/Invalid revision\.lensesRedispatched/);
    expect(() =>
      assertFlowStateV82({
        ...baseState,
        revisions: [{ kind: "revise", area: "x", lensesRedispatched: [] }]
      })
    ).toThrow(/at must be a non-empty ISO timestamp/);

    // FlowState typed shape end-to-end
    const state: FlowState = {
      schemaVersion: 3,
      currentSlug: "20260517-research-redis-vs-memcached",
      currentStage: "plan",
      ac: [],
      lastSpecialist: null,
      startedAt: "2026-05-17T19:00:00Z",
      reviewIterations: 0,
      securityFlag: false,
      triage: {
        complexity: "large-risky",
        ceremonyMode: "strict",
        path: ["plan"],
        rationale: "research-mode entry point",
        decidedAt: "2026-05-17T19:00:00Z",
        runMode: null,
        mode: "research",
        research_depth: "standard"
      },
      researchState: "awaiting-user-review",
      revisions: [
        {
          kind: "revise",
          at: "2026-05-17T19:32:00Z",
          area: "engineer",
          lensesRedispatched: ["research-engineer"],
          change: "Engineer rewritten."
        }
      ]
    };
    expect(state.researchState).toBe("awaiting-user-review");
    expect(state.revisions?.length).toBe(1);
  });
});

describe("v8.71 — research revision loop section contract (start-command + runbook + template)", () => {
  it("SECTION CONTRACT — start-command body declares the 3 sub-commands (/cc research revise|push-back|accept), Phase 3.5 awaiting-user-review gate before Phase 4, points at runbooks/research-revision.md, and stamps every lifecycle state; runbook documents 3 sub-commands + state transition table + push-back re-dispatches skeptic + authoring lens + 5-col revision history table + append-only invariant + references; template revision-history section appears AFTER `## Recommended next step` with the 3 sub-commands + append-only declaration + runbook pointer", () => {
    // start-command body
    expect(START_COMMAND_BODY).toMatch(/\/cc research revise/);
    expect(START_COMMAND_BODY).toMatch(/\/cc research push-back/);
    expect(START_COMMAND_BODY).toMatch(/\/cc research accept/);
    expect(START_COMMAND_BODY).toMatch(/Phase 3\.5/);
    expect(START_COMMAND_BODY).toMatch(/awaiting-user-review/);
    expect(START_COMMAND_BODY).toMatch(/runbooks\/research-revision\.md/);
    for (const s of RESEARCH_STATES) {
      expect(START_COMMAND_BODY).toContain(s);
    }
    expect(START_COMMAND_BODY).toMatch(
      /Phase 4[^]*?finalises the flow only after the user invokes `\/cc research accept`/
    );

    // runbook
    const rb = RESEARCH_REVISION_RUNBOOK!.body;
    expect(rb).toMatch(/\/cc research revise <area>/);
    expect(rb).toMatch(/\/cc research push-back <claim>/);
    expect(rb).toMatch(/\/cc research accept/);
    for (const s of RESEARCH_STATES) {
      expect(rb).toContain(s);
    }
    expect(rb).toMatch(/research-engineer/);
    expect(rb).toMatch(/research-skeptic/);
    expect(rb).toMatch(/skeptic/i);
    expect(rb).toMatch(/authoring lens/i);
    expect(rb).toMatch(/Revision history/);
    expect(rb).toMatch(/timestamp[\s\S]*?kind[\s\S]*?area[\s\S]*?lenses[\s\S]*?change/);
    expect(rb).toMatch(/append-only|never mutate/i);
    expect(rb).toMatch(/Failure handling/i);

    // template
    const recommendedIdx = RESEARCH_TEMPLATE_BODY.indexOf("## Recommended next step");
    const revisionIdx = RESEARCH_TEMPLATE_BODY.indexOf("## Revision history");
    expect(recommendedIdx).toBeGreaterThan(0);
    expect(revisionIdx).toBeGreaterThan(recommendedIdx);
    const tplSlice = RESEARCH_TEMPLATE_BODY.slice(revisionIdx);
    expect(tplSlice).toMatch(/\/cc research revise/);
    expect(tplSlice).toMatch(/\/cc research push-back/);
    expect(tplSlice).toMatch(/\/cc research accept/);
    expect(tplSlice).toMatch(/append-only/i);
    expect(tplSlice).toMatch(/runbooks\/research-revision\.md/);
  });
});
