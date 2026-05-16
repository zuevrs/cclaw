import { describe, expect, it } from "vitest";

import {
  ANTI_RATIONALIZATIONS_BODY,
  SHARED_ANTI_RATIONALIZATIONS,
  renderAntiRationalizationsCatalog,
  type AntiRationalizationCategory
} from "../../src/content/anti-rationalizations.js";
import {
  AUTO_TRIGGER_SKILLS,
  SKILLS_INDEX_BODY,
  buildAutoTriggerBlock,
  renderSkillsIndex
} from "../../src/content/skills.js";
import { BUILDER_PROMPT } from "../../src/content/specialist-prompts/builder.js";
import { REVIEWER_PROMPT } from "../../src/content/specialist-prompts/reviewer.js";
import { ARCHITECT_PROMPT } from "../../src/content/specialist-prompts/architect.js";
import { CRITIC_PROMPT } from "../../src/content/specialist-prompts/critic.js";
import { ARTIFACT_TEMPLATES } from "../../src/content/artifact-templates.js";

const BUILD_TEMPLATE = ARTIFACT_TEMPLATES.find((t) => t.id === "build")?.body;
import { STAGE_PLAYBOOKS } from "../../src/content/stage-playbooks.js";

/**
 * v8.49 - overcomplexity sweep.
 *
 * Three converging-evidence cleanup items, each pinned by tripwires here:
 *
 * 1. Empty `refactor(AC-N) skipped` commit elimination - the build.md row
 *    can record `Refactor: skipped - <reason>` instead of an empty
 *    `git commit --allow-empty -m "refactor(AC-N) skipped: ..."` commit.
 *    The reviewer accepts EITHER pattern (build.md row OR empty commit) so
 *    pre-v8.49 slugs with empty commits still pass review.
 *
 * 2. Auto-trigger index dedup - `buildAutoTriggerBlock(stage)` now emits a
 *    compact pointer-index (one bullet per stage-filtered skill: id + file
 *    path) instead of inlining each skill's full description + triggers.
 *    The full descriptions move to a single install-time generated
 *    `.cclaw/lib/skills-index.md` file. Per-dispatch token cost drops
 *    ~80%; the index is reachable on-demand via the path pointer.
 *
 * 3. Anti-rationalization consolidation - cross-cutting rationalization
 *    rows that previously drifted across multiple specialist prompts and
 *    skill `.md` files now live in a single
 *    `src/content/anti-rationalizations.ts` catalog (categories:
 *    `completion`, `verification`, `edit-discipline`, `commit-discipline`,
 *    `posture-bypass`). Specialists and skills reference the catalog by
 *    category instead of inlining the cross-cutting prose; install writes
 *    the rendered Markdown to `.cclaw/lib/anti-rationalizations.md`.
 *
 * Each tripwire below pins one invariant so an accidental regression
 * lights up immediately. The format mirrors v8.48 / v8.47 / v8.40
 * tripwires.
 */

