import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { createDefaultConfig, writeConfig } from "../../src/config.js";
import { appendDelegation, checkMandatoryDelegations, isTrustBoundaryPath, readDelegationLedger } from "../../src/delegation.js";
import { createInitialFlowState } from "../../src/flow-state.js";
import type { FlowStage } from "../../src/types.js";
import { createTempProject } from "../helpers/index.js";

const execFileAsync = promisify(execFile);

async function git(cwd: string, args: string[]): Promise<void> {
  await execFileAsync("git", args, { cwd });
}

async function initGitRepoWithLargeReviewDiff(projectRoot: string): Promise<void> {
  await git(projectRoot, ["init"]);
  await git(projectRoot, ["config", "user.email", "tests@example.com"]);
  await git(projectRoot, ["config", "user.name", "Test Runner"]);
  await fs.writeFile(path.join(projectRoot, "README.md"), "# temp\n", "utf8");
  await git(projectRoot, ["add", "README.md"]);
  await git(projectRoot, ["commit", "-m", "init"]);

  const largeDiff = Array.from({ length: 140 }, (_, index) => `export const line${index} = ${index};`).join("\n");
  await fs.mkdir(path.join(projectRoot, "src"), { recursive: true });
  await fs.writeFile(path.join(projectRoot, "src/review-target.ts"), `${largeDiff}\n`, "utf8");
  await git(projectRoot, ["add", "src/review-target.ts"]);
  await git(projectRoot, ["commit", "-m", "large review diff"]);
}

async function seedFlowState(root: string, runId: string, stage: FlowStage = "scope"): Promise<void> {
  await fs.mkdir(path.join(root, ".cclaw/state"), { recursive: true });
  const state = createInitialFlowState(runId);
  state.currentStage = stage;
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

  it("infers completion fulfillmentMode from harness fallback when omitted", async () => {
    const root = await createTempProject("delegation-infer-fulfillment-mode");
    await seedFlowState(root, "run-codex-infer");
    await writeConfig(root, createDefaultConfig(["codex"]));

    await appendDelegation(root, {
      stage: "scope",
      agent: "planner",
      mode: "mandatory",
      status: "completed",
      ts: new Date().toISOString()
    });

    const ledger = await readDelegationLedger(root);
    expect(ledger.entries[0]?.fulfillmentMode).toBe("role-switch");

    const result = await checkMandatoryDelegations(root, "scope");
    expect(result.satisfied).toBe(false);
    expect(result.missingEvidence).toContain("planner");
  });

  it("requires evidence for generic-dispatch completions", async () => {
    const root = await createTempProject("delegation-generic-dispatch-evidence");
    await seedFlowState(root, "run-cursor-evidence");
    await writeConfig(root, createDefaultConfig(["cursor"]));

    await appendDelegation(root, {
      stage: "scope",
      agent: "planner",
      mode: "mandatory",
      status: "completed",
      ts: new Date().toISOString()
    });

    const result = await checkMandatoryDelegations(root, "scope");
    expect(result.satisfied).toBe(false);
    expect(result.missingEvidence).toContain("planner");
  });

  it("reads legacy completed rows without fulfillmentMode as isolated", async () => {
    const root = await createTempProject("delegation-legacy-fulfillment-mode");
    await seedFlowState(root, "run-legacy");
    await writeConfig(root, createDefaultConfig(["claude"]));
    await fs.writeFile(
      path.join(root, ".cclaw/state/delegation-log.json"),
      JSON.stringify({
        runId: "run-legacy",
        entries: [
          {
            stage: "scope",
            agent: "planner",
            mode: "mandatory",
            status: "completed",
            ts: new Date().toISOString(),
            runId: "run-legacy"
          }
        ]
      }, null, 2),
      "utf8"
    );

    const ledger = await readDelegationLedger(root);
    expect(ledger.entries[0]?.fulfillmentMode).toBe("isolated");
    const result = await checkMandatoryDelegations(root, "scope");
    expect(result.satisfied).toBe(true);
    expect(result.missingEvidence).toEqual([]);
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

  it("requires a second reviewer completion when adversarial triggers are active", async () => {
    const root = await createTempProject("delegation-adversarial-review");
    await seedFlowState(root, "run-review", "review");
    await writeConfig(root, createDefaultConfig(["claude"]));
    await initGitRepoWithLargeReviewDiff(root);

    await appendDelegation(root, {
      stage: "review",
      agent: "reviewer",
      mode: "mandatory",
      status: "completed",
      ts: new Date().toISOString()
    });
    await appendDelegation(root, {
      stage: "review",
      agent: "security-reviewer",
      mode: "mandatory",
      status: "completed",
      ts: new Date().toISOString()
    });

    const firstPass = await checkMandatoryDelegations(root, "review");
    expect(firstPass.satisfied).toBe(false);
    expect(firstPass.missing).toContain("reviewer");

    await appendDelegation(root, {
      stage: "review",
      agent: "reviewer",
      mode: "mandatory",
      status: "completed",
      ts: new Date().toISOString()
    });

    const secondPass = await checkMandatoryDelegations(root, "review");
    expect(secondPass.satisfied).toBe(false);
    expect(secondPass.missing).toContain("reviewer");

    await appendDelegation(root, {
      stage: "review",
      agent: "reviewer",
      mode: "mandatory",
      status: "completed",
      skill: "adversarial-review",
      ts: new Date().toISOString()
    });

    const thirdPass = await checkMandatoryDelegations(root, "review");
    expect(thirdPass.satisfied).toBe(true);
    expect(thirdPass.missing).toEqual([]);
  });

  describe("isTrustBoundaryPath", () => {
    it("flags paths that clearly indicate trust-boundary surfaces", () => {
      expect(isTrustBoundaryPath("src/auth/session.ts")).toBe(true);
      expect(isTrustBoundaryPath("services/oauth-callback.ts")).toBe(true);
      expect(isTrustBoundaryPath("lib/security/policy-loader.ts")).toBe(true);
      expect(isTrustBoundaryPath("utils/sanitize-html.ts")).toBe(true);
      expect(isTrustBoundaryPath("api/csrf-middleware.ts")).toBe(true);
    });

    it("does not flag generic input/validation paths (avoids false positives)", () => {
      expect(isTrustBoundaryPath("src/components/form-input.tsx")).toBe(false);
      expect(isTrustBoundaryPath("utils/number-validation.ts")).toBe(false);
      expect(isTrustBoundaryPath("tests/e2e/input.test.ts")).toBe(false);
      expect(isTrustBoundaryPath("schemas/validate-payload.ts")).toBe(false);
    });
  });
});
