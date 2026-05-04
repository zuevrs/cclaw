import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { lintArtifact } from "../../src/artifact-linter.js";
import { createInitialFlowState } from "../../src/flow-state.js";
import { createTempProject } from "../helpers/index.js";

/**
 * v6.12.0 Phase L — `tdd_legacy_section_writes_after_cutover` is an
 * advisory (`required: false`) finding that fires when, after the
 * `tddCutoverSliceId` boundary in `flow-state.json`, slice ids `> cutover`
 * appear in the legacy per-slice sections of `06-tdd.md` (Test Discovery,
 * RED Evidence, GREEN Evidence, Watched-RED Proof, Vertical Slice Cycle,
 * Per-Slice Review, Failure Analysis, Acceptance Mapping). Post-cutover
 * prose belongs in `tdd-slices/S-<id>.md`.
 */

const RUN_ID = "run-tdd-cutover-backslide";

async function seed(
  root: string,
  options: { tddCutoverSliceId?: string } = {}
): Promise<void> {
  await fs.mkdir(path.join(root, ".cclaw/state"), { recursive: true });
  const state = createInitialFlowState({
    activeRunId: RUN_ID,
    track: "standard",
    discoveryMode: "guided"
  });
  state.currentStage = "tdd";
  state.completedStages = ["brainstorm", "scope", "design", "spec", "plan"];
  if (options.tddCutoverSliceId) {
    state.tddCutoverSliceId = options.tddCutoverSliceId;
  }
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
- Phase L cutover unit test.

## Problem Decision Record
- Problem: detect post-cutover writes to legacy sections.
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
- AC-1: cutover backslide detected.

## Edge Cases
- None.

## Acceptance Mapping
- AC-1 traces to cutover marker.

## Approval
- Approved: yes.

## Learnings
- None this stage.
`,
  "05-plan.md": `# Plan Artifact

## Task List
- T-1: cutover backslide.

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

const TDD_BASE = `# TDD Artifact

## Upstream Handoff
- Source artifacts: \`05-plan.md\`, \`04-spec.md\`.
- Decisions carried forward: detect post-cutover backslide.
- Constraints carried forward: minimal change.
- Open questions: none.
- Drift from upstream (or \`None\`): None.

## System-Wide Impact Check
| Slice | Callbacks/state/interfaces/contracts affected | Coverage decision |
|---|---|---|
| S-1 | linter slice cycle | covered by phase events |

## RED Evidence
- Auto-derived from \`delegation-events.jsonl\` phase=red rows.

## Acceptance & Failure Map
| Slice | Source ID | AC ID | Expected behavior | RED-link |
|---|---|---|---|---|
| S-1 | T-1 | AC-1 | cutover detection | spanId:span-red-1 |

## GREEN Evidence
- Auto-derived from \`delegation-events.jsonl\` phase=green rows.

## REFACTOR Notes
- What changed: linter learns cutover.
- Why: provable migration.
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
| S-1 | command | npm test -- tdd-cutover-backslide-detection — PASS |

## Learnings
- None this stage.
`;

async function writeArtifacts(root: string, body: string): Promise<void> {
  await fs.mkdir(path.join(root, ".cclaw/artifacts"), { recursive: true });
  for (const [name, content] of Object.entries(PRE_TDD)) {
    await fs.writeFile(path.join(root, ".cclaw/artifacts", name), content, "utf8");
  }
  await fs.writeFile(path.join(root, ".cclaw/artifacts/06-tdd.md"), body, "utf8");
}

describe("tdd_legacy_section_writes_after_cutover (v6.12.0 Phase L)", () => {
  it("emits an advisory finding when post-cutover slice ids appear in a legacy section", async () => {
    const root = await createTempProject("tdd-cutover-backslide-positive");
    await seed(root, { tddCutoverSliceId: "S-10" });
    const body = `${TDD_BASE}

## Watched-RED Proof
| Slice | Test name | Observed at (ISO ts) | Failure reason snippet | Source command/log |
|---|---|---|---|---|
| S-9  | dedupe fails on duplicate key | 2026-02-15T09:00:00Z | FAIL Assertion | npm test |
| S-11 | ordering wrong on tie         | 2026-02-15T09:05:00Z | FAIL Assertion | npm test |

## Vertical Slice Cycle
| Slice | RED ts | GREEN ts | REFACTOR ts |
|---|---|---|---|
| S-9  | 2026-02-15T09:00:00Z | 2026-02-15T09:01:00Z | 2026-02-15T09:02:00Z |
| S-12 | 2026-02-15T09:10:00Z | 2026-02-15T09:11:00Z | 2026-02-15T09:12:00Z |
`;
    await writeArtifacts(root, body);

    const result = await lintArtifact(root, "tdd");
    const advisory = result.findings.find(
      (f) => f.section === "tdd_legacy_section_writes_after_cutover"
    );
    expect(advisory).toBeDefined();
    expect(advisory?.required).toBe(false);
    expect(advisory?.found).toBe(false);
    expect(advisory?.details).toContain("S-11");
    expect(advisory?.details).toContain("S-12");
    expect(advisory?.details ?? "").not.toContain("S-9 ");
  });

  it("does not fire when no cutover marker is set", async () => {
    const root = await createTempProject("tdd-cutover-backslide-no-marker");
    await seed(root, {});
    const body = `${TDD_BASE}

## Watched-RED Proof
| Slice | Test name | Observed at (ISO ts) | Failure reason snippet | Source command/log |
|---|---|---|---|---|
| S-12 | t | 2026-02-15T09:00:00Z | FAIL | npm test |
`;
    await writeArtifacts(root, body);

    const result = await lintArtifact(root, "tdd");
    const advisory = result.findings.find(
      (f) => f.section === "tdd_legacy_section_writes_after_cutover"
    );
    expect(advisory).toBeUndefined();
  });

  it("does not fire when all slice ids in legacy sections are <= cutover", async () => {
    const root = await createTempProject("tdd-cutover-backslide-no-violations");
    await seed(root, { tddCutoverSliceId: "S-10" });
    const body = `${TDD_BASE}

## Watched-RED Proof
| Slice | Test name | Observed at (ISO ts) | Failure reason snippet | Source command/log |
|---|---|---|---|---|
| S-1  | t | 2026-02-15T09:00:00Z | FAIL | npm test |
| S-7  | t | 2026-02-15T09:01:00Z | FAIL | npm test |
| S-10 | t | 2026-02-15T09:02:00Z | FAIL | npm test |
`;
    await writeArtifacts(root, body);

    const result = await lintArtifact(root, "tdd");
    const advisory = result.findings.find(
      (f) => f.section === "tdd_legacy_section_writes_after_cutover"
    );
    expect(advisory).toBeUndefined();
  });
});
