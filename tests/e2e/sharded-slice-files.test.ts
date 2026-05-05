import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { lintArtifact } from "../../src/artifact-linter.js";
import { appendDelegation } from "../../src/delegation.js";
import { ensureRunSystem } from "../../src/runs.js";
import { createInitialFlowState } from "../../src/flow-state.js";
import { writeFlowState } from "../../src/run-persistence.js";
import { createTempProject } from "../helpers/index.js";

/**
 * Phase note — sharded `tdd-slices/S-<id>.md` files. Each slice
 * file owns its own writer; the main `06-tdd.md` stays thin and lists
 * the slice files via the auto-rendered `## Slices Index` block.
 *
 * These e2e tests cover:
 *
 * 1. Three slice files (`S-1.md`, `S-2.md`, `S-3.md`) with the required
 *    headings + a thin main artifact → linter passes and auto-renders
 *    `## Slices Index` between the markers.
 * 2. A slice file referenced by a `phase=doc` event (i.e. mandatory)
 *    that omits required headings → linter emits a blocking
 *    `tdd_slice_file:S-<id>` finding.
 */

const RUN_ID = "run-tdd-sharded";

async function seedTddRun(root: string): Promise<void> {
  await ensureRunSystem(root);
  const state = createInitialFlowState({
    activeRunId: RUN_ID,
    track: "standard",
    discoveryMode: "guided"
  });
  state.currentStage = "tdd";
  state.completedStages = ["brainstorm", "scope", "design", "spec", "plan"];
  await writeFlowState(root, state, { allowReset: true });
}

