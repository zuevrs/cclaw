import { describe, expect, it } from "vitest";
import {
  evaluateGlobalRedCheckpoint,
  evaluatePerSliceRedBeforeGreen,
  evaluateRedCheckpoint
} from "../../src/artifact-linter/tdd.js";
import type { DelegationEntry } from "../../src/delegation.js";

/**
 * v6.14.0 — checkpoint-mode tests.
 *
 * `per-slice` mode allows lanes to interleave RED/GREEN across slices
 * (stream-style waves), and only catches a slice whose own GREEN
 * precedes its own RED.
 *
 * `global-red` mode (legacyContinuation: true or explicit opt-in)
 * keeps the v6.13.x wave-batched RED-before-GREEN invariant via
 * `evaluateRedCheckpoint` (alias for `evaluateGlobalRedCheckpoint`).
 */

function ts(min: number): string {
  const base = Date.parse("2026-04-01T10:00:00Z");
  return new Date(base + min * 60_000).toISOString();
}

function evt(
  slice: string,
  phase: "red" | "green" | "refactor" | "refactor-deferred" | "doc",
  completedTs: string,
  agent = phase === "red" ? "test-author" : "slice-implementer"
): DelegationEntry {
  return {
    stage: "tdd",
    agent,
    mode: "mandatory",
    status: "completed",
    sliceId: slice,
    phase,
    evidenceRefs: ["x"],
    spanId: `${slice}-${phase}`,
    ts: completedTs,
    completedTs
  } as unknown as DelegationEntry;
}

describe("evaluatePerSliceRedBeforeGreen (v6.14.0 default mode)", () => {
  it("allows cross-lane RED/GREEN interleaving (stream-style)", () => {
    const slices = new Map<string, DelegationEntry[]>([
      [
        "S-1",
        [evt("S-1", "red", ts(0)), evt("S-1", "green", ts(2))]
      ],
      [
        "S-2",
        // S-2's RED happens AFTER S-1's GREEN — the global-red rule
        // would flag this as a violation; per-slice does not.
        [evt("S-2", "red", ts(5)), evt("S-2", "green", ts(7))]
      ]
    ]);
    const result = evaluatePerSliceRedBeforeGreen(slices);
    expect(result.ok).toBe(true);
    expect(result.details).toContain("Per-slice RED-before-GREEN holds");
  });

  it("flags a slice whose own GREEN precedes its own last RED", () => {
    const slices = new Map<string, DelegationEntry[]>([
      [
        "S-1",
        [
          evt("S-1", "red", ts(0)),
          evt("S-1", "green", ts(3)),
          evt("S-1", "red", ts(5))
        ]
      ],
      [
        "S-2",
        [evt("S-2", "red", ts(1)), evt("S-2", "green", ts(2))]
      ]
    ]);
    const result = evaluatePerSliceRedBeforeGreen(slices);
    expect(result.ok).toBe(false);
    expect(result.details).toContain("S-1");
    expect(result.details).toContain("Per-slice RED-before-GREEN violation");
  });

  it("treats slices with only RED or only GREEN as no-violation", () => {
    const slices = new Map<string, DelegationEntry[]>([
      ["S-1", [evt("S-1", "red", ts(0))]],
      ["S-2", [evt("S-2", "green", ts(3))]]
    ]);
    const result = evaluatePerSliceRedBeforeGreen(slices);
    expect(result.ok).toBe(true);
  });
});

describe("evaluateRedCheckpoint == evaluateGlobalRedCheckpoint (legacy mode preserved)", () => {
  it("the v6.14.0 global-red helper is the same function as the legacy export", () => {
    expect(evaluateRedCheckpoint).toBe(evaluateGlobalRedCheckpoint);
  });

  it("global-red catches a wave's GREEN preceding the wave's last RED", () => {
    // Same fixture used by tdd-red-checkpoint-validation.test.ts to
    // double-check the legacy behavior continues to fire.
    const slices = new Map<string, DelegationEntry[]>([
      [
        "S-1",
        [
          evt("S-1", "red", ts(0)),
          evt("S-1", "green", ts(3)),
          evt("S-1", "red", ts(5))
        ]
      ],
      ["S-2", [evt("S-2", "red", ts(1))]]
    ]);
    const result = evaluateGlobalRedCheckpoint(slices, null);
    expect(result.ok).toBe(false);
    expect(result.details).toContain("S-1");
  });

  it("per-slice tolerates the cross-lane interleave that global-red would flag in a manifest wave", () => {
    // Explicit wave manifest ties S-1 and S-2 together. global-red flags
    // S-1's green (ts=2) preceding S-2's red (ts=5) within the wave.
    // per-slice ignores cross-lane ordering.
    const sliceMap = new Map<string, DelegationEntry[]>([
      ["S-1", [evt("S-1", "red", ts(0)), evt("S-1", "green", ts(2))]],
      ["S-2", [evt("S-2", "red", ts(5)), evt("S-2", "green", ts(6))]]
    ]);
    const manifest = new Map<string, Set<string>>([
      ["W-01", new Set(["S-1", "S-2"])]
    ]);
    const globalResult = evaluateGlobalRedCheckpoint(sliceMap, manifest);
    expect(globalResult.ok).toBe(false);

    const perSliceResult = evaluatePerSliceRedBeforeGreen(sliceMap);
    expect(perSliceResult.ok).toBe(true);
  });
});
