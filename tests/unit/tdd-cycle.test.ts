import { describe, expect, it } from "vitest";
import { parseTddCycleLog, validateTddCycleOrder } from "../../src/tdd-cycle.js";

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
});
