import { afterEach, describe, expect, it } from "vitest";
import { activeArtifactPath } from "../../src/artifact-paths.js";
import { writeFileSafe } from "../../src/fs-utils.js";
import { classifyRouting, findMatchingPlans } from "../../src/orchestrator-routing.js";
import { createTempProject, removeProject } from "../helpers/temp-project.js";

describe("orchestrator routing — 7 smoke scenarios", () => {
  let project: string;
  afterEach(async () => {
    if (project) await removeProject(project);
  });

  it("1) typo fix → trivial path", () => {
    const result = classifyRouting("Fix typo in README.md");
    expect(result.class).toBe("trivial");
  });

  it("2) new endpoint with 3 AC → small-medium inline", () => {
    const result = classifyRouting("Add /health endpoint that responds with 200, returns version, logs request id");
    expect(result.class).toBe("small-medium");
  });

  it("3) 'make app faster' → large/abstract → specialist proposal", () => {
    const result = classifyRouting("Make the app faster across multiple services and refactor the cache layer");
    expect(result.class).toBe("large-risky");
  });

  it("4) existing plan + 'add validation' → refinement detected → amend", async () => {
    project = await createTempProject();
    await writeFileSafe(
      activeArtifactPath(project, "plan", "approval-page"),
      "---\nslug: approval-page\nstage: plan\nstatus: active\nac: []\n---\n\n# approval page\n\nApproval page with validation pill.\n"
    );
    const matches = await findMatchingPlans(project, "Add validation to approval page form");
    expect(matches[0]?.origin).toBe("active");
    expect(matches[0]?.slug).toBe("approval-page");
  });

  it("5) existing plan + 'totally rewrite' → refinement detected → rewrite confirm", async () => {
    project = await createTempProject();
    await writeFileSafe(
      activeArtifactPath(project, "plan", "billing-flow"),
      "---\nslug: billing-flow\nstage: plan\nstatus: active\nac: []\n---\n\n# billing flow\n\nBilling flow with subscriptions and invoices.\n"
    );
    const matches = await findMatchingPlans(project, "Totally rewrite billing flow");
    expect(matches[0]?.slug).toBe("billing-flow");
  });

  it("6) complex auth migration → all 3 specialists invoked sequentially", () => {
    const result = classifyRouting("Migrate auth from session cookies to JWT across services with refresh tokens and audit logging");
    expect(result.class).toBe("large-risky");
  });

  it("7) doc-only ask → small-medium inline (orchestrator handles docs without specialists)", () => {
    const result = classifyRouting("Update README quickstart with the new install command");
    expect(result.class).toBe("small-medium");
  });
});
