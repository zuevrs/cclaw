import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { delegationRecordScript } from "../../src/content/hooks.js";
import { ensureRunSystem } from "../../src/runs.js";
import { lintArtifact } from "../../src/artifact-linter.js";
import { createInitialFlowState } from "../../src/flow-state.js";
import { writeFlowState } from "../../src/run-persistence.js";
import { createTempProject } from "../helpers/index.js";

/**
 * v6.11.0 Phase C — slice-documenter is dispatched IN PARALLEL with
 * slice-implementer for the same slice. Because the documenter only
 * touches `<artifacts-dir>/tdd-slices/S-<id>.md` and the implementer
 * touches production code, the file-overlap scheduler auto-allows the
 * parallel dispatch (no `--allow-parallel` flag required, no overlap
 * conflict, no fan-out cap violation).
 *
 * These e2e tests drive the generated `delegation-record.mjs` hook to
 * confirm:
 *
 * 1. Parallel `scheduled → launched → acknowledged → completed` for both
 *    spans land in `delegation-events.jsonl` and the ledger.
 * 2. The linter accepts the artifact: `phase=green` + `phase=doc` rows
 *    on the same slice satisfy slice-documenter coverage on
 *    `discoveryMode=deep` without any `--allow-parallel` flag.
 * 3. `--phase=refactor-deferred` requires either `--refactor-rationale`
 *    or `--evidence-ref` carrying rationale text. Missing both blocks
 *    the dispatch.
 */

interface RunResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

async function setupHook(projectRoot: string): Promise<string> {
  await ensureRunSystem(projectRoot);
  const scriptPath = path.join(projectRoot, ".cclaw/hooks/delegation-record.mjs");
  await fs.mkdir(path.dirname(scriptPath), { recursive: true });
  await fs.writeFile(scriptPath, delegationRecordScript(), "utf8");
  return scriptPath;
}

function runScript(
  projectRoot: string,
  scriptPath: string,
  args: string[]
): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [scriptPath, ...args], {
      cwd: projectRoot,
      env: { ...process.env, CCLAW_PROJECT_ROOT: projectRoot }
    });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr?.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

const RUN_ID = "run-tdd-slice-documenter";

async function seedTddRun(
  root: string,
  options: { discoveryMode?: "lean" | "guided" | "deep" } = {}
): Promise<void> {
  await ensureRunSystem(root);
  const state = createInitialFlowState({
    activeRunId: RUN_ID,
    track: "standard",
    discoveryMode: options.discoveryMode ?? "deep"
  });
  state.currentStage = "tdd";
  state.completedStages = ["brainstorm", "scope", "design", "spec", "plan"];
  state.tddGreenMinElapsedMs = 0;
  await writeFlowState(root, state, { allowReset: true });
}

const PRE_TDD_ARTIFACTS: Record<string, string> = {
  "01-brainstorm.md": `# Brainstorm Artifact

## Q&A Log
| Turn | Question | User answer (1-line) | Decision impact |
|---|---|---|---|
| 1 | (stop-signal) | "достаточно, давай драфт" | stop-and-draft |

## Context
- E2E parallel slice-documenter coverage.

## Problem Decision Record
- Problem: prove documenter dispatches in parallel with implementer.
- Why now: v6.11.0 release.

## Approach Tier
- Tier: standard

## Selected Direction
- Direction: ship.

## Learnings
- None this stage.
`,
  "04-spec.md": `# Spec Artifact

## Acceptance Criteria
- AC-1: parallel slice-documenter coverage.

## Edge Cases
- None.

## Acceptance Mapping
- AC-1 traces to delegation-events.jsonl.

## Approval
- Approved: yes.

## Learnings
- None this stage.
`,
  "05-plan.md": `# Plan Artifact

## Task List
- T-1: dispatch slice-documenter in parallel with slice-implementer.

## Dependency Batches
- Batch 1: T-1.

## Acceptance Mapping
- T-1 traces to AC-1.

## Execution Posture
- Posture: parallel.

## Learnings
- None this stage.
`
};

