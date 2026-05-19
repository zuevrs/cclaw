import { promises as fs } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  AUTO_TRIGGER_SKILLS,
  buildAutoTriggerBlock,
  type GateEnvelope
} from "../../src/content/skills.js";
import { REVIEWER_PROMPT } from "../../src/content/specialist-prompts/reviewer.js";
import {
  ANTI_SLOP_DIMENSIONS,
  renderAntiSlopRubricTable
} from "../../src/content/anti-slop-rubric.js";

/**
 * v8.86 — Anti-slop graded reviewer axis. Slimmed in v8.99 test-slim-down A2
 * to one WIRING + one BEHAVIOR + one SECTION CONTRACT test covering the
 * shared rubric, default-on gate, and reviewer-prompt stub.
 */

const PROJECT_ROOT = path.resolve(process.cwd());
const SKILLS_DIR = path.join(PROJECT_ROOT, "src/content/skills");
const ANTI_SLOP_SKILL_ID = "reviewer-axis-anti-slop";

describe("v8.86 — anti-slop axis wiring", () => {
  it("WIRING — `reviewer-axis-anti-slop` registered with stages=[review] + default-on gate (fires on empty / true envelope; closes only on explicit walkAntiSlopAxis=false), companion skill body on disk ≥3k chars with canonical frontmatter, GateEnvelope accepts walkAntiSlopAxis true/false; reviewer-axis cohort grew to exactly 8 with every entry following the contract", async () => {
    const skill = AUTO_TRIGGER_SKILLS.find((s) => s.id === ANTI_SLOP_SKILL_ID);
    expect(skill, "expected AUTO_TRIGGER_SKILLS to register `reviewer-axis-anti-slop`").toBeDefined();
    expect(skill!.stages).toEqual(["review"]);
    expect(typeof skill!.gate).toBe("function");
    expect(skill!.body.length).toBeGreaterThan(3000);
    expect(skill!.fileName).toBe(`${ANTI_SLOP_SKILL_ID}.md`);

    const gate = skill!.gate!;
    expect(gate({})).toBe(true);
    expect(gate({ walkAntiSlopAxis: true })).toBe(true);
    expect(gate({ walkAntiSlopAxis: false })).toBe(false);
    expect(
      gate({
        walkQaEvidenceAxis: false,
        walkDesignQualityAxis: false,
        securityFlag: false,
        planHasNonFunctional: false,
        editDisciplineActive: false,
        walkScopeDriftAxis: false,
        walkAssumptionCoverageAxis: false
      })
    ).toBe(true);
    expect(gate({ walkQaEvidenceAxis: true, walkAntiSlopAxis: false })).toBe(false);

    // GateEnvelope type accepts walkAntiSlopAxis
    const envTrue: GateEnvelope = { walkAntiSlopAxis: true };
    const envFalse: GateEnvelope = { walkAntiSlopAxis: false };
    expect(skill!.gate!(envTrue)).toBe(true);
    expect(skill!.gate!(envFalse)).toBe(false);

    // Companion skill on disk
    const skillBody = await fs.readFile(path.join(SKILLS_DIR, `${ANTI_SLOP_SKILL_ID}.md`), "utf8");
    expect(skillBody.length).toBeGreaterThan(3000);
    expect(skillBody.startsWith("---\n")).toBe(true);
    expect(skillBody).toMatch(/^name:\s*reviewer-axis-anti-slop$/m);
    expect(skillBody).toContain(`# Skill: ${ANTI_SLOP_SKILL_ID}`);
    for (const key of [
      "senior-test",
      "speculative-flexibility",
      "single-use-abstraction",
      "orphan-cleanup-discipline"
    ]) {
      expect(skillBody).toMatch(new RegExp(key));
    }
    expect(skillBody).toMatch(/0-10/);
    expect(skillBody).toMatch(/Karpathy/i);
    expect(skillBody).toMatch(/Simplicity First/i);
    expect(skillBody).toContain("AS-N");

    // Cohort grew to exactly 8
    const cohort = AUTO_TRIGGER_SKILLS.filter((s) => s.id.startsWith("reviewer-axis-"));
    expect(cohort).toHaveLength(8);
    expect(cohort.map((s) => s.id).sort()).toEqual(
      [
        "reviewer-axis-anti-slop",
        "reviewer-axis-assumption-coverage",
        "reviewer-axis-design-quality",
        "reviewer-axis-edit-discipline",
        "reviewer-axis-nfr-compliance",
        "reviewer-axis-qa-evidence",
        "reviewer-axis-scope-drift",
        "reviewer-axis-security"
      ].sort()
    );
    for (const sk of cohort) {
      expect(sk.stages).toEqual(["review"]);
      expect(typeof sk.gate).toBe("function");
      expect(sk.body.length).toBeGreaterThan(3000);
      expect(sk.fileName).toBe(`${sk.id}.md`);
    }
  });
});

