import { existsSync, promises as fs } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  AUTO_TRIGGER_SKILLS,
  buildAutoTriggerBlock,
  type GateEnvelope
} from "../../src/content/skills.js";
import { REVIEWER_PROMPT } from "../../src/content/specialist-prompts/reviewer.js";

/**
 * v8.84 → v8.113 — Not-Doing gate, FOLDED into the edit-discipline axis.
 *
 * v8.84 shipped `scope-drift` as a standalone gated reviewer axis with its
 * own companion skill. v8.113's 14→9-axis simplification FOLDED scope-drift
 * into `edit-discipline` (Sub-check 3): the standalone `reviewer-axis-scope-drift`
 * skill is deleted and its essential Not-Doing four-signal rubric moves into
 * `reviewer-axis-edit-discipline.md`. The check is NOT lost — it survives as a
 * sub-check under edit-discipline. The `walkScopeDriftAxis` GateEnvelope flag
 * is RETAINED as the Not-Doing plan-state signal (it no longer pins its own
 * skill).
 *
 * These three blocks assert the FOLD preserved coverage: the rubric, SD-N
 * grammar, severity grading, acknowledged-reversal exception, and
 * plan-amendment alternative all survive — now inside edit-discipline.
 */

const PROJECT_ROOT = path.resolve(process.cwd());
const SKILLS_DIR = path.join(PROJECT_ROOT, "src/content/skills");
const SCOPE_DRIFT_SKILL_ID = "reviewer-axis-scope-drift";
const EDIT_DISCIPLINE_SKILL_ID = "reviewer-axis-edit-discipline";

