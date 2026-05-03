import { describe, expect, it } from "vitest";
import {
  DelegationTimestampError,
  validateMonotonicTimestamps,
  type DelegationEntry
} from "../../src/delegation.js";

function make(overrides: Partial<DelegationEntry>): DelegationEntry {
  return {
    stage: "scope",
    agent: "planner",
    mode: "mandatory",
    status: "scheduled",
    spanId: "span-1",
    ...overrides
  };
}

describe("validateMonotonicTimestamps", () => {
  it("throws when ackTs is earlier than launchedTs", () => {
    const stamped = make({
      status: "acknowledged",
      startTs: "2026-03-01T10:00:00.000Z",
      launchedTs: "2026-03-01T10:00:05.000Z",
      ackTs: "2026-03-01T10:00:02.000Z",
      ts: "2026-03-01T10:00:02.000Z"
    });
    expect(() => validateMonotonicTimestamps(stamped, [])).toThrowError(
      DelegationTimestampError
    );
    try {
      validateMonotonicTimestamps(stamped, []);
    } catch (err) {
      expect(err).toBeInstanceOf(DelegationTimestampError);
      const e = err as DelegationTimestampError;
      expect(e.field).toBe("ackTs");
      expect(e.actual).toBe("2026-03-01T10:00:02.000Z");
      expect(e.priorBound).toBe("2026-03-01T10:00:05.000Z");
    }
  });

  it("accepts completedTs == launchedTs (fast-completing dispatch)", () => {
    const ts = "2026-03-02T10:00:05.000Z";
    const stamped = make({
      status: "completed",
      startTs: ts,
      launchedTs: ts,
      ackTs: ts,
      completedTs: ts,
      ts
    });
    expect(() => validateMonotonicTimestamps(stamped, [])).not.toThrow();
  });

  it("throws when completedTs is earlier than launchedTs", () => {
    const stamped = make({
      status: "completed",
      startTs: "2026-03-03T10:00:00.000Z",
      launchedTs: "2026-03-03T10:00:05.000Z",
      completedTs: "2026-03-03T10:00:01.000Z",
      ts: "2026-03-03T10:00:01.000Z"
    });
    expect(() => validateMonotonicTimestamps(stamped, [])).toThrowError(
      DelegationTimestampError
    );
  });

  it("accepts a row whose lifecycle stamps are all equal", () => {
    const ts = "2026-03-04T10:00:00.000Z";
    const stamped = make({
      status: "completed",
      startTs: ts,
      launchedTs: ts,
      ackTs: ts,
      completedTs: ts,
      ts
    });
    expect(() => validateMonotonicTimestamps(stamped, [])).not.toThrow();
  });

  it("throws when a new row's ts predates the prior row for the same span", () => {
    const span = "span-non-decreasing";
    const t0 = "2026-03-05T10:00:00.000Z";
    const t1 = "2026-03-05T10:00:05.000Z";
    const prior: DelegationEntry[] = [
      make({ spanId: span, status: "scheduled", ts: t1, startTs: t1 })
    ];
    const stamped = make({
      spanId: span,
      status: "launched",
      startTs: t1,
      launchedTs: t0,
      ts: t0
    });
    expect(() => validateMonotonicTimestamps(stamped, prior)).toThrowError(
      DelegationTimestampError
    );
  });

  it("does not throw on a coherent multi-row timeline", () => {
    const span = "span-coherent";
    const t0 = "2026-03-06T10:00:00.000Z";
    const t1 = "2026-03-06T10:00:01.000Z";
    const t2 = "2026-03-06T10:00:02.000Z";
    const prior: DelegationEntry[] = [
      make({ spanId: span, status: "scheduled", ts: t0, startTs: t0 }),
      make({
        spanId: span,
        status: "launched",
        ts: t1,
        startTs: t0,
        launchedTs: t1
      })
    ];
    const stamped = make({
      spanId: span,
      status: "completed",
      startTs: t0,
      launchedTs: t1,
      completedTs: t2,
      ts: t2
    });
    expect(() => validateMonotonicTimestamps(stamped, prior)).not.toThrow();
  });
});
