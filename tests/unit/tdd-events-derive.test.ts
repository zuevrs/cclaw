import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { lintArtifact } from "../../src/artifact-linter.js";
import { appendDelegation, readDelegationLedger } from "../../src/delegation.js";
import { createInitialFlowState } from "../../src/flow-state.js";
import { createTempProject } from "../helpers/index.js";

/**
 * v6.11.0 Phase D — TDD linter auto-derives Watched-RED Proof + Vertical
 * Slice Cycle from `delegation-events.jsonl` slice phase rows. These tests
 * cover three paths:
 *
 * 1. Events-only — markdown tables stay empty/template-default; the linter
 *    extracts evidence from `phase=red|green|refactor|refactor-deferred`
 *    rows and auto-renders the summary block in `06-tdd.md`.
 * 2. Legacy markdown-only — no slice phase events; the linter falls back
 *    to parsing `## Watched-RED Proof` and `## Vertical Slice Cycle`.
 * 3. Phase=doc coverage on `discoveryMode=deep` — every slice with a
 *    green event must also carry a `slice-documenter` `phase=doc` event.
 */

const RUN_ID = "run-tdd-events";

async function seedTddRun(
  root: string,
  options: { discoveryMode?: "lean" | "guided" | "deep" } = {}
): Promise<void> {
  await fs.mkdir(path.join(root, ".cclaw/state"), { recursive: true });
  const state = createInitialFlowState({
    activeRunId: RUN_ID,
    track: "standard",
    discoveryMode: options.discoveryMode ?? "guided"
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
| 1 | (stop-signal) | "достаточно, давай драфт" | stop-and-draft |

## Context
- Working on TDD slice events flow.

## Problem Decision Record
- Problem: derive slice tables from delegation events.
- Why now: avoid manual hand-editing.

## Approach Tier
- Tier: standard
- Reasoning: medium-risk refactor.

## Selected Direction
- Direction: implement events-driven TDD.

## Learnings
- None this stage.
`,
  "04-spec.md": `# Spec Artifact

## Acceptance Criteria
- AC-1: TDD slice phases derived from delegation events.

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
- Batch 1: T-1 (independent).

## Acceptance Mapping
- T-1 traces to AC-1.

## Execution Posture
- Posture: sequential.

## Learnings
- None this stage.
`
};

const TDD_BARE_BODY = (extras: string = ""): string => `# TDD Artifact

## Upstream Handoff
- Source artifacts: \`05-plan.md\`, \`04-spec.md\`.
- Decisions carried forward: dispatch test-author/slice-implementer per slice.
- Constraints carried forward: minimal change.
- Open questions: none.
- Drift from upstream (or \`None\`): None.

## Test Discovery
- Overall narrative: existing tests under tests/unit cover the auto-derive surface.

## System-Wide Impact Check
| Slice | Callbacks/state/interfaces/contracts affected | Coverage decision |
|---|---|---|
| S-1 | linter slice cycle | covered by phase events |

## RED Evidence
- Auto-derived from \`delegation-events.jsonl\` phase=red rows.

## Acceptance & Failure Map
| Slice | Source ID | AC ID | Expected behavior | RED-link |
|---|---|---|---|---|
| S-1 | T-1 | AC-1 | Linter accepts events | spanId:span-red-1 |

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

${extras}

## Verification Ladder
| Slice | Tier reached | Evidence |
|---|---|---|
| S-1 | command | npm test -- tdd-events-derive — PASS |

## Learnings
- None this stage.
`;

async function writePreTddArtifacts(root: string): Promise<void> {
  await fs.mkdir(path.join(root, ".cclaw/artifacts"), { recursive: true });
  for (const [name, body] of Object.entries(PRE_TDD_ARTIFACTS)) {
    await fs.writeFile(path.join(root, ".cclaw/artifacts", name), body, "utf8");
  }
}

async function writeTddArtifact(root: string, body: string): Promise<void> {
  await fs.writeFile(path.join(root, ".cclaw/artifacts/06-tdd.md"), body, "utf8");
}

function ts(offsetMin: number): string {
  const base = Date.parse("2026-01-15T10:00:00Z");
  return new Date(base + offsetMin * 60_000).toISOString();
}

describe("tdd linter — phase events auto-derive (v6.11.0 Phase D)", () => {
  it("accepts events-only path: phase=red/green/refactor with no markdown tables", async () => {
    const root = await createTempProject("tdd-events-only");
    await seedTddRun(root);
    await writePreTddArtifacts(root);
    await writeTddArtifact(root, TDD_BARE_BODY());

    await appendDelegation(root, {
      stage: "tdd",
      agent: "test-author",
      mode: "mandatory",
      status: "completed",
      sliceId: "S-1",
      phase: "red",
      evidenceRefs: ["tests/unit/tdd-events-derive.test.ts"],
      spanId: "span-red-1",
      ts: ts(0),
      completedTs: ts(0)
    });
    await appendDelegation(root, {
      stage: "tdd",
      agent: "slice-implementer",
      mode: "proactive",
      status: "completed",
      sliceId: "S-1",
      phase: "green",
      evidenceRefs: ["tests/unit/tdd-events-derive.test.ts"],
      spanId: "span-green-1",
      ts: ts(5),
      completedTs: ts(5)
    });
    await appendDelegation(root, {
      stage: "tdd",
      agent: "slice-implementer",
      mode: "proactive",
      status: "completed",
      sliceId: "S-1",
      phase: "refactor",
      evidenceRefs: ["src/artifact-linter/tdd.ts"],
      spanId: "span-refactor-1",
      ts: ts(10),
      completedTs: ts(10)
    });

    const result = await lintArtifact(root, "tdd");
    const blockers = result.findings
      .filter((f) => f.required && !f.found)
      .filter((f) => !f.section.startsWith("tdd.cohesion_contract"))
      .filter((f) => !f.section.startsWith("tdd.integration_overseer"))
      // v6.12.0 Phase R/M — slice-documenter / slice-implementer mandatory rules
      // are exercised in dedicated tests; this test focuses on phase-event
      // round-trip and table-free rendering, not on the new mandatory roles.
      .filter((f) => f.section !== "tdd_slice_documenter_missing");
    expect(blockers.map((f) => f.section)).toEqual([]);
  });

  it("renders Vertical Slice Cycle auto-block from phase events", async () => {
    const root = await createTempProject("tdd-events-render");
    await seedTddRun(root);
    await writePreTddArtifacts(root);
    const bare = `${TDD_BARE_BODY()}\n<!-- auto-start: tdd-slice-summary -->\n<!-- auto-end: tdd-slice-summary -->\n`;
    await writeTddArtifact(root, bare);

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
      mode: "proactive",
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
      mode: "proactive",
      status: "completed",
      sliceId: "S-1",
      phase: "refactor",
      evidenceRefs: ["src/foo.ts"],
      spanId: "span-refactor-1",
      ts: ts(10),
      completedTs: ts(10)
    });

    await lintArtifact(root, "tdd");
    const rendered = await fs.readFile(
      path.join(root, ".cclaw/artifacts/06-tdd.md"),
      "utf8"
    );
    expect(rendered).toContain("<!-- auto-start: tdd-slice-summary -->");
    expect(rendered).toContain("<!-- auto-end: tdd-slice-summary -->");
    expect(rendered).toContain("## Vertical Slice Cycle");
    expect(rendered).toContain("| S-1 |");
    expect(rendered).toContain(ts(0));
    expect(rendered).toContain(ts(5));

    // Idempotent re-render: a second lint pass produces the same content.
    await lintArtifact(root, "tdd");
    const rerendered = await fs.readFile(
      path.join(root, ".cclaw/artifacts/06-tdd.md"),
      "utf8"
    );
    expect(rerendered).toBe(rendered);
  });

  it("flags phase=green that precedes phase=red as out-of-order", async () => {
    const root = await createTempProject("tdd-events-order");
    await seedTddRun(root);
    await writePreTddArtifacts(root);
    await writeTddArtifact(root, TDD_BARE_BODY());

    await appendDelegation(root, {
      stage: "tdd",
      agent: "test-author",
      mode: "mandatory",
      status: "completed",
      sliceId: "S-1",
      phase: "red",
      evidenceRefs: ["tests/unit/foo.test.ts"],
      spanId: "span-red-1",
      ts: ts(20),
      completedTs: ts(20)
    });
    await appendDelegation(root, {
      stage: "tdd",
      agent: "slice-implementer",
      mode: "proactive",
      status: "completed",
      sliceId: "S-1",
      phase: "green",
      evidenceRefs: ["tests/unit/foo.test.ts"],
      spanId: "span-green-1",
      ts: ts(0),
      completedTs: ts(0)
    });
    await appendDelegation(root, {
      stage: "tdd",
      agent: "slice-implementer",
      mode: "proactive",
      status: "completed",
      sliceId: "S-1",
      phase: "refactor",
      evidenceRefs: ["src/foo.ts"],
      spanId: "span-refactor-1",
      ts: ts(30),
      completedTs: ts(30)
    });

    const result = await lintArtifact(root, "tdd");
    const orderFinding = result.findings.find((f) =>
      f.section.startsWith("tdd_slice_phase_order_invalid")
    );
    expect(orderFinding?.required).toBe(true);
    expect(orderFinding?.found).toBe(false);
  });

  it("requires phase=refactor or refactor-deferred with rationale", async () => {
    const root = await createTempProject("tdd-events-refactor-missing");
    await seedTddRun(root);
    await writePreTddArtifacts(root);
    await writeTddArtifact(root, TDD_BARE_BODY());

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
      mode: "proactive",
      status: "completed",
      sliceId: "S-1",
      phase: "green",
      evidenceRefs: ["tests/unit/foo.test.ts"],
      spanId: "span-green-1",
      ts: ts(5),
      completedTs: ts(5)
    });

    const result = await lintArtifact(root, "tdd");
    const refactorFinding = result.findings.find((f) =>
      f.section.startsWith("tdd_slice_refactor_missing")
    );
    expect(refactorFinding?.required).toBe(true);
    expect(refactorFinding?.found).toBe(false);
  });

  it("accepts phase=refactor-deferred with non-empty rationale via evidenceRefs", async () => {
    const root = await createTempProject("tdd-events-refactor-deferred");
    await seedTddRun(root);
    await writePreTddArtifacts(root);
    await writeTddArtifact(root, TDD_BARE_BODY());

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
      mode: "proactive",
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
      mode: "proactive",
      status: "completed",
      sliceId: "S-1",
      phase: "refactor-deferred",
      evidenceRefs: ["scope contained — no measurable cleanup yet"],
      spanId: "span-refactor-deferred-1",
      ts: ts(10),
      completedTs: ts(10)
    });

    const result = await lintArtifact(root, "tdd");
    const refactorFinding = result.findings.find((f) =>
      f.section.startsWith("tdd_slice_refactor_missing")
    );
    expect(refactorFinding).toBeUndefined();
  });

  it("falls back to legacy markdown when no slice phase events exist", async () => {
    const root = await createTempProject("tdd-events-legacy-fallback");
    await seedTddRun(root);
    await writePreTddArtifacts(root);
    const legacy = `${TDD_BARE_BODY()}

## Watched-RED Proof
| Slice | Test name | Observed at (ISO ts) | Failure reason snippet | Source command/log |
|---|---|---|---|---|
| S-1 | dedupe fails on duplicate key | 2026-01-15T09:00:00Z | FAIL AssertionError | npm test |

## Vertical Slice Cycle
| Slice | RED ts | GREEN ts | REFACTOR ts |
|---|---|---|---|
| S-1 | 2026-01-15T09:00:00Z | 2026-01-15T09:05:00Z | 2026-01-15T09:09:00Z |
`;
    await writeTddArtifact(root, legacy);

    const result = await lintArtifact(root, "tdd");
    // Legacy fallback: only the slice phase tables matter for this test.
    // (RED/GREEN Evidence content is exercised in the events-only and
    // pointer-mode tests above.)
    const watched = result.findings.find((f) => f.section === "Watched-RED Proof Shape");
    const cycle = result.findings.find((f) => f.section === "Vertical Slice Cycle Coverage");
    expect(watched?.found).toBe(true);
    expect(cycle?.found).toBe(true);
  });

  it("auto-passes RED/GREEN evidence validators when phase events carry evidenceRefs", async () => {
    const root = await createTempProject("tdd-events-evidence-autopass");
    await seedTddRun(root);
    await writePreTddArtifacts(root);
    // Bare RED/GREEN headings only — no markdown content.
    const bareBody = `${TDD_BARE_BODY()}\n## Watched-RED Proof\n\n_Auto-rendered._\n\n## Vertical Slice Cycle\n\n_Auto-rendered._\n`;
    await writeTddArtifact(root, bareBody);

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
      mode: "proactive",
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
      mode: "proactive",
      status: "completed",
      sliceId: "S-1",
      phase: "refactor",
      evidenceRefs: ["src/foo.ts"],
      spanId: "span-refactor-1",
      ts: ts(10),
      completedTs: ts(10)
    });

    const result = await lintArtifact(root, "tdd");
    const red = result.findings.find((f) => f.section === "RED Evidence");
    const green = result.findings.find((f) => f.section === "GREEN Evidence");
    expect(red?.found).toBe(true);
    expect(green?.found).toBe(true);
  });
});

