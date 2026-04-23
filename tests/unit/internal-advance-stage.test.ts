import fs from "node:fs/promises";
import path from "node:path";
import { Writable } from "node:stream";
import { describe, expect, it } from "vitest";
import { stageSchema } from "../../src/content/stage-schema.js";
import { ARTIFACT_TEMPLATES } from "../../src/content/templates.js";
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

function requiredGateEvidenceJson(stage: Parameters<typeof stageSchema>[0]): string {
  const requiredGateIds = stageSchema(stage).requiredGates
    .filter((gate) => gate.tier === "required")
    .map((gate) => gate.id);
  const evidence = Object.fromEntries(
    requiredGateIds.map((gateId) => [gateId, `evidence for ${gateId}`])
  );
  return JSON.stringify(evidence);
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

> Review Loop Quality: 0.830 | stop: quality_threshold_met | iterations: 2/3

## Scope Mode
- Mode: broad

## In Scope / Out of Scope
- In scope: lock down requirements and interfaces.
- Out of scope: implementation and rollout.

## Outside Voice Findings
| ID | Dimension | Finding | Disposition | Rationale |
|---|---|---|---|---|
| F-1 | premise_fit | Scope accepted but lacked explicit fallback edges in first draft. | accept | Added failure/rescue boundaries. |

## Spec Review Loop
| Iteration | Quality Score | Findings | Stop decision |
|---|---|---|---|
| 1 | 0.610 | 4 | continue |
| 2 | 0.830 | 1 | stop |
- Stop reason: quality_threshold_met
- Target score: 0.800
- Max iterations: 3
- Unresolved concerns: None

## Completion Dashboard
- Required gates: pending
- User approval: pending

## Scope Summary
- Selected mode: broad
- Strongest challenges: balancing reliability with delivery speed
- Recommended path: lock interfaces and failure boundaries first
- Accepted scope: scope contract and decision boundaries
- Deferred: implementation details
- Explicitly excluded: rollout execution and deployment changes

## Learnings
- None this stage.
`, "utf8");
}

async function writeDesignArtifact(root: string): Promise<void> {
  await fs.mkdir(path.join(root, ".cclaw/artifacts"), { recursive: true });
  await fs.writeFile(path.join(root, ".cclaw/artifacts/03-design.md"), `# Design Artifact

> Review Loop Quality: 0.810 | stop: quality_threshold_met | iterations: 2/3

## Research Fleet Synthesis
| Lens | Key findings | Design impact | Evidence |
|---|---|---|---|
| stack-researcher | Existing queue infra available | Reuse existing queue primitives | docs/queue.md |
| features-researcher | Retry + fallback needed | Explicit rescue paths in diagram | docs/features.md |
| architecture-researcher | Service boundary should remain stable | Keep API + worker split | docs/architecture.md |
| pitfalls-researcher | Silent failures were prior outage root cause | Add user-visible rescue output | docs/pitfalls.md |

## Architecture Boundaries
| Component | Responsibility | Owner |
|---|---|---|
| API_Gateway | Validate and route requests | platform |
| App_Service | Orchestrate domain actions | product |
| Storage_Adapter | Persist state with retries | data |

## Architecture Diagram
\`\`\`
API_Gateway -->|sync: validated request| App_Service
App_Service -.->|async: enqueue persistence| Storage_Adapter
Storage_Adapter -->|timeout error| Fallback_Cache
Fallback_Cache -->|degraded response| API_Gateway
\`\`\`

## Failure Mode Table
| Method | Exception | Rescue | UserSees |
|---|---|---|---|
| persistState | DBTimeout | fallback to cache + retry queue | degraded but explicit warning |

## Security & Threat Model
| Boundary | Threat | Mitigation | Owner |
|---|---|---|---|
| API to service | malformed payload abuse | schema validation + authz checks | platform |

## Observability & Debuggability
| Signal | Source | Alert/Debug path |
|---|---|---|
| retry_queue_depth | queue metric | page on-call + inspect retry_queue_depth dashboard |
| fallback_mode_enabled | structured warning log | trace by request id in log explorer |

## Deployment & Rollout
| Step | Strategy | Rollback plan |
|---|---|---|
| Enable design changes | feature-flag canary rollout | disable flag + redeploy previous build |

## Outside Voice Findings
| ID | Dimension | Finding | Disposition | Rationale |
|---|---|---|---|---|
| F-1 | architecture_fit | First draft missed async/sync distinction. | accept | Diagram now labels sync/async edges. |

## Spec Review Loop
| Iteration | Quality Score | Findings | Stop decision |
|---|---|---|---|
| 1 | 0.620 | 3 | continue |
| 2 | 0.810 | 1 | stop |
- Stop reason: quality_threshold_met
- Target score: 0.800
- Max iterations: 3
- Unresolved concerns: None

## Completion Dashboard
| Review Section | Status | Issues |
|---|---|---|
| Architecture Review | clear | none |
| Security & Threat Model | clear | none |
| Code Quality Review | clear | none |
| Data Flow & Interaction Edge Cases | clear | none |
| Test Review | clear | none |
| Performance Review | clear | none |
| Observability & Debuggability | clear | none |
| Deployment & Rollout Review | clear | none |

**Decisions made:** 4 | **Unresolved:** 0

## Learnings
- None this stage.
`, "utf8");
}

