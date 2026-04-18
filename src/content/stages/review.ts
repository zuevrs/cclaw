import type { StageSchemaInput } from "./schema-types.js";

// ---------------------------------------------------------------------------
// REVIEW — reference: superpowers code-review + gstack /review
// ---------------------------------------------------------------------------

export const REVIEW: StageSchemaInput = {
  stage: "review",
  skillFolder: "two-layer-review",
  skillName: "two-layer-review",
  skillDescription: "Two-layer review stage: spec compliance first, then code quality and production readiness. Section-by-section with severity discipline.",
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
    "TDD stage evidence is missing or stale",
    "The goal is direct release execution without layered quality checks"
  ],
  checklist: [
    "Diff Scope — Run `git diff` against base branch. If no diff, exit early with APPROVED (no changes to review). Scope the review to changed files unless blast-radius analysis requires wider inspection.",
    "Change-Size Check — ~100 lines = normal. ~300 lines = consider splitting. ~1000+ lines = strongly recommend stacked PRs. Flag large diffs to the user.",
    "Adversarial Trigger Check — compute changed-line count (`git diff --shortstat <base>..HEAD`), files-touched count, and whether trust boundaries changed (auth/secrets/external inputs/permissions). If `lines > 100` OR `files > 10` OR `trust boundary changed`, **dispatch a SECOND reviewer agent with the `adversarial-review` skill loaded** and reconcile its findings into the review army (treat the conditional dispatch as mandatory whenever the trigger holds; record the trigger that fired in the dashboard).",
    "Load upstream evidence — read TDD artifact (RED + GREEN + REFACTOR), spec, and plan. Verify evidence chain is unbroken.",
    "Layer 1: Spec Compliance — check every acceptance criterion against implementation. Verdict: pass/fail per criterion.",
    "Layer 2a: Correctness — logic errors, race conditions, boundary violations, null handling.",
    "Layer 2b: Security — input validation, auth boundaries, secrets exposure, injection vectors. **Mandatory:** also load and execute the `.cclaw/skills/security-audit/SKILL.md` utility skill (proactive pattern sweep across diff + touched modules, not just the diff itself) and merge findings into the review army. The Layer 2 security pass is not complete until the audit sweep records a finding count (0 acceptable) with file:line evidence for every Critical.",
    "Layer 2c: Performance — N+1 queries, memory leaks, missing caching, hot paths.",
    "Layer 2d: Architecture Fit — does the implementation match the locked design? Coupling, cohesion, interface contracts.",
    "Layer 2e: External Safety — SQL safety, concurrency, secrets in logs, enum completeness (grep outside diff), LLM trust boundaries.",
    "Review Army reconciliation — normalize findings into structured records, dedup by fingerprint, and mark multi-specialist confirmations.",
    "Meta-Review — Were tests actually run? Do test names match what they test? Are there real assertions?",
    "Classify findings — Critical (blocks ship), Important (should fix), Suggestion (optional improvement).",
    "Produce verdict — APPROVED, APPROVED_WITH_CONCERNS, or BLOCKED."
  ],
  interactionProtocol: [
    "Run Layer 1 (spec compliance) completely before starting Layer 2.",
    "In each review section, present findings ONE AT A TIME. Do NOT batch.",
    "Classify every finding as Critical, Important, or Suggestion.",
    "For each Critical finding: use the Decision Protocol — present resolution options (A/B/C) with trade-offs, and mark one as (recommended). Do NOT use a numeric Completeness rubric; recommend the option that fully closes the finding with no carry-over risk and the smallest blast radius. If AskQuestion/AskUserQuestion is available, send exactly ONE question per call, validate fields against runtime schema, and on schema error immediately fall back to plain-text question instead of retrying guessed payloads.",
    "Resolve all critical blockers before ship.",
    "For final verdict: use AskQuestion/AskUserQuestion only if runtime schema is confirmed; otherwise collect verdict with a plain-text single-choice prompt (APPROVED / APPROVED_WITH_CONCERNS / BLOCKED).",
    "**STOP.** Do NOT proceed to ship until the user provides an explicit verdict."
  ],
  process: [
    "Layer 1: check acceptance criteria and requirement coverage.",
    "Layer 2a: check correctness — logic, races, boundaries, null handling.",
    "Layer 2b: check security — validation, auth, secrets, injection.",
    "Layer 2c: check performance — queries, memory, caching, hot paths.",
    "Layer 2d: check architecture fit — design compliance, coupling, interfaces.",
    "Reconcile multi-agent findings into `.cclaw/artifacts/07-review-army.json` (dedup + confidence + conflict notes).",
    "Classify and prioritize all findings.",
    "Write review report artifact with explicit verdict."
  ],
  requiredGates: [
    { id: "review_layer1_spec_compliance", description: "Spec compliance check completed with per-criterion verdict." },
    { id: "review_layer2_correctness", description: "Correctness review completed." },
    { id: "review_layer2_security", description: "Security review completed." },
    { id: "review_layer2_performance", description: "Performance review completed." },
    { id: "review_layer2_architecture", description: "Architecture fit review completed." },
    { id: "review_severity_classified", description: "All findings are severity-tagged." },
    { id: "review_criticals_resolved", description: "No unresolved critical blockers remain." },
    { id: "review_army_json_valid", description: "07-review-army.json passes schema validation (validateReviewArmy)." },
    { id: "review_completeness_scored", description: "Completeness score is computed and recorded (AC coverage, task coverage, slice coverage, adversarial pass)." },
    { id: "review_security_audit_swept", description: "The security-audit utility skill was run against the diff scope and the modules it touches. Finding count (0 if clean) recorded in the review army with file:line evidence for every Critical." }
  ],
  requiredEvidence: [
    "Artifact written to `.cclaw/artifacts/07-review.md`.",
    "Artifact written to `.cclaw/artifacts/07-review-army.json`.",
    "Layer 1 verdict captured with per-criterion pass/fail.",
    "Layer 2 sections completed with findings.",
    "Severity log includes critical/important/suggestion buckets.",
    "Explicit final verdict: APPROVED, APPROVED_WITH_CONCERNS, or BLOCKED."
  ],
  inputs: ["implementation diff", "spec and plan artifacts", "test/build evidence"],
  requiredContext: ["spec criteria", "tdd artifact", "rulebook constraints"],
  outputs: ["review verdict", "severity-indexed findings", "reconciled review-army findings", "ship readiness decision"],
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
  commonRationalizations: [
    "Single generic review without layered structure",
    "No severity classification",
    "Shipping with open criticals",
    "Batching multiple findings into one report without individual resolution",
    "Skipping Layer 2 sections because Layer 1 passed",
    "No separate Layer 1/Layer 2 outcomes",
    "No structured review-army reconciliation artifact",
    "No critical bucket",
    "No explicit ready/not-ready verdict",
    "Review sections skipped or abbreviated",
    "Findings not classified by severity"
  ],
  policyNeedles: ["Layer 1", "Layer 2", "Critical", "Review Army", "Ready to Ship", "One issue at a time"],
  artifactFile: "07-review.md",
  next: "ship",
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
      title: "Layer 2a: Correctness",
      evaluationPoints: [
        "Logic errors and boundary violations",
        "Race conditions and concurrency issues",
        "Null/undefined handling",
        "Error propagation and recovery paths"
      ],
      stopGate: true
    },
    {
      title: "Layer 2b: Security",
      evaluationPoints: [
        "Input validation completeness",
        "Authorization boundary enforcement",
        "Secrets exposure risk",
        "Injection vector assessment"
      ],
      stopGate: true
    },
    {
      title: "Layer 2c: Performance",
      evaluationPoints: [
        "N+1 query patterns",
        "Memory leak potential",
        "Missing caching opportunities",
        "Hot path complexity analysis"
      ],
      stopGate: true
    },
    {
      title: "Layer 2d: Architecture Fit",
      evaluationPoints: [
        "Does implementation match the locked design?",
        "Coupling and cohesion assessment",
        "Interface contract compliance",
        "Unintended architectural drift"
      ],
      stopGate: true
    },
    {
      title: "Layer 2e: External Safety Checklist",
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
  ],
  completionStatus: ["APPROVED", "APPROVED_WITH_CONCERNS", "BLOCKED"],
  crossStageTrace: {
    readsFrom: [".cclaw/artifacts/06-tdd.md", ".cclaw/artifacts/04-spec.md", ".cclaw/artifacts/05-plan.md"],
    writesTo: [".cclaw/artifacts/07-review.md", ".cclaw/artifacts/07-review-army.json"],
    traceabilityRule: "Review verdict must reference specific spec criteria and TDD evidence. Downstream ship stage must reference review verdict."
  },
  artifactValidation: [
    { section: "Layer 1 Verdict", required: true, validationRule: "Per-criterion pass/fail with references." },
    { section: "Layer 2 Findings", required: true, validationRule: "Each finding has severity, description, and resolution status." },
    { section: "Review Army Contract", required: true, validationRule: "Structured findings include id/severity/confidence/fingerprint/reportedBy/status with dedup reconciliation summary." },
    { section: "Review Readiness Dashboard", required: true, validationRule: "Includes a per-pass table (Layer 1 / Layer 2 / Adversarial / Schema) with a 'Completed at' column, a Delegation log snapshot block (path .cclaw/state/delegation-log.json with required/completed/waived/pending), a Staleness signal block (commit at last review pass and current commit), and a Headline with open critical blockers + ship recommendation. At minimum, the section text must contain the substrings 'Completed at', 'delegation-log.json', 'commit at last review pass', and 'Ship recommendation'." },
    { section: "Completeness Score", required: true, validationRule: "Records AC coverage, task coverage, test-slice coverage, and adversarial-review pass status as numeric or boolean values. At minimum, a line like 'AC coverage: N/M' or 'AC coverage: 100%'." },
    { section: "Severity Summary", required: true, validationRule: "Per-severity count lines for critical, important, and suggestion buckets." },
    { section: "Final Verdict", required: true, validationRule: "Exactly one of: APPROVED, APPROVED_WITH_CONCERNS, BLOCKED." }
  ]
};
