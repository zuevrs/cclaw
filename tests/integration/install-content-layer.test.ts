import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { initCclaw, uninstallCclaw } from "../../src/install.js";
import { createTempProject, removeProject } from "../helpers/temp-project.js";

describe("install — deep content layer", () => {
  let project: string;
  afterEach(async () => {
    if (project) await removeProject(project);
  });

  it("installs lib/runbooks, lib/patterns, lib/research, lib/recovery, lib/examples", async () => {
    project = await createTempProject();
    await initCclaw({ cwd: project });
    for (const dir of ["runbooks", "patterns", "research", "recovery", "examples"]) {
      const stat = await fs.stat(path.join(project, ".cclaw", "lib", dir));
      expect(stat.isDirectory()).toBe(true);
    }
  });

  it("ships only the v8.12 trimmed pattern set under .cclaw/lib/patterns/", async () => {
    project = await createTempProject();
    await initCclaw({ cwd: project });
    for (const fileName of ["auth-flow.md", "security-hardening.md", "index.md"]) {
      const stat = await fs.stat(path.join(project, ".cclaw", "lib", "patterns", fileName));
      expect(stat.isFile()).toBe(true);
    }
    for (const stale of ["api-endpoint.md", "schema-migration.md", "ui-component.md", "perf-fix.md", "refactor.md", "doc-rewrite.md"]) {
      await expect(fs.access(path.join(project, ".cclaw", "lib", "patterns", stale))).rejects.toBeTruthy();
    }
  });

  it("ships all four stage runbooks under .cclaw/lib/runbooks/", async () => {
    project = await createTempProject();
    await initCclaw({ cwd: project });
    for (const fileName of ["plan.md", "build.md", "review.md", "ship.md"]) {
      const stat = await fs.stat(path.join(project, ".cclaw", "lib", "runbooks", fileName));
      expect(stat.isFile()).toBe(true);
    }
  });

  it("ships the decision protocol short-form under .cclaw/lib/ (no longer cites deleted worked examples)", async () => {
    project = await createTempProject();
    await initCclaw({ cwd: project });
    const body = await fs.readFile(path.join(project, ".cclaw", "lib", "decision-protocol.md"), "utf8");
    expect(body).toContain("Decision protocol");
    expect(body).toContain("short form");
    expect(body).not.toContain("decision-permission-cache");
    expect(body).not.toContain("Worked examples");
  });

  it("ships antipatterns (A-1..A-7) and meta skill", async () => {
    project = await createTempProject();
    await initCclaw({ cwd: project });
    const antipatterns = await fs.readFile(path.join(project, ".cclaw", "lib", "antipatterns.md"), "utf8");
    expect(antipatterns).toContain("A-1");
    expect(antipatterns).toContain("A-7");
    expect(antipatterns).not.toContain("## A-8");
    const meta = await fs.readFile(path.join(project, ".cclaw", "lib", "skills", "cclaw-meta.md"), "utf8");
    expect(meta).toContain("cclaw-meta");
    expect(meta).toContain("trigger: always-on");
  });

  it("examples / recovery / research directories ship only their index notes (orphan content deleted)", async () => {
    project = await createTempProject();
    await initCclaw({ cwd: project });
    for (const dir of ["examples", "recovery", "research"]) {
      const entries = await fs.readdir(path.join(project, ".cclaw", "lib", dir));
      expect(entries.sort()).toEqual(["index.md"]);
      const indexBody = await fs.readFile(path.join(project, ".cclaw", "lib", dir, "index.md"), "utf8");
      expect(indexBody).toMatch(/v8\.12/u);
      expect(indexBody).toMatch(/legacy-artifacts/u);
    }
  });

  it("ships the merged-thematic skill set (v8.16) including meta", async () => {
    project = await createTempProject();
    await initCclaw({ cwd: project });
    for (const fileName of ["plan-authoring.md", "ac-discipline.md", "refinement.md", "parallel-build.md", "review-discipline.md", "commit-hygiene.md", "tdd-and-verification.md", "api-evolution.md", "debug-and-browser.md", "cclaw-meta.md"]) {
      const stat = await fs.stat(path.join(project, ".cclaw", "lib", "skills", fileName));
      expect(stat.isFile()).toBe(true);
    }
  });

  it("uninstall removes everything (runbooks, patterns, etc.)", async () => {
    project = await createTempProject();
    await initCclaw({ cwd: project });
    await uninstallCclaw({ cwd: project });
    await expect(fs.access(path.join(project, ".cclaw"))).rejects.toBeTruthy();
  });
});
