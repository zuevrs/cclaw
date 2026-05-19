import { promises as fs } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  AUTO_TRIGGER_SKILLS,
  buildAutoTriggerBlock,
  type GateEnvelope
} from "../../src/content/skills.js";
import { REVIEWER_PROMPT } from "../../src/content/specialist-prompts/reviewer.js";
import { ARCHITECT_PROMPT } from "../../src/content/specialist-prompts/architect.js";
import { BUILDER_PROMPT } from "../../src/content/specialist-prompts/builder.js";
import { PLAN_CRITIC_PROMPT } from "../../src/content/specialist-prompts/plan-critic.js";
import { START_COMMAND_BODY as START_COMMAND_PROMPT } from "../../src/content/start-command.js";
import { ARTIFACT_TEMPLATES } from "../../src/content/artifact-templates.js";
import {
  parseValidatesPayload,
  parseAssumptionRows,
  flipAssumptionRows,
  collectValidations,
  unvalidatedKaIds
} from "../../src/assumption-validation.js";

/**
 * v8.85 — Assumption-validation lite. Slimmed in v8.99 test-slim-down A2
 * to one WIRING + one BEHAVIOR + one SECTION CONTRACT test.
 */

const ASSUMPTION_COVERAGE_SKILL_ID = "reviewer-axis-assumption-coverage";

describe("v8.85 — assumption-validation wiring (skill registered + gate + GateEnvelope + buildAutoTriggerBlock filters)", () => {
  it("WIRING — `reviewer-axis-assumption-coverage` skill is registered under stages=['review'] with a gate predicate, the gate fires on walkAssumptionCoverageAxis:true only, and buildAutoTriggerBlock filters it correctly against the other 6 reviewer-axis pointers", () => {
    const skill = AUTO_TRIGGER_SKILLS.find((s) => s.id === ASSUMPTION_COVERAGE_SKILL_ID);
    expect(skill, "AUTO_TRIGGER_SKILLS must register reviewer-axis-assumption-coverage").toBeDefined();
    expect(skill!.stages).toEqual(["review"]);
    expect(typeof skill!.gate).toBe("function");
    expect(skill!.fileName).toBe(`${ASSUMPTION_COVERAGE_SKILL_ID}.md`);
    expect(skill!.body.length).toBeGreaterThan(3000);
    expect(skill!.body.startsWith("---\n")).toBe(true);
    expect(skill!.body).toMatch(/^name:\s*reviewer-axis-assumption-coverage$/m);

    const gate = skill!.gate!;
    expect(gate({ walkAssumptionCoverageAxis: true })).toBe(true);
    expect(gate({})).toBe(false);
    expect(gate({ walkAssumptionCoverageAxis: false })).toBe(false);
    expect(
      gate({
        walkQaEvidenceAxis: true,
        walkDesignQualityAxis: true,
        securityFlag: true,
        planHasNonFunctional: true,
        editDisciplineActive: true,
        walkScopeDriftAxis: true
      } as GateEnvelope)
    ).toBe(false);

    // buildAutoTriggerBlock filtering
    const withAssumption = buildAutoTriggerBlock("review", { walkAssumptionCoverageAxis: true });
    expect(withAssumption).toContain(ASSUMPTION_COVERAGE_SKILL_ID);
    expect(withAssumption).not.toContain("reviewer-axis-qa-evidence");
    const withoutAssumption = buildAutoTriggerBlock("review", {
      walkQaEvidenceAxis: true,
      walkDesignQualityAxis: true,
      securityFlag: true,
      planHasNonFunctional: true,
      editDisciplineActive: true,
      walkScopeDriftAxis: true
    });
    expect(withoutAssumption).not.toContain(ASSUMPTION_COVERAGE_SKILL_ID);
    expect(withoutAssumption).toContain("reviewer-axis-qa-evidence");
    expect(withoutAssumption).toContain("reviewer-axis-design-quality");

    // reviewer-axis cohort grew to ≥7 with assumption-coverage in the set
    const reviewerAxisSkills = AUTO_TRIGGER_SKILLS.filter((s) => s.id.startsWith("reviewer-axis-"));
    expect(reviewerAxisSkills.length).toBeGreaterThanOrEqual(7);
    expect(reviewerAxisSkills.map((s) => s.id)).toContain(ASSUMPTION_COVERAGE_SKILL_ID);
  });
});

