import { describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";

import { CCLAW_ETHOS_BODY, ETHOS_PRINCIPLES, ethosMarkdown } from "../../src/content/ethos.js";
import {
  ARCHITECT_PROMPT,
  BUILDER_PROMPT,
  CRITIC_PROMPT,
  INVESTIGATOR_PROMPT,
  PLAN_CRITIC_PROMPT,
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
 * Slimmed in v8.99 test-slim-down A2 to one WIRING + one BEHAVIOR + one
 * SECTION CONTRACT test.
 */

const FORCE_STANCE_CLAUSE =
  "Adversarial stance: Assume the artifact under review is flawed until evidence proves otherwise. Your starting hypothesis: this work will not deliver the stated goal. Look for disqualifying evidence first, then balance with what works.";

describe("v8.74 — ethos preamble + reversibility field wiring", () => {
  it("WIRING — ETHOS_PRINCIPLES exports the 5 canonical ids ([boil-the-lake, search-before-building, surgical-edits, user-sovereignty, three-knowledge-layers]); CCLAW_ETHOS_BODY = ethosMarkdown(); install layer writes .cclaw/lib/cclaw-ethos.md verbatim; SPECIALIST_PROMPTS roster equals the 8 specialists tested — v8.104 merged plan-design + plan-devex into plan-critic as rubric modes (ethos auto-prepended via dispatch envelope); plan template ships in catalogue; types.ts exports `Reversibility = one-way | two-way | mostly-two-way` + Decision.reversibility field", async () => {
    expect(ETHOS_PRINCIPLES).toHaveLength(5);
    expect(ETHOS_PRINCIPLES.map((p) => p.id)).toEqual([
      "boil-the-lake",
      "search-before-building",
      "surgical-edits",
      "user-sovereignty",
      "three-knowledge-layers"
    ]);
    expect(ethosMarkdown()).toBe(CCLAW_ETHOS_BODY);

    const specialists = [
      ["triage", TRIAGE_PROMPT],
      ["investigator", INVESTIGATOR_PROMPT],
      ["architect", ARCHITECT_PROMPT],
      ["builder", BUILDER_PROMPT],
      ["plan-critic", PLAN_CRITIC_PROMPT],
      ["qa-runner", QA_RUNNER_PROMPT],
      ["reviewer", REVIEWER_PROMPT],
      ["critic", CRITIC_PROMPT]
    ] as const;
    expect(specialists).toHaveLength(8);
    expect(Object.keys(SPECIALIST_PROMPTS).sort()).toEqual(
      specialists.map(([id]) => id).slice().sort()
    );

    // install layer
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

    expect(ARTIFACT_TEMPLATES.find((t) => t.id === "plan")).toBeTruthy();

    // types.ts
    const typesSource = await fs.readFile(path.join(process.cwd(), "src/types.ts"), "utf-8");
    expect(typesSource).toMatch(/export type Reversibility = "one-way" \| "two-way" \| "mostly-two-way";/);
    expect(typesSource).toMatch(/export interface Decision \{/);
    expect(typesSource).toMatch(/reversibility:\s*Reversibility;/);

    // CHANGELOG entry
    const changelog = await fs.readFile(path.join(process.cwd(), "CHANGELOG.md"), "utf-8");
    expect(changelog).toMatch(/##\s*\[?8\.74\.0\]?/);
  });
});

describe("v8.74 — ethos preamble + reversibility field behavior (plan template / architect / plan-critic / critic / cross-model trigger)", () => {
  it("BEHAVIOR — plan template carries `## Decisions` with D-N + Reversibility three-value enum (mandatory + plan-critic §A); architect prompt populates Reversibility on every D-N + cross-references the v8.74 cross-model critic auto-fire on one-way; plan-critic declares §A Decision integrity (Reversibility audit) with three finding classes (decision-missing-reversibility / decision-bad-reversibility / decision-overstated-reversibility), block-ship verdict + verdict-block exposes count + skips §A when no Decisions; start-command #### critic block + critic §3.5 prompt name the Reversibility:one-way primary trigger + keyword fallback + cross-model unavailable graceful fallback", () => {
    const planTemplate = ARTIFACT_TEMPLATES.find((t) => t.id === "plan")!;
    const body = planTemplate.body;
    const decisionsIdx = body.indexOf("## Decisions");
    expect(decisionsIdx).toBeGreaterThan(0);
    const dnSegment = body.slice(decisionsIdx, decisionsIdx + 2000);
    expect(dnSegment).toMatch(/D-1/);
    expect(dnSegment).toMatch(/Reversibility:/);
    expect(dnSegment).toMatch(/one-way/);
    expect(dnSegment).toMatch(/two-way/);
    expect(dnSegment).toMatch(/mostly-two-way/);
    expect(body).toMatch(/Reversibility.*(mandatory|MANDATORY)/);
    expect(body).toMatch(/plan-critic.*§A/);

    expect(ARCHITECT_PROMPT).toMatch(/Reversibility:\s*<one-way \| two-way \| mostly-two-way>/);
    expect(ARCHITECT_PROMPT).toMatch(/`one-way`/);
    expect(ARCHITECT_PROMPT).toMatch(/`two-way`/);
    expect(ARCHITECT_PROMPT).toMatch(/`mostly-two-way`/);
    expect(ARCHITECT_PROMPT).toMatch(/critic.*cross-model.*one-way|one-way.*cross-model/i);

    expect(PLAN_CRITIC_PROMPT).toMatch(/§2\.A\s+Decision integrity/);
    expect(PLAN_CRITIC_PROMPT).toMatch(/decision-missing-reversibility/);
    expect(PLAN_CRITIC_PROMPT).toMatch(/Missing.*Reversibility/);
    expect(PLAN_CRITIC_PROMPT).toMatch(/block-ship/);
    expect(PLAN_CRITIC_PROMPT).toMatch(/decision-bad-reversibility/);
    expect(PLAN_CRITIC_PROMPT).toMatch(/decision-overstated-reversibility/);
    expect(PLAN_CRITIC_PROMPT).toMatch(/Decision integrity findings \(§2\.A\)/);
    expect(PLAN_CRITIC_PROMPT).toMatch(/Decision integrity audit \(Reversibility/);
    expect(PLAN_CRITIC_PROMPT).toMatch(/Skip §2\.A.*no.*Decisions/);

    const criticIdx = START_COMMAND_BODY.indexOf("#### critic");
    expect(criticIdx).toBeGreaterThan(0);
    const criticBlock = START_COMMAND_BODY.slice(criticIdx, criticIdx + 4000);
    expect(criticBlock).toMatch(/crossModelCritic/);
    expect(criticBlock).toMatch(/Reversibility:\s*one-way/);
    expect(criticBlock).toMatch(/keyword fallback/i);
    expect(criticBlock).toMatch(/no .*Decisions.* section|without .*Decisions/);
    expect(CRITIC_PROMPT).toMatch(/Reversibility:\s*one-way/);
    expect(CRITIC_PROMPT).toMatch(/v8\.74/);
    expect(CRITIC_PROMPT).toMatch(/keyword fallback/i);
    expect(CRITIC_PROMPT).toMatch(/Cross-model unavailable: skipped/);
  });
});

describe("v8.74 — ethos preamble + force-stance section contract (ethos body + dispatch envelope + force-stance clause + Iron-Law removal)", () => {
  it("SECTION CONTRACT — CCLAW_ETHOS_BODY names the 5 principle titles + Layer 1/2/3 vocabulary; start-command body documents `Required ethos read` + Ethos preamble block (5 principle headers + 3 knowledge layers) under ### Dispatch envelope; dispatch-envelope runbook places ethos read above the agent contract; critic + plan-critic prompts open with the verbatim FORCE_STANCE_CLAUSE BEFORE the `You are the cclaw` framing; Iron-Law per-specialist restatements removed (triage / architect / builder / plan-critic / qa-runner / critic) — builder's bare `## Iron Law` heading gone; reviewer never carried one", () => {
    // ethos body
    for (const title of [
      "Boil the Lake",
      "Search Before Building",
      "Surgical Edits",
      "User Sovereignty",
      "Three knowledge layers"
    ]) {
      expect(CCLAW_ETHOS_BODY).toContain(title);
    }
    expect(CCLAW_ETHOS_BODY).toMatch(/Layer 1/);
    expect(CCLAW_ETHOS_BODY).toMatch(/Layer 2/);
    expect(CCLAW_ETHOS_BODY).toMatch(/Layer 3/);

    // start-command dispatch envelope
    expect(START_COMMAND_BODY).toMatch(/cclaw-ethos\.md/);
    expect(START_COMMAND_BODY).toMatch(/Required ethos read/);
    const dispatchIdx = START_COMMAND_BODY.indexOf("### Dispatch envelope");
    expect(dispatchIdx).toBeGreaterThan(0);
    const after = START_COMMAND_BODY.slice(dispatchIdx, dispatchIdx + 2000);
    expect(after).toMatch(/Ethos preamble/);
    for (const title of [
      "Boil the Lake",
      "Search Before Building",
      "Surgical Edits",
      "User Sovereignty"
    ]) {
      expect(after).toContain(title);
    }
    expect(after).toMatch(/3 knowledge layers/);

    // dispatch-envelope runbook
    const dispatchEnvelopeRunbook = ON_DEMAND_RUNBOOKS.find(
      (r) => r.fileName === "dispatch-envelope.md"
    )!;
    expect(dispatchEnvelopeRunbook).toBeTruthy();
    const rbBody = dispatchEnvelopeRunbook.body;
    const ethosIdx = rbBody.indexOf("Required ethos read");
    const contractIdx = rbBody.indexOf("Required first read");
    expect(ethosIdx).toBeGreaterThan(0);
    expect(contractIdx).toBeGreaterThan(0);
    expect(ethosIdx).toBeLessThan(contractIdx);
    expect(rbBody).toContain("cclaw-ethos.md");

    // Force-stance clause + ordering
    expect(CRITIC_PROMPT).toContain(FORCE_STANCE_CLAUSE);
    expect(PLAN_CRITIC_PROMPT).toContain(FORCE_STANCE_CLAUSE);
    for (const prompt of [CRITIC_PROMPT, PLAN_CRITIC_PROMPT]) {
      const stanceIdx = prompt.indexOf(FORCE_STANCE_CLAUSE);
      const framingIdx = prompt.indexOf("You are the cclaw");
      expect(stanceIdx).toBeGreaterThan(0);
      expect(framingIdx).toBeGreaterThan(0);
      expect(stanceIdx).toBeLessThan(framingIdx);
    }

    // Iron-Law removal
    for (const prompt of [
      TRIAGE_PROMPT,
      ARCHITECT_PROMPT,
      BUILDER_PROMPT,
      PLAN_CRITIC_PROMPT,
      QA_RUNNER_PROMPT,
      CRITIC_PROMPT
    ]) {
      expect(prompt).not.toMatch(/## Iron Law \(/);
    }
    const builderHeadings = BUILDER_PROMPT.match(/^## .*/gm) ?? [];
    expect(builderHeadings.filter((h) => /^## Iron Law\b/.test(h))).toHaveLength(0);
    expect(REVIEWER_PROMPT).not.toMatch(/## Iron Law/);
  });
});
