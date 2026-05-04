import fs from "node:fs/promises";
import path from "node:path";
import { Writable } from "node:stream";
import { describe, expect, it } from "vitest";
import { lintArtifact } from "../../src/artifact-linter.js";
import { delegationRecordScript } from "../../src/content/hooks.js";
import { TDD as TDD_STAGE } from "../../src/content/stages/tdd.js";
import { runInternalCommand } from "../../src/internal/advance-stage.js";
import {
  parseSetCheckpointModeArgs,
  runSetCheckpointMode
} from "../../src/internal/set-checkpoint-mode.js";
import {
  parseSetIntegrationOverseerModeArgs,
  runSetIntegrationOverseerMode
} from "../../src/internal/set-integration-overseer-mode.js";
import {
  parseCohesionContractArgs
} from "../../src/internal/cohesion-contract-stub.js";
import { runWaveStatus } from "../../src/internal/wave-status.js";
import {
  ensureRunSystem,
  readFlowState,
  writeFlowState
} from "../../src/runs.js";
import { createTempProject } from "../helpers/index.js";

interface CapturedIo {
  io: { stdout: Writable; stderr: Writable };
  stdout: () => string;
  stderr: () => string;
}

function captureIo(): CapturedIo {
  const stdoutChunks: string[] = [];
  const stderrChunks: string[] = [];
  const stdout = new Writable({
    write(chunk, _encoding, callback) {
      stdoutChunks.push(chunk.toString());
      callback();
    }
  });
  const stderr = new Writable({
    write(chunk, _encoding, callback) {
      stderrChunks.push(chunk.toString());
      callback();
    }
  });
  return {
    io: { stdout, stderr },
    stdout: () => stdoutChunks.join(""),
    stderr: () => stderrChunks.join("")
  };
}

async function seedTddProject(
  root: string,
  overrides: Record<string, unknown> = {}
): Promise<void> {
  await ensureRunSystem(root);
  const state = await readFlowState(root);
  await writeFlowState(
    root,
    {
      ...state,
      currentStage: "tdd",
      completedStages: ["brainstorm", "scope", "design", "spec", "plan"],
      ...overrides
    },
    { allowReset: true }
  );
}

const PLAN_HEADER = `# Plan Artifact\n\n## Task List\n- T-1\n\n## Dependency Batches\n- Batch 1: T-1\n\n## Acceptance Mapping\n- T-1 → AC-1\n\n## Execution Posture\n- Posture: parallel\n\n## Learnings\n- None this stage.\n\n`;

function planWithWaves(waves: { id: string; members: string[] }[]): string {
  const sections = waves
    .map((wave) => {
      const n = Number.parseInt(wave.id.replace(/^W-/u, ""), 10);
      const members = wave.members.join(", ");
      return `### Wave ${n}\n- Members: ${members}\n`;
    })
    .join("\n");
  return `${PLAN_HEADER}## Parallel Execution Plan\n\n<!-- parallel-exec-managed-start -->\n${sections}\n<!-- parallel-exec-managed-end -->\n`;
}

