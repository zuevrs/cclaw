import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  parseTddSliceRecordArgs,
  readTddSliceLedger,
  runTddSliceRecord,
  tddSliceLedgerPath
} from "../../src/tdd-slices.js";
import { createInitialFlowState } from "../../src/flow-state.js";
import { createTempProject } from "../helpers/index.js";

interface CapturedIo {
  stdout: { write(chunk: string): boolean };
  stderr: { write(chunk: string): boolean };
  outBuf: string[];
  errBuf: string[];
}

function makeIo(): CapturedIo {
  const outBuf: string[] = [];
  const errBuf: string[] = [];
  return {
    outBuf,
    errBuf,
    stdout: {
      write(chunk: string): boolean {
        outBuf.push(chunk);
        return true;
      }
    },
    stderr: {
      write(chunk: string): boolean {
        errBuf.push(chunk);
        return true;
      }
    }
  };
}

async function seedFlow(root: string, runId: string): Promise<void> {
  await fs.mkdir(path.join(root, ".cclaw/state"), { recursive: true });
  const state = createInitialFlowState(runId);
  await fs.writeFile(
    path.join(root, ".cclaw/state/flow-state.json"),
    `${JSON.stringify(state, null, 2)}\n`,
    "utf8"
  );
}

describe("tdd-slice-record argument parsing", () => {
  it("parses the canonical RED invocation", () => {
    const args = parseTddSliceRecordArgs([
      "--slice", "S-1",
      "--status", "red",
      "--test-file", "tests/foo.spec.ts",
      "--command", "npm test -- foo",
      "--paths", "src/foo.ts,src/bar.ts",
      "--ac", "AC-1",
      "--plan-unit", "U-3"
    ]);
    expect(args.sliceId).toBe("S-1");
    expect(args.status).toBe("red");
    expect(args.testFile).toBe("tests/foo.spec.ts");
    expect(args.testCommand).toBe("npm test -- foo");
    expect(args.claimedPaths).toEqual(["src/foo.ts", "src/bar.ts"]);
    expect(args.acceptanceCriterionId).toBe("AC-1");
    expect(args.planUnitId).toBe("U-3");
  });

  it("rejects refactor-deferred without rationale", () => {
    expect(() =>
      parseTddSliceRecordArgs([
        "--slice", "S-1",
        "--status", "refactor-deferred"
      ])
    ).toThrow(/refactor-deferred requires --refactor-rationale/);
  });

  it("rejects unknown status values", () => {
    expect(() =>
      parseTddSliceRecordArgs([
        "--slice", "S-1",
        "--status", "magenta"
      ])
    ).toThrow(/--status must be one of/);
  });
});