describe("v8.85 — assumption-validation behavior (parse + flip + collect end-to-end pipeline)", () => {
  it("BEHAVIOR — parseValidatesPayload extracts KA-N ids from `verify(AC-N): passing` commits, parseAssumptionRows reads v8.85 + legacy rows out of plan.md, flipAssumptionRows rewrites unvalidated rows to `Status: validated by <sha>` idempotently, and collectValidations + unvalidatedKaIds chain end-to-end", () => {
    // parseValidatesPayload
    expect(parseValidatesPayload("verify(AC-3): passing\n\nvalidates: KA-2\nbench: 142ms")).toEqual(["KA-2"]);
    expect(parseValidatesPayload("verify(AC-3): passing\n\nvalidates: KA-2 KA-4")).toEqual(["KA-2", "KA-4"]);
    expect(parseValidatesPayload("verify(AC-3): passing\n\nvalidates: KA-2, KA-4")).toEqual(["KA-2", "KA-4"]);
    expect(parseValidatesPayload("verify(AC-3): passing\n\nValidates: KA-1")).toEqual(["KA-1"]);
    expect(parseValidatesPayload("green(SL-2): tooltip\n\nvalidates: KA-1")).toEqual([]);
    expect(parseValidatesPayload("verify(AC-3): passing")).toEqual([]);
    expect(parseValidatesPayload("verify(AC-3): passing\n\nvalidates: KA-1 KA-2 KA-1")).toEqual(["KA-1", "KA-2"]);
    expect(parseValidatesPayload("")).toEqual([]);

    const PLAN = [
      "# slug",
      "",
      "## Key assumptions to validate",
      "",
      "- **KA-1** — search p95 stays under 200ms under realistic load (high-stakes). Validate by: vitest bench at 100 RPS. Status: unvalidated.",
      "- **KA-2** — users prefer the inline preview over the modal preview. Validate by: A/B test. Status: validated by abc1234.",
      "- **KA-3** — Stripe API stays at v2024-09. Validate by: changelog check. Status: invalidated.",
      "",
      "## Spec",
      ""
    ].join("\n");
    const rows = parseAssumptionRows(PLAN);
    expect(rows).toHaveLength(3);
    expect(rows[0].id).toBe("KA-1");
    expect(rows[0].status).toBe("unvalidated");
    expect(rows[0].sha).toBeNull();
    expect(rows[0].highStakes).toBe(true);
    expect(rows[1].id).toBe("KA-2");
    expect(rows[1].status).toBe("validated");
    expect(rows[1].sha).toBe("abc1234");
    expect(rows[2].id).toBe("KA-3");
    expect(rows[2].status).toBe("invalidated");

    // legacy pre-v8.85 row (no KA-N id)
    const PLAN_LEGACY = [
      "# slug",
      "",
      "## Key assumptions to validate",
      "",
      "- **search p95 stays under 200ms** — Validate by: bench. Status: unvalidated.",
      ""
    ].join("\n");
    const legacyRows = parseAssumptionRows(PLAN_LEGACY);
    expect(legacyRows[0].id).toBeNull();
    expect(legacyRows[0].status).toBe("unvalidated");

    // flipAssumptionRows — idempotent
    const PLAN_FLIPS = [
      "## Key assumptions to validate",
      "",
      "- **KA-1** — bet 1. Validate by: bench. Status: unvalidated.",
      "- **KA-2** — bet 2. Validate by: A/B. Status: unvalidated.",
      ""
    ].join("\n");
    const once = flipAssumptionRows(PLAN_FLIPS, [{ kaId: "KA-1", sha: "abc1234" }]);
    expect(once).toContain("Status: validated by abc1234.");
    const twice = flipAssumptionRows(once, [{ kaId: "KA-1", sha: "abc1234" }]);
    expect(twice).toBe(once);
    // Unknown KA-N: silent no-op
    expect(flipAssumptionRows(PLAN_FLIPS, [{ kaId: "KA-99", sha: "abc1234" }])).toBe(PLAN_FLIPS);
    // First wins on duplicates
    const dups = flipAssumptionRows(PLAN_FLIPS, [
      { kaId: "KA-1", sha: "first123" },
      { kaId: "KA-1", sha: "second456" }
    ]);
    expect(dups).toContain("Status: validated by first123.");
    expect(dups).not.toContain("Status: validated by second456.");

    // collectValidations + unvalidatedKaIds
    const collected = collectValidations([
      { sha: "abc1234", message: "verify(AC-1): passing\n\nvalidates: KA-1" },
      { sha: "abc1234", message: "verify(AC-1): passing\n\nvalidates: KA-1" },
      { sha: "def5678", message: "verify(AC-2): passing\n\nvalidates: KA-2 KA-1" },
      { sha: "no-payload", message: "verify(AC-3): passing" }
    ]);
    expect(collected).toEqual([
      { kaId: "KA-1", sha: "abc1234" },
      { kaId: "KA-2", sha: "def5678" },
      { kaId: "KA-1", sha: "def5678" }
    ]);
    expect(unvalidatedKaIds(PLAN_FLIPS)).toEqual(["KA-1", "KA-2"]);
  });
});

