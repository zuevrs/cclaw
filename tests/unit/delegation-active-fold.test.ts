import { describe, expect, it } from "vitest";
import {
  computeActiveSubagents,
  type DelegationEntry
} from "../../src/delegation.js";

function entry(overrides: Partial<DelegationEntry>): DelegationEntry {
  return {
    stage: "scope",
    agent: "planner",
    mode: "mandatory",
    status: "scheduled",
    ...overrides
  };
}

describe("computeActiveSubagents — latest-by-spanId fold", () => {
  it("drops a span that progressed scheduled→launched→completed", () => {
    const span = "span-A";
    const t0 = "2026-01-01T00:00:00.000Z";
    const t1 = "2026-01-01T00:00:01.000Z";
    const t2 = "2026-01-01T00:00:02.000Z";
    const entries: DelegationEntry[] = [
      entry({ spanId: span, status: "scheduled", ts: t0, startTs: t0 }),
      entry({ spanId: span, status: "launched", ts: t1, startTs: t0, launchedTs: t1 }),
      entry({
        spanId: span,
        status: "completed",
        ts: t2,
        startTs: t0,
        launchedTs: t1,
        completedTs: t2
      })
    ];
    expect(computeActiveSubagents(entries)).toEqual([]);
  });

  it("returns the launched row when a span has scheduled→launched only", () => {
    const span = "span-B";
    const t0 = "2026-01-02T00:00:00.000Z";
    const t1 = "2026-01-02T00:00:01.000Z";
    const entries: DelegationEntry[] = [
      entry({ spanId: span, status: "scheduled", ts: t0, startTs: t0 }),
      entry({ spanId: span, status: "launched", ts: t1, startTs: t0, launchedTs: t1 })
    ];
    const active = computeActiveSubagents(entries);
    expect(active).toHaveLength(1);
    expect(active[0]?.spanId).toBe(span);
    expect(active[0]?.status).toBe("launched");
  });

  it("keeps two distinct spanIds that are both currently launched", () => {
    const tEarly = "2026-01-03T00:00:00.000Z";
    const tLate = "2026-01-03T00:00:05.000Z";
    const entries: DelegationEntry[] = [
      entry({
        spanId: "span-1",
        status: "scheduled",
        agent: "critic",
        ts: tEarly,
        startTs: tEarly
      }),
      entry({
        spanId: "span-1",
        status: "launched",
        agent: "critic",
        ts: tEarly,
        startTs: tEarly,
        launchedTs: tEarly
      }),
      entry({
        spanId: "span-2",
        status: "scheduled",
        agent: "researcher",
        ts: tLate,
        startTs: tLate
      }),
      entry({
        spanId: "span-2",
        status: "launched",
        agent: "researcher",
        ts: tLate,
        startTs: tLate,
        launchedTs: tLate
      })
    ];
    const active = computeActiveSubagents(entries);
    expect(active.map((e) => e.spanId)).toEqual(["span-1", "span-2"]);
  });

  it("drops a span that went directly from scheduled to completed", () => {
    const span = "span-C";
    const t0 = "2026-01-04T00:00:00.000Z";
    const t1 = "2026-01-04T00:00:01.000Z";
    const entries: DelegationEntry[] = [
      entry({ spanId: span, status: "scheduled", ts: t0, startTs: t0 }),
      entry({
        spanId: span,
        status: "completed",
        ts: t1,
        startTs: t0,
        completedTs: t1
      })
    ];
    expect(computeActiveSubagents(entries)).toEqual([]);
  });

  it("sorts the active set by ascending startTs", () => {
    const entries: DelegationEntry[] = [
      entry({
        spanId: "span-late",
        status: "launched",
        ts: "2026-01-05T00:00:10.000Z",
        startTs: "2026-01-05T00:00:10.000Z",
        launchedTs: "2026-01-05T00:00:10.000Z",
        agent: "later-agent"
      }),
      entry({
        spanId: "span-early",
        status: "launched",
        ts: "2026-01-05T00:00:01.000Z",
        startTs: "2026-01-05T00:00:01.000Z",
        launchedTs: "2026-01-05T00:00:01.000Z",
        agent: "earlier-agent"
      })
    ];
    const active = computeActiveSubagents(entries);
    expect(active.map((e) => e.spanId)).toEqual(["span-early", "span-late"]);
  });

  it("ignores entries without a spanId", () => {
    const entries: DelegationEntry[] = [
      entry({
        status: "scheduled",
        ts: "2026-01-06T00:00:00.000Z",
        startTs: "2026-01-06T00:00:00.000Z"
      })
    ];
    expect(computeActiveSubagents(entries)).toEqual([]);
  });

  it("treats a stale terminal row as terminal even when it appears alongside a launched row", () => {
    const span = "span-stale";
    const t0 = "2026-01-07T00:00:00.000Z";
    const t1 = "2026-01-07T00:00:05.000Z";
    const entries: DelegationEntry[] = [
      entry({
        spanId: span,
        status: "launched",
        ts: t0,
        startTs: t0,
        launchedTs: t0
      }),
      entry({
        spanId: span,
        status: "stale",
        ts: t1,
        startTs: t0,
        launchedTs: t0,
        endTs: t1
      })
    ];
    expect(computeActiveSubagents(entries)).toEqual([]);
  });
});