describe("v6.14.2 Fix 1 — wave-status helper", () => {
  it("reports waves + nextDispatch from the managed plan block", async () => {
    const root = await createTempProject("v6-14-2-wave-status-basic");
    await seedTddProject(root);
    await fs.mkdir(path.join(root, ".cclaw/artifacts"), { recursive: true });
    await fs.writeFile(
      path.join(root, ".cclaw/artifacts/05-plan.md"),
      planWithWaves([
        { id: "W-01", members: ["S-1", "S-2"] },
        { id: "W-02", members: ["S-3"] }
      ]),
      "utf8"
    );
    const report = await runWaveStatus(root);
    expect(report.waves.map((w) => w.waveId)).toEqual(["W-01", "W-02"]);
    expect(report.waves[0]!.members).toEqual(["S-1", "S-2"]);
    expect(report.waves[0]!.status).toBe("open");
    expect(report.nextDispatch.waveId).toBe("W-01");
    expect(report.nextDispatch.readyToDispatch).toEqual(["S-1", "S-2"]);
    expect(report.nextDispatch.mode).toBe("wave-fanout");
  });

  it("treats a slice as closed when phase=refactor-deferred is recorded", async () => {
    const root = await createTempProject("v6-14-2-wave-status-closed");
    await seedTddProject(root);
    await fs.mkdir(path.join(root, ".cclaw/artifacts"), { recursive: true });
    await fs.writeFile(
      path.join(root, ".cclaw/artifacts/05-plan.md"),
      planWithWaves([
        { id: "W-01", members: ["S-1", "S-2"] },
        { id: "W-02", members: ["S-3"] }
      ]),
      "utf8"
    );
    const state = await readFlowState(root);
    const ledgerPath = path.join(root, ".cclaw/state/delegation-log.json");
    await fs.writeFile(
      ledgerPath,
      JSON.stringify(
        {
          runId: state.activeRunId,
          schemaVersion: 3,
          entries: [
            {
              stage: "tdd",
              agent: "slice-implementer",
              mode: "mandatory",
              status: "completed",
              spanId: "span-s1",
              phase: "refactor-deferred",
              sliceId: "S-1",
              ts: "2026-05-01T10:00:00Z",
              completedTs: "2026-05-01T10:00:00Z",
              runId: state.activeRunId,
              evidenceRefs: ["scope contained"]
            }
          ]
        },
        null,
        2
      ),
      "utf8"
    );
    const report = await runWaveStatus(root);
    const wave1 = report.waves.find((w) => w.waveId === "W-01")!;
    expect(wave1.closedMembers).toEqual(["S-1"]);
    expect(wave1.openMembers).toEqual(["S-2"]);
    expect(wave1.status).toBe("partial");
    expect(report.nextDispatch.waveId).toBe("W-01");
    expect(report.nextDispatch.readyToDispatch).toEqual(["S-2"]);
    expect(report.nextDispatch.mode).toBe("single-slice");
  });

  it("warns when 05-plan.md has no managed block AND no wave-plans/ directory", async () => {
    const root = await createTempProject("v6-14-2-wave-status-missing");
    await seedTddProject(root);
    await fs.mkdir(path.join(root, ".cclaw/artifacts"), { recursive: true });
    await fs.writeFile(
      path.join(root, ".cclaw/artifacts/05-plan.md"),
      `# Plan Artifact\n\n(no managed block here)\n`,
      "utf8"
    );
    const report = await runWaveStatus(root);
    expect(report.waves).toHaveLength(0);
    expect(report.nextDispatch.mode).toBe("none");
    expect(report.warnings.join(" ")).toMatch(/wave_plan_managed_block_missing/u);
  });

  it("surfaces tddCutoverSliceId as a HISTORICAL warning in the report", async () => {
    const root = await createTempProject("v6-14-2-wave-status-cutover-warn");
    await seedTddProject(root, { tddCutoverSliceId: "S-17" });
    await fs.mkdir(path.join(root, ".cclaw/artifacts"), { recursive: true });
    await fs.writeFile(
      path.join(root, ".cclaw/artifacts/05-plan.md"),
      planWithWaves([{ id: "W-01", members: ["S-18"] }]),
      "utf8"
    );
    const report = await runWaveStatus(root);
    expect(report.tddCutoverSliceId).toBe("S-17");
    expect(report.warnings.join(" ")).toMatch(
      /tddCutoverSliceId is a historical boundary/u
    );
  });
});

describe("v6.14.2 Fix 1 — skill text mandates wave-status discovery", () => {
  it("checklist row 1 mandates `cclaw-cli internal wave-status --json` as the FIRST tool call", () => {
    const checklistJoined = TDD_STAGE.executionModel.checklist.join("\n");
    expect(checklistJoined).toMatch(
      /Wave dispatch — discovery hardened \(v6\.14\.2\)/u
    );
    expect(checklistJoined).toMatch(/wave-status --json/u);
    expect(checklistJoined).toMatch(/FIRST tool call/u);
  });
});

