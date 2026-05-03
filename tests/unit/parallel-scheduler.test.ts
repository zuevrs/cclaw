import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  appendDelegation,
  DispatchCapError,
  DispatchOverlapError,
  MAX_PARALLEL_SLICE_IMPLEMENTERS,
  readDelegationLedger,
  validateFanOutCap,
  validateFileOverlap
} from "../../src/delegation.js";
import { createInitialFlowState } from "../../src/flow-state.js";
import { createTempProject } from "../helpers/index.js";

async function seedFlowState(root: string, runId: string): Promise<void> {
  await fs.mkdir(path.join(root, ".cclaw/state"), { recursive: true });
  const state = createInitialFlowState(runId);
  state.currentStage = "tdd";
  await fs.writeFile(
    path.join(root, ".cclaw/state/flow-state.json"),
    `${JSON.stringify(state, null, 2)}\n`,
    "utf8"
  );
}

describe("validateFileOverlap (P1)", () => {
  it("returns autoParallel:false for non-slice-implementer agents", () => {
    const result = validateFileOverlap(
      {
        stage: "tdd",
        agent: "test-author",
        mode: "mandatory",
        status: "scheduled",
        ts: "2026-04-15T10:00:00Z",
        spanId: "span-1",
        runId: "run-a",
        claimedPaths: ["src/foo.ts"]
      },
      []
    );
    expect(result.autoParallel).toBe(false);
  });

  it("returns autoParallel:true when no other slice-implementer is active", () => {
    const result = validateFileOverlap(
      {
        stage: "tdd",
        agent: "slice-implementer",
        mode: "proactive",
        status: "scheduled",
        ts: "2026-04-15T10:00:00Z",
        spanId: "span-1",
        runId: "run-a",
        claimedPaths: ["src/foo.ts"]
      },
      []
    );
    expect(result.autoParallel).toBe(true);
  });

  it("returns autoParallel:true when active slice-implementer claims disjoint paths", () => {
    const active = {
      stage: "tdd" as const,
      agent: "slice-implementer" as const,
      mode: "proactive" as const,
      status: "scheduled" as const,
      ts: "2026-04-15T09:00:00Z",
      spanId: "span-existing",
      runId: "run-a",
      claimedPaths: ["src/bar.ts"]
    };
    const result = validateFileOverlap(
      {
        stage: "tdd",
        agent: "slice-implementer",
        mode: "proactive",
        status: "scheduled",
        ts: "2026-04-15T10:00:00Z",
        spanId: "span-1",
        runId: "run-a",
        claimedPaths: ["src/foo.ts"]
      },
      [active]
    );
    expect(result.autoParallel).toBe(true);
  });

  it("throws DispatchOverlapError when claimed paths overlap an active span", () => {
    const active = {
      stage: "tdd" as const,
      agent: "slice-implementer" as const,
      mode: "proactive" as const,
      status: "scheduled" as const,
      ts: "2026-04-15T09:00:00Z",
      spanId: "span-existing",
      runId: "run-a",
      claimedPaths: ["src/foo.ts", "src/bar.ts"]
    };
    expect(() =>
      validateFileOverlap(
        {
          stage: "tdd",
          agent: "slice-implementer",
          mode: "proactive",
          status: "scheduled",
          ts: "2026-04-15T10:00:00Z",
          spanId: "span-1",
          runId: "run-a",
          claimedPaths: ["src/foo.ts"]
        },
        [active]
      )
    ).toThrow(DispatchOverlapError);
  });
});

describe("validateFanOutCap (P2)", () => {
  it("does nothing when below the cap", () => {
    const active = Array.from({ length: 4 }, (_, i) => ({
      stage: "tdd" as const,
      agent: "slice-implementer" as const,
      mode: "proactive" as const,
      status: "scheduled" as const,
      ts: `2026-04-15T09:0${i}:00Z`,
      spanId: `span-${i}`,
      runId: "run-a",
      claimedPaths: [`src/m${i}.ts`]
    }));
    expect(() =>
      validateFanOutCap(
        {
          stage: "tdd",
          agent: "slice-implementer",
          mode: "proactive",
          status: "scheduled",
          ts: "2026-04-15T10:00:00Z",
          spanId: "span-new",
          runId: "run-a"
        },
        active
      )
    ).not.toThrow();
  });

  it("throws DispatchCapError at the 6th active slice-implementer", () => {
    const active = Array.from({ length: MAX_PARALLEL_SLICE_IMPLEMENTERS }, (_, i) => ({
      stage: "tdd" as const,
      agent: "slice-implementer" as const,
      mode: "proactive" as const,
      status: "scheduled" as const,
      ts: `2026-04-15T09:0${i}:00Z`,
      spanId: `span-${i}`,
      runId: "run-a",
      claimedPaths: [`src/m${i}.ts`]
    }));
    expect(() =>
      validateFanOutCap(
        {
          stage: "tdd",
          agent: "slice-implementer",
          mode: "proactive",
          status: "scheduled",
          ts: "2026-04-15T10:00:00Z",
          spanId: "span-new",
          runId: "run-a"
        },
        active
      )
    ).toThrow(DispatchCapError);
  });

  it("respects the explicit override argument", () => {
    const active = Array.from({ length: MAX_PARALLEL_SLICE_IMPLEMENTERS }, (_, i) => ({
      stage: "tdd" as const,
      agent: "slice-implementer" as const,
      mode: "proactive" as const,
      status: "scheduled" as const,
      ts: `2026-04-15T09:0${i}:00Z`,
      spanId: `span-${i}`,
      runId: "run-a",
      claimedPaths: [`src/m${i}.ts`]
    }));
    expect(() =>
      validateFanOutCap(
        {
          stage: "tdd",
          agent: "slice-implementer",
          mode: "proactive",
          status: "scheduled",
          ts: "2026-04-15T10:00:00Z",
          spanId: "span-new",
          runId: "run-a"
        },
        active,
        10
      )
    ).not.toThrow();
  });
});

