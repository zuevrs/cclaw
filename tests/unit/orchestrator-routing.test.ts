import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { activeArtifactPath } from "../../src/artifact-paths.js";
import { writeFileSafe } from "../../src/fs-utils.js";
import { classifyRouting, findMatchingPlans } from "../../src/orchestrator-routing.js";
import { createTempProject, removeProject } from "../helpers/temp-project.js";

describe("orchestrator routing", () => {
  let project: string;
  afterEach(async () => {
    if (project) await removeProject(project);
  });

  it("classifies trivial typo fix", () => {
    const result = classifyRouting("Fix typo in README");
    expect(result.class).toBe("trivial");
  });

  it("classifies a small new endpoint as small-medium", () => {
    const result = classifyRouting("Add a /health endpoint that returns ok");
    expect(result.class).toBe("small-medium");
  });

  it("classifies vague large prompts as large-risky", () => {
    const result = classifyRouting("make the app faster across multiple services and refactor the auth flow");
    expect(result.class).toBe("large-risky");
  });

  it("treats security-sensitive keywords as large-risky", () => {
    const result = classifyRouting("Audit GDPR data exports for the billing module");
    expect(result.class).toBe("large-risky");
  });

  it("finds active plan by slug overlap", async () => {
    project = await createTempProject();
    await writeFileSafe(
      activeArtifactPath(project, "plan", "approval-page"),
      "---\nslug: approval-page\nstage: plan\nstatus: active\nac: []\n---\n\n# approval page\n\nWe need to add an approval pill in the dashboard.\n"
    );
    const matches = await findMatchingPlans(project, "Update the approval page");
    expect(matches[0]?.slug).toBe("approval-page");
    expect(matches[0]?.origin).toBe("active");
  });

  it("finds shipped plan when text overlaps strongly", async () => {
    project = await createTempProject();
    const shippedPlan = path.join(project, ".cclaw", "flows", "shipped", "billing-rewrite", "plan.md");
    await writeFileSafe(
      shippedPlan,
      "---\nslug: billing-rewrite\nstage: shipped\nstatus: shipped\nac: []\n---\n\n# billing rewrite\n\nMigrate billing rewrite to the new ledger module across services.\n"
    );
    const matches = await findMatchingPlans(project, "Refine billing rewrite ledger");
    expect(matches.find((entry) => entry.origin === "shipped")?.slug).toBe("billing-rewrite");
  });

  it("returns no match for an unrelated topic", async () => {
    project = await createTempProject();
    await writeFileSafe(
      activeArtifactPath(project, "plan", "approval-page"),
      "---\nslug: approval-page\nstage: plan\nstatus: active\nac: []\n---\n\n# approval page\n"
    );
    const matches = await findMatchingPlans(project, "Wire the analytics tracker for marketing emails");
    expect(matches).toEqual([]);
  });
});
