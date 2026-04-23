import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  checkReviewSecurityNoChangeAttestation,
  checkReviewVerdictConsistency,
  extractMarkdownSectionBody,
  lintArtifact,
  parseLearningsSection,
  validateReviewArmy
} from "../../src/artifact-linter.js";
import { createTempProject } from "../helpers/index.js";

async function writeRuntimeArtifact(root: string, fileName: string, content: string): Promise<void> {
  await fs.mkdir(path.join(root, ".cclaw/state"), { recursive: true });
  await fs.mkdir(path.join(root, ".cclaw/artifacts"), { recursive: true });
  await fs.writeFile(path.join(root, ".cclaw/state/flow-state.json"), JSON.stringify({
    currentStage: "brainstorm",
    activeRunId: "active",
    completedStages: []
  }, null, 2), "utf8");
  await fs.writeFile(path.join(root, ".cclaw/artifacts", fileName), content, "utf8");
}

async function writeOptInAuditsConfig(
  root: string,
  flags: { scopePreAudit?: boolean; staleDiagramAudit?: boolean }
): Promise<void> {
  await fs.mkdir(path.join(root, ".cclaw"), { recursive: true });
  const lines = [
    "optInAudits:",
    `  scopePreAudit: ${flags.scopePreAudit === true ? "true" : "false"}`,
    `  staleDiagramAudit: ${flags.staleDiagramAudit === true ? "true" : "false"}`
  ];
  await fs.writeFile(path.join(root, ".cclaw/config.yaml"), `${lines.join("\n")}\n`, "utf8");
}

function completePlanArtifact(frontmatter = ""): string {
  const header = frontmatter.trim().length > 0 ? `${frontmatter.trim()}\n\n` : "";
  return `${header}# Plan Artifact

## Dependency Graph
- T-1 -> T-2 -> T-3

## Dependency Batches

### Batch 1
- Task IDs: T-1
- Verification gate: schema tests pass

### Batch 2
- Task IDs: T-2
- Depends on: Batch 1
- Verification gate: integration tests pass

## Task List
| Task ID | Description | Acceptance criterion | Verification command | Effort |
|---|---|---|---|---|
| T-1 | Define schema | AC-1 | npm test | S |
| T-2 | Implement publisher | AC-1, AC-2 | npm test | M |

## Acceptance Mapping
| Criterion ID | Task IDs |
|---|---|
| AC-1 | T-1, T-2 |
| AC-2 | T-2 |

## WAIT_FOR_CONFIRM
- Status: pending
- Confirmed by:
`;
}

function validPlanFrontmatter(): string {
  return `---
stage: plan
schema_version: 1
version: 0.18.0
feature: feature-alpha
locked_decisions: []
inputs_hash: sha256:pending
---`;
}

function completeDesignArtifact(diagramBody: string): string {
  return `# Design Artifact

## Codebase Investigation
| File | Current responsibility | Patterns discovered |
|---|---|---|
| src/api.ts | Handles route validation and orchestration | Typed error envelopes and retry wrappers |
| src/storage.ts | Writes records and fallback reads | Timeout guards with degraded responses |

## Search Before Building
| Layer | Label | What to reuse first |
|---|---|---|
| Layer 1 | Existing request pipeline | Reuse route validation middleware and auth gate |
| Layer 2 | Shared retry helper | Adapt retry limits for storage writes |
| Layer 3 | Queueing blog post | Inspiration for backpressure handling |
| EUREKA | Internal telemetry helper | Reuse existing latency probe hook |

## Research Fleet Synthesis
| Lens | Key findings | Design impact | Evidence |
|---|---|---|---|
| stack-researcher | Queue library alternatives are stable across current Node LTS. | Keep existing queue and avoid migration churn. | docs/internal-stack.md |
| features-researcher | Error-state UX should keep degraded mode visible. | Add degraded-state message contract in API response. | docs/patterns/degraded-ux.md |
| architecture-researcher | Adapter boundary keeps fallback strategy testable. | Preserve API -> service -> adapter separation. | Architecture review notes |
| pitfalls-researcher | Timeout retries can cause thundering herd if unbounded. | Cap retry attempts and jitter retry windows. | SRE incident postmortem 2026-03 |

## Architecture Boundaries
| Component | Responsibility | Owner |
|---|---|---|
| API Gateway | Validate input and route requests | platform-api |
| App Service | Business orchestration and policy checks | app-core |
| Storage Adapter | Persistence and fallback reads | data-team |

## Architecture Diagram
<!-- diagram: architecture -->
\`\`\`mermaid
flowchart LR
${diagramBody}
\`\`\`

## Data-Flow Shadow Paths
<!-- diagram: data-flow-shadow-paths -->
| Path | Trigger | Fallback/Degrade behavior |
|---|---|---|
| storage-write | storage timeout | fallback cache read + retry queue |

## Error Flow Diagram
<!-- diagram: error-flow -->
\`\`\`mermaid
flowchart TD
  DetectTimeout --> TriggerFallback
  TriggerFallback --> WarnUser
\`\`\`

## Data Flow
- Happy path: API Gateway validates request, App Service persists data, and returns success.
- Nil input path: API Gateway rejects null payload with 400 and logs validation code.
- Empty input path: API Gateway rejects empty payload with 422 and returns a field-level hint.
- Upstream error path: Storage Adapter timeout enters fallback path before final response.

### Interaction Edge Case Matrix
| Edge case | Handled? | Design response | Deferred item (if not handled) |
|---|---|---|---|
| double-click | yes | request idempotency key deduplicates concurrent submits | None |
| nav-away-mid-request | yes | in-flight request continues server-side; UI shows resumable status on return | None |
| 10K-result dataset | yes | cursor pagination limits each page to 100 rows and streams chunks | None |
| background-job abandonment | no | abandoned jobs are marked stale after timeout watchdog sweep | D-17 |
| zombie connection | yes | heartbeat timeout closes stale socket and retries on reconnect | None |

## Security & Threat Model
| Boundary | Threat | Mitigation | Owner |
|---|---|---|---|
| API input boundary | abuse via malformed payload or auth bypass | strict input validation + authz checks + audit logs | platform-api |

## Failure Mode Table
| Method | Exception | Rescue | UserSees |
|---|---|---|---|
| Persist write | timeout: upstream latency spike | RESCUED=Y TEST=Y (fallback cache read + retry queue) | stale but available response |

## Test Strategy
- Unit: validator and adapter tests with >=90% statement coverage target.
- Integration: API-to-storage fallback path in CI with injected timeouts.
- E2E: submit -> persist -> readback flow with degraded-mode assertion.

## Performance Budget
| Critical path | Metric | Target | Measurement method |
|---|---|---|---|
| Create request | p95 latency | <=250ms | k6 synthetic test in CI |
| Fallback read | error recovery latency | <=400ms | chaos timeout scenario replay |

## Observability & Debuggability
| Signal | Source | Alert/Debug path |
|---|---|---|
| timeout_rate | app service metric | Pager alert + runbook docs/runbooks/timeout.md |
| fallback_activation | structured application log | Correlate request ID and replay trace |

## Deployment & Rollout
| Step | Strategy | Rollback plan |
|---|---|---|
| Enable write path | Canary 10% -> 50% -> 100% over 2 hours | Disable feature flag and restore prior release |
| Enable fallback path | Shadow mode for one release cycle | Revert to strict-error response path |

## What Already Exists
| Sub-problem | Existing code/library found | Layer | Reuse decision | Adaptation needed |
|---|---|---|---|---|
| Input validation | src/api/validate.ts | Layer 1 | Reuse | Add one optional-field rule |
| Retry orchestration | src/lib/retry.ts | Layer 2 | Adapt | Tune retry window for writes |

## NOT in scope
- Migrating data store engine.
- Rebuilding API auth model.

## Completion Dashboard
| Review Section | Status | Notes |
|---|---|---|
| Architecture Review | clear | Boundaries approved |
| Code Quality Review | issues-found-resolved | Naming updated |
| Test Review | clear | Missing case added |
| Performance Review | clear | Budget accepted |

- Decisions made: 4
- Unresolved items: None
`;
}

function removeMarkdownSection(markdown: string, title: string): string {
  const escaped = title.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  return markdown.replace(new RegExp(`\\n##\\s+${escaped}[\\s\\S]*?(?=\\n##\\s+|$)`, "u"), "\n");
}

async function writeBrainstormTierArtifact(
  root: string,
  tier: "lightweight" | "standard" | "deep"
): Promise<void> {
  await writeRuntimeArtifact(root, "01-brainstorm.md", `# Brainstorm Artifact

## Approach Tier
- Tier: ${tier}
- Why this tier: fixture for design diagram requirement tests.
`);
}