describe("v8.85 — assumption-validation section contract (reviewer axis + plan/research/ship templates + architect/plan-critic/builder/start-command prompts)", () => {
  it("SECTION CONTRACT — reviewer.ts declares the gated `assumption-coverage` axis (v8.85) with KA-N finding + companion-skill pointer + slim-summary `av=N` counter, plan + research templates carry KA-N bullets, ship template carries `## Unvalidated assumptions`, and architect Phase 7.5 + plan-critic + builder + start-command all name the `validates: KA-N` payload", async () => {
    // v8.105 — axis-table row + dedicated stub heading both grew a
    // `v8.105 cap-at-consider` annotation; the v8.85 anchor remains.
    expect(REVIEWER_PROMPT).toMatch(/\|\s*`assumption-coverage`\s*\(\*\*gated\*\*\)\s*—\s*v8\.85/);
    expect(REVIEWER_PROMPT).toMatch(/^###\s+Assumption-coverage axis \(gated;\s*v8\.85;\s*v8\.105 cap-at-consider\)/m);
    expect(REVIEWER_PROMPT).toContain(ASSUMPTION_COVERAGE_SKILL_ID);
    expect(REVIEWER_PROMPT).toContain(`.cclaw/lib/skills/${ASSUMPTION_COVERAGE_SKILL_ID}.md`);
    expect(REVIEWER_PROMPT).toContain("KA-N: not validated by any commit despite high-stakes label");
    expect(REVIEWER_PROMPT).toMatch(/validates:\s*KA-N/);
    expect(REVIEWER_PROMPT).toMatch(/av=N/);
    expect(REVIEWER_PROMPT).not.toMatch(/Twelve-axis review/);

    const planEntry = ARTIFACT_TEMPLATES.find((t) => t.id === "plan")!;
    expect(planEntry.body).toMatch(/## Key assumptions to validate/);
    expect(planEntry.body).toMatch(/-\s+\*\*KA-1\*\*\s+—/);
    expect(planEntry.body).toMatch(/-\s+\*\*KA-2\*\*\s+—/);
    expect(planEntry.body).toMatch(/validates:\s*KA-N/);

    const researchEntry = ARTIFACT_TEMPLATES.find((t) => t.id === "research")!;
    expect(researchEntry.body).toMatch(/## Key assumptions to validate/);
    expect(researchEntry.body).toMatch(/-\s+\*\*KA-1\*\*\s+—/);

    const shipEntry = ARTIFACT_TEMPLATES.find((t) => t.id === "ship")!;
    expect(shipEntry.body).toMatch(/## Unvalidated assumptions/);
    expect(shipEntry.body).toContain("All key assumptions validated.");

    expect(ARCHITECT_PROMPT).toMatch(/`KA-N`/);
    expect(ARCHITECT_PROMPT).toMatch(/validates:\s*KA-N/);
    expect(PLAN_CRITIC_PROMPT).toContain("key-assumptions-no-id");
    expect(PLAN_CRITIC_PROMPT).toMatch(/KA-N/);
    expect(BUILDER_PROMPT).toMatch(/validates:\s*KA-N/);
    expect(BUILDER_PROMPT).toMatch(/assumption-validation\.ts/);
    expect(START_COMMAND_PROMPT).toMatch(/KA-N/);

    // v8.107 README rewrite removed per-axis name lists and the
    // `validates: KA-N` envelope phrasing (now lives in source prompts
    // + CHANGELOG, asserted by the source-of-truth checks above). One
    // axis-count regression guard remains so the rewrite never
    // re-introduces a stale axis-count claim.
    const readme = await fs.readFile(path.join(path.resolve(process.cwd()), "README.md"), "utf-8");
    expect(readme).not.toContain("12 axes");
  });
});
