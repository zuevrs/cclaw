import type { StageSchemaInput } from "./schema-types.js";

// ---------------------------------------------------------------------------
// SCOPE — reference: gstack CEO review
// ---------------------------------------------------------------------------

export const SCOPE: StageSchemaInput = {
  stage: "scope",
  skillFolder: "scope-shaping",
  skillName: "scope-shaping",
  skillDescription: "Strategic scope stage. Challenge premise and lock explicit in-scope/out-of-scope boundaries using CEO-level thinking.",
  hardGate: "Do NOT begin architecture, design, or code. This stage produces scope decisions only. Do not silently add or remove scope — every change is an explicit user opt-in.",
  ironLaw: "EVERY SCOPE CHANGE IS AN EXPLICIT USER OPT-IN — NEVER A SILENT ENLARGEMENT OR TRIM.",
  purpose: "Decide the right scope before technical lock-in using explicit mode selection and rigorous premise challenge.",
  whenToUse: [
    "After brainstorm approval",
    "Before architecture/design lock-in",
    "When ambition vs feasibility trade-off is unclear"
  ],
  whenNotToUse: [
    "Brainstorm has not been approved yet",
    "Scope boundaries are already locked and user requested no scope changes",
    "The work is a pure implementation or debugging pass within existing scope"
  ],
  checklist: [
    "**Assess complexity** — Read the brainstorm artifact. If project is simple (single component, clear architecture, personal/prototype), run light-touch scope: mode selection, 3-5 key in/out boundaries, deferred items. Skip Dream State Mapping and Temporal Interrogation. If project is complex (multi-component, team delivery, production), run the full checklist.",
    "**Prime Directives** — Zero silent failures. For each in-scope capability, name concrete failure modes, the exact error surface, and trace all four data-flow paths (happy, nil, empty, upstream error). Include interaction edge cases (double-click, navigate-away, stale state), observability commitments, and explicit deferred-item logging.",
    "**Premise Challenge** — Is this the right problem? What if we do nothing? What are we optimizing for?",
    "**Existing Code Leverage** — Search for existing solutions before deciding to build new.",
    "**Dream State Mapping** — (complex projects only) describe the ideal state 12 months out using `CURRENT STATE -> THIS PLAN -> 12-MONTH IDEAL`, then verify this scope moves toward that target.",
    "**Implementation Alternatives** — Produce 2-3 distinct approaches. For each: Name, Summary, Effort (S/M/L/XL), Risk (Low/Med/High), 2-3 Pros, 2-3 Cons, and explicit Reuses. One option must be minimal viable, one must be ideal architecture.",
    "**Temporal Interrogation** — (complex projects only) simulate implementation timeline: HOUR 1 foundations, HOUR 2-3 core logic, HOUR 4-5 integration surprises, HOUR 6+ polish/tests. Decide what must be locked now vs safely deferred.",
    "**Mode Selection** — Present expand/selective/hold/reduce with recommendation and default heuristic: greenfield -> expand, feature enhancement -> selective, bugfix/hotfix/refactor -> hold, broad blast radius (>15 files or multi-team impact) -> reduce.",
    "**Mode-Specific Analysis** — After mode is selected, run the matching analysis: EXPAND (10x and delight opportunities), SELECTIVE (hold-scope rigor then cherry-picked expansions), HOLD (minimum-change-set hardening), REDUCE (ruthless cuts and follow-up split).",
    "**Error and Rescue Registry** — For each capability: what breaks, how detected, what fallback."
  ],
  interactionProtocol: [
    "For scope mode selection: use the Decision Protocol — present expand/selective/hold/reduce as labeled options with trade-offs and mark one as (recommended). Do NOT use a numeric Completeness rubric; recommend the option that best covers the prime-directive failure modes, four data-flow paths, observability, and deferred handling for the in-scope set with the smallest blast radius. Base your recommendation on default heuristics: greenfield -> expand, enhancement -> selective, bugfix/hotfix/refactor -> hold, broad blast radius -> reduce. If AskQuestion/AskUserQuestion is available, send exactly ONE question per call, validate fields against runtime schema, and on schema error immediately fall back to plain-text question instead of retrying guessed payloads.",
    "Walk through the scope checklist interactively. Each checklist item that surfaces a decision should be presented to the user as a question, not as a monologue. Do not dump all items at once.",
    "Challenge premise and verify the problem framing before anything else.",
    "Take a position on every scope decision. Avoid hedging phrases like 'this could work' or 'there are many ways'; state your recommendation and one concrete condition that would change it.",
    "Use pushback patterns when framing is weak: vague scope -> force a specific user/problem, platform vision -> force a narrowest viable wedge, social proof -> demand behavioral evidence.",
    "Present one structural scope issue at a time for decision. Do NOT batch. Use structured options for each scope boundary question.",
    "Record explicit in-scope and out-of-scope contract.",
    "Once the user accepts or rejects a recommendation, commit fully. Do not re-argue.",
    "Produce a clean scope summary after all issues are resolved.",
    "**STOP.** Wait for explicit user approval of scope contract before advancing to design."
  ],
  process: [
    "Run premise challenge and existing-solution leverage check.",
    "Produce 2-3 scope alternatives in a structured format (Name, Summary, Effort, Risk, Pros, Cons, Reuses) with minimum viable and ideal architecture options included.",
    "Choose scope mode with user approval.",
    "Run mode-specific analysis that matches the selected scope mode.",
    "Walk through scope review sections one at a time.",
    "Write explicit scope contract, discretion areas, and deferred items.",
    "Produce scope summary plus completion dashboard (checklist findings, number of resolved decisions, unresolved items or `None`)."
  ],
  requiredGates: [
    { id: "scope_premise_challenged", description: "Problem framing and assumptions were challenged." },
    { id: "scope_alternatives_produced", description: "At least 2 implementation alternatives were evaluated with explicit effort/risk and reuse fields." },
    { id: "scope_mode_selected", description: "One scope mode was explicitly selected." },
    { id: "scope_contract_written", description: "In-scope/out-of-scope contract is documented." },
    { id: "scope_discretion_documented", description: "Discretion areas are documented (or explicitly marked as none)." },
    { id: "scope_user_approved", description: "User approved the final scope direction." }
  ],
  requiredEvidence: [
    "Artifact written to `.cclaw/artifacts/02-scope.md`.",
    "In-scope and out-of-scope lists are explicit.",
    "Discretion areas are explicit (or marked as `None`).",
    "Selected mode and rationale are documented.",
    "Premise challenge findings documented.",
    "Deferred items list with one-line rationale for each.",
    "Completion dashboard lists checklist findings, decision count, and unresolved items (or `None`)."
  ],
  inputs: ["brainstorm artifact", "timeline constraints", "product priorities"],
  requiredContext: [
    "approved brainstorm direction",
    "existing capabilities and reusable components",
    "delivery deadlines and risk tolerance"
  ],
  researchPlaybooks: [
    "research/git-history.md"
  ],
  outputs: ["scope mode decision", "scope contract", "discretion areas list", "deferred scope list", "scope summary", "scope completion dashboard"],
  blockers: [
    "scope mode not selected",
    "in/out boundaries ambiguous",
    "discretion areas undefined",
    "critical premise disagreement unresolved"
  ],
  exitCriteria: [
    "scope contract approved by user",
    "discretion areas recorded explicitly",
    "required gates marked satisfied",
    "deferred list recorded explicitly",
    "completion dashboard produced",
    "scope summary produced"
  ],
  antiPatterns: [
    "Scope silently expanded during discussion",
    "No explicit out-of-scope section",
    "Premise accepted without challenge",
    "Sycophantic agreement without evidence-based pushback",
    "Hedged recommendations that avoid taking a position",
    "Batching multiple scope issues into one question",
    "Re-arguing for smaller scope after user rejects reduction"
  ],
  redFlags: [
    "No selected mode in artifact",
    "Mode selected without heuristic justification",
    "No discretion section (or explicit `None`) in artifact",
    "No deferred/not-in-scope section",
    "No user approval marker",
    "Premise challenge missing or superficial",
    "No implementation alternatives evaluated"
  ],
  policyNeedles: ["Scope mode", "In Scope", "Out of Scope", "Discretion Areas", "NOT in scope", "Premise Challenge"],
  artifactFile: "02-scope.md",
  next: "design",
  reviewSections: [
    {
      title: "Scope Boundary Audit",
      evaluationPoints: [
        "Are all in-scope items justified by the problem statement?",
        "Are any in-scope items actually solving a proxy problem instead of the real one?",
        "Could any in-scope item be deferred without blocking the core objective?"
      ],
      stopGate: true
    },
    {
      title: "Deferred Items Review",
      evaluationPoints: [
        "Does each deferred item have a one-line rationale?",
        "Are any deferred items actually blockers for the core scope?",
        "Will deferring these items create technical debt that is expensive to unwind?"
      ],
      stopGate: true
    },
    {
      title: "Risk and Reversibility Check",
      evaluationPoints: [
        "For each major scope decision: is it reversible?",
        "What is the blast radius if this decision is wrong?",
        "Are there hidden dependencies between in-scope and out-of-scope items?"
      ],
      stopGate: true
    },
    {
      title: "Existing-Code Reuse Check",
      evaluationPoints: [
        "Has every sub-problem been mapped to existing code?",
        "Is the plan rebuilding anything that already exists?",
        "Are there integration opportunities that reduce new code?",
        "Have you searched for built-in or library solutions before scoping custom work?"
      ],
      stopGate: true
    },
    {
      title: "Error & Rescue Scope Check",
      evaluationPoints: [
        "For every new capability: what breaks if it fails?",
        "Is failure detection in scope or deferred? If deferred, is that acceptable?",
        "Are there rescue/fallback paths for critical user journeys?",
        "Is observability (logging, metrics, alerts) explicitly in or out of scope?"
      ],
      stopGate: true
    }
  ],
  completionStatus: ["DONE", "DONE_WITH_CONCERNS", "BLOCKED"],
  crossStageTrace: {
    readsFrom: [".cclaw/artifacts/01-brainstorm.md"],
    writesTo: [".cclaw/artifacts/02-scope.md"],
    traceabilityRule: "Every scope boundary must be traceable to a brainstorm decision. Every downstream design choice must stay within the scope contract."
  },
  artifactValidation: [
    { section: "Prime Directives", required: true, validationRule: "For each scoped capability: named failure modes, explicit error surface, four data-flow paths, interaction edge cases, observability expectations, and deferred-item handling." },
    { section: "Premise Challenge", required: true, validationRule: "Must contain explicit answers to: right problem? direct path? what if nothing?" },
    { section: "Requirements", required: true, validationRule: "Table of stable requirement IDs (R1, R2, R3…) one per row with observable outcome, priority, and source. IDs are assigned once and never renumbered across scope/design/spec/plan/review; dropped requirements stay with Priority `DROPPED`." },
    { section: "Implementation Alternatives", required: true, validationRule: "2-3 options with Name, Summary, Effort, Risk, Pros, Cons, and Reuses. Must include minimal viable and ideal architecture options." },
    { section: "Scope Mode", required: true, validationRule: "Must state selected mode and rationale with default heuristic justification." },
    { section: "Mode-Specific Analysis", required: true, validationRule: "Must document the analysis matching the selected scope mode: EXPAND (10x and delight opportunities), SELECTIVE (hold-scope baseline then cherry-picked expansions), HOLD (minimum-change-set hardening), REDUCE (ruthless cuts and follow-up split)." },
    { section: "In Scope / Out of Scope", required: true, validationRule: "Two separate explicit lists. Out-of-scope must not be empty." },
    { section: "Discretion Areas", required: true, validationRule: "Explicit list of implementer decision zones, or 'None' if scope is fully locked." },
    { section: "Deferred Items", required: true, validationRule: "Each item has one-line rationale. If empty, state 'None' explicitly." },
    { section: "Error & Rescue Registry", required: true, validationRule: "Each scoped capability has: failure mode, detection method, fallback decision." },
    { section: "Completion Dashboard", required: true, validationRule: "Lists checklist findings, count of resolved decisions, and unresolved decisions (or 'None')." },
    { section: "Scope Summary", required: true, validationRule: "Clean summary: mode, strongest challenges, recommended path, accepted scope, deferred, excluded." },
    { section: "Dream State Mapping", required: false, validationRule: "If present (complex projects): CURRENT STATE, THIS PLAN, 12-MONTH IDEAL, and alignment verdict." },
    { section: "Temporal Interrogation", required: false, validationRule: "If present (complex projects): timeline simulation table with decision pressures and lock-now vs defer verdicts." }
  ]
};
