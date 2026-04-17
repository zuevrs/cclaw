import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  createFeature,
  ensureFeatureSystem,
  listFeatures,
  readActiveFeature,
  switchActiveFeature
} from "../../src/feature-system.js";
import { createTempProject } from "../helpers/index.js";

describe("feature system", () => {
  it("bootstraps default feature metadata and snapshot dirs", async () => {
    const root = await createTempProject("feature-bootstrap");
    await fs.mkdir(path.join(root, ".cclaw/artifacts"), { recursive: true });
    await fs.mkdir(path.join(root, ".cclaw/state"), { recursive: true });

    await ensureFeatureSystem(root);
    const active = await readActiveFeature(root);
    const features = await listFeatures(root);

    expect(active).toBe("default");
    expect(features).toContain("default");
    await expect(
      fs.stat(path.join(root, ".cclaw/features/default/artifacts"))
    ).resolves.toBeTruthy();
    await expect(
      fs.stat(path.join(root, ".cclaw/features/default/state"))
    ).resolves.toBeTruthy();
  });

  it("creates and switches feature snapshots", async () => {
    const root = await createTempProject("feature-switch");
    await fs.mkdir(path.join(root, ".cclaw/artifacts"), { recursive: true });
    await fs.mkdir(path.join(root, ".cclaw/state"), { recursive: true });
    await fs.writeFile(path.join(root, ".cclaw/artifacts/00-idea.md"), "# Alpha\n", "utf8");
    await fs.writeFile(
      path.join(root, ".cclaw/state/flow-state.json"),
      JSON.stringify({ currentStage: "scope", completedStages: ["brainstorm"], activeRunId: "active" }, null, 2),
      "utf8"
    );

    await ensureFeatureSystem(root);
    await createFeature(root, "beta", { cloneActive: false });
    await switchActiveFeature(root, "beta");

    expect(await readActiveFeature(root)).toBe("beta");
    const activeArtifacts = await fs.readdir(path.join(root, ".cclaw/artifacts"));
    expect(activeArtifacts).toEqual([]);

    await fs.writeFile(path.join(root, ".cclaw/artifacts/00-idea.md"), "# Beta\n", "utf8");
    await switchActiveFeature(root, "default");

    expect(await readActiveFeature(root)).toBe("default");
    const restored = await fs.readFile(path.join(root, ".cclaw/artifacts/00-idea.md"), "utf8");
    expect(restored).toContain("Alpha");
  });
});
