import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { lintArtifact } from "../../src/artifact-linter.js";
import { appendDelegation } from "../../src/delegation.js";
import { createInitialFlowState } from "../../src/flow-state.js";
import { createTempProject } from "../helpers/index.js";

/**
 * v6.12.0 Phase W (e2e) — `tdd_red_checkpoint_violation` blocks the gate
 * when a wave attempts to start Phase B (`phase=green`) before Phase A
 * (`phase=red`) has fully landed for every member of the wave. The wave
 * here is implicit: three contiguous `phase=red` events define wave
 * membership; one of the slices then publishes its `phase=green` row
 * with a `completedTs` that predates the wave's last `phase=red`.
 */

const RUN_ID = "run-tdd-wave-checkpoint";

async function seed(root: string): Promise<void> {
  await fs.mkdir(path.join(root, ".cclaw/state"), { recursive: true });
  const state = createInitialFlowState({
    activeRunId: RUN_ID,
    track: "standard",
    discoveryMode: "guided"
  });
  state.currentStage = "tdd";
  state.completedStages = ["brainstorm", "scope", "design", "spec", "plan"];
  // v6.14.0: this fixture exercises the legacy global-RED checkpoint rule.
  // New default is per-slice; opt back into global-red so
  // `tdd_red_checkpoint_violation` continues to fire.
  state.tddCheckpointMode = "global-red";
  await fs.writeFile(
    path.join(root, ".cclaw/state/flow-state.json"),
    `${JSON.stringify(state, null, 2)}\n`,
    "utf8"
  );
}

const PRE_TDD: Record<string, string> = {
  "01-brainstorm.md": `# Brainstorm Artifact

## Q&A Log
| Turn | Question | User answer (1-line) | Decision impact |
|---|---|---|---|
| 1 | (stop-signal) | "stop" | stop-and-draft |

## Context
- Phase W e2e wave checkpoint test.

## Problem Decision Record
- Problem: enforce RED checkpoint across waves.
- Why now: v6.12.0.

## Approach Tier
- Tier: standard

## Selected Direction
- Direction: ship.

## Learnings
- None this stage.
`,
  "04-spec.md": `# Spec Artifact

## Acceptance Criteria
- AC-1: wave checkpoint enforced.

## Edge Cases
- None.

## Acceptance Mapping
- AC-1 traces to delegation events.

## Approval
- Approved: yes.

## Learnings
- None this stage.
`,
  "05-plan.md": `# Plan Artifact

## Task List
- T-1: wave checkpoint.

## Dependency Batches
- Batch 1: T-1.

## Acceptance Mapping
- T-1 traces to AC-1.

## Execution Posture
- Posture: parallel.

## Learnings
- None this stage.

<!-- parallel-exec-managed-start -->
## Parallel Execution Plan
### Wave 01
- **Members:** S-1, S-2, S-3
<!-- parallel-exec-managed-end -->
`
};

const TDD_BODY = `# TDD Artifact

## Upstream Handoff
- Source artifacts: \`05-plan.md\`, \`04-spec.md\`.
- Decisions carried forward: enforce RED checkpoint across waves.
- Constraints carried forward: minimal change.
- Open questions: none.
- Drift from upstream (or \`None\`): None.

## Test Discovery
- Overall narrative: 3-slice wave.

## System-Wide Impact Check
| Slice | Callbacks/state/interfaces/contracts affected | Coverage decision |
|---|---|---|
| S-1 | linter slice cycle | covered by phase events |
| S-2 | linter slice cycle | covered by phase events |
| S-3 | linter slice cycle | covered by phase events |

## RED Evidence
- Auto-derived from \`delegation-events.jsonl\` phase=red rows.

## Acceptance & Failure Map
| Slice | Source ID | AC ID | Expected behavior | RED-link |
|---|---|---|---|---|
| S-1 | T-1 | AC-1 | wave member 1 | spanId:r1 |
| S-2 | T-1 | AC-1 | wave member 2 | spanId:r2 |
| S-3 | T-1 | AC-1 | wave member 3 | spanId:r3 |

## GREEN Evidence
- Auto-derived from \`delegation-events.jsonl\` phase=green rows.

## REFACTOR Notes
- What changed: wave checkpoint enforced.
- Why: provable RED-before-GREEN.
- Behavior preserved: yes.

## Traceability
- Plan task IDs: T-1
- Spec criterion IDs: AC-1

## Iron Law Acknowledgement
- Iron Law: NO PRODUCTION CODE WITHOUT A FAILING TEST FIRST.
- Acknowledged: yes — code that landed before its test will be deleted and rewritten from the test.
- Exceptions invoked (or \`- None.\`):
  - None.

## Verification Ladder
| Slice | Tier reached | Evidence |
|---|---|---|
| S-1 | command | npm test -- tdd-wave-checkpoint — PASS |
| S-2 | command | npm test -- tdd-wave-checkpoint — PASS |
| S-3 | command | npm test -- tdd-wave-checkpoint — PASS |

## Learnings
- None this stage.
`;

