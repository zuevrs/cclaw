import fs from "node:fs/promises";
import path from "node:path";
import { Writable } from "node:stream";
import { describe, expect, it } from "vitest";
import { stageSchema } from "../../src/content/stage-schema.js";
import { runInternalCommand } from "../../src/internal/advance-stage.js";
import { issueWaiverToken } from "../../src/internal/waiver-grant.js";
import { ensureRunSystem, readFlowState } from "../../src/runs.js";
import type { FlowStage } from "../../src/types.js";
import { createTempProject } from "../helpers/index.js";

/**
 * Wave 23 (v5.0.0) behavioural floor tests. These exercise the live
 * `advance-stage` command path so the linter, gate-evidence layer, and
 * persisted `interactionHints` flag all stay wired with the new
 * `qa_log_unconverged` rule.
 *
 * Convergence sources covered:
 *   1. Empty Q&A Log -> stage-complete is BLOCKED with `qa_log_unconverged`.
 *   2. Stop-signal row -> stage-complete is ALLOWED on the same artifact.
 *   3. Forcing-question coverage -> stage-complete is ALLOWED via convergence.
 *   4. `--skip-questions` flag -> stage-complete is ALLOWED with the floor
 *      finding downgraded to advisory.
 *
 * Wave 23 removed the count-based floor (no more "10 substantive entries"
 * requirement) and the `CCLAW_ELICITATION_FLOOR=advisory` env override.
 */

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

function requiredGateEvidenceJson(stage: Parameters<typeof stageSchema>[0]): string {
  const requiredGateIds = stageSchema(stage).requiredGates
    .filter((gate) => gate.tier === "required")
    .map((gate) => gate.id);
  const evidence = Object.fromEntries(
    requiredGateIds.map((gateId) => [gateId, `evidence for ${gateId}`])
  );
  return JSON.stringify(evidence);
}

async function proactiveWaiverFlags(
  projectRoot: string,
  stage: FlowStage,
  reason: string = "floor_behavioural_test"
): Promise<string[]> {
  const record = await issueWaiverToken(projectRoot, {
    stage,
    reason,
    issuerSubsystem: "e2e-test"
  });
  return [
    `--accept-proactive-waiver=${record.token}`,
    `--accept-proactive-waiver-reason=${reason}`
  ];
}

const BRAINSTORM_BODY_NO_QA = `## Context
- Project state: monorepo with CI pipeline
- Relevant existing code/patterns: scripts/pre-publish.sh does metadata checks

## Problem Decision Record
- What we're solving: harden release flow to prevent unsafe publishes
- Success criteria: invalid release metadata blocks publish
- Constraints: no new runtime dependencies

## Clarifying Questions
| # | Question | Answer | Decision impact |
|---|---|---|---|
| 1 | Block invalid metadata or warn? | Block | enforce mandatory gate |
| 2 | Add runtime dependencies? | No | keep existing runtime stack |

## Approach Tier
- Tier: Standard
- Why this tier: spans CI + local release scripts but remains bounded.

## Short-Circuit Decision
- Status: bypassed
- Why: options and trade-offs were still needed before locking direction.
- Scope handoff: continue full brainstorm flow before scope.

## Approaches
| Approach | Role | Upside | Architecture | Trade-offs | Recommendation |
|---|---|---|---|---|---|
| A | baseline | modest | narrow fix | lower risk, weaker reuse |  |
| B | challenger | higher | reusable validation module | moderate effort, stronger reuse | recommended |

## Approach Reaction
- Closest option: B
- Concerns: prevent v1 overbuild while maximizing reuse.
- What changed after reaction: recommendation stayed on B with reduced initial scope.

## Selected Direction
- Approach: B - reusable validation module
- Rationale: user reaction emphasized bounded v1 scope, so B gives best balance of reuse and delivery speed
- Approval: approved
- Next-stage handoff: scope — lock the validator module boundary and bounded v1 reach.

## Design
- Architecture: shared TS module with typed validators
- Key components: validateMetadata, validateChangelog, validateVersion
- Data flow: package.json + CHANGELOG.md -> validator module -> result

## Assumptions and Open Questions
- Assumptions: CI pipeline is stable
- Open questions (or "None"): None

## Learnings
- None this stage.
`;

const QA_LOG_STOP_SIGNAL_BLOCK = `## Q&A Log
| Turn | Question | User answer (1-line) | Decision impact |
|---|---|---|---|
| 1 | (stop-signal) | "достаточно, давай драфт" | stop-and-draft |

`;

