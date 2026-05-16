import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { SPECIALISTS } from "../../src/types.js";
import { CORE_AGENTS } from "../../src/content/core-agents.js";
import { SPECIALIST_PROMPTS } from "../../src/content/specialist-prompts/index.js";
import { ARCHITECT_PROMPT } from "../../src/content/specialist-prompts/architect.js";
import { BUILDER_PROMPT } from "../../src/content/specialist-prompts/builder.js";
import { REVIEWER_PROMPT } from "../../src/content/specialist-prompts/reviewer.js";
import { START_COMMAND_BODY } from "../../src/content/start-command.js";
import { ARTIFACT_TEMPLATES } from "../../src/content/artifact-templates.js";

/**
 * v8.62 — Unified flow architecture tripwires.
 *
 * v8.62 collapses cclaw's three flow paths into one with depth scaling.
 * The specialist roster shrinks from 9 to 7 via four moves:
 *
 * 1. Kill `design`. Its Phase 0/2-6 (Bootstrap, Frame, Approaches,
 *    Decisions, Pre-mortem, Compose) absorb into a renamed `architect`
 *    (former `ac-author`). Phase 1 (Clarify) and Phase 7 (Sign-off)
 *    disappear entirely — no mid-plan dialogue (v8.61 always-auto
 *    contract is enforced across the unified flow).
 * 2. Rename `ac-author` → `architect`. The new role is broader than AC
 *    authoring (it absorbs design's responsibilities) so the name now
 *    reflects the surface.
 * 3. Rename `slice-builder` → `builder`. Shorter, descriptive; AC-as-
 *    unit semantics are unchanged.
 * 4. Remove `security-reviewer`. Its threat-model + sensitive-change
 *    coverage absorbs into the reviewer's existing `security` axis.
 *    No separate sub-agent dispatch on `security_flag: true`.
 *
 * Resulting roster (7 specialists): triage, architect, builder,
 * plan-critic, qa-runner, reviewer, critic.
 *
 * Clean break: pre-v8.62 `flow-state.json` files with old specialist
 * names continue to read (lastSpecialist is permissive); new writes
 * use new names; old install agent files (`design.md`, `ac-author.md`,
 * `slice-builder.md`, `security-reviewer.md`) get swept on next
 * `cclaw install` (see `RETIRED_AGENT_FILES` in `src/install.ts`).
 *
 * The tripwires below lock in the structural invariants so an
 * accidental regression (a re-introduction of `design.ts`, a re-add
 * of the dead specialist to `SPECIALISTS`, a Phase 7 picker creeping
 * back into the architect prompt) lights up immediately.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "..", "..");
const SPECIALIST_PROMPTS_DIR = path.join(
  REPO_ROOT,
  "src",
  "content",
  "specialist-prompts"
);

describe("v8.62 — specialist-prompts directory: retired files removed, replacements present", () => {
  const RETIRED_FILES = [
    "design.ts",
    "ac-author.ts",
    "slice-builder.ts",
    "security-reviewer.ts"
  ];
  for (const fileName of RETIRED_FILES) {
    it(`\`src/content/specialist-prompts/${fileName}\` does NOT exist (retired in v8.62 unified flow)`, () => {
      const fullPath = path.join(SPECIALIST_PROMPTS_DIR, fileName);
      expect(
        fs.existsSync(fullPath),
        `${fileName} must not exist after v8.62 unified flow collapse`
      ).toBe(false);
    });
  }

  for (const fileName of ["architect.ts", "builder.ts"]) {
    it(`\`src/content/specialist-prompts/${fileName}\` exists (v8.62 replacement)`, () => {
      expect(fs.existsSync(path.join(SPECIALIST_PROMPTS_DIR, fileName))).toBe(
        true
      );
    });
  }
});

describe("v8.62 — SPECIALISTS roster is the exact 7-entry canonical pipeline", () => {
  it("contains exactly seven specialists", () => {
    expect(SPECIALISTS).toHaveLength(7);
  });

  it("contains `architect` and `builder`", () => {
    expect(SPECIALISTS).toContain("architect");
    expect(SPECIALISTS).toContain("builder");
  });

  for (const dead of [
    "design",
    "ac-author",
    "slice-builder",
    "security-reviewer"
  ] as const) {
    it(`excludes the dead specialist \`${dead}\``, () => {
      expect(SPECIALISTS as readonly string[]).not.toContain(dead);
    });
  }

  it("orders the seven specialists along the canonical pipeline (triage → plan → build → qa → review → critic → ship)", () => {
    expect(SPECIALISTS).toEqual([
      "triage",
      "architect",
      "builder",
      "plan-critic",
      "qa-runner",
      "reviewer",
      "critic"
    ]);
  });

  it("CORE_AGENTS registers exactly the 7 specialists + the read-only research helpers (learnings-research, repo-research)", () => {
    const specialistIds = CORE_AGENTS.filter((a) =>
      (SPECIALISTS as readonly string[]).includes(a.id)
    ).map((a) => a.id);
    expect(specialistIds.sort()).toEqual([...SPECIALISTS].sort());
  });

  it("SPECIALIST_PROMPTS exports a prompt for every specialist and nothing for the dead names", () => {
    const promptIds = Object.keys(SPECIALIST_PROMPTS).sort();
    expect(promptIds).toEqual([...SPECIALISTS].sort());
    for (const dead of [
      "design",
      "ac-author",
      "slice-builder",
      "security-reviewer"
    ]) {
      expect(promptIds).not.toContain(dead);
    }
  });
});

describe("v8.62 — architect prompt absorbs design's Phase 0/2-6, drops Clarify (Phase 1) and Sign-off (Phase 7)", () => {
  it("architect prompt names the six absorbed phases (Bootstrap, Frame, Approaches, Decisions, Pre-mortem, Compose)", () => {
    for (const phase of [
      "Bootstrap",
      "Frame",
      "Approaches",
      "Decisions",
      "Pre-mortem",
      "Compose"
    ]) {
      expect(
        ARCHITECT_PROMPT,
        `architect prompt should name the v8.62 absorbed phase "${phase}"`
      ).toMatch(new RegExp(`\\b${phase}\\b`));
    }
  });

  it("architect prompt does NOT carry a Phase 1 Clarify dialogue or a Phase 7 Sign-off picker (v8.61 retired mid-plan dialogue; v8.62 enforces it across the unified flow)", () => {
    expect(ARCHITECT_PROMPT).not.toMatch(/Phase 1 — Clarify/);
    expect(ARCHITECT_PROMPT).not.toMatch(/Phase 7 — Sign-off/);
    expect(ARCHITECT_PROMPT).not.toMatch(/`approve` \/ `request-changes` \/ `reject`/);
    expect(ARCHITECT_PROMPT).not.toMatch(/at most three clarifying questions/i);
  });

  it("architect prompt explicitly forbids mid-plan dialogue (positive lock)", () => {
    expect(ARCHITECT_PROMPT).toMatch(
      /(silent|silently|no mid-plan dialogue|best judgment|no questions)/i
    );
  });

  it("architect runs as an on-demand sub-agent (NOT main-context)", () => {
    const architectAgent = CORE_AGENTS.find((a) => a.id === "architect");
    expect(architectAgent).toBeDefined();
    expect(architectAgent!.activation).toBe("on-demand");
  });
});

describe("v8.62 — builder prompt rename preserves slice-builder semantics", () => {
  it("builder prompt is loaded under the new name (the rename did not drop the prompt)", () => {
    expect(typeof BUILDER_PROMPT).toBe("string");
    expect(BUILDER_PROMPT.length).toBeGreaterThan(1000);
  });

  it("builder keeps the strict/soft split (red(AC-N) / green(AC-N) / refactor(AC-N) commit prefixes on strict; plain `git commit` on soft)", () => {
    expect(BUILDER_PROMPT).toMatch(/In strict mode/);
    expect(BUILDER_PROMPT).toMatch(/red\(AC-/);
    expect(BUILDER_PROMPT).toMatch(/green\(AC-/);
    expect(BUILDER_PROMPT).toMatch(/refactor\(AC-/);
    expect(BUILDER_PROMPT).toMatch(/soft mode/i);
    expect(BUILDER_PROMPT).toMatch(/plain `git commit`/);
  });

  it("builder runs as an on-demand sub-agent (NOT main-context)", () => {
    const builderAgent = CORE_AGENTS.find((a) => a.id === "builder");
    expect(builderAgent).toBeDefined();
    expect(builderAgent!.activation).toBe("on-demand");
  });
});

describe("v8.62 — reviewer absorbed security-reviewer's threat-model / sensitive-change coverage into its `security` axis", () => {
  it("reviewer prompt explicitly cites the v8.62 absorption", () => {
    expect(REVIEWER_PROMPT).toMatch(
      /v8\.62 retired the dedicated `security-reviewer` specialist/i
    );
  });

  it("reviewer prompt carries the threat-model checklist + sensitive-change rules", () => {
    expect(REVIEWER_PROMPT).toMatch(/threat-model/i);
    expect(REVIEWER_PROMPT).toMatch(/sensitive-change/i);
  });

  it("reviewer prompt keeps the five-tier severity scale (critical / required / consider / nit / fyi) — security-reviewer's vocabulary preserved", () => {
    expect(REVIEWER_PROMPT).toMatch(
      /`?critical`? \/ `?required`? \/ `?consider`? \/ `?nit`? \/ `?fyi`?/
    );
  });
});

describe("v8.62 — plan template authorship stamps name `architect`, not the dead specialists", () => {
  it("PLAN_TEMPLATE attributes Spec / Frame / NFR authoring to `_(Architect: ...)_`", () => {
    const plan = ARTIFACT_TEMPLATES.find((t) => t.id === "plan");
    expect(plan).toBeDefined();
    expect(plan!.body).toMatch(/_\(Architect:/u);
  });

  it("PLAN_TEMPLATE does NOT carry the dead specialist stamps `_(Design Phase X)_` / `_(design)_` / `_(ac-author)_`", () => {
    const plan = ARTIFACT_TEMPLATES.find((t) => t.id === "plan");
    expect(plan).toBeDefined();
    expect(plan!.body).not.toMatch(/_\(Design Phase/u);
    expect(plan!.body).not.toMatch(/_\(design\)_/u);
    expect(plan!.body).not.toMatch(/_\(ac-author\)_/u);
  });

  it("PLAN_TEMPLATE_SOFT names `architect` (not `ac-author`) as the section author; soft plans use lighter authorship stamps but the architect is still the canonical owner", () => {
    const planSoft = ARTIFACT_TEMPLATES.find((t) => t.id === "plan-soft");
    expect(planSoft).toBeDefined();
    // Soft plans are shorter and use lighter authorship stamps
    // ("The architect authors this on small-medium (soft) plans.")
    // rather than per-section `_(Architect: <phase>)_` headers.
    expect(planSoft!.body).toMatch(/architect/);
    expect(planSoft!.body).not.toMatch(/_\(ac-author\)_/u);
    expect(planSoft!.body).not.toMatch(/_\(design\)_/u);
  });
});

describe("v8.62 — start-command (orchestrator body) drops `design` and `security-reviewer` dispatch envelopes", () => {
  it("start-command does NOT dispatch a `design` specialist (the unified-flow architect is the only plan-stage specialist)", () => {
    // The architect IS the only plan-stage specialist; the body must
    // not enumerate a `design` dispatch envelope or "design then
    // ac-author" chain.
    expect(START_COMMAND_BODY).not.toMatch(/dispatch.{0,30}`design`/i);
    expect(START_COMMAND_BODY).not.toMatch(/design.{0,5}then.{0,5}ac-author/i);
    expect(START_COMMAND_BODY).not.toMatch(/`design`.{0,40}sub-agent/i);
  });

  it("start-command does NOT dispatch `security-reviewer` (its coverage moved into reviewer's `security` axis)", () => {
    expect(START_COMMAND_BODY).not.toMatch(/dispatch.{0,30}`security-reviewer`/i);
    expect(START_COMMAND_BODY).not.toMatch(/`security-reviewer`.{0,40}sub-agent/i);
  });

  it("start-command names `architect` and `builder` as the v8.62 canonical specialists", () => {
    expect(START_COMMAND_BODY).toMatch(/`architect`/);
    expect(START_COMMAND_BODY).toMatch(/`builder`/);
  });
});

describe("v8.62 — clean break: pre-v8.62 state files validate via permissive readers", () => {
  it("the flow-state validator MUST NOT reject `lastSpecialist` values that are pre-v8.62 names (design, ac-author, slice-builder, security-reviewer)", async () => {
    const { assertFlowStateV82, FLOW_STATE_SCHEMA_VERSION } = await import(
      "../../src/flow-state.js"
    );
    for (const legacyId of [
      "design",
      "ac-author",
      "slice-builder",
      "security-reviewer"
    ]) {
      expect(() =>
        assertFlowStateV82({
          schemaVersion: FLOW_STATE_SCHEMA_VERSION,
          currentSlug: "20260101-test",
          currentStage: "plan",
          ac: [],
          lastSpecialist: legacyId,
          startedAt: "2026-01-01T00:00:00Z",
          reviewIterations: 0,
          securityFlag: false,
          triage: null
        })
      ).not.toThrow();
    }
  });
});
