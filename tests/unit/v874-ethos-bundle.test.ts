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
  PLAN_DESIGN_PROMPT,
  PLAN_DEVEX_PROMPT,
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

describe("v8.74 — ethos bundle wiring (single source of truth)", () => {
  it("WIRING — ETHOS_PRINCIPLES exports the 5 canonical principles in canonical order, CCLAW_ETHOS_BODY contains every principle title + Layer 1/2/3 vocabulary, ethosMarkdown is the source of CCLAW_ETHOS_BODY, types.ts exports Reversibility + Decision shape, and SPECIALIST_PROMPTS roster has 10 entries (the v8.62+v8.75+v8.77+v8.82 specialists)", async () => {
    expect(ETHOS_PRINCIPLES).toHaveLength(5);
    expect(ETHOS_PRINCIPLES.map((p) => p.id)).toEqual([
      "boil-the-lake",
      "search-before-building",
      "surgical-edits",
      "user-sovereignty",
      "three-knowledge-layers"
    ]);
    for (const title of ["Boil the Lake", "Search Before Building", "Surgical Edits", "User Sovereignty", "Three knowledge layers"]) {
      expect(CCLAW_ETHOS_BODY).toContain(title);
    }
    expect(CCLAW_ETHOS_BODY).toMatch(/Layer 1/);
    expect(CCLAW_ETHOS_BODY).toMatch(/Layer 2/);
    expect(CCLAW_ETHOS_BODY).toMatch(/Layer 3/);
    expect(ethosMarkdown()).toBe(CCLAW_ETHOS_BODY);

    const typesSource = await fs.readFile(path.join(process.cwd(), "src/types.ts"), "utf-8");
    expect(typesSource).toMatch(/export type Reversibility = "one-way" \| "two-way" \| "mostly-two-way";/);
    expect(typesSource).toMatch(/export interface Decision \{/);
    expect(typesSource).toMatch(/reversibility:\s*Reversibility;/);

    const installedIds = Object.keys(SPECIALIST_PROMPTS).sort();
    const specialists = [
      ["triage", TRIAGE_PROMPT],
      ["investigator", INVESTIGATOR_PROMPT],
      ["architect", ARCHITECT_PROMPT],
      ["builder", BUILDER_PROMPT],
      ["plan-critic", PLAN_CRITIC_PROMPT],
      ["plan-design", PLAN_DESIGN_PROMPT],
      ["plan-devex", PLAN_DEVEX_PROMPT],
      ["qa-runner", QA_RUNNER_PROMPT],
      ["reviewer", REVIEWER_PROMPT],
      ["critic", CRITIC_PROMPT]
    ] as const;
    expect(installedIds).toEqual(specialists.map(([id]) => id).slice().sort());
  });
});

describe("v8.74 — ethos preamble behavior (install writes the file + Iron-Law restatements removed)", () => {
  it("BEHAVIOR — initCclaw writes .cclaw/lib/cclaw-ethos.md with the canonical body, and the 6 pre-v8.74 specialists no longer carry `## Iron Law (<edition>)` restatements (builder + reviewer also clean)", async () => {
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

    for (const [, prompt] of [
      ["triage", TRIAGE_PROMPT],
      ["architect", ARCHITECT_PROMPT],
      ["builder", BUILDER_PROMPT],
      ["plan-critic", PLAN_CRITIC_PROMPT],
      ["qa-runner", QA_RUNNER_PROMPT],
      ["critic", CRITIC_PROMPT]
    ] as const) {
      expect(prompt).not.toMatch(/## Iron Law \(/);
    }
    const builderHeadings = (BUILDER_PROMPT.match(/^## .*/gm) ?? []).filter((h) => /^## Iron Law\b/.test(h));
    expect(builderHeadings).toHaveLength(0);
    expect(REVIEWER_PROMPT).not.toMatch(/## Iron Law/);
  });
});

describe("v8.74 — ethos + Reversibility + force-stance section contract", () => {
  it("SECTION CONTRACT — start-command body + dispatch-envelope runbook prepend the ethos read, PLAN_TEMPLATE D-N carries Reversibility:one-way|two-way|mostly-two-way (mandatory + plan-critic §A), architect + plan-critic + critic + start-command wire the v8.74 Reversibility:one-way trigger with keyword fallback, force-stance clause opens critic + plan-critic verbatim", () => {
    expect(START_COMMAND_BODY).toMatch(/cclaw-ethos\.md/);
    expect(START_COMMAND_BODY).toMatch(/Required ethos read/);
    const dispatchIdx = START_COMMAND_BODY.indexOf("### Dispatch envelope");
    const after = START_COMMAND_BODY.slice(dispatchIdx, dispatchIdx + 2000);
    expect(after).toMatch(/Ethos preamble/);
    expect(after).toMatch(/Boil the Lake/);
    expect(after).toMatch(/User Sovereignty/);

    const dispatchEnvelopeRunbook = ON_DEMAND_RUNBOOKS.find((r) => r.fileName === "dispatch-envelope.md");
    expect(dispatchEnvelopeRunbook).toBeTruthy();
    const dispatchBody = dispatchEnvelopeRunbook!.body;
    const ethosIdx = dispatchBody.indexOf("Required ethos read");
    const contractIdx = dispatchBody.indexOf("Required first read");
    expect(ethosIdx).toBeGreaterThan(0);
    expect(contractIdx).toBeGreaterThan(0);
    expect(ethosIdx).toBeLessThan(contractIdx);
    expect(dispatchBody).toContain("cclaw-ethos.md");

    // PLAN_TEMPLATE Reversibility rubric
    const planTemplate = ARTIFACT_TEMPLATES.find((t) => t.id === "plan")!;
    const decisionsIdx = planTemplate.body.indexOf("## Decisions");
    const dnSegment = planTemplate.body.slice(decisionsIdx, decisionsIdx + 2000);
    expect(dnSegment).toMatch(/D-1/);
    expect(dnSegment).toMatch(/Reversibility:/);
    expect(dnSegment).toMatch(/one-way/);
    expect(dnSegment).toMatch(/two-way/);
    expect(dnSegment).toMatch(/mostly-two-way/);
    expect(planTemplate.body).toMatch(/Reversibility.*(mandatory|MANDATORY)/);
    expect(planTemplate.body).toMatch(/plan-critic.*§A/);

    // architect declares the picker rubric + cross-model auto-fire
    expect(ARCHITECT_PROMPT).toMatch(/Reversibility:\s*<one-way \| two-way \| mostly-two-way>/);
    for (const enumVal of ["`one-way`", "`two-way`", "`mostly-two-way`"]) {
      expect(ARCHITECT_PROMPT).toContain(enumVal);
    }
    expect(ARCHITECT_PROMPT).toMatch(/critic.*cross-model.*one-way|one-way.*cross-model/i);

    // plan-critic §A Decision integrity (Reversibility audit)
    expect(PLAN_CRITIC_PROMPT).toMatch(/§A\.\s*Decision integrity/);
    expect(PLAN_CRITIC_PROMPT).toMatch(/decision-missing-reversibility/);
    expect(PLAN_CRITIC_PROMPT).toMatch(/decision-bad-reversibility/);
    expect(PLAN_CRITIC_PROMPT).toMatch(/decision-overstated-reversibility/);
    expect(PLAN_CRITIC_PROMPT).toMatch(/Skip §A.*no.*Decisions/);

    // critic + start-command Reversibility:one-way trigger + keyword fallback
    const criticIdx = START_COMMAND_BODY.indexOf("#### critic");
    const criticBlock = START_COMMAND_BODY.slice(criticIdx, criticIdx + 4000);
    expect(criticBlock).toMatch(/crossModelCritic/);
    expect(criticBlock).toMatch(/Reversibility:\s*one-way/);
    expect(criticBlock).toMatch(/keyword fallback/i);
    expect(CRITIC_PROMPT).toMatch(/Reversibility:\s*one-way/);
    expect(CRITIC_PROMPT).toMatch(/v8\.74/);
    expect(CRITIC_PROMPT).toMatch(/keyword fallback/i);
    expect(CRITIC_PROMPT).toMatch(/Cross-model unavailable: skipped/);

    // Force-stance clause opens critic + plan-critic verbatim, BEFORE the framing
    expect(CRITIC_PROMPT).toContain(FORCE_STANCE_CLAUSE);
    expect(PLAN_CRITIC_PROMPT).toContain(FORCE_STANCE_CLAUSE);
    expect(CRITIC_PROMPT.indexOf(FORCE_STANCE_CLAUSE)).toBeLessThan(CRITIC_PROMPT.indexOf("You are the cclaw"));
    expect(PLAN_CRITIC_PROMPT.indexOf(FORCE_STANCE_CLAUSE)).toBeLessThan(
      PLAN_CRITIC_PROMPT.indexOf("You are the cclaw")
    );
  });
});
