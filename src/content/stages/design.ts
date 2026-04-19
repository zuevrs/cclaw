import type { StageSchemaInput } from "./schema-types.js";

// ---------------------------------------------------------------------------
// DESIGN — reference: gstack Eng review
// ---------------------------------------------------------------------------

export const DESIGN: StageSchemaInput = {
  stage: "design",
  skillFolder: "engineering-design-lock",
  skillName: "engineering-design-lock",
  skillDescription: "Engineering lock-in stage. Build a concrete technical spine before spec and planning, with section-by-section interactive review.",
  hardGate: "Do NOT write implementation code. This stage produces design decisions and architecture documents only. No code changes, no scaffolding, no test files.",
  ironLaw: "NO DESIGN DECISION WITHOUT A LABELED DIAGRAM, A REJECTED ALTERNATIVE, AND A NAMED FAILURE MODE.",
  purpose: "Lock architecture, data flow, failure modes, and test/performance expectations through rigorous interactive review.",
  whenToUse: [
    "After scope contract approval",
    "Before writing final spec and execution plan",
    "When architecture risks need explicit treatment"
  ],
  whenNotToUse: [
    "Scope mode and boundaries are still unresolved",
    "The change is docs-only or metadata-only with no architecture impact",
    "Implementation has already started and requires review instead of design lock"
  ],
  checklist: [
    "Trivial-Change Escape Hatch — If scope artifact shows ≤3 files, zero new interfaces, and no cross-module data flow, skip full review sections. Produce a mini-design: one paragraph of rationale, list of changed files, one risk to watch. Proceed to spec.",
    "Design Doc Check — read existing design docs, scope artifact, brainstorm artifact. If a design doc exists that covers this area, check for 'Supersedes:' and use the latest. Use upstream artifacts as source of truth.",
    "Codebase Investigation — Before any design decision, read the actual code in the blast radius. List every file that will be touched, its current responsibilities, and existing patterns (error handling, naming, test style). Design must conform to discovered patterns, not impose new ones without justification.",
    "Step 0: Scope Challenge — what existing code solves sub-problems? Minimum change set? Complexity check: 8+ files or 2+ new services = complexity smell → flag for possible scope reduction.",
    "Search Before Building — For each technical choice (library, pattern, architecture), search for existing solutions. Label findings: Layer 1 (exact match), Layer 2 (partial match, needs adaptation), Layer 3 (inspiration only), EUREKA (unexpected perfect solution). Default to existing before custom.",
    "Architecture Review — system design, component boundaries, data flow, scaling, security architecture. For each new codepath: one realistic production failure scenario. **Mandatory:** produce at least one architecture diagram (ASCII, Mermaid, or tool-generated) showing component boundaries and data flow direction. Include at least one labeled failure edge, e.g. `API -->|timeout| FallbackCache -->|degraded response| User`. Apply the **Visual Communication rules** (see below) — an unlabeled or generic diagram is worse than no diagram, because it pretends to encode decisions it does not.",
    "Code Quality Review — code organization, DRY violations, error handling patterns, over/under-engineering assessment.",
    "Test Review — diagram every new flow, data path, error path. For each: what test type covers it? Does one exist? What is the gap? Produce test plan artifact.",
    "Performance Review — N+1 queries, memory concerns, caching opportunities, slow code paths. What breaks at 10x load? At 100x?",
    "Parallelization Strategy — If multiple independent modules, produce dependency table: which can be built in parallel? Where are conflict risks? Flag shared-state modules.",
    "Unresolved Decisions — List any design decisions that could not be resolved in this session. For each: what information is missing? Who can provide it? What is the default if no answer comes?",
    "Distribution Check — If the plan creates new artifact types (packages, CLI tools, configs), document the build/publish story. How does it reach the user?",
    "Deferred Items Cross-Reference — Collect every item explicitly deferred during design review. Each must appear in the Unresolved Decisions table or in the upstream scope artifact's deferred list. No deferred item may exist only in conversation — it must be written down."
  ],
  interactionProtocol: [
    "Review architecture decisions section-by-section.",
    "For EACH issue found in a review section, present it ONE AT A TIME. Do NOT batch multiple issues.",
    "For each issue: use the Decision Protocol — describe concretely with file/line references, present labeled options (A/B/C) with trade-offs, effort estimate (S/M/L/XL), risk level (Low/Med/High), and mark one as (recommended). Do NOT use a numeric Completeness rubric; recommend the option that best covers architecture, data-flow, failure-modes, test, and perf review concerns for the issue with the lowest risk. If the harness's native structured-ask tool is available (`AskUserQuestion` / `AskQuestion` / `question` / `request_user_input`), send exactly ONE question per call, validate fields against the runtime schema, and on schema error immediately fall back to a plain-text lettered list instead of retrying guessed payloads.",
    "Only proceed to the next review section after ALL issues in the current section are resolved.",
    "If a section has no issues, say 'No issues found' and move on.",
    "Do not skip failure-mode mapping.",
    "For design baseline approval: present the full baseline. **STOP.** Do NOT proceed until user explicitly approves the design.",
    "**STOP BEFORE ADVANCE.** Mandatory delegation `planner` must be marked completed or explicitly waived in `.cclaw/state/delegation-log.json`. Then close the stage via `bash .cclaw/hooks/stage-complete.sh design` (do not hand-edit `.cclaw/state/flow-state.json`).",
    "Take a firm position on every recommendation. Do NOT hedge with 'it depends' or 'you could do either'. State your opinion, then justify it.",
    "Use pushback patterns for weak framing: if the user says 'it's just a small change', respond with 'small changes to shared interfaces have outsized blast radius — let's map it'. If 'we'll refactor later', respond with 'later never comes — show me the refactor ticket or do it now'.",
    "When the user's proposed architecture is suboptimal, say so directly. Offer the alternative with concrete trade-offs, do not bury criticism in praise.",
    "When encountering ambiguity, classify it before acting: (A) ask user for missing info, (B) enumerate interpretations and pick one with justification, (C) propose hypothesis with validation path. Do NOT silently resolve ambiguity."
  ],
  process: [
    "Read upstream artifacts (brainstorm, scope).",
    "Investigate codebase: read files in blast radius, catalogue current patterns and responsibilities.",
    "Run Step 0 scope challenge: existing code leverage, minimum change set, complexity check.",
    "Walk through each review section interactively.",
    "Define architecture boundaries and ownership.",
    "Describe data flow and state transitions with edge paths.",
    "Map failure modes and recovery strategy.",
    "Define test coverage strategy and performance budget.",
    "Produce required outputs: NOT-in-scope section, What-already-exists section, diagrams, failure mode table.",
    "Produce completion dashboard: list every review section with status (clear / issues-found-resolved / issues-open), count of decisions made, and list of unresolved items.",
    "Write design lock artifact for downstream spec/plan."
  ],
  requiredGates: [
    { id: "design_codebase_investigated", description: "Blast-radius files read and current patterns catalogued." },
    { id: "design_scope_challenge_done", description: "Step 0 scope challenge completed with existing-code mapping." },
    { id: "design_architecture_locked", description: "Architecture boundaries are explicit and approved." },
    { id: "design_data_flow_mapped", description: "Data/state flow includes edge-case paths." },
    { id: "design_failure_modes_mapped", description: "Failure modes and mitigations are documented." },
    { id: "design_test_and_perf_defined", description: "Test strategy and performance budget are defined." }
  ],
  requiredEvidence: [
    "Artifact written to `.cclaw/artifacts/03-design.md`.",
    "Failure-mode table exists with mitigations.",
    "Test strategy includes unit/integration/e2e expectations.",
    "NOT-in-scope section produced.",
    "What-already-exists section produced.",
    "Completion dashboard lists every review section status, decision count, and unresolved items (or 'None')."
  ],
  inputs: ["scope contract", "system constraints", "non-functional requirements"],
  requiredContext: [
    "existing architecture and boundaries",
    "operational constraints",
    "security and reliability expectations"
  ],
  researchPlaybooks: [
    "research/framework-docs-lookup.md",
    "research/best-practices-lookup.md"
  ],
  outputs: [
    "architecture lock",
    "risk and failure map",
    "test and performance baseline",
    "NOT-in-scope section",
    "What-already-exists section",
    "design completion dashboard"
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
  ],
  commonRationalizations: [
    "Architecture deferred to implementation phase",
    "Missing data-flow edge cases",
    "No performance budget for critical path",
    "Batching multiple design issues into one question",
    "Skipping review sections because plan seems simple",
    "Agreeing with user's architecture choice without evaluating alternatives",
    "Hedging every recommendation with 'it depends' instead of taking a position",
    "No explicit architecture boundary section",
    "No failure recovery strategy",
    "No defined test/perf baseline",
    "No NOT-in-scope output section",
    "No What-already-exists output section",
    "Design decisions made without reading the actual code first"
  ],
  policyNeedles: [
    "Architecture",
    "Data Flow",
    "Failure Modes and Mitigation",
    "Performance Budget",
    "One issue at a time"
  ],
  artifactFile: "03-design.md",
  next: "spec",
  reviewSections: [
    {
      title: "Architecture Review",
      evaluationPoints: [
        "System design and component boundaries",
        "Dependency graph and coupling concerns",
        "Data flow patterns and potential bottlenecks",
        "Scaling characteristics and single points of failure",
        "Security architecture (auth, data access, API boundaries)",
        "For each new codepath: one realistic production failure scenario"
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
      title: "Distribution & Delivery Review",
      evaluationPoints: [
        "If new artifact types are created (packages, CLI, configs): is the build/publish story documented?",
        "Are there new dependencies that need version pinning?",
        "Does the change affect existing consumers (APIs, shared modules)?",
        "Is backwards compatibility maintained or is a migration needed?"
      ],
      stopGate: false
    }
  ],
  completionStatus: ["DONE", "DONE_WITH_CONCERNS", "BLOCKED"],
  crossStageTrace: {
    readsFrom: [".cclaw/artifacts/01-brainstorm.md", ".cclaw/artifacts/02-scope.md"],
    writesTo: [".cclaw/artifacts/03-design.md"],
    traceabilityRule: "Every architecture decision must trace to a scope boundary. Every downstream spec requirement must trace to a design decision."
  },
  artifactValidation: [
    { section: "Codebase Investigation", required: true, validationRule: "Must list blast-radius files with current responsibilities and discovered patterns." },
    { section: "Search Before Building", required: true, validationRule: "For each technical choice: Layer 1 (exact match), Layer 2 (partial match), Layer 3 (inspiration), EUREKA labels with reuse-first default." },
    { section: "Architecture Boundaries", required: true, validationRule: "Must list component boundaries with ownership." },
    { section: "Architecture Diagram", required: true, validationRule: "At least one diagram (ASCII, Mermaid, or image) showing component boundaries and data flow direction. Diagram must: (1) label every node with a concrete component name (no generic 'Service A/B'), (2) label every arrow with the action or message (no unlabeled arrows), (3) mark direction of data flow explicitly, (4) distinguish synchronous from asynchronous edges (e.g. solid vs dashed, or `sync:` / `async:` prefix), (5) include at least one failure/degraded edge line that contains an arrow plus a failure keyword (`timeout`, `error`, `fallback`, `degraded`, `retry`, etc.)." },
    { section: "Data Flow", required: true, validationRule: "Must include happy path, nil input, empty input, upstream error paths." },
    { section: "Failure Mode Table", required: true, validationRule: "Each failure mode has: trigger, detection, mitigation, user impact." },
    { section: "Test Strategy", required: true, validationRule: "Must define unit/integration/e2e expectations with coverage targets." },
    { section: "Performance Budget", required: true, validationRule: "For each critical path: metric name, target threshold, and measurement method." },
    { section: "What Already Exists", required: true, validationRule: "For each sub-problem: existing code/library found (Layer 1-3/EUREKA label), reuse decision, and adaptation needed." },
    { section: "NOT in scope", required: true, validationRule: "Work considered and explicitly deferred with one-line rationale." },
    { section: "Parallelization Strategy", required: false, validationRule: "If multi-module: dependency table, parallel lanes, conflict flags." },
    { section: "Unresolved Decisions", required: false, validationRule: "If any: what info is missing, who provides it, default if unanswered." },
    { section: "Interface Contracts", required: false, validationRule: "If present: for each module boundary list produces (outputs) and consumes (inputs) with data types." },
    { section: "Patterns to Mirror", required: false, validationRule: "If present: list discovered codebase patterns to follow, with file references and rationale for each." },
    { section: "Completion Dashboard", required: true, validationRule: "Lists every review section with status (clear / issues-found-resolved / issues-open), decision count, and unresolved items (or 'None')." }
  ],
  trivialOverrideSections: ["Architecture Boundaries", "NOT in scope", "Completion Dashboard"]
};
