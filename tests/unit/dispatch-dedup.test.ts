import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  appendDelegation,
  DispatchDuplicateError,
  findActiveSpanForPair,
  readDelegationLedger,
  type DelegationLedger
} from "../../src/delegation.js";
import { createInitialFlowState } from "../../src/flow-state.js";
import { createTempProject } from "../helpers/index.js";

async function seedFlowState(root: string, runId: string): Promise<void> {
  await fs.mkdir(path.join(root, ".cclaw/state"), { recursive: true });
  const state = createInitialFlowState(runId);
  await fs.writeFile(
    path.join(root, ".cclaw/state/flow-state.json"),
    `${JSON.stringify(state, null, 2)}\n`,
    "utf8"
  );
}

describe("dispatch dedup on (stage, agent)", () => {
  it("findActiveSpanForPair finds the latest active span", () => {
    const ledger: DelegationLedger = {
      runId: "run-1",
      entries: [
        {
          stage: "design",
          agent: "critic",
          mode: "mandatory",
          status: "scheduled",
          spanId: "span-A",
          runId: "run-1",
          ts: "2026-04-01T10:00:00.000Z",
          startTs: "2026-04-01T10:00:00.000Z"
        },
        {
          stage: "design",
          agent: "critic",
          mode: "mandatory",
          status: "launched",
          spanId: "span-A",
          runId: "run-1",
          ts: "2026-04-01T10:00:01.000Z",
          startTs: "2026-04-01T10:00:00.000Z",
          launchedTs: "2026-04-01T10:00:01.000Z"
        }
      ]
    };
    const result = findActiveSpanForPair("design", "critic", "run-1", ledger);
    expect(result?.spanId).toBe("span-A");
    expect(result?.status).toBe("launched");
  });

  it("findActiveSpanForPair returns null when only terminal rows exist", () => {
    const ledger: DelegationLedger = {
      runId: "run-1",
      entries: [
        {
          stage: "design",
          agent: "critic",
          mode: "mandatory",
          status: "scheduled",
          spanId: "span-A",
          runId: "run-1",
          ts: "2026-04-02T10:00:00.000Z",
          startTs: "2026-04-02T10:00:00.000Z"
        },
        {
          stage: "design",
          agent: "critic",
          mode: "mandatory",
          status: "completed",
          spanId: "span-A",
          runId: "run-1",
          ts: "2026-04-02T10:00:05.000Z",
          startTs: "2026-04-02T10:00:00.000Z",
          completedTs: "2026-04-02T10:00:05.000Z"
        }
      ]
    };
    expect(findActiveSpanForPair("design", "critic", "run-1", ledger)).toBeNull();
  });

  it("appendDelegation throws DispatchDuplicateError on second scheduled write to same pair", async () => {
    const root = await createTempProject("dispatch-dedup-throws");
    await seedFlowState(root, "run-1");
    await appendDelegation(root, {
      stage: "design",
      agent: "critic",
      mode: "mandatory",
      status: "scheduled",
      spanId: "span-1",
      ts: "2026-04-03T10:00:00.000Z"
    });
    await expect(
      appendDelegation(root, {
        stage: "design",
        agent: "critic",
        mode: "mandatory",
        status: "scheduled",
        spanId: "span-2",
        ts: "2026-04-03T10:00:01.000Z"
      })
    ).rejects.toBeInstanceOf(DispatchDuplicateError);
  });

  it("appendDelegation accepts a parallel write when allowParallel is set", async () => {
    const root = await createTempProject("dispatch-dedup-allow-parallel");
    await seedFlowState(root, "run-1");
    await appendDelegation(root, {
      stage: "design",
      agent: "researcher",
      mode: "proactive",
      status: "scheduled",
      spanId: "span-r1",
      ts: "2026-04-04T10:00:00.000Z"
    });
    await appendDelegation(root, {
      stage: "design",
      agent: "researcher",
      mode: "proactive",
      status: "scheduled",
      spanId: "span-r2",
      ts: "2026-04-04T10:00:01.000Z",
      allowParallel: true
    });
    const ledger = await readDelegationLedger(root);
    const scheduled = ledger.entries.filter((e) => e.status === "scheduled");
    expect(scheduled).toHaveLength(2);
    const r2 = ledger.entries.find((e) => e.spanId === "span-r2");
    expect(r2?.allowParallel).toBe(true);
  });

  it("appendDelegation allows duplicate scheduled writes in different stages", async () => {
    const root = await createTempProject("dispatch-dedup-different-stages");
    await seedFlowState(root, "run-1");
    await appendDelegation(root, {
      stage: "scope",
      agent: "planner",
      mode: "mandatory",
      status: "scheduled",
      spanId: "span-scope",
      ts: "2026-04-05T10:00:00.000Z"
    });
    await appendDelegation(root, {
      stage: "design",
      agent: "planner",
      mode: "mandatory",
      status: "scheduled",
      spanId: "span-design",
      ts: "2026-04-05T10:00:01.000Z"
    });
    const ledger = await readDelegationLedger(root);
    expect(ledger.entries.map((e) => e.spanId).sort()).toEqual(
      ["span-design", "span-scope"]
    );
  });

  it("findActiveSpanForPair ignores entries from a different runId (strict run-scope)", () => {
    const ledger: DelegationLedger = {
      runId: "run-2",
      entries: [
        {
          stage: "tdd",
          agent: "slice-builder",
          mode: "mandatory",
          status: "scheduled",
          spanId: "span-S5-run1",
          runId: "run-1",
          ts: "2026-04-10T10:00:00.000Z",
          startTs: "2026-04-10T10:00:00.000Z"
        },
        {
          stage: "tdd",
          agent: "slice-builder",
          mode: "mandatory",
          status: "completed",
          spanId: "span-S5-run1",
          runId: "run-1",
          ts: "2026-04-10T10:05:00.000Z",
          startTs: "2026-04-10T10:00:00.000Z",
          completedTs: "2026-04-10T10:05:00.000Z"
        }
      ]
    };
    expect(findActiveSpanForPair("tdd", "slice-builder", "run-2", ledger)).toBeNull();
  });

  it("findActiveSpanForPair ignores legacy entries with empty/missing runId (strict run-scope)", () => {
    const ledger: DelegationLedger = {
      runId: "run-2",
      entries: [
        {
          stage: "tdd",
          agent: "slice-builder",
          mode: "mandatory",
          status: "scheduled",
          spanId: "span-legacy",
          runId: "",
          ts: "2026-04-10T09:00:00.000Z",
          startTs: "2026-04-10T09:00:00.000Z"
        }
      ]
    };
    expect(findActiveSpanForPair("tdd", "slice-builder", "run-2", ledger)).toBeNull();
  });

  it("entries from a previous run do not block a fresh run-2 dispatch", async () => {
    const root = await createTempProject("dispatch-dedup-cross-run");
    await seedFlowState(root, "run-1");

    // run-1: full lifecycle for slice-builder S-5
    await appendDelegation(root, {
      stage: "tdd",
      agent: "slice-builder",
      mode: "mandatory",
      status: "scheduled",
      spanId: "span-S5-run1",
      ts: "2026-04-11T10:00:00.000Z"
    });
    await appendDelegation(root, {
      stage: "tdd",
      agent: "slice-builder",
      mode: "mandatory",
      status: "completed",
      spanId: "span-S5-run1",
      ts: "2026-04-11T10:05:00.000Z",
      completedTs: "2026-04-11T10:05:00.000Z"
    });

    // Roll the active run forward to run-2 (simulates a re-entry into TDD).
    const flowStatePath = path.join(root, ".cclaw/state/flow-state.json");
    const stateJson = JSON.parse(await fs.readFile(flowStatePath, "utf8")) as {
      activeRunId: string;
    };
    stateJson.activeRunId = "run-2";
    await fs.writeFile(flowStatePath, `${JSON.stringify(stateJson, null, 2)}\n`, "utf8");

    // run-2: a fresh slice-builder dispatch must NOT trip dispatch_duplicate
    // even though run-1's spans live in the same ledger file.
    await expect(
      appendDelegation(root, {
        stage: "tdd",
        agent: "slice-builder",
        mode: "mandatory",
        status: "scheduled",
        spanId: "span-S5-run2",
        ts: "2026-04-11T11:00:00.000Z"
      })
    ).resolves.toBeUndefined();
  });

  it("subagents.json reaches empty active after scheduled→launched→completed lifecycle", async () => {
    const root = await createTempProject("dispatch-dedup-tracker-empty");
    await seedFlowState(root, "run-1");
    await appendDelegation(root, {
      stage: "tdd",
      agent: "slice-builder",
      mode: "mandatory",
      status: "scheduled",
      spanId: "span-cycle",
      ts: "2026-04-12T10:00:00.000Z"
    });
    await appendDelegation(root, {
      stage: "tdd",
      agent: "slice-builder",
      mode: "mandatory",
      status: "launched",
      spanId: "span-cycle",
      ts: "2026-04-12T10:00:01.000Z",
      launchedTs: "2026-04-12T10:00:01.000Z"
    });
    await appendDelegation(root, {
      stage: "tdd",
      agent: "slice-builder",
      mode: "mandatory",
      status: "completed",
      spanId: "span-cycle",
      ts: "2026-04-12T10:00:05.000Z",
      completedTs: "2026-04-12T10:00:05.000Z"
    });

    const tracker = JSON.parse(
      await fs.readFile(path.join(root, ".cclaw/state/subagents.json"), "utf8")
    ) as { active: Array<{ spanId: string }>; updatedAt: string };
    expect(tracker.active).toEqual([]);
    expect(typeof tracker.updatedAt).toBe("string");
  });

  it("appendDelegation supersede flow: stale row plus new scheduled, only new in active", async () => {
    const root = await createTempProject("dispatch-dedup-supersede");
    await seedFlowState(root, "run-1");
    await appendDelegation(root, {
      stage: "design",
      agent: "critic",
      mode: "mandatory",
      status: "scheduled",
      spanId: "span-old",
      ts: "2026-04-06T10:00:00.000Z"
    });
    // simulate the supersede flow that the inline hook performs:
    // synthetic stale row for previous span first, then the new scheduled.
    await appendDelegation(root, {
      stage: "design",
      agent: "critic",
      mode: "mandatory",
      status: "stale",
      spanId: "span-old",
      ts: "2026-04-06T10:00:00.500Z",
      supersededBy: "span-new"
    });
    await appendDelegation(root, {
      stage: "design",
      agent: "critic",
      mode: "mandatory",
      status: "scheduled",
      spanId: "span-new",
      ts: "2026-04-06T10:00:01.000Z"
    });

    const tracker = JSON.parse(
      await fs.readFile(path.join(root, ".cclaw/state/subagents.json"), "utf8")
    ) as { active: Array<{ spanId: string }> };
    expect(tracker.active.map((a) => a.spanId)).toEqual(["span-new"]);

    const ledger = await readDelegationLedger(root);
    const stale = ledger.entries.find((e) => e.status === "stale");
    expect(stale?.spanId).toBe("span-old");
    expect(stale?.supersededBy).toBe("span-new");
  });
});
