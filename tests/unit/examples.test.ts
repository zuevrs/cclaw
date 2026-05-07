import { describe, expect, it } from "vitest";
import { EXAMPLES, EXAMPLES_INDEX } from "../../src/content/examples.js";
import { parseArtifact } from "../../src/artifact-frontmatter.js";

describe("examples library", () => {
  it("ships at least 13 worked examples covering plan/build/review/ship/decision/learning/transcripts", () => {
    expect(EXAMPLES.length).toBeGreaterThanOrEqual(13);
    const ids = EXAMPLES.map((entry) => entry.id);
    for (const expected of [
      "plan-small",
      "plan-refinement",
      "plan-parallel-build",
      "build-log",
      "review-log",
      "ship-notes",
      "decision-record",
      "learning-record"
    ]) {
      expect(ids).toContain(expected);
    }
  });

  it("plan examples carry valid frontmatter", () => {
    for (const id of ["plan-small", "plan-refinement", "plan-parallel-build"]) {
      const example = EXAMPLES.find((entry) => entry.id === id);
      expect(example).toBeDefined();
      const parsed = parseArtifact(example!.body);
      expect(parsed.frontmatter.slug.length).toBeGreaterThan(0);
      expect(parsed.frontmatter.stage).toBe("plan");
    }
  });

  it("refinement example points at a parent slug", () => {
    const refinement = EXAMPLES.find((entry) => entry.id === "plan-refinement");
    const parsed = parseArtifact(refinement!.body);
    expect(parsed.frontmatter.refines).toBe("approval-pill");
    expect(parsed.frontmatter.security_flag).toBe(true);
  });

  it("parallel-build example declares a topology with slice owners", () => {
    const example = EXAMPLES.find((entry) => entry.id === "plan-parallel-build");
    expect(example?.body).toContain("topology: parallel-build");
    expect(example?.body).toContain("slice-builder #1");
  });

  it("review example contains the Five Failure Modes pass", () => {
    const example = EXAMPLES.find((entry) => entry.id === "review-log");
    expect(example?.body).toContain("Five Failure Modes pass");
    for (const mode of ["Hallucinated actions", "Scope creep", "Cascading errors", "Context loss", "Tool misuse"]) {
      expect(example?.body).toContain(mode);
    }
  });

  it("EXAMPLES_INDEX references every example file", () => {
    for (const example of EXAMPLES) {
      expect(EXAMPLES_INDEX).toContain(example.fileName);
    }
  });
});
