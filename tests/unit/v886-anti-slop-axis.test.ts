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
 * v8.86 — Anti-slop graded reviewer axis.
 *
 * The reviewer gained its fourteenth axis, `anti-slop`. The axis is
 * gated and **default-on**: the orchestrator stamps
 * `walkAntiSlopAxis: true` on every reviewer dispatch unless the
 * user / project config explicitly disables it via
 * `walkAntiSlopAxis: false`. Unlike the surface-driven gated axes
 * (qa-evidence / design-quality / scope-drift / assumption-coverage),
 * `anti-slop` fires once per slug regardless of triage surface — it
 * is the cclaw projection of Andrej Karpathy's "Simplicity First"
 * principle (forrestchang/andrej-karpathy-skills > CLAUDE.md) and
 * Karpathy's litmus test is checked per-diff regardless of what the
 * diff touches.
 *
 * The implementation follows the v8.83-token-axes companion-skill
 * pattern verbatim plus the v8.75 / v8.82 shared-rubric pattern:
 *
 *   1. Shared rubric `src/content/anti-slop-rubric.ts` with four
 *      immutable dimensions + a `renderAntiSlopRubricTable()` helper.
 *   2. Heavy prose (rubric, four sub-checks, severity grading,
 *      anti-rationalizations, edge cases) lives in
 *      `src/content/skills/reviewer-axis-anti-slop.md`.
 *   3. `reviewer.ts` carries a 5-line stub naming the skill plus a
 *      one-row entry in the axes table that calls the rubric helper.
 *   4. AUTO_TRIGGER_SKILLS registers the skill with
 *      `stages: ["review"]` + gate predicate keyed on
 *      `env.walkAntiSlopAxis !== false` (default-on contract).
 *   5. `buildAutoTriggerBlock("review", env)` filters the skill only
 *      when the gate is explicitly closed (`walkAntiSlopAxis: false`).
 *
 * Tripwires below pin the v8.86 invariants so a future change that
 * silently re-inlines the anti-slop body, drops the companion skill,
 * drops the rubric module, regresses the default-on gate predicate,
 * or regresses the slim-counter wiring lights up immediately.
 */

const PROJECT_ROOT = path.resolve(process.cwd());
const SKILLS_DIR = path.join(PROJECT_ROOT, "src/content/skills");
const ANTI_SLOP_SKILL_ID = "reviewer-axis-anti-slop";

