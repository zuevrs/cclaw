import { promises as fs } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  AUTO_TRIGGER_SKILLS,
  buildAutoTriggerBlock,
  type GateEnvelope
} from "../../src/content/skills.js";
import { REVIEWER_PROMPT } from "../../src/content/specialist-prompts/reviewer.js";

/**
 * v8.84 — Not-Doing gate (scope-drift reviewer axis).
 *
 * The reviewer gained its twelfth axis, `scope-drift`. The axis is
 * gated: it fires when `walkScopeDriftAxis: true` is set on the
 * dispatch envelope — the orchestrator stamps the flag when
 * `flows/<slug>/plan.md > ## Not Doing (and why)` is non-empty
 * (always true post-v8.80 since plan-critic §6.5 blocks ship on
 * empty). The axis cross-references every Not-Doing bullet against
 * the shipped diff (file path / symbol / AC-or-slice text / commit
 * message signals) and files `SD-N: <not-doing item> appears to be
 * implemented despite exclusion` findings; ≥ medium signal strength
 * blocks ship in strict.
 *
 * The implementation follows the v8.83-token-axes companion-skill
 * pattern verbatim:
 *
 *   1. Heavy prose (rubric, four-signal protocol, severity grading,
 *      acknowledged-reversal exception, anti-rationalizations) lives
 *      in `src/content/skills/reviewer-axis-scope-drift.md`.
 *   2. `reviewer.ts` carries a 5-line stub naming the skill plus a
 *      one-row entry in the axes table.
 *   3. AUTO_TRIGGER_SKILLS registers the skill with
 *      `stages: ["review"]` + gate predicate keyed on
 *      `env.walkScopeDriftAxis === true`.
 *   4. `buildAutoTriggerBlock("review", env)` pins the skill only
 *      when the gate fires.
 *
 * Tripwires below pin the v8.84 invariants so a future change that
 * silently re-inlines the scope-drift body, drops the companion
 * skill, drops the gate predicate, or regresses the slim-counter
 * wiring lights up immediately.
 */

const PROJECT_ROOT = path.resolve(process.cwd());
const SKILLS_DIR = path.join(PROJECT_ROOT, "src/content/skills");
const SCOPE_DRIFT_SKILL_ID = "reviewer-axis-scope-drift";

describe("v8.84 — companion skill `reviewer-axis-scope-drift` is on disk", () => {
  it("AC-1 — `reviewer-axis-scope-drift.md` is present under src/content/skills/", async () => {
    const filePath = path.join(SKILLS_DIR, `${SCOPE_DRIFT_SKILL_ID}.md`);
    const stat = await fs.stat(filePath);
    expect(stat.isFile()).toBe(true);
  });

  it("AC-1 — body is a non-trivial rubric (≥3k chars) with the canonical frontmatter shape", async () => {
    const filePath = path.join(SKILLS_DIR, `${SCOPE_DRIFT_SKILL_ID}.md`);
    const body = await fs.readFile(filePath, "utf8");
    // Length pin — the v8.83 axes range 2k-3.5k chars; scope-drift
    // ships at ~12k chars (four-signal protocol + severity grading
    // + acknowledged-reversal exception + plan-amendment alternative
    // + anti-rationalizations + worked examples). We pin ≥3k to
    // catch a regression that silently empties out the body.
    expect(body.length).toBeGreaterThan(3000);
    // Frontmatter shape — same as every other reviewer-axis skill.
    expect(body.startsWith("---\n")).toBe(true);
    expect(body).toMatch(/^name:\s*reviewer-axis-scope-drift$/m);
    expect(body).toMatch(/^trigger:/m);
    // Body heading — the v8.83 tripwire asserts `# Skill: <id>` on
    // every reviewer-axis skill (see v883-token-axes.test.ts > AC-2).
    expect(body).toContain(`# Skill: ${SCOPE_DRIFT_SKILL_ID}`);
  });
});

