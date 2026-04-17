import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import {
  createFeature,
  ensureFeatureSystem,
  listFeatures,
  readActiveFeature,
  switchActiveFeature
} from "../../src/feature-system.js";
import { createTempProject } from "../helpers/index.js";

const execFileAsync = promisify(execFile);

async function git(cwd: string, args: string[]): Promise<void> {
  await execFileAsync("git", args, { cwd });
}

async function initGitRepo(projectRoot: string): Promise<void> {
  await git(projectRoot, ["init"]);
  await git(projectRoot, ["config", "user.email", "tests@example.com"]);
  await git(projectRoot, ["config", "user.name", "Test Runner"]);
  await fs.writeFile(path.join(projectRoot, "README.md"), "# temp\n", "utf8");
  await git(projectRoot, ["add", "README.md"]);
  await git(projectRoot, ["commit", "-m", "init"]);
}

describe("feature system", () => {
  it("bootstraps default feature metadata and worktree registry", async () => {
    const root = await createTempProject("feature-bootstrap");
    await fs.mkdir(path.join(root, ".cclaw/artifacts"), { recursive: true });
    await fs.mkdir(path.join(root, ".cclaw/state"), { recursive: true });
    await initGitRepo(root);

    await ensureFeatureSystem(root);
    const active = await readActiveFeature(root);
    const features = await listFeatures(root);
    const registry = JSON.parse(
      await fs.readFile(path.join(root, ".cclaw/state/worktrees.json"), "utf8")
    ) as { entries?: Array<{ featureId?: string }> };

    expect(active).toBe("default");
    expect(features).toContain("default");
    expect(
      (registry.entries ?? []).some((entry) => entry.featureId === "default")
    ).toBe(true);
    await expect(fs.stat(path.join(root, ".cclaw/worktrees"))).resolves.toBeTruthy();
  });

  it("creates git worktrees and switches active feature pointer", async () => {
    const root = await createTempProject("feature-switch");
    await fs.mkdir(path.join(root, ".cclaw/artifacts"), { recursive: true });
    await fs.mkdir(path.join(root, ".cclaw/state"), { recursive: true });
    await initGitRepo(root);

    await ensureFeatureSystem(root);
    await createFeature(root, "beta", { cloneActive: false });
    await expect(fs.stat(path.join(root, ".cclaw/worktrees/beta"))).resolves.toBeTruthy();

    await switchActiveFeature(root, "beta");
    expect(await readActiveFeature(root)).toBe("beta");

    await switchActiveFeature(root, "default");
    expect(await readActiveFeature(root)).toBe("default");
    const features = await listFeatures(root);
    expect(features).toContain("beta");
  });
});
