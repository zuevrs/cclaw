import fs from "node:fs/promises";
import path from "node:path";
import { Writable } from "node:stream";
import { describe, expect, it } from "vitest";
import { stageSchema } from "../../src/content/stage-schema.js";
import { runInternalCommand } from "../../src/internal/advance-stage.js";
import { ensureRunSystem, readFlowState, writeFlowState } from "../../src/runs.js";
import { createTempProject } from "../helpers/index.js";

interface CapturedIo {
  io: { stdout: Writable; stderr: Writable };
  stdout: () => string;
  stderr: () => string;
}

function captureIo(): CapturedIo {
  const stdoutChunks: string[] = [];
  const stderrChunks: string[] = [];
  const stdout = new Writable({
    write(chunk, _encoding, callback) {
      stdoutChunks.push(chunk.toString());
      callback();
    }
  });
  const stderr = new Writable({
    write(chunk, _encoding, callback) {
      stderrChunks.push(chunk.toString());
      callback();
    }
  });
  return {
    io: { stdout, stderr },
    stdout: () => stdoutChunks.join(""),
    stderr: () => stderrChunks.join("")
  };
}

async function writeBrainstormArtifact(
  root: string,
  learningsSection = "- None this stage."
): Promise<void> {
  await fs.mkdir(path.join(root, ".cclaw/artifacts"), { recursive: true });
  await fs.writeFile(path.join(root, ".cclaw/artifacts/01-brainstorm.md"), `# Brainstorm Artifact

## Context
- Project state: monorepo with CI pipeline
- Relevant existing code/patterns: scripts/pre-publish.sh does metadata checks

## Problem
- What we're solving: harden release flow to prevent unsafe publishes
- Success criteria: invalid release metadata blocks publish
- Constraints: no new runtime dependencies

## Clarifying Questions
| # | Question | Answer | Decision impact |
|---|---|---|---|
| 1 | Block invalid metadata or warn? | Block | enforce mandatory gate |
| 2 | Add runtime dependencies? | No | keep existing runtime stack |

## Approaches
| Approach | Architecture | Trade-offs | Recommendation |
|---|---|---|---|
| A | narrow fix | lower risk, weaker reuse |  |
| B | reusable validation module | moderate effort, stronger reuse | recommended |

## Selected Direction
- Approach: B - reusable validation module
- Rationale: best balance of reuse and delivery speed
- Approval: approved

## Design
- Architecture: shared TS module with typed validators
- Key components: validateMetadata, validateChangelog, validateVersion
- Data flow: package.json + CHANGELOG.md -> validator module -> result

## Assumptions and Open Questions
- Assumptions: CI pipeline is stable
- Open questions (or "None"): None

## Learnings
${learningsSection}
`, "utf8");
}

async function writeScopeArtifact(root: string): Promise<void> {
  await fs.mkdir(path.join(root, ".cclaw/artifacts"), { recursive: true });
  await fs.writeFile(path.join(root, ".cclaw/artifacts/02-scope.md"), `# Scope Artifact

## Scope Mode
- Mode: broad

## In Scope / Out of Scope
- In scope: lock down requirements and interfaces.
- Out of scope: implementation and rollout.

## Completion Dashboard
- Required gates: pending
- User approval: pending

## Scope Summary
- Summary: define clear boundaries before design.

## Learnings
- None this stage.
`, "utf8");
}