describe("v8.84 — AUTO_TRIGGER_SKILLS registers `reviewer-axis-scope-drift` with stage=review + gate predicate", () => {
  it("AC-2 — skill registered with `stages: [\"review\"]` and a gate predicate function", () => {
    const skill = AUTO_TRIGGER_SKILLS.find((s) => s.id === SCOPE_DRIFT_SKILL_ID);
    expect(
      skill,
      "expected AUTO_TRIGGER_SKILLS to register `reviewer-axis-scope-drift`"
    ).toBeDefined();
    expect(skill!.stages).toEqual(["review"]);
    expect(typeof skill!.gate).toBe("function");
    // Body wired through the readSkill loader — same shape as the
    // v8.83 axes; assert the body is non-trivially loaded.
    expect(skill!.body.length).toBeGreaterThan(3000);
    expect(skill!.fileName).toBe(`${SCOPE_DRIFT_SKILL_ID}.md`);
  });

  it("AC-2 — gate predicate fires on `walkScopeDriftAxis: true`, stays closed on empty / false envelope", () => {
    const skill = AUTO_TRIGGER_SKILLS.find((s) => s.id === SCOPE_DRIFT_SKILL_ID)!;
    const gate = skill.gate!;
    expect(gate({ walkScopeDriftAxis: true })).toBe(true);
    expect(gate({})).toBe(false);
    expect(gate({ walkScopeDriftAxis: false })).toBe(false);
    // Unrelated flags do not accidentally trigger the gate — the
    // gate is keyed strictly on its own envelope field.
    expect(
      gate({
        walkQaEvidenceAxis: true,
        walkDesignQualityAxis: true,
        securityFlag: true,
        planHasNonFunctional: true,
        editDisciplineActive: true
      })
    ).toBe(false);
  });
});

describe("v8.84 — buildAutoTriggerBlock(\"review\", env) gate-filters scope-drift correctly", () => {
  it("AC-3 — legacy stage-only call (no envelope) emits the scope-drift pointer (bypass)", () => {
    const block = buildAutoTriggerBlock("review");
    expect(
      block,
      "legacy stage-only call must emit `reviewer-axis-scope-drift` (gate predicates only fire when a gateEnvelope is passed)"
    ).toContain(SCOPE_DRIFT_SKILL_ID);
  });

  it("AC-3 — `buildAutoTriggerBlock(\"review\", { walkScopeDriftAxis: true })` emits the scope-drift pointer", () => {
    const block = buildAutoTriggerBlock("review", { walkScopeDriftAxis: true });
    expect(block).toContain(SCOPE_DRIFT_SKILL_ID);
  });

  it("AC-3 — empty envelope filters scope-drift out (every gate predicate returns false on {})", () => {
    const block = buildAutoTriggerBlock("review", {});
    expect(block).not.toContain(SCOPE_DRIFT_SKILL_ID);
  });

  it("AC-3 — envelope with only the OTHER axis flags set (no scope-drift) does NOT emit the scope-drift pointer", () => {
    const env: GateEnvelope = {
      walkQaEvidenceAxis: true,
      walkDesignQualityAxis: true,
      securityFlag: true,
      planHasNonFunctional: true,
      editDisciplineActive: true
      // walkScopeDriftAxis intentionally omitted
    };
    const block = buildAutoTriggerBlock("review", env);
    expect(block).not.toContain(SCOPE_DRIFT_SKILL_ID);
    // Sanity: the other five reviewer-axis skills DO render.
    expect(block).toContain("reviewer-axis-qa-evidence");
    expect(block).toContain("reviewer-axis-design-quality");
    expect(block).toContain("reviewer-axis-security");
    expect(block).toContain("reviewer-axis-nfr-compliance");
    expect(block).toContain("reviewer-axis-edit-discipline");
  });

  it("AC-3 — envelope with ONLY `walkScopeDriftAxis: true` emits scope-drift and excludes the other five reviewer-axis pointers", () => {
    const block = buildAutoTriggerBlock("review", { walkScopeDriftAxis: true });
    expect(block).toContain(SCOPE_DRIFT_SKILL_ID);
    expect(block).not.toContain("reviewer-axis-qa-evidence");
    expect(block).not.toContain("reviewer-axis-design-quality");
    expect(block).not.toContain("reviewer-axis-security");
    expect(block).not.toContain("reviewer-axis-nfr-compliance");
    expect(block).not.toContain("reviewer-axis-edit-discipline");
  });
});

