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

  it("populates .cclaw/lib/templates with every artifact template", async () => {
    project = await createTempProject();
    await initCclaw({ cwd: project });
    for (const fileName of ["plan.md", "build.md", "review.md", "ship.md", "decisions.md", "learnings.md", "manifest.md", "ideas.md", "iron-laws.md"]) {
      const stat = await fs.stat(path.join(project, ".cclaw", "lib", "templates", fileName));
      expect(stat.isFile()).toBe(true);
    }
  });

  it("populates .cclaw/lib/skills with every auto-trigger skill", async () => {
    project = await createTempProject();
    await initCclaw({ cwd: project });
    for (const fileName of ["plan-authoring.md", "ac-discipline.md", "refinement.md", "parallel-build.md", "review-discipline.md", "tdd-and-verification.md"]) {
      const stat = await fs.stat(path.join(project, ".cclaw", "lib", "skills", fileName));
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

  it("does NOT generate AGENTS.md or CLAUDE.md (cclaw v8 keeps the project root clean)", async () => {
    project = await createTempProject();
    await initCclaw({ cwd: project });
    await expect(fs.access(path.join(project, "AGENTS.md"))).rejects.toBeTruthy();
    await expect(fs.access(path.join(project, "CLAUDE.md"))).rejects.toBeTruthy();
  });

  it("preserves a pre-existing AGENTS.md untouched on init / uninstall", async () => {
    project = await createTempProject();
    const agentsPath = path.join(project, "AGENTS.md");
    await fs.writeFile(agentsPath, "# Project\n\nKeep me.\n", "utf8");
    await initCclaw({ cwd: project });
    const after = await fs.readFile(agentsPath, "utf8");
    expect(after).toBe("# Project\n\nKeep me.\n");
    await uninstallCclaw({ cwd: project });
    expect(await fs.readFile(agentsPath, "utf8")).toBe("# Project\n\nKeep me.\n");
  });

  it("ships agent files with frontmatter and modes for every harness", async () => {
    project = await createTempProject();
    await syncCclaw({ cwd: project, harnesses: ["cursor", "claude"] });
    for (const harness of [".cursor", ".claude"]) {
      // v8.14: brainstormer + architect retired; design takes their place
      // and runs in main context (activation: main-context). The other four
      // sub-agent specialists keep activation: on-demand.
      const designBody = await fs.readFile(
        path.join(project, harness, "agents", "design.md"),
        "utf8"
      );
      expect(designBody).toContain("activation: main-context");
      expect(designBody).toContain("## Modes");

      for (const agent of ["ac-author", "reviewer", "security-reviewer", "slice-builder"]) {
        const body = await fs.readFile(path.join(project, harness, "agents", `${agent}.md`), "utf8");
        expect(body).toContain("activation: on-demand");
        expect(body).toContain("## Modes");
      }

      // Retired specialists must not be re-installed.
      for (const retired of ["brainstormer", "architect"]) {
        await expect(
          fs.access(path.join(project, harness, "agents", `${retired}.md`))
        ).rejects.toBeTruthy();
      }
    }
  });
});
