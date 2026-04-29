import { describe, expect, it } from "vitest";
import {
  computeRalphLoopStatus,
  hasFailingTestForPath,
  parseTddCycleLog,
  validateTddCycleOrder
} from "../../src/tdd-cycle.js";

describe("tdd cycle validation", () => {
  it("accepts red->green->refactor order", () => {
    const entries = parseTddCycleLog([
      JSON.stringify({ ts: "2026-01-01T00:00:00Z", runId: "active", stage: "tdd", slice: "S-1", phase: "red", command: "vitest S-1", exitCode: 1 }),
      JSON.stringify({ ts: "2026-01-01T00:01:00Z", runId: "active", stage: "tdd", slice: "S-1", phase: "green", command: "vitest S-1", exitCode: 0 }),
      JSON.stringify({ ts: "2026-01-01T00:02:00Z", runId: "active", stage: "tdd", slice: "S-1", phase: "refactor", command: "vitest", exitCode: 0 })
    ].join("\n"));
    const validation = validateTddCycleOrder(entries, { runId: "active" });
    expect(validation.ok).toBe(true);
    expect(validation.issues).toEqual([]);
  });

  it("accepts multiple passing refactors after one green", () => {
    const entries = parseTddCycleLog([
      JSON.stringify({ ts: "2026-01-01T00:00:00Z", runId: "active", stage: "tdd", slice: "S-1", phase: "red", command: "vitest S-1", exitCode: 1 }),
      JSON.stringify({ ts: "2026-01-01T00:01:00Z", runId: "active", stage: "tdd", slice: "S-1", phase: "green", command: "vitest S-1", exitCode: 0 }),
      JSON.stringify({ ts: "2026-01-01T00:02:00Z", runId: "active", stage: "tdd", slice: "S-1", phase: "refactor", command: "vitest", exitCode: 0 }),
      JSON.stringify({ ts: "2026-01-01T00:03:00Z", runId: "active", stage: "tdd", slice: "S-1", phase: "refactor", command: "vitest", exitCode: 0 })
    ].join("\n"));
    const validation = validateTddCycleOrder(entries, { runId: "active" });
    expect(validation.ok).toBe(true);
    expect(validation.issues).toEqual([]);
  });

  it("flags green-before-red violations", () => {
    const entries = parseTddCycleLog(
      JSON.stringify({ ts: "2026-01-01T00:00:00Z", runId: "active", stage: "tdd", slice: "S-1", phase: "green", command: "vitest S-1", exitCode: 0 })
    );
    const validation = validateTddCycleOrder(entries, { runId: "active" });
    expect(validation.ok).toBe(false);
    expect(validation.issues.join(" ")).toMatch(/green logged before red/i);
  });

  it("flags missing red and green exit codes", () => {
    const entries = parseTddCycleLog([
      JSON.stringify({ ts: "2026-01-01T00:00:00Z", runId: "active", stage: "tdd", slice: "S-1", phase: "red", command: "vitest S-1" }),
      JSON.stringify({ ts: "2026-01-01T00:01:00Z", runId: "active", stage: "tdd", slice: "S-1", phase: "green", command: "vitest S-1" })
    ].join("\n"));
    const validation = validateTddCycleOrder(entries, { runId: "active" });
    expect(validation.ok).toBe(false);
    expect(validation.issues.join(" ")).toMatch(/red entry must record a non-zero exitCode/i);
    expect(validation.issues.join(" ")).toMatch(/green entry must record exitCode 0/i);
  });

  it("flags entries with malformed slice ids", () => {
    const entries = parseTddCycleLog([
      JSON.stringify({ ts: "2026-01-01T00:00:00Z", runId: "active", stage: "tdd", phase: "red", command: "vitest", exitCode: 1 }),
      JSON.stringify({ ts: "2026-01-01T00:01:00Z", runId: "active", stage: "tdd", phase: "green", command: "vitest", exitCode: 0 })
    ].join("\n"));
    const validation = validateTddCycleOrder(entries, { runId: "active" });
    expect(validation.ok).toBe(false);
    expect(validation.issues.join(" ")).toMatch(/S-unknown/);
    expect(validation.issues.join(" ")).toMatch(/id must match/);
  });

  it("flags refactor entries that break the green state", () => {
    const entries = parseTddCycleLog([
      JSON.stringify({ ts: "2026-01-01T00:00:00Z", runId: "active", stage: "tdd", slice: "S-1", phase: "red", command: "vitest S-1", exitCode: 1 }),
      JSON.stringify({ ts: "2026-01-01T00:01:00Z", runId: "active", stage: "tdd", slice: "S-1", phase: "green", command: "vitest S-1", exitCode: 0 }),
      JSON.stringify({ ts: "2026-01-01T00:02:00Z", runId: "active", stage: "tdd", slice: "S-1", phase: "refactor", command: "vitest", exitCode: 2 })
    ].join("\n"));
    const validation = validateTddCycleOrder(entries, { runId: "active" });
    expect(validation.ok).toBe(false);
    expect(validation.issues.join(" ")).toMatch(/REFACTOR repair needed/i);
  });

  it("flags refactor entries missing exitCode", () => {
    const entries = parseTddCycleLog([
      JSON.stringify({ ts: "2026-01-01T00:00:00Z", runId: "active", stage: "tdd", slice: "S-1", phase: "red", command: "vitest S-1", exitCode: 1 }),
      JSON.stringify({ ts: "2026-01-01T00:01:00Z", runId: "active", stage: "tdd", slice: "S-1", phase: "green", command: "vitest S-1", exitCode: 0 }),
      JSON.stringify({ ts: "2026-01-01T00:02:00Z", runId: "active", stage: "tdd", slice: "S-1", phase: "refactor", command: "vitest" })
    ].join("\n"));
    const validation = validateTddCycleOrder(entries, { runId: "active" });
    expect(validation.ok).toBe(false);
    expect(validation.issues.join(" ")).toMatch(/refactor entry must record exitCode 0/i);
  });

  it("flags refactor logged before green and does not poison subsequent slice state", () => {
    const entries = parseTddCycleLog([
      JSON.stringify({ ts: "2026-01-01T00:00:00Z", runId: "active", stage: "tdd", slice: "S-1", phase: "red", command: "vitest S-1", exitCode: 1 }),
      JSON.stringify({ ts: "2026-01-01T00:01:00Z", runId: "active", stage: "tdd", slice: "S-1", phase: "refactor", command: "vitest", exitCode: 0 }),
      JSON.stringify({ ts: "2026-01-01T00:02:00Z", runId: "active", stage: "tdd", slice: "S-1", phase: "red", command: "vitest S-1", exitCode: 1 })
    ].join("\n"));
    const validation = validateTddCycleOrder(entries, { runId: "active" });
    expect(validation.ok).toBe(false);
    expect(validation.issues.join(" ")).toMatch(/refactor logged before green/i);
    expect(validation.openRedSlices).toContain("S-1");
  });

  it("flags incorrect red/green exit code polarity", () => {
    const entries = parseTddCycleLog([
      JSON.stringify({ ts: "2026-01-01T00:00:00Z", runId: "active", stage: "tdd", slice: "S-1", phase: "red", command: "vitest S-1", exitCode: 0 }),
      JSON.stringify({ ts: "2026-01-01T00:01:00Z", runId: "active", stage: "tdd", slice: "S-1", phase: "green", command: "vitest S-1", exitCode: 1 })
    ].join("\n"));
    const validation = validateTddCycleOrder(entries, { runId: "active" });
    expect(validation.ok).toBe(false);
    expect(validation.issues.join(" ")).toMatch(/red entry exitCode must be non-zero/i);
    expect(validation.issues.join(" ")).toMatch(/green entry exitCode must be 0/i);
  });

  it("finds failing RED evidence for a production path", () => {
    const entries = parseTddCycleLog([
      JSON.stringify({
        ts: "2026-01-01T00:00:00Z",
        runId: "active",
        stage: "tdd",
        slice: "S-1",
        phase: "red",
        command: "vitest users",
        files: ["src/users/service.ts"],
        exitCode: 1
      }),
      JSON.stringify({
        ts: "2026-01-01T00:01:00Z",
        runId: "active",
        stage: "tdd",
        slice: "S-1",
        phase: "green",
        command: "vitest users",
        files: ["src/users/service.ts"],
        exitCode: 0
      })
    ].join("\n"));

    expect(hasFailingTestForPath(entries, "src/users/service.ts", { runId: "active" })).toBe(true);
    expect(hasFailingTestForPath(entries, "src/payments/service.ts", { runId: "active" })).toBe(false);
  });
});

