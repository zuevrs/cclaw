import { describe, expect, it } from "vitest";
import {
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
    expect(validation.issues.join(" ")).toMatch(/refactor entry exitCode must be 0/i);
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