describe("artifact linter heuristics", () => {
  it("fails when required brainstorm sections are missing", async () => {
    const root = await createTempProject("artifact-lint-missing");
    await writeRuntimeArtifact(root, "01-brainstorm.md", `# Brainstorm Artifact

## Context
- Project state: monorepo with CI
- Relevant existing code/patterns: pre-publish.sh

## Problem
- What we're solving: reduce release regressions
- Success criteria: invalid metadata blocked before publish
- Constraints: no new runtime dependencies

## Clarifying Questions
| # | Question | Answer | Decision impact |
|---|---|---|---|
| 1 | Block or warn? | Block | enforce hard gate |

## Selected Direction
- Approach: B
- Rationale: reusable module
- Approval: approved

## Design
- Architecture: shared validation module
- Key components: validator
- Data flow: metadata -> checks -> result

## Assumptions and Open Questions
- Assumptions: CI remains source of truth
- Open questions (or "None"): None
`);

    const result = await lintArtifact(root, "brainstorm");
    const approaches = result.findings.find((finding) => finding.section === "Approaches");
    expect(result.passed).toBe(false);
    expect(approaches?.found).toBe(false);
  });

  it("passes brainstorm artifact when required sections are present", async () => {
    const root = await createTempProject("artifact-lint-pass");
    await writeRuntimeArtifact(root, "01-brainstorm.md", `# Brainstorm Artifact

## Context
- Project state: monorepo with CI pipeline and custom release scripts
- Relevant existing code/patterns: scripts/pre-publish.sh does metadata checks

## Problem
- What we're solving: reduce release regressions
- Success criteria: invalid metadata blocked before publish
- Constraints: no new runtime dependencies

## Clarifying Questions
| # | Question | Answer | Decision impact |
|---|---|---|---|
| 1 | Block invalid metadata or warn? | Block | hard gate required |
| 2 | Add runtime dependencies? | No | stay on existing runtime stack |

## Approach Tier
- Tier: Standard
- Why this tier: multiple workflow touchpoints with bounded complexity.

## Short-Circuit Decision
- Status: bypassed
- Why: trade-offs still required explicit comparison.
- Scope handoff: continue full brainstorm flow before scope.

## Approaches
| Approach | Role | Architecture | Trade-offs | Recommendation |
|---|---|---|---|---|
| A | baseline | script-only checks | faster but weaker reuse |  |
| B | challenger: higher-upside | reusable validation module | slightly more effort, better long-term reuse | recommended |

## Approach Reaction
- Closest option: B
- Concerns: avoid overbuild while keeping long-term reuse.
- What changed after reaction: selected reusable module with strict v1 scope boundaries.

## Selected Direction
- Approach: B — reusable validation module
- Rationale: user reaction favored reusable module with bounded v1 scope, balancing reuse and delivery speed
- Approval: approved by user

## Design
- Architecture: shared TS module with typed validators imported by CI and local CLI
- Key components: validateMetadata, validateChangelog, validateVersion, runAll
- Data flow: package.json + CHANGELOG.md -> validator module -> structured result

## Assumptions and Open Questions
- Assumptions: CI remains primary release path
- Open questions (or "None"): None
`);

    const result = await lintArtifact(root, "brainstorm");
    expect(result.passed).toBe(true);
  });

  it("fails brainstorm when Approaches collapses to a single row", async () => {
    const root = await createTempProject("artifact-lint-single-approach");
    await writeRuntimeArtifact(root, "01-brainstorm.md", `# Brainstorm Artifact

## Context
- Project state: monorepo with CI

## Problem
- What we're solving: release regressions

## Clarifying Questions
| # | Question | Answer | Decision impact |
|---|---|---|---|
| 1 | Block or warn? | Block | hard gate |

## Approach Tier
- Tier: Standard
- Why this tier: release workflow affects CI + local command path.

## Approaches
| Approach | Role | Architecture | Trade-offs | Recommendation |
|---|---|---|---|---|
| A | challenger: higher-upside | script-only checks | fast and cheap | recommended |

## Approach Reaction
- Closest option: A
- Concerns: none
- What changed after reaction: no alternative survived.

## Selected Direction
- Approach: A
- Rationale: user reaction prioritized delivery speed over reuse.
- Approval: approved by user

## Design
- Architecture: simple script

## Assumptions and Open Questions
- None
`);

    const result = await lintArtifact(root, "brainstorm");
    const distinct = result.findings.find(
      (finding) => finding.section === "Distinct Approaches Enforcement"
    );
    expect(distinct?.found).toBe(false);
    expect(distinct?.details).toContain("at least 2 required");
  });

  it("fails brainstorm when Selected Direction omits approval marker", async () => {
    const root = await createTempProject("artifact-lint-no-approval");
    await writeRuntimeArtifact(root, "01-brainstorm.md", `# Brainstorm Artifact

## Context
- Project state: monorepo with CI

## Problem
- What we're solving: release regressions

## Clarifying Questions
| # | Question | Answer | Decision impact |
|---|---|---|---|
| 1 | Block or warn? | Block | hard gate |

## Approach Tier
- Tier: Standard
- Why this tier: changes local + CI release path together.

## Approaches
| Approach | Role | Architecture | Trade-offs | Recommendation |
|---|---|---|---|---|
| A | baseline | script-only checks | fast | |
| B | challenger: higher-upside | reusable module | balanced | recommended |

## Approach Reaction
- Closest option: B
- Concerns: keep rollout low-risk.
- What changed after reaction: recommendation narrowed to module-only surface.

## Selected Direction
- Approach: B
- Rationale: user reaction confirmed balanced path with controlled rollout

## Design
- Architecture: module

## Assumptions and Open Questions
- None
`);

    const result = await lintArtifact(root, "brainstorm");
    const approval = result.findings.find(
      (finding) => finding.section === "Direction Approval Marker"
    );
    expect(approval?.found).toBe(false);
  });

  it("fails brainstorm when no challenger higher-upside approach is present", async () => {
    const root = await createTempProject("artifact-lint-no-challenger");
    await writeRuntimeArtifact(root, "01-brainstorm.md", `# Brainstorm Artifact

## Context
- Project state: monorepo with CI
- Relevant existing code/patterns: release scripts

## Problem
- What we're solving: release regressions
- Success criteria: preflight checks always block invalid metadata
- Constraints: no runtime dependency changes

## Clarifying Questions
| # | Question | Answer | Decision impact |
|---|---|---|---|
| 1 | Block or warn? | Block | hard gate |

## Approach Tier
- Tier: Standard
- Why this tier: bounded but cross-cutting.

## Approaches
| Approach | Role | Architecture | Trade-offs | Recommendation |
|---|---|---|---|---|
| A | baseline | script-only checks | fast | |
| B | fallback | reusable module | balanced | recommended |

## Approach Reaction
- Closest option: B
- Concerns: rollout complexity.
- What changed after reaction: reduced scope to validator-only path.

## Selected Direction
- Approach: B
- Rationale: user reaction favored reusable path with bounded scope
- Approval: approved

## Design
- Architecture: module
- Key components: validators
- Data flow: metadata -> checks -> report

## Assumptions and Open Questions
- Assumptions: CI remains source of truth
- Open questions (or "None"): None
`);

    const result = await lintArtifact(root, "brainstorm");
    const challenger = result.findings.find(
      (finding) => finding.section === "Challenger Alternative Enforcement"
    );
    expect(challenger?.found).toBe(false);
    expect(challenger?.details).toContain("higher-upside");
  });

  it("fails brainstorm when reaction section appears after selected direction", async () => {
    const root = await createTempProject("artifact-lint-reaction-order");
    await writeRuntimeArtifact(root, "01-brainstorm.md", `# Brainstorm Artifact

## Context
- Project state: monorepo with CI
- Relevant existing code/patterns: release scripts

## Problem
- What we're solving: release regressions
- Success criteria: preflight checks always block invalid metadata
- Constraints: no runtime dependency changes

## Clarifying Questions
| # | Question | Answer | Decision impact |
|---|---|---|---|
| 1 | Block or warn? | Block | hard gate |

## Approach Tier
- Tier: Standard
- Why this tier: bounded but cross-cutting.

## Approaches
| Approach | Role | Architecture | Trade-offs | Recommendation |
|---|---|---|---|---|
| A | baseline | script-only checks | fast | |
| B | challenger: higher-upside | reusable module | balanced | recommended |

## Selected Direction
- Approach: B
- Rationale: user feedback favored reusable path
- Approval: approved

## Approach Reaction
- Closest option: B
- Concerns: rollout complexity.
- What changed after reaction: reduced scope to validator-only path.

## Design
- Architecture: module
- Key components: validators
- Data flow: metadata -> checks -> report

## Assumptions and Open Questions
- Assumptions: CI remains source of truth
- Open questions (or "None"): None
`);

    const result = await lintArtifact(root, "brainstorm");
    const ordering = result.findings.find(
      (finding) => finding.section === "Approach Reaction Ordering"
    );
    expect(ordering?.found).toBe(false);
    expect(ordering?.details).toContain("before Selected Direction");
  });

  it("passes brainstorm short-circuit stub when activated with scope handoff", async () => {
    const root = await createTempProject("artifact-lint-short-circuit-pass");
    await writeRuntimeArtifact(root, "01-brainstorm.md", `# Brainstorm Artifact

## Context
- Project state: targeted retry fix in one module.
- Relevant existing code/patterns: src/retry.ts already contains retry boundary helpers.

## Problem
- What we're solving: add one missing retry guard in existing request flow.
- Success criteria: retry guard triggers on timeout and preserves current API shape.
- Constraints: no architecture change, no new dependencies.

## Approach Tier
- Tier: Lightweight
- Why this tier: narrow single-module adjustment.

## Short-Circuit Decision
- Status: activated
- Why: requirements are concrete and bounded; full alternatives are unnecessary.
- Scope handoff: proceed directly to scope with this bounded ask.

## Selected Direction
- Approach: direct bounded fix in existing retry helper
- Rationale: approved concrete ask with minimal blast radius
- Approval: approved
`);

    const result = await lintArtifact(root, "brainstorm");
    expect(result.passed).toBe(true);
    const shortCircuit = result.findings.find((f) => f.section === "Short-Circuit Status");
    expect(shortCircuit?.found).toBe(true);
  });

  it("fails brainstorm short-circuit stub when scope handoff is missing", async () => {
    const root = await createTempProject("artifact-lint-short-circuit-no-handoff");
    await writeRuntimeArtifact(root, "01-brainstorm.md", `# Brainstorm Artifact

## Context
- Project state: targeted retry fix in one module.
- Relevant existing code/patterns: src/retry.ts already contains retry boundary helpers.

## Problem
- What we're solving: add one missing retry guard in existing request flow.
- Success criteria: retry guard triggers on timeout and preserves current API shape.
- Constraints: no architecture change, no new dependencies.

## Approach Tier
- Tier: Lightweight
- Why this tier: narrow single-module adjustment.

## Short-Circuit Decision
- Status: activated
- Why: requirements are concrete and bounded; full alternatives are unnecessary.

## Selected Direction
- Approach: direct bounded fix in existing retry helper
- Rationale: approved concrete ask with minimal blast radius
- Approval: approved
`);

    const result = await lintArtifact(root, "brainstorm");
    const handoff = result.findings.find((f) => f.section === "Short-Circuit Scope Handoff");
    expect(handoff?.found).toBe(false);
    expect(handoff?.details).toContain("scope handoff");
  });

  it("fails brainstorm clarifying questions section when empty", async () => {
    const root = await createTempProject("artifact-lint-empty-questions");
    await writeRuntimeArtifact(root, "01-brainstorm.md", `# Brainstorm Artifact

## Context
- Project state: monorepo
- Relevant existing code/patterns: pre-publish.sh

## Problem
- What we're solving: reduce release regressions
- Success criteria: invalid metadata blocked before publish
- Constraints: none

## Clarifying Questions

## Approach Tier
- Tier: Standard
- Why this tier: bounded but cross-cutting.

## Approaches
| Approach | Role | Architecture | Trade-offs | Recommendation |
|---|---|---|---|---|
| A | baseline | script-only checks | quick but weaker reuse |  |
| B | challenger: higher-upside | reusable validation module | more effort, better reuse | recommended |

## Approach Reaction
- Closest option: B
- Concerns: avoid scope growth.
- What changed after reaction: recommendation constrained to core validators.

## Selected Direction
- Approach: B
- Rationale: user reaction preferred stronger reuse while keeping v1 scoped
- Approval: approved

## Design
- Architecture: shared module
- Key components: validator
- Data flow: metadata -> checks -> result

## Assumptions and Open Questions
- Assumptions: CI remains source of truth
- Open questions (or "None"): None
`);

    const result = await lintArtifact(root, "brainstorm");
    const questions = result.findings.find((finding) => finding.section === "Clarifying Questions");
    expect(result.passed).toBe(true);
    expect(questions?.found).toBe(false);
    expect(questions?.required).toBe(false);
  });

  it("requires Learnings section on schema-v1 artifacts with frontmatter", async () => {
    const root = await createTempProject("artifact-lint-learnings-required");
    await writeRuntimeArtifact(root, "05-plan.md", completePlanArtifact(validPlanFrontmatter()));

    const result = await lintArtifact(root, "plan");
    const learnings = result.findings.find((f) => f.section === "Learnings");
    expect(result.passed).toBe(false);
    expect(learnings?.required).toBe(true);
    expect(learnings?.found).toBe(false);
  });

  it("accepts Learnings sentinel when no reusable insights exist", async () => {
    const root = await createTempProject("artifact-lint-learnings-none");
    await writeRuntimeArtifact(
      root,
      "05-plan.md",
      `${completePlanArtifact(validPlanFrontmatter())}

## Learnings
- None this stage.
`
    );

    const result = await lintArtifact(root, "plan");
    const learnings = result.findings.find((f) => f.section === "Learnings");
    expect(result.passed).toBe(true);
    expect(learnings?.found).toBe(true);
  });

  it("rejects Learnings bullets that are not knowledge-schema compatible", async () => {
    const root = await createTempProject("artifact-lint-learnings-invalid");
    await writeRuntimeArtifact(
      root,
      "05-plan.md",
      `${completePlanArtifact(validPlanFrontmatter())}

## Learnings
- {"type":"pattern","trigger":"","action":"add fallback","confidence":"high"}
`
    );

    const result = await lintArtifact(root, "plan");
    const learnings = result.findings.find((f) => f.section === "Learnings");
    expect(result.passed).toBe(false);
    expect(learnings?.found).toBe(false);
    expect(learnings?.details).toContain("trigger");
  });

  it("accepts Learnings JSON bullets with strict field compatibility", async () => {
    const root = await createTempProject("artifact-lint-learnings-valid-json");
    await writeRuntimeArtifact(
      root,
      "05-plan.md",
      `${completePlanArtifact(validPlanFrontmatter())}

## Learnings
- {"type":"pattern","trigger":"when dependency batch stalls","action":"split the batch and add an intermediate verification gate","confidence":"medium","domain":"delivery","universality":"project","maturity":"raw"}
`
    );

    const result = await lintArtifact(root, "plan");
    const learnings = result.findings.find((f) => f.section === "Learnings");
    expect(result.passed).toBe(true);
    expect(learnings?.found).toBe(true);
  });

  it("accepts optional Learnings severity when value is valid", () => {
    const parsed = parseLearningsSection(
      `- {"type":"lesson","trigger":"when deployment risk spikes","action":"run release rollback drill before merge","confidence":"high","severity":"critical"}`
    );
    expect(parsed.ok).toBe(true);
    expect(parsed.entries[0]?.severity).toBe("critical");
  });

  it("rejects Learnings severity outside the supported enum", () => {
    const parsed = parseLearningsSection(
      `- {"type":"lesson","trigger":"when deployment risk spikes","action":"run release rollback drill before merge","confidence":"high","severity":"blocker"}`
    );
    expect(parsed.ok).toBe(false);
    expect(parsed.details).toContain("field \"severity\"");
  });

  it("rejects Learnings sections that contain non-bullet lines", () => {
    const parsed = parseLearningsSection(`summary line\n- None this stage.`);
    expect(parsed.ok).toBe(false);
    expect(parsed.details).toContain("only contain bullet lines");
  });

  it("rejects Learnings bullets with malformed JSON payload", () => {
    const parsed = parseLearningsSection(`- {"type":"pattern","trigger":"ok",`);
    expect(parsed.ok).toBe(false);
    expect(parsed.details).toContain("valid JSON object");
  });

  it("rejects Learnings JSON bullets with unsupported keys", () => {
    const parsed = parseLearningsSection(
      `- {"type":"pattern","trigger":"when lint fails","action":"run targeted fix","confidence":"medium","extra":"nope"}`
    );
    expect(parsed.ok).toBe(false);
    expect(parsed.details).toContain("unknown key");
  });

  it("rejects Learnings JSON bullets with invalid stage enum", () => {
    const parsed = parseLearningsSection(
      `- {"type":"lesson","trigger":"when state is stale","action":"re-read flow-state before editing","confidence":"high","stage":"retro"}`
    );
    expect(parsed.ok).toBe(false);
    expect(parsed.details).toContain("field \"stage\" must be one of");
  });

  it("enforces exactly one selected enum token in finalization", async () => {
    const root = await createTempProject("artifact-lint-enum");
    await writeRuntimeArtifact(root, "08-ship.md", `# Ship Artifact

## Preflight Results
- Build: pass

## Release Notes
- Updated rollout logic

## Rollback Plan
- Verification steps: run smoke tests

## Monitoring
- Metrics/logs to watch: request latency

## Finalization
- FINALIZE_MERGE_LOCAL
- FINALIZE_OPEN_PR
- FINALIZE_KEEP_BRANCH
- FINALIZE_DISCARD_BRANCH
- FINALIZE_NO_VCS
`);

    const result = await lintArtifact(root, "ship");
    const finalization = result.findings.find((f) => f.section === "Finalization");
    expect(finalization?.found).toBe(false);
    expect(finalization?.details).toContain("exactly one selected token");
  });

  it("passes complete ship artifact", async () => {
    const root = await createTempProject("ship-full-pass");
    await writeRuntimeArtifact(root, "08-ship.md", `# Ship Artifact

## Preflight Results
- Review verdict: APPROVED
- Build: pass
- Tests: pass (47 passed, 0 failed)
- Lint: pass
- Type-check: pass
- Working tree clean: yes

## Release Notes
- Added: notification feed with SSE
- Breaking changes: None

## Rollback Plan
- Trigger conditions: error rate >5%
- Rollback steps: git revert <sha> && git push
- Verification steps: confirm error rate baseline

## Monitoring
- Metrics/logs to watch: error rate for 24h

## Finalization
- Selected enum: FINALIZE_OPEN_PR
- Execution result: PR #42 merged
`);

    const result = await lintArtifact(root, "ship");
    expect(result.passed).toBe(true);
  });

  it("accepts FINALIZE_NO_VCS as a valid ship finalization mode", async () => {
    const root = await createTempProject("ship-no-vcs-finalization");
    await writeRuntimeArtifact(root, "08-ship.md", `# Ship Artifact

## Preflight Results
- Review verdict: APPROVED
- Build: pass
- Tests: pass
- Lint: pass
- Type-check: pass
- Working tree clean: n/a (no git)

## Release Notes
- Published docs bundle to static hosting.

## Rollback Plan
- Trigger conditions: 404 spike on docs routes
- Rollback steps: restore previous docs bundle from backup storage
- Verification steps: run docs smoke checks for top routes

## Monitoring
- Metrics/logs to watch: docs 404 rate

## Finalization
- Selected enum: FINALIZE_NO_VCS
- Execution result: uploaded release archive and notified ops owner
`);

    const result = await lintArtifact(root, "ship");
    expect(result.passed).toBe(true);
  });

  it("fails ship when Preflight Results is missing", async () => {
    const root = await createTempProject("ship-no-preflight");
    await writeRuntimeArtifact(root, "08-ship.md", `# Ship Artifact

## Release Notes
- Added: notification feed

## Rollback Plan
- Trigger conditions: error rate >5%
- Rollback steps: revert
- Verification steps: smoke test

## Finalization
- Selected enum: FINALIZE_OPEN_PR
- Execution result: PR merged
`);

    const result = await lintArtifact(root, "ship");
    expect(result.passed).toBe(false);
    const pf = result.findings.find((f) => f.section === "Preflight Results");
    expect(pf?.found).toBe(false);
    expect(pf?.required).toBe(true);
  });

  it("fails ship when Rollback Plan is missing", async () => {
    const root = await createTempProject("ship-no-rollback");
    await writeRuntimeArtifact(root, "08-ship.md", `# Ship Artifact

## Preflight Results
- Build: pass
- Tests: pass

## Release Notes
- Added: notification feed

## Finalization
- Selected enum: FINALIZE_MERGE_LOCAL
- Execution result: merged locally
`);

    const result = await lintArtifact(root, "ship");
    expect(result.passed).toBe(false);
    const rb = result.findings.find((f) => f.section === "Rollback Plan");
    expect(rb?.found).toBe(false);
    expect(rb?.required).toBe(true);
  });

  it("fails ship when Finalization has invalid single token", async () => {
    const root = await createTempProject("ship-bad-finalize");
    await writeRuntimeArtifact(root, "08-ship.md", `# Ship Artifact

## Preflight Results
- Build: pass
- Tests: pass

## Release Notes
- Added: notification feed

## Rollback Plan
- Trigger conditions: error rate >5%
- Rollback steps: revert
- Verification steps: smoke test

## Finalization
- Selected enum: DEPLOY_NOW
- Execution result: deployed
`);

    const result = await lintArtifact(root, "ship");
    const fin = result.findings.find((f) => f.section === "Finalization");
    expect(fin?.found).toBe(false);
    expect(fin?.details).toContain("exactly one selected token");
  });

  it("requires review readiness dashboard section for review artifacts", async () => {
    const root = await createTempProject("artifact-lint-review-readiness");
    await writeRuntimeArtifact(root, "07-review.md", `# Review Artifact

## Layer 1 Verdict
| Criterion | Verdict | Evidence |
|---|---|---|
| AC-1 | PASS | src/a.ts |

## Layer 2 Findings
| ID | Severity | Category | Description | Status |
|---|---|---|---|---|
| R-1 | Suggestion | correctness | tighten naming | open |

## Review Army Contract
- See \`07-review-army.json\`
- Reconciliation summary: none

## Severity Summary
- Critical: 0
- Important: 0
- Suggestion: 1

## Final Verdict
- APPROVED
`);

    const result = await lintArtifact(root, "review");
    const readiness = result.findings.find((finding) => finding.section === "Review Readiness Dashboard");
    expect(result.passed).toBe(true);
    expect(readiness?.found).toBe(false);
    expect(readiness?.required).toBe(false);
  });

  it("fails scope artifact missing Mode-Specific Analysis section", async () => {
    const root = await createTempProject("scope-missing-mode");
    await writeRuntimeArtifact(root, "02-scope.md", `# Scope Artifact

## Prime Directives
- Zero silent failures: every delivery failure maps to a visible state.
- Named error surfaces: stream disconnect, auth drift, and publisher timeout.
- Four-path data flow: happy, nil payload, empty payload, upstream error.
- Interaction edge cases: double-open panel, reconnect after sleep.
- Observability expectations: stream error counter, publish-to-visible lag.
- Deferred-item handling: WebSocket channel deferred with rationale.

## Premise Challenge
- Right problem? Yes, users miss follow-ups.
- Direct path? Durable feed is the right path.
- What if nothing? Users continue missing events.

## Implementation Alternatives
| Option | Summary | Effort (S/M/L/XL) | Risk | Pros | Cons | Reuses |
|---|---|---|---|---|---|---|
| A (minimum viable) | Polling-only | S | Low | Fast | Weaker UX | REST endpoint |
| B (recommended) | SSE + REST fallback | M | Med | Better UX | Reconnect handling | Event publisher |

## Scope Mode
- [x] selective

## In Scope / Out of Scope

### In Scope
- In-app notification feed

### Out of Scope
- Email/SMS providers

## Discretion Areas
- Badge rendering strategy

## Deferred Items
| Item | Rationale |
|---|---|
| WebSocket channel | Not justified for current load |

## Error & Rescue Registry
| Capability | Failure mode | Detection | Fallback |
|---|---|---|---|
| Event delivery | SSE drops | Heartbeat timeout | REST polling |

## Completion Dashboard
- Checklist findings: 9/9 complete
- Resolved decisions count: 5
- Unresolved decisions: None

## Scope Summary
- Selected mode: selective
- Accepted scope: durable feed + SSE
- Deferred: WebSocket channel
- Explicitly excluded: outbound channels
`);

    const result = await lintArtifact(root, "scope");
    const modeAnalysis = result.findings.find((f) => f.section === "Mode-Specific Analysis");
    expect(result.passed).toBe(true);
    expect(modeAnalysis?.found).toBe(false);
    expect(modeAnalysis?.required).toBe(false);
  });

  it("requires pre-scope audit section when opt-in flag is enabled", async () => {
    const root = await createTempProject("scope-pre-audit-required");
    await writeOptInAuditsConfig(root, { scopePreAudit: true });
    await writeRuntimeArtifact(root, "02-scope.md", `# Scope Artifact

## Scope Mode
- [x] selective

## In Scope / Out of Scope
### In Scope
- Durable event feed
### Out of Scope
- Email channel

## Completion Dashboard
- Checklist findings: 3/3 complete
- Resolved decisions count: 2
- Unresolved decisions: None

## Scope Summary
- Selected mode: selective
- Accepted scope: durable event feed
- Deferred: websocket channel
- Explicitly excluded: outbound channels
`);

    const result = await lintArtifact(root, "scope");
    const preAudit = result.findings.find((f) => f.section === "Pre-Scope System Audit");
    expect(result.passed).toBe(false);
    expect(preAudit?.required).toBe(true);
    expect(preAudit?.found).toBe(false);
  });

  it("passes pre-scope audit section when opt-in flag is enabled and commands are captured", async () => {
    const root = await createTempProject("scope-pre-audit-pass");
    await writeOptInAuditsConfig(root, { scopePreAudit: true });
    await writeRuntimeArtifact(root, "02-scope.md", `# Scope Artifact

## Pre-Scope System Audit
| Check | Command | Findings |
|---|---|---|
| Recent commits | git log -30 --oneline | release touched feed parser + retry helper |
| Current diff | git diff --stat | 5 files changed in notifications module |
| Stash state | git stash list | no pending stash entries |
| Debt markers | rg -n "TODO|FIXME|XXX|HACK" | TODO in src/feed/cache.ts to retire fallback cache |

## Scope Mode
- [x] selective

## In Scope / Out of Scope
### In Scope
- Durable event feed
### Out of Scope
- Email channel

## Completion Dashboard
- Checklist findings: 4/4 complete
- Resolved decisions count: 2
- Unresolved decisions: None

## Scope Summary
- Selected mode: selective
- Accepted scope: durable event feed
- Deferred: websocket channel
- Explicitly excluded: outbound channels
`);

    const result = await lintArtifact(root, "scope");
    const preAudit = result.findings.find((f) => f.section === "Pre-Scope System Audit");
    expect(preAudit?.required).toBe(true);
    expect(preAudit?.found).toBe(true);
  });

  it("enforces scope-reduction scan when locked decisions section is present", async () => {
    const root = await createTempProject("scope-strict-reduction");
    await writeRuntimeArtifact(root, "02-scope.md", `# Scope Artifact

## Prime Directives
- Zero silent failures: every delivery failure maps to a visible state.
- Named error surfaces: stream disconnect, auth drift, and publisher timeout.
- Four-path data flow: happy, nil payload, empty payload, upstream error.
- Interaction edge cases: double-open panel, reconnect after sleep.
- Observability expectations: stream error counter, publish-to-visible lag.
- Deferred-item handling: WebSocket channel deferred with rationale.

## Premise Challenge
- Right problem? Yes, users miss follow-ups.
- Direct path? Durable feed is the right path.
- What if nothing? Users continue missing events.

## Implementation Alternatives
| Option | Summary | Effort (S/M/L/XL) | Risk | Pros | Cons | Reuses |
|---|---|---|---|---|---|---|
| A (minimum viable) | Polling-only | S | Low | Fast | Weaker UX | REST endpoint |
| B (recommended) | SSE + REST fallback | M | Med | Better UX | Reconnect handling | Event publisher |

## Scope Mode
- [x] selective

## Mode-Specific Analysis
- Selected mode: selective
- Analysis: selective mode chosen to avoid unbounded scope.

## In Scope / Out of Scope

### In Scope
- In-app notification feed for now

### Out of Scope
- Email/SMS providers

## Discretion Areas
- Badge rendering strategy

## Deferred Items
| Item | Rationale |
|---|---|
| WebSocket channel | Not justified for current load |

## Error & Rescue Registry
| Capability | Failure mode | Detection | Fallback |
|---|---|---|---|
| Event delivery | SSE drops | Heartbeat timeout | REST polling |

## Locked Decisions (D-XX)
| ID | Decision | Rationale |
|---|---|---|
| D-01 | Keep feed query in current API contract | Avoid breaking consumers for now |

## Completion Dashboard
- Checklist findings: 9/9 complete
- Resolved decisions count: 5
- Unresolved decisions: None

## Scope Summary
- Selected mode: selective
- Accepted scope: durable feed + SSE
- Deferred: WebSocket channel
- Explicitly excluded: outbound channels
`);

    const result = await lintArtifact(root, "scope");
    const reduction = result.findings.find((f) => f.section === "No Scope Reduction Language");
    expect(reduction?.required).toBe(true);
    expect(reduction?.found).toBe(false);
  });

  it("flags Locked Decisions rows that are missing a D-XX ID", async () => {
    const root = await createTempProject("scope-decision-ids-missing");
    await writeRuntimeArtifact(root, "02-scope.md", `# Scope Artifact

## Scope Mode
- Mode: strict

## In Scope / Out of Scope
- In scope: audit log storage
- Out of scope: archival

## Locked Decisions (D-XX)
- D-01 — JSONL format for audit trail (compliance)
- freeform note without an ID

## Completion Dashboard
- Checklist findings: 1/1

## Scope Summary
- Selected mode: strict
`);

    const result = await lintArtifact(root, "scope");
    const integrity = result.findings.find((f) => f.section === "Locked Decisions ID Integrity");
    expect(integrity?.required).toBe(true);
    expect(integrity?.found).toBe(false);
    expect(integrity?.details).toContain("missing a D-XX ID");
  });

  it("flags duplicate Locked Decision IDs", async () => {
    const root = await createTempProject("scope-decision-ids-duplicate");
    await writeRuntimeArtifact(root, "02-scope.md", `# Scope Artifact

## Scope Mode
- Mode: strict

## In Scope / Out of Scope
- In scope: audit log storage
- Out of scope: archival

## Locked Decisions (D-XX)
- D-01 — JSONL format (compliance)
- D-01 — Duplicate row same ID (wrong)

## Completion Dashboard
- Checklist findings: 1/1

## Scope Summary
- Selected mode: strict
`);

    const result = await lintArtifact(root, "scope");
    const integrity = result.findings.find((f) => f.section === "Locked Decisions ID Integrity");
    expect(integrity?.found).toBe(false);
    expect(integrity?.details).toContain("duplicate IDs: D-01");
  });

  it("fails design artifact when Codebase Investigation is missing", async () => {
    const root = await createTempProject("design-missing-cbi");
    await writeRuntimeArtifact(root, "03-design.md", `# Design Artifact

## Search Before Building
| Layer | Label | What to reuse first |
|---|---|---|
| Layer 1 | stdlib | Built-in timers |

## Architecture Boundaries
| Component | Responsibility | Owner |
|---|---|---|
| API | routes | team-a |

## Architecture Diagram
\`\`\`
API -> Service -> DB
\`\`\`

## What Already Exists
| Sub-problem | Existing code | Layer | Reuse decision |
|---|---|---|---|
| Auth | middleware/auth.ts | Layer 1 | Reuse |

## Data Flow
- Happy path: request -> response
- Nil/empty input path: 400 error
- Upstream error path: 502 retry
- Timeout/downstream path: 504

## Failure Mode Table
| Method | Exception | Rescue | UserSees |
|---|---|---|---|
| Query path | outage | RESCUED=Y TEST=Y (failover) | degraded |

## Test Strategy
- Unit: validators
- Integration: API routes
- E2E: full flow

## Performance Budget
| Critical path | Metric | Target | Measurement method |
|---|---|---|---|
| API response | p99 latency | 200ms | load test |

## NOT in scope
- Admin UI

## Completion Dashboard
| Review Section | Status | Issues |
|---|---|---|
| Architecture Review | clear | — |

**Decisions made:** 2 | **Unresolved:** 0
`);

    const result = await lintArtifact(root, "design");
    const cbi = result.findings.find((f) => f.section === "Codebase Investigation");
    expect(result.passed).toBe(false);
    expect(cbi?.found).toBe(false);
    expect(cbi?.required).toBe(false);
  });

  it("fails design artifact when Performance Budget is missing", async () => {
    const root = await createTempProject("design-missing-perf");
    await writeRuntimeArtifact(root, "03-design.md", `# Design Artifact

## Codebase Investigation
| File | Current responsibility | Patterns discovered |
|---|---|---|
| src/api.ts | API routes | Express router |

## Search Before Building
| Layer | Label | What to reuse first |
|---|---|---|
| Layer 1 | stdlib | Built-in timers |

## Architecture Boundaries
| Component | Responsibility | Owner |
|---|---|---|
| API | routes | team-a |

## Architecture Diagram
\`\`\`
API -> Service -> DB
\`\`\`

## What Already Exists
| Sub-problem | Existing code | Layer | Reuse decision |
|---|---|---|---|
| Auth | middleware/auth.ts | Layer 1 | Reuse |

## Data Flow
- Happy path: request -> response
- Nil/empty input path: 400 error
- Upstream error path: 502 retry
- Timeout/downstream path: 504

## Failure Mode Table
| Method | Exception | Rescue | UserSees |
|---|---|---|---|
| Query path | outage | RESCUED=Y TEST=Y (failover) | degraded |

## Test Strategy
- Unit: validators
- Integration: API routes
- E2E: full flow

## NOT in scope
- Admin UI

## Completion Dashboard
| Review Section | Status | Issues |
|---|---|---|
| Architecture Review | clear | — |

**Decisions made:** 2 | **Unresolved:** 0
`);

    const result = await lintArtifact(root, "design");
    const perf = result.findings.find((f) => f.section === "Performance Budget");
    expect(result.passed).toBe(false);
    expect(perf?.found).toBe(false);
    expect(perf?.required).toBe(false);
  });

  it("design trivial-change escape hatch downgrades most sections to optional", async () => {
    const root = await createTempProject("design-trivial");
    await writeRuntimeArtifact(root, "03-design.md", `# Design Artifact — Trivial Change / Escape Hatch

## Architecture Boundaries
| Component | Responsibility | Owner |
|---|---|---|
| config parser | reads YAML config | core team |

## Architecture Diagram
<!-- diagram: architecture -->
\`\`\`
Config_Reader -->|sync: parse| Config_Model
\`\`\`

## NOT in scope
- Full config migration tool

## Completion Dashboard
| Review Section | Status | Issues |
|---|---|---|
| Architecture Review | clear | — |

**Decisions made:** 1 | **Unresolved:** 0
`);

    const result = await lintArtifact(root, "design");
    expect(result.passed).toBe(true);
    const required = result.findings.filter((f) => f.required);
    expect(required.every((f) => f.found)).toBe(true);
  });

  it("fails design artifact when architecture diagram has no failure edge branch", async () => {
    const root = await createTempProject("design-missing-failure-edge");
    await writeRuntimeArtifact(
      root,
      "03-design.md",
      completeDesignArtifact(
        `API_Gateway -->|sync: validated request| App_Service
App_Service -.->|async: enqueue write| Storage_Adapter
Storage_Adapter -->|sync: write ack| App_Service
App_Service -->|sync: 200 response| API_Gateway`
      )
    );

    const result = await lintArtifact(root, "design");
    const diagram = result.findings.find((f) => f.section === "Architecture Diagram");
    expect(result.passed).toBe(false);
    expect(diagram?.found).toBe(false);
    expect(diagram?.details).toContain("failure-edge");
  });

  it("passes design artifact when architecture diagram includes a failure edge", async () => {
    const root = await createTempProject("design-has-failure-edge");
    await writeRuntimeArtifact(
      root,
      "03-design.md",
      completeDesignArtifact(
        `API_Gateway -->|sync: validated request| App_Service
App_Service -.->|async: enqueue write| Storage_Adapter
Storage_Adapter -->|timeout| Fallback_Cache
Fallback_Cache -->|degraded response| API_Gateway`
      )
    );

    const result = await lintArtifact(root, "design");
    const diagram = result.findings.find((f) => f.section === "Architecture Diagram");
    expect(result.passed).toBe(true);
    expect(diagram?.found).toBe(true);
  });

  it("requires standard-tier shadow/error diagram markers", async () => {
    const root = await createTempProject("design-standard-diagrams-required");
    await writeBrainstormTierArtifact(root, "standard");
    const diagram = `API_Gateway -->|sync: validated request| App_Service
App_Service -.->|async: enqueue write| Storage_Adapter
Storage_Adapter -->|timeout| Fallback_Cache
Fallback_Cache -->|degraded response| API_Gateway`;
    const artifact = completeDesignArtifact(diagram).replace(
      "<!-- diagram: data-flow-shadow-paths -->",
      "<!-- diagram: missing-shadow -->"
    );
    await writeRuntimeArtifact(root, "03-design.md", artifact);

    const result = await lintArtifact(root, "design");
    const shadowRequirement = result.findings.find(
      (f) => f.section === "Diagram Requirement: Data-Flow Shadow Paths"
    );
    expect(shadowRequirement?.found).toBe(false);
    expect(shadowRequirement?.details).toContain("data-flow-shadow-paths");
  });

  it("allows lightweight-tier design to omit standard-only diagram sections", async () => {
    const root = await createTempProject("design-lightweight-no-shadow-error");
    await writeBrainstormTierArtifact(root, "lightweight");
    const diagram = `API_Gateway -->|sync: validated request| App_Service
App_Service -.->|async: enqueue write| Storage_Adapter
Storage_Adapter -->|timeout| Fallback_Cache
Fallback_Cache -->|degraded response| API_Gateway`;
    let artifact = completeDesignArtifact(diagram);
    artifact = removeMarkdownSection(artifact, "Data-Flow Shadow Paths");
    artifact = removeMarkdownSection(artifact, "Error Flow Diagram");
    await writeRuntimeArtifact(root, "03-design.md", artifact);

    const result = await lintArtifact(root, "design");
    expect(result.passed).toBe(true);
    const architectureRequirement = result.findings.find(
      (f) => f.section === "Diagram Requirement: Architecture Diagram"
    );
    expect(architectureRequirement?.found).toBe(true);
  });

  it("requires deep-tier state/rollback/deployment diagrams", async () => {
    const root = await createTempProject("design-deep-diagrams-required");
    await writeBrainstormTierArtifact(root, "deep");
    const diagram = `API_Gateway -->|sync: validated request| App_Service
App_Service -.->|async: enqueue write| Storage_Adapter
Storage_Adapter -->|timeout| Fallback_Cache
Fallback_Cache -->|degraded response| API_Gateway`;
    await writeRuntimeArtifact(root, "03-design.md", completeDesignArtifact(diagram));

    const result = await lintArtifact(root, "design");
    const stateMachineRequirement = result.findings.find(
      (f) => f.section === "Diagram Requirement: State Machine Diagram"
    );
    expect(stateMachineRequirement?.found).toBe(false);
    expect(stateMachineRequirement?.details).toContain("State Machine Diagram");
  });

  it("passes deep-tier design when all deep diagram markers are present", async () => {
    const root = await createTempProject("design-deep-diagrams-pass");
    await writeBrainstormTierArtifact(root, "deep");
    const diagram = `API_Gateway -->|sync: validated request| App_Service
App_Service -.->|async: enqueue write| Storage_Adapter
Storage_Adapter -->|timeout| Fallback_Cache
Fallback_Cache -->|degraded response| API_Gateway`;
    const artifact = `${completeDesignArtifact(diagram)}

## State Machine Diagram
<!-- diagram: state-machine -->
\`\`\`mermaid
stateDiagram-v2
  [*] --> Requested
  Requested --> Persisted
  Requested --> Degraded
  Degraded --> Persisted
\`\`\`

## Rollback Flowchart
<!-- diagram: rollback-flowchart -->
\`\`\`mermaid
flowchart TD
  Trigger --> DisableFlag
  DisableFlag --> RestorePreviousBuild
  RestorePreviousBuild --> Verify
\`\`\`

## Deployment Sequence Diagram
<!-- diagram: deployment-sequence -->
\`\`\`mermaid
sequenceDiagram
  participant CI
  participant API
  participant Queue
  CI->>API: deploy canary
  API->>Queue: enable async write path
  API->>CI: report health checks
\`\`\`
`;
    await writeRuntimeArtifact(root, "03-design.md", artifact);

    const result = await lintArtifact(root, "design");
    expect(result.passed).toBe(true);
  });

  it("fails design artifact when interaction edge-case matrix misses required rows", async () => {
    const root = await createTempProject("design-missing-edge-case-row");
    const diagram = `API_Gateway -->|sync: validated request| App_Service
App_Service -.->|async: enqueue write| Storage_Adapter
Storage_Adapter -->|timeout| Fallback_Cache
Fallback_Cache -->|degraded response| API_Gateway`;
    const artifact = completeDesignArtifact(diagram).replace(
      "| zombie connection | yes | heartbeat timeout closes stale socket and retries on reconnect | None |\n",
      ""
    );
    await writeRuntimeArtifact(root, "03-design.md", artifact);

    const result = await lintArtifact(root, "design");
    const dataFlow = result.findings.find((f) => f.section === "Data Flow");
    expect(result.passed).toBe(false);
    expect(dataFlow?.found).toBe(false);
    expect(dataFlow?.details).toContain("zombie connection");
  });

  it("fails design artifact when unhandled edge case has no deferred item id", async () => {
    const root = await createTempProject("design-unhandled-edge-case-without-deferred-id");
    const diagram = `API_Gateway -->|sync: validated request| App_Service
App_Service -.->|async: enqueue write| Storage_Adapter
Storage_Adapter -->|timeout| Fallback_Cache
Fallback_Cache -->|degraded response| API_Gateway`;
    const artifact = completeDesignArtifact(diagram).replace(
      "| background-job abandonment | no | abandoned jobs are marked stale after timeout watchdog sweep | D-17 |",
      "| background-job abandonment | no | abandoned jobs are marked stale after timeout watchdog sweep | None |"
    );
    await writeRuntimeArtifact(root, "03-design.md", artifact);

    const result = await lintArtifact(root, "design");
    const dataFlow = result.findings.find((f) => f.section === "Data Flow");
    expect(result.passed).toBe(false);
    expect(dataFlow?.found).toBe(false);
    expect(dataFlow?.details).toContain("deferred item id");
  });

  it("flags stale diagram audit when blast-radius file is newer than design baseline", async () => {
    const root = await createTempProject("design-stale-diagram-audit-fail");
    await writeOptInAuditsConfig(root, { staleDiagramAudit: true });
    const apiPath = path.join(root, "src/api.ts");
    const storagePath = path.join(root, "src/storage.ts");
    await fs.mkdir(path.dirname(apiPath), { recursive: true });
    await fs.writeFile(apiPath, "export const api = 1;\n", "utf8");
    await fs.writeFile(storagePath, "export const storage = 1;\n", "utf8");

    const diagram = `API_Gateway -->|sync: validated request| App_Service
App_Service -.->|async: enqueue write| Storage_Adapter
Storage_Adapter -->|timeout| Fallback_Cache
Fallback_Cache -->|degraded response| API_Gateway`;
    await writeRuntimeArtifact(root, "03-design.md", completeDesignArtifact(diagram));

    const futureSeconds = Date.now() / 1000 + 2;
    await fs.utimes(apiPath, futureSeconds, futureSeconds);

    const result = await lintArtifact(root, "design");
    const staleAudit = result.findings.find((f) => f.section === "Stale Diagram Drift Check");
    expect(result.passed).toBe(false);
    expect(staleAudit?.required).toBe(true);
    expect(staleAudit?.found).toBe(false);
    expect(staleAudit?.details).toContain("src/api.ts");
  });

  it("passes stale diagram audit when blast-radius files are not newer than design baseline", async () => {
    const root = await createTempProject("design-stale-diagram-audit-pass");
    await writeOptInAuditsConfig(root, { staleDiagramAudit: true });
    const apiPath = path.join(root, "src/api.ts");
    const storagePath = path.join(root, "src/storage.ts");
    await fs.mkdir(path.dirname(apiPath), { recursive: true });
    await fs.writeFile(apiPath, "export const api = 1;\n", "utf8");
    await fs.writeFile(storagePath, "export const storage = 1;\n", "utf8");
    const pastSeconds = Date.now() / 1000 - 60;
    await fs.utimes(apiPath, pastSeconds, pastSeconds);
    await fs.utimes(storagePath, pastSeconds, pastSeconds);

    const diagram = `API_Gateway -->|sync: validated request| App_Service
App_Service -.->|async: enqueue write| Storage_Adapter
Storage_Adapter -->|timeout| Fallback_Cache
Fallback_Cache -->|degraded response| API_Gateway`;
    await writeRuntimeArtifact(root, "03-design.md", completeDesignArtifact(diagram));

    const result = await lintArtifact(root, "design");
    const staleAudit = result.findings.find((f) => f.section === "Stale Diagram Drift Check");
    expect(staleAudit?.required).toBe(true);
    expect(staleAudit?.found).toBe(true);
  });

  it("fails design artifact when Failure Mode Table uses legacy header shape", async () => {
    const root = await createTempProject("design-failure-table-legacy-header");
    const diagram = `API_Gateway -->|sync: validated request| App_Service
App_Service -.->|async: enqueue write| Storage_Adapter
Storage_Adapter -->|timeout| Fallback_Cache
Fallback_Cache -->|degraded response| API_Gateway`;
    const artifact = completeDesignArtifact(diagram)
      .replace(
        "| Method | Exception | Rescue | UserSees |",
        "| Failure mode | Trigger | Detection | Mitigation | User impact |"
      )
      .replace("|---|---|---|---|", "|---|---|---|---|---|")
      .replace(
        "| Persist write | timeout: upstream latency spike | RESCUED=Y TEST=Y (fallback cache read + retry queue) | stale but available response |",
        "| Persist write | timeout: upstream latency spike | alarm fired | fallback cache read + retry queue | stale but available response |"
      );
    await writeRuntimeArtifact(root, "03-design.md", artifact);

    const result = await lintArtifact(root, "design");
    const failureTable = result.findings.find((f) => f.section === "Failure Mode Table");
    expect(result.passed).toBe(false);
    expect(failureTable?.found).toBe(false);
    expect(failureTable?.details).toContain("header must be exactly");
  });

  it("fails design artifact when Failure Mode Table has unresolved CRITICAL row", async () => {
    const root = await createTempProject("design-failure-table-critical-row");
    const diagram = `API_Gateway -->|sync: validated request| App_Service
App_Service -.->|async: enqueue write| Storage_Adapter
Storage_Adapter -->|timeout| Fallback_Cache
Fallback_Cache -->|degraded response| API_Gateway`;
    const artifact = completeDesignArtifact(diagram).replace(
      "| Persist write | timeout: upstream latency spike | RESCUED=Y TEST=Y (fallback cache read + retry queue) | stale but available response |",
      "| Persist write | timeout: upstream latency spike | RESCUED=N TEST=N | Silent |"
    );
    await writeRuntimeArtifact(root, "03-design.md", artifact);

    const result = await lintArtifact(root, "design");
    const failureTable = result.findings.find((f) => f.section === "Failure Mode Table");
    expect(result.passed).toBe(false);
    expect(failureTable?.found).toBe(false);
    expect(failureTable?.details).toContain("CRITICAL");
  });

  it("rejects spec artifact when an acceptance criterion uses vague adjectives", async () => {
    const root = await createTempProject("spec-vague-ac");
    await writeRuntimeArtifact(root, "04-spec.md", `# Specification Artifact

## Acceptance Criteria
| ID | Criterion (observable/measurable/falsifiable) | Design Decision Ref |
|---|---|---|
| AC-1 | The system should be fast and intuitive | D-1 |

## Edge Cases
| Criterion ID | Boundary case | Error case |
|---|---|---|
| AC-1 | Empty input | Server error |

## Constraints and Assumptions
- Constraints: None
- Assumptions: None

## Testability Map
| Criterion ID | Verification approach | Command/manual steps |
|---|---|---|
| AC-1 | manual | Check it works |

## Approval
- Approved by: user
- Date: 2026-04-14
`);

    const result = await lintArtifact(root, "spec");
    expect(result.passed).toBe(false);
    const acFinding = result.findings.find((f) => f.section === "Acceptance Criteria");
    expect(acFinding?.found).toBe(false);
    expect(acFinding?.details.toLowerCase()).toMatch(/vague adjective/);
  });

  it("rejects acceptance criterion that has no observable verb and no number", async () => {
    const root = await createTempProject("spec-no-predicate");
    await writeRuntimeArtifact(root, "04-spec.md", `# Specification Artifact

## Acceptance Criteria
| ID | Criterion (observable/measurable/falsifiable) | Design Decision Ref |
|---|---|---|
| AC-1 | The system has a release validator module for metadata | D-1 |

## Edge Cases
| Criterion ID | Boundary case | Error case |
|---|---|---|
| AC-1 | Missing fields | Corrupt data |

## Constraints and Assumptions
- Constraints: None
- Assumptions: None

## Testability Map
| Criterion ID | Verification approach | Command/manual steps |
|---|---|---|
| AC-1 | unit | npm test |

## Approval
- Approved by: user
- Date: 2026-04-14
`);

    const result = await lintArtifact(root, "spec");
    expect(result.passed).toBe(false);
    const ac = result.findings.find((f) => f.section === "Acceptance Criteria");
    expect(ac?.details.toLowerCase()).toMatch(/measurable predicate/);
  });

  it("accepts spec artifact with a measurable acceptance criterion", async () => {
    const root = await createTempProject("spec-measurable-ac");
    await writeRuntimeArtifact(root, "04-spec.md", `# Specification Artifact

## Acceptance Criteria
| ID | Criterion (observable/measurable/falsifiable) | Design Decision Ref |
|---|---|---|
| AC-1 | Publish blocks when package.json version differs from CHANGELOG heading | D-1 |

## Edge Cases
| Criterion ID | Boundary case | Error case |
|---|---|---|
| AC-1 | Empty changelog | Mismatched version |

## Constraints and Assumptions
- Constraints: Node 20+ only
- Assumptions: Release automation runs on CI

## Testability Map
| Criterion ID | Verification approach | Command/manual steps |
|---|---|---|
| AC-1 | unit | npm run test -- publish-guard |

## Approval
- Approved by: user
- Date: 2026-04-14
`);

    const result = await lintArtifact(root, "spec");
    expect(result.passed).toBe(true);
  });

  it("passes complete plan artifact", async () => {
    const root = await createTempProject("plan-full-pass");
    await writeRuntimeArtifact(root, "05-plan.md", `# Plan Artifact

## Dependency Graph
- T-1 -> T-2 -> T-3

## Dependency Batches

### Batch 1
- Task IDs: T-1
- Verification gate: schema tests pass

### Batch 2
- Task IDs: T-2
- Depends on: Batch 1
- Verification gate: integration tests pass

## Task List
| Task ID | Description | Acceptance criterion | Verification command | Effort |
|---|---|---|---|---|
| T-1 | Define schema | AC-1 | npm test | S |
| T-2 | Implement publisher | AC-1, AC-2 | npm test | M |

## Acceptance Mapping
| Criterion ID | Task IDs |
|---|---|
| AC-1 | T-1, T-2 |
| AC-2 | T-2 |

## WAIT_FOR_CONFIRM
- Status: pending
- Confirmed by:
`);

    const result = await lintArtifact(root, "plan");
    expect(result.passed).toBe(true);
  });

  it("enables strict plan guard checks when frontmatter is present", async () => {
    const root = await createTempProject("plan-strict-guards");
    const frontmatter = `---
stage: plan
schema_version: 1
version: 0.18.0
feature: test-feature
locked_decisions: []
inputs_hash: sha256:pending
---`;
    const planWithViolations = completePlanArtifact(frontmatter).replace(
      "| T-2 | Implement publisher | AC-1, AC-2 | npm test | M |",
      "| T-2 | TODO implement publisher for now | AC-1, AC-2 | npm test | M |"
    );
    await writeRuntimeArtifact(root, "05-plan.md", planWithViolations);
    await fs.writeFile(
      path.join(root, ".cclaw/artifacts/02-scope.md"),
      `# Scope Artifact

## Locked Decisions (D-XX)
| ID | Decision | Rationale |
|---|---|---|
| D-01 | Keep audit trail in JSONL | compliance |
`,
      "utf8"
    );

    const result = await lintArtifact(root, "plan");
    const placeholder = result.findings.find((f) => f.section === "No Placeholder Enforcement");
    const trace = result.findings.find((f) => f.section === "Locked Decision Traceability");
    const reduction = result.findings.find((f) => f.section === "No Scope Reduction Language");

    expect(placeholder?.required).toBe(true);
    expect(placeholder?.found).toBe(false);
    expect(trace?.required).toBe(true);
    expect(trace?.found).toBe(false);
    expect(reduction?.required).toBe(true);
    expect(reduction?.found).toBe(false);
  });

  it("prefers slugged scope artifact over legacy file during plan trace checks", async () => {
    const root = await createTempProject("plan-prefers-slugged-scope");
    const frontmatter = `---
stage: plan
schema_version: 1
version: 0.18.0
feature: test-feature
locked_decisions: []
inputs_hash: sha256:pending
---`;
    const planWithDecisionCoverage = `${completePlanArtifact(frontmatter)}

## Locked Decision Coverage
| ID | Task IDs | Rationale |
|---|---|---|
| D-77 | T-1 | maps migration decision to first implementation task |
`;
    await writeRuntimeArtifact(root, "05-plan.md", planWithDecisionCoverage);
    await fs.writeFile(
      path.join(root, ".cclaw/artifacts/02-scope.md"),
      `# Scope Artifact

## Locked Decisions (D-XX)
| ID | Decision | Rationale |
|---|---|---|
| D-01 | Legacy scope decision | historical baseline |
`,
      "utf8"
    );
    await fs.writeFile(
      path.join(root, ".cclaw/artifacts/02-scope-payment-hardening.md"),
      `# Scope Artifact

## Locked Decisions (D-XX)
| ID | Decision | Rationale |
|---|---|---|
| D-77 | New scope decision | active run decision |
`,
      "utf8"
    );

    const result = await lintArtifact(root, "plan");
    const trace = result.findings.find((f) => f.section === "Locked Decision Traceability");

    expect(trace?.required).toBe(true);
    expect(trace?.found).toBe(true);
    expect(trace?.details).toContain("All 1 scope decision IDs are referenced in plan");
  });

  it("keeps plan guard checks advisory in legacy artifacts without strict markers", async () => {
    const root = await createTempProject("plan-legacy-guards");
    const legacyPlan = completePlanArtifact().replace(
      "| T-2 | Implement publisher | AC-1, AC-2 | npm test | M |",
      "| T-2 | TODO implement publisher for now | AC-1, AC-2 | npm test | M |"
    );
    await writeRuntimeArtifact(root, "05-plan.md", legacyPlan);
    await fs.writeFile(
      path.join(root, ".cclaw/artifacts/02-scope.md"),
      `# Scope Artifact

## Locked Decisions (D-XX)
| ID | Decision | Rationale |
|---|---|---|
| D-01 | Keep audit trail in JSONL | compliance |
`,
      "utf8"
    );

    const result = await lintArtifact(root, "plan");
    const placeholder = result.findings.find((f) => f.section === "No Placeholder Enforcement");
    const trace = result.findings.find((f) => f.section === "Locked Decision Traceability");
    const reduction = result.findings.find((f) => f.section === "No Scope Reduction Language");

    expect(result.passed).toBe(true);
    expect(placeholder?.required).toBe(false);
    expect(trace?.required).toBe(false);
    expect(reduction?.required).toBe(false);
  });

  it("reports frontmatter validation errors for stage/schema/hash mismatches", async () => {
    const root = await createTempProject("plan-frontmatter-invalid");
    const invalidFrontmatter = `---
stage: scope
schema_version: 2
version: 0.18.0
feature: test-feature
locked_decisions: []
inputs_hash: sha256:not-valid
---`;
    await writeRuntimeArtifact(root, "05-plan.md", completePlanArtifact(invalidFrontmatter));

    const result = await lintArtifact(root, "plan");
    const frontmatter = result.findings.find((f) => f.section === "Frontmatter");

    expect(frontmatter?.required).toBe(true);
    expect(frontmatter?.found).toBe(false);
    expect(frontmatter?.details).toContain('stage must be "plan"');
  });

  it("reports missing frontmatter key details when strict block is incomplete", async () => {
    const root = await createTempProject("plan-frontmatter-missing-key");
    const incompleteFrontmatter = `---
stage: plan
schema_version: 1
version: 0.18.0
feature: test-feature
locked_decisions: []
---`;
    await writeRuntimeArtifact(root, "05-plan.md", completePlanArtifact(incompleteFrontmatter));

    const result = await lintArtifact(root, "plan");
    const frontmatter = result.findings.find((f) => f.section === "Frontmatter");

    expect(frontmatter?.required).toBe(true);
    expect(frontmatter?.found).toBe(false);
    expect(frontmatter?.details).toContain("missing required key");
  });

  it("reports schema version mismatch when frontmatter uses non-v1 schema", async () => {
    const root = await createTempProject("plan-frontmatter-schema-mismatch");
    const badSchemaFrontmatter = `---
stage: plan
schema_version: 2
version: 0.18.0
feature: test-feature
locked_decisions: []
inputs_hash: sha256:pending
---`;
    await writeRuntimeArtifact(root, "05-plan.md", completePlanArtifact(badSchemaFrontmatter));

    const result = await lintArtifact(root, "plan");
    const frontmatter = result.findings.find((f) => f.section === "Frontmatter");
    expect(frontmatter?.found).toBe(false);
    expect(frontmatter?.details).toContain('schema_version must be "1"');
  });

  it("reports invalid inputs_hash format in frontmatter", async () => {
    const root = await createTempProject("plan-frontmatter-hash-mismatch");
    const badHashFrontmatter = `---
stage: plan
schema_version: 1
version: 0.18.0
feature: test-feature
locked_decisions: []
inputs_hash: sha256:not-a-real-hash
---`;
    await writeRuntimeArtifact(root, "05-plan.md", completePlanArtifact(badHashFrontmatter));

    const result = await lintArtifact(root, "plan");
    const frontmatter = result.findings.find((f) => f.section === "Frontmatter");
    expect(frontmatter?.found).toBe(false);
    expect(frontmatter?.details).toContain("inputs_hash must be");
  });

  it("fails plan when Dependency Graph is missing", async () => {
    const root = await createTempProject("plan-no-dg");
    await writeRuntimeArtifact(root, "05-plan.md", `# Plan Artifact

## Dependency Batches

### Batch 1
- Task IDs: T-1
- Verification gate: tests pass

## Task List
| Task ID | Description | Acceptance criterion | Verification command | Effort |
|---|---|---|---|---|
| T-1 | Do stuff | AC-1 | npm test | S |

## Acceptance Mapping
| Criterion ID | Task IDs |
|---|---|
| AC-1 | T-1 |

## WAIT_FOR_CONFIRM
- Status: pending
- Confirmed by:
`);

    const result = await lintArtifact(root, "plan");
    expect(result.passed).toBe(true);
    const dg = result.findings.find((f) => f.section === "Dependency Graph");
    expect(dg?.found).toBe(false);
    expect(dg?.required).toBe(false);
  });

  it("fails plan when Task List is empty", async () => {
    const root = await createTempProject("plan-empty-tasks");
    await writeRuntimeArtifact(root, "05-plan.md", `# Plan Artifact

## Dependency Graph
- T-1

## Dependency Batches

### Batch 1
- Task IDs: T-1
- Verification gate: tests pass

## Task List

## Acceptance Mapping
| Criterion ID | Task IDs |
|---|---|
| AC-1 | T-1 |

## WAIT_FOR_CONFIRM
- Status: pending
- Confirmed by:
`);

    const result = await lintArtifact(root, "plan");
    expect(result.passed).toBe(false);
    const tl = result.findings.find((f) => f.section === "Task List");
    expect(tl?.found).toBe(false);
  });

  it("fails plan WAIT_FOR_CONFIRM when Status is missing", async () => {
    const root = await createTempProject("plan-wfc-missing");
    await writeRuntimeArtifact(root, "05-plan.md", `# Plan Artifact

## Dependency Graph
- T-1 -> T-2

## Dependency Batches

### Batch 1
- Task IDs: T-1
- Verification gate: tests pass

## Task List
| Task ID | Description | Acceptance criterion | Verification command | Effort |
|---|---|---|---|---|
| T-1 | Do stuff | AC-1 | npm test | S |

## Acceptance Mapping
| Criterion ID | Task IDs |
|---|---|
| AC-1 | T-1 |

## WAIT_FOR_CONFIRM
- Confirmed by: nobody
`);

    const result = await lintArtifact(root, "plan");
    const wfc = result.findings.find((f) => f.section === "WAIT_FOR_CONFIRM");
    expect(wfc?.found).toBe(false);
    expect(wfc?.details).toContain("Status");
  });

  it("passes plan WAIT_FOR_CONFIRM when Status is pending", async () => {
    const root = await createTempProject("plan-wfc-ok");
    await writeRuntimeArtifact(root, "05-plan.md", `# Plan Artifact

## Dependency Graph
- T-1 -> T-2

## Dependency Batches

### Batch 1
- Task IDs: T-1
- Verification gate: tests pass

## Task List
| Task ID | Description | Acceptance criterion | Verification command | Effort |
|---|---|---|---|---|
| T-1 | Do stuff | AC-1 | npm test | S |

## Acceptance Mapping
| Criterion ID | Task IDs |
|---|---|
| AC-1 | T-1 |

## WAIT_FOR_CONFIRM
- Status: pending
- Confirmed by:
`);

    const result = await lintArtifact(root, "plan");
    const wfc = result.findings.find((f) => f.section === "WAIT_FOR_CONFIRM");
    expect(wfc?.found).toBe(true);
  });

  it("fails plan WAIT_FOR_CONFIRM when Status is invalid value", async () => {
    const root = await createTempProject("plan-wfc-invalid");
    await writeRuntimeArtifact(root, "05-plan.md", `# Plan Artifact

## Dependency Graph
- T-1 -> T-2

## Dependency Batches

### Batch 1
- Task IDs: T-1
- Verification gate: tests pass

## Task List
| Task ID | Description | Acceptance criterion | Verification command | Effort |
|---|---|---|---|---|
| T-1 | Do stuff | AC-1 | npm test | S |

## Acceptance Mapping
| Criterion ID | Task IDs |
|---|---|
| AC-1 | T-1 |

## WAIT_FOR_CONFIRM
- Status: maybe
- Confirmed by:
`);

    const result = await lintArtifact(root, "plan");
    const wfc = result.findings.find((f) => f.section === "WAIT_FOR_CONFIRM");
    expect(wfc?.found).toBe(false);
    expect(wfc?.details).toContain("pending, approved");
  });

  it("passes complete tdd artifact", async () => {
    const root = await createTempProject("tdd-full-pass");
    await writeRuntimeArtifact(root, "06-tdd.md", `# TDD Artifact

## RED Evidence
| Slice | Test name | Command | Failure output summary |
|---|---|---|---|
| S-1 | counts unique keys | pnpm vitest run dedupe.test.ts | Cannot find module |

## Acceptance Mapping
| Slice | Plan task ID | Spec criterion ID |
|---|---|---|
| S-1 | T-1 | AC-1 |

## Failure Analysis
| Slice | Expected missing behavior | Actual failure reason |
|---|---|---|
| S-1 | Module not implemented | Module import fails — correct |

## GREEN Evidence
- Full suite command: pnpm vitest run
- Full suite result: 12 passed, 0 failed

## Verification Ladder
- Highest tier reached: command
- Evidence: pnpm vitest run dedupe.test.ts (pass)

## REFACTOR Notes
- What changed: Extracted helper function
- Why: Reuse across tests
- Behavior preserved: Full suite green after refactor

## Traceability
- Plan task IDs: T-1
- Spec criterion IDs: AC-1
`);

    const result = await lintArtifact(root, "tdd");
    expect(result.passed).toBe(true);
  });

  it("fails tdd when RED Evidence does not include explicit failure markers", async () => {
    const root = await createTempProject("tdd-red-no-failure-marker");
    await writeRuntimeArtifact(root, "06-tdd.md", `# TDD Artifact

## RED Evidence
- Command: pnpm vitest run dedupe.test.ts
- Output summary: test setup executed, pending implementation details
- Notes: needs more assertions

## Acceptance Mapping
| Slice | Plan task ID | Spec criterion ID |
|---|---|---|
| S-1 | T-1 | AC-1 |

## Failure Analysis
| Slice | Expected missing behavior | Actual failure reason |
|---|---|---|
| S-1 | Module not implemented | Pending implementation note |

## GREEN Evidence
- Full suite command: pnpm vitest run
- Full suite result: 12 passed, 0 failed

## Verification Ladder
- Highest tier reached: command
- Evidence: pnpm vitest run dedupe.test.ts (pass)

## REFACTOR Notes
- What changed: Extracted helper function
- Why: Reuse across tests
- Behavior preserved: Full suite green after refactor

## Traceability
- Plan task IDs: T-1
- Spec criterion IDs: AC-1
`);

    const result = await lintArtifact(root, "tdd");
    expect(result.passed).toBe(false);
    const red = result.findings.find((f) => f.section === "RED Evidence");
    expect(red?.found).toBe(false);
    expect(red?.details).toContain("failing output markers");
  });

  it("fails tdd when GREEN Evidence lacks explicit pass markers", async () => {
    const root = await createTempProject("tdd-green-no-pass-marker");
    await writeRuntimeArtifact(root, "06-tdd.md", `# TDD Artifact

## RED Evidence
| Slice | Test name | Command | Failure output summary |
|---|---|---|---|
| S-1 | dedupe fails on duplicate key | pnpm vitest run dedupe.test.ts | FAIL AssertionError expected unique list |

## Acceptance Mapping
| Slice | Plan task ID | Spec criterion ID |
|---|---|---|
| S-1 | T-1 | AC-1 |

## Failure Analysis
| Slice | Expected missing behavior | Actual failure reason |
|---|---|---|
| S-1 | Dedupe missing | Assertion verifies missing branch |

## GREEN Evidence
- Full suite command: pnpm vitest run
- Full suite result: verification output unavailable

## Verification Ladder
- Highest tier reached: command
- Evidence: pnpm vitest run dedupe.test.ts

## REFACTOR Notes
- What changed: Extracted helper function
- Why: Reuse across tests
- Behavior preserved: Full suite green after refactor

## Traceability
- Plan task IDs: T-1
- Spec criterion IDs: AC-1
`);

    const result = await lintArtifact(root, "tdd");
    expect(result.passed).toBe(false);
    const green = result.findings.find((f) => f.section === "GREEN Evidence");
    expect(green?.found).toBe(false);
    expect(green?.details).toContain("passing markers");
  });

  it("fails tdd when RED Evidence is missing", async () => {
    const root = await createTempProject("tdd-no-red");
    await writeRuntimeArtifact(root, "06-tdd.md", `# TDD Artifact

## Acceptance Mapping
| Slice | Plan task ID | Spec criterion ID |
|---|---|---|
| S-1 | T-1 | AC-1 |

## Failure Analysis
| Slice | Expected missing behavior | Actual failure reason |
|---|---|---|
| S-1 | Module missing | Import fails |

## GREEN Evidence
- Full suite command: pnpm vitest run
- Full suite result: 12 passed

## REFACTOR Notes
- What changed: Extracted helper
- Why: Reuse
- Behavior preserved: Yes

## Traceability
- Plan task IDs: T-1
- Spec criterion IDs: AC-1
`);

    const result = await lintArtifact(root, "tdd");
    expect(result.passed).toBe(false);
    const red = result.findings.find((f) => f.section === "RED Evidence");
    expect(red?.found).toBe(false);
    expect(red?.required).toBe(true);
  });

  it("fails tdd when GREEN Evidence is empty", async () => {
    const root = await createTempProject("tdd-empty-green");
    await writeRuntimeArtifact(root, "06-tdd.md", `# TDD Artifact

## RED Evidence
| Slice | Test name | Command | Failure output summary |
|---|---|---|---|
| S-1 | test name | vitest | Cannot find module |

## Acceptance Mapping
| Slice | Plan task ID | Spec criterion ID |
|---|---|---|
| S-1 | T-1 | AC-1 |

## Failure Analysis
| Slice | Expected missing behavior | Actual failure reason |
|---|---|---|
| S-1 | Not implemented | Import fails |

## GREEN Evidence

## REFACTOR Notes
- What changed: Nothing
- Why: Minimal
- Behavior preserved: Yes

## Traceability
- Plan task IDs: T-1
- Spec criterion IDs: AC-1
`);

    const result = await lintArtifact(root, "tdd");
    expect(result.passed).toBe(false);
    const green = result.findings.find((f) => f.section === "GREEN Evidence");
    expect(green?.found).toBe(false);
  });

  it("fails tdd when Acceptance Mapping is missing", async () => {
    const root = await createTempProject("tdd-no-am");
    await writeRuntimeArtifact(root, "06-tdd.md", `# TDD Artifact

## RED Evidence
| Slice | Test name | Command | Failure output summary |
|---|---|---|---|
| S-1 | test name | vitest | Cannot find module |

## Failure Analysis
| Slice | Expected missing behavior | Actual failure reason |
|---|---|---|
| S-1 | Not implemented | Import fails |

## GREEN Evidence
- Full suite command: vitest run
- Full suite result: 12 passed

## Verification Ladder
- Highest tier reached: command
- Evidence: vitest run (pass)

## REFACTOR Notes
- What changed: Extracted helper
- Why: Reuse
- Behavior preserved: Yes

## Traceability
- Plan task IDs: T-1
- Spec criterion IDs: AC-1
`);

    const result = await lintArtifact(root, "tdd");
    expect(result.passed).toBe(true);
    const am = result.findings.find((f) => f.section === "Acceptance Mapping");
    expect(am?.found).toBe(false);
    expect(am?.required).toBe(false);
  });

  it("fails tdd when Failure Analysis is missing", async () => {
    const root = await createTempProject("tdd-no-fa");
    await writeRuntimeArtifact(root, "06-tdd.md", `# TDD Artifact

## RED Evidence
| Slice | Test name | Command | Failure output summary |
|---|---|---|---|
| S-1 | test name | vitest | Cannot find module |

## Acceptance Mapping
| Slice | Plan task ID | Spec criterion ID |
|---|---|---|
| S-1 | T-1 | AC-1 |

## GREEN Evidence
- Full suite command: vitest run
- Full suite result: 12 passed

## Verification Ladder
- Highest tier reached: command
- Evidence: vitest run (pass)

## REFACTOR Notes
- What changed: Extracted helper
- Why: Reuse
- Behavior preserved: Yes

## Traceability
- Plan task IDs: T-1
- Spec criterion IDs: AC-1
`);

    const result = await lintArtifact(root, "tdd");
    expect(result.passed).toBe(true);
    const fa = result.findings.find((f) => f.section === "Failure Analysis");
    expect(fa?.found).toBe(false);
    expect(fa?.required).toBe(false);
  });

  it("fails tdd when REFACTOR Notes is missing", async () => {
    const root = await createTempProject("tdd-no-refactor");
    await writeRuntimeArtifact(root, "06-tdd.md", `# TDD Artifact

## RED Evidence
| Slice | Test name | Command | Failure output summary |
|---|---|---|---|
| S-1 | test name | vitest | Cannot find module |

## Acceptance Mapping
| Slice | Plan task ID | Spec criterion ID |
|---|---|---|
| S-1 | T-1 | AC-1 |

## Failure Analysis
| Slice | Expected missing behavior | Actual failure reason |
|---|---|---|
| S-1 | Not implemented | Import fails |

## GREEN Evidence
- Full suite command: vitest run
- Full suite result: 12 passed

## Traceability
- Plan task IDs: T-1
- Spec criterion IDs: AC-1
`);

    const result = await lintArtifact(root, "tdd");
    expect(result.passed).toBe(false);
    const refactor = result.findings.find((f) => f.section === "REFACTOR Notes");
    expect(refactor?.found).toBe(false);
    expect(refactor?.required).toBe(true);
  });

  it("fails tdd when Traceability is missing", async () => {
    const root = await createTempProject("tdd-no-trace");
    await writeRuntimeArtifact(root, "06-tdd.md", `# TDD Artifact

## RED Evidence
| Slice | Test name | Command | Failure output summary |
|---|---|---|---|
| S-1 | test name | vitest | Cannot find module |

## Acceptance Mapping
| Slice | Plan task ID | Spec criterion ID |
|---|---|---|
| S-1 | T-1 | AC-1 |

## Failure Analysis
| Slice | Expected missing behavior | Actual failure reason |
|---|---|---|
| S-1 | Not implemented | Import fails |

## GREEN Evidence
- Full suite command: vitest run
- Full suite result: 12 passed

## REFACTOR Notes
- What changed: Extracted helper
- Why: Reuse
- Behavior preserved: Yes
`);

    const result = await lintArtifact(root, "tdd");
    expect(result.passed).toBe(false);
    const trace = result.findings.find((f) => f.section === "Traceability");
    expect(trace?.found).toBe(false);
    expect(trace?.required).toBe(true);
  });

  it("passes complete review artifact", async () => {
    const root = await createTempProject("review-full-pass");
    await writeRuntimeArtifact(root, "07-review.md", `# Review Artifact

## Layer 1 Verdict
| Criterion | Verdict | Evidence |
|---|---|---|
| AC-1 | PASS | notification-feed.e2e.ts:44-88 |
| AC-2 | PARTIAL | feedStore.test.ts missing race case |

## Layer 2 Findings
| ID | Severity | Category | Description | Status |
|---|---|---|---|---|
| R-1 | Critical | correctness | Snapshot cursor gap | open |
| R-2 | Suggestion | architecture | Extract shared hook | open |

## Review Army Contract
- See \`07-review-army.json\`
- Reconciliation summary: 0 conflicts

## Review Readiness Dashboard
- Layer 1 complete: yes
- Layer 2 complete: yes
- Review army schema valid: yes
- Open critical blockers: 1
- Adversarial review pass: false

## Completeness Score
- AC coverage: 2/2 (100%)
- Task coverage: 2/2
- Slice coverage: 2/2
- Adversarial review pass: false
- Overall score: 80

## Severity Summary
- Critical: 1
- Important: 0
- Suggestion: 1

## Final Verdict
- BLOCKED
`);

    const result = await lintArtifact(root, "review");
    expect(result.passed).toBe(true);
  });

  it("fails review when Layer 1 Verdict is missing", async () => {
    const root = await createTempProject("review-no-l1");
    await writeRuntimeArtifact(root, "07-review.md", `# Review Artifact

## Layer 2 Findings
| ID | Severity | Category | Description | Status |
|---|---|---|---|---|
| R-1 | Suggestion | correctness | Minor naming | open |

## Review Army Contract
- See \`07-review-army.json\`
- Reconciliation summary: none

## Review Readiness Dashboard
- Layer 1 complete: no
- Layer 2 complete: yes
- Review army schema valid: yes
- Open critical blockers: 0

## Severity Summary
- Critical: 0
- Important: 0
- Suggestion: 1

## Final Verdict
- APPROVED
`);

    const result = await lintArtifact(root, "review");
    expect(result.passed).toBe(false);
    const l1 = result.findings.find((f) => f.section === "Layer 1 Verdict");
    expect(l1?.found).toBe(false);
    expect(l1?.required).toBe(true);
  });

  it("fails review when Review Army Contract is missing", async () => {
    const root = await createTempProject("review-no-army");
    await writeRuntimeArtifact(root, "07-review.md", `# Review Artifact

## Layer 1 Verdict
| Criterion | Verdict | Evidence |
|---|---|---|
| AC-1 | PASS | test evidence |

## Layer 2 Findings
| ID | Severity | Category | Description | Status |
|---|---|---|---|---|
| R-1 | Suggestion | correctness | Minor naming | open |

## Review Readiness Dashboard
- Layer 1 complete: yes
- Layer 2 complete: yes
- Review army schema valid: no
- Open critical blockers: 0

## Severity Summary
- Critical: 0
- Important: 0
- Suggestion: 1

## Final Verdict
- APPROVED
`);

    const result = await lintArtifact(root, "review");
    expect(result.passed).toBe(false);
    const army = result.findings.find((f) => f.section === "Review Army Contract");
    expect(army?.found).toBe(false);
    expect(army?.required).toBe(true);
  });

  it("fails review when Layer 2 Findings is missing", async () => {
    const root = await createTempProject("review-no-l2");
    await writeRuntimeArtifact(root, "07-review.md", `# Review Artifact

## Layer 1 Verdict
| Criterion | Verdict | Evidence |
|---|---|---|
| AC-1 | PASS | e2e test evidence |

## Review Army Contract
- See \`07-review-army.json\`
- Reconciliation summary: none

## Review Readiness Dashboard
- Layer 1 complete: yes
- Layer 2 complete: no
- Review army schema valid: yes
- Open critical blockers: 0

## Severity Summary
- Critical: 0
- Important: 0
- Suggestion: 0

## Final Verdict
- APPROVED
`);

    const result = await lintArtifact(root, "review");
    expect(result.passed).toBe(true);
    const l2 = result.findings.find((f) => f.section === "Layer 2 Findings");
    expect(l2?.found).toBe(false);
    expect(l2?.required).toBe(false);
  });

  it("fails review when Final Verdict is invalid enum value", async () => {
    const root = await createTempProject("review-bad-verdict");
    await writeRuntimeArtifact(root, "07-review.md", `# Review Artifact

## Layer 1 Verdict
| Criterion | Verdict | Evidence |
|---|---|---|
| AC-1 | PASS | test evidence |

## Layer 2 Findings
| ID | Severity | Category | Description | Status |
|---|---|---|---|---|
| R-1 | Suggestion | correctness | Minor naming | open |

## Review Army Contract
- See \`07-review-army.json\`
- Reconciliation summary: none

## Review Readiness Dashboard
- Layer 1 complete: yes
- Layer 2 complete: yes
- Review army schema valid: yes
- Open critical blockers: 0

## Severity Summary
- Critical: 0
- Important: 0
- Suggestion: 1

## Final Verdict
- LOOKS_GOOD
`);

    const result = await lintArtifact(root, "review");
    const verdict = result.findings.find((f) => f.section === "Final Verdict");
    expect(verdict?.found).toBe(false);
    expect(verdict?.details).toContain("exactly one");
  });

  it("fails review when Severity Summary is missing", async () => {
    const root = await createTempProject("review-no-severity");
    await writeRuntimeArtifact(root, "07-review.md", `# Review Artifact

## Layer 1 Verdict
| Criterion | Verdict | Evidence |
|---|---|---|
| AC-1 | PASS | test evidence |

## Layer 2 Findings
| ID | Severity | Category | Description | Status |
|---|---|---|---|---|
| R-1 | Suggestion | correctness | Minor naming | open |

## Review Army Contract
- See \`07-review-army.json\`
- Reconciliation summary: none

## Review Readiness Dashboard
- Layer 1 complete: yes
- Layer 2 complete: yes
- Review army schema valid: yes
- Open critical blockers: 0

## Final Verdict
- APPROVED
`);

    const result = await lintArtifact(root, "review");
    expect(result.passed).toBe(false);
    const sev = result.findings.find((f) => f.section === "Severity Summary");
    expect(sev?.found).toBe(false);
    expect(sev?.required).toBe(true);
  });

  it("fails Prime Directives when required keywords are missing", async () => {
    const root = await createTempProject("scope-keywords");
    await writeRuntimeArtifact(root, "02-scope.md", `# Scope Artifact

## Prime Directives
- Basic error handling is in scope.

## Premise Challenge
- Right problem? Yes.
- Direct path? Yes.
- What if nothing? Bad outcomes.

## Implementation Alternatives
| Option | Summary | Effort (S/M/L/XL) | Risk | Pros | Cons | Reuses |
|---|---|---|---|---|---|---|
| A | Simple approach | S | Low | Fast | Limited | None |
| B | Better approach | M | Med | Robust | Slower | Some |

## Scope Mode
- [x] hold

## Mode-Specific Analysis
- Selected mode: HOLD
- Analysis: minimum-change-set hardening applied to existing notification system.

## In Scope / Out of Scope

### In Scope
- Notification feed

### Out of Scope
- Email providers

## Discretion Areas
- None

## Deferred Items
| Item | Rationale |
|---|---|
| None | N/A |

## Error & Rescue Registry
| Capability | Failure mode | Detection | Fallback |
|---|---|---|---|
| Feed | Timeout | Health check | Retry |

## Completion Dashboard
- Checklist findings: complete
- Resolved decisions count: 3
- Unresolved decisions: None

## Scope Summary
- Selected mode: hold
- Accepted scope: notification feed hardening
- Deferred: none
- Explicitly excluded: email/SMS
`);

    const result = await lintArtifact(root, "scope");
    const primeDirectives = result.findings.find((f) => f.section === "Prime Directives");
    expect(primeDirectives?.found).toBe(false);
    expect(primeDirectives?.details).toContain("missing");
  });
});