describe("v8.49 AC-1 - empty `refactor(AC-N) skipped` commit elimination (v8.62 renamed `slice-builder` → `builder`)", () => {
  it("builder prompt documents the new build.md `Refactor: skipped - <reason>` declaration", () => {
    expect(
      BUILDER_PROMPT,
      "builder must instruct the agent to record skipped refactors via a build.md `Refactor: skipped - <reason>` line (v8.49 default)"
    ).toMatch(/Refactor:\s*skipped\s*[\u2014-]/);
  });

  it("builder prompt still mentions the legacy empty-commit path for backwards compat", () => {
    expect(
      BUILDER_PROMPT,
      "the legacy `git commit --allow-empty -m \"refactor(AC-N) skipped: ...\"` path must remain documented so pre-v8.49 slugs still review cleanly"
    ).toMatch(/--allow-empty.*refactor\(AC-N\)\s*skipped/i);
  });

  it("reviewer prompt accepts BOTH the build.md row token AND the legacy empty commit", () => {
    expect(
      REVIEWER_PROMPT,
      "reviewer must accept the v8.49 build.md `Refactor: skipped` row token (the new preferred path)"
    ).toMatch(/Refactor:\s*skipped/);
    expect(
      REVIEWER_PROMPT,
      "reviewer must still accept the legacy `refactor(AC-N) skipped:` empty commit pattern"
    ).toMatch(/refactor\(AC-N\)\s*skipped/);
  });

  it("BUILD_TEMPLATE documents the `Refactor: skipped - <reason>` cell convention", () => {
    expect(
      BUILD_TEMPLATE,
      "the build.md template must show the v8.49 `Refactor: skipped - <reason>` cell convention so authors hit the preferred path on the first AC"
    ).toMatch(/Refactor:\s*skipped/);
  });

  it("stage-playbook for `build` mentions the v8.49 build.md row declaration as default", () => {
    const buildPlaybook = STAGE_PLAYBOOKS.find((p) => p.id === "build");
    expect(
      buildPlaybook,
      "stage-playbooks must include the build runbook"
    ).toBeDefined();
    expect(
      buildPlaybook?.body,
      "build runbook must describe the v8.49 build.md row declaration (Refactor: skipped) as the default"
    ).toMatch(/Refactor:\s*skipped/);
  });

  it("tdd-and-verification skill body mentions the build.md row as the preferred path", () => {
    const skill = AUTO_TRIGGER_SKILLS.find(
      (s) => s.fileName === "tdd-and-verification.md"
    );
    expect(skill, "tdd-and-verification skill must exist").toBeDefined();
    expect(
      skill?.body,
      "tdd-and-verification.md must mention the build.md row token as the v8.49 preferred path for skipped refactors"
    ).toMatch(/Refactor:\s*skipped/);
  });
});

describe("v8.49 AC-2 - auto-trigger index dedup", () => {
  it("buildAutoTriggerBlock emits compact pointer bullets (id + file path), not full descriptions", () => {
    const block = buildAutoTriggerBlock("build");
    expect(
      block,
      "every rendered skill bullet must point at the skill file under `.cclaw/lib/skills/`"
    ).toMatch(/`\.cclaw\/lib\/skills\/[a-z0-9-]+\.md`/);
    expect(
      block,
      "the block must point at the central skills index for full descriptions / triggers"
    ).toMatch(/`\.cclaw\/lib\/skills-index\.md`/);
  });

  it("buildAutoTriggerBlock does NOT inline each skill's full description prose", () => {
    const block = buildAutoTriggerBlock("build");
    const builderSkill = AUTO_TRIGGER_SKILLS.find(
      (s) => s.fileName === "tdd-and-verification.md"
    );
    expect(
      builderSkill,
      "tdd-and-verification skill must exist for this check"
    ).toBeDefined();
    expect(
      block.includes(builderSkill?.description ?? "__missing__"),
      "the auto-trigger block must NOT inline the full per-skill description (which is what blew up per-dispatch token cost pre-v8.49). The description lives in `.cclaw/lib/skills-index.md` instead."
    ).toBe(false);
  });

  it("per-dispatch block shrinks by >=50% vs the legacy verbose form (estimate)", () => {
    const compactBuildBlock = buildAutoTriggerBlock("build");
    const legacyEstimate = AUTO_TRIGGER_SKILLS.filter((skill) => {
      const stages = skill.stages ?? (["always"] as const);
      return stages.includes("build") || stages.includes("always");
    }).reduce(
      (acc, skill) =>
        acc +
        skill.description.length +
        (skill.triggers.join(", ").length || 0) +
        80,
      0
    );
    expect(
      compactBuildBlock.length,
      `v8.49 compact build-stage block must be <50% of the legacy verbose size (legacy ~${legacyEstimate} chars vs compact ${compactBuildBlock.length} chars). The reduction is the per-dispatch token saving the v8.49 sweep was built for.`
    ).toBeLessThan(legacyEstimate * 0.5);
  });

  it("renderSkillsIndex returns a complete index covering every AUTO_TRIGGER_SKILL", () => {
    const index = renderSkillsIndex();
    for (const skill of AUTO_TRIGGER_SKILLS) {
      expect(
        index,
        `the skills index must list every skill (missing: ${skill.id})`
      ).toContain(`\`${skill.id}\``);
    }
    expect(
      index,
      "the skills index must mention the on-disk path of each skill body"
    ).toMatch(/`\.cclaw\/lib\/skills\/[a-z0-9-]+\.md`/);
  });

  it("SKILLS_INDEX_BODY matches renderSkillsIndex (pre-rendered constant stays in sync)", () => {
    expect(
      SKILLS_INDEX_BODY,
      "SKILLS_INDEX_BODY is exported as a pre-rendered constant so the install path can write it without re-running the renderer; if these drift, install ships stale content"
    ).toBe(renderSkillsIndex());
  });

  it("specialist prompts reference `.cclaw/lib/skills-index.md` instead of inlining skill bodies (v8.62 roster: builder, reviewer, architect, critic)", () => {
    for (const [name, prompt] of [
      ["builder", BUILDER_PROMPT],
      ["reviewer", REVIEWER_PROMPT],
      ["architect", ARCHITECT_PROMPT],
      ["critic", CRITIC_PROMPT]
    ] as const) {
      expect(
        prompt,
        `${name} prompt must reference \`.cclaw/lib/skills-index.md\` so the agent can fetch full skill descriptions on demand`
      ).toMatch(/`\.cclaw\/lib\/skills-index\.md`/);
    }
  });
});