const TDD_BARE_BODY = `# TDD Artifact

## Upstream Handoff
- Source artifacts: \`05-plan.md\`, \`04-spec.md\`.
- Decisions carried forward: dispatch slice-implementer + slice-documenter in parallel.
- Constraints carried forward: minimal change.
- Open questions: none.
- Drift from upstream (or \`None\`): None.

## Test Discovery
- Overall narrative: tests/e2e/slice-documenter-parallel.test.ts exercises the parallel dispatch.

## System-Wide Impact Check
| Slice | Callbacks/state/interfaces/contracts affected | Coverage decision |
|---|---|---|
| S-1 | linter slice cycle | covered by phase events |

## RED Evidence
- Auto-derived from \`delegation-events.jsonl\` phase=red rows.

## Acceptance & Failure Map
| Slice | Source ID | AC ID | Expected behavior | RED-link |
|---|---|---|---|---|
| S-1 | T-1 | AC-1 | parallel dispatch succeeds | spanId:span-red-S-1 |

## GREEN Evidence
- Auto-derived from \`delegation-events.jsonl\` phase=green rows.

## REFACTOR Notes
- What changed: linter reads events.
- Why: provable RED/GREEN/DOC.
- Behavior preserved: yes.

## Traceability
- Plan task IDs: T-1
- Spec criterion IDs: AC-1

## Iron Law Acknowledgement
- Iron Law: NO PRODUCTION CODE WITHOUT A FAILING TEST FIRST.
- Acknowledged: yes — code that landed before its test will be deleted and rewritten from the test.
- Exceptions invoked (or \`- None.\`):
  - None.

<!-- auto-start: tdd-slice-summary -->
<!-- auto-end: tdd-slice-summary -->

## Verification Ladder
| Slice | Tier reached | Evidence |
|---|---|---|
| S-1 | command | npm test -- slice-documenter-parallel — PASS |

## Learnings
- None this stage.
`;

async function writeArtifacts(root: string): Promise<void> {
  await fs.mkdir(path.join(root, ".cclaw/artifacts"), { recursive: true });
  for (const [name, body] of Object.entries(PRE_TDD_ARTIFACTS)) {
    await fs.writeFile(path.join(root, ".cclaw/artifacts", name), body, "utf8");
  }
  await fs.writeFile(
    path.join(root, ".cclaw/artifacts/06-tdd.md"),
    TDD_BARE_BODY,
    "utf8"
  );
}

async function seedAgentDef(root: string, agent: string): Promise<string> {
  const rel = `.cclaw/agents/${agent}.md`;
  await fs.mkdir(path.join(root, ".cclaw/agents"), { recursive: true });
  await fs.writeFile(path.join(root, rel), `# ${agent}\n`, "utf8");
  return rel;
}

interface PhaseDispatchOpts {
  agent: string;
  slice: string;
  phase: "red" | "green" | "refactor" | "refactor-deferred" | "doc";
  evidenceRefs: string[];
  paths?: string;
  refactorRationale?: string;
  spanId: string;
  agentDef: string;
}

function lifecycleArgs(
  status: string,
  opts: PhaseDispatchOpts,
  extra: string[] = []
): string[] {
  const base = [
    "--stage=tdd",
    `--agent=${opts.agent}`,
    "--mode=proactive",
    `--status=${status}`,
    `--span-id=${opts.spanId}`,
    `--dispatch-id=${opts.spanId}-d`,
    "--dispatch-surface=cursor-task",
    `--agent-definition-path=${opts.agentDef}`,
    `--slice=${opts.slice}`,
    `--phase=${opts.phase}`,
    "--json"
  ];
  for (const ref of opts.evidenceRefs) {
    base.push(`--evidence-ref=${ref}`);
  }
  if (opts.paths !== undefined) {
    base.push(`--paths=${opts.paths}`);
  }
  if (opts.refactorRationale !== undefined) {
    base.push(`--refactor-rationale=${opts.refactorRationale}`);
  }
  return [...base, ...extra];
}

