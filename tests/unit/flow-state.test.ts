import { describe, expect, it } from "vitest";
import {
  FLOW_STATE_SCHEMA_VERSION,
  LEGACY_V8_FLOW_STATE_SCHEMA_VERSION,
  LegacyFlowStateError,
  assertFlowStateV82,
  createInitialFlowState,
  isAcMode,
  isFlowStage,
  isRoutingClass,
  migrateFlowState
} from "../../src/flow-state.js";

describe("flow-state", () => {
  it("uses schema version 3 (cclaw 8.2)", () => {
    expect(FLOW_STATE_SCHEMA_VERSION).toBe(3);
    expect(LEGACY_V8_FLOW_STATE_SCHEMA_VERSION).toBe(2);
    expect(createInitialFlowState().schemaVersion).toBe(3);
  });

  it("creates a fresh state with null slug, null stage, empty AC, null triage", () => {
    const state = createInitialFlowState("2026-05-07T00:00:00Z");
    expect(state).toEqual({
      schemaVersion: 3,
      currentSlug: null,
      currentStage: null,
      ac: [],
      lastSpecialist: null,
      startedAt: "2026-05-07T00:00:00Z",
      reviewIterations: 0,
      securityFlag: false,
      triage: null
    });
  });

  it("validates AC entries", () => {
    expect(() =>
      assertFlowStateV82({
        schemaVersion: 3,
        currentSlug: "x",
        currentStage: "plan",
        ac: [{ id: "AC-1", text: "t", status: "weird" }],
        lastSpecialist: null,
        startedAt: "2026-05-07T00:00:00Z",
        reviewIterations: 0,
        securityFlag: false,
        triage: null
      })
    ).toThrow(/Invalid AC status/);
  });

  it("rejects unknown specialist", () => {
    expect(() =>
      assertFlowStateV82({
        schemaVersion: 3,
        currentSlug: "x",
        currentStage: null,
        ac: [],
        lastSpecialist: "fixer",
        startedAt: "2026-05-07T00:00:00Z",
        reviewIterations: 0,
        securityFlag: false,
        triage: null
      })
    ).toThrow(/Invalid lastSpecialist/);
  });

  it("validates triage decision (acMode, complexity, path)", () => {
    expect(() =>
      assertFlowStateV82({
        schemaVersion: 3,
        currentSlug: "x",
        currentStage: "plan",
        ac: [],
        lastSpecialist: null,
        startedAt: "2026-05-07T00:00:00Z",
        reviewIterations: 0,
        securityFlag: false,
        triage: {
          complexity: "huge" as never,
          acMode: "soft",
          path: ["plan"],
          rationale: "x",
          decidedAt: "2026-05-07T00:00:00Z",
          userOverrode: false
        }
      })
    ).toThrow(/triage.complexity/);
  });

  it("isFlowStage matches the four allowed values", () => {
    expect(isFlowStage("plan")).toBe(true);
    expect(isFlowStage("build")).toBe(true);
    expect(isFlowStage("review")).toBe(true);
    expect(isFlowStage("ship")).toBe(true);
    expect(isFlowStage("brainstorm")).toBe(false);
    expect(isFlowStage("design")).toBe(false);
    expect(isFlowStage("tdd")).toBe(false);
    expect(isFlowStage("spec")).toBe(false);
  });

  it("isAcMode matches inline / soft / strict", () => {
    expect(isAcMode("inline")).toBe(true);
    expect(isAcMode("soft")).toBe(true);
    expect(isAcMode("strict")).toBe(true);
    expect(isAcMode("loose")).toBe(false);
  });

  it("isRoutingClass matches trivial / small-medium / large-risky", () => {
    expect(isRoutingClass("trivial")).toBe(true);
    expect(isRoutingClass("small-medium")).toBe(true);
    expect(isRoutingClass("large-risky")).toBe(true);
    expect(isRoutingClass("micro")).toBe(false);
  });
});

describe("migrateFlowState", () => {
  it("rejects schemaVersion 1 (cclaw 7.x runs)", () => {
    expect(() => migrateFlowState({ schemaVersion: 1, currentStage: "spec" })).toThrow(LegacyFlowStateError);
  });

  it("returns v8.2 states untouched (no rewrite)", () => {
    const fresh = createInitialFlowState("2026-05-07T00:00:00Z");
    expect(migrateFlowState(fresh)).toEqual(fresh);
  });

  it("auto-migrates v8.0/v8.1 (schemaVersion=2) state with no slug to a triage-less v8.2 shape", () => {
    const legacy = {
      schemaVersion: 2,
      currentSlug: null,
      currentStage: null,
      ac: [],
      lastSpecialist: null,
      startedAt: "2026-05-07T00:00:00Z",
      reviewIterations: 0,
      securityFlag: false
    };
    const migrated = migrateFlowState(legacy);
    expect(migrated.schemaVersion).toBe(3);
    expect(migrated.triage).toBeNull();
  });

  it("auto-migrates v8.1 state with an active slug into strict mode (preserves prior behaviour)", () => {
    const legacy = {
      schemaVersion: 2,
      currentSlug: "approval-page",
      currentStage: "build",
      ac: [
        { id: "AC-1", text: "...", status: "pending" },
        { id: "AC-2", text: "...", status: "pending" },
        { id: "AC-3", text: "...", status: "pending" },
        { id: "AC-4", text: "...", status: "pending" },
        { id: "AC-5", text: "...", status: "pending" },
        { id: "AC-6", text: "...", status: "pending" }
      ],
      lastSpecialist: null,
      startedAt: "2026-05-07T00:00:00Z",
      reviewIterations: 0,
      securityFlag: true
    };
    const migrated = migrateFlowState(legacy);
    expect(migrated.triage).not.toBeNull();
    expect(migrated.triage?.acMode).toBe("strict");
    expect(migrated.triage?.complexity).toBe("large-risky");
    expect(migrated.triage?.path).toEqual(["plan", "build", "review", "ship"]);
    expect(migrated.triage?.userOverrode).toBe(false);
  });

  it("rejects unknown schema versions", () => {
    expect(() => migrateFlowState({ schemaVersion: 99 })).toThrow(LegacyFlowStateError);
  });
});
