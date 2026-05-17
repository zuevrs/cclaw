import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { ARTIFACT_TEMPLATES } from "../../src/content/artifact-templates.js";
import { ON_DEMAND_RUNBOOKS } from "../../src/content/runbooks-on-demand.js";
import {
  START_COMMAND_BODY,
  renderStartCommand
} from "../../src/content/start-command.js";
import { assertFlowStateV82 } from "../../src/flow-state.js";
import {
  RESEARCH_STATES,
  type FlowState
} from "../../src/types.js";
import {
  type ResearchRevision,
  type ResearchState
} from "../../src/types.js";

/**
 * v8.71 — Research revision loop (revise / push-back / accept).
 *
 * Tripwires:
 *   1. `RESEARCH_STATES` carries the canonical lifecycle vocabulary
 *      (`discovery` / `lens-dispatch` / `synthesis` /
 *      `awaiting-user-review` / `revising` / `accepted`).
 *   2. `FlowState` accepts `researchState?` + `revisions?` on writes
 *      and validates them on read (assertFlowStateV82 rejects
 *      malformed revisions; pre-v8.71 state files continue to
 *      round-trip via the optional-field default).
 *   3. The orchestrator body declares the three new sub-commands
 *      (`/cc research revise <area>` / `push-back <claim>` /
 *      `accept`) and routes them through the revision runbook.
 *   4. The Phase 3.5 awaiting-user-review gate sits between Phase 3
 *      synthesis and Phase 4 finalize; Phase 4 fires only on
 *      `/cc research accept`.
 *   5. RESEARCH_TEMPLATE gains `## Revision history` at the bottom.
 *   6. `research-revision.md` runbook is registered with the
 *      canonical `# On-demand runbook —` heading and documents the
 *      three sub-commands + state transitions + revision-history
 *      table shape.
 *   7. State transitions documented end-to-end (the §5 transition
 *      table covers every from→to pair).
 *   8. package.json ≥ 8.71.0 + CHANGELOG entry for v8.71.
 *   9. References cited (obra User Review Gate, addyosmani idea-refine,
 *      everyinc Phase 2.5 confirmation gate).
 */

const REPO_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "../..");

const RESEARCH_TEMPLATE_BODY = ARTIFACT_TEMPLATES.find((t) => t.id === "research")!.body;
const RESEARCH_REVISION_RUNBOOK = ON_DEMAND_RUNBOOKS.find(
  (r) => r.fileName === "research-revision.md"
);

describe("v8.71 — ResearchState type + canonical vocabulary", () => {
  it("RESEARCH_STATES carries exactly the six canonical states, in spec order", () => {
    expect([...RESEARCH_STATES]).toEqual([
      "discovery",
      "lens-dispatch",
      "synthesis",
      "awaiting-user-review",
      "revising",
      "accepted"
    ]);
  });

  it("ResearchState type derives from the enum (compile-time round-trip)", () => {
    const a: ResearchState = "discovery";
    const b: ResearchState = "lens-dispatch";
    const c: ResearchState = "synthesis";
    const d: ResearchState = "awaiting-user-review";
    const e: ResearchState = "revising";
    const f: ResearchState = "accepted";
    expect([a, b, c, d, e, f]).toEqual([...RESEARCH_STATES]);
  });
});