describe("tdd-slice-record CLI behavior", () => {
  it("requires test-file/command/paths on first RED row", async () => {
    const root = await createTempProject("tdd-slice-record-red-required");
    await seedFlow(root, "run-1");
    const args = parseTddSliceRecordArgs([
      "--slice", "S-1",
      "--status", "red"
    ]);
    const io = makeIo();
    await expect(runTddSliceRecord(root, args, io)).rejects.toThrow(
      /requires --test-file/
    );
  });

  it("appends a row to the JSONL sidecar with auto-stamped redObservedAt", async () => {
    const root = await createTempProject("tdd-slice-record-red-append");
    await seedFlow(root, "run-1");
    const args = parseTddSliceRecordArgs([
      "--slice", "S-1",
      "--status", "red",
      "--test-file", "tests/foo.spec.ts",
      "--command", "npm test -- foo",
      "--paths", "src/foo.ts"
    ]);
    const io = makeIo();
    const code = await runTddSliceRecord(root, args, io);
    expect(code).toBe(0);
    const ledger = await readTddSliceLedger(root);
    expect(ledger.entries).toHaveLength(1);
    const entry = ledger.entries[0]!;
    expect(entry.sliceId).toBe("S-1");
    expect(entry.status).toBe("red");
    expect(entry.runId).toBe("run-1");
    expect(entry.testFile).toBe("tests/foo.spec.ts");
    expect(entry.testCommand).toBe("npm test -- foo");
    expect(entry.claimedPaths).toEqual(["src/foo.ts"]);
    expect(typeof entry.redObservedAt).toBe("string");
    expect(entry.schemaVersion).toBe(1);
  });

  it("inherits testFile/command/paths from the RED row when GREEN omits them", async () => {
    const root = await createTempProject("tdd-slice-record-inherit");
    await seedFlow(root, "run-1");
    await runTddSliceRecord(root, parseTddSliceRecordArgs([
      "--slice", "S-1",
      "--status", "red",
      "--test-file", "tests/foo.spec.ts",
      "--command", "npm test -- foo",
      "--paths", "src/foo.ts"
    ]), makeIo());
    await runTddSliceRecord(root, parseTddSliceRecordArgs([
      "--slice", "S-1",
      "--status", "green"
    ]), makeIo());
    const ledger = await readTddSliceLedger(root);
    expect(ledger.entries).toHaveLength(2);
    const greenRow = ledger.entries[1]!;
    expect(greenRow.status).toBe("green");
    expect(greenRow.testFile).toBe("tests/foo.spec.ts");
    expect(greenRow.testCommand).toBe("npm test -- foo");
    expect(greenRow.claimedPaths).toEqual(["src/foo.ts"]);
    expect(typeof greenRow.greenAt).toBe("string");
    expect(typeof greenRow.redObservedAt).toBe("string");
  });

  it("idempotent retry: identical re-run does not double-append", async () => {
    const root = await createTempProject("tdd-slice-record-idempotent");
    await seedFlow(root, "run-1");
    const fixedTs = "2026-04-15T10:00:00.000Z";
    const args = parseTddSliceRecordArgs([
      "--slice", "S-1",
      "--status", "red",
      "--test-file", "tests/foo.spec.ts",
      "--command", "npm test",
      "--paths", "src/foo.ts",
      "--red-observed-at", fixedTs
    ]);
    await runTddSliceRecord(root, args, makeIo());
    await runTddSliceRecord(root, args, makeIo());
    const ledger = await readTddSliceLedger(root);
    expect(ledger.entries).toHaveLength(1);
  });

  it("refactor-deferred path requires and stores rationale", async () => {
    const root = await createTempProject("tdd-slice-record-refactor-deferred");
    await seedFlow(root, "run-1");
    await runTddSliceRecord(root, parseTddSliceRecordArgs([
      "--slice", "S-2",
      "--status", "red",
      "--test-file", "tests/bar.spec.ts",
      "--command", "npm test",
      "--paths", "src/bar.ts"
    ]), makeIo());
    await runTddSliceRecord(root, parseTddSliceRecordArgs([
      "--slice", "S-2",
      "--status", "green"
    ]), makeIo());
    await runTddSliceRecord(root, parseTddSliceRecordArgs([
      "--slice", "S-2",
      "--status", "refactor-deferred",
      "--refactor-rationale", "scope churn would block release"
    ]), makeIo());
    const ledger = await readTddSliceLedger(root);
    const last = ledger.entries[ledger.entries.length - 1]!;
    expect(last.status).toBe("refactor-deferred");
    expect(last.refactorRationale).toMatch(/scope churn/);
  });

  it("file-lock writes are atomic enough that a quick second writer does not interleave", async () => {
    const root = await createTempProject("tdd-slice-record-concurrency");
    await seedFlow(root, "run-1");
    const writes = Array.from({ length: 5 }).map((_, i) =>
      runTddSliceRecord(root, parseTddSliceRecordArgs([
        "--slice", `S-${i + 1}`,
        "--status", "red",
        "--test-file", `tests/s${i + 1}.spec.ts`,
        "--command", "npm test",
        "--paths", `src/s${i + 1}.ts`
      ]), makeIo())
    );
    await Promise.all(writes);
    const text = await fs.readFile(tddSliceLedgerPath(root), "utf8");
    const lines = text.split(/\r?\n/u).filter((line) => line.length > 0);
    expect(lines).toHaveLength(5);
    for (const line of lines) {
      expect(() => JSON.parse(line)).not.toThrow();
    }
  });
});
