import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { CancelError, cancelActiveRun, cancelledArtifactDir, listCancelled } from "../../src/cancel.js";
import { activeArtifactPath } from "../../src/artifact-paths.js";
import { ensureRuntimeRoot } from "../../src/install.js";
import { ensureRunSystem, patchFlowState, readFlowState } from "../../src/run-persistence.js";
import { createTempProject, removeProject } from "../helpers/temp-project.js";

async function seedActivePlan(project: string, slug: string): Promise<void> {
  const planPath = activeArtifactPath(project, "plan", slug);
  await fs.mkdir(path.dirname(planPath), { recursive: true });
  await fs.writeFile(
    planPath,
    `---\nslug: ${slug}\nstage: plan\nstatus: active\nac: []\n---\n\n# ${slug}\n\nbody\n`,
    "utf8"
  );
}

describe("cancelActiveRun", () => {
  let project: string;
  afterEach(async () => {
    if (project) await removeProject(project);
  });

  it("refuses when there is no active slug", async () => {
    project = await createTempProject();
    await ensureRuntimeRoot(project);
    await ensureRunSystem(project);
    await expect(cancelActiveRun(project)).rejects.toBeInstanceOf(CancelError);
  });

  it("moves active artifacts into .cclaw/cancelled/<slug>/ and resets flow-state", async () => {
    project = await createTempProject();
    await ensureRuntimeRoot(project);
    await ensureRunSystem(project);
    await seedActivePlan(project, "kappa");
    await patchFlowState(project, { currentSlug: "kappa", currentStage: "plan" });

    const result = await cancelActiveRun(project, { reason: "user changed mind" });

    expect(result.slug).toBe("kappa");
    expect(result.movedArtifacts).toContain("plan");

    const cancelledPlan = path.join(cancelledArtifactDir(project, "kappa"), "plan.md");
    const manifest = path.join(cancelledArtifactDir(project, "kappa"), "manifest.md");
    await expect(fs.access(cancelledPlan)).resolves.toBeUndefined();
    const manifestBody = await fs.readFile(manifest, "utf8");
    expect(manifestBody).toContain("user changed mind");

    const state = await readFlowState(project);
    expect(state.currentSlug).toBeNull();
    expect(state.currentStage).toBeNull();

    const cancelled = await listCancelled(project);
    expect(cancelled).toContain("kappa");
  });

  it("is safe to call when artifacts only exist for some stages", async () => {
    project = await createTempProject();
    await ensureRuntimeRoot(project);
    await ensureRunSystem(project);
    await seedActivePlan(project, "lambda");
    await patchFlowState(project, { currentSlug: "lambda", currentStage: "plan" });
    const result = await cancelActiveRun(project);
    expect(result.movedArtifacts).toEqual(["plan"]);
  });
});
