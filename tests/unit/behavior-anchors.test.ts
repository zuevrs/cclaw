import { describe, expect, it } from "vitest";
import {
  BEHAVIOR_ANCHORS,
  behaviorAnchorFor,
  renderBehaviorAnchorTemplateLine
} from "../../src/content/examples.js";
import { ARTIFACT_TEMPLATES } from "../../src/content/templates.js";
import { stageSkillMarkdown, behaviorAnchorBlock } from "../../src/content/skills.js";
import { stageSchema } from "../../src/content/stage-schema.js";
import { FLOW_STAGES, type FlowStage } from "../../src/types.js";

const TEMPLATE_BY_STAGE: Record<FlowStage, string> = {
  brainstorm: "01-brainstorm.md",
  scope: "02-scope.md",
  design: "03-design.md",
  spec: "04-spec.md",
  plan: "05-plan.md",
  tdd: "06-tdd.md",
  review: "07-review.md",
  ship: "08-ship.md"
};

function wordCount(text: string): number {
  return text.trim().split(/\s+/u).filter((token) => token.length > 0).length;
}

describe("BEHAVIOR_ANCHORS data shape", () => {
  it("contains exactly one anchor per FlowStage (8 stages)", () => {
    expect(BEHAVIOR_ANCHORS.length).toBe(8);
    const stages = new Set(BEHAVIOR_ANCHORS.map((entry) => entry.stage));
    expect(stages.size).toBe(8);
    for (const stage of FLOW_STAGES) {
      expect(stages.has(stage), `missing anchor for ${stage}`).toBe(true);
    }
  });

  it("each anchor's `bad` and `good` field is <= 40 words", () => {
    for (const anchor of BEHAVIOR_ANCHORS) {
      expect(
        wordCount(anchor.bad),
        `${anchor.stage} bad too long: ${wordCount(anchor.bad)} words`
      ).toBeLessThanOrEqual(40);
      expect(
        wordCount(anchor.good),
        `${anchor.stage} good too long: ${wordCount(anchor.good)} words`
      ).toBeLessThanOrEqual(40);
    }
  });

  it("`bad` and `good` strings are unique across stages", () => {
    const bads = new Set(BEHAVIOR_ANCHORS.map((entry) => entry.bad));
    const goods = new Set(BEHAVIOR_ANCHORS.map((entry) => entry.good));
    expect(bads.size).toBe(BEHAVIOR_ANCHORS.length);
    expect(goods.size).toBe(BEHAVIOR_ANCHORS.length);
  });

  it("each anchor's `section` matches a real section in that stage's schema", () => {
    for (const anchor of BEHAVIOR_ANCHORS) {
      const schema = stageSchema(anchor.stage);
      const sectionNames = schema.artifactRules.artifactValidation.map((entry) => entry.section);
      expect(
        sectionNames,
        `${anchor.stage} schema is missing section "${anchor.section}"`
      ).toContain(anchor.section);
    }
  });

  it("`behaviorAnchorFor` resolves an entry for every FlowStage", () => {
    for (const stage of FLOW_STAGES) {
      const anchor = behaviorAnchorFor(stage);
      expect(anchor, `no anchor returned for ${stage}`).not.toBeNull();
      expect(anchor!.stage).toBe(stage);
    }
  });
});

describe("behavior anchor rendering — stage skills", () => {
  for (const stage of FLOW_STAGES) {
    it(`renders the anchor exactly once in the ${stage} stage skill markdown`, () => {
      const md = stageSkillMarkdown(stage);
      const headerOccurrences = md.split("## Behavior anchor").length - 1;
      expect(headerOccurrences, `${stage} skill should render \`## Behavior anchor\` once`).toBe(1);
      expect(md).toMatch(/- Bad:/u);
      expect(md).toMatch(/- Good:/u);
      const block = behaviorAnchorBlock(stage);
      expect(block.length).toBeGreaterThan(0);
      expect(md.includes(block.trim())).toBe(true);
    });
  }
});

describe("behavior anchor rendering — artifact templates", () => {
  for (const stage of FLOW_STAGES) {
    it(`includes the anchor reference line exactly once in template ${TEMPLATE_BY_STAGE[stage]}`, () => {
      const template = ARTIFACT_TEMPLATES[TEMPLATE_BY_STAGE[stage]];
      expect(template, `template ${TEMPLATE_BY_STAGE[stage]} should exist`).toBeDefined();
      const occurrences = template!.split("Behavior anchor (bad -> good)").length - 1;
      expect(occurrences).toBe(1);
      const line = renderBehaviorAnchorTemplateLine(stage);
      expect(template).toContain(line);
    });
  }
});
