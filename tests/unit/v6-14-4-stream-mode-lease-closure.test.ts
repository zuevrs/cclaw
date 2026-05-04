import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { lintArtifact } from "../../src/artifact-linter.js";
import {
  ensureRunSystem,
  readFlowState,
  writeFlowState
} from "../../src/runs.js";
import { createTempProject } from "../helpers/index.js";

/**
 * v6.14.4 — `tdd_lease_expired_unreclaimed` MUST recognize stream-mode
 * (per-slice checkpoint) closure: a `phase=green status=completed` row
 * carrying `refactorOutcome` (mode `inline` or `deferred`) IS the
 * slice's terminal closure. Without this, every stream-mode slice
 * incorrectly fired the "lease expired but never reclaimed" finding
 * once its lease window closed, even though the closure event already
 * exists in the ledger.
 *
 * The S-17 row this regression test targets is the literal hox shape:
 *   { phase: "green", status: "completed", refactorOutcome: { mode: "deferred" }, ... }
 * with `leasedUntil` ~1h after `completedTs` and the wall clock now in
 * the future relative to both. v6.14.0..v6.14.3 only treated
 * `phase ∈ { refactor, refactor-deferred, resolve-conflict }` rows as
 * terminal — which silently broke any stream-mode project.
 */

const TDD_ARTIFACT = `# TDD Artifact

## Test Discovery
- Stub.

## Iron Law Acknowledgement
- Iron Law: NO PRODUCTION CODE WITHOUT A FAILING TEST FIRST.
- Acknowledged: yes
- Exceptions invoked (or \`- None.\`):
  - None.
`;

interface SeedOptions {
  /**
   * Slice id to use for the post-cutover slice in question. Default is
   * `S-17` (matches hox's reproducer). The slice is positioned ABOVE
   * `tddWorktreeCutoverSliceId: "S-16"` so the legacy amnesty path is
   * NOT exempting it — the only exemption that can fire for this test
   * is `closedBeforeLeaseExpiry`, which is the codepath under test.
   */
  sliceId?: string;
}

async function seedPostCutoverProject(
  root: string,
  _options: SeedOptions = {}
): Promise<string> {
  await ensureRunSystem(root);
  const state = await readFlowState(root);
  await writeFlowState(
    root,
    {
      ...state,
      currentStage: "tdd",
      completedStages: ["brainstorm", "scope", "design", "spec", "plan"],
      legacyContinuation: true,
      worktreeExecutionMode: "worktree-first",
      tddCutoverSliceId: "S-11",
      tddWorktreeCutoverSliceId: "S-16",
      tddCheckpointMode: "per-slice"
    },
    { allowReset: true }
  );
  await fs.mkdir(path.join(root, ".cclaw/artifacts"), { recursive: true });
  await fs.writeFile(
    path.join(root, ".cclaw/artifacts/06-tdd.md"),
    TDD_ARTIFACT,
    "utf8"
  );
  return state.activeRunId;
}

async function writeEvents(
  root: string,
  runId: string,
  entries: Record<string, unknown>[]
): Promise<void> {
  await fs.writeFile(
    path.join(root, ".cclaw/state/delegation-log.json"),
    JSON.stringify({ runId, schemaVersion: 3, entries }, null, 2),
    "utf8"
  );
  await fs.writeFile(
    path.join(root, ".cclaw/state/delegation-events.jsonl"),
    entries.map((e) => JSON.stringify(e)).join("\n") + "\n",
    "utf8"
  );
}

const COMPLETED_TS = "2026-04-20T10:00:00Z";
const LEASED_UNTIL_PAST = "2026-04-20T11:00:00Z"; // expired (clock now is 2026-05+)

function findingsFor(
  results: { findings: { section: string; required?: boolean }[] },
  section: string
): { section: string; required?: boolean }[] {
  return results.findings.filter((f) => f.section === section);
}