describe("v6.14.2 Fix 2 — cutover semantics in skill text + advisory linter", () => {
  it("requiredEvidence row clarifies tddCutoverSliceId is HISTORICAL", () => {
    const evidenceJoined = TDD_STAGE.executionModel.requiredEvidence.join("\n");
    expect(evidenceJoined).toMatch(/HISTORICAL boundary/u);
    expect(evidenceJoined).toMatch(/MUST NOT dispatch new work/u);
    expect(evidenceJoined).toMatch(/wave-status --json/u);
  });

  it("emits tdd_cutover_misread_warning advisory when controller dispatches new work for an already-closed cutover slice id", async () => {
    const root = await createTempProject("v6-14-2-cutover-misread");
    await seedTddProject(root, {
      legacyContinuation: true,
      tddCutoverSliceId: "S-17"
    });
    const state = await readFlowState(root);
    await fs.mkdir(path.join(root, ".cclaw/artifacts"), { recursive: true });
    await fs.writeFile(
      path.join(root, ".cclaw/artifacts/06-tdd.md"),
      `# TDD Artifact\n\n## Test Discovery\n- Stub.\n\n## Iron Law Acknowledgement\n- Iron Law: NO PRODUCTION CODE WITHOUT A FAILING TEST FIRST.\n- Acknowledged: yes\n- Exceptions invoked (or \`- None.\`):\n  - None.\n`,
      "utf8"
    );
    const ledgerPath = path.join(root, ".cclaw/state/delegation-log.json");
    await fs.writeFile(
      ledgerPath,
      JSON.stringify(
        {
          runId: state.activeRunId,
          schemaVersion: 3,
          entries: [
            // Prior closure of S-17 under a previous run.
            {
              stage: "tdd",
              agent: "slice-implementer",
              mode: "mandatory",
              status: "completed",
              spanId: "span-s17-prior",
              phase: "refactor-deferred",
              sliceId: "S-17",
              ts: "2026-04-15T10:00:00Z",
              completedTs: "2026-04-15T10:00:00Z",
              runId: "run-prior",
              evidenceRefs: ["scope contained"]
            },
            // Active run dispatches new work for S-17 — misread.
            {
              stage: "tdd",
              agent: "test-author",
              mode: "mandatory",
              status: "scheduled",
              spanId: "span-s17-fresh",
              phase: "red",
              sliceId: "S-17",
              ts: "2026-05-04T10:00:00Z",
              runId: state.activeRunId
            }
          ]
        },
        null,
        2
      ),
      "utf8"
    );

    const result = await lintArtifact(root, "tdd");
    const finding = result.findings.find(
      (f) => f.section === "tdd_cutover_misread_warning"
    );
    expect(finding).toBeDefined();
    expect(finding?.required).toBe(false);
    expect(finding?.found).toBe(false);
    expect(finding?.details ?? "").toMatch(/wave-status/iu);
  });
});

