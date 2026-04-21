import { describe, expect, it } from "vitest";
import {
  createStderrProgressLogger,
  noopProgressLogger,
  type ProgressEvent
} from "../../src/eval/progress.js";

describe("eval progress logger", () => {
  it("noop logger accepts all event kinds without throwing", () => {
    const logger = noopProgressLogger();
    const events: ProgressEvent[] = [
      { kind: "run-start", mode: "fixture", totalCases: 3 },
      { kind: "case-start", caseId: "c1", stage: "plan", index: 1, total: 3 },
      { kind: "case-end", caseId: "c1", stage: "plan", index: 1, total: 3, passed: true, durationMs: 123 },
      { kind: "stage-start", caseId: "wf-1", stage: "brainstorm", index: 1, total: 2 },
      { kind: "stage-end", caseId: "wf-1", stage: "brainstorm", index: 1, total: 2, passed: false, durationMs: 1_502, costUsd: 0.12 },
      { kind: "retry", caseId: "wf-1", stage: "scope", attempt: 2, maxAttempts: 3, waitMs: 2_000, reason: "timeout" },
      { kind: "run-end", totalCases: 3, passed: 2, failed: 1, durationMs: 61_000 }
    ];

    for (const event of events) {
      expect(() => logger.emit(event)).not.toThrow();
    }
  });

  it("formats all progress events with consistent stderr prefixes", () => {
    const lines: string[] = [];
    const logger = createStderrProgressLogger({
      writer(message) {
        lines.push(message);
      }
    });

    logger.emit({ kind: "run-start", mode: "workflow", totalCases: 2 });
    logger.emit({ kind: "case-start", caseId: "wf-1", stage: "workflow", index: 1, total: 2 });
    logger.emit({
      kind: "case-end",
      caseId: "wf-1",
      stage: "workflow",
      index: 1,
      total: 2,
      passed: true,
      durationMs: 900,
      costUsd: 0.0042
    });
    logger.emit({ kind: "stage-start", caseId: "wf-1", stage: "brainstorm", index: 1, total: 2 });
    logger.emit({
      kind: "stage-end",
      caseId: "wf-1",
      stage: "brainstorm",
      index: 1,
      total: 2,
      passed: false,
      durationMs: 1_500
    });
    logger.emit({
      kind: "retry",
      caseId: "wf-1",
      stage: "scope",
      attempt: 2,
      maxAttempts: 4,
      waitMs: 1_200,
      reason: "429"
    });
    logger.emit({ kind: "run-end", totalCases: 2, passed: 1, failed: 1, durationMs: 61_000 });

    expect(lines[0]).toBe("[cclaw eval] start mode=workflow cases=2\n");
    expect(lines[1]).toContain("[cclaw eval] [1/2] wf-1 (workflow) ...");
    expect(lines[2]).toContain("PASS in 900ms $0.0042");
    expect(lines[3]).toContain("stage brainstorm ...");
    expect(lines[4]).toContain("stage brainstorm fail in 1.5s");
    expect(lines[5]).toContain("retry wf-1/scope attempt 2/4 in 1.2s (429)");
    expect(lines[6]).toContain("done pass=1 fail=1 total=2 in 1m01s");
  });
});