describe("v8.84 — reviewer.ts mentions the scope-drift axis + rubric stub + Not-Doing cross-reference logic", () => {
  it("AC-4 — reviewer.ts intro updated from `Eleven-axis` to `Twelve-axis`", () => {
    // The intro heading + naming sentence both move to the new
    // twelve-axis framing; the v8.83 release pinned "Eleven-axis"
    // and the v8.84 release moves it forward.
    expect(REVIEWER_PROMPT).toMatch(/Twelve-axis review/);
    expect(REVIEWER_PROMPT).not.toMatch(/Eleven-axis review/);
    expect(REVIEWER_PROMPT).toMatch(/Twelve axes; five severities/);
  });

  it("AC-4 — reviewer.ts axis-table row names `scope-drift` as gated with the v8.84 marker", () => {
    // The axis-table row carries the axis name, the `(**gated**)`
    // marker, and the v8.84 release marker for grep-ability.
    expect(REVIEWER_PROMPT).toMatch(
      /\|\s*`scope-drift`\s*\(\*\*gated\*\*\)\s*—\s*v8\.84/
    );
  });

  it("AC-4 — reviewer.ts carries a dedicated stub heading `### Scope-drift axis (gated; v8.84)`", () => {
    expect(REVIEWER_PROMPT).toMatch(
      /^###\s+Scope-drift axis \(gated;\s*v8\.84\)/m
    );
  });

  it("AC-4 — reviewer.ts stub names the companion skill `reviewer-axis-scope-drift`", () => {
    expect(REVIEWER_PROMPT).toContain(SCOPE_DRIFT_SKILL_ID);
    // The stub also cites the on-disk path inside `.cclaw/lib/skills/`
    // so the agent can grep the path verbatim.
    expect(REVIEWER_PROMPT).toContain(
      `.cclaw/lib/skills/${SCOPE_DRIFT_SKILL_ID}.md`
    );
  });

  it("AC-4 — reviewer.ts stub cites the four-signal cross-reference rubric (file path / symbol / AC-or-slice text / commit message)", () => {
    // The stub describes the four signal categories the axis walks
    // — this is the load-bearing rubric language. We pin the four
    // category names verbatim so a regression that silently drops
    // a category in the stub lights up.
    expect(REVIEWER_PROMPT).toMatch(/file path/i);
    expect(REVIEWER_PROMPT).toMatch(/symbol/);
    expect(REVIEWER_PROMPT).toMatch(/commit message/i);
    // AC-or-slice text — the stub language can carry either phrasing.
    expect(REVIEWER_PROMPT).toMatch(/AC[- ]?(?:summary|title|text|or[- ]slice)/i);
  });

  it("AC-4 — reviewer.ts stub cites the Not-Doing section by canonical name", () => {
    // The v8.80 promotion canonicalized the section as
    // `## Not Doing (and why)`. The stub MUST cite the canonical
    // name so the cross-reference logic anchors on the right plan
    // section.
    expect(REVIEWER_PROMPT).toMatch(/## Not Doing \(and why\)/);
  });

  it("AC-4 — reviewer.ts stub uses the canonical `SD-N` finding shape", () => {
    // The axis files findings as `SD-N: <not-doing item> appears
    // to be implemented despite exclusion`. The stub MUST carry
    // the exact wording so reviewers don't drift to ad-hoc shapes.
    expect(REVIEWER_PROMPT).toContain(
      "SD-N: <not-doing item> appears to be implemented despite exclusion"
    );
  });

  it("AC-4 — reviewer.ts stub explains the v8.80 closure (plan-critic §6.5 + scope-drift = full enforcement loop)", () => {
    // The closure sentence is the load-bearing rationale that
    // links plan-critic §6.5 (plan-time) and scope-drift
    // (review-time) into one enforcement contract. Pin the link
    // verbatim so a regression that severs the rationale lights up.
    expect(REVIEWER_PROMPT).toMatch(/plan-critic §6\.5/);
    expect(REVIEWER_PROMPT).toMatch(/v8\.80/);
  });

  it("AC-4 — slim-summary axes counter includes `sd=N` token (optional / gate-aware)", () => {
    // The slim-summary axes counter grew from
    //   `c=N tq=N r=N a=N cb=N s=N p=N ed=N qae=N dq=N`
    // to
    //   `c=N tq=N r=N a=N cb=N s=N p=N ed=N qae=N dq=N sd=N`.
    // Pin both the new token AND the gate-aware wording (omit on
    // legacy / inline) so a future regression that drops the
    // gating clause lights up.
    expect(REVIEWER_PROMPT).toMatch(/sd=N/);
    expect(REVIEWER_PROMPT).toMatch(
      /`sd=N` is \*\*only\*\* present when the scope-drift gate fired/
    );
  });

  it("AC-4 — slim-summary worked example carries the optional `[sd=N]` token in the axes counter", () => {
    // The slim-summary template in the worked-example section uses
    // bracketed optional tokens for gated axes (`[qae=N]` /
    // `[dq=N]`). Scope-drift must follow the same shape.
    expect(REVIEWER_PROMPT).toMatch(/\[sd=N\]/);
  });

  it("AC-4 — finding-dedup axis enum lists `scope-drift` so SD-N findings dedupe correctly inside an iteration", () => {
    // The dedup rule (see `## Finding dedup` in reviewer.ts) keys
    // on (axis, surface, normalized_one_liner) — and the axis
    // value must match one of the enumerated axes. Without
    // scope-drift in the enum, SD-N findings would never dedupe.
    expect(REVIEWER_PROMPT).toMatch(/\/\s*`scope-drift`\s*\)\./);
  });
});

