import type { FlowStage } from "../types.js";

/**
 * Round 5 (v6.6.0) — short bad → good behavior anchor per stage.
 *
 * Each entry is rendered exactly once in the corresponding stage skill md
 * (via `behaviorAnchorBlock` in `skills.ts`) and exactly once in the stage's
 * artifact template (via `renderBehaviorAnchorTemplateLine`). Anchors are
 * deliberately attached to a real artifact section name so the cross-check
 * test in `tests/unit/behavior-anchors.test.ts` can verify the section
 * exists in the stage's schema.
 *
 * Constraints enforced by the unit test:
 * - Exactly one entry per FlowStage (8 total).
 * - `bad` and `good` must be distinct across stages and ≤ 40 words each.
 * - `section` must match a section name present in
 *   `stageSchema(stage).artifactRules.artifactValidation`.
 */
export interface BehaviorAnchor {
  stage: FlowStage;
  section: string;
  bad: string;
  good: string;
  ruleHint?: string;
}

export const BEHAVIOR_ANCHORS: ReadonlyArray<BehaviorAnchor> = [
  {
    stage: "brainstorm",
    section: "Problem Decision Record",
    bad: "Frame the problem broadly and quietly add a second outcome (\"and while we're at it, refresh the dashboard\") that no Q&A row sanctioned.",
    good: "Name one affected user, one current failure mode, and one observable outcome; record any extra outcome as a separate row in `## Not Doing`.",
    ruleHint: "Scope creep starts in framing — keep the Problem Decision Record single-target."
  },
  {
    stage: "scope",
    section: "Scope Contract",
    bad: "Invent a contract from a hunch: \"I'll let the user choose 3 templates\" with no Q&A row, no user feedback citation, no upstream decision.",
    good: "Cite the Q&A row or upstream decision (`brainstorm > Selected Direction`) that produced each in/out boundary; refuse to lock without that citation.",
    ruleHint: "Every scope contract row must trace to a recorded user signal or carried-forward decision."
  },
  {
    stage: "design",
    section: "Codebase Investigation",
    bad: "Open with \"Use a queue + worker pool\" before reading any file; the architecture choice precedes the trace and the diagram has no concrete node.",
    good: "List 1-3 blast-radius files in `Codebase Investigation` with current responsibility and reuse candidate first; only then propose architecture in `ADR`.",
    ruleHint: "Trace before lock — no architecture decision lands without a codebase citation."
  },
  {
    stage: "spec",
    section: "Acceptance Criteria",
    bad: "AC: \"System should be fast and reliable\" — no measurable predicate, no verification approach, no design-decision ref.",
    good: "AC: \"GET /feed returns ≤ 50 items in < 200 ms p95; verified via integration test `tests/feed.spec.ts` against scope `R-2`.\"",
    ruleHint: "Every AC carries an observable predicate plus the exact evidence command or path that proves it."
  },
  {
    stage: "plan",
    section: "Execution Posture",
    bad: "Posture: \"parallel-safe\" with three units that all edit the same `src/api/router.ts`; no shared interface contract, no boundary map.",
    good: "Posture: \"parallel-safe\" only when each Implementation Unit owns disjoint files and the shared types live in one cited interface contract entry.",
    ruleHint: "Parallelization needs disjoint units AND a single shared interface contract — claim otherwise and the next batch deadlocks."
  },
  {
    stage: "tdd",
    section: "Watched-RED Proof",
    bad: "Hand-edit `S-1 | 2026-04-15T10:00 | observed RED` into the markdown table; nothing lands in the JSONL sidecar, so retries silently overwrite the row.",
    good: "Run `cclaw-cli internal tdd-slice-record --slice S-1 --status red --test-file tests/feed.spec.ts --command \"npm test\" --paths src/api/feed.ts --ac AC-3`; the linter reads the sidecar.",
    ruleHint: "RED/GREEN/REFACTOR transitions are recorded by `cclaw-cli internal tdd-slice-record`; the markdown tables are an auto-derived view from v6.10.0 onward."
  },
  {
    stage: "review",
    section: "Layer 2 Findings",
    bad: "Slip in a rename of `userSvc` → `userService` and a folder reorg under \"Layer 2: cleanup\"; no acceptance criterion or finding ID demanded the change.",
    good: "Findings name observed defects with `file:line`; refactors land as a separate slice with their own RED/GREEN, not bundled into the review pass.",
    ruleHint: "Review surfaces findings; it does not refactor. Drive-by edits go back through TDD."
  },
  {
    stage: "ship",
    section: "Preflight Results",
    bad: "Preflight: \"Looks good, tests passed last night\"; no fresh command output, no commit SHA, no exit code.",
    good: "Preflight: paste the command, the exit code, and the commit SHA from this turn; if the suite was not re-run after the last edit, mark BLOCKED.",
    ruleHint: "Victory-by-confidence is not a preflight. Re-run, capture, cite SHA — or stay BLOCKED."
  }
];

