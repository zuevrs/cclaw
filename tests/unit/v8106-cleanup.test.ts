import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  AUTO_TRIGGER_SKILLS,
  buildAutoTriggerBlock,
  renderDispatchSkillsIndex,
  type GateEnvelope
} from "../../src/content/skills.js";
import { ON_DEMAND_RUNBOOKS } from "../../src/content/runbooks-on-demand.js";
import { REVIEWER_PROMPT } from "../../src/content/specialist-prompts/reviewer.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, "../..");

/**
 * v8.106 — cleanup pass: vestigial skills + reviewer trim +
 * dispatch envelopes lazy.
 *
 * The earlier slim-summary skill+rubric work (v8.83 lift, v8.85
 * KA-N axis, v8.86 anti-slop axis) left three "reference-only"
 * skills in `AUTO_TRIGGER_SKILLS` whose actual logic moved into
 * other surfaces (the triage agent prompt + the triage-gate
 * on-demand runbook for triage-gate; the architect's Bootstrap
 * phase for pre-flight-assumptions; the start-command Detect
 * matrix + `runbooks/detect-matrix.md` for flow-resume). v8.106
 * retires those three skills + deletes their `.md` bodies (the
 * runbooks / agent prompts hold the canonical content).
 *
 * Same pass:
 * - `reviewer.ts` inline rubric tables for design-quality / anti-slop
 *   axes were duplicates of the shared `design-quality-rubric.ts` /
 *   `anti-slop-rubric.ts` consts AND the per-axis companion skill
 *   bodies (v8.83 lift). Inline tables are removed; only axis name +
 *   gate condition + canonical finding shape + "load companion skill"
 *   pointer remain in the reviewer prompt itself.
 * - `REVIEWER_DISPATCH_ENVELOPES` pre-computed table shrunk from 9
 *   shapes to 3 (no-flags / strict-baseline / UI+design); other
 *   shapes derive on-demand via the
 *   `buildAutoTriggerBlock(stage, gateEnvelope)` fall-back path
 *   (already wired by v8.96.1 G-2 fix infrastructure).
 */

const RETIRED_SKILL_IDS = [
  "triage-gate",
  "pre-flight-assumptions",
  "flow-resume"
] as const;

