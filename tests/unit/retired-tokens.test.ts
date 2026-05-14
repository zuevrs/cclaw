import { describe, expect, it } from "vitest";
import { ANTIPATTERNS } from "../../src/content/antipatterns.js";
import { ARTIFACT_TEMPLATES } from "../../src/content/artifact-templates.js";
import { CORE_AGENTS } from "../../src/content/core-agents.js";
import { ON_DEMAND_RUNBOOKS } from "../../src/content/runbooks-on-demand.js";
import { AUTO_TRIGGER_SKILLS } from "../../src/content/skills.js";
import { SPECIALIST_PROMPTS } from "../../src/content/specialist-prompts/index.js";
import { STAGE_PLAYBOOKS } from "../../src/content/stage-playbooks.js";
import { START_COMMAND_BODY } from "../../src/content/start-command.js";

/**
 * v8.54 retired-tokens consolidated sweep.
 *
 * Replaces ~20 duplicate `.not.toContain("commit-helper")` /
 * `.not.toContain("--phase=")` assertions previously scattered across:
 *  - tests/unit/v840-cleanup.test.ts (10 assertions)
 *  - tests/unit/v823-no-git-fallback.test.ts
 *  - tests/unit/tdd-cycle.test.ts
 *  - tests/unit/stage-playbooks.test.ts
 *  - tests/unit/specialist-prompts.test.ts
 *  - tests/unit/skills.test.ts
 *
 * Single source of truth. If a new hook-era token needs to be banned in a
 * future migration, add one entry to RETIRED_TOKENS and the sweep extends
 * automatically across every shipped LLM-facing surface.
 *
 * Out of scope:
 *  - META_SKILL: keeps historical context like "v8.40 retired
 *    \`commit-helper.mjs\`" deliberately (the orchestrator reads the
 *    rationale, not as an instruction to call the hook).
 *  - design.ts specialist: teaches the LLM that brainstormer/architect
 *    were merged INTO design. Their names appear as "retired" labels.
 *  - Test-bench narrative (`stage-playbooks.ts` legacy-migration prose):
 *    documents the v8.14 transition deliberately.
 */

const RETIRED_TOKENS: ReadonlyArray<{ token: string; retiredAt: string; note?: string }> = [
  { token: "commit-helper", retiredAt: "v8.40", note: "hook surface removed in v8.40" },
  { token: "commit-helper.mjs", retiredAt: "v8.40" },
  { token: "--phase=", retiredAt: "v8.40", note: "hook CLI args removed with hook surface" }
];

const SHIPPED_SURFACES: ReadonlyArray<{ id: string; body: string }> = [
  ...AUTO_TRIGGER_SKILLS.map((s) => ({ id: `skill:${s.fileName}`, body: s.body })),
  ...Object.entries(SPECIALIST_PROMPTS).map(([id, body]) => ({ id: `specialist:${id}`, body })),
  ...ON_DEMAND_RUNBOOKS.map((r) => ({ id: `runbook:${r.fileName}`, body: r.body })),
  ...STAGE_PLAYBOOKS.map((p) => ({ id: `playbook:${p.id}`, body: p.body })),
  ...CORE_AGENTS.map((a) => ({
    id: `agent:${a.id}`,
    body: `${a.description ?? ""}\n\n${a.prompt ?? ""}`
  })),
  ...ARTIFACT_TEMPLATES.map((t) => ({ id: `template:${t.id}`, body: t.body ?? "" })),
  { id: "start-command", body: START_COMMAND_BODY },
  { id: "antipatterns", body: ANTIPATTERNS }
];

describe("retired tokens — consolidated sweep across shipped LLM-facing content (v8.54)", () => {
  for (const { token, retiredAt, note } of RETIRED_TOKENS) {
    it(`token "${token}" (retired ${retiredAt}${note ? `, ${note}` : ""}) appears in zero shipped surfaces`, () => {
      const offenders = SHIPPED_SURFACES.filter((s) => s.body.includes(token)).map((s) => s.id);
      expect(
        offenders,
        `Retired token "${token}" (retired ${retiredAt}) leaked into: ${offenders.join(", ")}`
      ).toEqual([]);
    });
  }

  it("RETIRED_TOKENS list is the documented set (tripwire — extending requires a deliberate change)", () => {
    expect(RETIRED_TOKENS.map((t) => t.token).sort()).toEqual(
      ["--phase=", "commit-helper", "commit-helper.mjs"].sort()
    );
  });
});
