import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  clampEarlyLoopStatusForWrite,
  computeEarlyLoopStatus,
  deriveEarlyLoopStatus,
  normalizeEarlyLoopMaxIterations,
  parseEarlyLoopLog,
  type EarlyLoopLogEntry,
  type EarlyLoopStatus
} from "../../src/early-loop.js";
import { createTempProject } from "../helpers/index.js";

describe("early-loop core", () => {
  it("parses JSONL and derives open/resolved concerns", () => {
    const raw = [
      JSON.stringify({
        ts: "2026-04-29T10:00:00Z",
        runId: "run-a",
        stage: "scope",
        iteration: 1,
        concerns: [
          { id: "C-1", severity: "critical", locator: "Scope Contract > In Scope", summary: "Missing rollback boundary" },
          { id: "C-2", severity: "important", locator: "Scope Contract > Out of Scope", summary: "Boundary too broad" }
        ]
      }),
      JSON.stringify({
        ts: "2026-04-29T10:05:00Z",
        runId: "run-a",
        stage: "scope",
        iteration: 2,
        concerns: [
          { id: "C-1", severity: "critical", locator: "Scope Contract > In Scope", summary: "Missing rollback boundary" }
        ],
        resolvedConcernIds: ["C-2"]
      })
    ].join("\n");
    const entries = parseEarlyLoopLog(raw);
    const status = deriveEarlyLoopStatus(entries, {
      stage: "scope",
      runId: "run-a",
      now: new Date("2026-04-29T10:10:00Z")
    });
    expect(status.iteration).toBe(2);
    expect(status.openConcerns.map((concern) => concern.id)).toEqual(["C-1"]);
    expect(status.resolvedConcerns.map((concern) => concern.id)).toEqual(["C-2"]);
    expect(status.resolvedConcerns[0]?.resolvedAtIteration).toBe(2);
    expect(status.convergenceTripped).toBe(false);
  });

  it("trips convergence guard when same open concerns repeat", () => {
    const entries: EarlyLoopLogEntry[] = [
      {
        ts: "t1",
        runId: "run-a",
        stage: "design",
        concerns: [{ id: "C-1", severity: "important", locator: "Architecture Diagram", summary: "No failure edge" }],
        resolvedConcernIds: []
      },
      {
        ts: "t2",
        runId: "run-a",
        stage: "design",
        concerns: [{ id: "C-1", severity: "important", locator: "Architecture Diagram", summary: "No failure edge" }],
        resolvedConcernIds: []
      }
    ];
    const status = deriveEarlyLoopStatus(entries, {
      stage: "design",
      runId: "run-a"
    });
    expect(status.convergenceTripped).toBe(true);
    expect(status.escalationReason).toContain("same concerns 2 iterations in a row");
  });

  it("trips convergence guard when iteration cap is reached with open concerns", () => {
    const entries: EarlyLoopLogEntry[] = [
      {
        ts: "t1",
        runId: "run-a",
        stage: "brainstorm",
        concerns: [{ id: "C-1", severity: "important", locator: "Approaches", summary: "Missing challenger" }],
        resolvedConcernIds: []
      },
      {
        ts: "t2",
        runId: "run-a",
        stage: "brainstorm",
        concerns: [{ id: "C-2", severity: "important", locator: "Approaches", summary: "Weak trade-offs" }],
        resolvedConcernIds: []
      }
    ];
    const status = deriveEarlyLoopStatus(entries, {
      stage: "brainstorm",
      runId: "run-a",
      maxIterations: 2
    });
    expect(status.iteration).toBe(2);
    expect(status.convergenceTripped).toBe(true);
    expect(status.escalationReason).toContain("max iterations 2 reached");
  });

  it("clamps derived iteration when structured entries exceed maxIterations", () => {
    const entries: EarlyLoopLogEntry[] = [];
    for (let i = 0; i < 4; i += 1) {
      entries.push({
        ts: `t${i}`,
        runId: "run-clamp",
        stage: "scope",
        concerns: [{ id: `C-${i}`, severity: "suggestion", locator: "Contract", summary: `row ${i}` }],
        resolvedConcernIds: []
      });
    }
    const status = deriveEarlyLoopStatus(entries, {
      stage: "scope",
      runId: "run-clamp",
      maxIterations: 3
    });
    expect(status.iteration).toBe(3);
  });

  it("repair-clamps status objects whose iteration exceeds maxIterations", () => {
    const broken: EarlyLoopStatus = {
      schemaVersion: 1,
      stage: "brainstorm",
      runId: "run",
      iteration: 9,
      maxIterations: 3,
      openConcerns: [],
      resolvedConcerns: [],
      lastSeenConcernIds: [],
      convergenceTripped: false,
      lastUpdatedAt: "2026-05-02T15:00:00.000Z"
    };
    const repaired = clampEarlyLoopStatusForWrite(broken);
    expect(repaired.clampedFrom).toBe(9);
    expect(repaired.status.iteration).toBe(3);
  });

  it("reads file-backed log via computeEarlyLoopStatus and filters by stage/run", async () => {
    const root = await createTempProject("early-loop-compute");
    const stateDir = path.join(root, ".cclaw/state");
    await fs.mkdir(stateDir, { recursive: true });
    await fs.writeFile(
      path.join(stateDir, "early-loop-log.jsonl"),
      [
        JSON.stringify({
          ts: "2026-04-29T10:00:00Z",
          runId: "run-a",
          stage: "scope",
          concerns: [{ id: "C-1", severity: "important", locator: "Scope Contract", summary: "Gap A" }]
        }),
        JSON.stringify({
          ts: "2026-04-29T10:01:00Z",
          runId: "run-b",
          stage: "scope",
          concerns: [{ id: "C-9", severity: "critical", locator: "Scope Contract", summary: "Other run" }]
        }),
        JSON.stringify({
          ts: "2026-04-29T10:02:00Z",
          runId: "run-a",
          stage: "design",
          concerns: [{ id: "C-3", severity: "important", locator: "Design", summary: "Other stage" }]
        })
      ].join("\n"),
      "utf8"
    );
    const status = await computeEarlyLoopStatus(
      "scope",
      "run-a",
      path.join(stateDir, "early-loop-log.jsonl"),
      { maxIterations: 3 }
    );
    expect(status.iteration).toBe(1);
    expect(status.openConcerns.map((concern) => concern.id)).toEqual(["C-1"]);
  });

  it("normalizes invalid max iteration values", () => {
    expect(normalizeEarlyLoopMaxIterations(undefined)).toBe(3);
    expect(normalizeEarlyLoopMaxIterations(0)).toBe(3);
    expect(normalizeEarlyLoopMaxIterations(5)).toBe(5);
  });
});
