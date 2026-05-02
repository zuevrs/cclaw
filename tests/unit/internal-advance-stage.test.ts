import fs from "node:fs/promises";
import path from "node:path";
import { Writable } from "node:stream";
import { describe, expect, it } from "vitest";
import { stageSchema } from "../../src/content/stage-schema.js";
import { ARTIFACT_TEMPLATES } from "../../src/content/templates.js";
import { readDelegationLedger } from "../../src/delegation.js";
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

const PROACTIVE_WAIVER_FLAGS = [
  "--accept-proactive-waiver",
  "--accept-proactive-waiver-reason=unit_test_proactive"
] as const;

/**
 * Wave 22: brainstorm/scope/design artifacts must satisfy `qa_log_below_min`
 * floor; tests that focus on lifecycle behaviour use a stop-signal row
 * instead of fully populating Q&A.
 */
const QA_LOG_STOP_SIGNAL_BLOCK = `## Q&A Log
| Turn | Question | User answer (1-line) | Decision impact |
|---|---|---|---|
| 1 | (stop-signal) | "достаточно, давай драфт" | stop-and-draft |

`;

async function writeBrainstormArtifact(
  root: string,
  learningsSection = "- None this stage."
): Promise<void> {
  await fs.mkdir(path.join(root, ".cclaw/artifacts"), { recursive: true });
  await fs.writeFile(path.join(root, ".cclaw/artifacts/01-brainstorm.md"), `# Brainstorm Artifact

${QA_LOG_STOP_SIGNAL_BLOCK}## Context
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
${learningsSection}
`, "utf8");
}

async function writeScopeArtifact(root: string): Promise<void> {
  await fs.mkdir(path.join(root, ".cclaw/artifacts"), { recursive: true });
  await fs.writeFile(path.join(root, ".cclaw/artifacts/02-scope.md"), `# Scope Artifact

${QA_LOG_STOP_SIGNAL_BLOCK}> Review Loop Quality: 0.830 | stop: quality_threshold_met | iterations: 2/3

## Pre-Scope System Audit
| Check | Command | Findings |
|---|---|---|
| Recent commits | git log -30 --oneline | validator pipeline only |
| Current diff | git diff --stat | scope draft only |
| Stash state | git stash list | no pending stash entries |
| Debt markers | rg -n "TODO|FIXME|XXX|HACK" | none |

## Scope Contract
- Selected mode: HOLD SCOPE
- In scope: lock down requirements and interfaces.
- Out of scope: implementation and rollout.
- Requirements: explicit interfaces, failure boundaries, and observability expectations.
- Locked decisions: keep API and worker boundaries stable.
- Discretion areas: naming and low-risk local structure.
- Deferred ideas: rollout execution and deployment changes.
- Accepted reference ideas: existing queue primitives.
- Rejected reference ideas: unbounded platform migration.
- Success definition: scope is approved and ready for design handoff.
- Design handoff: design - lock interfaces, failure boundaries, observability.

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
- Selected mode: HOLD SCOPE
- Strongest challenges: balancing reliability with delivery speed
- Recommended path: lock interfaces and failure boundaries first
- Accepted scope: scope contract and decision boundaries
- Deferred: implementation details
- Explicitly excluded: rollout execution and deployment changes
- Next-stage handoff: design — lock interfaces, failure boundaries, observability.

## Learnings
- None this stage.
`, "utf8");
}

