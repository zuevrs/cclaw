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
 * v8.84 — Not-Doing gate (scope-drift reviewer axis). Slimmed in v8.99
 * test-slim-down A2 to one WIRING + one BEHAVIOR + one SECTION CONTRACT.
 */

const PROJECT_ROOT = path.resolve(process.cwd());
const SKILLS_DIR = path.join(PROJECT_ROOT, "src/content/skills");
const SCOPE_DRIFT_SKILL_ID = "reviewer-axis-scope-drift";

describe("v8.84 — not-doing gate wiring (companion skill + AUTO_TRIGGER_SKILLS + GateEnvelope)", () => {
  it("WIRING — companion skill `reviewer-axis-scope-drift.md` on disk (≥3k chars, canonical frontmatter, `# Skill: reviewer-axis-scope-drift` body heading, four-signal protocol + severity grading + acknowledged-reversal exception + plan-amendment alternative + v8.80 closure + SD-N grammar); AUTO_TRIGGER_SKILLS registers stages=[review] + gate predicate firing on walkScopeDriftAxis=true (closed on empty/false/unrelated flags); GateEnvelope accepts walkScopeDriftAxis: true; reviewer-axis cohort ≥6 contains the v8.83 five + scope-drift and every entry follows the contract", async () => {
    const filePath = path.join(SKILLS_DIR, `${SCOPE_DRIFT_SKILL_ID}.md`);
    const stat = await fs.stat(filePath);
    expect(stat.isFile()).toBe(true);
    const skillBody = await fs.readFile(filePath, "utf8");
    expect(skillBody.length).toBeGreaterThan(3000);
    expect(skillBody.startsWith("---\n")).toBe(true);
    expect(skillBody).toMatch(/^name:\s*reviewer-axis-scope-drift$/m);
    expect(skillBody).toMatch(/^trigger:/m);
    expect(skillBody).toContain(`# Skill: ${SCOPE_DRIFT_SKILL_ID}`);
    // four-signal protocol
    expect(skillBody).toMatch(/file path/i);
    expect(skillBody).toMatch(/symbol/i);
    expect(skillBody).toMatch(/commit message/i);
    expect(skillBody).toMatch(/AC|slice/i);
    // severity grading
    expect(skillBody).toMatch(/0-3/);
    expect(skillBody).toMatch(/4-6/);
    expect(skillBody).toMatch(/7-10/);
    expect(skillBody).toMatch(/critical/);
    // acknowledged-reversal + plan-amendment + v8.80 closure
    expect(skillBody).toMatch(/acknowledged[- ]reversal|acknowledged.{1,40}reversal/i);
    expect(skillBody).toMatch(/fyi/);
    expect(skillBody).toMatch(/plan[- ]amendment|plan amendment|plan-amend/i);
    expect(skillBody).toMatch(/architect/i);
    expect(skillBody).toMatch(/## Not Doing \(and why\)/);
    expect(skillBody).toMatch(/plan-critic §6\.5|§6\.5/);
    expect(skillBody).toMatch(/v8\.80/);
    expect(skillBody).toContain("SD-N: <not-doing item> appears to be implemented despite exclusion");

    const skill = AUTO_TRIGGER_SKILLS.find((s) => s.id === SCOPE_DRIFT_SKILL_ID);
    expect(skill).toBeDefined();
    expect(skill!.stages).toEqual(["review"]);
    expect(typeof skill!.gate).toBe("function");
    expect(skill!.body.length).toBeGreaterThan(3000);
    expect(skill!.fileName).toBe(`${SCOPE_DRIFT_SKILL_ID}.md`);
    const gate = skill!.gate!;
    expect(gate({ walkScopeDriftAxis: true })).toBe(true);
    expect(gate({})).toBe(false);
    expect(gate({ walkScopeDriftAxis: false })).toBe(false);
    expect(
      gate({
        walkQaEvidenceAxis: true,
        walkDesignQualityAxis: true,
        securityFlag: true,
        planHasNonFunctional: true,
        editDisciplineActive: true
      })
    ).toBe(false);

    // GateEnvelope shape
    const env: GateEnvelope = { walkScopeDriftAxis: true };
    expect(skill!.gate!(env)).toBe(true);

    // reviewer-axis cohort
    const cohort = AUTO_TRIGGER_SKILLS.filter((s) => s.id.startsWith("reviewer-axis-"));
    expect(cohort.length).toBeGreaterThanOrEqual(6);
    for (const required of [
      "reviewer-axis-design-quality",
      "reviewer-axis-edit-discipline",
      "reviewer-axis-nfr-compliance",
      "reviewer-axis-qa-evidence",
      "reviewer-axis-scope-drift",
      "reviewer-axis-security"
    ]) {
      expect(cohort.map((s) => s.id)).toContain(required);
    }
    for (const sk of cohort) {
      expect(sk.stages).toEqual(["review"]);
      expect(typeof sk.gate).toBe("function");
      expect(sk.body.length).toBeGreaterThan(3000);
      expect(sk.fileName).toBe(`${sk.id}.md`);
    }
  });
});

describe("v8.84 — not-doing gate behavior (buildAutoTriggerBlock + README + version)", () => {
  it("BEHAVIOR — buildAutoTriggerBlock('review') legacy stage-only emits scope-drift (bypass); ('review', {walkScopeDriftAxis:true}) emits it; ('review', {}) filters it; envelope with other-axis flags only does NOT emit scope-drift but DOES emit the other five reviewer-axis skills; envelope with only walkScopeDriftAxis=true emits scope-drift and excludes the other five reviewer-axis pointers; README has `scope-drift` in gated-axis list + reviewer-axis-scope-drift cohort line + v8.84 + Not-Doing citation, no `11 axes` or `32 skills` baseline regression; package.json ≥8.89 + CHANGELOG v8.84 entry", async () => {
    expect(buildAutoTriggerBlock("review")).toContain(SCOPE_DRIFT_SKILL_ID);
    expect(buildAutoTriggerBlock("review", { walkScopeDriftAxis: true })).toContain(
      SCOPE_DRIFT_SKILL_ID
    );
    expect(buildAutoTriggerBlock("review", {})).not.toContain(SCOPE_DRIFT_SKILL_ID);

    const others: GateEnvelope = {
      walkQaEvidenceAxis: true,
      walkDesignQualityAxis: true,
      securityFlag: true,
      planHasNonFunctional: true,
      editDisciplineActive: true
    };
    const othersBlock = buildAutoTriggerBlock("review", others);
    expect(othersBlock).not.toContain(SCOPE_DRIFT_SKILL_ID);
    expect(othersBlock).toContain("reviewer-axis-qa-evidence");
    expect(othersBlock).toContain("reviewer-axis-design-quality");
    expect(othersBlock).toContain("reviewer-axis-security");
    expect(othersBlock).toContain("reviewer-axis-nfr-compliance");
    expect(othersBlock).toContain("reviewer-axis-edit-discipline");

    const onlyScope = buildAutoTriggerBlock("review", { walkScopeDriftAxis: true });
    expect(onlyScope).toContain(SCOPE_DRIFT_SKILL_ID);
    for (const otherAxis of [
      "reviewer-axis-qa-evidence",
      "reviewer-axis-design-quality",
      "reviewer-axis-security",
      "reviewer-axis-nfr-compliance",
      "reviewer-axis-edit-discipline"
    ]) {
      expect(onlyScope).not.toContain(otherAxis);
    }

    const readme = await fs.readFile(path.join(PROJECT_ROOT, "README.md"), "utf-8");
    // v8.107 README rewrite intentionally removed the inventory table, all
    // `v8.XX` annotations, and per-axis name lists. The reviewer-axis surface
    // is now pinned in CHANGELOG + source-of-truth prompts (asserted below
    // and in the SECTION CONTRACT block). Two cross-version regression guards
    // remain so the rewrite never re-introduces stale axis counts.
    expect(readme).not.toContain("11 axes");
    expect(readme).not.toContain("35 skills");

    const pkg = JSON.parse(
      await fs.readFile(path.join(PROJECT_ROOT, "package.json"), "utf-8")
    ) as { version: string };
    const [major, minor] = pkg.version.split(".").map((n) => Number.parseInt(n, 10));
    expect(major).toBe(8);
    expect(minor).toBeGreaterThanOrEqual(89);
    const changelog = await fs.readFile(path.join(PROJECT_ROOT, "CHANGELOG.md"), "utf-8");
    expect(changelog).toMatch(/v8\.84/);
    expect(changelog).toMatch(/Not[- ]Doing|scope[- ]drift/i);
  });
});

describe("v8.84 — not-doing gate section contract (reviewer.ts stub)", () => {
  it("SECTION CONTRACT — reviewer.ts mentions scope-drift but no longer carries 'Eleven-axis review' / 'Twelve-axis review' baseline; axis-table row names `scope-drift (**gated**) — v8.84`; dedicated stub heading `### Scope-drift axis (gated; v8.84)`; stub names companion skill + on-disk skill path (.cclaw/lib/skills/reviewer-axis-scope-drift.md); stub cites four-signal cross-reference (file path / symbol / commit message / AC-or-slice); stub cites `## Not Doing (and why)` canonical section name; stub uses SD-N canonical finding shape; stub explains v8.80 closure (plan-critic §6.5 + scope-drift); slim-summary axes counter carries optional gate-aware `sd=N` token and worked example carries `[sd=N]`; finding-dedup enum lists `scope-drift`", () => {
    expect(REVIEWER_PROMPT).toMatch(/scope-drift/);
    expect(REVIEWER_PROMPT).not.toMatch(/Eleven-axis review/);
    expect(REVIEWER_PROMPT).not.toMatch(/Twelve-axis review/);
    expect(REVIEWER_PROMPT).toMatch(/\|\s*`scope-drift`\s*\(\*\*gated\*\*\)\s*—\s*v8\.84/);
    expect(REVIEWER_PROMPT).toMatch(/^###\s+Scope-drift axis \(gated;\s*v8\.84\)/m);
    expect(REVIEWER_PROMPT).toContain(SCOPE_DRIFT_SKILL_ID);
    expect(REVIEWER_PROMPT).toContain(`.cclaw/lib/skills/${SCOPE_DRIFT_SKILL_ID}.md`);
    expect(REVIEWER_PROMPT).toMatch(/file path/i);
    expect(REVIEWER_PROMPT).toMatch(/symbol/);
    expect(REVIEWER_PROMPT).toMatch(/commit message/i);
    expect(REVIEWER_PROMPT).toMatch(/AC[- ]?(?:summary|title|text|or[- ]slice)/i);
    expect(REVIEWER_PROMPT).toMatch(/## Not Doing \(and why\)/);
    expect(REVIEWER_PROMPT).toContain("SD-N: <not-doing item> appears to be implemented despite exclusion");
    expect(REVIEWER_PROMPT).toMatch(/plan-critic §6\.5/);
    expect(REVIEWER_PROMPT).toMatch(/v8\.80/);
    expect(REVIEWER_PROMPT).toMatch(/sd=N/);
    expect(REVIEWER_PROMPT).toMatch(/`sd=N` is \*\*only\*\* present when the scope-drift gate fired/);
    expect(REVIEWER_PROMPT).toMatch(/\[sd=N\]/);
    expect(REVIEWER_PROMPT).toMatch(/\/\s*`scope-drift`\s*(?:\/|\))/u);
  });
});
