import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { activeArtifactPath, shippedArtifactDir } from "../../src/artifact-paths.js";
import { CompoundError, runCompoundAndShip, shouldCaptureLearning } from "../../src/compound.js";
import { writeFileSafe } from "../../src/fs-utils.js";
import { writeFlowState } from "../../src/run-persistence.js";
import { createTempProject, removeProject } from "../helpers/temp-project.js";

describe("compound", () => {
  let project: string;
  afterEach(async () => {
    if (project) await removeProject(project);
  });

  it("captures learning when an architectural decision exists", () => {
    expect(shouldCaptureLearning({ hasArchitectDecision: true, reviewIterations: 0, securityFlag: false, userRequestedCapture: false })).toBe(true);
  });

  it("captures learning after >=3 review iterations", () => {
    expect(shouldCaptureLearning({ hasArchitectDecision: false, reviewIterations: 3, securityFlag: false, userRequestedCapture: false })).toBe(true);
  });

  it("captures learning when security flag is set", () => {
    expect(shouldCaptureLearning({ hasArchitectDecision: false, reviewIterations: 0, securityFlag: true, userRequestedCapture: false })).toBe(true);
  });

  it("captures learning when user explicitly asks", () => {
    expect(shouldCaptureLearning({ hasArchitectDecision: false, reviewIterations: 0, securityFlag: false, userRequestedCapture: true })).toBe(true);
  });

  it("skips capture when no signal", () => {
    expect(shouldCaptureLearning({ hasArchitectDecision: false, reviewIterations: 1, securityFlag: false, userRequestedCapture: false })).toBe(false);
  });

  it("blocks ship if AC are not committed", async () => {
    project = await createTempProject();
    await writeFlowState(project, {
      schemaVersion: 3,
      currentSlug: "demo",
      currentStage: "ship",
      ac: [{ id: "AC-1", text: "outcome", status: "pending" }],
      lastSpecialist: null,
      startedAt: "2026-05-07T00:00:00Z",
      reviewIterations: 0,
      securityFlag: false,
      triage: null
    });
    await expect(
      runCompoundAndShip(project, {
        shipCommit: "deadbeef",
        signals: { hasArchitectDecision: false, reviewIterations: 0, securityFlag: false, userRequestedCapture: false }
      })
    ).rejects.toBeInstanceOf(CompoundError);
  });

  it("moves active artifacts to shipped/<slug>/ when AC are committed", async () => {
    project = await createTempProject();
    await writeFlowState(project, {
      schemaVersion: 3,
      currentSlug: "demo",
      currentStage: "ship",
      ac: [{ id: "AC-1", text: "outcome", status: "committed", commit: "abc123" }],
      lastSpecialist: null,
      startedAt: "2026-05-07T00:00:00Z",
      reviewIterations: 0,
      securityFlag: false,
      triage: null
    });
    await writeFileSafe(activeArtifactPath(project, "plan", "demo"), "plan body");
    await writeFileSafe(activeArtifactPath(project, "build", "demo"), "build body");
    await writeFileSafe(activeArtifactPath(project, "review", "demo"), "review body");
    await writeFileSafe(activeArtifactPath(project, "ship", "demo"), "ship body");

    const result = await runCompoundAndShip(project, {
      shipCommit: "abc123",
      signals: { hasArchitectDecision: false, reviewIterations: 0, securityFlag: false, userRequestedCapture: false }
    });

    expect(result.movedArtifacts.sort()).toEqual(["build", "plan", "review", "ship"]);
    const shipped = shippedArtifactDir(project, "demo");
    // v8.12 default: manifest.md is gone; ship.md frontmatter carries the
    // shipped signals, and an "Artefact index" section lists every moved
    // file. legacy-artifacts: true would bring manifest.md back.
    await expect(fs.access(path.join(shipped, "manifest.md"))).rejects.toBeTruthy();
    const shipBody = await fs.readFile(path.join(shipped, "ship.md"), "utf8");
    expect(shipBody).toMatch(/ship_commit: abc123/);
    expect(shipBody).toMatch(/shipped_at: /);
    expect(shipBody).toMatch(/ac_count: 1/);
    expect(shipBody).toMatch(/^## Artefact index$/m);
    expect(shipBody).toMatch(/- plan\.md/);
    expect(shipBody).toMatch(/- build\.md/);
    expect(shipBody).toMatch(/- review\.md/);
    await expect(fs.access(activeArtifactPath(project, "plan", "demo"))).rejects.toBeTruthy();
  });

  it("writes a learning artifact when quality gate passes", async () => {
    project = await createTempProject();
    await writeFlowState(project, {
      schemaVersion: 3,
      currentSlug: "demo",
      currentStage: "ship",
      ac: [{ id: "AC-1", text: "outcome", status: "committed", commit: "abc" }],
      // v8.14: architect retired; design is the single discovery specialist
      // that produces structural decisions. Test stays valid because the
      // signal that drives learning capture is `hasArchitectDecision` on the
      // signals object, not the `lastSpecialist` field.
      lastSpecialist: "design",
      startedAt: "2026-05-07T00:00:00Z",
      reviewIterations: 0,
      securityFlag: false,
      triage: null
    });
    await writeFileSafe(activeArtifactPath(project, "plan", "demo"), "plan");
    await writeFileSafe(activeArtifactPath(project, "ship", "demo"), "ship");

    const result = await runCompoundAndShip(project, {
      shipCommit: "abc",
      signals: { hasArchitectDecision: true, reviewIterations: 0, securityFlag: false, userRequestedCapture: false }
    });

    expect(result.learningCaptured).toBe(true);
    expect(result.movedArtifacts).toContain("learnings");
    const knowledge = await fs.readFile(path.join(project, ".cclaw", "knowledge.jsonl"), "utf8");
    expect(knowledge).toContain("\"slug\":\"demo\"");
  });
});