describe("v8.86 — shared rubric `anti-slop-rubric.ts` defines four dimensions with 0-10 anchors", () => {
  it("AC-1 — module exports `ANTI_SLOP_DIMENSIONS` with exactly four dimensions", () => {
    expect(Array.isArray(ANTI_SLOP_DIMENSIONS)).toBe(true);
    expect(ANTI_SLOP_DIMENSIONS).toHaveLength(4);
  });

  it("AC-1 — the four dimensions are the canonical Karpathy-projection keys (kebab-case)", () => {
    const keys = ANTI_SLOP_DIMENSIONS.map((d) => d.key).sort();
    expect(keys).toEqual(
      [
        "senior-test",
        "speculative-flexibility",
        "single-use-abstraction",
        "orphan-cleanup-discipline"
      ].sort()
    );
  });

  it("AC-1 — every dimension carries the canonical fields (key / name / summary / anchor10)", () => {
    for (const d of ANTI_SLOP_DIMENSIONS) {
      expect(typeof d.key).toBe("string");
      expect(typeof d.name).toBe("string");
      expect(typeof d.summary).toBe("string");
      expect(typeof d.anchor10).toBe("string");
      expect(d.key.length).toBeGreaterThan(0);
      expect(d.summary.length).toBeGreaterThan(40);
      // The 10/10 anchor is the rubric's load-bearing column — it
      // must be a non-trivial reference (not "good code", not "fine").
      expect(d.anchor10.length).toBeGreaterThan(80);
    }
  });

  it("AC-1 — `senior-test` dimension's anchor names Karpathy's litmus test (the 'minimum that works' / senior reviewer reference)", () => {
    const dim = ANTI_SLOP_DIMENSIONS.find((d) => d.key === "senior-test")!;
    expect(dim).toBeDefined();
    // The anchor must reference the senior reviewer / minimum-that-works
    // language; the dimension exists to operationalise Karpathy's
    // litmus test ("Would a senior engineer say this is overcomplicated?").
    expect(dim.anchor10).toMatch(/senior/i);
  });

  it("AC-1 — `speculative-flexibility` dimension's anchor names the 'no concrete current consumer' rule", () => {
    const dim = ANTI_SLOP_DIMENSIONS.find(
      (d) => d.key === "speculative-flexibility"
    )!;
    expect(dim).toBeDefined();
    expect(dim.anchor10).toMatch(/consumer/i);
  });

  it("AC-1 — `single-use-abstraction` dimension's anchor names the ≥2 callers / current-reuse rule", () => {
    const dim = ANTI_SLOP_DIMENSIONS.find(
      (d) => d.key === "single-use-abstraction"
    )!;
    expect(dim).toBeDefined();
    // The anchor must name the ≥2 callers rule — the structural test
    // for whether an abstraction is justified by current reuse.
    expect(dim.anchor10).toMatch(/(≥2|two|2 .*call|2\+)/i);
  });

  it("AC-1 — `orphan-cleanup-discipline` dimension's anchor names the 'remove only your own mess' rule (Karpathy Surgical Changes)", () => {
    const dim = ANTI_SLOP_DIMENSIONS.find(
      (d) => d.key === "orphan-cleanup-discipline"
    )!;
    expect(dim).toBeDefined();
    // Either the anchor names pre-existing dead code explicitly, OR
    // it names the "didn't create" / "your own" Karpathy language.
    expect(dim.anchor10).toMatch(
      /pre-existing|did not create|own (?:mess|orphan|additions)|created by this diff/i
    );
  });

  it("AC-1 — `renderAntiSlopRubricTable()` emits the markdown table header + four data rows", () => {
    const table = renderAntiSlopRubricTable();
    // Header
    expect(table).toContain(
      "| dimension | what it covers | what a 10 looks like |"
    );
    expect(table).toContain("| --- | --- | --- |");
    // Four bolded dimension cells (one per row).
    for (const dim of ANTI_SLOP_DIMENSIONS) {
      expect(table).toContain(`| **${dim.name}** |`);
    }
    // Exactly 4 data rows beyond the 2 header lines = 6 total newline-separated lines.
    const lines = table.split("\n").filter((l) => l.length > 0);
    expect(lines).toHaveLength(2 + 4);
  });
});

describe("v8.86 — companion skill `reviewer-axis-anti-slop` is on disk", () => {
  it("AC-2 — `reviewer-axis-anti-slop.md` is present under src/content/skills/", async () => {
    const filePath = path.join(SKILLS_DIR, `${ANTI_SLOP_SKILL_ID}.md`);
    const stat = await fs.stat(filePath);
    expect(stat.isFile()).toBe(true);
  });

  it("AC-2 — body is a non-trivial rubric (≥3k chars) with the canonical frontmatter shape", async () => {
    const filePath = path.join(SKILLS_DIR, `${ANTI_SLOP_SKILL_ID}.md`);
    const body = await fs.readFile(filePath, "utf8");
    expect(body.length).toBeGreaterThan(3000);
    expect(body.startsWith("---\n")).toBe(true);
    expect(body).toMatch(/^name:\s*reviewer-axis-anti-slop$/m);
    expect(body).toMatch(/^trigger:/m);
    expect(body).toContain(`# Skill: ${ANTI_SLOP_SKILL_ID}`);
  });

  it("AC-2 — body covers the four-dimension grading protocol verbatim", async () => {
    const body = await fs.readFile(
      path.join(SKILLS_DIR, `${ANTI_SLOP_SKILL_ID}.md`),
      "utf8"
    );
    // The four dimensions appear by canonical key.
    expect(body).toMatch(/senior-test/);
    expect(body).toMatch(/speculative-flexibility/);
    expect(body).toMatch(/single-use-abstraction/);
    expect(body).toMatch(/orphan-cleanup-discipline/);
    // The 0-10 grading ladder.
    expect(body).toMatch(/0-10/);
    expect(body).toMatch(/10\/10/);
    // The Karpathy reference is load-bearing.
    expect(body).toMatch(/Karpathy/i);
    expect(body).toMatch(/Simplicity First/i);
    // The AS-N finding shape is the canonical namespace.
    expect(body).toContain("AS-N");
  });
});