const BEHAVIOR_ANCHOR_BY_STAGE: ReadonlyMap<FlowStage, BehaviorAnchor> = new Map(
  BEHAVIOR_ANCHORS.map((entry) => [entry.stage, entry])
);

export function behaviorAnchorFor(stage: FlowStage): BehaviorAnchor | null {
  return BEHAVIOR_ANCHOR_BY_STAGE.get(stage) ?? null;
}

/**
 * Render the one-line "Behavior anchor (bad → good)" pointer used at the top
 * of each artifact template (01..08). Templates carry the anchor inline so
 * agents see it before they start filling sections; the prose itself lives
 * only in `BEHAVIOR_ANCHORS` to avoid duplication.
 */
export function renderBehaviorAnchorTemplateLine(stage: FlowStage): string {
  const anchor = behaviorAnchorFor(stage);
  if (!anchor) return "";
  return `> Behavior anchor (bad -> good) — ${anchor.section}: bad: ${anchor.bad} good: ${anchor.good}`;
}

const STAGE_EXAMPLES: Record<FlowStage, string> = {
  brainstorm: `## Context

- Project state: release checks exist but CI/local behavior drifts.
- Existing anchors: \`scripts/pre-publish.sh\`, \`src/release/\`, incident notes.

## Q&A Log

| Turn | Question | User answer (1-line) | Decision impact |
| --- | --- | --- | --- |
| 1 | Block invalid releases or only warn? | Block. | Validation is a hard gate. |
| 2 | Shared module or script-only patch? | Shared module. | Reuse in CI/local. |
| 3 | (stop-signal) | "достаточно, давай драфт" | stop-and-draft |

## Problem Decision Record

- Depth: standard
- Frame type: \`technical-maintenance\`
- Affected user / role / operator: release operator
- Current state / failure mode / opportunity: inconsistent validation paths
- Desired outcome (observable): one deterministic preflight in CI and local flows
- Evidence / signal: repeated metadata drift incidents
- Why now: recurring operational cost on every release
- Do-nothing consequence: continued publish risk
- Non-goals: no release framework rewrite

## Clarifying Questions

| # | Question | Answer | Decision impact |
| --- | --- | --- | --- |
| 1 | Block invalid releases or only warn? | Block. | Validation is a hard gate. |
| 2 | Shared module or script-only patch? | Shared module. | Reuse in CI/local. |

## Approach Tier

- Tier: standard
- Why this tier: cross-cutting release path change, bounded subsystem

## Approaches

| Approach | Role | Upside | Architecture | Trade-offs | Recommendation |
| --- | --- | --- | --- | --- | --- |
| Shared validator module | baseline | high | Typed checks reused by CI/local | Medium effort | **Recommended** |
| Script hardening only | challenger | high | Keep shell checks | Fast but drift risk remains | Fallback |

## Approach Reaction

- Closest option: shared validator module
- Concerns: keep v1 delivery tight; avoid framework creep
- What changed after reaction: kept module path and added incremental rollout guardrails

## Challenger Alternative Enforcement

- Challenger alternative: script hardening only.
- Disposition: rejected for this cycle.
- Enforcement note: preserve the challenger as a bounded fallback, but do not mix both paths in v1 implementation.

## Selected Direction

- Selected approach: shared validator module
- Approval: approved
- Rationale: best balance of consistency and delivery speed
- Scope handoff: carry hard-block policy + module boundary into scope
`,

  scope: `## Scope contract

Mode selected: SELECTIVE EXPANSION

## In scope / out of scope / deferred

| Category | Items |
| --- | --- |
| In scope | durable in-app feed, SSE path, degraded-state UX |
| Out of scope | email/SMS/push channels, marketing flows |
| Deferred | WebSocket migration, rich-media payloads |

## Reference Pattern Registry

| Pattern | Disposition | Rationale |
| --- | --- | --- |
| Snapshot + stream handoff | accept | Proven consistency model |
| Queue-backed fan-out rewrite | defer | High cost for current demand |

## Requirements

| R# | Requirement | Why |
| --- | --- | --- |
| R-1 | Feed is queryable for recent window | Baseline usability |
| R-2 | Live updates are timely and recoverable | Reliability |
| R-3 | Degraded state is explicit to users | No silent failure |

## Boundary Stress-Tests

- Stream disconnect while user is active -> banner + fallback path required.
- Snapshot/stream cursor mismatch -> deterministic recovery required.
`,

  design: `## Blast Radius

| File | Change type | Reason |
| --- | --- | --- |
| \`src/services/notifications.ts\` | modify | persistence-aware publish path |
| \`src/api/routes/notifications.ts\` | modify | snapshot + stream endpoints |
| \`src/ui/feed.tsx\` | modify | degraded banner + reconnect states |
| \`tests/integration/notifications.test.ts\` | add/update | consistency + auth coverage |

## Architecture Diagram

\`\`\`mermaid
flowchart LR
  API --> Service --> Outbox --> Projector --> Feed
  Service --> Stream
\`\`\`

## Failure Modes

| Failure | Detection | Mitigation |
| --- | --- | --- |
| Stream drops | heartbeat timeout | fallback polling + reconnect |
| Cursor gap | consistency check | replay snapshot delta |
| Auth mismatch | auth guard log | terminate stream + refresh |

## Test Strategy

- Unit: merge logic, retry budget, projection idempotency.
- Integration: snapshot+stream consistency and auth boundaries.
- E2E: degraded banner and recovery UX.
`,

  spec: `## Acceptance Criteria

| AC ID | Criterion | Requirement ref | Verification approach |
| --- | --- | --- | --- |
| AC-1 | Feed returns recent window reliably | R-1 | integration test |
| AC-2 | Live updates visible within agreed latency | R-2 | perf + integration |
| AC-3 | Disconnect shows degraded state promptly | R-3 | e2e scenario |

## Notes

- Criteria are observable, measurable, and falsifiable.
- Every AC maps to at least one task and one test path in plan/tdd.
`,

  plan: `## Dependency Graph

- D1 schema + persistence
- D2 API snapshot/stream
- D3 UI degraded-state handling
- D4 tests + observability

## Tasks

| Task ID | Description | Effort | Minutes |
| --- | --- | --- | --- |
| T-1 | schema + migration | M | 90 |
| T-2 | snapshot/stream API updates | M | 90 |
| T-3 | UI degraded-state path | M | 70 |
| T-4 | consistency + auth tests | M | 85 |

## Acceptance Mapping

| AC ID | Task IDs |
| --- | --- |
| AC-1 | T-1, T-2, T-4 |
| AC-2 | T-2, T-4 |
| AC-3 | T-3, T-4 |

## WAIT_FOR_CONFIRM

Plan is ready to execute after user confirmation.
`,

  tdd: `## RED

| Slice | Failing test evidence |
| --- | --- |
| S-1 feed window | expected 30d window, got 7d |
| S-2 degraded banner | banner absent after forced disconnect |

## Acceptance & Failure Map

| Slice | Source ID | AC ID | Expected behavior | RED-link |
| --- | --- | --- | --- | --- |
| S-1 | SRC-1 | AC-1 | feed window honors 30d cap | spanId:tdd-feed-window-red |
| S-2 | SRC-2 | AC-3 | degraded banner appears on disconnect | .cclaw/artifacts/06-tdd-slices.jsonl |

## GREEN

- Targeted tests pass.
- Full suite re-run after fixes.

## REFACTOR

- Reduced reconnect state duplication.
- Revalidated behavior with regression tests.
`,

  review: `## Layer 1 — Spec Compliance

| ID | Severity | Finding | Evidence | Status |
| --- | --- | --- | --- | --- |
| R-1 | low | AC mapping remains intact | trace table + tests | closed |

## Layer 2 — Code Quality

| ID | Severity | Finding | Evidence | Status |
| --- | --- | --- | --- | --- |
| R-2 | high | auth guard gap in stream query path | curl repro + failing test | open |

## Victory Detector

Victory Detector: pass | fail

- Current verdict: fail (R-2 open)
`,

  ship: `## Release Checklist

- version/changelog prepared
- test/build/preflight passed
- review blockers resolved or explicitly accepted

## Victory Detector

Victory Detector: pass | fail

- Current verdict: pass

## Rollback Plan

- Trigger: error-rate or latency threshold breach
- Steps: revert + redeploy prior artifact
- Verification: key metrics return to baseline
`
};

