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
    // v8.54: `decisions.md` is gated behind config.legacyArtifacts; on the
    // default install the template is intentionally absent (the design
    // phase inlines D-N rows into plan.md > ## Decisions).
    for (const fileName of ["plan.md", "build.md", "review.md", "ship.md", "learnings.md", "manifest.md", "iron-laws.md"]) {
      const stat = await fs.stat(path.join(project, ".cclaw", "lib", "templates", fileName));
      expect(stat.isFile()).toBe(true);
    }
  });

  it("populates .cclaw/lib/skills with every auto-trigger skill", async () => {
    project = await createTempProject();
    await initCclaw({ cwd: project });
    for (const fileName of ["plan-authoring.md", "commit-hygiene.md", "summary-format.md", "parallel-build.md", "review-discipline.md", "tdd-and-verification.md"]) {
      const stat = await fs.stat(path.join(project, ".cclaw", "lib", "skills", fileName));
      expect(stat.isFile()).toBe(true);
    }
  });

  it("v8.60 — does not install ideas.md template (retired with /cc-idea)", async () => {
    project = await createTempProject();
    await initCclaw({ cwd: project });
    await expect(
      fs.access(path.join(project, ".cclaw", "lib", "templates", "ideas.md"))
    ).rejects.toBeTruthy();
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

  it("ships specialist contracts in the shared brain with frontmatter and modes (v8.123 — contracts live ONLY in .cclaw/lib/agents; `architect` exposes Posture, the other six expose Modes; per-harness mirror is retired)", async () => {
    project = await createTempProject();
    await syncCclaw({ cwd: project, harnesses: ["cursor", "claude"] });
    const agentsDir = path.join(project, ".cclaw", "lib", "agents");

    // v8.62 — `architect` (renamed from `ac-author`, absorbing dead
    // `design`'s Phase 0/2-6 work) advertises Posture (lite/standard/
    // strict) instead of Modes; every other specialist still advertises
    // Modes. None activate main-context any more — v8.61 dropped the
    // mid-plan dialogue protocol and v8.62 demoted the last main-context
    // specialist (`design`) by absorbing it into `architect`.
    const architectBody = await fs.readFile(path.join(agentsDir, "architect.md"), "utf8");
    expect(architectBody).toContain("activation: on-demand");
    expect(architectBody).toContain("## Posture");

    for (const agent of ["builder", "reviewer", "critic", "plan-critic", "qa-runner", "triage"]) {
      const body = await fs.readFile(path.join(agentsDir, `${agent}.md`), "utf8");
      expect(body).toContain("activation: on-demand");
      expect(body).toContain("## Modes");
    }

    // Retired specialists must not be re-installed: brainstormer (v8.14),
    // a pre-v8.14 architect (v8.14 retirement; reclaimed by v8.62), and
    // the v8.62 retirees (design, ac-author, slice-builder,
    // security-reviewer).
    for (const retired of [
      "brainstormer",
      "design",
      "ac-author",
      "slice-builder",
      "security-reviewer"
    ]) {
      await expect(fs.access(path.join(agentsDir, `${retired}.md`))).rejects.toBeTruthy();
    }

    // v8.123 — the per-harness agent / skill mirror is retired; a harness
    // dir carries only commands + the ambient rules file, never a copy of
    // the specialist contracts or skills.
    for (const harness of [".cursor", ".claude"]) {
      await expect(fs.access(path.join(project, harness, "agents"))).rejects.toBeTruthy();
      await expect(fs.access(path.join(project, harness, "skills", "cclaw"))).rejects.toBeTruthy();
    }
  });
});