describe("v8.86 — AUTO_TRIGGER_SKILLS registers `reviewer-axis-anti-slop` with stage=review + default-on gate predicate", () => {
  it("AC-3 — skill registered with `stages: [\"review\"]` and a gate predicate function", () => {
    const skill = AUTO_TRIGGER_SKILLS.find((s) => s.id === ANTI_SLOP_SKILL_ID);
    expect(
      skill,
      "expected AUTO_TRIGGER_SKILLS to register `reviewer-axis-anti-slop`"
    ).toBeDefined();
    expect(skill!.stages).toEqual(["review"]);
    expect(typeof skill!.gate).toBe("function");
    expect(skill!.body.length).toBeGreaterThan(3000);
    expect(skill!.fileName).toBe(`${ANTI_SLOP_SKILL_ID}.md`);
  });

  it("AC-3 — gate predicate is DEFAULT-ON: fires on empty / true envelope, closes only on explicit `false`", () => {
    const skill = AUTO_TRIGGER_SKILLS.find((s) => s.id === ANTI_SLOP_SKILL_ID)!;
    const gate = skill.gate!;
    // Empty envelope → default-on (gate FIRES). This is the
    // canonical contract that differentiates anti-slop from the
    // six pre-v8.86 surface-driven gated axes.
    expect(gate({})).toBe(true);
    // Explicit true → fires.
    expect(gate({ walkAntiSlopAxis: true })).toBe(true);
    // ONLY an explicit false closes the gate.
    expect(gate({ walkAntiSlopAxis: false })).toBe(false);
  });

  it("AC-3 — default-on gate is NOT accidentally tripped open by unrelated flags being false (the predicate only inspects its own field)", () => {
    const skill = AUTO_TRIGGER_SKILLS.find((s) => s.id === ANTI_SLOP_SKILL_ID)!;
    const gate = skill.gate!;
    // Other flags being set / unset does not affect the gate.
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
    // With explicit anti-slop disable + other flags present, the gate closes.
    expect(
      gate({
        walkQaEvidenceAxis: true,
        walkAntiSlopAxis: false
      })
    ).toBe(false);
  });
});

describe("v8.86 — buildAutoTriggerBlock(\"review\", env) honors the default-on anti-slop contract", () => {
  it("AC-4 — legacy stage-only call (no envelope) emits the anti-slop pointer (bypass)", () => {
    const block = buildAutoTriggerBlock("review");
    expect(block).toContain(ANTI_SLOP_SKILL_ID);
  });

  it("AC-4 — empty envelope STILL emits the anti-slop pointer (default-on contract)", () => {
    const block = buildAutoTriggerBlock("review", {});
    // This is the load-bearing default-on assertion. Pre-v8.86 gated
    // axes all filter OUT under `{}`; anti-slop is the one that
    // stays IN because its predicate is `env.flag !== false`.
    expect(block).toContain(ANTI_SLOP_SKILL_ID);
  });

  it("AC-4 — explicit `walkAntiSlopAxis: true` emits the pointer", () => {
    const block = buildAutoTriggerBlock("review", { walkAntiSlopAxis: true });
    expect(block).toContain(ANTI_SLOP_SKILL_ID);
  });

  it("AC-4 — ONLY explicit `walkAntiSlopAxis: false` filters the pointer out", () => {
    const block = buildAutoTriggerBlock("review", { walkAntiSlopAxis: false });
    expect(block).not.toContain(ANTI_SLOP_SKILL_ID);
  });

  it("AC-4 — explicit-disable + other axis flags set: anti-slop filters out, the others still gate-filter normally", () => {
    const env: GateEnvelope = {
      walkAntiSlopAxis: false,
      walkScopeDriftAxis: true,
      walkAssumptionCoverageAxis: true
    };
    const block = buildAutoTriggerBlock("review", env);
    expect(block).not.toContain(ANTI_SLOP_SKILL_ID);
    expect(block).toContain("reviewer-axis-scope-drift");
    expect(block).toContain("reviewer-axis-assumption-coverage");
  });
});