describe("v6.14.2 Fix 3 — set-checkpoint-mode + set-integration-overseer-mode", () => {
  it("parseSetCheckpointModeArgs accepts the positional + --reason form", () => {
    const parsed = parseSetCheckpointModeArgs([
      "per-slice",
      "--reason=migrating to stream mode"
    ]);
    expect(parsed).toEqual({
      mode: "per-slice",
      reason: "migrating to stream mode"
    });
  });

  it("parseSetCheckpointModeArgs rejects unknown values", () => {
    expect(parseSetCheckpointModeArgs(["nonsense"])).toBeNull();
    expect(parseSetCheckpointModeArgs(["--mode=mixed"])).toBeNull();
  });

  it("runSetCheckpointMode writes flow-state.json::tddCheckpointMode and refreshes the sidecar", async () => {
    const root = await createTempProject("v6-14-2-set-checkpoint-mode");
    await seedTddProject(root);
    const cap = captureIo();
    const code = await runSetCheckpointMode(
      root,
      ["per-slice", "--reason=migration to v6.14.2"],
      cap.io
    );
    expect(code).toBe(0);
    const state = await readFlowState(root);
    expect(state.tddCheckpointMode).toBe("per-slice");
    const sidecar = JSON.parse(
      await fs.readFile(
        path.join(root, ".cclaw/.flow-state.guard.json"),
        "utf8"
      )
    );
    expect(typeof sidecar.sha256).toBe("string");
    expect(sidecar.sha256.length).toBeGreaterThan(20);
    expect(sidecar.writerSubsystem).toMatch(/set-checkpoint-mode/u);
  });

  it("parseSetIntegrationOverseerModeArgs accepts conditional|always", () => {
    expect(parseSetIntegrationOverseerModeArgs(["conditional"])).toEqual({
      mode: "conditional",
      reason: null
    });
    expect(
      parseSetIntegrationOverseerModeArgs(["--mode=always", "--reason=manual"])
    ).toEqual({ mode: "always", reason: "manual" });
  });

  it("runSetIntegrationOverseerMode writes flow-state.json::integrationOverseerMode", async () => {
    const root = await createTempProject("v6-14-2-set-integration-overseer-mode");
    await seedTddProject(root);
    const cap = captureIo();
    const code = await runSetIntegrationOverseerMode(
      root,
      ["conditional", "--reason=disjoint paths in this run"],
      cap.io
    );
    expect(code).toBe(0);
    const state = await readFlowState(root);
    expect(state.integrationOverseerMode).toBe("conditional");
  });

  it("internal subcommand surface lists wave-status, cohesion-contract, set-checkpoint-mode, set-integration-overseer-mode", async () => {
    const cap = captureIo();
    const code = await runInternalCommand("/nonexistent", [], cap.io);
    expect(code).toBe(1);
    const usage = cap.stderr();
    expect(usage).toMatch(/wave-status/u);
    expect(usage).toMatch(/cohesion-contract/u);
    expect(usage).toMatch(/set-checkpoint-mode/u);
    expect(usage).toMatch(/set-integration-overseer-mode/u);
  });
});

describe("v6.14.2 Fix 3 — cohesion-contract --stub writer", () => {
  it("parseCohesionContractArgs requires --stub", () => {
    expect(parseCohesionContractArgs([])).toBeNull();
    expect(parseCohesionContractArgs(["--stub"])).toEqual({
      stub: true,
      force: false,
      reason: null
    });
    expect(
      parseCohesionContractArgs(["--stub", "--reason=legacy hox-shape"])
    ).toEqual({ stub: true, force: false, reason: "legacy hox-shape" });
  });

  it("writes cohesion-contract.{md,json} stubs that satisfy the tdd.cohesion_contract_missing linter", async () => {
    const root = await createTempProject("v6-14-2-cohesion-contract-stub");
    await seedTddProject(root, { legacyContinuation: true });
    await fs.mkdir(path.join(root, ".cclaw/artifacts"), { recursive: true });

    const cap = captureIo();
    const code = await runInternalCommand(
      root,
      ["cohesion-contract", "--stub", "--reason=legacy"],
      cap.io
    );
    expect(code).toBe(0);
    const md = await fs.readFile(
      path.join(root, ".cclaw/artifacts/cohesion-contract.md"),
      "utf8"
    );
    const json = JSON.parse(
      await fs.readFile(
        path.join(root, ".cclaw/artifacts/cohesion-contract.json"),
        "utf8"
      )
    );
    expect(md).toMatch(/Advisory stub/u);
    expect(md).toMatch(/advisory_legacy/u);
    expect(json.status.verdict).toBe("advisory_legacy");
  });

  it("refuses to overwrite existing cohesion-contract files unless --force is passed", async () => {
    const root = await createTempProject("v6-14-2-cohesion-contract-noforce");
    await seedTddProject(root, { legacyContinuation: true });
    await fs.mkdir(path.join(root, ".cclaw/artifacts"), { recursive: true });
    await fs.writeFile(
      path.join(root, ".cclaw/artifacts/cohesion-contract.md"),
      "# real contract\n",
      "utf8"
    );

    const cap = captureIo();
    const code = await runInternalCommand(
      root,
      ["cohesion-contract", "--stub"],
      cap.io
    );
    expect(code).toBe(1);
    expect(cap.stderr()).toMatch(/--force/u);

    const cap2 = captureIo();
    const code2 = await runInternalCommand(
      root,
      ["cohesion-contract", "--stub", "--force"],
      cap2.io
    );
    expect(code2).toBe(0);
    const md = await fs.readFile(
      path.join(root, ".cclaw/artifacts/cohesion-contract.md"),
      "utf8"
    );
    expect(md).toMatch(/Advisory stub/u);
  });
});