describe("v8.71 — FlowState accepts researchState + revisions (writes)", () => {
  it("a research-mode flow can carry researchState=awaiting-user-review + revisions[]", () => {
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
          change: "Engineer > Implementation paths rewritten to reflect fastify v6 release."
        }
      ]
    };
    expect(state.researchState).toBe("awaiting-user-review");
    expect(state.revisions?.length).toBe(1);
    expect(state.revisions?.[0]!.kind).toBe("revise");
  });

  it("ResearchRevision discriminated union admits revise / push-back / accept", () => {
    const r1: ResearchRevision = {
      kind: "revise",
      at: "2026-05-17T19:32:00Z",
      area: "engineer",
      lensesRedispatched: ["research-engineer"]
    };
    const r2: ResearchRevision = {
      kind: "push-back",
      at: "2026-05-17T19:48:12Z",
      area: "fastify-is-best",
      lensesRedispatched: ["research-skeptic", "research-engineer"]
    };
    const r3: ResearchRevision = {
      kind: "accept",
      at: "2026-05-17T19:55:00Z",
      area: "",
      lensesRedispatched: [],
      change: "User accepted research as final."
    };
    expect(r1.kind).toBe("revise");
    expect(r2.kind).toBe("push-back");
    expect(r3.kind).toBe("accept");
  });
});

describe("v8.71 — FlowState validators accept + reject the new fields correctly", () => {
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

  it("accepts researchState absent (back-compat with pre-v8.71 state files)", () => {
    expect(() => assertFlowStateV82({ ...baseState })).not.toThrow();
  });

  it("accepts each canonical researchState value", () => {
    for (const s of RESEARCH_STATES) {
      expect(() =>
        assertFlowStateV82({ ...baseState, researchState: s })
      ).not.toThrow();
    }
  });

  it("accepts researchState=null (explicit clear)", () => {
    expect(() => assertFlowStateV82({ ...baseState, researchState: null })).not.toThrow();
  });

  it("rejects unknown researchState string", () => {
    expect(() =>
      assertFlowStateV82({ ...baseState, researchState: "completed" })
    ).toThrow(/Invalid researchState/);
  });

  it("accepts revisions absent + empty array", () => {
    expect(() => assertFlowStateV82({ ...baseState })).not.toThrow();
    expect(() => assertFlowStateV82({ ...baseState, revisions: [] })).not.toThrow();
  });

  it("accepts a well-formed revisions array (revise + push-back + accept)", () => {
    expect(() =>
      assertFlowStateV82({
        ...baseState,
        revisions: [
          {
            kind: "revise",
            at: "2026-05-17T19:32:00Z",
            area: "engineer",
            lensesRedispatched: ["research-engineer"],
            change: "rewrote engineer section"
          },
          {
            kind: "push-back",
            at: "2026-05-17T19:48:00Z",
            area: "fastify-is-best",
            lensesRedispatched: ["research-skeptic", "research-engineer"]
          },
          {
            kind: "accept",
            at: "2026-05-17T19:55:00Z",
            area: "",
            lensesRedispatched: [],
            change: "User accepted research as final."
          }
        ]
      })
    ).not.toThrow();
  });

  it("rejects revisions with an invalid kind", () => {
    expect(() =>
      assertFlowStateV82({
        ...baseState,
        revisions: [
          { kind: "reject", at: "2026-05-17T00:00:00Z", area: "x", lensesRedispatched: [] }
        ]
      })
    ).toThrow(/Invalid revision\.kind/);
  });

  it("rejects revisions whose lensesRedispatched contains an unknown lens id", () => {
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
  });

  it("rejects revisions missing the at timestamp", () => {
    expect(() =>
      assertFlowStateV82({
        ...baseState,
        revisions: [{ kind: "revise", area: "x", lensesRedispatched: [] }]
      })
    ).toThrow(/at must be a non-empty ISO timestamp/);
  });
});

