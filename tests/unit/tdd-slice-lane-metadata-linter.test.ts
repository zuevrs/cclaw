import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { lintArtifact } from "../../src/artifact-linter.js";
import { appendDelegation } from "../../src/delegation.js";
import { createInitialFlowState } from "../../src/flow-state.js";
import { createTempProject } from "../helpers/index.js";

const RUN_ID = "run-lane-meta-lint";

async function seedWorktreeFirst(root: string): Promise<void> {
  await fs.mkdir(path.join(root, ".cclaw/state"), { recursive: true });
  const state = createInitialFlowState({
    activeRunId: RUN_ID,
    track: "standard",
    discoveryMode: "guided"
  });
  state.currentStage = "tdd";
  state.completedStages = ["brainstorm", "scope", "design", "spec", "plan"];
  state.worktreeExecutionMode = "worktree-first";
  await fs.writeFile(
    path.join(root, ".cclaw/state/flow-state.json"),
    `${JSON.stringify(state, null, 2)}\n`,
    "utf8"
  );
}

const PRE_TDD: Record<string, string> = {
  "01-brainstorm.md": `# B\n## Q&A Log\n|a|b|c|d|\n|-|-|-|-|\n|1|x|y|z|\n## Context\nx\n## Problem Decision Record\n- Problem: x\n- Why now: x\n## Approach Tier\n- Tier: standard\n## Selected Direction\n- Direction: x\n## Learnings\n- None\n`,
  "04-spec.md": `# S\n## Acceptance Criteria\n- AC-1: x\n## Edge Cases\n- None\n## Acceptance Mapping\n## Approval\n- Approved: yes\n## Learnings\n- None\n`,
  "05-plan.md": `# P\n## Task List\n- T-1\n## Learnings\n- None\n`
};

const TDD_MIN = `# TDD Artifact

## Upstream Handoff
- Source: plan/spec.

## System-Wide Impact Check
| Slice | Callbacks | Coverage |
|---|---|---|
| S-1 | x | covered |

## RED Evidence
- From events.

## Acceptance & Failure Map
| Slice | Source ID | AC ID | Expected behavior | RED-link |
|---|---|---|---|---|
| S-1 | T-1 | AC-1 | x | r1 |

## GREEN Evidence
- From events.

## REFACTOR Notes
- x

## Traceability
- Plan: T-1

## Iron Law Acknowledgement
- Iron Law: NO PRODUCTION CODE WITHOUT A FAILING TEST FIRST.
- Acknowledged: yes
- Exceptions:
  - None.

## Verification Ladder
| Slice | Tier | Evidence |
|---|---|---|
| S-1 | command | npm test -- PASS |

## Learnings
- None
`;

describe("tdd_slice_lane_metadata_missing (v6.13.1)", () => {
  it("fires when GREEN completed row omits lane lease fields under worktree-first", async () => {
    const root = await createTempProject("tdd-lane-meta-miss");
    await seedWorktreeFirst(root);
    await fs.mkdir(path.join(root, ".cclaw/artifacts"), { recursive: true });
    for (const [name, body] of Object.entries(PRE_TDD)) {
      await fs.writeFile(path.join(root, ".cclaw/artifacts", name), body, "utf8");
    }
    await fs.writeFile(path.join(root, ".cclaw/artifacts/06-tdd.md"), TDD_MIN, "utf8");

    const iso = new Date().toISOString();
    await appendDelegation(root, {
      stage: "tdd",
      agent: "test-author",
      mode: "mandatory",
      status: "completed",
      sliceId: "S-1",
      phase: "red",
      evidenceRefs: ["tests/x.spec.ts"],
      spanId: "span-r1",
      ts: iso,
      completedTs: iso
    });
    await appendDelegation(root, {
      stage: "tdd",
      agent: "slice-implementer",
      mode: "mandatory",
      status: "completed",
      sliceId: "S-1",
      phase: "green",
      evidenceRefs: ["tests/x.spec.ts"],
      spanId: "span-g1",
      ts: iso,
      completedTs: iso,
      claimToken: "tok",
      ownerLaneId: "lane-1"
      // leasedUntil missing
    });
    await appendDelegation(root, {
      stage: "tdd",
      agent: "slice-documenter",
      mode: "mandatory",
      status: "completed",
      sliceId: "S-1",
      phase: "doc",
      evidenceRefs: [".cclaw/artifacts/tdd-slices/S-1.md"],
      spanId: "span-d1",
      ts: iso,
      completedTs: iso
    });
    await appendDelegation(root, {
      stage: "tdd",
      agent: "slice-implementer",
      mode: "mandatory",
      status: "completed",
      sliceId: "S-1",
      phase: "refactor",
      evidenceRefs: ["noop"],
      spanId: "span-f1",
      ts: iso,
      completedTs: iso,
      claimToken: "tok"
    });

    const result = await lintArtifact(root, "tdd");
    const hit = result.findings.find((f) => f.section === "tdd_slice_lane_metadata_missing");
    expect(hit).toBeDefined();
  });

  it("passes when GREEN carries claim, lane, and lease", async () => {
    const root = await createTempProject("tdd-lane-meta-ok");
    await seedWorktreeFirst(root);
    await fs.mkdir(path.join(root, ".cclaw/artifacts"), { recursive: true });
    for (const [name, body] of Object.entries(PRE_TDD)) {
      await fs.writeFile(path.join(root, ".cclaw/artifacts", name), body, "utf8");
    }
    await fs.writeFile(path.join(root, ".cclaw/artifacts/06-tdd.md"), TDD_MIN, "utf8");

    const iso = new Date().toISOString();
    const lease = new Date(Date.now() + 3_600_000).toISOString();
    await appendDelegation(root, {
      stage: "tdd",
      agent: "test-author",
      mode: "mandatory",
      status: "completed",
      sliceId: "S-1",
      phase: "red",
      evidenceRefs: ["tests/x.spec.ts"],
      spanId: "span-r1",
      ts: iso,
      completedTs: iso
    });
    await appendDelegation(root, {
      stage: "tdd",
      agent: "slice-implementer",
      mode: "mandatory",
      status: "completed",
      sliceId: "S-1",
      phase: "green",
      evidenceRefs: ["tests/x.spec.ts"],
      spanId: "span-g1",
      ts: iso,
      completedTs: iso,
      claimToken: "tok",
      ownerLaneId: "lane-1",
      leasedUntil: lease
    });
    await appendDelegation(root, {
      stage: "tdd",
      agent: "slice-documenter",
      mode: "mandatory",
      status: "completed",
      sliceId: "S-1",
      phase: "doc",
      evidenceRefs: [".cclaw/artifacts/tdd-slices/S-1.md"],
      spanId: "span-d1",
      ts: iso,
      completedTs: iso
    });
    await appendDelegation(root, {
      stage: "tdd",
      agent: "slice-implementer",
      mode: "mandatory",
      status: "completed",
      sliceId: "S-1",
      phase: "refactor",
      evidenceRefs: ["noop"],
      spanId: "span-f1",
      ts: iso,
      completedTs: iso,
      claimToken: "tok"
    });

    const result = await lintArtifact(root, "tdd");
    const hit = result.findings.find((f) => f.section === "tdd_slice_lane_metadata_missing");
    expect(hit).toBeUndefined();
  });
});
