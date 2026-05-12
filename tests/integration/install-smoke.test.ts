import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { initCclaw, syncCclaw, uninstallCclaw, upgradeCclaw } from "../../src/install.js";
import { createTempProject, removeProject } from "../helpers/temp-project.js";

describe("install/sync/upgrade/uninstall round-trip", () => {
  let project: string;
  afterEach(async () => {
    if (project) await removeProject(project);
  });

  it("init then sync is idempotent", async () => {
    project = await createTempProject();
    await initCclaw({ cwd: project });
    const beforeStat = await fs.stat(path.join(project, ".cursor", "commands", "cc.md"));
    await syncCclaw({ cwd: project });
    const afterStat = await fs.stat(path.join(project, ".cursor", "commands", "cc.md"));
    expect(afterStat.size).toBe(beforeStat.size);
  });

  it("upgrade re-applies assets", async () => {
    project = await createTempProject();
    await initCclaw({ cwd: project });
    await fs.rm(path.join(project, ".cclaw", "hooks", "commit-helper.mjs"));
    await upgradeCclaw({ cwd: project });
    const body = await fs.readFile(path.join(project, ".cclaw", "hooks", "commit-helper.mjs"), "utf8");
    expect(body).toContain("commit-helper");
  });

  it("uninstall does not leave generated harness assets behind", async () => {
    project = await createTempProject();
    await initCclaw({ cwd: project });
    await uninstallCclaw({ cwd: project });
    await expect(fs.access(path.join(project, ".cclaw"))).rejects.toBeTruthy();
    await expect(fs.access(path.join(project, ".cursor", "commands", "cc.md"))).rejects.toBeTruthy();
  });

  it("config reflects v8 flow + selected harnesses", async () => {
    project = await createTempProject();
    await initCclaw({ cwd: project, harnesses: ["claude", "cursor"] });
    const yaml = await fs.readFile(path.join(project, ".cclaw", "config.yaml"), "utf8");
    expect(yaml).toContain("flowVersion: \"8\"");
    expect(yaml).toContain("- claude");
    expect(yaml).toContain("- cursor");
    expect(yaml).not.toContain("profile:");
  });
});