const PRE_TDD_ARTIFACTS: Record<string, string> = {
  "01-brainstorm.md": `# Brainstorm Artifact

## Q&A Log
| Turn | Question | User answer (1-line) | Decision impact |
|---|---|---|---|
| 1 | (stop-signal) | "достаточно, давай драфт" | stop-and-draft |

## Context
- E2E sharded slice file coverage.

## Problem Decision Record
- Problem: prove sharded slice files validate independently.
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
- AC-1: per-slice prose lives in tdd-slices/S-<id>.md.

## Edge Cases
- None.

## Acceptance Mapping
- AC-1 traces to tdd-slices/.

## Approval
- Approved: yes.

## Learnings
- None this stage.
`,
  "05-plan.md": `# Plan Artifact

## Task List
- T-1: shard slice prose into per-slice files.

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
- Decisions carried forward: shard slice prose into tdd-slices/.
- Constraints carried forward: keep main 06-tdd.md thin.
- Open questions: none.
- Drift from upstream (or \`None\`): None.

<!-- auto-start: slices-index -->
<!-- auto-end: slices-index -->

## Test Discovery
- Overall narrative: per-slice details live in tdd-slices/S-<id>.md.

## System-Wide Impact Check
| Slice | Callbacks/state/interfaces/contracts affected | Coverage decision |
|---|---|---|
| S-1 | linter sliced view | covered by tdd-slices/S-1.md |

## RED Evidence
- See tdd-slices/S-<id>.md per-slice prose.

## Acceptance & Failure Map
| Slice | Source ID | AC ID | Expected behavior | RED-link |
|---|---|---|---|---|
| S-1 | T-1 | AC-1 | sharded files validate | tdd-slices/S-1.md |

## GREEN Evidence
- See tdd-slices/S-<id>.md per-slice prose.

## REFACTOR Notes
- What changed: linter reads tdd-slices/.
- Why: per-slice writer = zero merge contention.
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
| S-1 | command | npm test -- sharded-slice-files — PASS |

## Learnings
- None this stage.
`;

function sliceFile(sliceId: string, n: number): string {
  return `# Slice ${sliceId}

## Plan unit
T-1

## Acceptance criteria
AC-1

## Why this slice
Cover slice ${n}.

## What was tested
phase=red event for ${sliceId}.

## What was implemented
slice ${n} body.

## REFACTOR notes
- None.

## Learnings
- None this slice.
`;
}

async function writePreTdd(root: string): Promise<void> {
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

describe("e2e: sharded slice files (Phase S)", () => {
  it("auto-renders the Slices Index from three tdd-slices/S-*.md files and lints clean", async () => {
    const root = await createTempProject("e2e-sharded-slices-three");
    await seedTddRun(root);
    await writePreTdd(root);

    const slicesDir = path.join(root, ".cclaw/artifacts/tdd-slices");
    await fs.mkdir(slicesDir, { recursive: true });
    for (let i = 1; i <= 3; i += 1) {
      const sliceId = `S-${i}`;
      await fs.writeFile(path.join(slicesDir, `${sliceId}.md`), sliceFile(sliceId, i), "utf8");
    }

    // Drive the linter via phase events so the thin main artifact does
    // not need legacy Watched-RED / Vertical Slice Cycle markdown tables.
    const baseTs = Date.parse("2026-01-15T10:00:00Z");
    const ts = (offsetMin: number): string =>
      new Date(baseTs + offsetMin * 60_000).toISOString();
    for (let i = 1; i <= 3; i += 1) {
      const sliceId = `S-${i}`;
      const off = (i - 1) * 30;
      await appendDelegation(root, {
        stage: "tdd",
        agent: "slice-builder",
        mode: "mandatory",
        status: "completed",
        sliceId,
        phase: "red",
        evidenceRefs: [`tests/unit/slice-${i}.test.ts`],
        spanId: `span-red-${sliceId}`,
        ts: ts(off),
        completedTs: ts(off)
      });
      await appendDelegation(root, {
        stage: "tdd",
        agent: "slice-builder",
        mode: "proactive",
        status: "completed",
        sliceId,
        phase: "green",
        evidenceRefs: [`tests/unit/slice-${i}.test.ts`],
        spanId: `span-green-${sliceId}`,
        ts: ts(off + 5),
        completedTs: ts(off + 5)
      });
      await appendDelegation(root, {
        stage: "tdd",
        agent: "slice-builder",
        mode: "proactive",
        status: "completed",
        sliceId,
        phase: "refactor-deferred",
        evidenceRefs: [`scope contained for ${sliceId}; no measurable cleanup yet`],
        spanId: `span-refactor-${sliceId}`,
        ts: ts(off + 10),
        completedTs: ts(off + 10)
      });
    }

    const result = await lintArtifact(root, "tdd");
    const blockers = result.findings
      .filter((f) => f.required && !f.found)
      .filter((f) => !f.section.startsWith("tdd.cohesion_contract"))
      .filter((f) => !f.section.startsWith("tdd.integration_overseer"))
      // slice-builder DOC coverage is exercised in dedicated tests; this
      // file focuses on the index auto-render and per-file heading
      // validation.
      .filter((f) => f.section !== "tdd_slice_doc_missing");
    expect(blockers.map((f) => f.section)).toEqual([]);

    const tddArtifact = await fs.readFile(
      path.join(root, ".cclaw/artifacts/06-tdd.md"),
      "utf8"
    );
    expect(tddArtifact).toContain("<!-- auto-start: slices-index -->");
    expect(tddArtifact).toContain("<!-- auto-end: slices-index -->");
    expect(tddArtifact).toContain("## Slices Index");
    expect(tddArtifact).toContain("[S-1](tdd-slices/S-1.md)");
    expect(tddArtifact).toContain("[S-2](tdd-slices/S-2.md)");
    expect(tddArtifact).toContain("[S-3](tdd-slices/S-3.md)");

    // Idempotent re-render: a second lint pass produces identical output.
    await lintArtifact(root, "tdd");
    const rerendered = await fs.readFile(
      path.join(root, ".cclaw/artifacts/06-tdd.md"),
      "utf8"
    );
    expect(rerendered).toBe(tddArtifact);
  });

  it("blocks lint when a slice file referenced by a phase=doc event is missing required headings", async () => {
    const root = await createTempProject("e2e-sharded-slice-missing-headings");
    await seedTddRun(root);
    await writePreTdd(root);

    const slicesDir = path.join(root, ".cclaw/artifacts/tdd-slices");
    await fs.mkdir(slicesDir, { recursive: true });
    // Slice file is missing `## Plan unit`, `## REFACTOR notes`, and
    // `## Learnings` headings — those are required when a phase=doc
    // event references this file.
    const malformed = `# Slice S-1

## What was tested
some prose without the required structural headings
`;
    await fs.writeFile(path.join(slicesDir, "S-1.md"), malformed, "utf8");

    const refTs = "2026-01-15T10:00:00Z";
    await appendDelegation(root, {
      stage: "tdd",
      agent: "slice-builder",
      mode: "mandatory",
      status: "completed",
      sliceId: "S-1",
      phase: "red",
      evidenceRefs: ["tests/unit/slice-1.test.ts"],
      spanId: "span-red-S-1",
      ts: refTs,
      completedTs: refTs
    });
    await appendDelegation(root, {
      stage: "tdd",
      agent: "slice-builder",
      mode: "proactive",
      status: "completed",
      sliceId: "S-1",
      phase: "green",
      evidenceRefs: ["tests/unit/slice-1.test.ts"],
      spanId: "span-green-S-1",
      ts: "2026-01-15T10:05:00Z",
      completedTs: "2026-01-15T10:05:00Z"
    });
    await appendDelegation(root, {
      stage: "tdd",
      agent: "slice-builder",
      mode: "proactive",
      status: "completed",
      sliceId: "S-1",
      phase: "refactor-deferred",
      evidenceRefs: ["scope contained — no cleanup yet"],
      spanId: "span-refactor-S-1",
      ts: "2026-01-15T10:10:00Z",
      completedTs: "2026-01-15T10:10:00Z"
    });
    await appendDelegation(root, {
      stage: "tdd",
      agent: "slice-builder",
      mode: "proactive",
      status: "completed",
      sliceId: "S-1",
      phase: "doc",
      evidenceRefs: [".cclaw/artifacts/tdd-slices/S-1.md"],
      spanId: "span-doc-S-1",
      ts: "2026-01-15T10:11:00Z",
      completedTs: "2026-01-15T10:11:00Z"
    });

    const result = await lintArtifact(root, "tdd");
    const sliceFinding = result.findings.find((f) => f.section === "tdd_slice_file:S-1");
    expect(sliceFinding).toBeDefined();
    expect(sliceFinding?.required).toBe(true);
    expect(sliceFinding?.found).toBe(false);
    expect(sliceFinding?.details ?? "").toContain("Plan unit");
  });
});