async function setupHookWithRedRow(
  root: string,
  options: {
    sliceId: string;
    redEvidence: string;
    flowStateOverrides?: Record<string, unknown>;
  }
): Promise<{ hookPath: string; agentDef: string; runId: string }> {
  await ensureRunSystem(root);
  const initial = await readFlowState(root);
  await writeFlowState(
    root,
    {
      ...initial,
      currentStage: "tdd",
      completedStages: ["brainstorm", "scope", "design", "spec", "plan"],
      ...(options.flowStateOverrides ?? {})
    },
    { allowReset: true }
  );
  const state = await readFlowState(root);
  const hookPath = path.join(root, ".cclaw/hooks/delegation-record.mjs");
  await fs.mkdir(path.dirname(hookPath), { recursive: true });
  await fs.writeFile(hookPath, delegationRecordScript(), "utf8");
  const agentDef = ".cclaw/agents/slice-implementer.md";
  await fs.mkdir(path.join(root, ".cclaw/agents"), { recursive: true });
  await fs.writeFile(
    path.join(root, agentDef),
    "# slice-implementer\n",
    "utf8"
  );
  await fs.writeFile(
    path.join(root, ".cclaw/state/delegation-events.jsonl"),
    JSON.stringify({
      runId: state.activeRunId,
      stage: "tdd",
      agent: "test-author",
      sliceId: options.sliceId,
      spanId: `span-red-${options.sliceId}`,
      phase: "red",
      status: "completed",
      event: "completed",
      ts: "2026-05-04T10:00:00Z",
      eventTs: "2026-05-04T10:00:00Z",
      completedTs: "2026-05-04T10:00:00Z",
      evidenceRefs: [options.redEvidence]
    }) + "\n",
    "utf8"
  );
  return { hookPath, agentDef, runId: state.activeRunId };
}

function commonGreenArgs(opts: {
  sliceId: string;
  spanId: string;
  ackTs: string;
  completedTs: string;
  evidenceRef: string;
  agentDef: string;
}): string[] {
  return [
    "--stage=tdd",
    "--agent=slice-implementer",
    "--mode=mandatory",
    "--status=completed",
    "--phase=green",
    `--slice=${opts.sliceId}`,
    `--span-id=${opts.spanId}`,
    `--dispatch-id=${opts.spanId}-d`,
    "--dispatch-surface=claude-task",
    `--agent-definition-path=${opts.agentDef}`,
    `--ack-ts=${opts.ackTs}`,
    `--completed-ts=${opts.completedTs}`,
    `--evidence-ref=${opts.evidenceRef}`,
    "--json"
  ];
}

