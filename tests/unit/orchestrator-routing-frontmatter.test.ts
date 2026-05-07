import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { findMatchingPlans, proposeRouting } from "../../src/orchestrator-routing.js";
import { ensureRuntimeRoot } from "../../src/install.js";
import { activeArtifactPath, shippedArtifactDir } from "../../src/artifact-paths.js";
import { createTempProject, removeProject } from "../helpers/temp-project.js";

describe("orchestrator-routing surfaces frontmatter", () => {
  let project: string;
  afterEach(async () => {
    if (project) await removeProject(project);
  });

  it("returns last_specialist and AC progress for an active plan", async () => {
    project = await createTempProject();
    await ensureRuntimeRoot(project);
    const planPath = activeArtifactPath(project, "plan", "approval-page");
    await fs.mkdir(path.dirname(planPath), { recursive: true });
    await fs.writeFile(
      planPath,
      `---\nslug: approval-page\nstage: plan\nstatus: active\nlast_specialist: architect\nac:\n  - id: AC-1\n    text: "Approval pill renders pending status."\n    status: committed\n    commit: abc1234\n  - id: AC-2\n    text: "Tooltip shows approver email."\n    status: pending\n---\n\nbody mentioning approval pill and dashboard pending tooltip.\n`,
      "utf8"
    );

    const matches = await findMatchingPlans(project, "Add approver tooltip on the approval pill on dashboard");
    expect(matches.length).toBeGreaterThan(0);
    const top = matches[0];
    expect(top.slug).toBe("approval-page");
    expect(top.lastSpecialist).toBe("architect");
    expect(top.acProgress).toEqual({ committed: 1, pending: 1, total: 2 });
  });

  it("detects shipped slugs and exposes refines linkage", async () => {
    project = await createTempProject();
    await ensureRuntimeRoot(project);
    const shippedDir = shippedArtifactDir(project, "approval-page");
    await fs.mkdir(shippedDir, { recursive: true });
    await fs.writeFile(
      path.join(shippedDir, "plan.md"),
      `---\nslug: approval-page\nstage: shipped\nstatus: shipped\nrefines: null\nac:\n  - id: AC-1\n    text: "Approval pill renders pending status."\n    status: committed\n    commit: deadbee\n---\n\napproval pill rendering on dashboard.\n`,
      "utf8"
    );

    const matches = await findMatchingPlans(project, "I want to refine the approval pill rendering on the dashboard");
    const shipped = matches.find((entry) => entry.origin === "shipped");
    expect(shipped).toBeDefined();
    expect(shipped?.frontmatter?.status).toBe("shipped");
  });

  it("proposeRouting returns classification + matches", async () => {
    project = await createTempProject();
    await ensureRuntimeRoot(project);
    const proposal = await proposeRouting(project, "fix typo in README intro");
    expect(proposal.classification.class).toBe("trivial");
    expect(Array.isArray(proposal.matches)).toBe(true);
  });
});