describe("v8.113 — not-doing gate folded into edit-discipline (skill retired; rubric preserved)", () => {
  it("WIRING — standalone `reviewer-axis-scope-drift` skill + .md are gone; the four-signal Not-Doing rubric (SD-N grammar + severity grading + acknowledged-reversal + plan-amendment + §6.5 closure) now lives in `reviewer-axis-edit-discipline.md`; walkScopeDriftAxis stays a valid GateEnvelope plan-state signal", async () => {
    // The standalone scope-drift axis is retired.
    expect(
      AUTO_TRIGGER_SKILLS.find((s) => s.id === SCOPE_DRIFT_SKILL_ID),
      "the standalone scope-drift axis skill must be retired"
    ).toBeUndefined();
    expect(
      existsSync(path.join(SKILLS_DIR, `${SCOPE_DRIFT_SKILL_ID}.md`)),
      "reviewer-axis-scope-drift.md must be deleted"
    ).toBe(false);

    // The essential Not-Doing rubric folds into edit-discipline.
    const editSkill = AUTO_TRIGGER_SKILLS.find(
      (s) => s.id === EDIT_DISCIPLINE_SKILL_ID
    );
    expect(editSkill, "edit-discipline axis absorbs the fold").toBeDefined();
    expect(editSkill!.stages).toEqual(["review"]);

    const body = await fs.readFile(
      path.join(SKILLS_DIR, `${EDIT_DISCIPLINE_SKILL_ID}.md`),
      "utf8"
    );
    // four-signal protocol
    expect(body).toMatch(/file[- ]path/i);
    expect(body).toMatch(/symbol/i);
    expect(body).toMatch(/commit[- ]message/i);
    expect(body).toMatch(/AC|slice/i);
    // severity grading
    expect(body).toMatch(/0-3/);
    expect(body).toMatch(/4-6/);
    expect(body).toMatch(/7-10/);
    // acknowledged-reversal + plan-amendment + §6.5 closure + SD-N grammar
    expect(body).toMatch(/acknowledged[- ]reversal/i);
    expect(body).toMatch(/\bfyi\b/);
    expect(body).toMatch(/plan[- ]amend/i);
    expect(body).toMatch(/architect/i);
    expect(body).toMatch(/## Not Doing \(and why\)/);
    expect(body).toMatch(/plan-critic §6\.5|§6\.5/);
    expect(body).toContain(
      "SD-N: <not-doing item> appears to be implemented despite exclusion"
    );

    // walkScopeDriftAxis stays a valid GateEnvelope field (plan-state
    // signal for the Not-Doing fold) but no longer pins its own skill.
    const env: GateEnvelope = { walkScopeDriftAxis: true };
    expect(env.walkScopeDriftAxis).toBe(true);
    expect(
      AUTO_TRIGGER_SKILLS.some((s) => s.gate && s.gate(env) && s.id === SCOPE_DRIFT_SKILL_ID)
    ).toBe(false);
  });
});

describe("v8.113 — not-doing gate behavior (no standalone scope-drift pointer; edit-discipline carries it)", () => {
  it("BEHAVIOR — buildAutoTriggerBlock never pins the retired scope-drift skill on any envelope; edit-discipline fires via editDisciplineActive and carries the folded check; README + package.json + CHANGELOG guards hold", async () => {
    expect(buildAutoTriggerBlock("review")).not.toContain(SCOPE_DRIFT_SKILL_ID);
    expect(
      buildAutoTriggerBlock("review", { walkScopeDriftAxis: true })
    ).not.toContain(SCOPE_DRIFT_SKILL_ID);
    expect(buildAutoTriggerBlock("review", {})).not.toContain(
      SCOPE_DRIFT_SKILL_ID
    );

    // walkScopeDriftAxis alone (no editDisciplineActive) pins nothing —
    // the flag is an inert plan-state signal now.
    const onlyScope = buildAutoTriggerBlock("review", {
      walkScopeDriftAxis: true
    });
    expect(onlyScope).not.toContain(EDIT_DISCIPLINE_SKILL_ID);

    // edit-discipline (which absorbed the fold) pins via its own flag.
    const editActive = buildAutoTriggerBlock("review", {
      editDisciplineActive: true
    });
    expect(editActive).toContain(EDIT_DISCIPLINE_SKILL_ID);

    const readme = await fs.readFile(
      path.join(PROJECT_ROOT, "README.md"),
      "utf-8"
    );
    expect(readme).not.toContain("11 axes");
    expect(readme).not.toContain("35 skills");

    const pkg = JSON.parse(
      await fs.readFile(path.join(PROJECT_ROOT, "package.json"), "utf-8")
    ) as { version: string };
    const [major, minor] = pkg.version.split(".").map((n) => Number.parseInt(n, 10));
    expect(major).toBe(8);
    expect(minor).toBeGreaterThanOrEqual(89);
    const changelog = await fs.readFile(
      path.join(PROJECT_ROOT, "CHANGELOG.md"),
      "utf-8"
    );
    expect(changelog).toMatch(/v8\.84/);
    expect(changelog).toMatch(/Not[- ]Doing|scope[- ]drift/i);
  });
});

describe("v8.113 — not-doing gate section contract (folded into reviewer.ts edit-discipline axis)", () => {
  it("SECTION CONTRACT — reviewer.ts carries NO standalone scope-drift axis row/stub or `sd=N` token; the edit-discipline axis absorbs scope-drift with the four-signal cross-reference, `## Not Doing (and why)` citation, SD-N finding shape, and plan-critic §6.5 closure; finding-dedup enum no longer lists scope-drift as a separate axis", () => {
    // No standalone scope-drift axis surface remains.
    expect(REVIEWER_PROMPT).not.toMatch(/^###\s+Scope-drift axis/m);
    expect(REVIEWER_PROMPT).not.toMatch(/\|\s*`scope-drift`\s*\(\*\*gated\*\*\)/);
    expect(REVIEWER_PROMPT).not.toContain(SCOPE_DRIFT_SKILL_ID);
    expect(REVIEWER_PROMPT).not.toMatch(/\bsd=N\b/);
    // scope-drift is no longer a standalone dedup-enum axis.
    expect(REVIEWER_PROMPT).not.toMatch(
      /`correctness`[^\n]*`scope-drift`[^\n]*`anti-slop`/
    );

    // ...but the check survives, folded under edit-discipline.
    expect(REVIEWER_PROMPT).toMatch(/Absorbs scope-drift/);
    expect(REVIEWER_PROMPT).toMatch(/## Not Doing \(and why\)/);
    expect(REVIEWER_PROMPT).toMatch(/file path/i);
    expect(REVIEWER_PROMPT).toMatch(/symbol/);
    expect(REVIEWER_PROMPT).toMatch(/commit message/i);
    expect(REVIEWER_PROMPT).toMatch(/AC[- ]or[- ]slice/i);
    expect(REVIEWER_PROMPT).toContain(
      "SD-N: <not-doing item> appears to be implemented despite exclusion"
    );
    expect(REVIEWER_PROMPT).toMatch(/plan-critic §6\.5/);
  });
});
