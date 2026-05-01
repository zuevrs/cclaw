import { describe, expect, it } from "vitest";
import {
  mandatoryAgentsFor,
  mandatoryDelegationsForStage
} from "../../src/content/stage-schema.js";
import { FLOW_STAGES } from "../../src/types.js";
import type { FlowStage } from "../../src/types.js";

/**
 * Wave 24 (v6.0.0) track-aware mandatory delegation drop.
 *
 * `mandatoryAgentsFor(stage, track, taskClass)` MUST collapse to `[]`
 * for the small-fix lanes (quick track or software-bugfix taskClass) so
 * gate-evidence skips the missing-delegations finding entirely.
 *
 * For the standard track with no task-class hint, the helper MUST be
 * a passthrough to the registered list returned by
 * `mandatoryDelegationsForStage`.
 */

const elicitationStages: FlowStage[] = ["brainstorm", "scope", "design"];

describe("mandatoryAgentsFor — Wave 24 track-aware drop", () => {
  it("returns [] for every stage on the quick track regardless of taskClass", () => {
    for (const stage of FLOW_STAGES) {
      expect(mandatoryAgentsFor(stage, "quick")).toEqual([]);
      expect(mandatoryAgentsFor(stage, "quick", "software-standard")).toEqual([]);
      expect(mandatoryAgentsFor(stage, "quick", "software-bugfix")).toEqual([]);
      expect(mandatoryAgentsFor(stage, "quick", "software-trivial")).toEqual([]);
    }
  });

  it("returns [] for every stage when taskClass=software-bugfix even on standard track", () => {
    for (const stage of FLOW_STAGES) {
      expect(mandatoryAgentsFor(stage, "standard", "software-bugfix")).toEqual([]);
      expect(mandatoryAgentsFor(stage, "medium", "software-bugfix")).toEqual([]);
    }
  });

  it("on standard track with no task-class hint passes through to mandatoryDelegationsForStage", () => {
    for (const stage of FLOW_STAGES) {
      const passthrough = mandatoryAgentsFor(stage, "standard");
      const registered = mandatoryDelegationsForStage(stage);
      expect(passthrough).toEqual(registered);
    }
  });

  it("standard track with software-standard taskClass equals the registered list", () => {
    for (const stage of elicitationStages) {
      const result = mandatoryAgentsFor(stage, "standard", "software-standard");
      expect(result).toEqual(mandatoryDelegationsForStage(stage));
    }
  });

  it("medium track with no task-class hint passes through to the registered list", () => {
    for (const stage of FLOW_STAGES) {
      expect(mandatoryAgentsFor(stage, "medium")).toEqual(
        mandatoryDelegationsForStage(stage)
      );
    }
  });

  it("software-trivial taskClass on standard track does NOT skip (only bugfix is dropped)", () => {
    // Wave 24 explicitly chose option (C) — drop only quick + software-bugfix.
    // software-trivial keeps the registered mandatory list because trivial
    // refactors still want a reviewer/critic stamp.
    for (const stage of FLOW_STAGES) {
      expect(mandatoryAgentsFor(stage, "standard", "software-trivial")).toEqual(
        mandatoryDelegationsForStage(stage)
      );
    }
  });

  it("at least one stage has a non-empty registered list (sanity check the fixtures)", () => {
    const anyNonEmpty = FLOW_STAGES.some(
      (stage) => mandatoryDelegationsForStage(stage).length > 0
    );
    expect(anyNonEmpty).toBe(true);
  });
});
