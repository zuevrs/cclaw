import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { initCclaw, syncCclaw, uninstallCclaw } from "../../src/install.js";
import { createTempProject, removeProject } from "../helpers/temp-project.js";

describe("install", () => {
  let project: string;
  afterEach(async () => {
    if (project) await removeProject(project);
  });

  it("installs runtime root with state, plans, builds, reviews, ships and shipped dirs", async () => {
    project = await createTempProject();
    await initCclaw({ cwd: project });
    for (const sub of ["state", "plans", "builds", "reviews", "ships", "decisions", "learnings", "shipped", "agents", "hooks", "templates"]) {
      const stat = await fs.stat(path.join(project, ".cclaw", sub));
      expect(stat.isDirectory()).toBe(true);
    }
  });

  it("writes session-start, stop-handoff, commit-helper hooks", async () => {
    project = await createTempProject();
    await initCclaw({ cwd: project });
    for (const fileName of ["session-start.mjs", "stop-handoff.mjs", "commit-helper.mjs"]) {
      const body = await fs.readFile(path.join(project, ".cclaw", "hooks", fileName), "utf8");
      expect(body).toContain("#!/usr/bin/env node");
    }
  });

  it("writes harness commands and agents for cursor by default", async () => {
    project = await createTempProject();
    await initCclaw({ cwd: project });
    const cc = await fs.readFile(path.join(project, ".cursor", "commands", "cc.md"), "utf8");
    expect(cc).toContain("/cc");
    const planner = await fs.readFile(path.join(project, ".cursor", "agents", "planner.md"), "utf8");
    expect(planner).toContain("planner");
  });

  it("supports multiple harnesses on sync", async () => {
    project = await createTempProject();
    await syncCclaw({ cwd: project, harnesses: ["claude", "cursor"] });
    expect((await fs.readFile(path.join(project, ".claude", "commands", "cc.md"), "utf8"))).toContain("/cc");
    expect((await fs.readFile(path.join(project, ".cursor", "commands", "cc.md"), "utf8"))).toContain("/cc");
  });

  it("uninstall removes runtime and harness assets", async () => {
    project = await createTempProject();
    await initCclaw({ cwd: project });
    await uninstallCclaw({ cwd: project });
    await expect(fs.access(path.join(project, ".cclaw"))).rejects.toBeTruthy();
    await expect(fs.access(path.join(project, ".cursor", "commands", "cc.md"))).rejects.toBeTruthy();
  });
});