type GoodBadSample = {
  label: string;
  good: string;
  bad: string;
  lesson: string;
};

const GOOD_BAD_EXAMPLES: Record<FlowStage, GoodBadSample[]> = {
  brainstorm: [{
    label: "Problem framing",
    good: "Names affected role, current failure mode, measurable target, and non-goals.",
    bad: "Need to improve this area somehow.",
    lesson: "Concrete framing prevents scope drift in downstream stages."
  }],
  scope: [{
    label: "Boundary clarity",
    good: "Clear in-scope/out-of-scope/deferred lists with concrete capabilities.",
    bad: "Add improvements where useful.",
    lesson: "Scope without hard boundaries becomes hidden commitment."
  }],
  design: [{
    label: "Failure handling",
    good: "Each failure row includes trigger, detection, and mitigation.",
    bad: "Could fail, handle later.",
    lesson: "Actionable design risk must be testable and operationally visible."
  }],
  spec: [{
    label: "AC quality",
    good: "AC includes measurable signal and explicit verification approach.",
    bad: "System should work reliably.",
    lesson: "Observable/falsifiable language is required for meaningful verification."
  }],
  plan: [{
    label: "Task granularity",
    good: "Tasks have bounded outputs, effort, and AC links.",
    bad: "Implement feature end-to-end.",
    lesson: "Execution speed depends on concrete, reviewable task slices."
  }],
  tdd: [{
    label: "RED evidence",
    good: "Includes failing output tied to one behavior slice.",
    bad: "Tests failed at first.",
    lesson: "Without concrete RED evidence, behavior intent is not auditable."
  }],
  review: [{
    label: "Finding quality",
    good: "Severity + falsifiable claim + evidence + status.",
    bad: "LGTM with a few comments.",
    lesson: "Review findings are decisions, not vibes."
  }],
  ship: [{
    label: "Rollback contract",
    good: "Named trigger, exact rollback steps, and verification condition.",
    bad: "Revert if something goes wrong.",
    lesson: "Rollback must be executable under incident pressure."
  }]
};

