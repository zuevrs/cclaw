import type { StageSchemaInput } from "./schema-types.js";

// ---------------------------------------------------------------------------
// DESIGN — reference: gstack Eng review
// ---------------------------------------------------------------------------

export const DESIGN: StageSchemaInput = {
  schemaShape: "v2",
  stage: "design",
  complexityTier: "deep",
  skillFolder: "engineering-design-lock",
  skillName: "engineering-design-lock",
  skillDescription: "Engineering lock-in stage. Build a concrete technical spine before spec and planning, with section-by-section interactive review.",
  philosophy: {
    hardGate: "Do NOT write implementation code. This stage produces design decisions and architecture documents only. No code changes, no scaffolding, no test files.",
    ironLaw: "NO DESIGN DECISION WITHOUT A LABELED DIAGRAM, A REJECTED ALTERNATIVE, AND A NAMED FAILURE MODE.",
    purpose: "Lock architecture, data flow, failure modes, and test/performance expectations through rigorous interactive review.",
    whenToUse: [
      "After scope agreement approval",
      "Before writing final spec and execution plan",
      "When architecture risks need explicit treatment"
    ],
    whenNotToUse: [
      "Scope mode and boundaries are still unresolved",
      "The change is docs-only or metadata-only with no architecture impact",
      "Implementation has already started and requires review instead of design lock"
    ],
    commonRationalizations: [
      "Architecture deferred to implementation phase",
      "Missing data-flow edge cases",
      "No interaction-edge-case matrix (double-click, navigate-away, stale-state, large-result)",
      "No performance budget for critical path",
      "Failure mode table omits rescue path or user-visible impact",
      "Skipping security/observability/deployment review for non-trivial change",
      "Skipping outside-voice review loop and treating first draft as final",
      "Batching multiple design issues into one question",
      "Agreeing with user's architecture choice without evaluating alternatives",
      "No NOT-in-scope output section",
      "Design decisions made without reading the actual code first"
    ]
  },
  executionModel: {
    checklist: [
      "Trivial-Change Escape Hatch — If scope artifact shows ≤3 files, zero new interfaces, and no cross-module data flow, skip full review sections. Produce a mini-design: one paragraph of rationale, list of changed files, one risk to watch. Proceed to spec.",
      "Parallel Research Fleet — run `research/research-fleet.md` before architecture lock. Fleet size scales by complexity: Lightweight=1 lens (pitfalls), Standard=2 lenses (architecture+pitfalls), Deep=4 lenses. Record findings in `.cclaw/artifacts/02a-research.md` and summarize resulting decisions in `## Research Fleet Synthesis`.",
      "Design Doc Check — read existing design docs, scope artifact, brainstorm artifact. If a design doc exists that covers this area, check for 'Supersedes:' and use the latest. Use upstream artifacts as source of truth.",
      "Codebase Investigation — Before any design decision, read the actual code in the blast radius. List every file that will be touched, its current responsibilities, and existing patterns (error handling, naming, test style). Design must conform to discovered patterns, not impose new ones without justification.",
      "Step 0: Scope Challenge — what existing code solves sub-problems? Minimum change set? Complexity check: 8+ files or 2+ new services = complexity smell → flag for possible scope reduction.",
      "Search Before Building — For each technical choice (library, pattern, architecture), search for existing solutions. Label findings: Layer 1 (exact match), Layer 2 (partial match, needs adaptation), Layer 3 (inspiration only), EUREKA (unexpected perfect solution). Default to existing before custom.",
      "Architecture Review — lock component boundaries and one realistic failure scenario per new codepath. **Mandatory diagrams:** architecture for all tiers; Standard/Deep adds Data-Flow Shadow Paths and Error Flow.",
      "Security & Threat Model Review — trust boundaries, authn/authz, input validation, secrets handling, data exposure risks, abuse cases, and mitigation ownership.",
      "Code Quality Review — code organization, DRY violations, error handling patterns, over/under-engineering assessment. Include stale-diagram audit for touched files.",
      "Test Review — diagram every new flow, data path, error path. For each: what test type covers it? Does one exist? What is the gap? Produce test plan artifact.",
      "Performance Review — N+1 queries, memory concerns, caching opportunities, slow code paths. What breaks at 10x load? At 100x?",
      "Observability & Debuggability Review — logging, metrics, traces, alerts, and on-call diagnosis path for each critical failure mode.",
      "Deployment & Rollout Review — migration sequencing, flag strategy, rollback plan, compatibility window, and post-deploy verification steps.",
      "Parallelization Strategy — If multiple independent modules, produce dependency table: which can be built in parallel? Where are conflict risks? Flag shared-state modules.",
      "Outside Voice + Spec Review Loop — run adversarial second-opinion review, reconcile findings, and iterate up to 3 cycles or until quality score >= 0.8.",
      "Unresolved Decisions — List any design decisions that could not be resolved in this session. For each: what information is missing? Who can provide it? What is the default if no answer comes?",
      "Distribution Check — If the plan creates new artifact types (packages, CLI tools, configs), document the build/publish story. How does it reach the user?",
      "Deferred Items Cross-Reference — Collect every item explicitly deferred during design review. Each must appear in the Unresolved Decisions table or in the upstream scope artifact's deferred list. No deferred item may exist only in conversation — it must be written down."
    ],
    interactionProtocol: [
      "Review architecture decisions section-by-section.",
      "For EACH issue found in a review section, present it ONE AT A TIME. Do NOT batch multiple issues.",
      "For each issue: use the Decision Protocol — describe concretely with file/line references, present labeled options (A/B/C) with trade-offs, effort estimate (S/M/L/XL), risk level (Low/Med/High), and mark one as (recommended). Do NOT use a numeric Completeness rubric. If the harness's native structured-ask tool is available (`AskUserQuestion` / `AskQuestion` / `question` / `request_user_input`), send exactly ONE question per call and fall back to plain-text letters on schema/tool failure.",
      "Only proceed to the next review section after ALL issues in the current section are resolved.",
      "If a section has no issues, say 'No issues found' and move on.",
      "Do not skip failure-mode mapping.",
      "Use Failure Mode Table columns in fixed order: Method, Exception, Rescue, UserSees. Silent user impact without rescue is treated as critical.",
      "For design baseline approval: present the full baseline. **STOP.** Do NOT proceed until user explicitly approves the design.",
      "**STOP BEFORE ADVANCE.** Mandatory delegation `planner` must be marked completed or explicitly waived in `.cclaw/state/delegation-log.json`. Then close the stage via `node .cclaw/hooks/stage-complete.mjs design` (do not hand-edit `.cclaw/state/flow-state.json`).",
      "Take a firm position on every recommendation. Do NOT hedge with 'it depends' or 'you could do either'. State your opinion, then justify it.",
      "Use pushback for weak framing: 'small changes' on shared interfaces can still have large blast radius.",
      "When the user's proposed architecture is suboptimal, say so directly. Offer the alternative with concrete trade-offs, do not bury criticism in praise.",
      "When encountering ambiguity, classify it before acting: (A) ask user for missing info, (B) enumerate interpretations and pick one with justification, (C) propose hypothesis with validation path. Do NOT silently resolve ambiguity.",
      "Before final approval, run outside-voice review loop and reconcile each finding (accept/reject/defer) with rationale.",
      "Bound review-loop retries: max 3 iterations or early stop at quality score >= 0.8."
    ],
    process: [
      "Read upstream artifacts (brainstorm, scope).",
      "Run the research fleet playbook with tiered fleet size and write `.cclaw/artifacts/02a-research.md` before locking architecture choices.",
      "Investigate codebase: read files in blast radius, catalogue current patterns and responsibilities.",
      "Run Step 0 scope challenge: existing code leverage, minimum change set, complexity check.",
      "Walk through each review section interactively.",
      "Define architecture boundaries and ownership.",
      "Describe data flow and state transitions with edge paths + interaction edge-case matrix.",
      "Map failure modes and recovery strategy using Method/Exception/Rescue/UserSees table.",
      "Add security, observability, and deployment reviews for Standard+ changes.",
      "Run stale-diagram audit in touched files and reconcile drift.",
      "Define test coverage strategy and performance budget.",
      "Produce required outputs: NOT-in-scope section, What-already-exists section, architecture + shadow/error diagrams, failure mode table.",
      "Run outside-voice spec review loop (up to 3 iterations, quality score target >= 0.8).",
      "Produce completion dashboard: status per review section, critical/open gap counts, decision count, unresolved items.",
      "Write design lock artifact for downstream spec/plan."
    ],
    requiredGates: [
      { id: "design_research_complete", description: "Parallel research artifact is complete and synthesized into design decisions." },
      { id: "design_architecture_locked", description: "Architecture boundaries are explicit and approved." },
      { id: "design_data_flow_mapped", description: "Data/state flow includes edge-case paths." },
      { id: "design_failure_modes_mapped", description: "Failure modes and mitigations are documented." },
      { id: "design_test_and_perf_defined", description: "Test strategy and performance budget are defined." }
    ],
    requiredEvidence: [
      "Research artifact written to `.cclaw/artifacts/02a-research.md` with stack/features/architecture/pitfalls sections plus synthesis.",
      "Artifact written to `.cclaw/artifacts/03-design-<slug>.md`.",
      "Failure-mode table exists in Method/Exception/Rescue/UserSees format.",
      "Data-flow shadow and error-flow diagrams are present for Standard+ complexity.",
      "Security & threat model findings are documented with mitigations.",
      "Observability and deployment plans are explicit for critical flows.",
      "Outside-voice findings and dispositions are recorded (accept/reject/defer).",
      "Spec review loop summary includes iteration count and quality score trajectory.",
      "Test strategy includes unit/integration/e2e expectations.",
      "NOT-in-scope section produced.",
      "What-already-exists section produced.",
      "Completion dashboard lists review section status, critical/open gap counts, decision count, and unresolved items (or 'None')."
    ],
    inputs: ["scope agreement artifact", "system constraints", "non-functional requirements"],
    requiredContext: [
      "parallel research synthesis from `.cclaw/artifacts/02a-research.md`",
      "existing architecture and boundaries",
      "operational constraints",
      "security and reliability expectations"
    ],
    researchPlaybooks: [
      "research/research-fleet.md",
      "research/framework-docs-lookup.md",
      "research/best-practices-lookup.md"
    ],
    blockers: [
      "architecture ambiguity remains",
      "failure modes not mapped",
      "test/performance targets missing"
    ],
    exitCriteria: [
      "design baseline approved",
      "all review sections completed",
      "required gates marked satisfied",
      "completion dashboard present with all review-section statuses",
      "artifact complete for spec handoff"
    ]
  },
  artifactRules: {
    artifactFile: "03-design-<slug>.md",
    completionStatus: ["DONE", "DONE_WITH_CONCERNS", "BLOCKED"],
    crossStageTrace: {
      readsFrom: [
        ".cclaw/artifacts/01-brainstorm-<slug>.md",
        ".cclaw/artifacts/02-scope-<slug>.md",
        ".cclaw/artifacts/02a-research.md"
      ],
      writesTo: [".cclaw/artifacts/03-design-<slug>.md"],
      traceabilityRule: "Every architecture decision must trace to a scope boundary. Every downstream spec requirement must trace to a design decision."
    },
    artifactValidation: [
      { section: "Research Fleet Synthesis", required: true, validationRule: "Must summarize all four lenses (stack/features/architecture/pitfalls) and map findings to concrete design decisions." },
      { section: "Codebase Investigation", required: false, validationRule: "Must list blast-radius files with current responsibilities and discovered patterns." },
      { section: "Search Before Building", required: false, validationRule: "For each technical choice: Layer 1 (exact match), Layer 2 (partial match), Layer 3 (inspiration), EUREKA labels with reuse-first default." },
      { section: "Architecture Boundaries", required: true, validationRule: "Must list component boundaries with ownership." },
      { section: "Architecture Diagram", required: true, validationRule: "At least one diagram (ASCII, Mermaid, or image) showing component boundaries and data flow direction. Diagram must: (1) label every node with a concrete component name (no generic 'Service A/B'), (2) label every arrow with the action or message (no unlabeled arrows), (3) mark direction of data flow explicitly, (4) distinguish synchronous from asynchronous edges (e.g. solid vs dashed, or `sync:` / `async:` prefix), (5) include at least one failure/degraded edge line that contains an arrow plus a failure keyword (`timeout`, `error`, `fallback`, `degraded`, `retry`, etc.). Standard/Deep complexity must also include `Data-Flow Shadow Paths` and `Error Flow Diagram` sections." },
      { section: "Data Flow", required: false, validationRule: "Must include happy path, nil input, empty input, upstream error paths, plus interaction edge-case matrix (double-click, navigate-away, stale-state, large-result, background-job abandonment)." },
      { section: "Failure Mode Table", required: true, validationRule: "Use Method/Exception/Rescue/UserSees columns and treat silent user impact without rescue as critical." },
      { section: "Security & Threat Model", required: false, validationRule: "Must list trust boundaries, abuse/failure scenarios, mitigations, and residual risks." },
      { section: "Test Strategy", required: false, validationRule: "Must define unit/integration/e2e expectations with coverage targets." },
      { section: "Performance Budget", required: false, validationRule: "For each critical path: metric name, target threshold, and measurement method." },
      { section: "What Already Exists", required: false, validationRule: "For each sub-problem: existing code/library found (Layer 1-3/EUREKA label), reuse decision, and adaptation needed." },
      { section: "NOT in scope", required: false, validationRule: "Work considered and explicitly deferred with one-line rationale." },
      { section: "Parallelization Strategy", required: false, validationRule: "If multi-module: dependency table, parallel lanes, conflict flags." },
      { section: "Unresolved Decisions", required: false, validationRule: "If any: what info is missing, who provides it, default if unanswered." },
      { section: "Completion Dashboard", required: true, validationRule: "Lists every review section with status (clear / issues-found-resolved / issues-open), critical/open gap counts, decision count, and unresolved items (or 'None')." }
    ],
    trivialOverrideSections: ["Architecture Boundaries", "NOT in scope", "Completion Dashboard"]
  },
  reviewLens: {
    outputs: [
      "parallel research synthesis artifact",
      "architecture lock",
      "risk and failure map",
      "test and performance baseline",
      "NOT-in-scope section",
      "What-already-exists section",
      "design completion dashboard"
    ],
    reviewLoop: {
      stage: "design",
      checklist: [
        "architecture_fit",
        "failure_mode_coverage",
        "test_coverage_realism",
        "performance_budget",
        "observability_adequacy"
      ],
      maxIterations: 3,
      targetScore: 0.8
    },
    reviewSections: [
      {
        title: "Architecture Review",
        evaluationPoints: [
          "System design, boundaries, coupling, and bottlenecks",
          "For each new codepath: one realistic production failure scenario"
        ],
        stopGate: true
      },
      {
        title: "Security & Threat Model",
        evaluationPoints: [
          "Trust boundaries, authz rules, and sensitive data flows are explicit",
          "Mitigation ownership and residual risk are documented"
        ],
        stopGate: true
      },
      {
        title: "Code Quality Review",
        evaluationPoints: [
          "Code organization and module structure",
          "DRY violations — flag aggressively",
          "Error handling patterns and missing edge cases",
          "Over-engineered or under-engineered areas",
          "Existing diagrams in touched files — still accurate?"
        ],
        stopGate: true
      },
      {
        title: "Data Flow & Interaction Edge Cases",
        evaluationPoints: [
          "Happy/nil/empty/error paths are explicit",
          "Interaction edge cases and Standard+ shadow/error diagrams are present",
          "Error-flow includes rescue path and user-visible outcome"
        ],
        stopGate: true
      },
      {
        title: "Test Review",
        evaluationPoints: [
          "Diagram every new UX flow, data flow, codepath, background job, integration, error path",
          "For each: what type of test covers it? Does one exist? What is the gap?",
          "Coverage expectations: unit, integration, e2e split"
        ],
        stopGate: true
      },
      {
        title: "Performance Review",
        evaluationPoints: [
          "N+1 queries and database access patterns",
          "Memory-usage concerns",
          "Caching opportunities",
          "Slow or high-complexity code paths",
          "What breaks at 10x load? At 100x?"
        ],
        stopGate: true
      },
      {
        title: "Observability & Debuggability",
        evaluationPoints: [
          "Logs/metrics/traces exist for critical failure modes",
          "Alerting and debug path from symptom to root cause are documented"
        ],
        stopGate: true
      },
      {
        title: "Deployment & Rollout Review",
        evaluationPoints: [
          "Migration sequencing, rollout/rollback, and compatibility window are explicit",
          "Post-deploy verification and distribution/build story are documented"
        ],
        stopGate: true
      }
    ]
  },
  next: "spec"
};
