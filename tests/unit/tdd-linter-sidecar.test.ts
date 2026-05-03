import { describe, expect, it } from "vitest";
import {
  evaluateSidecarSliceCycle,
  evaluateSidecarWatchedRed
} from "../../src/artifact-linter/tdd.js";
import type { TddSliceLedgerEntry } from "../../src/tdd-slices.js";

const baseEntry: TddSliceLedgerEntry = {
  runId: "run-1",
  sliceId: "S-1",
  status: "red",
  testFile: "tests/foo.spec.ts",
  testCommand: "npm test -- foo",
  redObservedAt: "2026-04-15T10:00:00.000Z",
  claimedPaths: ["src/foo.ts"],
  schemaVersion: 1
};

describe("evaluateSidecarWatchedRed", () => {
  it("flags an empty sidecar", () => {
    const result = evaluateSidecarWatchedRed([]);
    expect(result.ok).toBe(false);
    expect(result.details).toMatch(/empty/);
  });

  it("accepts a row with all required RED fields", () => {
    const result = evaluateSidecarWatchedRed([baseEntry]);
    expect(result.ok).toBe(true);
    expect(result.details).toMatch(/1 slice row/);
  });

  it("rejects a row missing redObservedAt", () => {
    const result = evaluateSidecarWatchedRed([
      { ...baseEntry, redObservedAt: undefined }
    ]);
    expect(result.ok).toBe(false);
    expect(result.details).toMatch(/missing redObservedAt/);
  });

  it("rejects a non-ISO redObservedAt", () => {
    const result = evaluateSidecarWatchedRed([
      { ...baseEntry, redObservedAt: "yesterday" }
    ]);
    expect(result.ok).toBe(false);
    expect(result.details).toMatch(/not an ISO/);
  });

  it("rejects a row missing claimedPaths", () => {
    const result = evaluateSidecarWatchedRed([
      { ...baseEntry, claimedPaths: [] }
    ]);
    expect(result.ok).toBe(false);
    expect(result.details).toMatch(/missing claimedPaths/);
  });
});

describe("evaluateSidecarSliceCycle", () => {
  it("accepts red-only when GREEN/REFACTOR not yet recorded", () => {
    const result = evaluateSidecarSliceCycle([baseEntry]);
    expect(result.ok).toBe(true);
  });

  it("accepts red -> green monotonic", () => {
    const result = evaluateSidecarSliceCycle([
      baseEntry,
      {
        ...baseEntry,
        status: "green",
        greenAt: "2026-04-15T10:05:00.000Z"
      }
    ]);
    expect(result.ok).toBe(true);
  });

  it("rejects green that precedes red", () => {
    const result = evaluateSidecarSliceCycle([
      baseEntry,
      {
        ...baseEntry,
        status: "green",
        greenAt: "2026-04-15T09:00:00.000Z"
      }
    ]);
    expect(result.ok).toBe(false);
    expect(result.details).toMatch(/precedes redObservedAt/);
  });

  it("rejects refactor-deferred without rationale", () => {
    const result = evaluateSidecarSliceCycle([
      baseEntry,
      {
        ...baseEntry,
        status: "green",
        greenAt: "2026-04-15T10:05:00.000Z"
      },
      {
        ...baseEntry,
        status: "refactor-deferred",
        greenAt: "2026-04-15T10:05:00.000Z",
        refactorRationale: ""
      }
    ]);
    expect(result.ok).toBe(false);
    expect(result.details).toMatch(/refactorRationale/);
  });

  it("accepts refactor-deferred with rationale", () => {
    const result = evaluateSidecarSliceCycle([
      baseEntry,
      {
        ...baseEntry,
        status: "green",
        greenAt: "2026-04-15T10:05:00.000Z"
      },
      {
        ...baseEntry,
        status: "refactor-deferred",
        greenAt: "2026-04-15T10:05:00.000Z",
        refactorRationale: "scope churn would block release"
      }
    ]);
    expect(result.ok).toBe(true);
  });

  it("accepts refactor-done after green", () => {
    const result = evaluateSidecarSliceCycle([
      baseEntry,
      {
        ...baseEntry,
        status: "green",
        greenAt: "2026-04-15T10:05:00.000Z"
      },
      {
        ...baseEntry,
        status: "refactor-done",
        greenAt: "2026-04-15T10:05:00.000Z",
        refactorAt: "2026-04-15T10:10:00.000Z"
      }
    ]);
    expect(result.ok).toBe(true);
  });

  it("rejects refactor-done preceding green", () => {
    const result = evaluateSidecarSliceCycle([
      baseEntry,
      {
        ...baseEntry,
        status: "green",
        greenAt: "2026-04-15T10:05:00.000Z"
      },
      {
        ...baseEntry,
        status: "refactor-done",
        greenAt: "2026-04-15T10:05:00.000Z",
        refactorAt: "2026-04-15T10:00:30.000Z"
      }
    ]);
    expect(result.ok).toBe(false);
    expect(result.details).toMatch(/precedes greenAt/);
  });

  it("folds latest-row-wins per sliceId before validating", () => {
    // Two rows for S-1 (red then green); only the green is folded.
    const result = evaluateSidecarSliceCycle([
      baseEntry,
      {
        ...baseEntry,
        status: "green",
        greenAt: "2026-04-15T10:05:00.000Z"
      }
    ]);
    expect(result.ok).toBe(true);
    expect(result.details).toMatch(/1 sidecar slice row/);
  });
});