describe("tdd linter — slice-documenter coverage (v6.12.0 Phase R: mandatory regardless of discoveryMode)", () => {
  it("requires phase=doc on every green slice when discoveryMode=deep", async () => {
    const root = await createTempProject("tdd-doc-deep-required");
    await seedTddRun(root, { discoveryMode: "deep" });
    await writePreTddArtifacts(root);
    await writeTddArtifact(root, TDD_BARE_BODY());

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
      mode: "proactive",
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
      mode: "proactive",
      status: "completed",
      sliceId: "S-1",
      phase: "refactor",
      evidenceRefs: ["src/foo.ts"],
      spanId: "span-refactor-1",
      ts: ts(10),
      completedTs: ts(10)
    });

    const result = await lintArtifact(root, "tdd");
    const docFinding = result.findings.find((f) =>
      f.section === "tdd_slice_documenter_missing"
    );
    expect(docFinding?.required).toBe(true);
    expect(docFinding?.found).toBe(false);
  });

  it("requires phase=doc on every green slice when discoveryMode is not deep (v6.12.0 Phase R)", async () => {
    const root = await createTempProject("tdd-doc-not-deep");
    await seedTddRun(root, { discoveryMode: "guided" });
    await writePreTddArtifacts(root);
    await writeTddArtifact(root, TDD_BARE_BODY());

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
      mode: "proactive",
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
      mode: "proactive",
      status: "completed",
      sliceId: "S-1",
      phase: "refactor",
      evidenceRefs: ["src/foo.ts"],
      spanId: "span-refactor-1",
      ts: ts(10),
      completedTs: ts(10)
    });

    const result = await lintArtifact(root, "tdd");
    const docFinding = result.findings.find((f) =>
      f.section === "tdd_slice_documenter_missing"
    );
    expect(docFinding?.required).toBe(true);
    expect(docFinding?.found).toBe(false);
  });
});

describe("tdd delegation entry round-trip (Phase D1)", () => {
  it("preserves sliceId and phase across appendDelegation -> readDelegationLedger", async () => {
    const root = await createTempProject("tdd-events-roundtrip");
    await seedTddRun(root);

    await appendDelegation(root, {
      stage: "tdd",
      agent: "test-author",
      mode: "mandatory",
      status: "completed",
      sliceId: "S-7",
      phase: "red",
      evidenceRefs: ["tests/unit/foo.test.ts"],
      spanId: "span-roundtrip",
      ts: ts(0),
      completedTs: ts(0)
    });

    const ledger = await readDelegationLedger(root);
    const found = ledger.entries.find((entry) => entry.spanId === "span-roundtrip");
    expect(found).toBeDefined();
    expect(found?.sliceId).toBe("S-7");
    expect(found?.phase).toBe("red");
  });
});
