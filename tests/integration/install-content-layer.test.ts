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

  it("installs runbooks, patterns, research, recovery, examples", async () => {
    project = await createTempProject();
    await initCclaw({ cwd: project });
    for (const dir of ["runbooks", "patterns", "research", "recovery", "examples"]) {
      const stat = await fs.stat(path.join(project, ".cclaw", dir));
      expect(stat.isDirectory()).toBe(true);
    }
  });

  it("ships every reference pattern under .cclaw/patterns/", async () => {
    project = await createTempProject();
    await initCclaw({ cwd: project });
    for (const fileName of ["api-endpoint.md", "auth-flow.md", "schema-migration.md", "ui-component.md", "perf-fix.md", "refactor.md", "security-hardening.md", "doc-rewrite.md"]) {
      const stat = await fs.stat(path.join(project, ".cclaw", "patterns", fileName));
      expect(stat.isFile()).toBe(true);
    }
  });

  it("ships all four stage runbooks under .cclaw/runbooks/", async () => {
    project = await createTempProject();
    await initCclaw({ cwd: project });
    for (const fileName of ["plan.md", "build.md", "review.md", "ship.md"]) {
      const stat = await fs.stat(path.join(project, ".cclaw", "runbooks", fileName));
      expect(stat.isFile()).toBe(true);
    }
  });

  it("ships the decision protocol under .cclaw/decisions/", async () => {
    project = await createTempProject();
    await initCclaw({ cwd: project });
    const body = await fs.readFile(path.join(project, ".cclaw", "decisions", "decision-protocol.md"), "utf8");
    expect(body).toContain("Decision protocol");
    expect(body).toContain("D-1");
  });

  it("ships antipatterns and meta skill", async () => {
    project = await createTempProject();
    await initCclaw({ cwd: project });
    const antipatterns = await fs.readFile(path.join(project, ".cclaw", "antipatterns.md"), "utf8");
    expect(antipatterns).toContain("A-1");
    const meta = await fs.readFile(path.join(project, ".cclaw", "skills", "cclaw-meta.md"), "utf8");
    expect(meta).toContain("cclaw-meta");
    expect(meta).toContain("trigger: always-on");
  });

  it("ships all 13 examples under .cclaw/examples/ with an index", async () => {
    project = await createTempProject();
    await initCclaw({ cwd: project });
    for (const fileName of ["plan-small.md", "plan-refinement.md", "plan-parallel-build.md", "build-log.md", "review-log.md", "ship-notes.md", "decision-record.md", "learning-record.md", "knowledge-line.md", "commit-helper-session.md", "refinement-detection.md", "parallel-build-dispatch.md", "review-cap-reached.md", "index.md"]) {
      const stat = await fs.stat(path.join(project, ".cclaw", "examples", fileName));
      expect(stat.isFile()).toBe(true);
    }
  });

  it("ships ten skills including meta and the four new ones", async () => {
    project = await createTempProject();
    await initCclaw({ cwd: project });
    for (const fileName of ["plan-authoring.md", "ac-traceability.md", "refinement.md", "parallel-build.md", "security-review.md", "review-loop.md", "commit-message-quality.md", "ac-quality.md", "refactor-safety.md", "breaking-changes.md", "cclaw-meta.md"]) {
      const stat = await fs.stat(path.join(project, ".cclaw", "skills", fileName));
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