export function stageGoodBadExamples(stage: FlowStage): string {
  const samples = GOOD_BAD_EXAMPLES[stage];
  if (!samples || samples.length === 0) return "";
  const blocks: string[] = [
    "## Good vs Bad (at-a-glance)",
    "",
    "Contrasting samples to calibrate quality for this stage.",
    ""
  ];
  samples.forEach((sample, index) => {
    blocks.push(`### ${index + 1}. ${sample.label}`);
    blocks.push("");
    blocks.push("**Good**");
    blocks.push("");
    blocks.push("> " + sample.good);
    blocks.push("");
    blocks.push("**Bad**");
    blocks.push("");
    blocks.push("> " + sample.bad);
    blocks.push("");
    blocks.push("**Why it matters:** " + sample.lesson);
    blocks.push("");
  });
  return blocks.join("\n");
}

/**
 * Returns the full example artifact body for tests and internal quality checks.
 * Generated user projects keep only short inline shape cues.
 */
export function stageFullArtifactExampleMarkdown(stage: FlowStage): string | null {
  const examples = STAGE_EXAMPLES[stage];
  if (!examples) return null;
  return [
    `---`,
    `stage: ${stage}`,
    `name: ${stage}-stage-examples`,
    `description: "Full sample artifact for the ${stage} stage."`,
    `---`,
    "",
    `# ${stage} stage — full artifact sample`,
    "",
    `The sample uses H2 headings that mirror the artifact a cclaw session must produce, so the markdown is wrapped in a fence to avoid collapsing into the outline.`,
    "",
    "```markdown",
    examples,
    "```",
    ""
  ].join("\n");
}

