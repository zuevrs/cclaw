import type { StageSchemaInput } from "./schema-types.js";

// ---------------------------------------------------------------------------
// REVIEW — reference: superpowers code-review + gstack /review
// ---------------------------------------------------------------------------

export const REVIEW: StageSchemaInput = {
  schemaShape: "v2",
  stage: "review",
  complexityTier: "standard",
  skillFolder: "two-layer-review",
  skillName: "two-layer-review",
  skillDescription: "Two-layer review stage: spec compliance first, then code quality and production readiness. Section-by-section with severity discipline.",
  philosophy: {
    hardGate: "Do NOT ship, merge, or release until both review layers complete with an explicit verdict. No exceptions for urgency. Critical blockers MUST be resolved before handoff.",
    ironLaw: "NO SHIP VERDICT UNTIL BOTH REVIEW LAYERS COMPLETE AND EVERY CRITICAL IS RESOLVED OR EXPLICITLY ACCEPTED.",
    purpose: "Validate that implementation matches spec and meets quality/security/performance bar through structured two-layer review.",
    whenToUse: [
      "After TDD stage completes",
      "Before any ship action",
      "When release risk must be assessed explicitly"
    ],
    whenNotToUse: [
      "There is no implementation diff to review",
      "TDD stage evidence is missing or stale"
    ],
    commonRationalizations: [
      "Single generic review without layered structure",
      "No severity classification",
      "Shipping with open criticals",
      "Batching multiple findings into one report without individual resolution",
      "Skipping Layer 2 sections because Layer 1 passed"
    ]
  },
  executionModel: {
    checklist: [
      "Diff Scope — Run `git diff` against base branch. If no diff, exit early with APPROVED (no changes to review). Scope the review to changed files unless blast-radius analysis requires wider inspection.",
      "Change-Size Check — ~100 lines = normal. ~300 lines = consider splitting. ~1000+ lines = strongly recommend stacked PRs. Flag large diffs to the user.",
      "Risk-Based Second Opinion — compute changed-line count, files-touched count, and trust-boundary movement. Dispatch an adversarial reviewer only when trust boundaries changed, Critical/Important ambiguity remains, or the diff is both large and high-risk; otherwise record `not triggered`.",
      "Load upstream evidence — read TDD artifact (RED + GREEN + REFACTOR), spec, and plan. Verify evidence chain is unbroken.",
      "Run traceability matrix — execute `cclaw internal trace-matrix` (or equivalent helper) and confirm there are no orphaned criteria/tasks/tests before declaring ship readiness.",
      "Layer 1: Spec Compliance — check every acceptance criterion against implementation. Verdict: pass/fail per criterion.",
      "Layer 2: Integrated findings — one structured pass tagged by category: correctness, security, performance, architecture, external-safety.",
      "Security sweep — mandatory dedicated security-reviewer pass across diff + touched modules. A zero-finding pass must include `NO_CHANGE_ATTESTATION` with rationale.",
      "Incoming Feedback Intake — when human reviewer comments, bot findings, or CI annotations exist, keep a per-comment disposition queue and mirror outcomes into `07-review.md` + `07-review-army.json` before final verdict.",
      "Structured Review reconciliation — normalize findings into `07-review-army.json`, dedup by fingerprint, and mark multi-specialist confirmations when multiple lenses agree.",
      "Meta-Review — Were tests actually run? Do test names match what they test? Are there real assertions?",
      "Classify findings — Critical (blocks ship), Important (should fix), Suggestion (optional improvement).",
      "Produce verdict — APPROVED, APPROVED_WITH_CONCERNS, or BLOCKED.",
      "If verdict is BLOCKED, emit remediation route token `ROUTE_BACK_TO_TDD` and include `cclaw internal rewind tdd \"review_blocked_by_critical\"` with the blocking finding IDs."
    ],
    interactionProtocol: [
      "Run Layer 1 (spec compliance) completely before starting Layer 2.",
      "In each review section, present findings ONE AT A TIME. Do NOT batch.",
      "Classify every finding as Critical, Important, or Suggestion.",
      "For each Critical finding: use the Decision Protocol — present resolution options (A/B/C) with trade-offs, and mark one as (recommended). Do NOT use a numeric Completeness rubric; recommend the option that fully closes the finding with no carry-over risk and the smallest blast radius. If the harness's native structured-ask tool is available (`AskUserQuestion` on Claude, `AskQuestion` on Cursor, `question` on OpenCode with `permission.question: \"allow\"`, `request_user_input` on Codex in Plan/Collaboration mode), send exactly ONE question per call, validate fields against the runtime schema, and on schema error immediately fall back to a plain-text lettered list instead of retrying guessed payloads.",
      "Resolve all critical blockers before ship.",
      "When verdict is BLOCKED, do not end with a passive stop: explicitly route remediation to TDD via `ROUTE_BACK_TO_TDD` and point to `cclaw internal rewind tdd` with the blocking IDs.",
      "For final verdict: use the native structured-ask tool (`AskUserQuestion` / `AskQuestion` / `question` / `request_user_input`) only if runtime schema is confirmed; otherwise collect verdict with a plain-text single-choice prompt (APPROVED / APPROVED_WITH_CONCERNS / BLOCKED).",
      "**STOP.** Do NOT proceed to ship until the user provides an explicit verdict."
    ],
    process: [
      "Layer 1: check acceptance criteria and requirement coverage.",
      "Layer 2: record integrated findings tagged correctness/security/performance/architecture/external-safety.",
      "Security-reviewer: run mandatory security sweep or no-change attestation.",
      "Reconcile structured findings into `.cclaw/artifacts/07-review-army.json` (dedup + confidence + conflict notes + source tags from spec/correctness/security/performance/architecture/external-safety passes).",
      "Classify and prioritize all findings.",
      "Write review report artifact with explicit verdict.",
      "If verdict is BLOCKED, include the remediation route token `ROUTE_BACK_TO_TDD` and the rewind command payload."
    ],
    requiredGates: [
      { id: "review_layer1_spec_compliance", description: "Spec compliance check completed with per-criterion verdict." },
      { id: "review_layer2_security", description: "Security review completed." },
      { id: "review_layer_coverage_complete", description: "Layer coverage map in 07-review-army.json confirms spec/correctness/security/performance/architecture/external-safety tags were considered." },
      { id: "review_criticals_resolved", description: "No unresolved critical blockers remain." },
      { id: "review_army_json_valid", description: "07-review-army.json passes schema validation (validateReviewArmy)." },
      { id: "review_trace_matrix_clean", description: "Trace matrix has no orphaned criteria/tasks/test slices for the active run." }
    ],
    requiredEvidence: [
      "Artifact written to `.cclaw/artifacts/07-review.md`.",
      "Artifact written to `.cclaw/artifacts/07-review-army.json`.",
      "Traceability matrix run recorded (no orphaned criteria/tasks/tests for enforced tracks).",
      "Layer 1 verdict captured with per-criterion pass/fail.",
      "Layer 2 sections completed with findings.",
      "Severity log includes critical/important/suggestion buckets.",
      "Explicit final verdict: APPROVED, APPROVED_WITH_CONCERNS, or BLOCKED.",
      "If BLOCKED: include explicit remediation route (`ROUTE_BACK_TO_TDD`) with blocking finding IDs."
    ],
    inputs: ["implementation diff", "spec and plan artifacts", "test/build evidence"],
    requiredContext: ["spec criteria", "tdd artifact", "rulebook constraints"],
    blockers: [
      "layer 1 failed",
      "critical findings unresolved",
      "missing regression evidence"
    ],
    exitCriteria: [
      "both layers completed",
      "all review sections evaluated",
      "critical blockers resolved",
      "ship readiness explicitly stated"
    ],
    platformNotes: [
      "When citing file locations in findings, use repo-relative forward-slash paths with a line number (`src/foo/bar.ts:42`). Avoid IDE-generated hyperlinks that embed absolute machine-specific paths.",
      "Line-range or diff-range references must match `git diff --unified=0` output format so reviewers on any OS can reproduce the range locally without GUI tooling.",
      "Commands in remediation suggestions must be portable (`npm run lint`, `pytest -x path/to/test`) — if a platform-specific command is required, tag the note explicitly (`# PowerShell only`, `# macOS only`)."
    ]
  },
  artifactRules: {
    artifactFile: "07-review.md",
    completionStatus: ["APPROVED", "APPROVED_WITH_CONCERNS", "BLOCKED"],
    crossStageTrace: {
      readsFrom: [".cclaw/artifacts/06-tdd.md", ".cclaw/artifacts/04-spec.md", ".cclaw/artifacts/05-plan.md"],
      writesTo: [".cclaw/artifacts/07-review.md", ".cclaw/artifacts/07-review-army.json"],
      traceabilityRule: "Review verdict must reference specific spec criteria and TDD evidence. Downstream ship stage must reference review verdict."
    },
    artifactValidation: [
      { section: "Upstream Handoff", required: false, validationRule: "Summarizes spec/plan/tdd decisions, constraints, open questions, and explicit drift before review verdicts." },
      { section: "Layer 1 Verdict", required: true, validationRule: "Per-criterion pass/fail with references." },
      { section: "Layer 2 Findings", required: false, validationRule: "Each finding has severity, description, and resolution status. Security coverage must include either explicit security findings or `NO_CHANGE_ATTESTATION: <reason>` when no security-relevant changes were found." },
      { section: "Review Findings Contract", required: true, validationRule: "Structured findings in 07-review-army.json include id/severity/confidence/fingerprint/reportedBy/status and source tags from {spec, correctness, security, performance, architecture, external-safety} with dedup reconciliation summary." },
      { section: "Review Readiness Snapshot", required: false, validationRule: "Optional compact summary: completed checks, delegation-log status, staleness signal, open critical blockers, and ship recommendation." },
      { section: "Completeness Snapshot", required: false, validationRule: "Optional compact coverage summary for AC coverage, task coverage, test-slice coverage, and adversarial-review status when triggered." },
      { section: "Incoming Feedback Queue", required: false, validationRule: "When external review feedback exists, include a queue summary with per-item disposition (resolved / accepted-risk / rejected-with-evidence) and evidence refs." },
      { section: "Trace Matrix Check", required: false, validationRule: "Records criteria/tasks/tests orphan counts (all zero on enforced tracks) with command output reference." },
      { section: "Blocked Route", required: false, validationRule: "When Final Verdict is BLOCKED: includes `ROUTE_BACK_TO_TDD`, rewind target `tdd`, and blocked finding IDs." },
      { section: "Severity Summary", required: true, validationRule: "Per-severity count lines for critical, important, and suggestion buckets." },
      { section: "Final Verdict", required: true, validationRule: "Exactly one of: APPROVED, APPROVED_WITH_CONCERNS, BLOCKED." }
    ]
  },
  reviewLens: {
    outputs: ["review verdict", "severity-indexed findings", "reconciled structured findings", "ship readiness decision"],
    reviewSections: [
      {
        title: "Layer 1: Spec Compliance",
        evaluationPoints: [
          "For each acceptance criterion: does the implementation satisfy it?",
          "Are there spec requirements with no corresponding implementation?",
          "Are there implementations with no corresponding spec requirement (scope creep)?",
          "Is every edge case from the spec handled?"
        ],
        stopGate: true
      },
      {
        title: "Layer 2: Integrated Correctness / Performance / Architecture",
        evaluationPoints: [
          "Logic errors and boundary violations",
          "Race conditions and concurrency issues",
          "Null/undefined handling",
          "Error propagation and recovery paths"
        ],
        stopGate: true
      },
      {
        title: "Security Sweep",
        evaluationPoints: [
          "Input validation completeness",
          "Authorization boundary enforcement",
          "Secrets exposure risk",
          "Injection vector assessment"
        ],
        stopGate: true
      },
      {
        title: "Specialist Lens: Performance",
        evaluationPoints: [
          "N+1 query patterns",
          "Memory leak potential",
          "Missing caching opportunities",
          "Hot path complexity analysis"
        ],
        stopGate: true
      },
      {
        title: "Specialist Lens: Architecture Fit",
        evaluationPoints: [
          "Does implementation match the locked design?",
          "Coupling and cohesion assessment",
          "Interface contract compliance",
          "Unintended architectural drift"
        ],
        stopGate: true
      },
      {
        title: "Specialist Lens: External Safety Checklist",
        evaluationPoints: [
          "SQL/database: parameterized queries, no raw string interpolation, migration safety",
          "Concurrency: race conditions in shared state, lock ordering, timeout handling",
          "Secrets: no hardcoded tokens, no secrets in logs, env vars for sensitive config",
          "Enum/constant completeness: grep for sibling values OUTSIDE the diff — are all cases handled?",
          "Trust boundaries: if LLM/AI output is used, is it validated before acting on it?"
        ],
        stopGate: true
      },
      {
        title: "Specialist Lens: Data & Migration Safety",
        evaluationPoints: [
          "Schema/data migrations are reversible and include backfill/rollback strategy",
          "Idempotency expectations are explicit for retryable flows",
          "Data-loss scenarios (truncate/overwrite/drop) are guarded by checks or dry-runs",
          "Boundary contracts (API/schema/event payload) maintain backward compatibility or are versioned"
        ],
        stopGate: false
      },
      {
        title: "Specialist Lens: Developer Experience",
        evaluationPoints: [
          "New behavior includes discoverable docs/usage notes where needed",
          "Error messages are actionable for on-call and local debugging",
          "Default configuration remains safe and unsurprising",
          "Change footprint stays minimal and avoids hidden coupling"
        ],
        stopGate: false
      },
      {
        title: "Meta-Review: Verify the Verification",
        evaluationPoints: [
          "Were tests actually run (not just assumed to pass)?",
          "Do the test names match what they actually test?",
          "Is there test coverage for the specific changes in this diff?",
          "Are there assertions, or do tests just run without checking results?"
        ],
        stopGate: false
      }
    ]
  },
  next: "ship",
};
