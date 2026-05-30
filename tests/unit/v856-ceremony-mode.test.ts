/**
 * v8.56 — `acMode` → `ceremonyMode` rename. The runtime on-read migration is
 * the live contract; the one-release type aliases (`AC_MODES` / `AcMode`) were
 * removed once their deprecation window closed.
 *
 * These tripwires lock the safe-rename contract:
 *   1. The canonical surface (constant, type, field) uses the v8.56 name.
 *   2. A `flow-state.json` written by a pre-v8.56 cclaw (with `triage.acMode`)
 *      is migrated on read into a v8.56-shaped triage carrying
 *      `triage.ceremonyMode` and no residual `acMode` field.
 *
 * If this test ever fails, the rename has drifted (canonical name regressed)
 * or the on-read migration broke — both are user-visible regressions.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { FLOW_STATE_REL_PATH } from "../../src/constants.js";
import { migrateFlowState } from "../../src/flow-state.js";
import { readFlowState } from "../../src/run-persistence.js";
import { CEREMONY_MODES, type CeremonyMode } from "../../src/types.js";
import { createTempProject, removeProject } from "../helpers/temp-project.js";

describe("v8.56 — canonical names", () => {
  it("CEREMONY_MODES enumerates the three canonical modes (inline | soft | strict)", () => {
    expect(CEREMONY_MODES).toEqual(["inline", "soft", "strict"]);
  });
});

describe("v8.56 — flow-state legacy alias on read (triage.acMode → triage.ceremonyMode)", () => {
  it("migrateFlowState hoists `triage.acMode` to `triage.ceremonyMode` when only the legacy key is present", () => {
    const legacy = {
      schemaVersion: 3,
      currentSlug: "20260515-legacy-acmode-flow",
      currentStage: "build",
      ac: [],
      lastSpecialist: null,
      startedAt: "2026-05-15T00:00:00Z",
      reviewIterations: 0,
      securityFlag: false,
      triage: {
        complexity: "small-medium",
        acMode: "soft",
        path: ["plan", "build", "review", "ship"],
        rationale: "pre-v8.56 file",
        decidedAt: "2026-05-15T00:00:00Z",
        userOverrode: false
      }
    };
    const migrated = migrateFlowState(legacy);
    expect(migrated.triage?.ceremonyMode).toBe("soft");
    expect(
      (migrated.triage as Record<string, unknown> | null)?.acMode,
      "after migration the legacy field must be gone — readers must see exactly one ceremony source-of-truth"
    ).toBeUndefined();
  });

  it("migrateFlowState prefers `ceremonyMode` and strips a stale `acMode` companion when both are present", () => {
    const legacyWithBoth = {
      schemaVersion: 3,
      currentSlug: "20260515-both-keys",
      currentStage: "build",
      ac: [],
      lastSpecialist: null,
      startedAt: "2026-05-15T00:00:00Z",
      reviewIterations: 0,
      securityFlag: false,
      triage: {
        complexity: "small-medium",
        ceremonyMode: "strict",
        acMode: "soft",
        path: ["plan", "build", "review", "ship"],
        rationale: "shoudl-not-happen-but-tolerate",
        decidedAt: "2026-05-15T00:00:00Z",
        userOverrode: false
      }
    };
    const migrated = migrateFlowState(legacyWithBoth);
    expect(migrated.triage?.ceremonyMode).toBe("strict");
    expect(
      (migrated.triage as Record<string, unknown> | null)?.acMode
    ).toBeUndefined();
  });

  it("readFlowState normalises a pre-v8.56 file with `triage.acMode` on disk into a v8.56-shaped triage", async () => {
    const project = await createTempProject();
    try {
      await fs.mkdir(path.join(project, ".cclaw", "state"), { recursive: true });
      await fs.writeFile(
        path.join(project, FLOW_STATE_REL_PATH),
        JSON.stringify({
          schemaVersion: 3,
          currentSlug: "20260515-disk-legacy",
          currentStage: "plan",
          ac: [],
          lastSpecialist: null,
          startedAt: "2026-05-15T00:00:00Z",
          reviewIterations: 0,
          securityFlag: false,
          triage: {
            complexity: "large-risky",
            acMode: "strict",
            path: ["plan", "build", "review", "ship"],
            rationale: "pre-v8.56 written by older cclaw",
            decidedAt: "2026-05-15T00:00:00Z",
            userOverrode: false
          }
        }),
        "utf8"
      );
      const state = await readFlowState(project);
      expect(state.triage?.ceremonyMode).toBe("strict");
      expect(
        (state.triage as Record<string, unknown> | null)?.acMode,
        "readFlowState must hand the rest of the codebase a v8.56-shaped triage"
      ).toBeUndefined();
    } finally {
      await removeProject(project);
    }
  });
});
