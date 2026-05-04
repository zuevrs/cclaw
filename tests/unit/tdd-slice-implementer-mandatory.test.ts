import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { lintArtifact } from "../../src/artifact-linter.js";
import { appendDelegation } from "../../src/delegation.js";
import { evaluateSliceImplementerCoverage } from "../../src/artifact-linter/tdd.js";
import type { DelegationEntry } from "../../src/delegation.js";
import { createInitialFlowState } from "../../src/flow-state.js";
import { createTempProject } from "../helpers/index.js";

/**
 * v6.12.0 Phase M — `tdd_slice_implementer_missing` blocks the gate when a
 * slice with a `phase=red` event (with non-empty evidenceRefs) does not
 * reach `phase=green` via the `slice-implementer` agent. This catches the
 * "controller wrote GREEN itself" backslide we observed on the hox flow
 * (S-11): if any other agent (controller, test-author, generic worker)
 * authored the green row, the rule fires.
 */

const RUN_ID = "run-tdd-impl-mandatory";

async function seed(root: string): Promise<void> {
  await fs.mkdir(path.join(root, ".cclaw/state"), { recursive: true });
  const state = createInitialFlowState({
    activeRunId: RUN_ID,
    track: "standard",
    discoveryMode: "guided"
  });
  state.currentStage = "tdd";
  state.completedStages = ["brainstorm", "scope", "design", "spec", "plan"];
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
- Phase M unit test.

## Problem Decision Record
- Problem: enforce slice-implementer GREEN ownership.
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
- AC-1: implementer mandatory.

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
- T-1: implementer mandatory.

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

const TDD_BODY = `# TDD Artifact

## Upstream Handoff
- Source artifacts: \`05-plan.md\`, \`04-spec.md\`.
- Decisions carried forward: dispatch slice-implementer for GREEN.
- Constraints carried forward: minimal change.
- Open questions: none.
- Drift from upstream (or \`None\`): None.

## Test Discovery
- Overall narrative: events-driven.

## System-Wide Impact Check
| Slice | Callbacks/state/interfaces/contracts affected | Coverage decision |
|---|---|---|
| S-1 | linter slice cycle | covered by phase events |

## RED Evidence
- Auto-derived from \`delegation-events.jsonl\` phase=red rows.

## Acceptance & Failure Map
| Slice | Source ID | AC ID | Expected behavior | RED-link |
|---|---|---|---|---|
| S-1 | T-1 | AC-1 | mandatory implementer | spanId:span-red-1 |

## GREEN Evidence
- Auto-derived from \`delegation-events.jsonl\` phase=green rows.

## REFACTOR Notes
- What changed: phase events used.
- Why: provable coverage.
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
| S-1 | command | npm test -- tdd-slice-implementer-mandatory — PASS |

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
  const base = Date.parse("2026-02-15T10:00:00Z");
  return new Date(base + offsetMin * 60_000).toISOString();
}

describe("evaluateSliceImplementerCoverage (v6.12.0 Phase M)", () => {
  it("flags slices whose phase=green is authored by an agent other than slice-implementer", () => {
    const slices = new Map<string, DelegationEntry[]>([
      [
        "S-1",
        [
          {
            stage: "tdd",
            agent: "test-author",
            mode: "mandatory",
            status: "completed",
            sliceId: "S-1",
            phase: "red",
            evidenceRefs: ["tests/unit/foo.test.ts"],
            spanId: "r1",
            ts: ts(0),
            completedTs: ts(0)
          } as unknown as DelegationEntry,
          {
            stage: "tdd",
            agent: "controller",
            mode: "mandatory",
            status: "completed",
            sliceId: "S-1",
            phase: "green",
            evidenceRefs: ["tests/unit/foo.test.ts"],
            spanId: "g1",
            ts: ts(5),
            completedTs: ts(5)
          } as unknown as DelegationEntry
        ]
      ]
    ]);
    expect(evaluateSliceImplementerCoverage(slices).missing).toEqual(["S-1"]);
  });

  it("accepts slices whose phase=green is authored by slice-implementer", () => {
    const slices = new Map<string, DelegationEntry[]>([
      [
        "S-1",
        [
          {
            stage: "tdd",
            agent: "test-author",
            mode: "mandatory",
            status: "completed",
            sliceId: "S-1",
            phase: "red",
            evidenceRefs: ["tests/unit/foo.test.ts"],
            spanId: "r1",
            ts: ts(0),
            completedTs: ts(0)
          } as unknown as DelegationEntry,
          {
            stage: "tdd",
            agent: "slice-implementer",
            mode: "mandatory",
            status: "completed",
            sliceId: "S-1",
            phase: "green",
            evidenceRefs: ["tests/unit/foo.test.ts"],
            spanId: "g1",
            ts: ts(5),
            completedTs: ts(5)
          } as unknown as DelegationEntry
        ]
      ]
    ]);
    expect(evaluateSliceImplementerCoverage(slices).missing).toEqual([]);
  });

  it("ignores slices whose phase=red has empty evidenceRefs (treated as scaffolding)", () => {
    const slices = new Map<string, DelegationEntry[]>([
      [
        "S-2",
        [
          {
            stage: "tdd",
            agent: "test-author",
            mode: "mandatory",
            status: "completed",
            sliceId: "S-2",
            phase: "red",
            evidenceRefs: [],
            spanId: "r2",
            ts: ts(0),
            completedTs: ts(0)
          } as unknown as DelegationEntry
        ]
      ]
    ]);
    expect(evaluateSliceImplementerCoverage(slices).missing).toEqual([]);
  });
});

describe("tdd_slice_implementer_missing — linter integration (v6.12.0 Phase M)", () => {
  it("emits required:true finding when GREEN is authored by an agent other than slice-implementer", async () => {
    const root = await createTempProject("tdd-impl-missing");
    await seed(root);
    await writeArtifacts(root);

    await appendDelegation(root, {
      stage: "tdd",
      agent: "test-author",
      mode: "mandatory",
      status: "completed",
      sliceId: "S-1",
      phase: "red",
      evidenceRefs: ["tests/unit/foo.test.ts"],
      spanId: "span-red-1",
      ts: ts(0),
      completedTs: ts(0)
    });
    // Controller wrote GREEN itself — common backslide observed on the
    // hox flow run before v6.12.0.
    await appendDelegation(root, {
      stage: "tdd",
      agent: "test-author",
      mode: "mandatory",
      status: "completed",
      sliceId: "S-1",
      phase: "green",
      evidenceRefs: ["tests/unit/foo.test.ts"],
      spanId: "span-green-1",
      ts: ts(5),
      completedTs: ts(5)
    });

    const result = await lintArtifact(root, "tdd");
    const finding = result.findings.find(
      (f) => f.section === "tdd_slice_implementer_missing"
    );
    expect(finding).toBeDefined();
    expect(finding?.required).toBe(true);
    expect(finding?.found).toBe(false);
  });
});
