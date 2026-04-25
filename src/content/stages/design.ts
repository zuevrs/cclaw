import type { StageSchemaInput } from "./schema-types.js";
import {
  REVIEW_LOOP_CHECKLISTS,
  reviewLoopPolicySummary,
  reviewLoopSecondOpinionSummary
} from "../review-loop.js";
import { decisionProtocolInstruction } from "../decision-protocol.js";

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
      "Tiered Research Fleet — run `research/research-fleet.md` before architecture lock. Lightweight=pitfalls lens only, Standard=architecture+pitfalls, Deep=all four lenses. Record findings in `.cclaw/artifacts/02a-research.md` and summarize resulting decisions in `## Research Fleet Synthesis`.",
      "Design Doc Check — read existing design docs, scope artifact, brainstorm artifact. If a design doc exists that covers this area, check for 'Supersedes:' and use the latest. Use upstream artifacts as source of truth.",
      "Investigator pass — before any design decision, read the actual code in the blast radius. List every file that will be touched, current responsibilities, reuse candidates, and existing patterns (error handling, naming, test style). Design must conform to discovered patterns, not impose new ones without justification.",
      "Step 0: Scope Challenge — what existing code solves sub-problems? Minimum change set? Complexity check: 8+ files or 2+ new services = complexity smell → flag for possible scope reduction.",
      "Search Before Building — For each technical choice (library, pattern, architecture), search for existing solutions. Label findings: Layer 1 (exact match), Layer 2 (partial match, needs adaptation), Layer 3 (inspiration only), EUREKA (unexpected perfect solution). Default to existing before custom.",
      "Architecture Review — lock component boundaries and one realistic failure scenario per new codepath. For each high-risk design choice, record chosen path, one shadow alternative, switch trigger, and verification evidence. **Mandatory diagrams by tier:** Lightweight=Architecture Diagram, Standard=+Data-Flow Shadow Paths + Error Flow Diagram, Deep=+State Machine Diagram + Rollback Flowchart + Deployment Sequence Diagram.",
      "Security & Threat Model Review — trust boundaries, authn/authz, input validation, secrets handling, data exposure risks, abuse cases, and mitigation ownership.",
      "Code Quality Review — code organization, DRY violations, error handling patterns, over/under-engineering assessment. Include stale-diagram audit for touched files.",
      "Test Review — diagram every new flow, data path, error path. For each: what test type covers it? Does one exist? What is the gap? Produce test plan artifact.",
      "Performance Review — N+1 queries, memory concerns, caching opportunities, slow code paths. What breaks at 10x load? At 100x?",
      "Observability & Debuggability Review — logging, metrics, traces, alerts, and on-call diagnosis path for each critical failure mode.",
      "Deployment & Rollout Review — migration sequencing, flag strategy, rollback plan, compatibility window, and post-deploy verification steps.",
      "Parallelization Strategy — If multiple independent modules, produce dependency table: which can be built in parallel? Where are conflict risks? Flag shared-state modules.",
      `Critic pass — run an adversarial second-opinion review of the chosen architecture, hidden coupling, failure modes, and cheaper alternatives. ${reviewLoopPolicySummary("design")} ${reviewLoopSecondOpinionSummary("design")}`,
      "Stale Diagram Audit (opt-in) — when `.cclaw/config.yaml::optInAudits.staleDiagramAudit` is true, compare blast-radius file mtimes against diagram-marker freshness and flag stale diagrams before design lock.",
      "Plant-seed shelf (optional) — when an unresolved/deferred design idea has upside, capture it as `.cclaw/seeds/SEED-<YYYY-MM-DD>-<slug>.md` with trigger_when and action so it can be recalled on future `/cc` starts.",
      "Unresolved Decisions — List any design decisions that could not be resolved in this session. For each: what information is missing? Who can provide it? What is the default if no answer comes?",
      "Distribution Check — If the plan creates new artifact types (packages, CLI tools, configs), document the build/publish story. How does it reach the user?",
      "Deferred Items Cross-Reference — Collect every item explicitly deferred during design review. Each must appear in the Unresolved Decisions table or in the upstream scope artifact's deferred list. No deferred item may exist only in conversation — it must be written down."
    ],
    interactionProtocol: [
      "Review architecture decisions section-by-section: investigator first, critic second, then reconcile.",
      "For EACH issue found in a review section, present it ONE AT A TIME. Do NOT batch multiple issues.",
      decisionProtocolInstruction(
        "each issue",
        "describe concretely with file/line references, present labeled options (A/B/C) with trade-offs, effort estimate (S/M/L/XL), risk level (Low/Med/High), and mark one as (recommended)",
        "recommend the option that closes the issue with the smallest blast radius and clearest verification path"
      ),
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
      "Before final approval, run the critic pass and reconcile each material finding (accept/reject/defer) with rationale.",
      `Bound review-loop retries with ${reviewLoopPolicySummary("design")}`
    ],
    process: [
      "Read upstream artifacts (brainstorm, scope).",
      "Run the research fleet playbook with tiered fleet size and write `.cclaw/artifacts/02a-research.md` before locking architecture choices.",
      "Run investigator pass: read files in blast radius, catalogue current patterns, responsibilities, and reuse candidates.",
      "Run Step 0 scope challenge: existing code leverage, minimum change set, complexity check.",
      "Walk through each review section interactively.",
      "Define architecture boundaries and ownership.",
      "Describe data flow and state transitions with edge paths + interaction edge-case matrix.",
      "Map failure modes and recovery strategy using Method/Exception/Rescue/UserSees table.",
      "Add security, observability, and deployment reviews for Standard+ changes.",
      "Run stale-diagram audit in touched files and reconcile drift.",
      "Define test coverage strategy and performance budget.",
      "Produce required outputs: NOT-in-scope section, What-already-exists section, tier-required diagrams with markers, failure mode table.",
      "Optionally plant unresolved high-upside ideas into `.cclaw/seeds/SEED-<YYYY-MM-DD>-<slug>.md` with trigger_when/action notes.",
      `Run critic pass / outside-voice review loop when risk warrants it; reconcile deltas and record material accepted/rejected/deferred findings using ${reviewLoopPolicySummary("design")}`,
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
      "Tier-required diagram markers are present: architecture (all tiers), +shadow/error (Standard+), +state-machine/rollback/deployment-sequence (Deep).",
      "When `.cclaw/config.yaml::optInAudits.staleDiagramAudit` is true, stale diagram audit finding is clear (no blast-radius file newer than diagram markers without explicit update).",
      "Security & threat model findings are documented with mitigations.",
      "Observability and deployment plans are explicit for critical flows.",
      "Outside-voice findings and dispositions are recorded (accept/reject/defer).",
      `Spec review loop summary includes iteration count and quality score trajectory per ${reviewLoopPolicySummary("design")}`,
      reviewLoopSecondOpinionSummary("design"),
      "Test strategy includes unit/integration/e2e expectations.",
      "When a high-upside idea is deferred, a seed file is created under `.cclaw/seeds/` and referenced in the artifact.",
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
    ],
    platformNotes: [
      "Architecture diagrams (ASCII, Mermaid) must use plain ASCII punctuation — avoid smart quotes and em-dashes that render differently across Windows CMD (cp1252), macOS Terminal (UTF-8), and Linux consoles.",
      "When referencing build or runtime tools in the design, name them by binary (`node`, `python`, `go`) rather than by IDE-specific run configurations (`npm: start (WebStorm)`, `launch.json:Debug`) so the design stays OS-agnostic.",
      "File system layouts drawn in the artifact use forward slashes; explicitly note when a platform-specific path style is required (e.g. Windows long-path `\\\\?\\` prefix, macOS bundle `.app/Contents/MacOS/`)."
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
      { section: "Upstream Handoff", required: false, validationRule: "Summarizes scope/research decisions, constraints, open questions, and explicit drift before design choices." },
      { section: "Research Fleet Synthesis", required: true, validationRule: "Must summarize the tiered lenses actually run (Lightweight=pitfalls, Standard=architecture+pitfalls, Deep=all four) and map findings to concrete design decisions." },
      { section: "Codebase Investigation", required: false, validationRule: "Investigator pass: list blast-radius files with current responsibilities, discovered patterns, and reuse candidates." },
      { section: "Search Before Building", required: false, validationRule: "For each technical choice: Layer 1 (exact match), Layer 2 (partial match), Layer 3 (inspiration), EUREKA labels with reuse-first default." },
      { section: "Architecture Boundaries", required: true, validationRule: "Must list component boundaries with ownership." },
      { section: "Architecture Diagram", required: true, validationRule: "Must include `<!-- diagram: architecture -->` marker. Diagram must label concrete nodes, label arrows, mark direction, distinguish sync/async edges, and include at least one failure/degraded edge." },
      { section: "Data-Flow Shadow Paths", required: false, validationRule: "Standard/Deep: include `<!-- diagram: data-flow-shadow-paths -->` marker plus a table for high-risk choices: chosen path, shadow alternative, switch trigger, fallback/degrade behavior, and verification evidence." },
      { section: "Error Flow Diagram", required: false, validationRule: "Standard/Deep: include `<!-- diagram: error-flow -->` marker and failure-detection -> rescue -> user-visible outcome flow." },
      { section: "State Machine Diagram", required: false, validationRule: "Deep: include `<!-- diagram: state-machine -->` marker and state transitions for critical flow lifecycle." },
      { section: "Rollback Flowchart", required: false, validationRule: "Deep: include `<!-- diagram: rollback-flowchart -->` marker with trigger -> rollback actions -> verification." },
      { section: "Deployment Sequence Diagram", required: false, validationRule: "Deep: include `<!-- diagram: deployment-sequence -->` marker with rollout order and guard checks." },
      { section: "Data Flow", required: false, validationRule: "Must include happy path, nil input, empty input, upstream error paths, plus Interaction Edge Case matrix rows for: double-click, nav-away-mid-request, 10K-result dataset, background-job abandonment, zombie connection. Each row must declare handled yes/no and deferred item when not handled." },
      { section: "Stale Diagram Audit", required: false, validationRule: "When `.cclaw/config.yaml::optInAudits.staleDiagramAudit` is true: blast-radius files from Codebase Investigation must not be newer than the current design diagram-marker baseline unless explicitly refreshed." },
      { section: "Failure Mode Table", required: true, validationRule: "Use Method/Exception/Rescue/UserSees columns and treat silent user impact without rescue as critical." },
      { section: "Security & Threat Model", required: true, validationRule: "Must list trust boundaries, abuse/failure scenarios, mitigations, and residual risks." },
      { section: "Test Strategy", required: false, validationRule: "Must define unit/integration/e2e expectations with coverage targets." },
      { section: "Performance Budget", required: false, validationRule: "For each critical path: metric name, target threshold, and measurement method." },
      { section: "Observability & Debuggability", required: true, validationRule: "Must define logs/metrics/traces plus alerting/debug path for critical failure modes." },
      { section: "Deployment & Rollout", required: true, validationRule: "Must define migration/flag strategy, rollback plan, and post-deploy verification steps." },
      { section: "What Already Exists", required: false, validationRule: "For each sub-problem: existing code/library found (Layer 1-3/EUREKA label), reuse decision, and adaptation needed." },
      { section: "Outside Voice Findings", required: false, validationRule: "Critic pass: list adversarial findings and disposition (accept/reject/defer) with rationale per material finding." },
      { section: "Spec Review Loop", required: false, validationRule: `Record iteration table with quality score per iteration, stop reason, and unresolved concerns. Enforce ${reviewLoopPolicySummary("design")}` },
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
      checklist: REVIEW_LOOP_CHECKLISTS.design.map((dimension) => dimension.id),
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
