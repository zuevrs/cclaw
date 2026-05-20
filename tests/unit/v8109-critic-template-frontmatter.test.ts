import { describe, expect, it } from "vitest";
import { ARTIFACT_TEMPLATES } from "../../src/content/artifact-templates.js";

/**
 * v8.109 — CRITIC_TEMPLATE declares the v8.108 cross-model budget
 * frontmatter slots so the LLM can stamp them inline rather than
 * inventing field names ad-hoc. v8.108 §3.5 of the critic prompt
 * specifies that on a budget refuse, the critic stamps
 * `cross_model_skipped_reason: budget` in critic.md; on a successful
 * trimmed dispatch, it stamps `cross_model_trim_disclosure: applied`
 * + a `priority_drop_log` of the trimmed sections.
 */
describe("v8.109 — CRITIC_TEMPLATE declares v8.108 cross-model budget frontmatter slots", () => {
  const critic = ARTIFACT_TEMPLATES.find((entry) => entry.id === "critic")!;

  it("CRITIC_TEMPLATE has `cross_model_skipped_reason` slot in frontmatter", () => {
    expect(critic.body).toContain("cross_model_skipped_reason");
  });

  it("CRITIC_TEMPLATE has `cross_model_trim_disclosure` slot in frontmatter", () => {
    expect(critic.body).toContain("cross_model_trim_disclosure");
  });

  it("CRITIC_TEMPLATE has `priority_drop_log` slot in frontmatter", () => {
    expect(critic.body).toContain("priority_drop_log");
  });

  it("the three slots default to non-firing values (none / [])", () => {
    expect(critic.body).toMatch(/cross_model_skipped_reason:\s*none/u);
    expect(critic.body).toMatch(/cross_model_trim_disclosure:\s*none/u);
    expect(critic.body).toMatch(/priority_drop_log:\s*\[\]/u);
  });

  it("the slots sit inside the frontmatter block (between the `---` fences at the top of the template)", () => {
    const firstFence = critic.body.indexOf("---");
    const secondFence = critic.body.indexOf("---", firstFence + 3);
    expect(firstFence).toBe(0);
    expect(secondFence).toBeGreaterThan(0);
    const frontmatter = critic.body.slice(firstFence, secondFence);
    expect(frontmatter).toContain("cross_model_skipped_reason");
    expect(frontmatter).toContain("cross_model_trim_disclosure");
    expect(frontmatter).toContain("priority_drop_log");
  });
});
