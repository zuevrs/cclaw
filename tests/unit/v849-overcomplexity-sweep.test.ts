import { describe, expect, it } from "vitest";

import {
  ANTI_RATIONALIZATIONS_BODY,
  renderAntiRationalizationsCatalog
} from "../../src/content/anti-rationalizations.js";
import {
  AUTO_TRIGGER_SKILLS,
  SKILLS_INDEX_BODY,
  buildAutoTriggerBlock,
  renderSkillsIndex
} from "../../src/content/skills.js";

/**
 * v8.49 — overcomplexity sweep. Slimmed in v8.100.
 *
 * Kept only the rendering wiring tests (buildAutoTriggerBlock,
 * renderSkillsIndex, renderAntiRationalizationsCatalog). The prompt /
 * template / skill body content-greps were removed.
 */
describe("v8.49 — buildAutoTriggerBlock emits the compact pointer index", () => {
  it("buildAutoTriggerBlock emits compact pointer bullets (id + file path), not full descriptions", () => {
    const block = buildAutoTriggerBlock("build");
    expect(block).toMatch(/`\.cclaw\/lib\/skills\/[a-z0-9-]+\.md`/);
    expect(block).toMatch(/`\.cclaw\/lib\/skills-index\.md`/);
  });

  it("buildAutoTriggerBlock does NOT inline each skill's full description prose", () => {
    const block = buildAutoTriggerBlock("build");
    const builderSkill = AUTO_TRIGGER_SKILLS.find(
      (s) => s.fileName === "tdd-and-verification.md"
    );
    expect(builderSkill).toBeDefined();
    expect(block.includes(builderSkill?.description ?? "__missing__")).toBe(false);
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
    expect(compactBuildBlock.length).toBeLessThan(legacyEstimate * 0.5);
  });
});

describe("v8.49 — pre-rendered constants stay in sync with their renderers", () => {
  it("renderSkillsIndex returns a complete index covering every AUTO_TRIGGER_SKILL", () => {
    const index = renderSkillsIndex();
    for (const skill of AUTO_TRIGGER_SKILLS) {
      expect(index).toContain(`\`${skill.id}\``);
    }
    expect(index).toMatch(/`\.cclaw\/lib\/skills\/[a-z0-9-]+\.md`/);
  });

  it("SKILLS_INDEX_BODY matches renderSkillsIndex (pre-rendered constant stays in sync)", () => {
    expect(SKILLS_INDEX_BODY).toBe(renderSkillsIndex());
  });

  it("ANTI_RATIONALIZATIONS_BODY matches renderAntiRationalizationsCatalog (pre-rendered constant stays in sync)", () => {
    expect(ANTI_RATIONALIZATIONS_BODY).toBe(renderAntiRationalizationsCatalog());
  });
});
