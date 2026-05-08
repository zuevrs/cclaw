import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  ARTIFACT_FILE_NAMES,
  activeArtifactDir,
  activeArtifactPath,
  shippedArtifactDir,
  shippedArtifactPath,
  slugifyArtifactTopic
} from "../../src/artifact-paths.js";

describe("artifact paths", () => {
  it("uses singular file names for every artifact stage", () => {
    expect(ARTIFACT_FILE_NAMES).toEqual({
      plan: "plan.md",
      build: "build.md",
      review: "review.md",
      ship: "ship.md",
      decisions: "decisions.md",
      learnings: "learnings.md"
    });
  });

  it("computes active path under .cclaw/flows/<slug>/<stage>.md", () => {
    const project = "/tmp/proj";
    expect(activeArtifactDir(project, "demo")).toBe(path.join(project, ".cclaw", "flows", "demo"));
    expect(activeArtifactPath(project, "plan", "demo")).toBe(path.join(project, ".cclaw", "flows", "demo", "plan.md"));
    expect(activeArtifactPath(project, "build", "demo")).toBe(
      path.join(project, ".cclaw", "flows", "demo", "build.md")
    );
    expect(activeArtifactPath(project, "review", "demo")).toBe(
      path.join(project, ".cclaw", "flows", "demo", "review.md")
    );
    expect(activeArtifactPath(project, "ship", "demo")).toBe(
      path.join(project, ".cclaw", "flows", "demo", "ship.md")
    );
    expect(activeArtifactPath(project, "decisions", "demo")).toBe(
      path.join(project, ".cclaw", "flows", "demo", "decisions.md")
    );
    expect(activeArtifactPath(project, "learnings", "demo")).toBe(
      path.join(project, ".cclaw", "flows", "demo", "learnings.md")
    );
  });

  it("uses identical naming inside shipped/<slug>/", () => {
    const project = "/tmp/proj";
    expect(shippedArtifactDir(project, "demo")).toBe(path.join(project, ".cclaw", "flows", "shipped", "demo"));
    expect(shippedArtifactPath(project, "demo", "plan")).toBe(
      path.join(project, ".cclaw", "flows", "shipped", "demo", "plan.md")
    );
    expect(shippedArtifactPath(project, "demo", "learnings")).toBe(
      path.join(project, ".cclaw", "flows", "shipped", "demo", "learnings.md")
    );
  });

  it("slugifies into kebab-case truncated to 64 chars", () => {
    expect(slugifyArtifactTopic("Add Approval Page!")).toBe("add-approval-page");
    expect(slugifyArtifactTopic("a".repeat(80))).toHaveLength(64);
    expect(slugifyArtifactTopic("   ")).toBe("task");
  });
});
