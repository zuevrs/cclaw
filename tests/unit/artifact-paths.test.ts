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
  it("uses singular file names for every artifact stage (v8.42 added critic between review and ship; v8.52 added qa between build and review; v8.58 added research for standalone research-mode flows)", () => {
    // v8.58 — `"research"` joins the artifact stage set for the new
    // standalone research-mode entry point (`/cc research <topic>`).
    // It is NOT a FlowStage token (the flow-state machine has no
    // `research` stage; research flows finalise straight from design
    // Phase 7 `accept research` without touching build / review /
    // critic / ship). The artifact path machinery needs a name so
    // `activeArtifactPath(projectRoot, "research", slug)` resolves to
    // `.cclaw/flows/<slug>/research.md` without a special case.
    expect(ARTIFACT_FILE_NAMES).toEqual({
      plan: "plan.md",
      build: "build.md",
      qa: "qa.md",
      review: "review.md",
      critic: "critic.md",
      ship: "ship.md",
      decisions: "decisions.md",
      learnings: "learnings.md",
      "pre-mortem": "pre-mortem.md",
      research: "research.md"
    });
  });

  it("v8.58 — supports research as an artifact stage (used by standalone research-mode flows)", () => {
    const project = "/tmp/proj";
    expect(activeArtifactPath(project, "research", "20260515-research-storage")).toBe(
      path.join(project, ".cclaw", "flows", "20260515-research-storage", "research.md")
    );
    expect(shippedArtifactPath(project, "20260515-research-storage", "research")).toBe(
      path.join(project, ".cclaw", "flows", "shipped", "20260515-research-storage", "research.md")
    );
  });

  it("supports pre-mortem as a first-class artifact stage", () => {
    const project = "/tmp/proj";
    expect(activeArtifactPath(project, "pre-mortem", "demo")).toBe(
      path.join(project, ".cclaw", "flows", "demo", "pre-mortem.md")
    );
    expect(shippedArtifactPath(project, "demo", "pre-mortem")).toBe(
      path.join(project, ".cclaw", "flows", "shipped", "demo", "pre-mortem.md")
    );
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