/**
 * Returns short inline shape cues rendered directly inside the stage skill.
 */
export function stageExamples(stage: FlowStage): string {
  const examples = STAGE_EXAMPLES[stage];
  if (!examples) return "";
  return [
    "## Examples",
    "",
    "Shape cues to follow; do not paste these headings verbatim unless they match the work:",
    ...exampleSummaryBullets(stage),
    ""
  ].join("\n");
}

function exampleSummaryBullets(stage: FlowStage): string[] {
  const headings = STAGE_EXAMPLE_SECTION_HEADINGS[stage] ?? [];
  if (headings.length === 0) return ["- Full artifact structure."];
  return headings.map((heading) => `- ${heading}`);
}

const STAGE_EXAMPLE_SECTION_HEADINGS: Record<FlowStage, string[]> = {
  brainstorm: [
    "Problem Decision Record (free-form Frame type label + universal framing fields)",
    "Approaches with explicit trade-offs",
    "Approach Reaction and Selected Direction"
  ],
  scope: [
    "In-scope / out-of-scope / deferred lists with concrete capabilities",
    "Reference Pattern Registry with clear dispositions",
    "Requirements table with stable R# IDs"
  ],
  design: [
    "Blast-radius file list",
    "Mandatory architecture diagram (Mermaid)",
    "Failure-mode table with detection + mitigation"
  ],
  spec: [
    "Acceptance-criteria table (observable, measurable, falsifiable)",
    "Requirement-ref column tying each AC back to an R# from scope",
    "Verification-approach column"
  ],
  plan: [
    "Dependency graph",
    "Task list with effort + minutes estimate per task",
    "Acceptance mapping (every AC -> task IDs)",
    "WAIT_FOR_CONFIRM marker"
  ],
  tdd: [
    "RED evidence per vertical slice",
    "Acceptance mapping per slice",
    "GREEN evidence",
    "REFACTOR notes with behavior-preservation confirmation"
  ],
  review: [
    "Spec-compliance findings (Layer 1)",
    "Code-quality findings (Layer 2)",
    "Severity, evidence, and status per finding",
    "Victory Detector-backed go / no-go verdict"
  ],
  ship: [
    "Release checklist",
    "Victory Detector: pass | fail",
    "Rollback plan with trigger, steps, verification",
    "Runbook and sign-off"
  ]
};