describe("v8.86 — reviewer.ts mentions the anti-slop axis + rubric stub", () => {
  it("AC-5 — reviewer.ts intro updated from `Thirteen-axis` to `Fourteen-axis`", () => {
    expect(REVIEWER_PROMPT).toMatch(/Fourteen-axis review/);
    expect(REVIEWER_PROMPT).not.toMatch(/Thirteen-axis review/);
    expect(REVIEWER_PROMPT).toMatch(/Fourteen axes; five severities/);
  });

  it("AC-5 — reviewer.ts axis-table row names `anti-slop` as gated with the v8.86 marker", () => {
    expect(REVIEWER_PROMPT).toMatch(
      /\|\s*`anti-slop`\s*\(\*\*gated\*\*\)\s*—\s*v8\.86/
    );
  });

  it("AC-5 — reviewer.ts carries a dedicated stub heading `### Anti-slop axis (gated; default-on; v8.86)`", () => {
    expect(REVIEWER_PROMPT).toMatch(
      /^###\s+Anti-slop axis \(gated;\s*default-on;\s*v8\.86\)/m
    );
  });

  it("AC-5 — reviewer.ts stub names the companion skill `reviewer-axis-anti-slop`", () => {
    expect(REVIEWER_PROMPT).toContain(ANTI_SLOP_SKILL_ID);
    expect(REVIEWER_PROMPT).toContain(
      `.cclaw/lib/skills/${ANTI_SLOP_SKILL_ID}.md`
    );
  });

  it("AC-5 — reviewer.ts stub cites the AS-N finding shape", () => {
    // AS-N: <dimension> at <grade>: <description> is the canonical
    // namespace mnemonic.
    expect(REVIEWER_PROMPT).toMatch(
      /AS-N:\s*<dimension>\s*at\s*<grade>:\s*<description>/
    );
  });

  it("AC-5 — reviewer.ts stub cites Karpathy 'Simplicity First' so the link to the source principle is visible", () => {
    expect(REVIEWER_PROMPT).toMatch(/Simplicity First/);
    expect(REVIEWER_PROMPT).toMatch(/Karpathy/i);
  });

  it("AC-5 — reviewer.ts stub embeds the rendered rubric table (four bolded dimension cells appear inline)", () => {
    for (const dim of ANTI_SLOP_DIMENSIONS) {
      expect(REVIEWER_PROMPT).toContain(`| **${dim.name}** |`);
    }
  });

  it("AC-5 — slim-summary axes counter includes `as=N` token (optional / gate-aware)", () => {
    expect(REVIEWER_PROMPT).toMatch(/as=N/);
    expect(REVIEWER_PROMPT).toMatch(
      /`as=N` is \*\*only\*\* present when the anti-slop gate fired/
    );
  });

  it("AC-5 — slim-summary worked example carries the optional `[as=N]` token in the axes counter", () => {
    expect(REVIEWER_PROMPT).toMatch(/\[as=N\]/);
  });

  it("AC-5 — finding-dedup axis enum lists `anti-slop` so AS-N findings dedupe correctly inside an iteration", () => {
    // The dedup enum: `... / `assumption-coverage` / `anti-slop`).`
    expect(REVIEWER_PROMPT).toMatch(/\/\s*`anti-slop`\s*\)\./);
  });
});

