import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { lintArtifact } from "../../src/artifact-linter.js";
import { appendDelegation } from "../../src/delegation.js";
import { createInitialFlowState } from "../../src/flow-state.js";
import { createTempProject } from "../helpers/index.js";

/**
 * Full happy-path e2e for the slice-builder TDD protocol.
 *
 * For 2 disjoint slices, each `slice-builder` span owns the complete
 * RED → GREEN → REFACTOR → DOC cycle:
 *   1. Phase A — RED checkpoint: both `slice-builder --phase red` events.
 *   2. Phase B — GREEN: both `slice-builder --phase green` events with
 *      `completedTs` after both reds (RED checkpoint holds).
 *   3. REFACTOR + DOC: `slice-builder --phase refactor` and
 *      `slice-builder --phase doc` for each slice.
 *
 * After this sequence, the linter must accept the artifact: no
 * `tdd_slice_builder_missing`, no `tdd_slice_doc_missing`, no
 * `tdd_red_checkpoint_violation`.
 */

const RUN_ID = "run-tdd-mandatory-roles-e2e";

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
- Mandatory roles e2e.

## Problem Decision Record
- Problem: prove RED → GREEN+DOC cycle inside one slice-builder span.
- Why now: regression coverage for the TDD gate.

## Approach Tier
- Tier: standard

## Selected Direction
- Direction: ship.

## Learnings
- None this stage.
`,
  "04-spec.md": `# Spec Artifact

## Acceptance Criteria
- AC-1: mandatory roles end-to-end.

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
- T-1: mandatory roles.

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

const TDD_BODY = `# TDD Artifact

## Upstream Handoff
- Source artifacts: \`05-plan.md\`, \`04-spec.md\`.
- Decisions carried forward: dispatch one slice-builder per slice for the full RED/GREEN/REFACTOR/DOC cycle.
- Constraints carried forward: minimal change.
- Open questions: none.
- Drift from upstream (or \`None\`): None.

## Test Discovery
- Overall narrative: events-driven.

## System-Wide Impact Check
| Slice | Callbacks/state/interfaces/contracts affected | Coverage decision |
|---|---|---|
| S-1 | linter slice cycle | covered by phase events |
| S-2 | linter slice cycle | covered by phase events |

## RED Evidence
- Auto-derived from \`delegation-events.jsonl\` phase=red rows.

## Acceptance & Failure Map
| Slice | Source ID | AC ID | Expected behavior | RED-link |
|---|---|---|---|---|
| S-1 | T-1 | AC-1 | impl+doc lifecycle | spanId:span-r1 |
| S-2 | T-1 | AC-1 | impl+doc lifecycle | spanId:span-r2 |

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

<!-- auto-start: slices-index --><!-- auto-end: slices-index -->
<!-- auto-start: tdd-slice-summary --><!-- auto-end: tdd-slice-summary -->

## Verification Ladder
| Slice | Tier reached | Evidence |
|---|---|---|
| S-1 | command | npm test -- tdd-mandatory-roles-end-to-end — PASS |
| S-2 | command | npm test -- tdd-mandatory-roles-end-to-end — PASS |

## Learnings
- None this stage.
`;

async function writeArtifacts(root: string): Promise<void> {
  await fs.mkdir(path.join(root, ".cclaw/artifacts"), { recursive: true });
  for (const [name, body] of Object.entries(PRE_TDD)) {
    await fs.writeFile(path.join(root, ".cclaw/artifacts", name), body, "utf8");
  }
  await fs.writeFile(path.join(root, ".cclaw/artifacts/06-tdd.md"), TDD_BODY, "utf8");

  const slicesDir = path.join(root, ".cclaw/artifacts/tdd-slices");
  await fs.mkdir(slicesDir, { recursive: true });
  for (const slice of ["S-1", "S-2"]) {
    const body = `# Slice ${slice}

## Plan unit
T-1

## Acceptance criteria
AC-1

## Why this slice
Cover ${slice}.

## What was tested
phase=red event for ${slice}.

## What was implemented
${slice} body.

## REFACTOR notes
- None.

## Learnings
- None this slice.
`;
    await fs.writeFile(path.join(slicesDir, `${slice}.md`), body, "utf8");
  }
}

function ts(offsetMin: number): string {
  const base = Date.parse("2026-04-01T10:00:00Z");
  return new Date(base + offsetMin * 60_000).toISOString();
}

describe("e2e: TDD mandatory roles end-to-end (slice-builder happy path)", () => {
  it("accepts the gate when each slice-builder records RED → GREEN → REFACTOR + DOC for its slice", async () => {
    const root = await createTempProject("tdd-mandatory-roles-e2e");
    await seed(root);
    await writeArtifacts(root);

    for (let i = 1; i <= 2; i += 1) {
      await appendDelegation(root, {
        stage: "tdd",
        agent: "slice-builder",
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

    for (let i = 1; i <= 2; i += 1) {
      await appendDelegation(root, {
        stage: "tdd",
        agent: "slice-builder",
        mode: "mandatory",
        status: "completed",
        sliceId: `S-${i}`,
        phase: "green",
        evidenceRefs: [`tests/unit/s${i}.test.ts`],
        spanId: `span-g${i}`,
        ts: ts(10 + i),
        completedTs: ts(10 + i)
      });
      await appendDelegation(root, {
        stage: "tdd",
        agent: "slice-builder",
        mode: "mandatory",
        status: "completed",
        sliceId: `S-${i}`,
        phase: "doc",
        evidenceRefs: [`.cclaw/artifacts/tdd-slices/S-${i}.md`],
        spanId: `span-d${i}`,
        ts: ts(10 + i),
        completedTs: ts(10 + i)
      });
    }

    for (let i = 1; i <= 2; i += 1) {
      await appendDelegation(root, {
        stage: "tdd",
        agent: "slice-builder",
        mode: "mandatory",
        status: "completed",
        sliceId: `S-${i}`,
        phase: "refactor",
        evidenceRefs: [`src/feature${i}.ts`],
        spanId: `span-rf${i}`,
        ts: ts(20 + i),
        completedTs: ts(20 + i)
      });
    }

    const result = await lintArtifact(root, "tdd");
    const blockingFindings = result.findings.filter((f) =>
      [
        "tdd_slice_builder_missing",
        "tdd_slice_doc_missing",
        "tdd_red_checkpoint_violation"
      ].includes(f.section)
    );
    expect(
      blockingFindings.map((f) => `${f.section}:${f.found ? "ok" : "fail"}`)
    ).toEqual([]);

    const rendered = await fs.readFile(
      path.join(root, ".cclaw/artifacts/06-tdd.md"),
      "utf8"
    );
    expect(rendered).toContain("| S-1 |");
    expect(rendered).toContain("| S-2 |");
  });
});
