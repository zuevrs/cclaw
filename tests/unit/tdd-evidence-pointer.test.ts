import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { lintArtifact } from "../../src/artifact-linter.js";
import {
  extractEvidencePointers,
  validateTddGreenEvidence,
  validateTddRedEvidence
} from "../../src/artifact-linter/shared.js";
import { appendDelegation } from "../../src/delegation.js";
import { createInitialFlowState } from "../../src/flow-state.js";
import { createTempProject } from "../helpers/index.js";

describe("extractEvidencePointers", () => {
  it("returns the value for a bare `Evidence:` line", () => {
    expect(extractEvidencePointers("Evidence: docs/red-output.txt")).toEqual([
      "docs/red-output.txt"
    ]);
  });

  it("recognises bullet-prefixed pointer lines", () => {
    expect(extractEvidencePointers("- Evidence: artifacts/foo.log")).toEqual([
      "artifacts/foo.log"
    ]);
  });

  it("recognises spanId pointer lines", () => {
    expect(extractEvidencePointers("Evidence: spanId:abc123")).toEqual([
      "spanId:abc123"
    ]);
  });

  it("returns multiple pointers across lines", () => {
    expect(
      extractEvidencePointers(
        ["Evidence: a/b.log", "noise", "- Evidence: spanId:xyz"].join("\n")
      )
    ).toEqual(["a/b.log", "spanId:xyz"]);
  });

  it("ignores lines that don't carry the pointer", () => {
    expect(
      extractEvidencePointers("This is some commentary about the failure.")
    ).toEqual([]);
  });
});

describe("validateTddRedEvidence (v6.11.0 phase-events + pointer mode)", () => {
  it("auto-satisfies when delegation phase=red events carry evidenceRefs for the slice", () => {
    const result = validateTddRedEvidence("", { phaseEventsSatisfied: true });
    expect(result.ok).toBe(true);
    expect(result.details).toMatch(/delegation-events\.jsonl/);
    expect(result.details).toMatch(/phase=red/);
  });

  it("auto-satisfies when an Evidence: pointer was resolved", () => {
    const result = validateTddRedEvidence("(empty)", { pointerSatisfied: true });
    expect(result.ok).toBe(true);
    expect(result.details).toMatch(/pointer/i);
  });

  it("falls back to legacy markers when no pointer/phase-event context", () => {
    const result = validateTddRedEvidence("", {});
    expect(result.ok).toBe(false);
  });

  it("legacy markers still pass", () => {
    const body = [
      "command: npm test",
      "FAIL  tests/foo.spec.ts",
      "AssertionError: expected true"
    ].join("\n");
    const result = validateTddRedEvidence(body, {});
    expect(result.ok).toBe(true);
  });
});

describe("validateTddGreenEvidence (v6.11.0 phase-events + pointer mode)", () => {
  it("auto-satisfies when delegation phase=green events carry evidenceRefs", () => {
    const result = validateTddGreenEvidence("", { phaseEventsSatisfied: true });
    expect(result.ok).toBe(true);
    expect(result.details).toMatch(/delegation-events\.jsonl/);
    expect(result.details).toMatch(/phase=green/);
  });

  it("auto-satisfies via Evidence: pointer", () => {
    const result = validateTddGreenEvidence("(empty)", { pointerSatisfied: true });
    expect(result.ok).toBe(true);
  });

  it("falls back to legacy markers when no pointer/phase-event context", () => {
    const result = validateTddGreenEvidence("", {});
    expect(result.ok).toBe(false);
  });

  it("legacy markers still pass", () => {
    const body = [
      "command: npm test",
      "PASS tests/foo.spec.ts",
      "Tests:  1 passed"
    ].join("\n");
    const result = validateTddGreenEvidence(body, {});
    expect(result.ok).toBe(true);
  });
});

