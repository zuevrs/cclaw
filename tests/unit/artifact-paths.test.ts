import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  ACTIVE_ARTIFACT_DIRS,
  SHIPPED_ARTIFACT_FILES,
  activeArtifactPath,
  shippedArtifactDir,
  shippedArtifactPath,
  slugifyArtifactTopic
} from "../../src/artifact-paths.js";

describe("artifact paths", () => {
  it("uses plans/builds/reviews/ships/decisions/learnings layout", () => {
    expect(ACTIVE_ARTIFACT_DIRS).toEqual({
      plan: "plans",
      build: "builds",
      review: "reviews",
      ship: "ships",
      decisions: "decisions",
      learnings: "learnings"
    });
  });

  it("uses plan.md / build.md / review.md / ship.md filenames in shipped/", () => {
    expect(SHIPPED_ARTIFACT_FILES.plan).toBe("plan.md");
    expect(SHIPPED_ARTIFACT_FILES.build).toBe("build.md");
    expect(SHIPPED_ARTIFACT_FILES.review).toBe("review.md");
    expect(SHIPPED_ARTIFACT_FILES.ship).toBe("ship.md");
    expect(SHIPPED_ARTIFACT_FILES.decisions).toBe("decisions.md");
    expect(SHIPPED_ARTIFACT_FILES.learnings).toBe("learnings.md");
  });

  it("computes active path under .cclaw/<dir>/<slug>.md", () => {
    const project = "/tmp/proj";
    expect(activeArtifactPath(project, "plan", "demo")).toBe(path.join(project, ".cclaw", "plans", "demo.md"));
    expect(activeArtifactPath(project, "build", "demo")).toBe(path.join(project, ".cclaw", "builds", "demo.md"));
  });

  it("computes shipped path under .cclaw/shipped/<slug>/<file>.md", () => {
    const project = "/tmp/proj";
    expect(shippedArtifactDir(project, "demo")).toBe(path.join(project, ".cclaw", "shipped", "demo"));
    expect(shippedArtifactPath(project, "demo", "plan")).toBe(
      path.join(project, ".cclaw", "shipped", "demo", "plan.md")
    );
    expect(shippedArtifactPath(project, "demo", "learnings")).toBe(
      path.join(project, ".cclaw", "shipped", "demo", "learnings.md")
    );
  });

  it("slugifies into kebab-case truncated to 64 chars", () => {
    expect(slugifyArtifactTopic("Add Approval Page!")).toBe("add-approval-page");
    expect(slugifyArtifactTopic("a".repeat(80))).toHaveLength(64);
    expect(slugifyArtifactTopic("   ")).toBe("task");
  });
});