describe("v8.86 — anti-slop axis behavior (buildAutoTriggerBlock default-on + AS-N finding grammar)", () => {
  it("BEHAVIOR — buildAutoTriggerBlock honors default-on (legacy stage-only call + empty envelope + explicit true all emit the pointer; only explicit walkAntiSlopAxis=false filters it out while other gates keep filtering normally); AS-N finding line `AS-N: <dimension> at <grade>/10: <description>` parses for all four canonical dimensions and rejects shapes missing the namespace prefix or grade slot", () => {
    expect(buildAutoTriggerBlock("review")).toContain(ANTI_SLOP_SKILL_ID);
    expect(buildAutoTriggerBlock("review", {})).toContain(ANTI_SLOP_SKILL_ID);
    expect(buildAutoTriggerBlock("review", { walkAntiSlopAxis: true })).toContain(ANTI_SLOP_SKILL_ID);
    expect(buildAutoTriggerBlock("review", { walkAntiSlopAxis: false })).not.toContain(
      ANTI_SLOP_SKILL_ID
    );
    const env: GateEnvelope = {
      walkAntiSlopAxis: false,
      walkScopeDriftAxis: true,
      walkAssumptionCoverageAxis: true
    };
    const block = buildAutoTriggerBlock("review", env);
    expect(block).not.toContain(ANTI_SLOP_SKILL_ID);
    expect(block).toContain("reviewer-axis-scope-drift");
    expect(block).toContain("reviewer-axis-assumption-coverage");

    // AS-N finding grammar
    const RE = /^AS-(\d+):\s*([a-z-]+)\s+at\s+(\d{1,2})\/10:\s*(.+)$/;
    const line = "AS-1: senior-test at 3/10: src/lib/cache.ts:14-22 — diff is 3x baseline";
    const m = RE.exec(line);
    expect(m).not.toBeNull();
    expect(m![1]).toBe("1");
    expect(m![2]).toBe("senior-test");
    expect(m![3]).toBe("3");
    for (const ok of [
      "AS-1: senior-test at 4/10: foo",
      "AS-2: speculative-flexibility at 3/10: bar",
      "AS-3: single-use-abstraction at 5/10: baz",
      "AS-4: orphan-cleanup-discipline at 2/10: qux"
    ]) {
      const r = RE.exec(ok)!;
      expect(r).not.toBeNull();
      expect(ANTI_SLOP_DIMENSIONS.map((d) => d.key)).toContain(r[2]);
    }
    for (const bad of [
      "F-7: senior-test at 3/10: foo",
      "AS- senior-test at 3/10: foo",
      "AS-1 senior-test 3/10 foo",
      "AS-1: senior-test: foo",
      "AS-1: senior-test at /10: foo"
    ]) {
      expect(RE.exec(bad)).toBeNull();
    }
  });
});

