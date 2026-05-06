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

const RUN_ID = "run-tdd-e2e";

async function seedTddRun(root: string): Promise<void> {
  await ensureRunSystem(root);
  const state = createInitialFlowState({
    activeRunId: RUN_ID,
    track: "standard",
    discoveryMode: "guided"
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
- E2E auto-derive coverage.

## Problem Decision Record
- Problem: prove events drive the linter.
- Why now: feature gating.

## Approach Tier
- Tier: standard

## Selected Direction
- Direction: ship.

## Learnings
- None this stage.
`,
  "04-spec.md": `# Spec Artifact

## Acceptance Criteria
- AC-1: 3 slices recorded via phase events.

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
- T-1: implement events-driven slice derivation.

## Dependency Batches
- Batch 1: T-1.

## Acceptance Mapping
- T-1 traces to AC-1.

## Execution Posture
- Posture: sequential.

## Learnings
- None this stage.
`
};

const TDD_BARE_BODY = `# TDD Artifact

## Upstream Handoff
- Source artifacts: \`05-plan.md\`, \`04-spec.md\`.
- Decisions carried forward: dispatch slice-builder per slice.
- Constraints carried forward: minimal change.
- Open questions: none.
- Drift from upstream (or \`None\`): None.

## Test Discovery
- Overall narrative: tests/e2e/tdd-auto-derive.test.ts exercises the events-driven path.

## System-Wide Impact Check
| Slice | Callbacks/state/interfaces/contracts affected | Coverage decision |
|---|---|---|
| S-1 | linter slice cycle | covered by phase events |

## RED Evidence
- Auto-derived from \`delegation-events.jsonl\` phase=red rows.

## Acceptance & Failure Map
| Slice | Source ID | AC ID | Expected behavior | RED-link |
|---|---|---|---|---|
| S-1 | T-1 | AC-1 | Linter accepts events | spanId:span-red-S-1 |

## GREEN Evidence
- Auto-derived from \`delegation-events.jsonl\` phase=green rows.

## REFACTOR Notes
- What changed: linter reads events.
- Why: provable RED/GREEN.
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
| S-1 | command | npm test -- tdd-auto-derive — PASS |

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
  refactorRationale?: string;
  spanId: string;
}

function lifecycleArgs(
  status: string,
  agentDef: string,
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
    `--agent-definition-path=${agentDef}`,
    `--slice=${opts.slice}`,
    "--json"
  ];
  // 7.6.0 contract: --phase is only valid on terminal statuses
  // (`completed` or `failed`). Dispatch-lifecycle rows
  // (scheduled/launched/acknowledged) carry the slice id but no phase.
  if (status === "completed" || status === "failed") {
    base.push(`--phase=${opts.phase}`);
  }
  for (const ref of opts.evidenceRefs) {
    base.push(`--evidence-ref=${ref}`);
  }
  if (opts.refactorRationale !== undefined) {
    base.push(`--refactor-rationale=${opts.refactorRationale}`);
  }
  return [...base, ...extra];
}

async function dispatchPhase(
  root: string,
  scriptPath: string,
  agentDef: string,
  opts: PhaseDispatchOpts
): Promise<void> {
  const sched = await runScript(
    root,
    scriptPath,
    lifecycleArgs("scheduled", agentDef, opts)
  );
  expect(sched.code, `scheduled ${opts.slice}/${opts.phase}: ${sched.stderr}`).toBe(0);

  const launched = await runScript(
    root,
    scriptPath,
    lifecycleArgs("launched", agentDef, opts)
  );
  expect(launched.code, `launched ${opts.slice}/${opts.phase}: ${launched.stderr}`).toBe(0);

  const acked = await runScript(
    root,
    scriptPath,
    lifecycleArgs("acknowledged", agentDef, opts, [
      `--ack-ts=${new Date().toISOString()}`
    ])
  );
  expect(acked.code, `acknowledged ${opts.slice}/${opts.phase}: ${acked.stderr}`).toBe(0);

  const completed = await runScript(
    root,
    scriptPath,
    lifecycleArgs("completed", agentDef, opts, [
      "--fulfillment-mode=isolated"
    ])
  );
  expect(completed.code, `completed ${opts.slice}/${opts.phase}: ${completed.stderr}`).toBe(0);
}

describe("e2e: TDD auto-derive (Phase D)", () => {
  it("records 3 slices via delegation-record --slice/--phase and lints clean without filling markdown tables", { timeout: 30_000 }, async () => {
    const root = await createTempProject("e2e-tdd-auto-derive");
    const scriptPath = await setupHook(root);
    await seedTddRun(root);
    await writeArtifacts(root);
    const sbDef = await seedAgentDef(root, "slice-builder");

    for (let i = 1; i <= 3; i += 1) {
      const slice = `S-${i}`;
      const spanId = `span-${slice}`;
      const testFile = path.join(root, "tests/unit", `slice-${i}.test.ts`);
      await fs.mkdir(path.dirname(testFile), { recursive: true });
      await fs.writeFile(testFile, "// test\n", "utf8");
      await dispatchPhase(root, scriptPath, sbDef, {
        agent: "slice-builder",
        slice,
        phase: "red",
        evidenceRefs: [`tests/unit/slice-${i}.test.ts`],
        spanId
      });
      await dispatchPhase(root, scriptPath, sbDef, {
        agent: "slice-builder",
        slice,
        phase: "green",
        evidenceRefs: [`tests/unit/slice-${i}.test.ts: vitest run tests/unit/slice-${i}.test.ts => 1 passed; 0 failed`],
        spanId
      });
      await dispatchPhase(root, scriptPath, sbDef, {
        agent: "slice-builder",
        slice,
        phase: "refactor-deferred",
        evidenceRefs: [`scope contained for ${slice}; no measurable cleanup yet`],
        refactorRationale:
          `Deferred cleanup for ${slice} / T-10${i} because this pass is constrained to green assertions first; structural cleanup is queued for the next refactor slice.`,
        spanId
      });
    }

    // Ledger shape sanity check.
    const ledger = JSON.parse(
      await fs.readFile(
        path.join(root, ".cclaw/state/delegation-log.json"),
        "utf8"
      )
    ) as {
      entries: Array<{
        sliceId?: string;
        phase?: string;
        evidenceRefs?: string[];
      }>;
    };
    const phaseRows = ledger.entries.filter(
      (e) => typeof e.sliceId === "string" && typeof e.phase === "string"
    );
    expect(phaseRows.length).toBeGreaterThanOrEqual(9);

    const result = await lintArtifact(root, "tdd");
    const blockers = result.findings
      .filter((f) => f.required && !f.found)
      .filter((f) => !f.section.startsWith("tdd.cohesion_contract"))
      .filter((f) => !f.section.startsWith("tdd.integration_overseer"))
      // slice-builder DOC coverage is exercised in dedicated suites; this
      // e2e covers RED/GREEN/REFACTOR auto-derive only.
      .filter((f) => f.section !== "tdd_slice_doc_missing");
    expect(blockers.map((f) => f.section)).toEqual([]);

    const tddArtifact = await fs.readFile(
      path.join(root, ".cclaw/artifacts/06-tdd.md"),
      "utf8"
    );
    expect(tddArtifact).toContain("## Vertical Slice Cycle");
    expect(tddArtifact).toContain("| S-1 |");
    expect(tddArtifact).toContain("| S-2 |");
    expect(tddArtifact).toContain("| S-3 |");
  });
});

// Sharded `tdd-slices/S-<id>.md` files coverage lives in
// `tests/e2e/sharded-slice-files.test.ts`.