describe("computeRalphLoopStatus", () => {
  const fixedNow = new Date("2026-02-02T12:00:00.000Z");

  it("returns zero-iteration status for an empty log", () => {
    const status = computeRalphLoopStatus([], { runId: "active", now: fixedNow });
    expect(status.loopIteration).toBe(0);
    expect(status.sliceCount).toBe(0);
    expect(status.redOpen).toBe(false);
    expect(status.acClosed).toEqual([]);
    expect(status.lastUpdatedAt).toBe(fixedNow.toISOString());
  });

  it("counts RED -> GREEN cycles and dedupes closed acceptance criteria", () => {
    const entries = parseTddCycleLog(
      [
        { ts: "t1", runId: "active", stage: "tdd", slice: "S-1", phase: "red", command: "v", exitCode: 1 },
        { ts: "t2", runId: "active", stage: "tdd", slice: "S-1", phase: "green", command: "v", exitCode: 0, acIds: ["AC-1", "AC-2"] },
        { ts: "t3", runId: "active", stage: "tdd", slice: "S-1", phase: "refactor", command: "v", exitCode: 0 },
        { ts: "t4", runId: "active", stage: "tdd", slice: "S-2", phase: "red", command: "v", exitCode: 1 },
        { ts: "t5", runId: "active", stage: "tdd", slice: "S-2", phase: "green", command: "v", exitCode: 0, acIds: ["AC-2", "AC-3"] }
      ].map((row) => JSON.stringify(row)).join("\n")
    );
    const status = computeRalphLoopStatus(entries, { runId: "active", now: fixedNow });
    expect(status.loopIteration).toBe(2);
    expect(status.sliceCount).toBe(2);
    expect(status.redOpen).toBe(false);
    expect(status.redOpenSlices).toEqual([]);
    expect(status.acClosed).toEqual(["AC-1", "AC-2", "AC-3"]);
    const s1 = status.slices.find((row) => row.slice === "S-1");
    const s2 = status.slices.find((row) => row.slice === "S-2");
    expect(s1?.greenCount).toBe(1);
    expect(s1?.refactorCount).toBe(1);
    expect(s1?.acIds).toEqual(["AC-1", "AC-2"]);
    expect(s2?.acIds).toEqual(["AC-2", "AC-3"]);
  });

  it("reports redOpen slices when RED has no matching GREEN yet", () => {
    const entries = parseTddCycleLog(
      [
        { ts: "t1", runId: "active", stage: "tdd", slice: "S-1", phase: "red", command: "v", exitCode: 1 },
        { ts: "t2", runId: "active", stage: "tdd", slice: "S-1", phase: "green", command: "v", exitCode: 0 },
        { ts: "t3", runId: "active", stage: "tdd", slice: "S-2", phase: "red", command: "v", exitCode: 1 }
      ].map((row) => JSON.stringify(row)).join("\n")
    );
    const status = computeRalphLoopStatus(entries, { runId: "active", now: fixedNow });
    expect(status.redOpen).toBe(true);
    expect(status.redOpenSlices).toEqual(["S-2"]);
    expect(status.loopIteration).toBe(1);
  });

  it("filters entries by runId so cross-run rows do not leak into status", () => {
    const entries = parseTddCycleLog(
      [
        { ts: "t1", runId: "run-a", stage: "tdd", slice: "S-1", phase: "red", command: "v", exitCode: 1 },
        { ts: "t2", runId: "run-b", stage: "tdd", slice: "S-1", phase: "green", command: "v", exitCode: 0, acIds: ["AC-other"] }
      ].map((row) => JSON.stringify(row)).join("\n")
    );
    const status = computeRalphLoopStatus(entries, { runId: "run-a", now: fixedNow });
    expect(status.loopIteration).toBe(0);
    expect(status.redOpenSlices).toEqual(["S-1"]);
    expect(status.acClosed).toEqual([]);
  });
});