async function writeArtifacts(root: string): Promise<void> {
  await fs.mkdir(path.join(root, ".cclaw/artifacts"), { recursive: true });
  for (const [name, body] of Object.entries(PRE_TDD)) {
    await fs.writeFile(path.join(root, ".cclaw/artifacts", name), body, "utf8");
  }
  await fs.writeFile(path.join(root, ".cclaw/artifacts/06-tdd.md"), TDD_BODY, "utf8");
}

function ts(offsetMin: number): string {
  const base = Date.parse("2026-03-15T10:00:00Z");
  return new Date(base + offsetMin * 60_000).toISOString();
}

describe("e2e: tdd_red_checkpoint_violation (v6.12.0 Phase W)", () => {
  it("blocks the gate when Phase B (green) starts before Phase A (red) completes for every wave member", async () => {
    const root = await createTempProject("tdd-wave-checkpoint-violation");
    await seed(root);
    await writeArtifacts(root);

    // Explicit wave manifest: managed Parallel Execution Plan in `05-plan.md`
    // plus matching `wave-plans/wave-01.md`. S-1 goes GREEN at ts=3 before S-3's
    // RED lands at ts=5 — `tdd_red_checkpoint_violation` must fire.
    const wavePlansDir = path.join(root, ".cclaw/artifacts/wave-plans");
    await fs.mkdir(wavePlansDir, { recursive: true });
    await fs.writeFile(
      path.join(wavePlansDir, "wave-01.md"),
      `# Wave W-01

Members: S-1, S-2, S-3
`,
      "utf8"
    );

    await appendDelegation(root, {
      stage: "tdd",
      agent: "test-author",
      mode: "mandatory",
      status: "completed",
      sliceId: "S-1",
      phase: "red",
      evidenceRefs: ["tests/unit/s1.test.ts"],
      spanId: "span-r1",
      ts: ts(0),
      completedTs: ts(0)
    });
    await appendDelegation(root, {
      stage: "tdd",
      agent: "test-author",
      mode: "mandatory",
      status: "completed",
      sliceId: "S-2",
      phase: "red",
      evidenceRefs: ["tests/unit/s2.test.ts"],
      spanId: "span-r2",
      ts: ts(1),
      completedTs: ts(1)
    });
    // Out of order: S-1 green at ts=3 happens BEFORE S-3 red at ts=5.
    await appendDelegation(root, {
      stage: "tdd",
      agent: "slice-implementer",
      mode: "mandatory",
      status: "completed",
      sliceId: "S-1",
      phase: "green",
      evidenceRefs: ["tests/unit/s1.test.ts"],
      spanId: "span-g1",
      ts: ts(3),
      completedTs: ts(3)
    });
    await appendDelegation(root, {
      stage: "tdd",
      agent: "test-author",
      mode: "mandatory",
      status: "completed",
      sliceId: "S-3",
      phase: "red",
      evidenceRefs: ["tests/unit/s3.test.ts"],
      spanId: "span-r3",
      ts: ts(5),
      completedTs: ts(5)
    });

    const result = await lintArtifact(root, "tdd");
    const finding = result.findings.find(
      (f) => f.section === "tdd_red_checkpoint_violation"
    );
    expect(finding).toBeDefined();
    expect(finding?.required).toBe(true);
    expect(finding?.found).toBe(false);
    expect(finding?.details ?? "").toContain("S-1");
    expect(finding?.details ?? "").toContain("precedes");
  });

  it("does not fire when Phase A completes fully before Phase B starts", async () => {
    const root = await createTempProject("tdd-wave-checkpoint-clean");
    await seed(root);
    await writeArtifacts(root);

    // All three reds first (the implicit wave), then all three greens.
    for (let i = 1; i <= 3; i += 1) {
      await appendDelegation(root, {
        stage: "tdd",
        agent: "test-author",
        mode: "mandatory",
        status: "completed",
        sliceId: `S-${i}`,
        phase: "red",
        evidenceRefs: [`tests/unit/s${i}.test.ts`],
        spanId: `span-r${i}`,
        ts: ts(i),
        completedTs: ts(i)
      });
    }
    for (let i = 1; i <= 3; i += 1) {
      await appendDelegation(root, {
        stage: "tdd",
        agent: "slice-implementer",
        mode: "mandatory",
        status: "completed",
        sliceId: `S-${i}`,
        phase: "green",
        evidenceRefs: [`tests/unit/s${i}.test.ts`],
        spanId: `span-g${i}`,
        ts: ts(10 + i),
        completedTs: ts(10 + i)
      });
    }

    const result = await lintArtifact(root, "tdd");
    const finding = result.findings.find(
      (f) => f.section === "tdd_red_checkpoint_violation"
    );
    expect(finding).toBeUndefined();
  });
});
