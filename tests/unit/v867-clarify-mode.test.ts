import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  DEFAULT_CLARIFY_AMBIGUITY_THRESHOLD,
  clarifyAmbiguityThresholdOf
} from "../../src/config.js";
import { initCclaw } from "../../src/install.js";
import { createTempProject, removeProject } from "../helpers/temp-project.js";

/**
 * v8.67 — Pre-plan clarify mode wiring.
 *
 * Slimmed in v8.100: kept the `clarifyAmbiguityThresholdOf` config-util
 * tests and the `initCclaw` install-layer test for the
 * ambiguity-discipline skill. The triage/architect prompt-greps, plan
 * template content-greps, and start-command body greps were removed.
 */
describe("v8.67 — clarifyAmbiguityThresholdOf config knob", () => {
  it("DEFAULT_CLARIFY_AMBIGUITY_THRESHOLD is 60", () => {
    expect(DEFAULT_CLARIFY_AMBIGUITY_THRESHOLD).toBe(60);
  });

  it("clarifyAmbiguityThresholdOf returns the default on null/undefined", () => {
    expect(clarifyAmbiguityThresholdOf(null)).toBe(60);
    expect(clarifyAmbiguityThresholdOf(undefined)).toBe(60);
    expect(clarifyAmbiguityThresholdOf({})).toBe(60);
  });

  it("clarifyAmbiguityThresholdOf honours an explicit override", () => {
    expect(
      clarifyAmbiguityThresholdOf({
        clarify: { ambiguity_threshold: 40 }
      })
    ).toBe(40);
    expect(
      clarifyAmbiguityThresholdOf({
        clarify: { ambiguity_threshold: 85 }
      })
    ).toBe(85);
  });

  it("clarifyAmbiguityThresholdOf clamps out-of-range to default", () => {
    expect(
      clarifyAmbiguityThresholdOf({ clarify: { ambiguity_threshold: -5 } })
    ).toBe(60);
    expect(
      clarifyAmbiguityThresholdOf({ clarify: { ambiguity_threshold: 150 } })
    ).toBe(60);
    expect(
      clarifyAmbiguityThresholdOf({
        clarify: { ambiguity_threshold: Number.NaN }
      })
    ).toBe(60);
  });
});

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
