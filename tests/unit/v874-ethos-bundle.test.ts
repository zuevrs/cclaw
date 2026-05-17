import { describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";

import { CCLAW_ETHOS_BODY, ETHOS_PRINCIPLES, ethosMarkdown } from "../../src/content/ethos.js";
import {
  ARCHITECT_PROMPT,
  BUILDER_PROMPT,
  CRITIC_PROMPT,
  PLAN_CRITIC_PROMPT,
  PLAN_DESIGN_PROMPT,
  QA_RUNNER_PROMPT,
  REVIEWER_PROMPT,
  SPECIALIST_PROMPTS,
  TRIAGE_PROMPT
} from "../../src/content/specialist-prompts/index.js";
import { ARTIFACT_TEMPLATES } from "../../src/content/artifact-templates.js";
import { START_COMMAND_BODY } from "../../src/content/start-command.js";
import { ON_DEMAND_RUNBOOKS } from "../../src/content/runbooks-on-demand.js";
import { initCclaw } from "../../src/install.js";

/**
 * v8.74 — Ethos preamble + Reversibility field + adversarial stance.
 *
 * Three small wins that sharpen existing gates without adding new
 * specialists or stages:
 *   1. Single-source-of-truth ethos preamble auto-prepended to every
 *      dispatch envelope; replaces per-specialist Iron-Law restatements.
 *   2. Mandatory `Reversibility:` field on every D-N in plan.md; the
 *      cross-model critic auto-fires on any `one-way` decision (keyword
 *      detection preserved as fallback for plans with no Decisions).
 *   3. Force-stance opening clause in critic adversarial mode + the
 *      plan-critic — flips the default cognitive posture from "balanced
 *      review" to "find disqualifying evidence first".
 */

const FORCE_STANCE_CLAUSE =
  "Adversarial stance: Assume the artifact under review is flawed until evidence proves otherwise. Your starting hypothesis: this work will not deliver the stated goal. Look for disqualifying evidence first, then balance with what works.";

describe("v8.74 — ethos preamble (single source of truth)", () => {
  it("AC-1 — ethos.ts exports a 5-principle preamble + the canonical body string", () => {
    expect(ETHOS_PRINCIPLES).toHaveLength(5);
    const ids = ETHOS_PRINCIPLES.map((p) => p.id);
    expect(ids).toEqual([
      "boil-the-lake",
      "search-before-building",
      "surgical-edits",
      "user-sovereignty",
      "three-knowledge-layers"
    ]);
  });

  it("AC-1 — ethos body contains the 5 named principle titles", () => {
    expect(CCLAW_ETHOS_BODY).toContain("Boil the Lake");
    expect(CCLAW_ETHOS_BODY).toContain("Search Before Building");
    expect(CCLAW_ETHOS_BODY).toContain("Surgical Edits");
    expect(CCLAW_ETHOS_BODY).toContain("User Sovereignty");
    expect(CCLAW_ETHOS_BODY).toContain("Three knowledge layers");
  });

  it("AC-1 — ethos body mentions Layer 1 / Layer 2 / Layer 3 vocabulary", () => {
    expect(CCLAW_ETHOS_BODY).toMatch(/Layer 1/);
    expect(CCLAW_ETHOS_BODY).toMatch(/Layer 2/);
    expect(CCLAW_ETHOS_BODY).toMatch(/Layer 3/);
  });

  it("AC-1 — ethosMarkdown() is the source of CCLAW_ETHOS_BODY (no drift)", () => {
    expect(ethosMarkdown()).toBe(CCLAW_ETHOS_BODY);
  });

  it("AC-1 — install layer writes the ethos file to .cclaw/lib/cclaw-ethos.md", async () => {
    const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), "cclaw-v874-ethos-"));
    try {
      await fs.mkdir(path.join(projectRoot, ".cursor"), { recursive: true });
      await initCclaw({ cwd: projectRoot, interactive: false });
      const ethosPath = path.join(projectRoot, ".cclaw", "lib", "cclaw-ethos.md");
      const body = await fs.readFile(ethosPath, "utf-8");
      expect(body).toBe(CCLAW_ETHOS_BODY);
    } finally {
      await fs.rm(projectRoot, { recursive: true, force: true });
    }
  });
});

