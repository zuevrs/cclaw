import { describe, expect, it } from "vitest";
import { routeExecutionTopology } from "../../src/execution-topology.js";

describe("routeExecutionTopology", () => {
  it("honors explicit topology overrides", () => {
    expect(
      routeExecutionTopology({
        configuredTopology: "single-builder",
        shape: { unitCount: 3, independentUnitCount: 3 }
      }).topology
    ).toBe("single-builder");
  });

  it("selects parallel-builders only for independent substantial units", () => {
    const decision = routeExecutionTopology({
      configuredTopology: "auto",
      strictness: "balanced",
      maxBuilders: 4,
      shape: {
        unitCount: 3,
        independentUnitCount: 3,
        substantialUnitCount: 3,
        hasPathConflicts: false
      }
    });

    expect(decision.topology).toBe("parallel-builders");
    expect(decision.maxBuilders).toBe(4);
  });

  it("serializes path conflicts instead of fanning out", () => {
    expect(
      routeExecutionTopology({
        configuredTopology: "auto",
        strictness: "balanced",
        shape: {
          unitCount: 2,
          independentUnitCount: 0,
          substantialUnitCount: 2,
          hasPathConflicts: true
        }
      }).topology
    ).toBe("single-builder");
  });

  it("allows inline for a single low-risk inline-safe unit", () => {
    expect(
      routeExecutionTopology({
        configuredTopology: "auto",
        strictness: "fast",
        shape: { unitCount: 1, inlineSafe: true, highRisk: false }
      }).topology
    ).toBe("inline");
  });

  it("keeps strict micro-slice mode available for strict profiles", () => {
    expect(
      routeExecutionTopology({
        configuredTopology: "auto",
        strictness: "strict",
        shape: { unitCount: 1, inlineSafe: true }
      }).topology
    ).toBe("strict-micro");
  });

  // ---------------------------------------------------------------------
  // 7.7.1 — lane-aware inline collapse for discovery/scaffold/docs ready sets.
  // ---------------------------------------------------------------------
  it("collapses a 3-unit discovery-only ready set into inline (controller fulfils)", () => {
    const decision = routeExecutionTopology({
      configuredTopology: "auto",
      strictness: "balanced",
      maxBuilders: 5,
      shape: {
        unitCount: 3,
        independentUnitCount: 3,
        substantialUnitCount: 3,
        hasPathConflicts: false,
        highRisk: false,
        discoveryOnlyUnits: 3
      }
    });
    expect(decision.topology).toBe("inline");
    expect(decision.reason).toMatch(/discovery-only/iu);
  });

  it("hands a 5-unit discovery-only ready set to one single-builder", () => {
    const decision = routeExecutionTopology({
      configuredTopology: "auto",
      strictness: "balanced",
      maxBuilders: 5,
      shape: {
        unitCount: 5,
        independentUnitCount: 5,
        substantialUnitCount: 5,
        hasPathConflicts: false,
        highRisk: false,
        discoveryOnlyUnits: 5
      }
    });
    expect(decision.topology).toBe("single-builder");
    expect(decision.reason).toMatch(/discovery-only/iu);
  });

  it("keeps parallel-builders for mixed lanes (only 2 of 3 are discovery-only)", () => {
    const decision = routeExecutionTopology({
      configuredTopology: "auto",
      strictness: "balanced",
      maxBuilders: 5,
      shape: {
        unitCount: 3,
        independentUnitCount: 3,
        substantialUnitCount: 3,
        hasPathConflicts: false,
        highRisk: false,
        discoveryOnlyUnits: 2
      }
    });
    expect(decision.topology).toBe("parallel-builders");
  });

  it("never inlines a high-risk discovery-only ready set", () => {
    const decision = routeExecutionTopology({
      configuredTopology: "auto",
      strictness: "balanced",
      maxBuilders: 5,
      shape: {
        unitCount: 2,
        independentUnitCount: 2,
        substantialUnitCount: 2,
        hasPathConflicts: false,
        highRisk: true,
        discoveryOnlyUnits: 2
      }
    });
    // High-risk + balanced → falls through the lane-aware branch and lands
    // on parallel-builders/single-builder per the standard heuristic. The
    // 7.7.1 contract is: high-risk MUST NOT inline.
    expect(decision.topology).not.toBe("inline");
  });

  it("routes a high-risk discovery-only ready set under strict to strict-micro", () => {
    const decision = routeExecutionTopology({
      configuredTopology: "auto",
      strictness: "strict",
      maxBuilders: 5,
      shape: {
        unitCount: 3,
        independentUnitCount: 3,
        substantialUnitCount: 3,
        hasPathConflicts: false,
        highRisk: true,
        discoveryOnlyUnits: 3
      }
    });
    expect(decision.topology).toBe("strict-micro");
  });
});
