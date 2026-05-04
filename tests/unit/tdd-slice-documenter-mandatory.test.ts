import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { lintArtifact } from "../../src/artifact-linter.js";
import { appendDelegation } from "../../src/delegation.js";
import { createInitialFlowState, type DiscoveryMode } from "../../src/flow-state.js";
import { createTempProject } from "../helpers/index.js";

/**
 * v6.12.0 Phase R — `tdd_slice_documenter_missing` is `required: true` on
 * every TDD run regardless of `discoveryMode`. The previous (v6.11.0) rule
 * id `tdd_slice_documenter_missing_for_deep` is removed; the requirement is
 * now uniform across `lean`, `guided`, and `deep` so the controller cannot
 * silently skip per-slice prose by picking a non-deep mode.
 */

const RUN_ID = "run-tdd-doc-mandatory";

async function seed(root: string, mode: DiscoveryMode): Promise<void> {
  await fs.mkdir(path.join(root, ".cclaw/state"), { recursive: true });
  const state = createInitialFlowState({
    activeRunId: RUN_ID,
    track: "standard",
    discoveryMode: mode
  });
  state.currentStage = "tdd";
  state.completedStages = ["brainstorm", "scope", "design", "spec", "plan"];
  await fs.writeFile(
    path.join(root, ".cclaw/state/flow-state.json"),
    `${JSON.stringify(state, null, 2)}\n`,
    "utf8"
  );
}

const PRE_TDD_ARTIFACTS: Record<string, string> = {
  "01-brainstorm.md": `# Brainstorm Artifact

## Q&A Log
| Turn | Question | User answer (1-line) | Decision impact |
|---|---|---|---|
| 1 | (stop-signal) | "stop" | stop-and-draft |

## Context
- Phase R unit test.

## Problem Decision Record
- Problem: enforce slice-documenter regardless of discoveryMode.
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
- AC-1: documenter mandatory.

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
- T-1: documenter mandatory regardless of discoveryMode.

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
- Decisions carried forward: dispatch test-author + slice-implementer + slice-documenter.
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
| S-1 | T-1 | AC-1 | mandatory documenter | spanId:span-red-1 |

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
| S-1 | command | npm test -- tdd-slice-documenter-mandatory — PASS |

## Learnings
- None this stage.
`;

async function writeArtifacts(root: string): Promise<void> {
  await fs.mkdir(path.join(root, ".cclaw/artifacts"), { recursive: true });
  for (const [name, body] of Object.entries(PRE_TDD_ARTIFACTS)) {
    await fs.writeFile(path.join(root, ".cclaw/artifacts", name), body, "utf8");
  }
  await fs.writeFile(path.join(root, ".cclaw/artifacts/06-tdd.md"), TDD_BARE_BODY, "utf8");
}

function ts(offsetMin: number): string {
  const base = Date.parse("2026-02-01T10:00:00Z");
  return new Date(base + offsetMin * 60_000).toISOString();
}

async function recordRedGreenRefactor(root: string): Promise<void> {
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
  await appendDelegation(root, {
    stage: "tdd",
    agent: "slice-implementer",
    mode: "mandatory",
    status: "completed",
    sliceId: "S-1",
    phase: "green",
    evidenceRefs: ["tests/unit/foo.test.ts"],
    spanId: "span-green-1",
    ts: ts(5),
    completedTs: ts(5)
  });
  await appendDelegation(root, {
    stage: "tdd",
    agent: "slice-implementer",
    mode: "mandatory",
    status: "completed",
    sliceId: "S-1",
    phase: "refactor",
    evidenceRefs: ["src/foo.ts"],
    spanId: "span-refactor-1",
    ts: ts(10),
    completedTs: ts(10)
  });
}

describe("tdd_slice_documenter_missing — required regardless of discoveryMode (v6.12.0 Phase R)", () => {
  const modes: DiscoveryMode[] = ["lean", "guided", "deep"];
  for (const mode of modes) {
    it(`flags missing phase=doc as required:true on discoveryMode=${mode}`, async () => {
      const root = await createTempProject(`tdd-doc-required-${mode}`);
      await seed(root, mode);
      await writeArtifacts(root);
      await recordRedGreenRefactor(root);

      const result = await lintArtifact(root, "tdd");
      const finding = result.findings.find(
        (f) => f.section === "tdd_slice_documenter_missing"
      );
      expect(finding, `expected tdd_slice_documenter_missing on discoveryMode=${mode}`).toBeDefined();
      expect(finding?.required).toBe(true);
      expect(finding?.found).toBe(false);
      // The legacy rule id must not reappear.
      const legacy = result.findings.find(
        (f) => f.section === "tdd_slice_documenter_missing_for_deep"
      );
      expect(legacy).toBeUndefined();
    });
  }

  it("clears when slice-documenter records phase=doc on discoveryMode=lean", async () => {
    const root = await createTempProject("tdd-doc-cleared-lean");
    await seed(root, "lean");
    await writeArtifacts(root);
    await recordRedGreenRefactor(root);
    await fs.mkdir(path.join(root, ".cclaw/artifacts/tdd-slices"), { recursive: true });
    await fs.writeFile(
      path.join(root, ".cclaw/artifacts/tdd-slices/S-1.md"),
      `# Slice S-1

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
`,
      "utf8"
    );
    await appendDelegation(root, {
      stage: "tdd",
      agent: "slice-documenter",
      mode: "mandatory",
      status: "completed",
      sliceId: "S-1",
      phase: "doc",
      evidenceRefs: [".cclaw/artifacts/tdd-slices/S-1.md"],
      spanId: "span-doc-1",
      ts: ts(7),
      completedTs: ts(7)
    });

    const result = await lintArtifact(root, "tdd");
    const finding = result.findings.find(
      (f) => f.section === "tdd_slice_documenter_missing"
    );
    expect(finding).toBeUndefined();
  });
});