describe("v8.84 — companion skill body covers the full rubric", () => {
  let body: string;

  it("AC-5 — body loads + covers the four-signal protocol verbatim", async () => {
    body = await fs.readFile(
      path.join(SKILLS_DIR, `${SCOPE_DRIFT_SKILL_ID}.md`),
      "utf8"
    );
    // The four signal categories — file path / symbol / AC-or-slice
    // text / commit message — are the load-bearing rubric.
    expect(body).toMatch(/file path/i);
    expect(body).toMatch(/symbol/i);
    expect(body).toMatch(/commit message/i);
    expect(body).toMatch(/AC|slice/i);
  });

  it("AC-5 — body covers the severity grading ladder (0-3 weak/consider, 4-6 medium/required, 7-10 strong/required, +1 tier on critical)", () => {
    expect(body).toMatch(/0-3/);
    expect(body).toMatch(/4-6/);
    expect(body).toMatch(/7-10/);
    expect(body).toMatch(/critical/);
  });

  it("AC-5 — body covers the acknowledged-reversal exception (downgrade to fyi when plan acknowledges the reversal)", () => {
    expect(body).toMatch(/acknowledged[- ]reversal|acknowledged.{1,40}reversal/i);
    expect(body).toMatch(/fyi/);
  });

  it("AC-5 — body covers the plan-amendment alternative fix path", () => {
    expect(body).toMatch(/plan[- ]amendment|plan amendment|plan-amend/i);
    expect(body).toMatch(/architect/i);
  });

  it("AC-5 — body cites the v8.80 contract (## Not Doing + plan-critic §6.5)", () => {
    expect(body).toMatch(/## Not Doing \(and why\)/);
    expect(body).toMatch(/plan-critic §6\.5|§6\.5/);
    expect(body).toMatch(/v8\.80/);
  });

  it("AC-5 — body carries the SD-N finding-shape grammar", () => {
    expect(body).toContain(
      "SD-N: <not-doing item> appears to be implemented despite exclusion"
    );
  });
});

describe("v8.84 — GateEnvelope type carries the `walkScopeDriftAxis` field with the canonical shape", () => {
  it("AC-6 — `walkScopeDriftAxis: true` is accepted as a GateEnvelope field at the type level (compile-time check via tsc)", () => {
    // This test does not directly probe the TypeScript type system
    // (vitest runs against transpiled JS), but it asserts the
    // runtime gate predicate honors the canonical field name —
    // which is the same contract the type-level shape enforces.
    // A regression that renames the field on the type side (e.g.
    // `notDoingActive` instead of `walkScopeDriftAxis`) would
    // light up both `tsc --noEmit` AND this assertion.
    const env: GateEnvelope = { walkScopeDriftAxis: true };
    const skill = AUTO_TRIGGER_SKILLS.find((s) => s.id === SCOPE_DRIFT_SKILL_ID)!;
    expect(skill.gate!(env)).toBe(true);
  });
});

describe("v8.84 — README updates", () => {
  let readme: string;

  it("AC-7 — README references `12 axes` (up from the v8.83 `11 axes`)", async () => {
    readme = await fs.readFile(
      path.join(PROJECT_ROOT, "README.md"),
      "utf-8"
    );
    expect(readme).toContain("12 axes");
    // No stale "11 axes" string left over from the v8.83 baseline.
    expect(readme).not.toContain("11 axes");
  });

  it("AC-7 — README's gated-axis list names `scope-drift` alongside qa-evidence / nfr-compliance / design-quality", () => {
    expect(readme).toMatch(/`scope-drift`/);
    // Sanity: the three pre-v8.84 gated axes still appear in the
    // same row (we are ADDING to the set, not replacing).
    expect(readme).toMatch(/`qa-evidence`/);
    expect(readme).toMatch(/`nfr-compliance`/);
    expect(readme).toMatch(/`design-quality`/);
  });

  it("AC-7 — README references `33 skills` (up from the v8.83 `32 skills`)", () => {
    expect(readme).toContain("33 skills");
  });

  it("AC-7 — README's reviewer-axis cohort line names `reviewer-axis-scope-drift`", () => {
    expect(readme).toContain("reviewer-axis-scope-drift");
  });

  it("AC-7 — README cites the v8.84 / Not-Doing connection so the docs explain WHY the axis exists", () => {
    // The README's reviewer-axis-summary line carries the v8.84
    // release marker AND the v8.80 closure rationale. Pin both
    // so future doc edits don't drop the explanation.
    expect(readme).toMatch(/v8\.84/);
    expect(readme).toMatch(/Not Doing|scope[- ]drift|## Not Doing/);
  });
});

describe("v8.84 — version bump + CHANGELOG entry", () => {
  it("AC-8 — package.json bumps to at least 8.89.0 (the v8.84-not-doing-gate slug ships in the v8.89 slot)", async () => {
    const pkg = JSON.parse(
      await fs.readFile(path.join(PROJECT_ROOT, "package.json"), "utf-8")
    ) as { version: string };
    const [major, minor] = pkg.version.split(".").map((n) => Number.parseInt(n, 10));
    expect(major).toBe(8);
    expect(minor).toBeGreaterThanOrEqual(89);
  });

  it("AC-8 — CHANGELOG.md carries an entry naming the v8.84 work (Not-Doing gate / scope-drift)", async () => {
    const changelog = await fs.readFile(
      path.join(PROJECT_ROOT, "CHANGELOG.md"),
      "utf-8"
    );
    // Either the slug name or the axis name must appear in the
    // changelog header band — the v8.84 release marker is the
    // canonical handle.
    expect(changelog).toMatch(/v8\.84/);
    expect(changelog).toMatch(/Not[- ]Doing|scope[- ]drift/i);
  });
});

describe("v8.84 — reviewer-axis skill cohort grew from 5 to 6 (companion-skill pattern preserved)", () => {
  it("AC-9 — exactly six reviewer-axis-* skills are registered (the v8.83 five + the v8.84 scope-drift)", () => {
    const reviewerAxisSkills = AUTO_TRIGGER_SKILLS.filter((s) =>
      s.id.startsWith("reviewer-axis-")
    );
    expect(reviewerAxisSkills).toHaveLength(6);
    const ids = reviewerAxisSkills.map((s) => s.id).sort();
    expect(ids).toEqual(
      [
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