describe("v8.49 AC-3 - anti-rationalization consolidation", () => {
  it("SHARED_ANTI_RATIONALIZATIONS exports the five expected categories", () => {
    const expectedCategories: AntiRationalizationCategory[] = [
      "completion",
      "verification",
      "edit-discipline",
      "commit-discipline",
      "posture-bypass"
    ];
    for (const category of expectedCategories) {
      expect(
        SHARED_ANTI_RATIONALIZATIONS[category],
        `category \`${category}\` must exist in the shared catalog`
      ).toBeDefined();
      expect(
        SHARED_ANTI_RATIONALIZATIONS[category].length,
        `category \`${category}\` must carry at least 3 cross-cutting rationalization rows`
      ).toBeGreaterThanOrEqual(3);
    }
  });

  it("each catalog row has both a rationalization (quoted excuse) and a truth (rebuttal)", () => {
    for (const [category, rows] of Object.entries(
      SHARED_ANTI_RATIONALIZATIONS
    )) {
      for (const row of rows) {
        expect(
          row.rationalization,
          `${category} row missing rationalization`
        ).toBeTruthy();
        expect(
          row.truth,
          `${category} row missing truth/rebuttal`
        ).toBeTruthy();
        expect(
          row.rationalization.startsWith('"'),
          `${category} row rationalization should be a quoted excuse (got: ${row.rationalization.slice(0, 40)}...)`
        ).toBe(true);
      }
    }
  });

  it("ANTI_RATIONALIZATIONS_BODY renders one H2 per category with a two-column table", () => {
    for (const category of Object.keys(
      SHARED_ANTI_RATIONALIZATIONS
    ) as AntiRationalizationCategory[]) {
      expect(
        ANTI_RATIONALIZATIONS_BODY,
        `catalog body must include an H2 heading for category \`${category}\``
      ).toMatch(new RegExp(`^##\\s+\`${category}\``, "m"));
    }
    expect(
      ANTI_RATIONALIZATIONS_BODY,
      "catalog body must include the two-column markdown table header (rationalization | truth)"
    ).toMatch(/\|\s*rationalization\s*\|\s*truth\s*\|/);
  });

  it("renderAntiRationalizationsCatalog matches the pre-rendered ANTI_RATIONALIZATIONS_BODY", () => {
    expect(
      ANTI_RATIONALIZATIONS_BODY,
      "ANTI_RATIONALIZATIONS_BODY must equal renderAntiRationalizationsCatalog() so install ships fresh content"
    ).toBe(renderAntiRationalizationsCatalog());
  });

  it("specialist prompts (reviewer / architect / critic) reference the catalog by file path (v8.62 roster)", () => {
    for (const [name, prompt] of [
      ["reviewer", REVIEWER_PROMPT],
      ["architect", ARCHITECT_PROMPT],
      ["critic", CRITIC_PROMPT]
    ] as const) {
      expect(
        prompt,
        `${name} prompt must reference \`.cclaw/lib/anti-rationalizations.md\` so the catalog is treated as the cross-cutting source`
      ).toMatch(/`\.cclaw\/lib\/anti-rationalizations\.md`/);
    }
  });

  it("top-cross-cutting skills point at the shared catalog from their `## Common rationalizations` section", () => {
    const SKILLS_WITH_CATALOG_POINTER = [
      "tdd-and-verification.md",
      "completion-discipline.md",
      "commit-hygiene.md",
      "pre-edit-investigation.md",
      "review-discipline.md",
      "ac-discipline.md",
      "receiving-feedback.md",
      "debug-and-browser.md",
      "triage-gate.md",
      "api-evolution.md"
    ];
    for (const fileName of SKILLS_WITH_CATALOG_POINTER) {
      const skill = AUTO_TRIGGER_SKILLS.find((s) => s.fileName === fileName);
      expect(skill, `expected skill ${fileName} to be present`).toBeDefined();
      expect(
        skill?.body,
        `${fileName} must reference \`.cclaw/lib/anti-rationalizations.md\` from its Common rationalizations section so cross-cutting rows live in exactly one place`
      ).toMatch(/`\.cclaw\/lib\/anti-rationalizations\.md`/);
    }
  });

  it("v8.30 top-8 skills still carry their two-column rationalization table (no regression)", () => {
    const TOP_8 = [
      "tdd-and-verification.md",
      "review-discipline.md",
      "commit-hygiene.md",
      "ac-discipline.md",
      "api-evolution.md",
      "debug-and-browser.md",
      "triage-gate.md"
    ];
    for (const fileName of TOP_8) {
      const skill = AUTO_TRIGGER_SKILLS.find((s) => s.fileName === fileName);
      expect(skill, `expected skill ${fileName}`).toBeDefined();
      expect(
        skill?.body,
        `${fileName} must keep its \`## Common rationalizations\` / \`## Anti-rationalization\` H2 (v8.30 tripwire)`
      ).toMatch(/^##\s+(Common rationalizations|Anti-rationalization)/m);
      expect(
        skill?.body,
        `${fileName} must keep the two-column rationalization table after v8.49's consolidation pointer`
      ).toMatch(
        /\|\s*rationalization\s*\|\s*(truth|rebuttal)\s*\|\s*\n\s*\|\s*-+\s*\|\s*-+\s*\|/i
      );
    }
  });
});

describe("v8.49 - cross-item invariants", () => {
  it("the v8.49 sweep ships zero net specialist prompts (no new specialist added; v8.62 roster: builder/reviewer/architect/critic)", () => {
    expect(typeof BUILDER_PROMPT).toBe("string");
    expect(typeof REVIEWER_PROMPT).toBe("string");
    expect(typeof ARCHITECT_PROMPT).toBe("string");
    expect(typeof CRITIC_PROMPT).toBe("string");
  });

  it("posture-bypass category covers the REFACTOR-skipped rationalization (cross-references item #1)", () => {
    const postureRows = SHARED_ANTI_RATIONALIZATIONS["posture-bypass"];
    const refactorRow = postureRows.find((row) =>
      /REFACTOR is unnecessary/i.test(row.rationalization)
    );
    expect(
      refactorRow,
      "posture-bypass category must contain the REFACTOR-unnecessary rationalization so the cross-cutting catalog stays in sync with item #1's empty-commit elimination"
    ).toBeDefined();
    expect(
      refactorRow?.truth,
      "the REFACTOR-unnecessary truth must mention the v8.49 build.md `Refactor: skipped` declaration"
    ).toMatch(/Refactor:\s*skipped/);
  });

  it("auto-trigger compact bullets do NOT carry the same prose as the skills-index for any skill (no duplication after consolidation)", () => {
    const block = buildAutoTriggerBlock("build");
    for (const skill of AUTO_TRIGGER_SKILLS) {
      if (skill.description.length < 60) continue;
      const inIndex = SKILLS_INDEX_BODY.includes(skill.description);
      const inBlock = block.includes(skill.description);
      expect(
        !(inIndex && inBlock),
        `skill description for \`${skill.id}\` appears in BOTH the compact block and the skills-index - that defeats the v8.49 dedup. The description must live only in the index.`
      ).toBe(true);
    }
  });
});
