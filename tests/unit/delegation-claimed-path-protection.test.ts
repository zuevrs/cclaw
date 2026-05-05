import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  appendDelegation,
  DispatchClaimedPathProtectedError,
  isManagedRuntimePath,
  readDelegationLedger
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

describe("managed runtime path protection", () => {
  it("classifies managed runtime paths and allows .cclaw/artifacts and .cclaw-out/", () => {
    expect(isManagedRuntimePath(".cclaw/hooks/delegation-record.mjs")).toBe(true);
    expect(isManagedRuntimePath(".cclaw/agents/slice-builder.md")).toBe(true);
    expect(isManagedRuntimePath(".cclaw/skills/plan.md")).toBe(true);
    expect(isManagedRuntimePath(".cclaw/commands/start.md")).toBe(true);
    expect(isManagedRuntimePath(".cclaw/templates/spec.md")).toBe(true);
    expect(isManagedRuntimePath(".cclaw/seeds/session.json")).toBe(true);
    expect(isManagedRuntimePath(".cclaw/rules/workflow.md")).toBe(true);
    expect(isManagedRuntimePath(".cclaw/state/flow-state.json")).toBe(true);
    expect(isManagedRuntimePath(".cclaw/config.yaml")).toBe(true);
    expect(isManagedRuntimePath(".cclaw/managed-resources.json")).toBe(true);
    expect(isManagedRuntimePath(".cclaw/.flow-state.guard.json")).toBe(true);
    expect(isManagedRuntimePath(".cclaw/artifacts/tdd-slices/S-1.md")).toBe(false);
    expect(isManagedRuntimePath(".cclaw/artifacts/06-tdd.md")).toBe(false);
    expect(isManagedRuntimePath("src/example.ts")).toBe(false);
    expect(isManagedRuntimePath(".cclaw-out/foo")).toBe(false);
  });

  it("accepts scheduled spans claiming src/ and .cclaw-out/ paths (sibling out-tree is fine)", async () => {
    const root = await createTempProject("delegation-claimed-path-out-sibling");
    await seedFlowState(root, "run-out-sibling");

    await expect(
      appendDelegation(root, {
        stage: "tdd",
        agent: "slice-builder",
        mode: "mandatory",
        status: "scheduled",
        spanId: "span-out-sibling",
        sliceId: "S-3",
        claimedPaths: ["src/example.ts", ".cclaw-out/foo"],
        ts: "2026-05-05T10:02:00.000Z"
      })
    ).resolves.toBeUndefined();

    const ledger = await readDelegationLedger(root);
    const scheduled = ledger.entries.find((entry) => entry.spanId === "span-out-sibling");
    expect(scheduled?.claimedPaths).toEqual(["src/example.ts", ".cclaw-out/foo"]);
  });

  it("accepts scheduled spans claiming `.cclaw/artifacts/06-tdd.md` (artifacts/ is not protected)", async () => {
    const root = await createTempProject("delegation-claimed-path-artifacts-tdd");
    await seedFlowState(root, "run-artifacts-tdd");

    await expect(
      appendDelegation(root, {
        stage: "tdd",
        agent: "slice-builder",
        mode: "mandatory",
        status: "scheduled",
        spanId: "span-artifacts-tdd",
        sliceId: "S-4",
        claimedPaths: [".cclaw/artifacts/06-tdd.md"],
        ts: "2026-05-05T10:03:00.000Z"
      })
    ).resolves.toBeUndefined();

    const ledger = await readDelegationLedger(root);
    const scheduled = ledger.entries.find((entry) => entry.spanId === "span-artifacts-tdd");
    expect(scheduled?.claimedPaths).toEqual([".cclaw/artifacts/06-tdd.md"]);
  });

  it("rejects scheduled spans that claim managed runtime files", async () => {
    const root = await createTempProject("delegation-claimed-path-protected");
    await seedFlowState(root, "run-protected");

    await expect(
      appendDelegation(root, {
        stage: "tdd",
        agent: "slice-builder",
        mode: "mandatory",
        status: "scheduled",
        spanId: "span-protected",
        sliceId: "S-1",
        claimedPaths: [
          ".cclaw/hooks/delegation-record.mjs",
          "src/feature.ts"
        ],
        ts: "2026-05-05T10:00:00.000Z"
      })
    ).rejects.toThrow(DispatchClaimedPathProtectedError);
  });

  it("allows scheduled spans that only claim normal files + artifacts", async () => {
    const root = await createTempProject("delegation-claimed-path-allowed");
    await seedFlowState(root, "run-allowed");

    await expect(
      appendDelegation(root, {
        stage: "tdd",
        agent: "slice-builder",
        mode: "mandatory",
        status: "scheduled",
        spanId: "span-allowed",
        sliceId: "S-2",
        claimedPaths: [
          ".cclaw/artifacts/tdd-slices/S-2.md",
          "src/feature.ts"
        ],
        ts: "2026-05-05T10:01:00.000Z"
      })
    ).resolves.toBeUndefined();

    const ledger = await readDelegationLedger(root);
    const scheduled = ledger.entries.find((entry) => entry.spanId === "span-allowed");
    expect(scheduled?.status).toBe("scheduled");
  });
});