/**
 * v6.11.0 follow-up — pin the legacy `Evidence:` pointer-resolution
 * branch inside `resolveTddEvidencePointerContext`
 * (`src/artifact-linter.ts`).
 *
 * Phase D auto-derive landed an events-satisfied short-circuit, which
 * means the new tests routinely hit the phase-events branch and skip
 * the pre-existing pointer resolver. These end-to-end fixtures keep the
 * legacy markdown-pointer fallback (file-on-disk + `spanId:<id>`) under
 * test so it can't silently rot — one branch where every pointer
 * resolves, and one where neither the path nor the spanId match.
 */
const POINTER_RUN_ID = "run-tdd-pointer-resolve";

async function seedTddRun(root: string): Promise<void> {
  await fs.mkdir(path.join(root, ".cclaw/state"), { recursive: true });
  const state = createInitialFlowState({
    activeRunId: POINTER_RUN_ID,
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

async function writeTddArtifactWithPointers(
  root: string,
  redBody: string,
  greenBody: string
): Promise<void> {
  await fs.mkdir(path.join(root, ".cclaw/artifacts"), { recursive: true });
  const tdd = `# TDD Artifact

## RED Evidence
${redBody}

## GREEN Evidence
${greenBody}

## Learnings
- None this stage.
`;
  await fs.writeFile(path.join(root, ".cclaw/artifacts/06-tdd.md"), tdd, "utf8");
}

describe("resolveTddEvidencePointerContext — legacy Evidence: pointer branch", () => {
  it("auto-satisfies RED via an existing path and GREEN via a known spanId", async () => {
    const root = await createTempProject("tdd-pointer-resolves");
    await seedTddRun(root);

    await fs.mkdir(path.join(root, "artifacts"), { recursive: true });
    await fs.writeFile(
      path.join(root, "artifacts/red-output.txt"),
      "FAIL tests/unit/foo.spec.ts\n",
      "utf8"
    );

    // Seed a delegation entry that contributes a known spanId but no
    // `phase`/`sliceId`, so phase-event auto-satisfy stays false and the
    // pointer resolver is the only thing that can clear RED/GREEN.
    await appendDelegation(root, {
      stage: "tdd",
      agent: "test-author",
      mode: "proactive",
      status: "completed",
      spanId: "span-green-pointer",
      ts: "2026-01-15T10:00:00.000Z",
      completedTs: "2026-01-15T10:00:00.000Z"
    });

    await writeTddArtifactWithPointers(
      root,
      "Evidence: artifacts/red-output.txt",
      "Evidence: spanId:span-green-pointer"
    );

    const result = await lintArtifact(root, "tdd");
    const red = result.findings.find((f) => f.section === "RED Evidence");
    const green = result.findings.find((f) => f.section === "GREEN Evidence");

    expect(red?.found, `RED finding details: ${red?.details}`).toBe(true);
    expect(red?.details).toMatch(/pointer/i);
    expect(green?.found, `GREEN finding details: ${green?.details}`).toBe(true);
    expect(green?.details).toMatch(/pointer/i);
  });

  it("leaves RED and GREEN unsatisfied when the path is missing and the spanId is unknown", async () => {
    const root = await createTempProject("tdd-pointer-unresolved");
    await seedTddRun(root);

    await writeTddArtifactWithPointers(
      root,
      "Evidence: artifacts/missing-red.txt",
      "Evidence: spanId:never-recorded"
    );

    const result = await lintArtifact(root, "tdd");
    const red = result.findings.find((f) => f.section === "RED Evidence");
    const green = result.findings.find((f) => f.section === "GREEN Evidence");

    // Pointers don't resolve → pointerSatisfied stays false → the
    // validators fall through to legacy markers and reject the bare
    // single-line bodies.
    expect(red?.found).toBe(false);
    expect(red?.details).toMatch(/meaningful lines|command|failing output/i);
    expect(green?.found).toBe(false);
    expect(green?.details).toMatch(/meaningful lines|command|passing/i);
  });
});
