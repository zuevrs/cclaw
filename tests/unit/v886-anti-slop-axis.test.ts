import { existsSync } from "node:fs";
import { promises as fs } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  AUTO_TRIGGER_SKILLS,
  buildAutoTriggerBlock
} from "../../src/content/skills.js";
import { REVIEWER_PROMPT } from "../../src/content/specialist-prompts/reviewer.js";

/**
 * v8.86 → v8.113 — the graded `anti-slop` reviewer axis is RETIRED.
 *
 * v8.86 introduced `anti-slop` as a cap-at-`consider` advisory reviewer
 * axis (it could never block ship). v8.113 cut it outright as part of the
 * 14-axis → 9-axis simplification: removing an advisory-only axis changes
 * no ship decision, so the axis, its companion skill, and the shared
 * `anti-slop-rubric.ts` const are all gone.
 *
 * This file inverts the original wiring assertions into retirement
 * tripwires (mirrors `tests/unit/retired-tokens.test.ts`): the axis must
 * leave NO trace on the reviewer surface. The distinct always-on
 * `anti-slop` stage skill (the redundant-verification / silent-skip guard,
 * id `anti-slop`) is unrelated and SURVIVES — guarded explicitly below so a
 * future cleanup doesn't conflate the two.
 */

const PROJECT_ROOT = path.resolve(process.cwd());
const SKILLS_DIR = path.join(PROJECT_ROOT, "src/content/skills");
const RETIRED_AXIS_SKILL_ID = "reviewer-axis-anti-slop";

describe("v8.113 — anti-slop reviewer axis is retired (no registry / file trace)", () => {
  it("RETIREMENT — `reviewer-axis-anti-slop` is not registered, its .md skill + `anti-slop-rubric.ts` are deleted, and the reviewer-axis cohort is the surviving five", () => {
    expect(
      AUTO_TRIGGER_SKILLS.find((s) => s.id === RETIRED_AXIS_SKILL_ID),
      "the retired `reviewer-axis-anti-slop` axis must not be registered"
    ).toBeUndefined();

    expect(
      existsSync(path.join(SKILLS_DIR, `${RETIRED_AXIS_SKILL_ID}.md`)),
      "the companion skill `reviewer-axis-anti-slop.md` must be deleted"
    ).toBe(false);

    expect(
      existsSync(path.join(PROJECT_ROOT, "src/content/anti-slop-rubric.ts")),
      "the dead `anti-slop-rubric.ts` const module must be deleted"
    ).toBe(false);

    const cohort = AUTO_TRIGGER_SKILLS.filter((s) =>
      s.id.startsWith("reviewer-axis-")
    );
    expect(cohort.map((s) => s.id).sort()).toEqual(
      [
        "reviewer-axis-design-quality",
        "reviewer-axis-edit-discipline",
        "reviewer-axis-nfr-compliance",
        "reviewer-axis-qa-evidence",
        "reviewer-axis-security"
      ].sort()
    );
  });

  it("RETIREMENT — the distinct always-on `anti-slop` stage skill (silent-skip guard) is unaffected", () => {
    const alwaysOn = AUTO_TRIGGER_SKILLS.find((s) => s.id === "anti-slop");
    expect(
      alwaysOn,
      "the always-on `anti-slop` guard skill is a different skill and must survive"
    ).toBeDefined();
    expect(alwaysOn!.stages).toEqual(["always"]);
    expect(alwaysOn!.gate).toBeUndefined();
  });
});

describe("v8.113 — anti-slop axis leaves no trace on the reviewer prompt", () => {
  it("RETIREMENT — reviewer.ts carries no anti-slop axis row, stub section, `as=N` slim token, or AS-N grammar", () => {
    expect(REVIEWER_PROMPT).not.toMatch(/\|\s*`anti-slop`\s*\(\*\*gated\*\*/);
    expect(REVIEWER_PROMPT).not.toMatch(/^###\s+Anti-slop axis/m);
    expect(REVIEWER_PROMPT).not.toContain(RETIRED_AXIS_SKILL_ID);
    expect(REVIEWER_PROMPT).not.toContain(
      `.cclaw/lib/skills/${RETIRED_AXIS_SKILL_ID}.md`
    );
    expect(REVIEWER_PROMPT).not.toMatch(/\bas=N\b/);
    expect(REVIEWER_PROMPT).not.toMatch(/AS-N:/);
    expect(REVIEWER_PROMPT).not.toMatch(/Fourteen-axis review/);
    expect(REVIEWER_PROMPT).toMatch(/Nine-axis review/);
  });

  it("RETIREMENT — buildAutoTriggerBlock('review') never pins the retired axis on any envelope", () => {
    expect(buildAutoTriggerBlock("review")).not.toContain(RETIRED_AXIS_SKILL_ID);
    expect(buildAutoTriggerBlock("review", {})).not.toContain(
      RETIRED_AXIS_SKILL_ID
    );
    expect(
      buildAutoTriggerBlock("review", { walkAntiSlopAxis: true })
    ).not.toContain(RETIRED_AXIS_SKILL_ID);
  });
});

describe("v8.113 — anti-slop companion skill body is gone from the shipped skill set", () => {
  it("RETIREMENT — no shipped skill .md body claims the retired anti-slop axis grading protocol", async () => {
    const files = await fs.readdir(SKILLS_DIR);
    expect(files).not.toContain(`${RETIRED_AXIS_SKILL_ID}.md`);
  });
});