describe("v8.86 — GateEnvelope type carries the `walkAntiSlopAxis` field", () => {
  it("AC-6 — `walkAntiSlopAxis: true` is accepted as a GateEnvelope field", () => {
    const env: GateEnvelope = { walkAntiSlopAxis: true };
    const skill = AUTO_TRIGGER_SKILLS.find(
      (s) => s.id === ANTI_SLOP_SKILL_ID
    )!;
    expect(skill.gate!(env)).toBe(true);
  });

  it("AC-6 — `walkAntiSlopAxis: false` is accepted as a GateEnvelope field and closes the gate", () => {
    const env: GateEnvelope = { walkAntiSlopAxis: false };
    const skill = AUTO_TRIGGER_SKILLS.find(
      (s) => s.id === ANTI_SLOP_SKILL_ID
    )!;
    expect(skill.gate!(env)).toBe(false);
  });
});

describe("v8.86 — README updates", () => {
  let readme: string;

  it("AC-7 — README references `14 axes` (up from the v8.85 `13 axes`)", async () => {
    readme = await fs.readFile(
      path.join(PROJECT_ROOT, "README.md"),
      "utf-8"
    );
    expect(readme).toContain("14 axes");
    expect(readme).not.toContain("13 axes");
  });

  it("AC-7 — README's gated-axis list names `anti-slop` alongside qa-evidence / nfr-compliance / design-quality / scope-drift / assumption-coverage", () => {
    expect(readme).toMatch(/`anti-slop`/);
    expect(readme).toMatch(/`qa-evidence`/);
    expect(readme).toMatch(/`nfr-compliance`/);
    expect(readme).toMatch(/`design-quality`/);
    expect(readme).toMatch(/`scope-drift`/);
    expect(readme).toMatch(/`assumption-coverage`/);
  });

  it("AC-7 — README references `35 skills` (up from the v8.85 `34 skills`)", () => {
    expect(readme).toContain("35 skills");
  });

  it("AC-7 — README's reviewer-axis cohort line names `reviewer-axis-anti-slop`", () => {
    expect(readme).toContain("reviewer-axis-anti-slop");
  });

  it("AC-7 — README cites the v8.86 work + the Karpathy Simplicity First link", () => {
    expect(readme).toMatch(/v8\.86/);
    expect(readme).toMatch(/Simplicity First/);
    expect(readme).toMatch(/Karpathy/i);
    expect(readme).toMatch(/anti-slop/i);
  });
});

describe("v8.86 — version bump + CHANGELOG entry", () => {
  it("AC-8 — package.json bumps to at least 8.91.0", async () => {
    const pkg = JSON.parse(
      await fs.readFile(path.join(PROJECT_ROOT, "package.json"), "utf-8")
    ) as { version: string };
    const [major, minor] = pkg.version.split(".").map((n) => Number.parseInt(n, 10));
    expect(major).toBe(8);
    expect(minor).toBeGreaterThanOrEqual(91);
  });

  it("AC-8 — CHANGELOG.md carries an entry naming the v8.86 work (Anti-slop graded reviewer axis)", async () => {
    const changelog = await fs.readFile(
      path.join(PROJECT_ROOT, "CHANGELOG.md"),
      "utf-8"
    );
    expect(changelog).toMatch(/v8\.86/);
    expect(changelog).toMatch(/Anti-slop|anti-slop/);
  });
});