describe("v8.71 — start-command body declares the three new sub-commands", () => {
  it("renderStartCommand() output is identical to START_COMMAND_BODY (no drift)", () => {
    expect(renderStartCommand()).toBe(START_COMMAND_BODY);
  });

  it("body documents `/cc research revise <area>`", () => {
    expect(START_COMMAND_BODY).toMatch(/\/cc research revise/);
  });

  it("body documents `/cc research push-back <claim>`", () => {
    expect(START_COMMAND_BODY).toMatch(/\/cc research push-back/);
  });

  it("body documents `/cc research accept`", () => {
    expect(START_COMMAND_BODY).toMatch(/\/cc research accept/);
  });

  it("body declares the Phase 3.5 awaiting-user-review gate (between synthesis and finalize)", () => {
    expect(START_COMMAND_BODY).toMatch(/Phase 3\.5/);
    expect(START_COMMAND_BODY).toMatch(/awaiting-user-review/);
  });

  it("body declares each canonical lifecycle state inline so the orchestrator can stamp researchState", () => {
    for (const s of RESEARCH_STATES) {
      expect(
        START_COMMAND_BODY,
        `start-command body must reference the lifecycle state \`${s}\` so the orchestrator can stamp researchState at every Phase boundary`
      ).toContain(s);
    }
  });

  it("body points at the new runbook for the full revision-loop procedure", () => {
    expect(START_COMMAND_BODY).toMatch(/runbooks\/research-revision\.md/);
  });

  it("body's Phase 4 finalize fires only after `/cc research accept`", () => {
    expect(START_COMMAND_BODY).toMatch(
      /Phase 4[^]*?finalises the flow only after the user invokes `\/cc research accept`/
    );
  });

  it("body's invocation matrix routes /cc research revise|push-back|accept to the revision runbook", () => {
    expect(START_COMMAND_BODY).toMatch(/research revise[^|]*push-back[^|]*accept/);
  });
});

