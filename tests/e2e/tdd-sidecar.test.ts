import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { lintArtifact } from "../../src/artifact-linter.js";
import { createInitialFlowState } from "../../src/flow-state.js";
import {
  parseTddSliceRecordArgs,
  readTddSliceLedger,
  runTddSliceRecord
} from "../../src/tdd-slices.js";
import { createTempProject } from "../helpers/index.js";

interface CapturedIo {
  stdout: { write(chunk: string): boolean };
  stderr: { write(chunk: string): boolean };
}

function makeIo(): CapturedIo {
  return {
    stdout: {
      write(): boolean {
        return true;
      }
    },
    stderr: {
      write(): boolean {
        return true;
      }
    }
  };
}

async function seedTddArtifact(root: string, runId: string): Promise<void> {
  await fs.mkdir(path.join(root, ".cclaw/state"), { recursive: true });
  const state = createInitialFlowState(runId);
  state.currentStage = "tdd";
  await fs.writeFile(
    path.join(root, ".cclaw/state/flow-state.json"),
    `${JSON.stringify(state, null, 2)}\n`,
    "utf8"
  );
  await fs.mkdir(path.join(root, ".cclaw/artifacts"), { recursive: true });
  // TDD artifact with template-default empty Watched-RED Proof and
  // Vertical Slice Cycle tables. The sidecar carries the slices.
  const artifact = [
    "---",
    "stage: tdd",
    "schema_version: v1",
    "version: 1",
    "locked_decisions: []",
    "inputs_hash: 0",
    "---",
    "",
    "# TDD Artifact",
    "",
    "## Test Discovery",
    "| Slice | Existing tests / helpers / fixtures | Exact command(s) | Pattern to extend |",
    "|---|---|---|---|",
    "| S-1 | tests/foo.spec.ts | npm test -- foo | extend existing pattern |",
    "",
    "## System-Wide Impact Check",
    "| Slice | Callbacks/state/interfaces/contracts affected | Coverage decision |",
    "|---|---|---|",
    "| S-1 | none | covered: simple module |",
    "",
    "## RED Evidence",
    "Evidence: .cclaw/artifacts/06-tdd-slices.jsonl",
    "",
    "## GREEN Evidence",
    "Evidence: .cclaw/artifacts/06-tdd-slices.jsonl",
    "",
    "## REFACTOR Notes",
    "- What changed: formatting cleanup",
    "- Why: readability",
    "- Behavior preserved: yes",
    "",
    "## Traceability",
    "- Plan task IDs: T-1",
    "- Spec criterion IDs: AC-1",
    "",
    "## Iron Law Acknowledgement",
    "- Acknowledged: yes",
    "- Exceptions: None",
    "",
    "## Watched-RED Proof",
    "| Slice | Test | Observed at | Reproduction command |",
    "|---|---|---|---|",
    "| S-1 |  |  |  |",
    "",
    "## Vertical Slice Cycle",
    "| Slice | RED | GREEN | REFACTOR |",
    "|---|---|---|---|",
    "| S-1 |  |  |  |",
    "",
    "## Verification Ladder",
    "- Highest tier reached: command",
    "- Evidence: npm test (pass), commit SHA: abc123",
    ""
  ].join("\n");
  await fs.writeFile(path.join(root, ".cclaw/artifacts/06-tdd.md"), artifact, "utf8");
}

describe("e2e: tdd-sidecar source-of-truth flow", () => {
  it("records 3 slices via tdd-slice-record CLI and the linter accepts the empty markdown tables", async () => {
    const root = await createTempProject("e2e-tdd-sidecar");
    await seedTddArtifact(root, "run-sidecar");

    const slices = [
      { id: "S-1", paths: ["src/foo.ts"], file: "tests/foo.spec.ts" },
      { id: "S-2", paths: ["src/bar.ts"], file: "tests/bar.spec.ts" },
      { id: "S-3", paths: ["src/baz.ts"], file: "tests/baz.spec.ts" }
    ];
    for (const slice of slices) {
      await runTddSliceRecord(
        root,
        parseTddSliceRecordArgs([
          "--slice",
          slice.id,
          "--status",
          "red",
          "--test-file",
          slice.file,
          "--command",
          "npm test",
          "--paths",
          slice.paths.join(",")
        ]),
        makeIo()
      );
      await runTddSliceRecord(
        root,
        parseTddSliceRecordArgs([
          "--slice",
          slice.id,
          "--status",
          "green"
        ]),
        makeIo()
      );
      await runTddSliceRecord(
        root,
        parseTddSliceRecordArgs([
          "--slice",
          slice.id,
          "--status",
          "refactor-deferred",
          "--refactor-rationale",
          "no-op cleanup"
        ]),
        makeIo()
      );
    }

    const ledger = await readTddSliceLedger(root);
    expect(ledger.entries.length).toBe(slices.length * 3);

    const result = await lintArtifact(root, "tdd");
    const watchedRed = result.findings.find((f) => f.section === "Watched-RED Proof Shape");
    const cycle = result.findings.find((f) => f.section === "Vertical Slice Cycle Coverage");
    expect(watchedRed?.found, watchedRed?.details).toBe(true);
    expect(cycle?.found, cycle?.details).toBe(true);

    // Sidecar-aware findings should not surface the legacy
    // tdd_slice_ledger_missing advisory because the JSONL is populated.
    const advisoryMissing = result.findings.find(
      (f) => f.section === "tdd_slice_ledger_missing"
    );
    expect(advisoryMissing).toBeUndefined();
  });
});