describe("appendDelegation (P1+P2 integration)", () => {
  let savedEnv: string | undefined;
  beforeEach(() => {
    savedEnv = process.env.CCLAW_MAX_PARALLEL_SLICE_IMPLEMENTERS;
  });
  afterEach(() => {
    if (savedEnv === undefined) {
      delete process.env.CCLAW_MAX_PARALLEL_SLICE_IMPLEMENTERS;
    } else {
      process.env.CCLAW_MAX_PARALLEL_SLICE_IMPLEMENTERS = savedEnv;
    }
  });

  it("schedules two slice-implementers with disjoint paths in the same run", async () => {
    const root = await createTempProject("parallel-disjoint");
    await seedFlowState(root, "run-a");

    await appendDelegation(root, {
      stage: "tdd",
      agent: "slice-implementer",
      mode: "proactive",
      status: "scheduled",
      ts: "2026-04-15T09:00:00Z",
      spanId: "span-1",
      claimedPaths: ["src/foo.ts"]
    });
    await appendDelegation(root, {
      stage: "tdd",
      agent: "slice-implementer",
      mode: "proactive",
      status: "scheduled",
      ts: "2026-04-15T09:01:00Z",
      spanId: "span-2",
      claimedPaths: ["src/bar.ts"]
    });

    const ledger = await readDelegationLedger(root);
    expect(ledger.entries.filter((e) => e.status === "scheduled")).toHaveLength(2);
    expect(ledger.entries.find((e) => e.spanId === "span-2")?.allowParallel).toBe(true);
  });

  it("blocks a third slice-implementer with overlapping paths", async () => {
    const root = await createTempProject("parallel-overlap");
    await seedFlowState(root, "run-a");

    await appendDelegation(root, {
      stage: "tdd",
      agent: "slice-implementer",
      mode: "proactive",
      status: "scheduled",
      ts: "2026-04-15T09:00:00Z",
      spanId: "span-1",
      claimedPaths: ["src/foo.ts"]
    });
    await expect(
      appendDelegation(root, {
        stage: "tdd",
        agent: "slice-implementer",
        mode: "proactive",
        status: "scheduled",
        ts: "2026-04-15T09:01:00Z",
        spanId: "span-2",
        claimedPaths: ["src/foo.ts", "src/bar.ts"]
      })
    ).rejects.toThrow(DispatchOverlapError);
  });

  it("blocks the 6th disjoint slice-implementer when the cap is the default", async () => {
    delete process.env.CCLAW_MAX_PARALLEL_SLICE_IMPLEMENTERS;
    const root = await createTempProject("parallel-cap");
    await seedFlowState(root, "run-cap");

    for (let i = 0; i < MAX_PARALLEL_SLICE_IMPLEMENTERS; i += 1) {
      await appendDelegation(root, {
        stage: "tdd",
        agent: "slice-implementer",
        mode: "proactive",
        status: "scheduled",
        ts: `2026-04-15T09:0${i}:00Z`,
        spanId: `span-${i}`,
        claimedPaths: [`src/m${i}.ts`]
      });
    }
    await expect(
      appendDelegation(root, {
        stage: "tdd",
        agent: "slice-implementer",
        mode: "proactive",
        status: "scheduled",
        ts: "2026-04-15T09:10:00Z",
        spanId: "span-overflow",
        claimedPaths: ["src/m999.ts"]
      })
    ).rejects.toThrow(DispatchCapError);
  });

  it("env override raises the cap", async () => {
    process.env.CCLAW_MAX_PARALLEL_SLICE_IMPLEMENTERS = "10";
    const root = await createTempProject("parallel-cap-env");
    await seedFlowState(root, "run-env");

    for (let i = 0; i < 6; i += 1) {
      await appendDelegation(root, {
        stage: "tdd",
        agent: "slice-implementer",
        mode: "proactive",
        status: "scheduled",
        ts: `2026-04-15T09:0${i}:00Z`,
        spanId: `span-${i}`,
        claimedPaths: [`src/m${i}.ts`]
      });
    }
    const ledger = await readDelegationLedger(root);
    expect(ledger.entries.filter((e) => e.status === "scheduled")).toHaveLength(6);
  });
});
