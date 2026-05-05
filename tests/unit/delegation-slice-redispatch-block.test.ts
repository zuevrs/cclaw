import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  appendDelegation,
  readDelegationLedger,
  SliceAlreadyClosedError
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

async function appendCompletedPhase(params: {
  root: string;
  runId: string;
  spanId: string;
  sliceId: string;
  phase: "red" | "green" | "refactor" | "doc";
  ts: string;
  withRefactorOutcome?: boolean;
}): Promise<void> {
  await appendDelegation(params.root, {
    stage: "tdd",
    agent: "slice-builder",
    mode: "mandatory",
    status: "completed",
    runId: params.runId,
    spanId: params.spanId,
    sliceId: params.sliceId,
    phase: params.phase,
    evidenceRefs: ["tests/unit/delegation-slice-redispatch-block.test.ts"],
    refactorOutcome: params.withRefactorOutcome
      ? { mode: "inline", rationale: "inline cleanup completed during green phase" }
      : undefined,
    ts: params.ts,
    completedTs: params.ts
  });
}

describe("slice re-dispatch guard after closed spans", () => {
  it("blocks new scheduled span when another span already closed the slice", async () => {
    const root = await createTempProject("delegation-slice-redispatch-blocked");
    const runId = "run-redispatch-1";
    await seedFlowState(root, runId);

    await appendCompletedPhase({
      root, runId, spanId: "span-closed", sliceId: "S-9", phase: "red", ts: "2026-05-05T10:00:00.000Z"
    });
    await appendCompletedPhase({
      root, runId, spanId: "span-closed", sliceId: "S-9", phase: "green", ts: "2026-05-05T10:01:00.000Z"
    });
    await appendCompletedPhase({
      root, runId, spanId: "span-closed", sliceId: "S-9", phase: "refactor", ts: "2026-05-05T10:02:00.000Z"
    });
    await appendCompletedPhase({
      root, runId, spanId: "span-closed", sliceId: "S-9", phase: "doc", ts: "2026-05-05T10:03:00.000Z"
    });

    await expect(
      appendDelegation(root, {
        stage: "tdd",
        agent: "slice-builder",
        mode: "mandatory",
        status: "scheduled",
        runId,
        spanId: "span-new",
        sliceId: "S-9",
        claimedPaths: ["src/s9.ts"],
        ts: "2026-05-05T10:05:00.000Z"
      })
    ).rejects.toThrow(SliceAlreadyClosedError);
  });

  it("treats green refactorOutcome as closed-cycle refactor coverage", async () => {
    const root = await createTempProject("delegation-slice-redispatch-green-outcome");
    const runId = "run-redispatch-2";
    await seedFlowState(root, runId);

    await appendCompletedPhase({
      root, runId, spanId: "span-closed", sliceId: "S-10", phase: "red", ts: "2026-05-05T11:00:00.000Z"
    });
    await appendCompletedPhase({
      root,
      runId,
      spanId: "span-closed",
      sliceId: "S-10",
      phase: "green",
      ts: "2026-05-05T11:01:00.000Z",
      withRefactorOutcome: true
    });
    await appendCompletedPhase({
      root, runId, spanId: "span-closed", sliceId: "S-10", phase: "doc", ts: "2026-05-05T11:02:00.000Z"
    });

    await expect(
      appendDelegation(root, {
        stage: "tdd",
        agent: "slice-builder",
        mode: "mandatory",
        status: "scheduled",
        runId,
        spanId: "span-new",
        sliceId: "S-10",
        claimedPaths: ["src/s10.ts"],
        ts: "2026-05-05T11:03:00.000Z"
      })
    ).rejects.toThrow(SliceAlreadyClosedError);
  });

  it("allows re-dispatch when prior span is not fully closed", async () => {
    const root = await createTempProject("delegation-slice-redispatch-allowed");
    const runId = "run-redispatch-3";
    await seedFlowState(root, runId);

    await appendCompletedPhase({
      root, runId, spanId: "span-incomplete", sliceId: "S-11", phase: "red", ts: "2026-05-05T12:00:00.000Z"
    });
    await appendCompletedPhase({
      root, runId, spanId: "span-incomplete", sliceId: "S-11", phase: "green", ts: "2026-05-05T12:01:00.000Z"
    });
    // No refactor/doc → not closed.

    await expect(
      appendDelegation(root, {
        stage: "tdd",
        agent: "slice-builder",
        mode: "mandatory",
        status: "scheduled",
        runId,
        spanId: "span-new",
        sliceId: "S-11",
        claimedPaths: ["src/s11.ts"],
        ts: "2026-05-05T12:02:00.000Z"
      })
    ).resolves.toBeUndefined();

    const ledger = await readDelegationLedger(root);
    const scheduled = ledger.entries.find((entry) => entry.spanId === "span-new");
    expect(scheduled?.status).toBe("scheduled");
  });
});

