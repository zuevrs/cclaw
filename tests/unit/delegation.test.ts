import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { createDefaultConfig, writeConfig } from "../../src/config.js";
import { appendDelegation, checkMandatoryDelegations, isTrustBoundaryPath, readDelegationEvents, readDelegationLedger } from "../../src/delegation.js";
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

  it("preserves distinct phase rows that share spanId+status (TDD slice-builder lifecycle)", async () => {
    // Regression for the 7.0.4 ledger dedup bug: a single slice-builder
    // span legitimately emits four rows with status=completed (one each
    // for phase=red|green|refactor|doc). The pre-7.0.5 dedup keyed only
    // on (spanId, status), so green/refactor/doc were silently dropped
    // from delegation-log.json and the artifact linter reported
    // tdd_slice_green_missing for slices whose work actually landed.
    const root = await createTempProject("delegation-dedup-phase-coexist");
    await seedFlowState(root, "run-phase-coexist", "tdd");

    const baseTs = Date.parse("2026-05-05T00:00:00.000Z");
    const isoAt = (offsetMin: number): string =>
      new Date(baseTs + offsetMin * 60_000).toISOString();
    const phases = ["red", "green", "refactor", "doc"] as const;
    for (let i = 0; i < phases.length; i += 1) {
      const phase = phases[i]!;
      await appendDelegation(root, {
        stage: "tdd",
        agent: "slice-builder",
        mode: "mandatory",
        status: "completed",
        ts: isoAt(i + 1),
        completedTs: isoAt(i + 1),
        spanId: "span-tdd-S-99",
        sliceId: "S-99",
        phase,
        evidenceRefs: [`.cclaw/artifacts/tdd-slices/S-99.${phase}.txt`]
      });
    }

    const ledger = await readDelegationLedger(root);
    const phaseRows = ledger.entries.filter(
      (entry) => entry.spanId === "span-tdd-S-99" && entry.status === "completed"
    );
    const observedPhases = phaseRows.map((entry) => entry.phase).sort();
    expect(observedPhases).toEqual(["doc", "green", "red", "refactor"]);

    // Same (spanId, status, phase) replay is still deduplicated.
    await appendDelegation(root, {
      stage: "tdd",
      agent: "slice-builder",
      mode: "mandatory",
      status: "completed",
      ts: isoAt(99),
      completedTs: isoAt(99),
      spanId: "span-tdd-S-99",
      sliceId: "S-99",
      phase: "green",
      evidenceRefs: [".cclaw/artifacts/tdd-slices/S-99.green.txt"]
    });
    const replayed = await readDelegationLedger(root);
    const greenRows = replayed.entries.filter(
      (entry) => entry.spanId === "span-tdd-S-99" && entry.phase === "green"
    );
    expect(greenRows).toHaveLength(1);
  });

  it("records lifecycle timestamps for scheduled and terminal rows", async () => {
    const root = await createTempProject("delegation-lifecycle-timestamps");
    await seedFlowState(root, "run-lifecycle");

    await appendDelegation(root, {
      stage: "scope",
      agent: "planner",
      mode: "mandatory",
      status: "scheduled",
      spanId: "span-lifecycle",
      ts: new Date().toISOString()
    });
    await appendDelegation(root, {
      stage: "scope",
      agent: "planner",
      mode: "mandatory",
      status: "completed",
      spanId: "span-lifecycle-done",
      ts: new Date().toISOString()
    });

    const ledger = await readDelegationLedger(root);
    const scheduled = ledger.entries.find((entry) => entry.spanId === "span-lifecycle");
    const completed = ledger.entries.find((entry) => entry.spanId === "span-lifecycle-done");
    expect(scheduled?.startTs).toBeTruthy();
    expect(scheduled?.endTs).toBeUndefined();
    expect(completed?.startTs).toBeTruthy();
    expect(completed?.endTs).toBeTruthy();
  });

  it("blocks mandatory checks when current-run scheduled workers have no terminal row", async () => {
    const root = await createTempProject("delegation-stale-scheduled-worker");
    await seedFlowState(root, "run-stale-worker");

    await appendDelegation(root, {
      stage: "scope",
      agent: "planner",
      mode: "mandatory",
      status: "scheduled",
      spanId: "span-stale",
      ts: new Date().toISOString()
    });
    await appendDelegation(root, {
      stage: "scope",
      agent: "planner",
      mode: "mandatory",
      status: "completed",
      spanId: "span-completed",
      ts: new Date().toISOString()
    });
    await appendDelegation(root, {
      stage: "scope",
      agent: "critic",
      mode: "mandatory",
      status: "completed",
      ts: new Date().toISOString()
    });

    const result = await checkMandatoryDelegations(root, "scope");
    expect(result.satisfied).toBe(false);
    expect(result.missing).toEqual([]);
    expect(result.staleWorkers).toContain("planner(spanId=span-stale)");
  });

  it("accepts scheduled workers once a terminal row shares the same spanId", async () => {
    const root = await createTempProject("delegation-scheduled-worker-closed");
    await seedFlowState(root, "run-closed-worker");

    await appendDelegation(root, {
      stage: "scope",
      agent: "planner",
      mode: "mandatory",
      status: "scheduled",
      spanId: "span-closed",
      ts: new Date().toISOString()
    });
    await appendDelegation(root, {
      stage: "scope",
      agent: "planner",
      mode: "mandatory",
      status: "completed",
      spanId: "span-closed",
      ts: new Date().toISOString()
    });
    await appendDelegation(root, {
      stage: "scope",
      agent: "critic",
      mode: "mandatory",
      status: "completed",
      ts: new Date().toISOString()
    });

    const result = await checkMandatoryDelegations(root, "scope");
    expect(result.satisfied).toBe(true);
    expect(result.staleWorkers).toEqual([]);
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

    
    await appendDelegation(root, {
      stage: "scope",
      agent: "critic",
      mode: "mandatory",
      status: "completed",
      ts: new Date().toISOString()
    });

const result = await checkMandatoryDelegations(root, "scope");
    expect(result.satisfied).toBe(true);
    expect(result.missing).toEqual([]);
    expect(result.staleIgnored).toEqual([]);
  });


  it("does not satisfy mandatory coverage from proactive waived rows", async () => {
    const root = await createTempProject("delegation-proactive-waiver-not-sufficient");
    await seedFlowState(root, "run-current");

    await appendDelegation(root, {
      stage: "scope",
      agent: "planner",
      mode: "proactive",
      status: "waived",
      waiverReason: "not triggered",
      ts: new Date().toISOString()
    });

    const result = await checkMandatoryDelegations(root, "scope");
    expect(result.satisfied).toBe(false);
    expect(result.missing).toContain("planner");
    expect(result.waived).toEqual([]);
  });

  it("expects Codex native subagent completion instead of role-switch by default", async () => {
    const root = await createTempProject("delegation-codex-native-missing");
    await seedFlowState(root, "run-codex");
    await writeConfig(root, createDefaultConfig(["codex"]));

    const result = await checkMandatoryDelegations(root, "scope");
    expect(result.satisfied).toBe(false);
    expect(result.missing).toContain("planner");
    expect(result.expectedMode).toBe("isolated");

    const ledger = await readDelegationLedger(root);
    expect(ledger.entries).toEqual([]);
  });

  it("accepts Codex native subagent completion without collapsing to role-switch", async () => {
    const root = await createTempProject("delegation-codex-native-ok");
    await seedFlowState(root, "run-codex-ok");
    await writeConfig(root, createDefaultConfig(["codex"]));

    await appendDelegation(root, {
      stage: "scope",
      agent: "planner",
      mode: "mandatory",
      status: "completed",
      fulfillmentMode: "isolated",
      ts: new Date().toISOString()
    });

    
    await appendDelegation(root, {
      stage: "scope",
      agent: "critic",
      mode: "mandatory",
      status: "completed",
      ts: new Date().toISOString()
    });

const result = await checkMandatoryDelegations(root, "scope");
    expect(result.satisfied).toBe(true);
    expect(result.missing).toEqual([]);
    expect(result.missingEvidence).toEqual([]);
    expect(result.expectedMode).toBe("isolated");
  });

  it("still flags degraded role-switch completion without evidenceRefs", async () => {
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

    
    await appendDelegation(root, {
      stage: "scope",
      agent: "critic",
      mode: "mandatory",
      status: "completed",
      fulfillmentMode: "isolated",
      ts: new Date().toISOString()
    });

const result = await checkMandatoryDelegations(root, "scope");
    expect(result.satisfied).toBe(false);
    expect(result.missing).toEqual([]);
    expect(result.missingEvidence).toContain("planner");
    expect(result.expectedMode).toBe("isolated");
  });

  it("infers native completion fulfillmentMode from Codex harness when omitted", async () => {
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
    expect(ledger.entries[0]?.fulfillmentMode).toBe("isolated");

    
    await appendDelegation(root, {
      stage: "scope",
      agent: "critic",
      mode: "mandatory",
      status: "completed",
      ts: new Date().toISOString()
    });

const result = await checkMandatoryDelegations(root, "scope");
    expect(result.satisfied).toBe(true);
    expect(result.missingEvidence).toEqual([]);
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

  it("tags pre-v3 completed rows without dispatchSurface as legacy-inferred and blocks satisfied until rerecord", async () => {
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
    expect(ledger.entries[0]?.fulfillmentMode).toBe("legacy-inferred");

    await appendDelegation(root, {
      stage: "scope",
      agent: "critic",
      mode: "mandatory",
      status: "completed",
      ts: new Date().toISOString()
    });

    const result = await checkMandatoryDelegations(root, "scope");
    expect(result.satisfied).toBe(false);
    expect(result.legacyInferredCompletions.some((row) => row.startsWith("planner"))).toBe(true);
    expect(result.missing).toEqual([]);
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

    
    await appendDelegation(root, {
      stage: "scope",
      agent: "critic",
      mode: "mandatory",
      status: "completed",
      ts: new Date().toISOString()
    });

const result = await checkMandatoryDelegations(root, "scope");
    expect(result.satisfied).toBe(true);
    expect(result.expectedMode).toBe("isolated");
  });

  it("uses active harness when inferring fulfillment mode for mixed installs", async () => {
    const root = await createTempProject("delegation-active-harness");
    await seedFlowState(root, "run-active-harness");
    await writeConfig(root, createDefaultConfig(["claude", "codex"]));
    const prior = process.env.CCLAW_ACTIVE_HARNESS;
    process.env.CCLAW_ACTIVE_HARNESS = "codex";
    try {
      await appendDelegation(root, {
        stage: "scope",
        agent: "planner",
        mode: "mandatory",
        status: "completed",
        ts: new Date().toISOString()
      });

      const ledger = await readDelegationLedger(root);
      expect(ledger.entries[0]?.fulfillmentMode).toBe("isolated");
      
    await appendDelegation(root, {
      stage: "scope",
      agent: "critic",
      mode: "mandatory",
      status: "completed",
      ts: new Date().toISOString()
    });

const result = await checkMandatoryDelegations(root, "scope");
      expect(result.satisfied).toBe(true);
      expect(result.expectedMode).toBe("isolated");
      expect(result.missingEvidence).toEqual([]);
    } finally {
      if (prior === undefined) {
        delete process.env.CCLAW_ACTIVE_HARNESS;
      } else {
        process.env.CCLAW_ACTIVE_HARNESS = prior;
      }
    }
  });

  it("uses active OpenCode semantics in mixed installs instead of configured harness aggregate", async () => {
    const root = await createTempProject("delegation-active-opencode-mixed");
    await seedFlowState(root, "run-active-opencode");
    await writeConfig(root, createDefaultConfig(["claude", "cursor", "opencode"]));
    const prior = process.env.CCLAW_ACTIVE_HARNESS;
    process.env.CCLAW_ACTIVE_HARNESS = "opencode";
    try {
      await appendDelegation(root, {
        stage: "scope",
        agent: "planner",
        mode: "mandatory",
        status: "completed",
        ts: new Date().toISOString()
      });

      const ledger = await readDelegationLedger(root);
      expect(ledger.entries[0]?.fulfillmentMode).toBe("isolated");
      
    await appendDelegation(root, {
      stage: "scope",
      agent: "critic",
      mode: "mandatory",
      status: "completed",
      ts: new Date().toISOString()
    });

const result = await checkMandatoryDelegations(root, "scope");
      expect(result.satisfied).toBe(true);
      expect(result.expectedMode).toBe("isolated");
      expect(result.missing).toEqual([]);
      expect(result.missingEvidence).toEqual([]);
    } finally {
      if (prior === undefined) {
        delete process.env.CCLAW_ACTIVE_HARNESS;
      } else {
        process.env.CCLAW_ACTIVE_HARNESS = prior;
      }
    }
  });


  it("rejects waived entries without a non-empty waiverReason", async () => {
    const root = await createTempProject("delegation-waiver-reason-required");
    await seedFlowState(root, "run-waiver-reason");

    await expect(appendDelegation(root, {
      stage: "scope",
      agent: "planner",
      mode: "mandatory",
      status: "waived",
      ts: new Date().toISOString()
    })).rejects.toThrow(/waiverReason/);
  });

  it("drops legacy waived rows without waiverReason during ledger parsing", async () => {
    const root = await createTempProject("delegation-legacy-waiver-invalid");
    await seedFlowState(root, "run-invalid-waiver");
    await fs.writeFile(
      path.join(root, ".cclaw/state/delegation-log.json"),
      JSON.stringify({
        runId: "run-invalid-waiver",
        entries: [{
          stage: "scope",
          agent: "planner",
          mode: "mandatory",
          status: "waived",
          ts: new Date().toISOString(),
          runId: "run-invalid-waiver"
        }]
      }, null, 2),
      "utf8"
    );

    const ledger = await readDelegationLedger(root);
    expect(ledger.entries).toEqual([]);
  });

  it("drops mandatory delegations entirely when taskClass=software-bugfix (skippedByTrack)", async () => {
    const root = await createTempProject("delegation-bugfix-skip");
    await seedFlowState(root, "run-bugfix-review", "review");
    // Note: track stays as the default (standard) — only taskClass forces the skip here.
    await writeConfig(root, createDefaultConfig(["claude"]));

    const result = await checkMandatoryDelegations(root, "review", {
      taskClass: "software-bugfix"
    });
    // : bugfix taskClass collapses mandatory delegations
    // to [] regardless of track because tdd/review safety gates already
    // cover the regression-risk surface.
    expect(result.satisfied).toBe(true);
    expect(result.missing).toEqual([]);
    expect(result.skippedByTrack).toBe(true);
  });

  it("follow-up : reads flowState.taskClass when caller omits options.taskClass", async () => {
    // Regression for the audit follow-up: `buildValidationReport` (the
    // `cclaw advance-stage` path) calls `checkMandatoryDelegations` without
    // forwarding `taskClass`, which left the `software-bugfix` skip dead
    // even when `flow-state.json` carried the classification. The fix
    // makes `flowState.taskClass` the fallback when the caller passes
    // `undefined`.
    const root = await createTempProject("delegation-bugfix-skip-from-flowstate");
    await seedFlowState(root, "run-flowstate-bugfix-review", "review");
    const statePath = path.join(root, ".cclaw/state/flow-state.json");
    const state = JSON.parse(await fs.readFile(statePath, "utf8")) as Record<string, unknown>;
    state.taskClass = "software-bugfix";
    await fs.writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
    await writeConfig(root, createDefaultConfig(["claude"]));

    // No options passed — must read flowState.taskClass.
    const result = await checkMandatoryDelegations(root, "review");
    expect(result.satisfied).toBe(true);
    expect(result.missing).toEqual([]);
    expect(result.skippedByTrack).toBe(true);
  });

  it("follow-up : explicit options.taskClass=null overrides flowState.taskClass", async () => {
    // The fallback only fires when the caller leaves `taskClass`
    // undefined. Passing an explicit `null` (e.g. for a caller that
    // wants to suppress the classification) keeps the bugfix skip OFF.
    const root = await createTempProject("delegation-bugfix-explicit-null");
    await seedFlowState(root, "run-explicit-null-review", "review");
    const statePath = path.join(root, ".cclaw/state/flow-state.json");
    const state = JSON.parse(await fs.readFile(statePath, "utf8")) as Record<string, unknown>;
    state.taskClass = "software-bugfix";
    await fs.writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
    await writeConfig(root, createDefaultConfig(["claude"]));

    const result = await checkMandatoryDelegations(root, "review", { taskClass: null });
    // Standard track + explicit null taskClass → no skip; the registered
    // mandatory list still applies. Whether the run is `satisfied`
    // depends on whether the ledger has the mandatory completions, but
    // `skippedByTrack` MUST be false.
    expect(result.skippedByTrack).toBe(false);
  });

  it("drops mandatory delegations entirely on the quick track (skippedByTrack)", async () => {
    const root = await createTempProject("delegation-track-required-at-tier");
    await seedFlowState(root, "run-quick-review", "review");
    const statePath = path.join(root, ".cclaw/state/flow-state.json");
    const state = JSON.parse(await fs.readFile(statePath, "utf8")) as { track: string; skippedStages: string[] };
    state.track = "quick";
    state.skippedStages = ["brainstorm", "scope", "design", "plan"];
    await fs.writeFile(statePath, `${JSON.stringify(state, null, 2)}
`, "utf8");
    await writeConfig(root, createDefaultConfig(["claude"], "quick"));

    const result = await checkMandatoryDelegations(root, "review");
    // : mandatory delegations are dropped on track === "quick".
    // The gate reports satisfied: true, missing: [], and flags the skip via
    // skippedByTrack so audit tooling can see it happened.
    expect(result.satisfied).toBe(true);
    expect(result.missing).toEqual([]);
    expect(result.skippedByTrack).toBe(true);
  });


  it("does not require adversarial review as a mandatory delegation by default", async () => {
    const root = await createTempProject("delegation-review-defaults");
    await seedFlowState(root, "run-review", "review");
    await writeConfig(root, createDefaultConfig(["claude"]));
    await initGitRepoWithLargeReviewDiff(root);

    await appendDelegation(root, {
      stage: "review",
      agent: "reviewer",
      mode: "mandatory",
      status: "completed",
      evidenceRefs: [".cclaw/artifacts/07-review.md#layer-1"],
      ts: new Date().toISOString()
    });
    await appendDelegation(root, {
      stage: "review",
      agent: "security-reviewer",
      mode: "mandatory",
      status: "completed",
      evidenceRefs: [".cclaw/artifacts/07-review.md#security"],
      ts: new Date().toISOString()
    });

    const result = await checkMandatoryDelegations(root, "review");
    expect(result.satisfied).toBe(true);
    expect(result.missing).toEqual([]);
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


describe("delegation dispatch proof events", () => {
  it("records scheduled -> launched -> acknowledged -> completed events and accepts proven isolated completion", async () => {
    const root = await createTempProject("delegation-proof-happy-path");
    await seedFlowState(root, "run-proof");
    await writeConfig(root, createDefaultConfig(["opencode"]));
    const base = {
      stage: "scope",
      agent: "planner",
      mode: "mandatory" as const,
      spanId: "span-proof",
      dispatchId: "dispatch-proof",
      dispatchSurface: "opencode-agent" as const,
      agentDefinitionPath: ".opencode/agents/planner.md",
      ts: new Date().toISOString()
    };

    await appendDelegation(root, { ...base, status: "scheduled" });
    await appendDelegation(root, { ...base, status: "launched" });
    await appendDelegation(root, { ...base, status: "acknowledged" });
    await appendDelegation(root, { ...base, status: "completed", fulfillmentMode: "isolated" });
    await appendDelegation(root, {
      stage: "scope",
      agent: "critic",
      mode: "mandatory",
      status: "completed",
      spanId: "span-critic",
      dispatchId: "dispatch-critic",
      dispatchSurface: "opencode-agent",
      agentDefinitionPath: ".opencode/agents/critic.md",
      ackTs: new Date().toISOString(),
      completedTs: new Date().toISOString(),
      ts: new Date().toISOString(),
      fulfillmentMode: "isolated"
    });

    const events = await readDelegationEvents(root);
    expect(events.corruptLines).toEqual([]);
    expect(events.events.map((event) => event.event)).toEqual([
      "scheduled",
      "launched",
      "acknowledged",
      "completed",
      "completed"
    ]);
    const result = await checkMandatoryDelegations(root, "scope");
    expect(result.satisfied).toBe(true);
    expect(result.missingDispatchProof).toEqual([]);
  });

  it("blocks current isolated completions written without matching dispatch proof", async () => {
    const root = await createTempProject("delegation-fake-isolated");
    await seedFlowState(root, "run-fake");
    await writeConfig(root, createDefaultConfig(["opencode"]));

    await appendDelegation(root, {
      stage: "scope",
      agent: "planner",
      mode: "mandatory",
      status: "completed",
      spanId: "span-fake",
      dispatchSurface: "opencode-agent",
      fulfillmentMode: "isolated",
      ts: new Date().toISOString()
    });
    await appendDelegation(root, {
      stage: "scope",
      agent: "critic",
      mode: "mandatory",
      status: "completed",
      spanId: "span-critic",
      dispatchId: "dispatch-critic",
      dispatchSurface: "opencode-agent",
      agentDefinitionPath: ".opencode/agents/critic.md",
      ackTs: new Date().toISOString(),
      completedTs: new Date().toISOString(),
      fulfillmentMode: "isolated",
      ts: new Date().toISOString()
    });

    const result = await checkMandatoryDelegations(root, "scope");
    expect(result.satisfied).toBe(false);
    expect(result.missingDispatchProof).toContain("planner");
  });

  it("reports corrupt delegation event lines", async () => {
    const root = await createTempProject("delegation-events-corrupt");
    await seedFlowState(root, "run-corrupt");
    await fs.mkdir(path.join(root, ".cclaw/state"), { recursive: true });
    await fs.writeFile(path.join(root, ".cclaw/state/delegation-events.jsonl"), "{bad-json}\n", "utf8");

    const events = await readDelegationEvents(root);
    expect(events.corruptLines).toEqual([1]);
  });
});