describe("v8.106 — cleanup (vestigial skills + reviewer trim + dispatch envelopes lazy)", () => {
  it("AC-1 — the three retired skill ids are no longer in AUTO_TRIGGER_SKILLS, the corresponding .md bodies are deleted, and the registry holds 33 entries (32 + v8.111 pre-commitment-predictions)", async () => {
    for (const id of RETIRED_SKILL_IDS) {
      const entry = AUTO_TRIGGER_SKILLS.find((s) => s.id === id);
      expect(
        entry,
        `retired skill ${id} should be absent from AUTO_TRIGGER_SKILLS`
      ).toBeUndefined();

      const skillPath = path.join(
        PROJECT_ROOT,
        "src",
        "content",
        "skills",
        `${id}.md`
      );
      await expect(
        fs.access(skillPath),
        `skill body ${id}.md should be deleted from src/content/skills/`
      ).rejects.toThrow();
    }

    // v8.111 added pre-commitment-predictions (→ 33); v8.112 added writing-skills (→ 34).
    expect(AUTO_TRIGGER_SKILLS.length).toBe(34);
  });

  it("AC-2 — the canonical replacement surfaces still carry the lifted logic (triage agent prompt, triage-gate runbook, start-command Detect matrix, architect Bootstrap)", async () => {
    const triageGateRunbook = ON_DEMAND_RUNBOOKS.find(
      (r) => r.id === "triage-gate"
    );
    expect(
      triageGateRunbook,
      "triage-gate runbook should still live in ON_DEMAND_RUNBOOKS (orchestrator-side procedure)"
    ).toBeDefined();
    expect(triageGateRunbook!.body).toMatch(/triage[- ]gate/i);

    const detectMatrixRunbook = ON_DEMAND_RUNBOOKS.find(
      (r) => r.id === "detect-matrix"
    );
    expect(
      detectMatrixRunbook,
      "detect-matrix runbook should carry the resume-picker logic that the retired flow-resume skill used to hold"
    ).toBeDefined();

    const triageAgentPrompt = await fs.readFile(
      path.join(PROJECT_ROOT, "src/content/specialist-prompts/triage.ts"),
      "utf-8"
    );
    expect(
      triageAgentPrompt,
      "triage agent prompt should carry the routing contract that the retired triage-gate skill used to hold"
    ).toMatch(/routing|triage/i);

    const architectAgentPrompt = await fs.readFile(
      path.join(PROJECT_ROOT, "src/content/specialist-prompts/architect.ts"),
      "utf-8"
    );
    expect(
      architectAgentPrompt,
      "architect agent prompt should carry the Bootstrap-phase assumption capture that the retired pre-flight-assumptions skill used to hold"
    ).toMatch(/Bootstrap/);
  });

  it("AC-3 — reviewer prompt char count is reduced ≥20% from the v8.105 baseline (inline rubric tables removed; companion-skill pointers remain)", async () => {
    // v8.105 reviewer.ts source baseline (pre-cleanup) was 86 057 chars
    // on the file at `src/content/specialist-prompts/reviewer.ts`; the
    // rendered REVIEWER_PROMPT was 93 353 chars. v8.106 trims the
    // duplicate rubric tables — target ≥20% reduction on the source.
    const reviewerSourcePath = path.join(
      PROJECT_ROOT,
      "src/content/specialist-prompts/reviewer.ts"
    );
    const reviewerSource = await fs.readFile(reviewerSourcePath, "utf-8");
    const V8_105_REVIEWER_SOURCE_BASELINE = 86057;
    const reduction =
      (V8_105_REVIEWER_SOURCE_BASELINE - reviewerSource.length) /
      V8_105_REVIEWER_SOURCE_BASELINE;
    expect(
      reduction,
      `reviewer.ts source should shrink ≥20% from v8.105 baseline (${V8_105_REVIEWER_SOURCE_BASELINE} chars); current is ${reviewerSource.length} chars, reduction=${(reduction * 100).toFixed(2)}%`
    ).toBeGreaterThanOrEqual(0.2);

    // The inline rubric helpers must not be re-imported.
    expect(reviewerSource).not.toMatch(/renderDesignQualityRubricTable/);
    expect(reviewerSource).not.toMatch(/renderDesignQualityAiSlopChecklist/);
    expect(reviewerSource).not.toMatch(/renderAntiSlopRubricTable/);

    // ...but the cold-dispatch scaffolding (gate condition + load
    // companion skill pointer + canonical finding shape) must stay so
    // a reviewer agent that has not yet loaded the companion knows
    // what to do.
    expect(REVIEWER_PROMPT).toContain("reviewer-axis-design-quality");
    expect(REVIEWER_PROMPT).toContain("reviewer-axis-anti-slop");
    expect(REVIEWER_PROMPT).toContain("reviewer-axis-scope-drift");
    expect(REVIEWER_PROMPT).toContain("reviewer-axis-assumption-coverage");
    expect(REVIEWER_PROMPT).toMatch(/SD-N:/);
    expect(REVIEWER_PROMPT).toMatch(/KA-N:/);
    expect(REVIEWER_PROMPT).toMatch(/AS-N:/);
  });

  it("AC-4 — REVIEWER_DISPATCH_ENVELOPES pre-computed table is shrunk from 9 shapes to ≤3 (no-flags / strict-baseline / UI+design)", async () => {
    // The pre-computed table is not exported. Read it off the
    // dispatch-skills-index runbook body, which renders one section
    // per cached envelope and is the only consumer.
    const dispatchSkillsIndex = ON_DEMAND_RUNBOOKS.find(
      (r) => r.id === "dispatch-skills-index"
    );
    expect(
      dispatchSkillsIndex,
      "dispatch-skills-index runbook should still exist"
    ).toBeDefined();

    const sectionHeadings =
      dispatchSkillsIndex!.body.match(/^### .+$/gm) ?? [];
    expect(
      sectionHeadings.length,
      `dispatch-skills-index should cache ≤3 envelope shapes (was 9 pre-v8.106); found ${sectionHeadings.length}: ${JSON.stringify(sectionHeadings)}`
    ).toBeLessThanOrEqual(3);

    // The three cached shapes are the highest-traffic ones.
    expect(dispatchSkillsIndex!.body).toMatch(/no flags/i);
    expect(dispatchSkillsIndex!.body).toMatch(/strict[- ]mode baseline/i);
    expect(dispatchSkillsIndex!.body).toMatch(/UI \/ design/i);

    // The runbook documents the fall-back contract for non-cached
    // shapes.
    expect(dispatchSkillsIndex!.body).toMatch(
      /buildAutoTriggerBlock|fall[- ]back|on[- ]disk.*reviewer\.md/i
    );
  });

  it("AC-5 — the lazy fall-back works: buildAutoTriggerBlock(stage, gateEnvelope) + renderDispatchSkillsIndex still produce a correct block for an envelope shape NOT in the cached three", () => {
    // A shape that v8.106 dropped from the cache:
    // security-sensitive (securityFlag: true on the strict baseline).
    const securitySensitive: GateEnvelope = {
      walkAntiSlopAxis: true,
      editDisciplineActive: true,
      walkScopeDriftAxis: true,
      walkAssumptionCoverageAxis: true,
      securityFlag: true
    };

    const block = buildAutoTriggerBlock("review", securitySensitive);
    expect(block, "fall-back block should be non-empty").toBeTruthy();
    expect(block).toContain("reviewer-axis-security");
    expect(block).toContain("reviewer-axis-anti-slop");
    expect(block).toContain("reviewer-axis-edit-discipline");
    expect(block).toContain("reviewer-axis-scope-drift");
    expect(block).toContain("reviewer-axis-assumption-coverage");
    // The companion skill that should NOT pin for this envelope.
    expect(block).not.toContain("reviewer-axis-design-quality");

    // renderDispatchSkillsIndex(stage, envelope, label) — the same
    // runtime the cached entries wrap — also works for arbitrary
    // shapes, proving the lazy path semantically matches the cached
    // fast path.
    const lazyEntry = renderDispatchSkillsIndex(
      "review",
      securitySensitive,
      "security-sensitive (lazy fall-back)"
    );
    expect(lazyEntry.label).toBe("security-sensitive (lazy fall-back)");
    expect(lazyEntry.activeSkillIds).toContain("reviewer-axis-security");
    expect(lazyEntry.activeSkillIds).not.toContain(
      "reviewer-axis-design-quality"
    );
  });

  it("AC-6 — version stamped to 8.106.x and CHANGELOG carries the v8.106 entry naming all three cleanup lifts", async () => {
    const pkg = JSON.parse(
      await fs.readFile(path.join(PROJECT_ROOT, "package.json"), "utf-8")
    ) as { version: string };
    const [major, minor] = pkg.version.split(".").map((n) => Number.parseInt(n, 10));
    expect(major).toBe(8);
    expect(minor).toBeGreaterThanOrEqual(106);

    const changelog = await fs.readFile(
      path.join(PROJECT_ROOT, "CHANGELOG.md"),
      "utf-8"
    );
    expect(changelog).toMatch(/v8\.106/);
    expect(changelog).toMatch(/triage[- ]gate|pre[- ]flight[- ]assumptions|flow[- ]resume/);
    expect(changelog).toMatch(/reviewer.*trim|inline rubric|rubric.*duplic/i);
    expect(changelog).toMatch(/dispatch[- ]envelopes?|REVIEWER_DISPATCH_ENVELOPES/i);
  });
});
