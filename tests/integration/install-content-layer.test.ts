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

  it("ships every reference pattern under .cclaw/lib/patterns/", async () => {
    project = await createTempProject();
    await initCclaw({ cwd: project });
    for (const fileName of ["api-endpoint.md", "auth-flow.md", "schema-migration.md", "ui-component.md", "perf-fix.md", "refactor.md", "security-hardening.md", "doc-rewrite.md"]) {
      const stat = await fs.stat(path.join(project, ".cclaw", "lib", "patterns", fileName));
      expect(stat.isFile()).toBe(true);
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

  it("ships the decision protocol short-form under .cclaw/lib/", async () => {
    project = await createTempProject();
    await initCclaw({ cwd: project });
    const body = await fs.readFile(path.join(project, ".cclaw", "lib", "decision-protocol.md"), "utf8");
    expect(body).toContain("Decision protocol");
    expect(body).toContain("short form");
    expect(body).toContain("decision-permission-cache");
  });

  it("ships antipatterns and meta skill", async () => {
    project = await createTempProject();
    await initCclaw({ cwd: project });
    const antipatterns = await fs.readFile(path.join(project, ".cclaw", "lib", "antipatterns.md"), "utf8");
    expect(antipatterns).toContain("A-1");
    const meta = await fs.readFile(path.join(project, ".cclaw", "lib", "skills", "cclaw-meta.md"), "utf8");
    expect(meta).toContain("cclaw-meta");
    expect(meta).toContain("trigger: always-on");
  });

  it("ships exactly 8 examples under .cclaw/lib/examples/ with an index", async () => {
    project = await createTempProject();
    await initCclaw({ cwd: project });
    for (const fileName of ["plan-small.md", "plan-parallel-build.md", "build-log.md", "review-log.md", "ship-notes.md", "decision-permission-cache.md", "learning-record.md", "commit-helper-session.md", "index.md"]) {
      const stat = await fs.stat(path.join(project, ".cclaw", "lib", "examples", fileName));
      expect(stat.isFile()).toBe(true);
    }
    for (const stale of ["plan-refinement.md", "decision-record.md", "knowledge-line.md", "refinement-detection.md", "parallel-build-dispatch.md", "review-cap-reached.md"]) {
      await expect(fs.access(path.join(project, ".cclaw", "lib", "examples", stale))).rejects.toBeTruthy();
    }
  });

  it("ships ten skills including meta and the four new ones", async () => {
    project = await createTempProject();
    await initCclaw({ cwd: project });
    for (const fileName of ["plan-authoring.md", "ac-traceability.md", "refinement.md", "parallel-build.md", "security-review.md", "review-loop.md", "commit-message-quality.md", "ac-quality.md", "refactor-safety.md", "breaking-changes.md", "cclaw-meta.md"]) {
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
