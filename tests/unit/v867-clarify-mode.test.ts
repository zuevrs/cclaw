import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { initCclaw } from "../../src/install.js";
import { createTempProject, removeProject } from "../helpers/temp-project.js";

/**
 * v8.67 — Pre-plan clarify mode wiring.
 *
 * Asserts the `ambiguity-discipline` skill is installed by `cclaw init`.
 * (The `clarifyAmbiguityThresholdOf` config-util tests were retired with
 * the never-called helper; the clarify threshold is LLM-read from the
 * architect prompt + dispatch runbook, not via a TypeScript reader.)
 */
describe("v8.67 — ambiguity-discipline skill is installed by cclaw init", () => {
  it("`cclaw init` writes ambiguity-discipline.md into the install layer", async () => {
    const project = await createTempProject({ prefix: "v867-clarify-" });
    try {
      await initCclaw({ cwd: project, interactive: false });
      const installed = path.join(
        project,
        ".cclaw",
        "lib",
        "skills",
        "ambiguity-discipline.md"
      );
      const body = await fs.readFile(installed, "utf8");
      expect(body).toMatch(/Skill: ambiguity-discipline/);
      expect(body).toMatch(/## Assumptions \(correct me now\)/);
    } finally {
      await removeProject(project);
    }
  });
});
