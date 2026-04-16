import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { appendDelegation, checkMandatoryDelegations, readDelegationLedger } from "../../src/delegation.js";
import { createInitialFlowState } from "../../src/flow-state.js";
import { createTempProject } from "../helpers/index.js";

async function seedFlowState(root: string, runId: string): Promise<void> {
  await fs.mkdir(path.join(root, ".cclaw/state"), { recursive: true });
  const state = createInitialFlowState(runId);
  state.currentStage = "scope";
  await fs.writeFile(
    path.join(root, ".cclaw/state/flow-state.json"),
    `${JSON.stringify(state, null, 2)}\n`,
    "utf8"
  );
}

describe("delegation ledger run scoping", () => {
  it("stamps appended entries with the active runId", async () => {
    const root = await createTempProject("delegation-stamp");
    await seedFlowState(root, "run-alpha");

    await appendDelegation(root, {
      stage: "scope",
      agent: "planner",
      mode: "mandatory",
      status: "completed",
      ts: new Date().toISOString()
    });

    const ledger = await readDelegationLedger(root);
    expect(ledger.entries).toHaveLength(1);
    expect(ledger.entries[0]?.runId).toBe("run-alpha");
  });

  it("ignores delegations from previous runs when checking mandatory coverage", async () => {
    const root = await createTempProject("delegation-scope");
    await seedFlowState(root, "run-old");

    await appendDelegation(root, {
      stage: "scope",
      agent: "planner",
      mode: "mandatory",
      status: "completed",
      ts: new Date().toISOString()
    });

    await seedFlowState(root, "run-new");

    const result = await checkMandatoryDelegations(root, "scope");
    expect(result.satisfied).toBe(false);
    expect(result.missing).toContain("planner");
    expect(result.staleIgnored.length).toBeGreaterThan(0);
  });

  it("counts delegations recorded for the current run", async () => {
    const root = await createTempProject("delegation-current");
    await seedFlowState(root, "run-current");

    await appendDelegation(root, {
      stage: "scope",
      agent: "planner",
      mode: "mandatory",
      status: "completed",
      ts: new Date().toISOString()
    });

    const result = await checkMandatoryDelegations(root, "scope");
    expect(result.satisfied).toBe(true);
    expect(result.missing).toEqual([]);
    expect(result.staleIgnored).toEqual([]);
  });
});