async function dispatchPhase(
  root: string,
  scriptPath: string,
  opts: PhaseDispatchOpts
): Promise<void> {
  const sched = await runScript(root, scriptPath, lifecycleArgs("scheduled", opts));
  expect(sched.code, `scheduled ${opts.slice}/${opts.phase}: ${sched.stderr}`).toBe(0);

  const launched = await runScript(root, scriptPath, lifecycleArgs("launched", opts));
  expect(launched.code, `launched ${opts.slice}/${opts.phase}: ${launched.stderr}`).toBe(0);

  const acked = await runScript(
    root,
    scriptPath,
    lifecycleArgs("acknowledged", opts, [`--ack-ts=${new Date().toISOString()}`])
  );
  expect(acked.code, `acknowledged ${opts.slice}/${opts.phase}: ${acked.stderr}`).toBe(0);

  const completed = await runScript(
    root,
    scriptPath,
    lifecycleArgs("completed", opts, ["--fulfillment-mode=isolated"])
  );
  expect(completed.code, `completed ${opts.slice}/${opts.phase}: ${completed.stderr}`).toBe(0);
}

describe("e2e: slice-documenter parallel dispatch (Phase C)", () => {
  it("records full lifecycle for parallel slice-implementer + slice-documenter without --allow-parallel and lints clean", async () => {
    const root = await createTempProject("e2e-slice-documenter-parallel-full");
    const scriptPath = await setupHook(root);
    await seedTddRun(root, { discoveryMode: "deep" });
    await writeArtifacts(root);
    const taDef = await seedAgentDef(root, "test-author");
    const siDef = await seedAgentDef(root, "slice-implementer");
    const sdDef = await seedAgentDef(root, "slice-documenter");

    await fs.mkdir(path.join(root, ".cclaw/artifacts/tdd-slices"), { recursive: true });
    const sliceFile = `# Slice S-1

## Plan unit
T-1

## Acceptance criteria
AC-1

## Why this slice
Cover slice 1.

## What was tested
phase=red event for S-1.

## What was implemented
slice 1 body.

## REFACTOR notes
- None.

## Learnings
- None this slice.
`;
    await fs.writeFile(
      path.join(root, ".cclaw/artifacts/tdd-slices/S-1.md"),
      sliceFile,
      "utf8"
    );

    await dispatchPhase(root, scriptPath, {
      agent: "test-author",
      slice: "S-1",
      phase: "red",
      evidenceRefs: ["tests/unit/slice-1.test.ts"],
      spanId: "span-red-S-1",
      agentDef: taDef
    });

    // PARALLEL: slice-implementer (production code) + slice-documenter
    // (artifact-only) for the same slice S-1. Disjoint claimedPaths must
    // auto-promote the new scheduled rows to allowParallel without the
    // operator passing --allow-parallel.
    const siArgs = lifecycleArgs("scheduled", {
      agent: "slice-implementer",
      slice: "S-1",
      phase: "green",
      evidenceRefs: ["tests/unit/slice-1.test.ts"],
      paths: "src/feature/foo.ts",
      spanId: "span-impl-S-1",
      agentDef: siDef
    });
    const sched1 = await runScript(root, scriptPath, siArgs);
    expect(sched1.code, `slice-implementer schedule: ${sched1.stderr}`).toBe(0);

    const sdArgs = lifecycleArgs("scheduled", {
      agent: "slice-documenter",
      slice: "S-1",
      phase: "doc",
      evidenceRefs: [".cclaw/artifacts/tdd-slices/S-1.md"],
      paths: ".cclaw/artifacts/tdd-slices/S-1.md",
      spanId: "span-doc-S-1",
      agentDef: sdDef
    });
    const sched2 = await runScript(root, scriptPath, sdArgs);
    expect(sched2.code, `slice-documenter schedule: ${sched2.stderr}`).toBe(0);

    // Drive both spans through the rest of the lifecycle.
    for (const [agent, spanId, agentDef, paths, phase] of [
      ["slice-implementer", "span-impl-S-1", siDef, "src/feature/foo.ts", "green" as const],
      ["slice-documenter", "span-doc-S-1", sdDef, ".cclaw/artifacts/tdd-slices/S-1.md", "doc" as const]
    ] as const) {
      for (const status of ["launched", "acknowledged", "completed"]) {
        const evidenceRef =
          phase === "doc"
            ? ".cclaw/artifacts/tdd-slices/S-1.md"
            : "tests/unit/slice-1.test.ts: vitest run tests/unit/slice-1.test.ts => 1 passed; 0 failed";
        const baseArgs = [
          "--stage=tdd",
          `--agent=${agent}`,
          "--mode=proactive",
          `--status=${status}`,
          `--span-id=${spanId}`,
          `--dispatch-id=${spanId}-d`,
          "--dispatch-surface=cursor-task",
          `--agent-definition-path=${agentDef}`,
          `--slice=S-1`,
          `--phase=${phase}`,
          `--paths=${paths}`,
          `--evidence-ref=${evidenceRef}`,
          "--json"
        ];
        if (status === "acknowledged") {
          baseArgs.push(`--ack-ts=${new Date().toISOString()}`);
        }
        const r = await runScript(root, scriptPath, baseArgs);
        expect(r.code, `${agent} ${status}: ${r.stderr}`).toBe(0);
      }
    }

    await dispatchPhase(root, scriptPath, {
      agent: "slice-implementer",
      slice: "S-1",
      phase: "refactor-deferred",
      evidenceRefs: ["scope contained — no measurable cleanup yet"],
      paths: "src/feature/foo.ts",
      refactorRationale: "scope contained, no cleanup needed yet",
      spanId: "span-refactor-S-1",
      agentDef: siDef
    });

    const ledger = JSON.parse(
      await fs.readFile(path.join(root, ".cclaw/state/delegation-log.json"), "utf8")
    ) as {
      entries: Array<{
        spanId: string;
        agent: string;
        status: string;
        phase?: string;
        sliceId?: string;
        allowParallel?: boolean;
      }>;
    };
    const impl = ledger.entries.filter((e) => e.spanId === "span-impl-S-1");
    const doc = ledger.entries.filter((e) => e.spanId === "span-doc-S-1");
    expect(impl.length).toBeGreaterThanOrEqual(4);
    expect(doc.length).toBeGreaterThanOrEqual(4);
    expect(impl.some((e) => e.status === "completed" && e.phase === "green")).toBe(true);
    expect(doc.some((e) => e.status === "completed" && e.phase === "doc")).toBe(true);
    expect(impl.find((e) => e.status === "scheduled")?.allowParallel).toBe(true);

    const result = await lintArtifact(root, "tdd");
    const blockers = result.findings
      .filter((f) => f.required && !f.found)
      .filter((f) => !f.section.startsWith("tdd.cohesion_contract"))
      .filter((f) => !f.section.startsWith("tdd.integration_overseer"));
    expect(blockers.map((f) => f.section)).toEqual([]);

    // delegation-events.jsonl carries the lifecycle rows for both spans.
    const eventsRaw = await fs.readFile(
      path.join(root, ".cclaw/state/delegation-events.jsonl"),
      "utf8"
    );
    const eventLines = eventsRaw.split(/\r?\n/u).filter((line) => line.length > 0);
    const events = eventLines.map((line) => JSON.parse(line) as Record<string, unknown>);
    const implEvents = events.filter((e) => e.spanId === "span-impl-S-1");
    const docEvents = events.filter((e) => e.spanId === "span-doc-S-1");
    expect(implEvents.length).toBeGreaterThanOrEqual(4);
    expect(docEvents.length).toBeGreaterThanOrEqual(4);
  });

  it("rejects --phase=refactor-deferred without rationale or evidence-ref", async () => {
    const root = await createTempProject("e2e-refactor-deferred-validation");
    const scriptPath = await setupHook(root);
    await seedTddRun(root);
    await seedAgentDef(root, "test-author");

    const args = [
      "--stage=tdd",
      "--agent=test-author",
      "--mode=mandatory",
      "--status=scheduled",
      "--span-id=span-deferred-bad",
      "--dispatch-id=span-deferred-bad-d",
      "--dispatch-surface=cursor-task",
      "--agent-definition-path=.cclaw/agents/test-author.md",
      "--slice=S-1",
      "--phase=refactor-deferred",
      "--json"
    ];
    const r = await runScript(root, scriptPath, args);
    expect(r.code, "expected non-zero exit for refactor-deferred without rationale").not.toBe(0);
    const out = `${r.stdout}${r.stderr}`;
    expect(out.toLowerCase()).toContain("refactor");
  });
});