describe("review army schema validation", () => {
  it("accepts structured review-army payload with consistent blockers", async () => {
    const root = await createTempProject("review-army-valid");
    await fs.mkdir(path.join(root, ".cclaw/state"), { recursive: true });
    await fs.mkdir(path.join(root, ".cclaw/artifacts"), { recursive: true });
    await fs.writeFile(path.join(root, ".cclaw/state/flow-state.json"), JSON.stringify({
      currentStage: "review",
      activeRunId: "active",
      completedStages: []
    }, null, 2), "utf8");
    await fs.writeFile(path.join(root, ".cclaw/artifacts/07-review-army.json"), JSON.stringify({
      version: 1,
      generatedAt: "2026-01-01T00:00:00Z",
      scope: { base: "main", head: "feature", files: ["src/a.ts"] },
      findings: [{
        id: "F-1",
        severity: "Critical",
        confidence: 8,
        fingerprint: "fp-1",
        reportedBy: ["spec-reviewer", "code-reviewer"],
        status: "open",
        location: { file: "src/a.ts", line: 10 },
        recommendation: "Add guard"
      }],
      reconciliation: {
        duplicatesCollapsed: 0,
        conflicts: [],
        multiSpecialistConfirmed: ["F-1"],
        shipBlockers: ["F-1"]
      }
    }, null, 2), "utf8");

    const result = await validateReviewArmy(root);
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("rejects malformed conflicts entries", async () => {
    const root = await createTempProject("review-army-bad-conflict");
    await fs.mkdir(path.join(root, ".cclaw/state"), { recursive: true });
    await fs.mkdir(path.join(root, ".cclaw/artifacts"), { recursive: true });
    await fs.writeFile(path.join(root, ".cclaw/state/flow-state.json"), JSON.stringify({
      currentStage: "review",
      activeRunId: "active",
      completedStages: []
    }, null, 2), "utf8");
    await fs.writeFile(path.join(root, ".cclaw/artifacts/07-review-army.json"), JSON.stringify({
      version: 1,
      generatedAt: "2026-01-01T00:00:00Z",
      scope: { base: "main", head: "feature", files: ["src/a.ts"] },
      findings: [{
        id: "F-1",
        severity: "Important",
        confidence: 6,
        fingerprint: "fp-1",
        reportedBy: ["code-reviewer"],
        status: "open",
        location: { file: "src/a.ts", line: 5 },
        recommendation: "Refactor"
      }],
      reconciliation: {
        duplicatesCollapsed: 0,
        conflicts: [{ bad: true }],
        multiSpecialistConfirmed: [],
        shipBlockers: []
      }
    }, null, 2), "utf8");

    const result = await validateReviewArmy(root);
    expect(result.valid).toBe(false);
    expect(result.errors.join("\n")).toContain("conflicts[0].findingId");
  });

  it("rejects multiSpecialistConfirmed referencing unknown finding id", async () => {
    const root = await createTempProject("review-army-bad-ms");
    await fs.mkdir(path.join(root, ".cclaw/state"), { recursive: true });
    await fs.mkdir(path.join(root, ".cclaw/artifacts"), { recursive: true });
    await fs.writeFile(path.join(root, ".cclaw/state/flow-state.json"), JSON.stringify({
      currentStage: "review",
      activeRunId: "active",
      completedStages: []
    }, null, 2), "utf8");
    await fs.writeFile(path.join(root, ".cclaw/artifacts/07-review-army.json"), JSON.stringify({
      version: 1,
      generatedAt: "2026-01-01T00:00:00Z",
      scope: { base: "main", head: "feature", files: ["src/a.ts"] },
      findings: [{
        id: "F-1",
        severity: "Suggestion",
        confidence: 5,
        fingerprint: "fp-1",
        reportedBy: ["code-reviewer"],
        status: "open"
      }],
      reconciliation: {
        duplicatesCollapsed: 0,
        conflicts: [],
        multiSpecialistConfirmed: ["F-NONEXISTENT"],
        shipBlockers: []
      }
    }, null, 2), "utf8");

    const result = await validateReviewArmy(root);
    expect(result.valid).toBe(false);
    expect(result.errors.join("\n")).toContain("multiSpecialistConfirmed references unknown finding id");
  });

  it("rejects duplicate finding IDs", async () => {
    const root = await createTempProject("review-army-dup-id");
    await fs.mkdir(path.join(root, ".cclaw/state"), { recursive: true });
    await fs.mkdir(path.join(root, ".cclaw/artifacts"), { recursive: true });
    await fs.writeFile(path.join(root, ".cclaw/state/flow-state.json"), JSON.stringify({
      currentStage: "review",
      activeRunId: "active",
      completedStages: []
    }, null, 2), "utf8");
    await fs.writeFile(path.join(root, ".cclaw/artifacts/07-review-army.json"), JSON.stringify({
      version: 1,
      generatedAt: "2026-01-01T00:00:00Z",
      scope: { base: "main", head: "feature", files: ["src/a.ts"] },
      findings: [
        {
          id: "F-1",
          severity: "Suggestion",
          confidence: 5,
          fingerprint: "fp-1",
          reportedBy: ["code-reviewer"],
          status: "open"
        },
        {
          id: "F-1",
          severity: "Important",
          confidence: 6,
          fingerprint: "fp-2",
          reportedBy: ["security-reviewer"],
          status: "open"
        }
      ],
      reconciliation: {
        duplicatesCollapsed: 0,
        conflicts: [],
        multiSpecialistConfirmed: [],
        shipBlockers: []
      }
    }, null, 2), "utf8");

    const result = await validateReviewArmy(root);
    expect(result.valid).toBe(false);
    expect(result.errors.join("\n")).toContain("must be unique");
  });

  it("rejects open critical findings that are not listed as ship blockers", async () => {
    const root = await createTempProject("review-army-invalid");
    await fs.mkdir(path.join(root, ".cclaw/state"), { recursive: true });
    await fs.mkdir(path.join(root, ".cclaw/artifacts"), { recursive: true });
    await fs.writeFile(path.join(root, ".cclaw/state/flow-state.json"), JSON.stringify({
      currentStage: "review",
      activeRunId: "active",
      completedStages: []
    }, null, 2), "utf8");
    await fs.writeFile(path.join(root, ".cclaw/artifacts/07-review-army.json"), JSON.stringify({
      version: 1,
      generatedAt: "2026-01-01T00:00:00Z",
      scope: { base: "main", head: "feature", files: ["src/a.ts"] },
      findings: [{
        id: "F-1",
        severity: "Critical",
        confidence: 9,
        fingerprint: "fp-1",
        reportedBy: ["security-reviewer"],
        status: "open",
        recommendation: "Patch before merge"
      }],
      reconciliation: {
        duplicatesCollapsed: 0,
        conflicts: [],
        multiSpecialistConfirmed: [],
        shipBlockers: []
      }
    }, null, 2), "utf8");

    const result = await validateReviewArmy(root);
    expect(result.valid).toBe(false);
    expect(result.errors.join("\n")).toContain("shipBlockers must include open Critical finding");
  });

  it("requires findings[*].location with file + line", async () => {
    const root = await createTempProject("review-army-location-required");
    await fs.mkdir(path.join(root, ".cclaw/state"), { recursive: true });
    await fs.mkdir(path.join(root, ".cclaw/artifacts"), { recursive: true });
    await fs.writeFile(path.join(root, ".cclaw/state/flow-state.json"), JSON.stringify({
      currentStage: "review",
      activeRunId: "active",
      completedStages: []
    }, null, 2), "utf8");
    await fs.writeFile(path.join(root, ".cclaw/artifacts/07-review-army.json"), JSON.stringify({
      version: 1,
      generatedAt: "2026-01-01T00:00:00Z",
      scope: { base: "main", head: "feature", files: ["src/a.ts"] },
      findings: [{
        id: "F-1",
        severity: "Important",
        confidence: 6,
        fingerprint: "fp-1",
        reportedBy: ["code-reviewer"],
        status: "open",
        recommendation: "Refactor"
      }],
      reconciliation: {
        duplicatesCollapsed: 0,
        conflicts: [],
        multiSpecialistConfirmed: [],
        shipBlockers: []
      }
    }, null, 2), "utf8");

    const result = await validateReviewArmy(root);
    expect(result.valid).toBe(false);
    expect(result.errors.join("\n")).toMatch(/location is required/);
  });

  it("requires multiSpecialistConfirmed findings to have >=2 distinct reviewers", async () => {
    const root = await createTempProject("review-army-multi-spec");
    await fs.mkdir(path.join(root, ".cclaw/state"), { recursive: true });
    await fs.mkdir(path.join(root, ".cclaw/artifacts"), { recursive: true });
    await fs.writeFile(path.join(root, ".cclaw/state/flow-state.json"), JSON.stringify({
      currentStage: "review",
      activeRunId: "active",
      completedStages: []
    }, null, 2), "utf8");
    await fs.writeFile(path.join(root, ".cclaw/artifacts/07-review-army.json"), JSON.stringify({
      version: 1,
      generatedAt: "2026-01-01T00:00:00Z",
      scope: { base: "main", head: "feature", files: ["src/a.ts"] },
      findings: [{
        id: "F-1",
        severity: "Important",
        confidence: 7,
        fingerprint: "fp-1",
        reportedBy: ["code-reviewer"],
        status: "open",
        location: { file: "src/a.ts", line: 3 },
        recommendation: "Simplify branch"
      }],
      reconciliation: {
        duplicatesCollapsed: 0,
        conflicts: [],
        multiSpecialistConfirmed: ["F-1"],
        shipBlockers: []
      }
    }, null, 2), "utf8");

    const result = await validateReviewArmy(root);
    expect(result.valid).toBe(false);
    expect(result.errors.join("\n")).toMatch(/confirmed by at least 2 distinct reviewers/);
  });

  it("extractMarkdownSectionBody ignores H2 headings inside fenced code blocks", () => {
    const markdown = `# doc

## Real Section
- real bullet

\`\`\`
## Fake Section
- not a real heading inside code block
\`\`\`

## Another Real Section
- second bullet
`;
    expect(extractMarkdownSectionBody(markdown, "Fake Section")).toBeNull();
    expect(extractMarkdownSectionBody(markdown, "Real Section")).toContain("real bullet");
    expect(extractMarkdownSectionBody(markdown, "Another Real Section")).toContain("second bullet");
  });

  it("extractMarkdownSectionBody concatenates duplicate H2 headings instead of overwriting", () => {
    const markdown = `# doc

## Notes
- first pass bullet

## Notes
- second pass bullet
`;
    const body = extractMarkdownSectionBody(markdown, "Notes");
    expect(body).toContain("first pass bullet");
    expect(body).toContain("second pass bullet");
  });

  it("rejects APPROVED_WITH_CONCERNS when open Critical findings remain", async () => {
    const root = await createTempProject("review-verdict-concerns-open-critical");
    await writeRuntimeArtifact(
      root,
      "07-review.md",
      `# Review Artifact

## Final Verdict
- APPROVED_WITH_CONCERNS
`
    );
    await fs.writeFile(
      path.join(root, ".cclaw/artifacts/07-review-army.json"),
      JSON.stringify(
        {
          version: 1,
          generatedAt: "2026-01-01T00:00:00Z",
          scope: { base: "main", head: "feature", files: ["src/a.ts"] },
          findings: [
            {
              id: "F-1",
              severity: "Critical",
              confidence: 9,
              fingerprint: "fp-1",
              reportedBy: ["code-reviewer", "security-reviewer"],
              status: "open",
              location: { file: "src/a.ts", line: 3 }
            }
          ],
          reconciliation: {
            duplicatesCollapsed: 0,
            conflicts: [],
            multiSpecialistConfirmed: ["F-1"],
            shipBlockers: ["F-1"]
          }
        },
        null,
        2
      ),
      "utf8"
    );

    const result = await checkReviewVerdictConsistency(root);
    expect(result.ok).toBe(false);
    expect(result.finalVerdict).toBe("APPROVED_WITH_CONCERNS");
    expect(result.errors.join("\n")).toMatch(/APPROVED_WITH_CONCERNS/);
  });

  it("passes review security attestation when NO_CHANGE_ATTESTATION is present", async () => {
    const root = await createTempProject("review-security-attestation-pass");
    await writeRuntimeArtifact(
      root,
      "07-review.md",
      `# Review Artifact

## Layer 2 Findings
| ID | Severity | Category | Description | Status |
|---|---|---|---|---|
| R-1 | Suggestion | correctness | naming cleanup | open |
- NO_CHANGE_ATTESTATION: No auth/input/secrets surface changed in this diff.
`
    );

    const result = await checkReviewSecurityNoChangeAttestation(root);
    expect(result.ok).toBe(true);
    expect(result.hasNoChangeAttestation).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("fails review security attestation when security section has no findings and no attestation", async () => {
    const root = await createTempProject("review-security-attestation-fail");
    await writeRuntimeArtifact(
      root,
      "07-review.md",
      `# Review Artifact

## Layer 2 Findings
| ID | Severity | Category | Description | Status |
|---|---|---|---|---|
| R-1 | Suggestion | correctness | naming cleanup | open |
`
    );

    const result = await checkReviewSecurityNoChangeAttestation(root);
    expect(result.ok).toBe(false);
    expect(result.errors.join("\n")).toMatch(/Layer 2 security evidence missing/);
  });

  it("fails review security attestation when layer 2 security section is missing", async () => {
    const root = await createTempProject("review-security-attestation-missing-section");
    await writeRuntimeArtifact(
      root,
      "07-review.md",
      `# Review Artifact

## Layer 1 Findings
| ID | Severity | Category | Description | Status |
|---|---|---|---|---|
| R-1 | Suggestion | correctness | naming cleanup | open |
`
    );

    const result = await checkReviewSecurityNoChangeAttestation(root);
    expect(result.ok).toBe(false);
    expect(result.errors.join("\n")).toMatch(/missing a Layer 2 security section/);
    expect(result.hasSecurityFinding).toBe(false);
    expect(result.hasNoChangeAttestation).toBe(false);
  });

  it("fails review security attestation when NO_CHANGE_ATTESTATION is empty", async () => {
    const root = await createTempProject("review-security-attestation-empty-value");
    await writeRuntimeArtifact(
      root,
      "07-review.md",
      `# Review Artifact

## Layer 2 Findings
| ID | Severity | Category | Description | Status |
|---|---|---|---|---|
| R-1 | Suggestion | correctness | naming cleanup | open |
- NO_CHANGE_ATTESTATION:
`
    );

    const result = await checkReviewSecurityNoChangeAttestation(root);
    expect(result.ok).toBe(false);
    expect(result.errors.join("\n")).toMatch(/must include a non-empty rationale/);
  });
});
