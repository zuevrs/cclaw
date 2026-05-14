import { describe, expect, it } from "vitest";

import { LEGACY_PLANNER_ID, SPECIALISTS } from "../../src/types.js";
import {
  isLegacyPlanner,
  migrateFlowState,
  FLOW_STATE_SCHEMA_VERSION
} from "../../src/flow-state.js";

/**
 * v8.28 — rename `planner` → `ac-author` migration anchors (slimmed v8.54).
 *
 * The "rename shipped" assertions (~17) that swept every prompt and registry
 * for the new name are now covered by `core-agents.test.ts`,
 * `types.test.ts`, `critic-specialist.test.ts`, etc. What stays here is the
 * migration contract: legacy state files with `lastSpecialist: "planner"`
 * are rewritten to `"ac-author"` at read time, semantics-preserving.
 */

describe("v8.28 — planner → ac-author migration (semantics-preserving)", () => {
  it("LEGACY_PLANNER_ID is exported and equal to `planner`", () => {
    expect(LEGACY_PLANNER_ID).toBe("planner");
  });

  it("`ac-author` is in SPECIALISTS; `planner` is not", () => {
    expect((SPECIALISTS as readonly string[]).includes("ac-author")).toBe(true);
    expect((SPECIALISTS as readonly string[]).includes("planner")).toBe(false);
  });

  it("isLegacyPlanner identifies `planner` and rejects modern ids", () => {
    expect(isLegacyPlanner("planner")).toBe(true);
    expect(isLegacyPlanner("ac-author")).toBe(false);
    expect(isLegacyPlanner("design")).toBe(false);
    expect(isLegacyPlanner(null)).toBe(false);
    expect(isLegacyPlanner(undefined)).toBe(false);
  });

  it("migrateFlowState rewrites `lastSpecialist: planner` → `ac-author` and bumps schemaVersion", () => {
    const legacy = {
      schemaVersion: 2,
      currentSlug: "demo",
      currentStage: "plan",
      ac: [],
      lastSpecialist: "planner",
      startedAt: "2026-05-14T00:00:00.000Z",
      reviewIterations: 0,
      securityFlag: false,
      triage: null
    };
    const migrated = migrateFlowState(legacy);
    expect(migrated.lastSpecialist).toBe("ac-author");
    expect(migrated.schemaVersion).toBe(FLOW_STATE_SCHEMA_VERSION);
  });

  it("migrateFlowState leaves modern state untouched", () => {
    const modern = {
      schemaVersion: FLOW_STATE_SCHEMA_VERSION,
      currentSlug: "demo",
      currentStage: "plan" as const,
      ac: [],
      lastSpecialist: "ac-author" as const,
      startedAt: "2026-05-14T00:00:00.000Z",
      reviewIterations: 0,
      securityFlag: false,
      triage: null
    };
    const out = migrateFlowState({ ...modern });
    expect(out.lastSpecialist).toBe("ac-author");
  });
});