describe("v6.14.4 Bug 2 — stream-mode lease closure recognition", () => {
  it("recognizes phase=green refactorOutcome.mode=inline as closure (no tdd_lease_expired_unreclaimed)", async () => {
    const root = await createTempProject(
      "v6-14-4-stream-closure-inline"
    );
    const runId = await seedPostCutoverProject(root);
    await writeEvents(root, runId, [
      {
        stage: "tdd",
        agent: "slice-implementer",
        mode: "mandatory",
        status: "completed",
        event: "completed",
        eventTs: COMPLETED_TS,
        ts: COMPLETED_TS,
        completedTs: COMPLETED_TS,
        spanId: "span-s17-green-inline",
        phase: "green",
        sliceId: "S-17",
        runId,
        schemaVersion: 3,
        claimToken: "wave-w03-s17-rel-yml",
        ownerLaneId: "release-yml",
        leasedUntil: LEASED_UNTIL_PAST,
        leaseState: "claimed",
        refactorOutcome: {
          mode: "inline",
          rationale: "extracted the helper before commit"
        },
        evidenceRefs: ["green ok"]
      }
    ]);

    const result = await lintArtifact(root, "tdd");
    expect(findingsFor(result, "tdd_lease_expired_unreclaimed")).toEqual([]);
  });

  it("recognizes phase=green refactorOutcome.mode=deferred as closure (the literal hox S-17 shape)", async () => {
    const root = await createTempProject(
      "v6-14-4-stream-closure-deferred"
    );
    const runId = await seedPostCutoverProject(root);
    await writeEvents(root, runId, [
      {
        stage: "tdd",
        agent: "slice-implementer",
        mode: "mandatory",
        status: "completed",
        event: "completed",
        eventTs: COMPLETED_TS,
        ts: COMPLETED_TS,
        completedTs: COMPLETED_TS,
        spanId: "span-s17-green-deferred",
        phase: "green",
        sliceId: "S-17",
        runId,
        schemaVersion: 3,
        claimToken: "wave-w03-s17-rel-yml",
        ownerLaneId: "release-yml",
        leasedUntil: LEASED_UNTIL_PAST,
        leaseState: "claimed",
        refactorOutcome: {
          mode: "deferred",
          rationale:
            "No refactor taken: minimal workflow wiring plus .gitkeep scaffold; workflow test helper extraction deferred until another Job-B consumer repeats the same TODO-filter/windowing pattern."
        },
        evidenceRefs: [
          "REGRESSION: cargo test -p hermes-types --test release_yml_lint --no-fail-fast => 8 passed; 0 failed"
        ]
      }
    ]);

    const result = await lintArtifact(root, "tdd");
    expect(findingsFor(result, "tdd_lease_expired_unreclaimed")).toEqual([]);
  });

  it("STILL flags phase=green status=completed without refactorOutcome (genuinely-stuck slice)", async () => {
    const root = await createTempProject(
      "v6-14-4-stream-closure-no-outcome"
    );
    const runId = await seedPostCutoverProject(root);
    await writeEvents(root, runId, [
      {
        stage: "tdd",
        agent: "slice-implementer",
        mode: "mandatory",
        status: "completed",
        event: "completed",
        eventTs: COMPLETED_TS,
        ts: COMPLETED_TS,
        completedTs: COMPLETED_TS,
        spanId: "span-s17-green-bare",
        phase: "green",
        sliceId: "S-17",
        runId,
        schemaVersion: 3,
        claimToken: "wave-w03-s17-rel-yml",
        ownerLaneId: "release-yml",
        leasedUntil: LEASED_UNTIL_PAST,
        leaseState: "claimed",
        evidenceRefs: ["green ok but no refactor decision recorded"]
      }
    ]);

    const result = await lintArtifact(root, "tdd");
    const expired = findingsFor(result, "tdd_lease_expired_unreclaimed");
    expect(expired).toHaveLength(1);
    expect(expired[0]?.required).toBe(true);
  });

  it("recognizes legacy v6.13 separate phase=refactor-deferred row as closure (regression test)", async () => {
    const root = await createTempProject(
      "v6-14-4-stream-closure-legacy-refactor-deferred"
    );
    const runId = await seedPostCutoverProject(root);
    await writeEvents(root, runId, [
      {
        stage: "tdd",
        agent: "slice-implementer",
        mode: "mandatory",
        status: "completed",
        event: "completed",
        eventTs: COMPLETED_TS,
        ts: COMPLETED_TS,
        completedTs: COMPLETED_TS,
        spanId: "span-s17-green-legacy",
        phase: "green",
        sliceId: "S-17",
        runId,
        schemaVersion: 3,
        claimToken: "wave-w03-s17-rel-yml",
        ownerLaneId: "release-yml",
        leasedUntil: LEASED_UNTIL_PAST,
        leaseState: "claimed",
        evidenceRefs: ["green ok"]
      },
      // Legacy v6.13 path: a separate phase=refactor-deferred terminal
      // row recorded after GREEN. The ledger projection sometimes does
      // not carry claim/lane/lease metadata on this row — see the
      // v6.14.3 amnesty test.
      {
        stage: "tdd",
        agent: "slice-implementer",
        mode: "mandatory",
        status: "completed",
        event: "completed",
        eventTs: COMPLETED_TS,
        ts: COMPLETED_TS,
        completedTs: COMPLETED_TS,
        spanId: "span-s17-defer",
        phase: "refactor-deferred",
        sliceId: "S-17",
        runId,
        schemaVersion: 3,
        evidenceRefs: ["scope contained"]
      }
    ]);

    const result = await lintArtifact(root, "tdd");
    expect(findingsFor(result, "tdd_lease_expired_unreclaimed")).toEqual([]);
  });
});