async function writeDesignResearchArtifact(root: string): Promise<void> {
  await fs.mkdir(path.join(root, ".cclaw/artifacts"), { recursive: true });
  await fs.writeFile(path.join(root, ".cclaw/artifacts/02a-research.md"), `# Research Report

## Stack Analysis
| Topic | Finding | Evidence |
|---|---|---|
| runtime | existing stack supports design changes | docs/runtime.md |

## Features & Patterns
| Topic | Finding | Evidence |
|---|---|---|
| retry behavior | bounded retries already used in adjacent modules | docs/patterns.md |

## Architecture Options
| Option | Trade-offs | Recommendation | Evidence |
|---|---|---|---|
| A | less change, weaker resilience | no | docs/options.md |
| B | moderate change, stronger resilience | yes | docs/options.md |

## Pitfalls & Risks
| Risk | Impact | Mitigation | Evidence |
|---|---|---|---|
| silent failure | high | explicit rescue + user-visible fallback | docs/risks.md |

## Synthesis
- Key decisions informed by research: keep API boundary stable, harden rescue paths.
- Open questions: None.
`, "utf8");
}

async function writeTddArtifact(root: string): Promise<void> {
  await fs.mkdir(path.join(root, ".cclaw/artifacts"), { recursive: true });
  await fs.writeFile(path.join(root, ".cclaw/artifacts/06-tdd.md"), `# TDD Artifact

## RED Evidence
- Command: npm test -- tests/unit/internal-advance-stage.test.ts
- Result: expected failure before implementation.

## GREEN Evidence
- Command: npm test -- tests/unit/internal-advance-stage.test.ts
- Result: PASS after implementation.

## REFACTOR Notes
- Simplified helper composition without behavior change.

## Traceability
- Plan task: T-1
- Spec criterion: AC-1

## Learnings
- None this stage.
`, "utf8");
}

async function writeReviewArtifacts(root: string): Promise<void> {
  await fs.mkdir(path.join(root, ".cclaw/artifacts"), { recursive: true });
  const reviewArtifact = (ARTIFACT_TEMPLATES["07-review.md"] ?? "")
    .replace("- APPROVED | APPROVED_WITH_CONCERNS | BLOCKED", "- BLOCKED");
  await fs.writeFile(
    path.join(root, ".cclaw/artifacts/07-review.md"),
    reviewArtifact,
    "utf8"
  );
  await fs.writeFile(
    path.join(root, ".cclaw/artifacts/07-review-army.json"),
    ARTIFACT_TEMPLATES["07-review-army.json"] ?? "{}",
    "utf8"
  );
}

function reviewLoopEvidence(
  stage: "scope" | "design",
  qualityScores: number[],
  stopReason: "quality_threshold_met" | "max_iterations_reached" | "user_opt_out",
  targetScore = 0.8,
  maxIterations = 3
): string {
  return JSON.stringify({
    type: "review-loop",
    version: "1",
    stage,
    artifactPath: `.cclaw/artifacts/${stage === "scope" ? "02-scope.md" : "03-design.md"}`,
    targetScore,
    maxIterations,
    stopReason,
    iterations: qualityScores.map((score, index) => ({
      iteration: index + 1,
      qualityScore: score,
      findingsCount: Math.max(0, Math.round((1 - score) * 10))
    }))
  });
}