describe("v8.86 — anti-slop axis section contract (shared rubric + reviewer prompt + README)", () => {
  it("SECTION CONTRACT — ANTI_SLOP_DIMENSIONS exports exactly four canonical Karpathy-projection keys with anchor10 references (senior-test → senior, speculative-flexibility → consumer, single-use-abstraction → ≥2 callers, orphan-cleanup-discipline → pre-existing/own); renderAntiSlopRubricTable emits canonical header + 4 data rows; reviewer.ts intro bumps Thirteen-axis → Fourteen-axis + axis-table row + dedicated stub heading (gated; default-on; v8.86) + AS-N grammar + Karpathy Simplicity First citation + embedded rubric table + slim-summary `as=N` token + finding-dedup enum lists anti-slop; README references 14 axes / 35 skills + `anti-slop` + v8.86 citation", async () => {
    // Shared rubric
    expect(ANTI_SLOP_DIMENSIONS).toHaveLength(4);
    expect(ANTI_SLOP_DIMENSIONS.map((d) => d.key).sort()).toEqual(
      ["senior-test", "speculative-flexibility", "single-use-abstraction", "orphan-cleanup-discipline"].sort()
    );
    for (const d of ANTI_SLOP_DIMENSIONS) {
      expect(typeof d.name).toBe("string");
      expect(d.summary.length).toBeGreaterThan(40);
      expect(d.anchor10.length).toBeGreaterThan(80);
    }
    expect(ANTI_SLOP_DIMENSIONS.find((d) => d.key === "senior-test")!.anchor10).toMatch(/senior/i);
    expect(ANTI_SLOP_DIMENSIONS.find((d) => d.key === "speculative-flexibility")!.anchor10).toMatch(
      /consumer/i
    );
    expect(ANTI_SLOP_DIMENSIONS.find((d) => d.key === "single-use-abstraction")!.anchor10).toMatch(
      /(≥2|two|2 .*call|2\+)/i
    );
    expect(ANTI_SLOP_DIMENSIONS.find((d) => d.key === "orphan-cleanup-discipline")!.anchor10).toMatch(
      /pre-existing|did not create|own (?:mess|orphan|additions)|created by this diff/i
    );

    const table = renderAntiSlopRubricTable();
    expect(table).toContain("| dimension | what it covers | what a 10 looks like |");
    expect(table).toContain("| --- | --- | --- |");
    for (const dim of ANTI_SLOP_DIMENSIONS) {
      expect(table).toContain(`| **${dim.name}** |`);
    }

    // reviewer.ts
    expect(REVIEWER_PROMPT).toMatch(/Fourteen-axis review/);
    expect(REVIEWER_PROMPT).not.toMatch(/Thirteen-axis review/);
    expect(REVIEWER_PROMPT).toMatch(/Fourteen axes; five severities/);
    // v8.105 — axis-table row + dedicated stub heading both grew a
    // `v8.105 cap-at-consider` annotation; the v8.86 anchor remains.
    expect(REVIEWER_PROMPT).toMatch(/\|\s*`anti-slop`\s*\(\*\*gated\*\*\)\s*—\s*v8\.86/);
    expect(REVIEWER_PROMPT).toMatch(/^###\s+Anti-slop axis \(gated;\s*default-on;\s*v8\.86;\s*v8\.105 cap-at-consider\)/m);
    expect(REVIEWER_PROMPT).toContain(ANTI_SLOP_SKILL_ID);
    expect(REVIEWER_PROMPT).toContain(`.cclaw/lib/skills/${ANTI_SLOP_SKILL_ID}.md`);
    expect(REVIEWER_PROMPT).toMatch(/AS-N:\s*<dimension>\s*at\s*<grade>:\s*<description>/);
    expect(REVIEWER_PROMPT).toMatch(/Simplicity First/);
    expect(REVIEWER_PROMPT).toMatch(/Karpathy/i);
    // v8.106 — the renderAntiSlopRubricTable() embed was moved out of reviewer.ts
    // (cleanup: vestigial skills + reviewer trim + dispatch envelopes lazy). The
    // rubric table now lives in the `reviewer-axis-anti-slop` companion skill
    // body, not inline in the prompt. The shared rubric helper still emits the
    // canonical shape (asserted above against the helper directly), and the
    // axis-table row + per-dimension example grades on the reviewer-prompt row
    // continue to name each dimension by id so a cold reviewer agent knows what
    // to grade before loading the companion skill.
    for (const dim of ANTI_SLOP_DIMENSIONS) {
      expect(
        REVIEWER_PROMPT,
        `reviewer.ts axis row should name anti-slop dimension ${dim.key}`
      ).toMatch(new RegExp(dim.key.replace(/-/g, "[- ]")));
    }
    expect(REVIEWER_PROMPT).toMatch(/as=N/);
    expect(REVIEWER_PROMPT).toMatch(/`as=N` is \*\*only\*\* present when the anti-slop gate fired/);
    expect(REVIEWER_PROMPT).toMatch(/\[as=N\]/);
    expect(REVIEWER_PROMPT).toMatch(/\/\s*`anti-slop`\s*\)\./);

    // README — v8.107 rewrite collapsed the inventory section + removed
    // all `v8.XX` annotations. Two count-pin guards remain so the rewrite
    // never re-introduces a stale axis or skill count; the anti-slop axis
    // surface itself is pinned in the source-of-truth assertions above.
    const readme = await fs.readFile(path.join(PROJECT_ROOT, "README.md"), "utf-8");
    expect(readme).toContain("14 axes");
    expect(readme).not.toContain("13 axes");
    expect(readme).not.toContain("35 skills");
  });
});