describe("internal advance-stage commands", () => {
  it("advance-stage promotes stage and writes required gate evidence", async () => {
    const root = await createTempProject("internal-advance-stage");
    await ensureRunSystem(root);
    await writeBrainstormArtifact(root);

    const captured = captureIo();
    const code = await runInternalCommand(
      root,
      ["advance-stage", "brainstorm", "--quiet"],
      captured.io
    );

    expect(code).toBe(0);
    expect(captured.stderr()).toBe("");

    const state = await readFlowState(root);
    expect(state.currentStage).toBe("scope");
    expect(state.completedStages).toContain("brainstorm");

    const required = stageSchema("brainstorm").requiredGates
      .filter((gate) => gate.tier === "required")
      .map((gate) => gate.id);
    for (const gateId of required) {
      expect(state.stageGateCatalog.brainstorm.passed).toContain(gateId);
      expect(state.guardEvidence[gateId]).toBeTruthy();
    }
  });

  it("verify-flow-state-diff rejects candidate state with passed gate but no evidence", async () => {
    const root = await createTempProject("internal-verify-diff");
    await ensureRunSystem(root);
    await writeBrainstormArtifact(root);

    const current = await readFlowState(root);
    const firstRequired = stageSchema("brainstorm").requiredGates
      .filter((gate) => gate.tier === "required")
      .map((gate) => gate.id)[0];
    if (!firstRequired) {
      throw new Error("expected at least one required brainstorm gate");
    }
    const candidate = {
      ...current,
      stageGateCatalog: {
        ...current.stageGateCatalog,
        brainstorm: {
          ...current.stageGateCatalog.brainstorm,
          passed: [firstRequired],
          blocked: []
        }
      },
      guardEvidence: {}
    };

    const captured = captureIo();
    const code = await runInternalCommand(
      root,
      ["verify-flow-state-diff", `--after-json=${JSON.stringify(candidate)}`, "--quiet"],
      captured.io
    );

    expect(code).toBe(1);
    expect(captured.stderr()).toContain("candidate state is invalid");
  });

  it("verify-current-state emits codex-friendly unmet-delegation/gate nudge", async () => {
    const root = await createTempProject("internal-verify-current");
    await ensureRunSystem(root);
    await writeScopeArtifact(root);

    const current = await readFlowState(root);
    const firstScopeRequired = stageSchema("scope").requiredGates
      .filter((gate) => gate.tier === "required")
      .map((gate) => gate.id)[0];
    if (!firstScopeRequired) {
      throw new Error("expected at least one required scope gate");
    }
    await writeFlowState(
      root,
      {
        ...current,
        currentStage: "scope",
        guardEvidence: {},
        stageGateCatalog: {
          ...current.stageGateCatalog,
          scope: {
            ...current.stageGateCatalog.scope,
            passed: [firstScopeRequired],
            blocked: []
          }
        }
      },
      { allowReset: true }
    );

    const captured = captureIo();
    const code = await runInternalCommand(root, ["verify-current-state", "--quiet"], captured.io);

    expect(code).toBe(1);
    expect(captured.stderr()).toContain(
      "cclaw: current stage has 1 unmet mandatory delegations and 1 gates without evidence."
    );
  });

  it("harvests Learnings JSON bullets into knowledge store and marks artifact", async () => {
    const root = await createTempProject("internal-harvest-learnings");
    await ensureRunSystem(root);
    await writeBrainstormArtifact(
      root,
      `- {"type":"pattern","trigger":"when gate evidence is missing","action":"run verify-current-state before trying to advance","confidence":"high","domain":"workflow","universality":"project","maturity":"raw"}`
    );

    const captured = captureIo();
    const code = await runInternalCommand(
      root,
      ["advance-stage", "brainstorm", "--quiet"],
      captured.io
    );

    expect(code).toBe(0);
    expect(captured.stderr()).toBe("");

    const knowledgeRaw = await fs.readFile(path.join(root, ".cclaw/knowledge.jsonl"), "utf8");
    const knowledgeLines = knowledgeRaw.trim().split("\n");
    expect(knowledgeLines).toHaveLength(1);
    const entry = JSON.parse(knowledgeLines[0]!) as {
      type: string;
      trigger: string;
      action: string;
      confidence: string;
      stage: string | null;
      origin_stage: string | null;
    };
    expect(entry.type).toBe("pattern");
    expect(entry.trigger).toBe("when gate evidence is missing");
    expect(entry.action).toContain("verify-current-state");
    expect(entry.confidence).toBe("high");
    expect(entry.stage).toBe("brainstorm");
    expect(entry.origin_stage).toBe("brainstorm");

    const artifact = await fs.readFile(path.join(root, ".cclaw/artifacts/01-brainstorm.md"), "utf8");
    expect(artifact).toContain("<!-- cclaw:learnings-harvested:");
  });
});