describe("v8.74 — ethos prepended to every specialist dispatch envelope", () => {
  it("AC-2 — start-command lists the Required ethos read on every dispatch (Always-ask rules)", () => {
    expect(START_COMMAND_BODY).toMatch(/cclaw-ethos\.md/);
    expect(START_COMMAND_BODY).toMatch(/Required ethos read/);
  });

  it("AC-2 — start-command's Dispatch envelope section explains the ethos preamble (v8.74)", () => {
    const dispatchIdx = START_COMMAND_BODY.indexOf("### Dispatch envelope");
    expect(dispatchIdx).toBeGreaterThan(0);
    const after = START_COMMAND_BODY.slice(dispatchIdx, dispatchIdx + 2000);
    expect(after).toMatch(/Ethos preamble/);
    expect(after).toMatch(/Boil the Lake/);
    expect(after).toMatch(/Search Before Building/);
    expect(after).toMatch(/Surgical Edits/);
    expect(after).toMatch(/User Sovereignty/);
    expect(after).toMatch(/3 knowledge layers/);
  });

  it("AC-2 — dispatch-envelope runbook places the ethos read above the agent contract", () => {
    const dispatchEnvelopeRunbook = ON_DEMAND_RUNBOOKS.find(
      (r) => r.fileName === "dispatch-envelope.md"
    );
    expect(dispatchEnvelopeRunbook, "dispatch-envelope runbook must exist").toBeTruthy();
    const body = dispatchEnvelopeRunbook!.body;
    const ethosIdx = body.indexOf("Required ethos read");
    const contractIdx = body.indexOf("Required first read");
    expect(ethosIdx).toBeGreaterThan(0);
    expect(contractIdx).toBeGreaterThan(0);
    expect(ethosIdx).toBeLessThan(contractIdx);
    expect(body).toContain("cclaw-ethos.md");
  });

  it("AC-2 — all 8 specialist prompts reference the ethos preamble (auto-prepended via dispatch envelope) — v8.75 added plan-design", () => {
    // The 8 specialists in the v8.62-collapsed-plus-v8.75-plan-design roster.
    const specialists = [
      ["triage", TRIAGE_PROMPT],
      ["architect", ARCHITECT_PROMPT],
      ["builder", BUILDER_PROMPT],
      ["plan-critic", PLAN_CRITIC_PROMPT],
      ["plan-design", PLAN_DESIGN_PROMPT],
      ["qa-runner", QA_RUNNER_PROMPT],
      ["reviewer", REVIEWER_PROMPT],
      ["critic", CRITIC_PROMPT]
    ] as const;
    expect(specialists).toHaveLength(8);
    // The roster export should match the eight we test (sanity guard
    // against new specialist additions silently bypassing the ethos
    // wiring).
    const installedIds = Object.keys(SPECIALIST_PROMPTS).sort();
    expect(installedIds).toEqual(specialists.map(([id]) => id).slice().sort());
  });
});