const QA_LOG_FORCING_COVERAGE_BLOCK = `## Q&A Log
| Turn | Question | User answer (1-line) | Decision impact |
|---|---|---|---|
| 1 | What pain are we solving for users today? | Manual release metadata audit. | locks-problem [topic:pain] |
| 2 | What is the direct path to fix it? | Reusable validator module. | locks-architecture [topic:direct-path] |
| 3 | Who is the first operator/user affected? | Release manager on call. | persona-shaping [topic:operator] |
| 4 | What no-go boundaries are non-negotiable? | No new runtime deps in v1. | scope-shaping [topic:no-go] |

`;

async function writeBrainstormArtifact(root: string, qaLogBlock: string = ""): Promise<void> {
  await fs.mkdir(path.join(root, ".cclaw/artifacts"), { recursive: true });
  await fs.writeFile(
    path.join(root, ".cclaw/artifacts/01-brainstorm.md"),
    `# Brainstorm Artifact\n\n${qaLogBlock}${BRAINSTORM_BODY_NO_QA}`,
    "utf8"
  );
}

describe("Wave 23 elicitation convergence floor (behavioural)", () => {
  it("blocks brainstorm advance when Q&A Log is empty (qa_log_unconverged)", async () => {
    const root = await createTempProject("floor-empty-qa-blocks");
    await ensureRunSystem(root);
    await writeBrainstormArtifact(root, "");

    const captured = captureIo();
    const code = await runInternalCommand(
      root,
      [
        "advance-stage",
        "brainstorm",
        `--evidence-json=${requiredGateEvidenceJson("brainstorm")}`,
        "--waive-delegation=product-discovery,critic",
        "--waiver-reason=floor_test",
        ...(await proactiveWaiverFlags(root, "brainstorm"))
      ],
      captured.io
    );

    expect(code).toBe(1);
    expect(captured.stderr()).toContain("qa_log_unconverged");
    expect(captured.stderr()).toMatch(/unconverged/iu);

    const state = await readFlowState(root);
    expect(state.completedStages).not.toContain("brainstorm");
    expect(state.currentStage).toBe("brainstorm");
  });

  it("unblocks brainstorm advance when an explicit stop-signal row is recorded", async () => {
    const root = await createTempProject("floor-stop-signal-unblocks");
    await ensureRunSystem(root);
    await writeBrainstormArtifact(root, QA_LOG_STOP_SIGNAL_BLOCK);

    const captured = captureIo();
    const code = await runInternalCommand(
      root,
      [
        "advance-stage",
        "brainstorm",
        `--evidence-json=${requiredGateEvidenceJson("brainstorm")}`,
        "--waive-delegation=product-discovery,critic",
        "--waiver-reason=floor_test",
        ...(await proactiveWaiverFlags(root, "brainstorm"))
      ],
      captured.io
    );

    expect(code, captured.stderr()).toBe(0);

    const state = await readFlowState(root);
    expect(state.completedStages).toContain("brainstorm");
    expect(state.currentStage).toBe("scope");
  });

  it("unblocks brainstorm advance when forcing-question topics are covered", async () => {
    const root = await createTempProject("floor-forcing-coverage-unblocks");
    await ensureRunSystem(root);
    await writeBrainstormArtifact(root, QA_LOG_FORCING_COVERAGE_BLOCK);

    const captured = captureIo();
    const code = await runInternalCommand(
      root,
      [
        "advance-stage",
        "brainstorm",
        `--evidence-json=${requiredGateEvidenceJson("brainstorm")}`,
        "--waive-delegation=product-discovery,critic",
        "--waiver-reason=floor_test",
        ...(await proactiveWaiverFlags(root, "brainstorm"))
      ],
      captured.io
    );

    expect(code, captured.stderr()).toBe(0);
    const state = await readFlowState(root);
    expect(state.completedStages).toContain("brainstorm");
    expect(state.currentStage).toBe("scope");
  });

  it("allows brainstorm advance with --skip-questions even when Q&A Log is empty (advisory floor)", async () => {
    const root = await createTempProject("floor-skip-questions-advisory");
    await ensureRunSystem(root);
    await writeBrainstormArtifact(root, "");

    const captured = captureIo();
    const code = await runInternalCommand(
      root,
      [
        "advance-stage",
        "brainstorm",
        `--evidence-json=${requiredGateEvidenceJson("brainstorm")}`,
        "--waive-delegation=product-discovery,critic",
        "--waiver-reason=floor_test",
        "--skip-questions",
        ...(await proactiveWaiverFlags(root, "brainstorm"))
      ],
      captured.io
    );

    expect(code, captured.stderr()).toBe(0);

    const state = await readFlowState(root);
    expect(state.completedStages).toContain("brainstorm");
    expect(state.currentStage).toBe("scope");
    expect(state.interactionHints?.scope?.skipQuestions).toBe(true);
  });
});