async function writeDesignArtifact(root: string): Promise<void> {
  await fs.mkdir(path.join(root, ".cclaw/artifacts"), { recursive: true });
  await fs.mkdir(path.join(root, "src"), { recursive: true });
  await fs.writeFile(path.join(root, "src/api.ts"), "export const api = 1;\n", "utf8");
  await fs.writeFile(path.join(root, "src/storage.ts"), "export const storage = 1;\n", "utf8");
  await fs.writeFile(path.join(root, ".cclaw/artifacts/03-design.md"), `# Design Artifact

${QA_LOG_STOP_SIGNAL_BLOCK}> Review Loop Quality: 0.810 | stop: quality_threshold_met | iterations: 2/3

## Research Fleet Synthesis
| Lens | Key findings | Design impact | Evidence |
|---|---|---|---|
| stack-researcher | Existing queue infra available | Reuse existing queue primitives | docs/queue.md |
| features-researcher | Retry + fallback needed | Explicit rescue paths in diagram | docs/features.md |
| architecture-researcher | Service boundary should remain stable | Keep API + worker split | docs/architecture.md |
| pitfalls-researcher | Silent failures were prior outage root cause | Add user-visible rescue output | docs/pitfalls.md |

## Codebase Investigation
| File | Current responsibility | Patterns discovered | Existing fit / reuse candidate |
|---|---|---|---|
| src/api.ts | request validation and orchestration | typed error envelopes | reuse existing route pipeline |
| src/storage.ts | storage writes + retries | fallback cache path | reuse retry queue primitive |

## Engineering Lock
- Chosen path: reuse existing queue primitives behind stable API and worker boundaries.
- Shadow alternative: introduce a new persistence pipeline only if retry/fallback evidence fails.
- Switch trigger: fallback path cannot produce user-visible degraded response under timeout.
- Failure/rescue/degraded behavior: timeout enters fallback cache and retry queue with explicit warning.
- Verification evidence: review-loop quality threshold met and diagram rescue path captured.
- Critical path: API_Gateway -> App_Service -> Storage_Adapter -> Fallback_Cache.
- Rollout/rollback: feature-flag canary with prior build rollback.
- Confidence: high.

## Architecture Boundaries
| Component | Responsibility | Owner |
|---|---|---|
| API_Gateway | Validate and route requests | platform |
| App_Service | Orchestrate domain actions | product |
| Storage_Adapter | Persist state with retries | data |

## Architecture Diagram
<!-- diagram: architecture -->
\`\`\`
API_Gateway -->|sync: validated request| App_Service
App_Service -.->|async: enqueue persistence| Storage_Adapter
Storage_Adapter -->|timeout error| Fallback_Cache
Fallback_Cache -->|degraded response| API_Gateway
\`\`\`

## Data-Flow Shadow Paths
<!-- diagram: data-flow-shadow-paths -->
| Path | Trigger | Fallback/Degrade behavior |
|---|---|---|
| persistState | DBTimeout | fallback to cache + retry queue |

## Error Flow Diagram
<!-- diagram: error-flow -->
\`\`\`
DBTimeout -> fallback cache -> degraded response with warning
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

## Spec Handoff
- Requirements: preserve API boundary and explicit fallback/degraded response paths.
- Design decisions: API/service/storage split, retry queue, fallback cache, feature-flag rollout.
- Risks: silent persistence failure and timeout-induced degraded response.
- Test/perf expectations: cover timeout rescue, fallback response, and retry queue observability.
- Unresolved questions: None.

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
    .replace("- APPROVED | APPROVED_WITH_CONCERNS | BLOCKED", "- BLOCKED")
    .replace(
      "- NO_FINDINGS_ATTESTATION: <required when no findings are reported; cite inspected coverage>",
      "- NO_CHANGE_ATTESTATION: review rewind fixture has no security-impacting changes."
    );
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
  it("start-flow initializes track state and writes the idea artifact via managed helper", async () => {
    const root = await createTempProject("internal-start-flow");
    await ensureRunSystem(root);
    await fs.mkdir(path.join(root, ".cclaw/seeds"), { recursive: true });
    await fs.mkdir(path.join(root, "docs/prd"), { recursive: true });
    await fs.writeFile(path.join(root, ".cclaw/seeds/SEED-dashboard.md"), "# Dashboard seed\n", "utf8");
    await fs.writeFile(path.join(root, "docs/prd/web-app.md"), "# Web app PRD\n", "utf8");
    await fs.writeFile(path.join(root, "package.json"), JSON.stringify({ scripts: { test: "vitest run" } }, null, 2), "utf8");

    const captured = captureIo();
    const code = await runInternalCommand(
      root,
      [
        "start-flow",
        "--track=quick",
        "--class=software-bugfix",
        "--prompt=Fix login regression",
        "--stack=Next.js",
        "--reason=bugfix with repro",
        "--quiet"
      ],
      captured.io
    );

    expect(code, captured.stderr()).toBe(0);
    const state = await readFlowState(root);
    expect(state.track).toBe("quick");
    expect(state.currentStage).toBe("spec");
    expect(state.completedStages).toEqual([]);
    expect(state.skippedStages).toEqual(["brainstorm", "scope", "design", "plan"]);
    expect(state.stageGateCatalog.spec.required.length).toBeGreaterThan(0);

    const idea = await fs.readFile(path.join(root, ".cclaw/artifacts/00-idea.md"), "utf8");
    expect(idea).toContain("Class: software-bugfix");
    expect(idea).toContain("Track: quick (bugfix with repro)");
    expect(idea).toContain("Stack: Next.js");
    expect(idea).toContain("Fix login regression");
    expect(idea).toContain("Seed shelf scanned: .cclaw/seeds/SEED-dashboard.md");
    expect(idea).toContain("Origin docs scanned: found docs/prd/web-app.md");
    expect(idea).toContain("Stack markers scanned: found package.json");
  });

  it("start-flow refuses to reset progress without force and reclassifies atomically", async () => {
    const root = await createTempProject("internal-start-flow-reclassify");
    await ensureRunSystem(root);
    const initial = await readFlowState(root);
    const brainstormRequired = stageSchema("brainstorm").requiredGates
      .filter((gate) => gate.tier === "required")
      .map((gate) => gate.id);
    await writeFlowState(
      root,
      {
        ...initial,
        currentStage: "scope",
        completedStages: ["brainstorm"],
        guardEvidence: Object.fromEntries(
          brainstormRequired.map((gateId) => [gateId, `evidence for ${gateId}`])
        ),
        stageGateCatalog: {
          ...initial.stageGateCatalog,
          brainstorm: {
            ...initial.stageGateCatalog.brainstorm,
            passed: brainstormRequired,
            blocked: []
          }
        }
      },
      { allowReset: true }
    );

    const refused = captureIo();
    const refusedCode = await runInternalCommand(
      root,
      ["start-flow", "--track=quick", "--quiet"],
      refused.io
    );
    expect(refusedCode).toBe(1);
    expect(refused.stderr()).toContain("refusing to reset an active flow");

    const before = await readFlowState(root);
    const reclassified = captureIo();
    const code = await runInternalCommand(
      root,
      [
        "start-flow",
        "--reclassify",
        "--track=medium",
        "--class=software-medium",
        "--reason=scope simplified",
        "--quiet"
      ],
      reclassified.io
    );

    expect(code, reclassified.stderr()).toBe(0);
    const after = await readFlowState(root);
    expect(after.activeRunId).toBe(before.activeRunId);
    expect(after.track).toBe("medium");
    expect(after.completedStages).toEqual(["brainstorm"]);
    expect(after.currentStage).toBe("spec");
    expect(after.skippedStages).toEqual(["scope", "design"]);
    for (const gateId of brainstormRequired) {
      expect(after.stageGateCatalog.brainstorm.passed).toContain(gateId);
      expect(after.guardEvidence[gateId]).toBe(`evidence for ${gateId}`);
    }

    const idea = await fs.readFile(path.join(root, ".cclaw/artifacts/00-idea.md"), "utf8");
    expect(idea).toContain("Reclassification:");
    expect(idea).toContain("- From: standard");
    expect(idea).toContain("- To: medium");
    expect(idea).toContain("scope simplified");
  });


  it("reclassification fails when carried completed-stage gates lack closure evidence", async () => {
    const root = await createTempProject("internal-start-flow-reclassify-open-gates");
    await ensureRunSystem(root);
    const initial = await readFlowState(root);
    await fs.writeFile(path.join(root, ".cclaw/artifacts/00-idea.md"), "# Idea\n", "utf8");
    await writeFlowState(
      root,
      {
        ...initial,
        currentStage: "scope",
        completedStages: ["brainstorm"]
      },
      { allowReset: true }
    );

    const captured = captureIo();
    const code = await runInternalCommand(
      root,
      ["start-flow", "--reclassify", "--track=medium", "--reason=missing evidence", "--quiet"],
      captured.io
    );

    expect(code).toBe(1);
    expect(captured.stderr()).toContain("completed stages without valid gate closure");
    const after = await readFlowState(root);
    expect(after.track).toBe("standard");
    expect(after.currentStage).toBe("scope");
  });

  it("advance-stage promotes stage and writes required gate evidence", async () => {
    const root = await createTempProject("internal-advance-stage");
    await ensureRunSystem(root);
    await writeBrainstormArtifact(root);

    const captured = captureIo();
    const evidenceJson = requiredGateEvidenceJson("brainstorm");
    const code = await runInternalCommand(
      root,
      [
        "advance-stage",
        "brainstorm",
        `--evidence-json=${evidenceJson}`,
        "--waive-delegation=product-discovery,critic",
        "--waiver-reason=unit_test",
        ...PROACTIVE_WAIVER_FLAGS,
        "--quiet"
      ],
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

    const ledger = await readDelegationLedger(root);
    const waivedProductManager = ledger.entries.find(
      (entry) => entry.stage === "brainstorm" && entry.agent === "product-discovery" && entry.mode === "mandatory"
    );
    expect(waivedProductManager?.status).toBe("waived");
    expect(waivedProductManager?.waiverReason).toContain("unit_test");
  });

  it("advance-stage persists --skip-questions as successor-stage interaction hint", async () => {
    const root = await createTempProject("internal-advance-stage-skip-questions");
    await ensureRunSystem(root);
    await writeBrainstormArtifact(root);

    const captured = captureIo();
    const evidenceJson = requiredGateEvidenceJson("brainstorm");
    const code = await runInternalCommand(
      root,
      [
        "advance-stage",
        "brainstorm",
        `--evidence-json=${evidenceJson}`,
        "--waive-delegation=product-discovery,critic",
        "--waiver-reason=unit_test",
        ...PROACTIVE_WAIVER_FLAGS,
        "--skip-questions",
        "--quiet"
      ],
      captured.io
    );

    expect(code, captured.stderr()).toBe(0);
    const state = await readFlowState(root);
    expect(state.currentStage).toBe("scope");
    expect(state.interactionHints?.scope).toMatchObject({
      skipQuestions: true,
      sourceStage: "brainstorm"
    });
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

  it("advance-stage requires proactive researcher delegation for guided brainstorm (unless waived)", async () => {
    const root = await createTempProject("internal-advance-stage-proactive-guided-researcher");
    await ensureRunSystem(root);
    await writeBrainstormArtifact(root);

    const evidenceJson = requiredGateEvidenceJson("brainstorm");

    const blocked = captureIo();
    const blockedCode = await runInternalCommand(
      root,
      [
        "advance-stage",
        "brainstorm",
        `--evidence-json=${evidenceJson}`,
        "--waive-delegation=product-discovery,critic",
        "--waiver-reason=unit_test",
        "--quiet"
      ],
      blocked.io
    );
    expect(blockedCode).toBe(1);
    expect(blocked.stderr()).toContain("proactive delegation evidence is missing");
    expect(blocked.stderr()).toContain("researcher");

    const okIo = captureIo();
    const okCode = await runInternalCommand(
      root,
      [
        "advance-stage",
        "brainstorm",
        `--evidence-json=${evidenceJson}`,
        "--waive-delegation=product-discovery,critic",
        "--waiver-reason=unit_test",
        ...PROACTIVE_WAIVER_FLAGS,
        "--quiet"
      ],
      okIo.io
    );
    expect(okCode).toBe(0);
  });

  it("advance-stage fails by default when proactive delegations are missing on deep early elicitation, then allows explicit user-flag waiver", async () => {
    const root = await createTempProject("internal-advance-stage-proactive-waiver-required");
    await ensureRunSystem(root);
    const seeded = await readFlowState(root);
    await writeFlowState(
      root,
      { ...seeded, discoveryMode: "deep" },
      { allowReset: true }
    );
    await writeBrainstormArtifact(root);

    const evidenceJson = requiredGateEvidenceJson("brainstorm");
    const blocked = captureIo();
    const blockedCode = await runInternalCommand(
      root,
      [
        "advance-stage",
        "brainstorm",
        `--evidence-json=${evidenceJson}`,
        "--waive-delegation=product-discovery,critic",
        "--waiver-reason=unit_test",
        "--quiet"
      ],
      blocked.io
    );
    expect(blockedCode).toBe(1);
    expect(blocked.stderr()).toContain("proactive delegation evidence is missing");
    expect(blocked.stderr()).toContain("--accept-proactive-waiver");
    expect(blocked.stderr()).toContain("researcher (when:");

    const accepted = captureIo();
    const acceptedCode = await runInternalCommand(
      root,
      [
        "advance-stage",
        "brainstorm",
        `--evidence-json=${evidenceJson}`,
        "--waive-delegation=product-discovery,critic",
        "--waiver-reason=unit_test",
        "--accept-proactive-waiver",
        "--accept-proactive-waiver-reason=unit_test_proactive",
        "--quiet"
      ],
      accepted.io
    );
    expect(acceptedCode, accepted.stderr()).toBe(0);

    const ledger = await readDelegationLedger(root);
    const proactiveWaiver = ledger.entries.find((entry) =>
      entry.stage === "brainstorm" &&
      entry.agent === "researcher" &&
      entry.mode === "proactive"
    );
    expect(proactiveWaiver?.status).toBe("waived");
    expect(proactiveWaiver?.waiverReason).toBe("unit_test_proactive");
    expect(proactiveWaiver?.acceptedBy).toBe("user-flag");
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

  it("advance-stage accepts explicit scope user approval evidence", async () => {
    const root = await createTempProject("internal-advance-stage-scope-user-approval");
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
        "--waive-delegation=planner,critic",
        "--waiver-reason=unit_test",
        ...PROACTIVE_WAIVER_FLAGS,
        "--quiet"
      ],
      captured.io
    );

    expect(code, captured.stderr()).toBe(0);
    const next = await readFlowState(root);
    expect(next.currentStage).toBe("design");
    expect(next.guardEvidence.scope_user_approved).toBe("approved by user");
  });

  it("advance-stage rejects scope review-loop evidence as user approval", async () => {
    const root = await createTempProject("internal-advance-stage-scope-review-loop-not-approval");
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
        "--waive-delegation=planner,critic",
        "--waiver-reason=unit_test",
        "--quiet"
      ],
      captured.io
    );

    expect(code).toBe(1);
    expect(captured.stderr()).toContain("gate evidence format check failed");
    expect(captured.stderr()).toContain("review-loop evidence is outside-voice evidence, not user approval");
  });

  it("advance-stage requires explicit scope user approval evidence when omitted", async () => {
    const root = await createTempProject("internal-advance-stage-scope-user-approval-required");
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
        "--waive-delegation=planner,critic",
        "--waiver-reason=unit_test",
        "--quiet"
      ],
      captured.io
    );

    expect(code).toBe(1);
    expect(captured.stderr()).toContain("missing --evidence-json entries");
    expect(captured.stderr()).toContain("scope_user_approved");
  });

  it("advance-stage emits JSON diagnostics for validation failures", async () => {
    const root = await createTempProject("internal-advance-stage-json-failure");
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
    evidence.scope_user_approved = "user approved the scope contract";

    const captured = captureIo();
    const code = await runInternalCommand(
      root,
      [
        "advance-stage",
        "scope",
        `--evidence-json=${JSON.stringify(evidence)}`,
        "--json",
        "--quiet"
      ],
      captured.io
    );

    expect(code).toBe(1);
    const diagnostics = JSON.parse(captured.stdout()) as {
      ok: boolean;
      kind: string;
      delegation: { missing: string[] };
      nextActions: string[];
    };
    expect(diagnostics.ok).toBe(false);
    expect(diagnostics.kind).toBe("validation-failed");
    expect(diagnostics).toMatchObject({
      failureCounts: { delegation: expect.any(Number), gates: expect.any(Number), closure: expect.any(Number) }
    });
    const fc = diagnostics as { failureCounts: { delegation: number; gates: number; closure: number } };
    expect(fc.failureCounts.delegation).toBeGreaterThan(0);
    expect(captured.stderr()).toMatch(
      /validation failed for stage "scope" \(delegation=\d+, gates=\d+, closure=\d+\)/
    );
    expect(diagnostics.delegation.missing).toContain("planner");
    expect(diagnostics.nextActions.join(" ")).toContain("Run mandatory delegation(s)");
    expect(diagnostics.nextActions.join(" ")).toContain("waiver fallback");
    expect(captured.stderr()).toContain("--waive-delegation=planner");
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
        "--waive-delegation=architect,test-author",
        "--waiver-reason=unit_test",
        ...PROACTIVE_WAIVER_FLAGS,
        "--quiet"
      ],
      captured.io
    );

    expect(code).toBe(1);
    expect(captured.stderr()).toContain('review-loop envelope stage must be "design"');
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
        "--waive-delegation=architect,test-author",
        "--waiver-reason=unit_test",
        ...PROACTIVE_WAIVER_FLAGS,
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
      "cclaw: current stage has 2 unmet mandatory delegations and 1 gates without evidence."
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
    const passed = [
      ...required.filter((gateId) => gateId !== "review_criticals_resolved"),
      blockedGuard
    ];
    const evidence = Object.fromEntries(
      passed.map((gateId) => [
        gateId,
        `evidence for ${gateId}`
      ])
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
        ...PROACTIVE_WAIVER_FLAGS,
        "--quiet"
      ],
      captured.io
    );

    expect(code, captured.stderr()).toBe(0);
    expect(captured.stderr()).toBe("");
    const state = await readFlowState(root);
    expect(state.currentStage).toBe("tdd");
    expect(state.completedStages).not.toContain("review");
    expect(state.stageGateCatalog.review.passed).not.toContain("review_criticals_resolved");
    expect(state.guardEvidence.review_verdict_blocked).toBe("evidence for review_verdict_blocked");
  });

  it("advances a simple dashboard brainstorm artifact without hidden validator fixes", async () => {
    const root = await createTempProject("internal-dashboard-brainstorm");
    await ensureRunSystem(root);
    await fs.mkdir(path.join(root, ".cclaw/artifacts"), { recursive: true });
    await fs.writeFile(path.join(root, ".cclaw/artifacts/01-brainstorm-dashboard-viz.md"), `# Brainstorm: Dashboard with Visualization

${QA_LOG_STOP_SIGNAL_BLOCK}## Context
- Project state: empty greenfield project with no app code, no origin docs, and no seeds.
- Relevant existing code/patterns: none.

## Problem Decision Record
- What we're solving: build a simple web dashboard/admin panel focused on charts and diagrams.
- Success criteria: responsive dashboard page, line/bar/pie charts, mock JSON data, clean extension-ready structure.
- Constraints: no backend, no database, no auth, fast simple MVP.

## Clarifying Questions
| # | Question | Answer | Decision impact |
|---|---|---|---|
| 1 | Type of web app? | Dashboard/admin panel | Locks scope to visualization dashboard. |
| 2 | Data source? | Mock JSON/no backend | Removes backend architecture from v1. |
| 3 | Stack? | Next.js + React | Confirms frontend stack. |

## Approach Tier
- Tier: Lightweight
- Why this tier: single-page dashboard with mock data and no backend.

## Short-Circuit Decision
- Status: bypassed
- Why: chart/UI library choice still needed a small comparison.
- Scope handoff: continue to scope after approval.

## Approaches
| Approach | Role | Upside | Architecture | Trade-offs | Recommendation |
|---|---|---|---|---|---|
| A — Next.js + Recharts | baseline | high | Next.js App Router with React chart components and Tailwind layout | Fast, low learning curve, good enough customization; less low-level SVG control. | Recommended after user reaction. |
| B — Next.js + D3.js | challenger | higher | Next.js App Router with D3 SVG/Canvas visualizations | Maximum flexibility for custom visuals; slower and overkill for simple MVP. | Keep as future option. |
| C — Next.js + Tremor | baseline | modest | Prebuilt dashboard components over Tailwind/Recharts | Fastest polished UI; constrained by component API. | Good but less direct control. |

## Approach Reaction
- Closest option: A — Next.js + Recharts.
- Concerns: none raised.
- What changed after reaction: recommendation stayed on A because user reaction favored the practical middle-ground.

## Selected Direction
- Approach: A — Next.js App Router + Recharts + Tailwind CSS.
- Rationale: Based on user reaction and feedback selecting A with no concerns, Recharts gives the simplest practical chart layer without D3 overhead or Tremor constraints.
- Approval: approved by user.
- Next-stage handoff: scope — carry the Next.js + Recharts stack lock and the single-page dashboard slice forward.

## Design
- Architecture: Next.js App Router single-page dashboard; chart components are client components fed by local mock data.
- Key components: dashboard page, chart cards, line/bar/pie chart components, mock data module.
- Data flow: mock-data.ts -> chart components -> dashboard page grid.

## Assumptions and Open Questions
- Assumptions: TypeScript, no auth, no realtime updates, one dashboard page for MVP.
- Open questions (or "None"): None.

## Learnings
- None this stage.
`, "utf8");

    const io = captureIo();
    const code = await runInternalCommand(
      root,
      [
        "advance-stage",
        "brainstorm",
        "--evidence-json",
        JSON.stringify({
          brainstorm_approaches_compared: "A/B/C approaches compared with challenger higher-upside row",
          brainstorm_direction_approved: "user approved Approach A",
          brainstorm_artifact_reviewed: "artifact reviewed by user"
        }),
        "--passed=brainstorm_approaches_compared,brainstorm_direction_approved,brainstorm_artifact_reviewed",
        "--waive-delegation=product-discovery,critic",
        "--waiver-reason=unit_test",
        ...PROACTIVE_WAIVER_FLAGS
      ],
      io.io
    );

    expect(code, io.stderr()).toBe(0);
    const state = await readFlowState(root);
    expect(state.completedStages).toContain("brainstorm");
    expect(state.currentStage).toBe("scope");
  });

  it("explains brainstorm validator failures with actionable details", async () => {
    const root = await createTempProject("internal-brainstorm-actionable-error");
    await ensureRunSystem(root);
    await writeBrainstormArtifact(root);
    const artifactPath = path.join(root, ".cclaw/artifacts/01-brainstorm.md");
    const artifact = await fs.readFile(artifactPath, "utf8");
    await fs.writeFile(
      artifactPath,
      artifact.replace(
        "| B | challenger | higher | reusable validation module | moderate effort, stronger reuse | recommended |",
        "| B | fallback | strong | reusable validation module | moderate effort, stronger reuse | recommended |"
      ),
      "utf8"
    );

    const io = captureIo();
    const code = await runInternalCommand(
      root,
      [
        "advance-stage",
        "brainstorm",
        `--evidence-json=${requiredGateEvidenceJson("brainstorm")}`,
        "--waive-delegation=product-discovery,critic",
        "--waiver-reason=unit_test",
        ...PROACTIVE_WAIVER_FLAGS
      ],
      io.io
    );

    expect(code).toBe(0);
    expect(io.stderr()).toBe("");
    const state = await readFlowState(root);
    expect(state.completedStages).toContain("brainstorm");
  });

  it("accepts boolean and object evidence JSON values from stage-complete copy-paste commands", async () => {
    const root = await createTempProject("internal-evidence-coercion");
    await ensureRunSystem(root);
    await writeBrainstormArtifact(root);

    const io = captureIo();
    const code = await runInternalCommand(
      root,
      [
        "advance-stage",
        "brainstorm",
        "--passed=brainstorm_approaches_compared,brainstorm_direction_approved,brainstorm_artifact_reviewed",
        "--evidence-json",
        JSON.stringify({
          brainstorm_approaches_compared: true,
          brainstorm_direction_approved: {
            status: true,
            note: "user approved the direction"
          },
          brainstorm_artifact_reviewed: "artifact reviewed in chat"
        }),
        "--waive-delegation=product-discovery,critic",
        "--waiver-reason=unit_test",
        ...PROACTIVE_WAIVER_FLAGS
      ],
      io.io
    );

    expect(code, io.stderr()).toBe(0);
    const state = await readFlowState(root);
    expect(state.completedStages).toContain("brainstorm");
    expect(state.currentStage).toBe("scope");
    expect(state.guardEvidence.brainstorm_approaches_compared).toBe("passed");
    expect(state.guardEvidence.brainstorm_direction_approved).toContain("user approved the direction");
    expect(state.guardEvidence.brainstorm_artifact_reviewed).toBe("artifact reviewed in chat");
  });

  it("harvests Learnings JSON bullets into knowledge store and marks artifact", async () => {
    const root = await createTempProject("internal-harvest-learnings");
    await ensureRunSystem(root);
    await writeBrainstormArtifact(
      root,
      `- {"type":"pattern","trigger":"when gate evidence is missing","action":"run verify-current-state before trying to advance","confidence":"high"}`
    );

    const captured = captureIo();
    const evidenceJson = requiredGateEvidenceJson("brainstorm");
    const code = await runInternalCommand(
      root,
      [
        "advance-stage",
        "brainstorm",
        `--evidence-json=${evidenceJson}`,
        "--waive-delegation=product-discovery,critic",
        "--waiver-reason=unit_test",
        ...PROACTIVE_WAIVER_FLAGS,
        "--quiet"
      ],
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

  it("prints stacked learnings harvest errors line-by-line", async () => {
    const root = await createTempProject("internal-harvest-learnings-malformed");
    await ensureRunSystem(root);
    await writeBrainstormArtifact(root, `- {"type":"oops",`);

    const captured = captureIo();
    const evidenceJson = requiredGateEvidenceJson("brainstorm");
    const code = await runInternalCommand(
      root,
      [
        "advance-stage",
        "brainstorm",
        `--evidence-json=${evidenceJson}`,
        "--waive-delegation=product-discovery,critic",
        "--waiver-reason=unit_test",
        ...PROACTIVE_WAIVER_FLAGS,
        "--quiet"
      ],
      captured.io
    );
    expect(code).toBe(1);
    const err = captured.stderr();
    expect(err.startsWith("cclaw internal advance-stage:")).toBe(true);
    expect(err).toContain("learnings harvest failed");
    expect(err).toContain("Errors:");
    expect(err).toMatch(/\n\s+-\s+/u);
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
  it("rewind records stale markers and requires ack before continuing", async () => {
    const root = await createTempProject("internal-rewind-managed");
    await ensureRunSystem(root);
    const initial = await readFlowState(root);
    await writeFlowState(
      root,
      {
        ...initial,
        currentStage: "review",
        completedStages: ["spec", "tdd"]
      },
      { allowReset: true }
    );

    const rewindIo = captureIo();
    const rewindCode = await runInternalCommand(
      root,
      ["rewind", "tdd", "review_blocked_by_critical", "F-1"],
      rewindIo.io
    );
    expect(rewindCode, rewindIo.stderr()).toBe(0);
    const rewound = await readFlowState(root);
    expect(rewound.currentStage).toBe("tdd");
    expect(rewound.completedStages).not.toContain("tdd");
    expect(rewound.rewinds).toHaveLength(1);
    expect(rewound.rewinds[0]?.invalidatedStages).toEqual(["tdd", "review"]);
    expect(rewound.staleStages.tdd?.rewindId).toBe(rewound.rewinds[0]?.id);
    expect(rewound.staleStages.review?.rewindId).toBe(rewound.rewinds[0]?.id);

    const ackIo = captureIo();
    const ackCode = await runInternalCommand(root, ["rewind", "--ack", "tdd"], ackIo.io);
    expect(ackCode, ackIo.stderr()).toBe(0);
    const acked = await readFlowState(root);
    expect(acked.staleStages.tdd).toBeUndefined();
    expect(acked.staleStages.review).toBeDefined();
    const log = await fs.readFile(path.join(root, ".cclaw/state/rewind-log.jsonl"), "utf8");
    expect(log).toContain('"action":"rewind"');
    expect(log).toContain('"action":"ack"');
  });

  it("rewind ack refuses non-current stale stages", async () => {
    const root = await createTempProject("internal-rewind-ack-non-current");
    await ensureRunSystem(root);
    const initial = await readFlowState(root);
    await writeFlowState(
      root,
      {
        ...initial,
        currentStage: "tdd",
        staleStages: {
          review: {
            rewindId: "rewind-test",
            reason: "review_blocked_by_critical",
            markedAt: new Date().toISOString()
          }
        }
      },
      { allowReset: true }
    );

    const captured = captureIo();
    const code = await runInternalCommand(root, ["rewind", "--ack=review"], captured.io);
    expect(code).toBe(1);
    expect(captured.stderr()).toContain('cannot ack "review" while currentStage is "tdd"');
  });

});