describe("internal advance-stage commands", () => {
  it("advance-stage promotes stage and writes required gate evidence", async () => {
    const root = await createTempProject("internal-advance-stage");
    await ensureRunSystem(root);
    await writeBrainstormArtifact(root);

    const captured = captureIo();
    const evidenceJson = requiredGateEvidenceJson("brainstorm");
    const code = await runInternalCommand(
      root,
      ["advance-stage", "brainstorm", `--evidence-json=${evidenceJson}`, "--quiet"],
      captured.io
    );

    expect(code, captured.stderr()).toBe(0);
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

  it("advance-stage rejects passed gates without evidence payload", async () => {
    const root = await createTempProject("internal-advance-stage-missing-evidence");
    await ensureRunSystem(root);
    await writeBrainstormArtifact(root);

    const captured = captureIo();
    const code = await runInternalCommand(
      root,
      ["advance-stage", "brainstorm", "--quiet"],
      captured.io
    );

    expect(code).toBe(1);
    expect(captured.stderr()).toContain("missing --evidence-json entries for passed gates");
  });

  it("advance-stage enforces structured evidence for tdd_verified_before_complete", async () => {
    const root = await createTempProject("internal-advance-stage-tdd-verification-evidence");
    await ensureRunSystem(root);
    await writeTddArtifact(root);
    const state = await readFlowState(root);
    await writeFlowState(
      root,
      {
        ...state,
        currentStage: "tdd",
        completedStages: []
      },
      { allowReset: true }
    );

    const required = stageSchema("tdd").requiredGates
      .filter((gate) => gate.tier === "required")
      .map((gate) => gate.id);
    const malformedEvidence = Object.fromEntries(
      required.map((gateId) => [gateId, `evidence for ${gateId}`])
    ) as Record<string, string>;
    malformedEvidence.tdd_verified_before_complete = "ran npm test with current branch commit abc1234";

    const captured = captureIo();
    const code = await runInternalCommand(
      root,
      [
        "advance-stage",
        "tdd",
        `--evidence-json=${JSON.stringify(malformedEvidence)}`,
        "--waive-delegation=test-author",
        "--waiver-reason=unit_test",
        "--quiet"
      ],
      captured.io
    );

    expect(code).toBe(1);
    expect(captured.stderr()).toContain("gate evidence format check failed");
    expect(captured.stderr()).toContain("tdd_verified_before_complete");
  });

  it("advance-stage rejects scope_user_approved evidence without review-loop envelope", async () => {
    const root = await createTempProject("internal-advance-stage-scope-review-loop-invalid");
    await ensureRunSystem(root);
    await writeScopeArtifact(root);
    const state = await readFlowState(root);
    await writeFlowState(
      root,
      {
        ...state,
        currentStage: "scope",
        completedStages: []
      },
      { allowReset: true }
    );

    const required = stageSchema("scope").requiredGates
      .filter((gate) => gate.tier === "required")
      .map((gate) => gate.id);
    const malformedEvidence = Object.fromEntries(
      required.map((gateId) => [gateId, `evidence for ${gateId}`])
    ) as Record<string, string>;
    malformedEvidence.scope_user_approved = "approved by user";

    const captured = captureIo();
    const code = await runInternalCommand(
      root,
      [
        "advance-stage",
        "scope",
        `--evidence-json=${JSON.stringify(malformedEvidence)}`,
        "--waive-delegation=planner",
        "--waiver-reason=unit_test",
        "--quiet"
      ],
      captured.io
    );

    expect(code).toBe(1);
    expect(captured.stderr()).toContain("gate evidence format check failed");
    expect(captured.stderr()).toContain("scope_user_approved");
  });

  it("advance-stage accepts scope review-loop envelope evidence and advances", async () => {
    const root = await createTempProject("internal-advance-stage-scope-review-loop-valid");
    await ensureRunSystem(root);
    await writeScopeArtifact(root);
    const state = await readFlowState(root);
    await writeFlowState(
      root,
      {
        ...state,
        currentStage: "scope",
        completedStages: []
      },
      { allowReset: true }
    );

    const required = stageSchema("scope").requiredGates
      .filter((gate) => gate.tier === "required")
      .map((gate) => gate.id);
    const evidence = Object.fromEntries(
      required.map((gateId) => [gateId, `evidence for ${gateId}`])
    ) as Record<string, string>;
    evidence.scope_user_approved = reviewLoopEvidence(
      "scope",
      [0.61, 0.83],
      "quality_threshold_met"
    );

    const captured = captureIo();
    const code = await runInternalCommand(
      root,
      [
        "advance-stage",
        "scope",
        `--evidence-json=${JSON.stringify(evidence)}`,
        "--waive-delegation=planner",
        "--waiver-reason=unit_test",
        "--quiet"
      ],
      captured.io
    );

    expect(code, captured.stderr()).toBe(0);
    const next = await readFlowState(root);
    expect(next.currentStage).toBe("design");
    expect(next.guardEvidence.scope_user_approved).toContain(`"type":"review-loop"`);
  });

  it("advance-stage auto-hydrates scope review-loop evidence from artifact when omitted", async () => {
    const root = await createTempProject("internal-advance-stage-scope-review-loop-autofill");
    await ensureRunSystem(root);
    await writeScopeArtifact(root);
    const state = await readFlowState(root);
    await writeFlowState(
      root,
      {
        ...state,
        currentStage: "scope",
        completedStages: []
      },
      { allowReset: true }
    );

    const required = stageSchema("scope").requiredGates
      .filter((gate) => gate.tier === "required")
      .map((gate) => gate.id);
    const evidence = Object.fromEntries(
      required.map((gateId) => [gateId, `evidence for ${gateId}`])
    ) as Record<string, string>;
    delete evidence.scope_user_approved;

    const captured = captureIo();
    const code = await runInternalCommand(
      root,
      [
        "advance-stage",
        "scope",
        `--evidence-json=${JSON.stringify(evidence)}`,
        "--waive-delegation=planner",
        "--waiver-reason=unit_test",
        "--quiet"
      ],
      captured.io
    );

    expect(code, captured.stderr()).toBe(0);
    const next = await readFlowState(root);
    expect(next.currentStage).toBe("design");
    expect(next.guardEvidence.scope_user_approved).toContain(`"type":"review-loop"`);
    expect(next.guardEvidence.scope_user_approved).toContain(`"stage":"scope"`);
  });

  it("advance-stage rejects design architecture gate evidence with mismatched review-loop stage", async () => {
    const root = await createTempProject("internal-advance-stage-design-review-loop-stage-mismatch");
    await ensureRunSystem(root);
    await writeDesignArtifact(root);
    const state = await readFlowState(root);
    await writeFlowState(
      root,
      {
        ...state,
        currentStage: "design",
        completedStages: []
      },
      { allowReset: true }
    );

    const required = stageSchema("design").requiredGates
      .filter((gate) => gate.tier === "required")
      .map((gate) => gate.id);
    const evidence = Object.fromEntries(
      required.map((gateId) => [gateId, `evidence for ${gateId}`])
    ) as Record<string, string>;
    evidence.design_architecture_locked = reviewLoopEvidence(
      "scope",
      [0.65, 0.82],
      "quality_threshold_met"
    );

    const captured = captureIo();
    const code = await runInternalCommand(
      root,
      [
        "advance-stage",
        "design",
        `--evidence-json=${JSON.stringify(evidence)}`,
        "--waive-delegation=planner",
        "--waiver-reason=unit_test",
        "--quiet"
      ],
      captured.io
    );

    expect(code).toBe(1);
    expect(captured.stderr()).toContain("design_architecture_locked");
    expect(captured.stderr()).toContain('stage must be "design"');
  });

  it("advance-stage auto-hydrates design review-loop evidence from artifact when omitted", async () => {
    const root = await createTempProject("internal-advance-stage-design-review-loop-autofill");
    await ensureRunSystem(root);
    await writeDesignArtifact(root);
    await writeDesignResearchArtifact(root);
    const state = await readFlowState(root);
    await writeFlowState(
      root,
      {
        ...state,
        currentStage: "design",
        completedStages: []
      },
      { allowReset: true }
    );

    const required = stageSchema("design").requiredGates
      .filter((gate) => gate.tier === "required")
      .map((gate) => gate.id);
    const evidence = Object.fromEntries(
      required.map((gateId) => [gateId, `evidence for ${gateId}`])
    ) as Record<string, string>;
    delete evidence.design_architecture_locked;

    const captured = captureIo();
    const code = await runInternalCommand(
      root,
      [
        "advance-stage",
        "design",
        `--evidence-json=${JSON.stringify(evidence)}`,
        "--waive-delegation=planner",
        "--waiver-reason=unit_test",
        "--quiet"
      ],
      captured.io
    );

    expect(code, captured.stderr()).toBe(0);
    const next = await readFlowState(root);
    expect(next.currentStage).toBe("spec");
    expect(next.guardEvidence.design_architecture_locked).toContain(`"type":"review-loop"`);
    expect(next.guardEvidence.design_architecture_locked).toContain(`"stage":"design"`);
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

  it("verify-flow-state-diff preserves on-disk guardEvidence when payload omits it", async () => {
    const root = await createTempProject("internal-verify-diff-preserve-evidence");
    await ensureRunSystem(root);
    await writeBrainstormArtifact(root);

    const current = await readFlowState(root);
    const firstRequired = stageSchema("brainstorm").requiredGates
      .filter((gate) => gate.tier === "required")
      .map((gate) => gate.id)[0];
    if (!firstRequired) {
      throw new Error("expected at least one required brainstorm gate");
    }

    // Pre-populate disk state with a real guardEvidence entry so the
    // candidate diff (which omits guardEvidence entirely) must inherit it.
    await writeFlowState(
      root,
      {
        ...current,
        guardEvidence: { [firstRequired]: "previously recorded evidence" },
        stageGateCatalog: {
          ...current.stageGateCatalog,
          brainstorm: {
            ...current.stageGateCatalog.brainstorm,
            passed: [firstRequired],
            blocked: []
          }
        }
      },
      { allowReset: true }
    );

    // Candidate: bumps the catalog but does NOT carry guardEvidence at all.
    const candidate = {
      currentStage: "brainstorm" as const,
      stageGateCatalog: {
        ...current.stageGateCatalog,
        brainstorm: {
          ...current.stageGateCatalog.brainstorm,
          passed: [firstRequired],
          blocked: []
        }
      }
    };

    const captured = captureIo();
    const code = await runInternalCommand(
      root,
      ["verify-flow-state-diff", `--after-json=${JSON.stringify(candidate)}`, "--quiet"],
      captured.io
    );

    // Without preservation this would have failed with `missing guardEvidence
    // entry` because the empty `{}` would replace the real evidence.
    expect(captured.stderr()).not.toContain("missing guardEvidence entry");
    // The remaining required gates are still unsatisfied so the overall
    // verification is allowed to be incomplete — but it must NOT error on
    // the `firstRequired` evidence specifically.
    if (code !== 0) {
      expect(captured.stderr()).not.toMatch(new RegExp(firstRequired));
    }
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

  it("hook subcommand reports missing runtime script", async () => {
    const root = await createTempProject("internal-hook-missing-runtime");
    await ensureRunSystem(root);
    await fs.rm(path.join(root, ".cclaw/hooks/run-hook.mjs"), { force: true });

    const captured = captureIo();
    const code = await runInternalCommand(root, ["hook", "session-start"], captured.io);

    expect(code).toBe(1);
    expect(captured.stderr()).toContain("missing hook runtime");
  });

  it("hook subcommand executes run-hook runtime with hook name", async () => {
    const root = await createTempProject("internal-hook-runtime");
    await ensureRunSystem(root);
    const hookRuntimePath = path.join(root, ".cclaw/hooks/run-hook.mjs");
    await fs.mkdir(path.dirname(hookRuntimePath), { recursive: true });
    await fs.writeFile(
      hookRuntimePath,
      `#!/usr/bin/env node
process.stdout.write(JSON.stringify({ hook: process.argv[2] }) + "\\n");
`,
      "utf8"
    );
    await fs.chmod(hookRuntimePath, 0o755);

    const captured = captureIo();
    const code = await runInternalCommand(root, ["hook", "workflow-guard"], captured.io);

    expect(code).toBe(0);
    expect(captured.stderr()).toBe("");
    expect(captured.stdout()).toContain('"hook":"workflow-guard"');
  });

  it("advance-stage routes review back to tdd when review_verdict_blocked is passed", async () => {
    const root = await createTempProject("internal-advance-stage-review-rewind");
    await ensureRunSystem(root);
    await writeReviewArtifacts(root);
    await writeFlowState(
      root,
      {
        ...await readFlowState(root),
        currentStage: "review",
        track: "quick",
        completedStages: []
      },
      { allowReset: true }
    );

    const required = stageSchema("review", "quick").requiredGates
      .filter((gate) => gate.tier === "required")
      .map((gate) => gate.id);
    const blockedGuard = "review_verdict_blocked";
    const passed = [...required, blockedGuard];
    const evidence = Object.fromEntries(
      passed.map((gateId) => [gateId, `evidence for ${gateId}`])
    );

    const captured = captureIo();
    const code = await runInternalCommand(
      root,
      [
        "advance-stage",
        "review",
        `--passed=${passed.join(",")}`,
        `--evidence-json=${JSON.stringify(evidence)}`,
        "--waive-delegation=reviewer,security-reviewer",
        "--waiver-reason=unit_test",
        "--quiet"
      ],
      captured.io
    );

    expect(code, captured.stderr()).toBe(0);
    expect(captured.stderr()).toBe("");
    const state = await readFlowState(root);
    expect(state.currentStage).toBe("tdd");
  });

  it("harvests Learnings JSON bullets into knowledge store and marks artifact", async () => {
    const root = await createTempProject("internal-harvest-learnings");
    await ensureRunSystem(root);
    await writeBrainstormArtifact(
      root,
      `- {"type":"pattern","trigger":"when gate evidence is missing","action":"run verify-current-state before trying to advance","confidence":"high","domain":"workflow","universality":"project","maturity":"raw"}`
    );

    const captured = captureIo();
    const evidenceJson = requiredGateEvidenceJson("brainstorm");
    const code = await runInternalCommand(
      root,
      ["advance-stage", "brainstorm", `--evidence-json=${evidenceJson}`, "--quiet"],
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

  it("tdd-red-evidence exits 2 when no failing RED evidence exists for path", async () => {
    const root = await createTempProject("internal-tdd-red-evidence-missing");
    await ensureRunSystem(root);

    const captured = captureIo();
    const code = await runInternalCommand(
      root,
      ["tdd-red-evidence", "--path=src/app.ts"],
      captured.io
    );
    expect(code).toBe(2);
    const payload = JSON.parse(captured.stdout()) as { ok: boolean };
    expect(payload.ok).toBe(false);
  });

  it("tdd-red-evidence returns success when cycle-log has matching failing RED entry", async () => {
    const root = await createTempProject("internal-tdd-red-evidence-cycle-log");
    await ensureRunSystem(root);
    const flow = await readFlowState(root);
    await fs.mkdir(path.join(root, ".cclaw/state"), { recursive: true });
    await fs.writeFile(path.join(root, ".cclaw/state/tdd-cycle-log.jsonl"), [
      JSON.stringify({
        ts: "2026-04-20T00:00:00Z",
        runId: flow.activeRunId,
        stage: "tdd",
        slice: "S-1",
        phase: "red",
        command: "npm test -- tests/unit/app.test.ts",
        files: ["src/app.ts"],
        exitCode: 1
      })
    ].join("\n"), "utf8");

    const captured = captureIo();
    const code = await runInternalCommand(
      root,
      ["tdd-red-evidence", "--path=src/app.ts", `--run-id=${flow.activeRunId}`],
      captured.io
    );
    expect(code).toBe(0);
    const payload = JSON.parse(captured.stdout()) as {
      ok: boolean;
      sources: { tddCycleLog: boolean; autoEvidence: boolean };
    };
    expect(payload.ok).toBe(true);
    expect(payload.sources.tddCycleLog).toBe(true);
    expect(payload.sources.autoEvidence).toBe(false);
  });

  it("tdd-red-evidence accepts auto evidence when cycle log is absent", async () => {
    const root = await createTempProject("internal-tdd-red-evidence-auto");
    await ensureRunSystem(root);
    const flow = await readFlowState(root);
    await fs.mkdir(path.join(root, ".cclaw/state"), { recursive: true });
    await fs.writeFile(path.join(root, ".cclaw/state/tdd-red-evidence.jsonl"), [
      JSON.stringify({
        ts: "2026-04-20T00:05:00Z",
        runId: flow.activeRunId,
        stage: "tdd",
        source: "posttool-auto",
        command: "npm test -- tests/unit/app.test.ts",
        exitCode: 1,
        paths: ["src/feature.ts"]
      })
    ].join("\n"), "utf8");

    const captured = captureIo();
    const code = await runInternalCommand(
      root,
      ["tdd-red-evidence", "--path=src/feature.ts", `--run-id=${flow.activeRunId}`],
      captured.io
    );
    expect(code).toBe(0);
    const payload = JSON.parse(captured.stdout()) as {
      ok: boolean;
      sources: { tddCycleLog: boolean; autoEvidence: boolean };
    };
    expect(payload.ok).toBe(true);
    expect(payload.sources.tddCycleLog).toBe(false);
    expect(payload.sources.autoEvidence).toBe(true);
  });
});
