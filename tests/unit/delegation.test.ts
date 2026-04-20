import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createDefaultConfig, writeConfig } from "../../src/config.js";
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

  it("appendDelegation is idempotent on duplicate spanIds", async () => {
    const root = await createTempProject("delegation-dedup-spanid");
    await seedFlowState(root, "run-dedup");

    const ts = new Date().toISOString();
    await appendDelegation(root, {
      stage: "scope",
      agent: "planner",
      mode: "mandatory",
      status: "completed",
      ts,
      spanId: "span-fixed-1"
    });
    await appendDelegation(root, {
      stage: "scope",
      agent: "planner",
      mode: "mandatory",
      status: "completed",
      ts,
      spanId: "span-fixed-1"
    });

    const ledger = await readDelegationLedger(root);
    expect(ledger.entries).toHaveLength(1);
    expect(ledger.entries[0]?.spanId).toBe("span-fixed-1");
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

  it("requires explicit role-switch evidence on Codex instead of silent auto-waiver", async () => {
    const root = await createTempProject("delegation-role-switch-missing");
    await seedFlowState(root, "run-codex");
    await writeConfig(root, createDefaultConfig(["codex"]));

    const result = await checkMandatoryDelegations(root, "scope");
    expect(result.satisfied).toBe(false);
    expect(result.missing).toContain("planner");
    expect(result.autoWaived).toEqual([]);
    expect(result.expectedMode).toBe("role-switch");

    const ledger = await readDelegationLedger(root);
    expect(ledger.entries).toEqual([]);
  });

  it("accepts a role-switch delegation carrying evidence under a role-switch harness", async () => {
    const root = await createTempProject("delegation-role-switch-ok");
    await seedFlowState(root, "run-codex-ok");
    await writeConfig(root, createDefaultConfig(["codex"]));

    await appendDelegation(root, {
      stage: "scope",
      agent: "planner",
      mode: "mandatory",
      status: "completed",
      fulfillmentMode: "role-switch",
      evidenceRefs: [".cclaw/artifacts/02-scope.md#decisions"],
      ts: new Date().toISOString()
    });

    const result = await checkMandatoryDelegations(root, "scope");
    expect(result.satisfied).toBe(true);
    expect(result.missing).toEqual([]);
    expect(result.missingEvidence).toEqual([]);
    expect(result.expectedMode).toBe("role-switch");
  });

  it("flags role-switch completion without evidenceRefs as missingEvidence", async () => {
    const root = await createTempProject("delegation-role-switch-no-evidence");
    await seedFlowState(root, "run-codex-thin");
    await writeConfig(root, createDefaultConfig(["codex"]));

    await appendDelegation(root, {
      stage: "scope",
      agent: "planner",
      mode: "mandatory",
      status: "completed",
      fulfillmentMode: "role-switch",
      ts: new Date().toISOString()
    });

    const result = await checkMandatoryDelegations(root, "scope");
    expect(result.satisfied).toBe(false);
    expect(result.missing).toEqual([]);
    expect(result.missingEvidence).toContain("planner");
  });

  it("requires evidence for explicit role-switch rows even in mixed installs", async () => {
    const root = await createTempProject("delegation-mixed-install-role-switch-evidence");
    await seedFlowState(root, "run-mixed-role-switch");
    await writeConfig(root, createDefaultConfig(["claude", "codex"]));

    // A Codex session inside a claude+codex install logs a role-switch
    // completion without evidenceRefs. The aggregate expectedMode is
    // "isolated" (claude wins), but evidence is still required because
    // the row is explicitly flagged role-switch.
    await appendDelegation(root, {
      stage: "scope",
      agent: "planner",
      mode: "mandatory",
      status: "completed",
      fulfillmentMode: "role-switch",
      ts: new Date().toISOString()
    });

    const result = await checkMandatoryDelegations(root, "scope");
    expect(result.satisfied).toBe(false);
    expect(result.missingEvidence).toContain("planner");
    expect(result.expectedMode).toBe("isolated");
  });

  it("prefers the stronger fallback in mixed harness installs (claude + codex)", async () => {
    const root = await createTempProject("delegation-mixed-install");
    await seedFlowState(root, "run-mixed");
    await writeConfig(root, createDefaultConfig(["claude", "codex"]));

    await appendDelegation(root, {
      stage: "scope",
      agent: "planner",
      mode: "mandatory",
      status: "completed",
      ts: new Date().toISOString()
    });

    const result = await checkMandatoryDelegations(root, "scope");
    expect(result.satisfied).toBe(true);
    expect(result.expectedMode).toBe("isolated");
  });
});
