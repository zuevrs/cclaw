import path from "node:path";
import fs from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { readDelegationEvents, recordCclawFanInAudit } from "../../src/delegation.js";
import { verifyTddWorktreeFanInClosure } from "../../src/gate-evidence.js";
import type { FlowState } from "../../src/flow-state.js";
import { createTempProject } from "../helpers/index.js";

function completedSliceEvent(params: {
  runId: string;
  sliceId: string;
  phase: "green" | "refactor";
  ownerLaneId?: string;
  spanSuffix: string;
}): Record<string, unknown> {
  const ts =
    params.phase === "green" ? "2026-05-01T10:05:00Z" : "2026-05-01T10:15:00Z";
  return {
    stage: "tdd",
    agent: "slice-implementer",
    mode: "mandatory",
    status: "completed",
    event: "completed",
    eventTs: ts,
    schemaVersion: 3,
    ts,
    startTs: "2026-05-01T10:00:00Z",
    spanId: `span-${params.spanSuffix}`,
    runId: params.runId,
    sliceId: params.sliceId,
    phase: params.phase,
    ownerLaneId: params.ownerLaneId,
    completedTs: ts,
    fulfillmentMode: "role-switch",
    evidenceRefs: ["proof"],
    dispatchSurface: "manual",
    dispatchId: `d-${params.spanSuffix}`,
    agentDefinitionPath: ".cclaw/agents/slice-implementer.md",
    ackTs: "2026-05-01T10:04:00Z"
  };
}

describe("recordCclawFanInAudit + verifyTddWorktreeFanInClosure", () => {
  it("round-trips fan-in audits and verifies closure for lane-backed slices", async () => {
    const root = await createTempProject("fanin-audit");
    const runId = "run-fanin-1";
    const stateDir = path.join(root, ".cclaw/state");
    await fs.mkdir(stateDir, { recursive: true });
    const lines = [
      completedSliceEvent({
        runId,
        sliceId: "S-1",
        phase: "green",
        ownerLaneId: "lane-test-1",
        spanSuffix: "g1"
      }),
      completedSliceEvent({ runId, sliceId: "S-1", phase: "refactor", spanSuffix: "r1" })
    ];
    await fs.writeFile(
      path.join(stateDir, "delegation-events.jsonl"),
      lines.map((o) => JSON.stringify(o)).join("\n") + "\n",
      "utf8"
    );

    const { events, fanInAudits: before } = await readDelegationEvents(root);
    expect(before.length).toBe(0);
    expect(events.length).toBe(2);

    await recordCclawFanInAudit(root, {
      kind: "cclaw_fanin_applied",
      runId,
      laneId: "lane-test-1",
      sliceIds: ["S-1"],
      integrationBranch: "main",
      details: "test apply"
    });

    const { fanInAudits, corruptLines } = await readDelegationEvents(root);
    expect(corruptLines).toEqual([]);
    expect(fanInAudits).toHaveLength(1);
    expect(fanInAudits[0]!.event).toBe("cclaw_fanin_applied");

    const flowState = {
      activeRunId: runId,
      worktreeExecutionMode: "worktree-first"
    } as FlowState;
    const issues = await verifyTddWorktreeFanInClosure(root, flowState);
    expect(issues).toEqual([]);
  });
});
