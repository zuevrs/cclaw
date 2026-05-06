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
});
