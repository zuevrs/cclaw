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

  it("installs runtime root with state, hooks, flows/{shipped,cancelled} and lib/* layout", async () => {
    project = await createTempProject();
    await initCclaw({ cwd: project });
    for (const sub of ["state", "hooks", "flows"]) {
      const stat = await fs.stat(path.join(project, ".cclaw", sub));
      expect(stat.isDirectory()).toBe(true);
    }
    for (const sub of ["shipped", "cancelled"]) {
      const stat = await fs.stat(path.join(project, ".cclaw", "flows", sub));
      expect(stat.isDirectory()).toBe(true);
    }
    for (const stale of ["plans", "builds", "reviews", "ships", "decisions", "learnings"]) {
      await expect(fs.access(path.join(project, ".cclaw", "flows", stale))).rejects.toBeTruthy();
    }
    for (const sub of ["agents", "skills", "templates", "runbooks", "patterns", "research", "recovery", "examples"]) {
      const stat = await fs.stat(path.join(project, ".cclaw", "lib", sub));
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

  it("auto-detects cursor harness when .cursor/ marker exists and no --harness is passed", async () => {
    project = await createTempProject();
    const result = await initCclaw({ cwd: project });
    expect(result.installedHarnesses).toEqual(["cursor"]);
    const cc = await fs.readFile(path.join(project, ".cursor", "commands", "cc.md"), "utf8");
    expect(cc).toContain("/cc");
    const planner = await fs.readFile(path.join(project, ".cursor", "agents", "planner.md"), "utf8");
    expect(planner).toContain("planner");
  });

  it("auto-detects multiple harnesses when several markers exist", async () => {
    project = await createTempProject({ harnessMarkers: [".cursor", ".claude", ".opencode"] });
    const result = await initCclaw({ cwd: project });
    expect(result.installedHarnesses.sort()).toEqual(["claude", "cursor", "opencode"]);
  });

  it("explicit --harness flag overrides auto-detection", async () => {
    project = await createTempProject({ harnessMarkers: [".cursor"] });
    const result = await initCclaw({ cwd: project, harnesses: ["claude"] });
    expect(result.installedHarnesses).toEqual(["claude"]);
  });

  it("init throws if no harness marker is present and no --harness flag is given (non-TTY)", async () => {
    project = await createTempProject({ harnessMarkers: [] });
    await expect(initCclaw({ cwd: project })).rejects.toThrowError(/No harness detected/);
  });

  it("init does NOT invoke the interactive picker when interactive flag is omitted (programmatic callers stay deterministic)", async () => {
    project = await createTempProject({ harnessMarkers: [".claude"] });
    const result = await initCclaw({ cwd: project });
    expect(result.installedHarnesses).toEqual(["claude"]);
  });

  it("init with explicit interactive: true still falls back to auto-detect when stdout is not a TTY (Vitest)", async () => {
    project = await createTempProject({ harnessMarkers: [".cursor"] });
    const result = await initCclaw({ cwd: project, interactive: true });
    expect(result.installedHarnesses).toEqual(["cursor"]);
  });

  it("supports multiple harnesses on sync", async () => {
    project = await createTempProject();
    await syncCclaw({ cwd: project, harnesses: ["claude", "cursor"] });
    expect((await fs.readFile(path.join(project, ".claude", "commands", "cc.md"), "utf8"))).toContain("/cc");
    expect((await fs.readFile(path.join(project, ".cursor", "commands", "cc.md"), "utf8"))).toContain("/cc");
  });

  it("init writes .gitignore with .cclaw/state/ and .cclaw/worktrees/ entries", async () => {
    project = await createTempProject();
    await initCclaw({ cwd: project });
    const body = await fs.readFile(path.join(project, ".gitignore"), "utf8");
    expect(body).toContain(".cclaw/state/");
    expect(body).toContain(".cclaw/worktrees/");
    expect(body).toContain("# cclaw transient state");
    expect(body).not.toContain(".cclaw/lib/");
    expect(body).not.toContain(".cclaw/flows/");
  });

  it("init does NOT create AGENTS.md or CLAUDE.md (cclaw v8 keeps the project root clean)", async () => {
    project = await createTempProject();
    await initCclaw({ cwd: project });
    await expect(fs.access(path.join(project, "AGENTS.md"))).rejects.toBeTruthy();
    await expect(fs.access(path.join(project, "CLAUDE.md"))).rejects.toBeTruthy();
  });

  it("uninstall removes runtime, harness assets, and gitignore patterns", async () => {
    project = await createTempProject();
    await initCclaw({ cwd: project });
    await uninstallCclaw({ cwd: project });
    await expect(fs.access(path.join(project, ".cclaw"))).rejects.toBeTruthy();
    await expect(fs.access(path.join(project, ".cursor", "commands", "cc.md"))).rejects.toBeTruthy();
    await expect(fs.access(path.join(project, ".gitignore"))).rejects.toBeTruthy();
  });

  it("uninstall preserves user-authored .gitignore entries while removing cclaw lines", async () => {
    project = await createTempProject();
    await fs.writeFile(path.join(project, ".gitignore"), "node_modules/\ncoverage/\n", "utf8");
    await initCclaw({ cwd: project });
    await uninstallCclaw({ cwd: project });
    const body = await fs.readFile(path.join(project, ".gitignore"), "utf8");
    expect(body).toContain("node_modules/");
    expect(body).toContain("coverage/");
    expect(body).not.toContain(".cclaw/state/");
    expect(body).not.toContain(".cclaw/worktrees/");
    expect(body).not.toContain("# cclaw transient state");
  });
});
