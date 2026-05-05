import { describe, expect, it } from "vitest";
import { evaluateRedCheckpoint } from "../../src/artifact-linter/tdd.js";
import type { DelegationEntry } from "../../src/delegation.js";

/**
 * — `evaluateRedCheckpoint` enforces wave-batched
 * RED-before-GREEN ordering. The rule fires only when an explicit wave
 * manifest defines membership, OR an implicit wave (2+ contiguous reds)
 * is detectable from the timestamp ordering. Sequential per-slice runs
 * (red → green → red → green) form size-1 implicit waves and never fire.
 */

function ts(min: number): string {
  const base = Date.parse("2026-03-01T10:00:00Z");
  return new Date(base + min * 60_000).toISOString();
}

function evt(
  slice: string,
  phase: "red" | "green" | "refactor" | "refactor-deferred" | "doc",
  completedTs: string,
  agent = "slice-builder"
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

describe("evaluateRedCheckpoint — implicit waves", () => {
  it("returns ok when sequential single-slice runs (red→green) interleave (size-1 waves only)", () => {
    const slices = new Map<string, DelegationEntry[]>([
      ["S-1", [evt("S-1", "red", ts(0)), evt("S-1", "green", ts(1))]],
      ["S-2", [evt("S-2", "red", ts(2)), evt("S-2", "green", ts(3))]]
    ]);
    const result = evaluateRedCheckpoint(slices, null);
    expect(result.ok).toBe(true);
    expect(result.details).toContain("inactive");
  });

  it("returns ok when ALL Phase A reds precede ALL Phase B greens in an implicit wave", () => {
    const slices = new Map<string, DelegationEntry[]>([
      ["S-1", [evt("S-1", "red", ts(0)), evt("S-1", "green", ts(10))]],
      ["S-2", [evt("S-2", "red", ts(1)), evt("S-2", "green", ts(11))]],
      ["S-3", [evt("S-3", "red", ts(2)), evt("S-3", "green", ts(12))]]
    ]);
    const result = evaluateRedCheckpoint(slices, null);
    expect(result.ok).toBe(true);
  });

  it("returns violation when a wave member's later red completes after its earlier green", () => {
    // Implicit wave membership for the leading run of reds: {S-1, S-2}.
    // S-1 then re-opens with a SECOND phase=red at ts(5) — backslide-style
    // pattern where the controller fixed-up the test after going GREEN.
    // The wave's max red ts is now 5, but S-1's green at ts(3) precedes it.
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
    const result = evaluateRedCheckpoint(slices, null);
    expect(result.ok).toBe(false);
    expect(result.details).toContain("S-1");
    expect(result.details).toContain("precedes");
  });
});

describe("evaluateRedCheckpoint — explicit wave manifest", () => {
  it("returns violation when an explicit wave's green precedes the wave's last red", () => {
    const manifest = new Map<string, Set<string>>([
      ["W-01", new Set(["S-1", "S-2", "S-3"])]
    ]);
    const slices = new Map<string, DelegationEntry[]>([
      ["S-1", [evt("S-1", "red", ts(0)), evt("S-1", "green", ts(2))]],
      ["S-2", [evt("S-2", "red", ts(1))]],
      ["S-3", [evt("S-3", "red", ts(5))]]
    ]);
    const result = evaluateRedCheckpoint(slices, manifest);
    expect(result.ok).toBe(false);
    expect(result.details).toContain("W-01");
    expect(result.details).toContain("S-1");
  });

  it("returns ok when an explicit wave's reds all complete before any green", () => {
    const manifest = new Map<string, Set<string>>([
      ["W-01", new Set(["S-1", "S-2"])]
    ]);
    const slices = new Map<string, DelegationEntry[]>([
      ["S-1", [evt("S-1", "red", ts(0)), evt("S-1", "green", ts(10))]],
      ["S-2", [evt("S-2", "red", ts(2)), evt("S-2", "green", ts(11))]]
    ]);
    const result = evaluateRedCheckpoint(slices, manifest);
    expect(result.ok).toBe(true);
  });

  it("ignores waves with fewer than one red and one green (no enforceable checkpoint)", () => {
    const manifest = new Map<string, Set<string>>([
      ["W-02", new Set(["S-9"])]
    ]);
    const slices = new Map<string, DelegationEntry[]>([
      ["S-9", [evt("S-9", "red", ts(0))]]
    ]);
    const result = evaluateRedCheckpoint(slices, manifest);
    expect(result.ok).toBe(true);
  });
});
