import { describe, expect, it } from "vitest";
import { stageAutoSubagentDispatch } from "../../src/content/stage-schema.js";
import { stageSkillMarkdown } from "../../src/content/skills.js";

/**
 * Wave 22: every brainstorm/scope/design dispatch entry must declare
 * `runPhase: "post-elicitation"` so the materialized stage skill renders the
 * "Run Phase" column with the correct value, and so subagents do not preempt
 * the adaptive elicitation Q&A loop. Other stages keep `any` (or undefined)
 * because they do not run elicitation.
 */

const ELICITATION_STAGES = ["brainstorm", "scope", "design"] as const;

describe("Wave 22 STAGE_AUTO_SUBAGENT_DISPATCH runPhase coverage", () => {
  it("every dispatch entry on brainstorm/scope/design declares runPhase=post-elicitation", () => {
    for (const stage of ELICITATION_STAGES) {
      const rules = stageAutoSubagentDispatch(stage);
      expect(rules.length, `${stage} should have at least one dispatch entry`).toBeGreaterThan(0);
      for (const rule of rules) {
        expect(
          rule.runPhase,
          `${stage}/${rule.agent} (mode=${rule.mode}) must set runPhase: "post-elicitation"`
        ).toBe("post-elicitation");
      }
    }
  });

  it("non-elicitation stages do not require post-elicitation phase", () => {
    const nonElicitation = ["spec", "plan", "tdd", "review", "ship"] as const;
    for (const stage of nonElicitation) {
      const rules = stageAutoSubagentDispatch(stage);
      for (const rule of rules) {
        expect(
          rule.runPhase ?? "any",
          `${stage}/${rule.agent} should default to "any" (no elicitation ordering)`
        ).not.toBe("post-elicitation");
      }
    }
  });

  it("stageSkillMarkdown renders Run Phase column header for elicitation stages", () => {
    for (const stage of ELICITATION_STAGES) {
      const skill = stageSkillMarkdown(stage);
      expect(skill).toContain(
        "| Agent | Mode | Run Phase | Class | Return Schema | User Gate | Trigger | Purpose |"
      );
    }
  });

  it("stageSkillMarkdown renders post-elicitation rows for elicitation stages and includes legend", () => {
    for (const stage of ELICITATION_STAGES) {
      const skill = stageSkillMarkdown(stage);
      expect(skill).toMatch(/\|\s*post-elicitation\s*\|/u);
      expect(skill).toContain("Run Phase legend:");
      expect(skill).toContain("after the adaptive elicitation Q&A loop converges");
    }
  });

  it("stageAutoSubagentDispatch helper preserves runPhase on every entry", () => {
    for (const stage of ELICITATION_STAGES) {
      const rules = stageAutoSubagentDispatch(stage);
      for (const rule of rules) {
        expect(rule.runPhase).toBe("post-elicitation");
      }
    }
  });
});
