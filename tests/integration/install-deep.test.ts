import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { initCclaw, syncCclaw, uninstallCclaw } from "../../src/install.js";
import { createTempProject, removeProject } from "../helpers/temp-project.js";

describe("install — deep content", () => {
  let project: string;
  afterEach(async () => {
    if (project) await removeProject(project);
  });

  it("populates .cclaw/templates with every artifact template", async () => {
    project = await createTempProject();
    await initCclaw({ cwd: project });
    for (const fileName of ["plan.md", "build.md", "review.md", "ship.md", "decisions.md", "learnings.md", "manifest.md", "ideas.md", "agents-block.md", "iron-laws.md"]) {
      const stat = await fs.stat(path.join(project, ".cclaw", "templates", fileName));
      expect(stat.isFile()).toBe(true);
    }
  });

  it("populates .cclaw/skills with every auto-trigger skill", async () => {
    project = await createTempProject();
    await initCclaw({ cwd: project });
    for (const fileName of ["plan-authoring.md", "ac-traceability.md", "refinement.md", "parallel-build.md", "security-review.md", "review-loop.md"]) {
      const stat = await fs.stat(path.join(project, ".cclaw", "skills", fileName));
      expect(stat.isFile()).toBe(true);
    }
  });

  it("seeds .cclaw/ideas.md but does not overwrite an existing file on resync", async () => {
    project = await createTempProject();
    await initCclaw({ cwd: project });
    const ideasPath = path.join(project, ".cclaw", "ideas.md");
    await fs.appendFile(ideasPath, "\n## 2026-05-07T00:00:00Z — keep me\n\nsentinel\n", "utf8");
    await syncCclaw({ cwd: project, harnesses: ["cursor"] });
    const body = await fs.readFile(ideasPath, "utf8");
    expect(body).toContain("sentinel");
  });

  it("writes a cclaw-routing block into AGENTS.md and removes it on uninstall", async () => {
    project = await createTempProject();
    await initCclaw({ cwd: project });
    const agentsPath = path.join(project, "AGENTS.md");
    const body = await fs.readFile(agentsPath, "utf8");
    expect(body).toContain("<!-- cclaw-routing:start");
    expect(body).toContain("<!-- cclaw-routing:end -->");

    await uninstallCclaw({ cwd: project });
    await expect(fs.access(agentsPath)).rejects.toBeTruthy();
  });

  it("preserves existing AGENTS.md content outside the cclaw-routing block on uninstall", async () => {
    project = await createTempProject();
    const agentsPath = path.join(project, "AGENTS.md");
    await fs.writeFile(agentsPath, "# Project\n\nKeep me.\n", "utf8");
    await initCclaw({ cwd: project });
    await uninstallCclaw({ cwd: project });
    const body = await fs.readFile(agentsPath, "utf8");
    expect(body).toContain("Keep me.");
    expect(body).not.toContain("cclaw-routing");
  });

  it("ships agent files with frontmatter and modes for every harness", async () => {
    project = await createTempProject();
    await syncCclaw({ cwd: project, harnesses: ["cursor", "claude"] });
    for (const harness of [".cursor", ".claude"]) {
      for (const agent of ["brainstormer", "architect", "planner", "reviewer", "security-reviewer", "slice-builder"]) {
        const body = await fs.readFile(path.join(project, harness, "agents", `${agent}.md`), "utf8");
        expect(body).toContain("activation: on-demand");
        expect(body).toContain("## Modes");
      }
    }
  });
});