describe("v8.71 — research-revision.md on-demand runbook", () => {
  it("runbook is registered in ON_DEMAND_RUNBOOKS", () => {
    expect(RESEARCH_REVISION_RUNBOOK).toBeTruthy();
  });

  it("runbook opens with the canonical `# On-demand runbook —` heading", () => {
    expect(RESEARCH_REVISION_RUNBOOK!.body).toMatch(/^# On-demand runbook — /u);
  });

  it("runbook documents all three sub-commands (revise / push-back / accept)", () => {
    const body = RESEARCH_REVISION_RUNBOOK!.body;
    expect(body).toMatch(/\/cc research revise <area>/);
    expect(body).toMatch(/\/cc research push-back <claim>/);
    expect(body).toMatch(/\/cc research accept/);
  });

  it("runbook documents the lens-set mapping (revise → which lens fires per area token)", () => {
    const body = RESEARCH_REVISION_RUNBOOK!.body;
    expect(body).toMatch(/research-engineer/);
    expect(body).toMatch(/research-product/);
    expect(body).toMatch(/research-architecture/);
    expect(body).toMatch(/research-history/);
    expect(body).toMatch(/research-skeptic/);
  });

  it("runbook declares push-back re-dispatches BOTH skeptic AND the authoring lens", () => {
    const body = RESEARCH_REVISION_RUNBOOK!.body;
    expect(body).toMatch(/skeptic/i);
    expect(body).toMatch(/authoring lens/i);
  });

  it("runbook documents the state transition table (every canonical state pair)", () => {
    const body = RESEARCH_REVISION_RUNBOOK!.body;
    for (const s of RESEARCH_STATES) {
      expect(body, `runbook must reference lifecycle state \`${s}\``).toContain(s);
    }
  });

  it("runbook documents the Revision history table shape (5 columns)", () => {
    const body = RESEARCH_REVISION_RUNBOOK!.body;
    expect(body).toMatch(/Revision history/);
    expect(body).toMatch(/timestamp[\s\S]*?kind[\s\S]*?area[\s\S]*?lenses[\s\S]*?change/);
  });

  it("runbook references the canonical patterns (obra User Review Gate, addyosmani, everyinc Phase 2.5)", () => {
    const body = RESEARCH_REVISION_RUNBOOK!.body;
    expect(body).toMatch(/obra-superpowers|User Review Gate/);
    expect(body).toMatch(/addyosmani|idea-refine/);
    expect(body).toMatch(/everyinc|ce-brainstorm|Phase 2\.5/);
  });

  it("runbook declares the append-only invariant on the revision history", () => {
    const body = RESEARCH_REVISION_RUNBOOK!.body;
    expect(body).toMatch(/append-only|never mutate/i);
  });

  it("runbook covers failure handling for each sub-command", () => {
    const body = RESEARCH_REVISION_RUNBOOK!.body;
    expect(body).toMatch(/Failure handling/i);
    expect(body).toMatch(/unknown research area|could not locate claim/i);
  });
});

describe("v8.71 — RESEARCH_TEMPLATE update (Revision history at the bottom)", () => {
  it("RESEARCH_TEMPLATE carries a `## Revision history` section heading", () => {
    expect(RESEARCH_TEMPLATE_BODY).toMatch(/^## Revision history$/mu);
  });

  it("RESEARCH_TEMPLATE Revision history section documents the 5-column table shape", () => {
    expect(RESEARCH_TEMPLATE_BODY).toMatch(
      /\| timestamp \| kind \| area \/ claim \| lenses re-dispatched \| change \|/
    );
  });

  it("RESEARCH_TEMPLATE Revision history section appears AFTER `## Recommended next step` (it's the closing section)", () => {
    const recommendedIdx = RESEARCH_TEMPLATE_BODY.indexOf("## Recommended next step");
    const revisionIdx = RESEARCH_TEMPLATE_BODY.indexOf("## Revision history");
    expect(recommendedIdx).toBeGreaterThan(0);
    expect(revisionIdx).toBeGreaterThan(recommendedIdx);
  });

  it("RESEARCH_TEMPLATE Revision history section names the three sub-commands", () => {
    const slice = RESEARCH_TEMPLATE_BODY.slice(
      RESEARCH_TEMPLATE_BODY.indexOf("## Revision history")
    );
    expect(slice).toMatch(/\/cc research revise/);
    expect(slice).toMatch(/\/cc research push-back/);
    expect(slice).toMatch(/\/cc research accept/);
  });

  it("RESEARCH_TEMPLATE Revision history section declares append-only audit semantics", () => {
    const slice = RESEARCH_TEMPLATE_BODY.slice(
      RESEARCH_TEMPLATE_BODY.indexOf("## Revision history")
    );
    expect(slice).toMatch(/append-only/i);
  });

  it("RESEARCH_TEMPLATE Revision history section points at the runbook for full procedure", () => {
    const slice = RESEARCH_TEMPLATE_BODY.slice(
      RESEARCH_TEMPLATE_BODY.indexOf("## Revision history")
    );
    expect(slice).toMatch(/runbooks\/research-revision\.md/);
  });
});

describe("v8.71 — version bump + CHANGELOG", () => {
  it("package.json version is 8.71.0 (or later)", async () => {
    const body = await fs.readFile(path.join(REPO_ROOT, "package.json"), "utf8");
    const parsed = JSON.parse(body) as { version: string };
    const match = parsed.version.match(/^(\d+)\.(\d+)\./);
    expect(match, `package.json version '${parsed.version}' must follow major.minor.patch`).not.toBeNull();
    const [major, minor] = match!.slice(1).map((n) => Number.parseInt(n, 10));
    expect(
      major === 8 && minor >= 71,
      `package.json must be bumped to v8.71.0 or later (got ${parsed.version})`
    ).toBe(true);
  });

  it("CHANGELOG.md contains a v8.71 (or later) entry with the research-revision-loop framing", async () => {
    const body = await fs.readFile(path.join(REPO_ROOT, "CHANGELOG.md"), "utf8");
    expect(
      body,
      "CHANGELOG must record the v8.71 research revision loop entry"
    ).toMatch(/##\s*8\.(7[1-9]|[8-9]\d|\d{3,})\.0/);
    expect(body).toMatch(/research revision|Research revision/);
    expect(body).toMatch(/revise/);
    expect(body).toMatch(/push-back/);
    expect(body).toMatch(/accept/);
  });
});