describe("v6.14.2 Fix 4 — GREEN evidence freshness contract", () => {
  it("rejects --status=completed --phase=green when evidenceRefs[0] does not match the RED test stem", async () => {
    const root = await createTempProject("v6-14-2-green-mismatch");
    const { hookPath, agentDef } = await setupHookWithRedRow(root, {
      sliceId: "S-1",
      redEvidence: "tests/unit/dedupe.test.ts"
    });
    const { spawnSync } = await import("node:child_process");
    const result = spawnSync(
      "node",
      [
        hookPath,
        ...commonGreenArgs({
          sliceId: "S-1",
          spanId: "span-green-S-1",
          ackTs: "2026-05-04T10:00:01Z",
          completedTs: "2026-05-05T10:00:00Z",
          evidenceRef:
            "tests/unit/different-test.test.ts: => 1 passed; 0 failed",
          agentDef
        })
      ],
      { env: { ...process.env, CCLAW_PROJECT_ROOT: root } }
    );
    expect(result.status, result.stderr.toString() + result.stdout.toString()).toBe(2);
    const parsed = JSON.parse(result.stdout.toString());
    expect(parsed.error).toBe("green_evidence_red_test_mismatch");
  });

  it("rejects --status=completed --phase=green when evidenceRefs[0] is missing a passing-runner line", async () => {
    const root = await createTempProject("v6-14-2-green-no-runner-line");
    const { hookPath, agentDef } = await setupHookWithRedRow(root, {
      sliceId: "S-2",
      redEvidence: "tests/unit/auth.test.ts"
    });
    const { spawnSync } = await import("node:child_process");
    const result = spawnSync(
      "node",
      [
        hookPath,
        ...commonGreenArgs({
          sliceId: "S-2",
          spanId: "span-green-S-2",
          ackTs: "2026-05-04T10:00:01Z",
          completedTs: "2026-05-05T10:00:00Z",
          evidenceRef: "tests/unit/auth.test.ts (no runner output captured)",
          agentDef
        })
      ],
      { env: { ...process.env, CCLAW_PROJECT_ROOT: root } }
    );
    expect(result.status, result.stderr.toString() + result.stdout.toString()).toBe(2);
    const parsed = JSON.parse(result.stdout.toString());
    expect(parsed.error).toBe("green_evidence_passing_assertion_missing");
  });

  it("rejects --status=completed --phase=green when completedTs - ackTs is below tddGreenMinElapsedMs", async () => {
    const root = await createTempProject("v6-14-2-green-too-fresh");
    const { hookPath, agentDef } = await setupHookWithRedRow(root, {
      sliceId: "S-3",
      redEvidence: "tests/unit/billing.test.ts",
      flowStateOverrides: { tddGreenMinElapsedMs: 5000 }
    });
    const { spawnSync } = await import("node:child_process");
    const result = spawnSync(
      "node",
      [
        hookPath,
        ...commonGreenArgs({
          sliceId: "S-3",
          spanId: "span-green-S-3",
          ackTs: "2026-05-04T10:00:00.000Z",
          completedTs: "2026-05-04T10:00:00.500Z",
          evidenceRef:
            "tests/unit/billing.test.ts: vitest run => 1 passed; 0 failed",
          agentDef
        })
      ],
      { env: { ...process.env, CCLAW_PROJECT_ROOT: root } }
    );
    expect(result.status, result.stderr.toString() + result.stdout.toString()).toBe(2);
    const parsed = JSON.parse(result.stdout.toString());
    expect(parsed.error).toBe("green_evidence_too_fresh");
  });

  it("accepts --allow-fast-green --green-mode=observational as the escape clause", async () => {
    const root = await createTempProject("v6-14-2-green-observational-escape");
    const { hookPath, agentDef } = await setupHookWithRedRow(root, {
      sliceId: "S-4",
      redEvidence: "tests/unit/observability.test.ts",
      flowStateOverrides: { tddGreenMinElapsedMs: 5000 }
    });
    const { spawnSync } = await import("node:child_process");
    const result = spawnSync(
      "node",
      [
        hookPath,
        ...commonGreenArgs({
          sliceId: "S-4",
          spanId: "span-green-S-4",
          ackTs: "2026-05-04T10:00:00.000Z",
          completedTs: "2026-05-04T10:00:00.001Z",
          evidenceRef:
            "cross-slice handoff; observation only — no test re-run",
          agentDef
        }),
        "--allow-fast-green",
        "--green-mode=observational"
      ],
      { env: { ...process.env, CCLAW_PROJECT_ROOT: root } }
    );
    expect(result.status, result.stderr.toString() + result.stdout.toString()).toBe(0);
  });
});

describe("v6.14.2 Fix 4 — slice-implementer skill text documents the freshness contract", () => {
  it("agent markdown for slice-implementer references the green_evidence_* reject codes and escape clause", async () => {
    const { CCLAW_AGENTS, agentMarkdown } = await import(
      "../../src/content/core-agents.js"
    );
    const def = CCLAW_AGENTS.find((a) => a.name === "slice-implementer");
    expect(def).toBeDefined();
    const md = agentMarkdown(def!);
    expect(md).toMatch(/green_evidence_red_test_mismatch/u);
    expect(md).toMatch(/green_evidence_passing_assertion_missing/u);
    expect(md).toMatch(/green_evidence_too_fresh/u);
    expect(md).toMatch(/--allow-fast-green/u);
    expect(md).toMatch(/--green-mode=observational/u);
  });
});