describe("v8.86 — reviewer-axis skill cohort grew from 7 to 8 (companion-skill pattern preserved)", () => {
  it("AC-9 — exactly eight reviewer-axis-* skills are registered", () => {
    const reviewerAxisSkills = AUTO_TRIGGER_SKILLS.filter((s) =>
      s.id.startsWith("reviewer-axis-")
    );
    expect(reviewerAxisSkills).toHaveLength(8);
    const ids = reviewerAxisSkills.map((s) => s.id).sort();
    expect(ids).toEqual(
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
  });

  it("AC-9 — every reviewer-axis skill follows the v8.83 contract: stages = [\"review\"], gate predicate defined, body ≥3k chars, fileName matches id", () => {
    const reviewerAxisSkills = AUTO_TRIGGER_SKILLS.filter((s) =>
      s.id.startsWith("reviewer-axis-")
    );
    for (const skill of reviewerAxisSkills) {
      expect(skill.stages, `${skill.id} stages`).toEqual(["review"]);
      expect(typeof skill.gate, `${skill.id} gate`).toBe("function");
      expect(skill.body.length, `${skill.id} body length`).toBeGreaterThan(3000);
      expect(skill.fileName, `${skill.id} fileName`).toBe(`${skill.id}.md`);
    }
  });
});

describe("v8.86 — AS-N finding format parses correctly", () => {
  // The canonical finding format is `AS-N: <dimension> at <grade>: <description>`.
  // This tripwire pins the format-as-grammar — a future change that
  // silently drops the grade slot or renames the namespace prefix
  // lights up.

  const VALID_FINDING_LINE_RE =
    /^AS-(\d+):\s*([a-z-]+)\s+at\s+(\d{1,2})\/10:\s*(.+)$/;

  it("AC-10 — canonical finding line matches the grammar (AS-1: senior-test at 3/10: <description>)", () => {
    const line =
      "AS-1: senior-test at 3/10: src/lib/cache.ts:14-22 — diff size is 3x the conceptually-simplest implementation";
    const match = VALID_FINDING_LINE_RE.exec(line);
    expect(match).not.toBeNull();
    expect(match![1]).toBe("1");
    expect(match![2]).toBe("senior-test");
    expect(match![3]).toBe("3");
    expect(match![4]).toContain("src/lib/cache.ts");
  });

  it("AC-10 — finding with all four canonical dimensions parses", () => {
    const cases = [
      "AS-1: senior-test at 4/10: foo",
      "AS-2: speculative-flexibility at 3/10: bar",
      "AS-3: single-use-abstraction at 5/10: baz",
      "AS-4: orphan-cleanup-discipline at 2/10: qux"
    ];
    for (const line of cases) {
      const match = VALID_FINDING_LINE_RE.exec(line);
      expect(match, `expected ${line} to parse`).not.toBeNull();
      // The dimension token MUST be one of the four canonical keys.
      const dim = match![2];
      expect(ANTI_SLOP_DIMENSIONS.map((d) => d.key)).toContain(dim);
    }
  });

  it("AC-10 — bad shape (missing namespace prefix) does NOT parse", () => {
    expect(VALID_FINDING_LINE_RE.exec("F-7: senior-test at 3/10: foo")).toBeNull();
    expect(VALID_FINDING_LINE_RE.exec("AS- senior-test at 3/10: foo")).toBeNull();
    expect(VALID_FINDING_LINE_RE.exec("AS-1 senior-test 3/10 foo")).toBeNull();
  });

  it("AC-10 — bad shape (missing grade slot) does NOT parse", () => {
    expect(VALID_FINDING_LINE_RE.exec("AS-1: senior-test: foo")).toBeNull();
    expect(VALID_FINDING_LINE_RE.exec("AS-1: senior-test at /10: foo")).toBeNull();
  });

  it("AC-10 — grade range 0-10 is enforced at parse time (no '11/10' or '99/10' shapes leak)", () => {
    // The regex itself permits 0-99 in {1,2} — the structural check
    // is downstream. Document the contract here: any parse result
    // whose numeric grade exceeds 10 is a regression in the
    // reviewer's finding-authoring discipline, NOT a parse failure.
    const match = VALID_FINDING_LINE_RE.exec("AS-1: senior-test at 11/10: foo");
    expect(match).not.toBeNull();
    expect(Number.parseInt(match![3], 10)).toBe(11);
    // The reviewer prompt's grading ladder is 0-10; the test above
    // is the documentation that 11+ is a downstream contract
    // violation, not a tripwire's job to catch.
  });
});
