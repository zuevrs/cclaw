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
  complexityTier: "standard",
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
      "Compact design lock — for simple greenfield/product slices, produce a tight but complete design spine: codebase investigation, architecture boundary, one labeled diagram, data flow, failure/rescue table, test/perf expectations, and handoff. Do not run a sprawling workshop when a strong engineering lock fits on one page.",
      "Trivial-Change Escape Hatch — for <=3 files, no new interfaces, and no cross-module data flow, produce a mini-design (rationale, changed files, one risk) and proceed to spec.",
      "Tiered Research — for simple/medium work, do compact inline codebase/research synthesis in `Research Fleet Synthesis`; write `.cclaw/artifacts/02a-research.md` and run the full fleet only for deep/high-risk work or when external framework/architecture uncertainty exists.",
      "Design Doc Check — read upstream artifacts and current design docs; latest superseding doc wins.",
      "Investigator pass — before design decisions, read blast-radius code and record touched files, responsibilities, reuse candidates, and existing patterns.",
      "Scope Challenge + Search Before Building — find existing solutions, minimum change set, and complexity smells before custom architecture.",
      "Architecture Review — lock boundaries, one realistic failure scenario per new codepath, and high-risk choices with chosen path, one shadow alternative, switch trigger, and verification evidence; include tier-required diagrams.",
      "Review core risk areas — security/threat model, code quality, tests, performance, observability/debuggability, deployment/rollout, and parallelization when modules are independent.",
      `Critic pass — run/reconcile adversarial second opinion on architecture, coupling, failure modes, and cheaper alternatives. ${reviewLoopPolicySummary("design")} ${reviewLoopSecondOpinionSummary("design")}`,
      "Run optional stale-diagram audit only when configured.",
      "Capture leftovers — seed high-upside deferred ideas, list unresolved decisions with defaults, document distribution for new artifact types, and cross-reference deferred items to scope or unresolved decisions."
    ],
    interactionProtocol: [
      "Review section-by-section: investigator first, critic second, then reconcile. For simple apps, collapse this into one compact design lock with explicit risks and a single approval stop.",
      "Present each issue one at a time; do not batch issues or move sections until current issues are resolved.",
      decisionProtocolInstruction(
        "each issue",
        "describe concretely with file/line references, present labeled options (A/B/C) with trade-offs, effort estimate (S/M/L/XL), risk level (Low/Med/High), and mark one as (recommended)",
        "recommend the option that closes the issue with the smallest blast radius and clearest verification path"
      ),
      "If a section has no issues, say 'No issues found' and move on.",
      "Do not skip failure-mode mapping; use Method/Exception/Rescue/UserSees and treat silent user impact without rescue as critical.",
      "Take a firm position, push back on weak framing, and call out suboptimal architecture with concrete alternatives.",
      "Classify ambiguity before acting. Only non-critical preference/default assumptions may continue; STOP on uncertainty about scope, architecture, security, data loss, public API, migration, auth/pricing, or required user approval. Design hypotheses must name validation path, rollback trigger, and owner before they can be carried forward.",
      "Before final approval, run the critic pass, reconcile material findings, and bound retries with the review-loop policy.",
      "For baseline approval, present the full design plus exact spec handoff and **STOP** until explicit approval.",
      "**STOP BEFORE ADVANCE.** Mandatory delegation `planner` must be completed or explicitly waived, then close via `node .cclaw/hooks/stage-complete.mjs design`."
    ],
    process: [
      "Read upstream artifacts and current design docs.",
      "Run compact research by default; write `.cclaw/artifacts/02a-research.md` only when deep/high-risk uncertainty requires a separate research artifact.",
      "Run investigator pass plus scope challenge/search-before-building.",
      "Walk review sections interactively and lock boundaries, data flow, state transitions, edge cases, and failure modes.",
      "Cover security, observability, deployment, tests, and performance for Standard+ changes.",
      "Run configured stale-diagram audit when enabled.",
      "Produce required outputs: NOT-in-scope, What-already-exists, tier diagrams, failure table, completion dashboard.",
      "Plant high-upside deferred ideas when useful and reconcile critic/outside-voice findings.",
      "Write design lock artifact for downstream spec/plan."
    ],
    requiredGates: [
      { id: "design_research_complete", description: "Research is complete: compact inline synthesis by default, or a separate research artifact for deep/high-risk work, and findings are mapped to design decisions." },
      { id: "design_architecture_locked", description: "Architecture boundaries are explicit and approved." },
      { id: "design_data_flow_mapped", description: "Data/state flow includes edge-case paths." },
      { id: "design_failure_modes_mapped", description: "Failure modes and mitigations are documented." },
      { id: "design_test_and_perf_defined", description: "Test strategy and performance budget are defined." }
    ],
    requiredEvidence: [
      "Research Fleet Synthesis is filled in `03-design.md`; for deep/high-risk work, `.cclaw/artifacts/02a-research.md` is also written with stack/features/architecture/pitfalls sections plus synthesis.",
      "Artifact written to `.cclaw/artifacts/03-design-<slug>.md`.",
      "Failure-mode table exists in Method/Exception/Rescue/UserSees format.",
      "Tier-required diagram markers are present: architecture (all tiers). Standard/Deep add-ons (shadow/error) and Deep add-ons (state-machine/rollback/deployment-sequence) are included only when risk warrants them.",
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
      "compact inline Research Fleet Synthesis, plus `.cclaw/artifacts/02a-research.md` only when deep/high-risk research was needed",
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
      { section: "Research Fleet Synthesis", required: true, validationRule: "Must summarize the tiered lenses actually run and map findings to concrete design decisions. Default may be compact inline synthesis; full separate research pack is Deep/high-risk only." },
      { section: "Codebase Investigation", required: false, validationRule: "Investigator pass: list blast-radius files with current responsibilities, discovered patterns, and reuse candidates." },
      { section: "Search Before Building", required: false, validationRule: "For each technical choice: Layer 1 (exact match), Layer 2 (partial match), Layer 3 (inspiration), EUREKA labels with reuse-first default." },
      { section: "Architecture Boundaries", required: true, validationRule: "Must list component boundaries with ownership." },
      { section: "Architecture Diagram", required: true, validationRule: "Must include `<!-- diagram: architecture -->` marker. Diagram must label concrete nodes, label arrows, mark direction, distinguish sync/async edges, and include at least one failure/degraded edge." },
      { section: "Data-Flow Shadow Paths", required: false, validationRule: "Standard/Deep add-on: include `<!-- diagram: data-flow-shadow-paths -->` marker plus a table for high-risk choices: chosen path, shadow alternative, switch trigger, fallback/degrade behavior, and verification evidence." },
      { section: "Error Flow Diagram", required: false, validationRule: "Standard/Deep add-on: include `<!-- diagram: error-flow -->` marker and failure-detection -> rescue -> user-visible outcome flow." },
      { section: "State Machine Diagram", required: false, validationRule: "Deep add-on: include `<!-- diagram: state-machine -->` marker and state transitions for critical flow lifecycle." },
      { section: "Rollback Flowchart", required: false, validationRule: "Deep add-on: include `<!-- diagram: rollback-flowchart -->` marker with trigger -> rollback actions -> verification." },
      { section: "Deployment Sequence Diagram", required: false, validationRule: "Deep add-on: include `<!-- diagram: deployment-sequence -->` marker with rollout order and guard checks." },
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
      { section: "Design Outside Voice Loop", required: false, validationRule: `Record iteration table with quality score per iteration, stop reason, and unresolved concerns. Enforce ${reviewLoopPolicySummary("design")}` },
      { section: "NOT in scope", required: false, validationRule: "Work considered and explicitly deferred with one-line rationale." },
      { section: "Parallelization Strategy", required: false, validationRule: "Standard/Deep add-on when multi-module: dependency table, parallel lanes, conflict flags." },
      { section: "Interface Contracts", required: false, validationRule: "Standard/Deep add-on when module boundaries or APIs change: producers, consumers, and payload/interface expectations." },
      { section: "Unresolved Decisions", required: false, validationRule: "Standard/Deep add-on if any: what info is missing, who provides it, default if unanswered." },
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
