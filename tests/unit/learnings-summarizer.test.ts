import { describe, expect, it } from "vitest";
import { summarizeObservationLearnings } from "../../src/learnings-summarizer.js";

describe("learnings summarizer", () => {
  it("derives high-signal candidates from observations", () => {
    const observations = [
      { event: "tool_start", tool: "RunCommand", stage: "test", data: "start" },
      { event: "tool_complete", tool: "RunCommand", stage: "test", data: "error: step 1 failed" },
      { event: "tool_complete", tool: "RunCommand", stage: "test", data: "error: step 2 failed" },
      { event: "tool_complete", tool: "RunCommand", stage: "test", data: "fail: step 3 failed" },
      { event: "tool_complete", tool: "RunCommand", stage: "test", data: "timeout: step 4 failed" },
      { event: "tool_complete", tool: "RunCommand", stage: "test", data: "ok" },
      { event: "tool_complete", tool: "ReadFile", stage: "test", data: "ok" },
      { event: "tool_complete", tool: "ReadFile", stage: "test", data: "ok" },
      { event: "tool_complete", tool: "ReadFile", stage: "test", data: "ok" },
      { event: "tool_complete", tool: "ReadFile", stage: "test", data: "ok" },
      { event: "tool_complete", tool: "ReadFile", stage: "test", data: "ok" },
      { event: "tool_complete", tool: "ReadFile", stage: "test", data: "ok" },
      { event: "tool_complete", tool: "ReadFile", stage: "test", data: "ok" },
      { event: "tool_complete", tool: "ReadFile", stage: "test", data: "ok" },
      { event: "tool_complete", tool: "ReadFile", stage: "test", data: "ok" },
      { event: "tool_complete", tool: "ReadFile", stage: "test", data: "ok" }
    ].map((entry) => JSON.stringify(entry)).join("\n");

    const outcome = summarizeObservationLearnings(
      observations,
      "",
      "2026-04-11T10:00:00Z"
    );

    const keys = outcome.candidates.map((candidate) => candidate.key);
    expect(keys).toContain("frequent-errors-RunCommand");
    expect(keys).toContain("reliable-tool-ReadFile");
    expect(keys).toContain("stage-hotspot-test");
    expect(outcome.appendable.length).toBeGreaterThan(0);
  });

  it("only appends candidates that improve existing confidence", () => {
    const observations = [
      { event: "tool_complete", tool: "RunCommand", stage: "build", data: "error one" },
      { event: "tool_complete", tool: "RunCommand", stage: "build", data: "error two" },
      { event: "tool_complete", tool: "RunCommand", stage: "build", data: "error three" }
    ].map((entry) => JSON.stringify(entry)).join("\n");

    const existing = JSON.stringify({
      ts: "2026-04-10T10:00:00Z",
      skill: "observation",
      type: "pitfall",
      key: "frequent-errors-RunCommand",
      insight: "Older high-confidence warning",
      confidence: 9,
      source: "observed"
    });

    const outcome = summarizeObservationLearnings(
      observations,
      existing,
      "2026-04-11T10:00:00Z"
    );
    expect(outcome.candidates.some((candidate) => candidate.key === "frequent-errors-RunCommand")).toBe(true);
    expect(outcome.appendable.some((candidate) => candidate.key === "frequent-errors-RunCommand")).toBe(false);
  });

  it("ignores malformed lines without throwing", () => {
    const observations = `{"event":"tool_complete","tool":"RunCommand","stage":"test","data":"error"}\n{not-json}\n`;
    const existing = `{"ts":"2026-04-11T10:00:00Z","skill":"observation","type":"pitfall","key":"x","insight":"too short","confidence":5,"source":"observed"}\n`;
    const outcome = summarizeObservationLearnings(
      observations,
      existing,
      "2026-04-11T10:10:00Z"
    );
    expect(Array.isArray(outcome.candidates)).toBe(true);
    expect(Array.isArray(outcome.appendable)).toBe(true);
  });
});