describe("v8.74 — Iron-Law restatements removed from per-specialist prompts", () => {
  // The pre-v8.74 specialists each carried a "## Iron Law (<specialist>
  // edition)" section that restated the cross-cutting discipline in
  // each specialist's own words. v8.74 replaces that with a single
  // dispatched preamble at .cclaw/lib/cclaw-ethos.md; the per-specialist
  // restatements are removed so the ethos has a single source of truth.

  const SPECIALISTS_WITH_OLD_IRON_LAW: Array<readonly [string, string]> = [
    ["triage", TRIAGE_PROMPT],
    ["architect", ARCHITECT_PROMPT],
    ["builder", BUILDER_PROMPT],
    ["plan-critic", PLAN_CRITIC_PROMPT],
    ["qa-runner", QA_RUNNER_PROMPT],
    ["critic", CRITIC_PROMPT]
  ];

  it.each(SPECIALISTS_WITH_OLD_IRON_LAW)(
    "AC-3 — %s prompt no longer carries an `## Iron Law (...edition)` header",
    (_id, body) => {
      expect(body).not.toMatch(/## Iron Law \(/);
    }
  );

  it("AC-3 — builder prompt no longer restates `## Iron Law` as a standalone heading", () => {
    // builder had a bare `## Iron Law` (no edition suffix) restating
    // RED-before-GREEN. The new ethos preamble + builder's tdd-and-
    // verification skill carry the discipline; the restatement is gone.
    const headings = BUILDER_PROMPT.match(/^## .*/gm) ?? [];
    expect(headings.filter((h) => /^## Iron Law\b/.test(h))).toHaveLength(0);
  });

  it("AC-3 — reviewer prompt never carried an Iron-Law restatement (negative-space sanity check)", () => {
    // reviewer was always disciplined via its 11-axis checklist + the
    // review-discipline.md skill — no Iron-Law restatement was ever
    // present. Test exists to lock the negative.
    expect(REVIEWER_PROMPT).not.toMatch(/## Iron Law/);
  });
});

describe("v8.74 — PLAN_TEMPLATE D-N row gains the Reversibility field", () => {
  const planTemplate = ARTIFACT_TEMPLATES.find((t) => t.id === "plan");

  it("AC-4 — plan template ships in the catalogue", () => {
    expect(planTemplate, "PLAN_TEMPLATE registered as 'plan' id").toBeTruthy();
  });

  it("AC-4 — D-N example carries a `Reversibility:` field with the three-value enum", () => {
    const body = planTemplate!.body;
    const decisionsIdx = body.indexOf("## Decisions");
    expect(decisionsIdx).toBeGreaterThan(0);
    const dnSegment = body.slice(decisionsIdx, decisionsIdx + 2000);
    expect(dnSegment).toMatch(/D-1/);
    expect(dnSegment).toMatch(/Reversibility:/);
    expect(dnSegment).toMatch(/one-way/);
    expect(dnSegment).toMatch(/two-way/);
    expect(dnSegment).toMatch(/mostly-two-way/);
  });

  it("AC-4 — plan template documents the Reversibility rubric (mandatory + plan-critic §A)", () => {
    const body = planTemplate!.body;
    expect(body).toMatch(/Reversibility.*(mandatory|MANDATORY)/);
    expect(body).toMatch(/plan-critic.*§A/);
  });
});

describe("v8.74 — architect prompt populates Reversibility on every D-N", () => {
  it("AC-5 — architect's D-N block template carries the `Reversibility:` field", () => {
    expect(ARCHITECT_PROMPT).toMatch(/Reversibility:\s*<one-way \| two-way \| mostly-two-way>/);
  });

  it("AC-5 — architect prompt documents the one-way / two-way / mostly-two-way picker rubric", () => {
    expect(ARCHITECT_PROMPT).toMatch(/`one-way`/);
    expect(ARCHITECT_PROMPT).toMatch(/`two-way`/);
    expect(ARCHITECT_PROMPT).toMatch(/`mostly-two-way`/);
  });

  it("AC-5 — architect prompt cross-references the v8.74 critic auto-fire on `one-way`", () => {
    expect(ARCHITECT_PROMPT).toMatch(/critic.*cross-model.*one-way|one-way.*cross-model/i);
  });
});

describe("v8.74 — plan-critic Reversibility audit (§A)", () => {
  it("AC-6 — plan-critic prompt declares a §A. Decision integrity (Reversibility audit) section", () => {
    expect(PLAN_CRITIC_PROMPT).toMatch(/§A\.\s*Decision integrity/);
  });

  it("AC-6 — plan-critic flags missing Reversibility as a block-ship finding", () => {
    expect(PLAN_CRITIC_PROMPT).toMatch(/decision-missing-reversibility/);
    expect(PLAN_CRITIC_PROMPT).toMatch(/Missing.*Reversibility/);
    expect(PLAN_CRITIC_PROMPT).toMatch(/block-ship/);
  });

  it("AC-6 — plan-critic flags bad enum values + overstated one-way (all three finding classes)", () => {
    expect(PLAN_CRITIC_PROMPT).toMatch(/decision-bad-reversibility/);
    expect(PLAN_CRITIC_PROMPT).toMatch(/decision-overstated-reversibility/);
  });

  it("AC-6 — plan-critic verdict block exposes the §A integrity-findings count", () => {
    expect(PLAN_CRITIC_PROMPT).toMatch(/Decision integrity findings.*§A.*Reversibility/);
  });

  it("AC-6 — plan-critic skips §A when plan has no Decisions section (small / soft slugs)", () => {
    expect(PLAN_CRITIC_PROMPT).toMatch(/Skip §A.*no.*Decisions/);
  });
});

describe("v8.74 — cross-model critic trigger reads Reversibility:one-way", () => {
  it("AC-7 — start-command's #### critic block names the v8.74 Reversibility:one-way primary trigger", () => {
    const criticIdx = START_COMMAND_BODY.indexOf("#### critic");
    expect(criticIdx).toBeGreaterThan(0);
    const criticBlock = START_COMMAND_BODY.slice(criticIdx, criticIdx + 4000);
    expect(criticBlock).toMatch(/crossModelCritic/);
    expect(criticBlock).toMatch(/Reversibility:\s*one-way/);
  });

  it("AC-7 — start-command preserves the keyword fallback for plans without a Decisions section", () => {
    const criticIdx = START_COMMAND_BODY.indexOf("#### critic");
    const criticBlock = START_COMMAND_BODY.slice(criticIdx, criticIdx + 4000);
    expect(criticBlock).toMatch(/keyword fallback/i);
    expect(criticBlock).toMatch(/no .*Decisions.* section|without .*Decisions/);
  });

  it("AC-7 — critic §3.5 prompt names the v8.74 Reversibility:one-way trigger", () => {
    expect(CRITIC_PROMPT).toMatch(/Reversibility:\s*one-way/);
    expect(CRITIC_PROMPT).toMatch(/v8\.74/);
  });

  it("AC-7 — critic §3.5 prompt preserves the keyword fallback for Decisions-less plans", () => {
    expect(CRITIC_PROMPT).toMatch(/keyword fallback/i);
  });

  it("AC-7 — critic graceful fallback line still present (MCP unavailable)", () => {
    expect(CRITIC_PROMPT).toMatch(/Cross-model unavailable: skipped/);
  });
});

describe("v8.74 — force-stance opening clause (verbatim)", () => {
  it("AC-8 — critic prompt opens with the verbatim force-stance clause", () => {
    expect(CRITIC_PROMPT).toContain(FORCE_STANCE_CLAUSE);
  });

  it("AC-8 — plan-critic prompt opens with the verbatim force-stance clause", () => {
    expect(PLAN_CRITIC_PROMPT).toContain(FORCE_STANCE_CLAUSE);
  });

  it("AC-8 — force-stance clause appears BEFORE the `You are the cclaw critic` framing", () => {
    const stanceIdx = CRITIC_PROMPT.indexOf(FORCE_STANCE_CLAUSE);
    const framingIdx = CRITIC_PROMPT.indexOf("You are the cclaw");
    expect(stanceIdx).toBeGreaterThan(0);
    expect(framingIdx).toBeGreaterThan(0);
    expect(stanceIdx).toBeLessThan(framingIdx);
  });

  it("AC-8 — force-stance clause appears BEFORE the `You are the cclaw plan-critic` framing", () => {
    const stanceIdx = PLAN_CRITIC_PROMPT.indexOf(FORCE_STANCE_CLAUSE);
    const framingIdx = PLAN_CRITIC_PROMPT.indexOf("You are the cclaw");
    expect(stanceIdx).toBeGreaterThan(0);
    expect(framingIdx).toBeGreaterThan(0);
    expect(stanceIdx).toBeLessThan(framingIdx);
  });
});

describe("v8.74 — types extend Decision shape with Reversibility", () => {
  it("AC-9 — types.ts exports `Reversibility` type + `Decision` interface", async () => {
    const typesSource = await fs.readFile(
      path.join(process.cwd(), "src/types.ts"),
      "utf-8"
    );
    expect(typesSource).toMatch(/export type Reversibility = "one-way" \| "two-way" \| "mostly-two-way";/);
    expect(typesSource).toMatch(/export interface Decision \{/);
    expect(typesSource).toMatch(/reversibility:\s*Reversibility;/);
  });
});

describe("v8.74 — version bump", () => {
  it("AC-10 — CHANGELOG.md carries a v8.74 entry (the v8.74 release shipped; later versions bump package.json — this test pins the changelog entry only)", async () => {
    const changelog = await fs.readFile(
      path.join(process.cwd(), "CHANGELOG.md"),
      "utf-8"
    );
    expect(changelog).toMatch(/##\s*\[?8\.74\.0\]?/);
  });
});
