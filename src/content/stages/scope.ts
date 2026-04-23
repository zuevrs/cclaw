import type { StageSchemaInput } from "./schema-types.js";

// ---------------------------------------------------------------------------
// SCOPE — reference: gstack CEO review
// ---------------------------------------------------------------------------

export const SCOPE: StageSchemaInput = {
  stage: "scope",
  complexityTier: "standard",
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
    "**Pre-Scope System Audit** — before premise challenge, gather reality snapshot: recent commits (`git log -30 --oneline`), current diff (`git diff --stat`), stash state (`git stash list`), and deferred debt markers (`rg -n 'TODO|FIXME|XXX|HACK'`). Record findings in scope artifact.",
    "**Assess complexity** — Read the brainstorm artifact. If project is simple (single component, clear architecture, personal/prototype), run light-touch scope: mode selection, 3-5 key in/out boundaries, deferred items. Skip Dream State Mapping and Temporal Interrogation. If project is complex (multi-component, team delivery, production), run the full checklist.",
    "**Prime Directives** — Zero silent failures. For each in-scope capability, name concrete failure modes, the exact error surface, and trace all four data-flow paths (happy, nil, empty, upstream error). Include interaction edge cases (double-click, navigate-away, stale state), observability commitments, and explicit deferred-item logging.",
    "**Premise Challenge** — Is this the right problem? What if we do nothing? What are we optimizing for?",
    "**Landscape Check** — for EXPAND/SELECTIVE candidates, perform a brief external scan of comparable products/patterns to calibrate ambition and avoid local maxima.",
    "**Existing Code Leverage** — Search for existing solutions before deciding to build new.",
    "**Taste Calibration** — identify 2-3 high-quality files/modules in this codebase and explicitly align scope quality bar to them.",
    "**Dream State Mapping** — (complex projects only) describe the ideal state 12 months out using `CURRENT STATE -> THIS PLAN -> 12-MONTH IDEAL`, then verify this scope moves toward that target.",
    "**Implementation Alternatives** — Produce 2-3 distinct approaches. For each: Name, Summary, Effort (S/M/L/XL), Risk (Low/Med/High), 2-3 Pros, 2-3 Cons, and explicit Reuses. One option must be minimal viable, one must be ideal architecture.",
    "**Temporal Interrogation** — (complex projects only) simulate implementation timeline: HOUR 1 foundations, HOUR 2-3 core logic, HOUR 4-5 integration surprises, HOUR 6+ polish/tests. Decide what must be locked now vs safely deferred.",
    "**Mode Selection** — Present expand/selective/hold/reduce with recommendation and default heuristic: greenfield -> expand, feature enhancement -> selective, bugfix/hotfix/refactor -> hold, broad blast radius (>15 files or multi-team impact) -> reduce.",
    "**Mode-Specific Analysis** — After mode is selected, run the matching analysis: EXPAND (10x and delight opportunities), SELECTIVE (hold-scope rigor then cherry-picked expansions), HOLD (minimum-change-set hardening), REDUCE (ruthless cuts and follow-up split).",
    "**Outside Voice + Spec Review Loop** — run an adversarial second-opinion pass on the scope artifact, reconcile findings, and iterate up to 3 cycles or until quality score >= 0.8.",
    "**Error and Rescue Registry** — For each capability: what breaks, how detected, what fallback."
  ],
  interactionProtocol: [
    "For scope mode selection: use the Decision Protocol — present expand/selective/hold/reduce as labeled options with trade-offs and mark one as (recommended). Do NOT use a numeric Completeness rubric; recommend the option that best covers the prime-directive failure modes, four data-flow paths, observability, and deferred handling for the in-scope set with the smallest blast radius. Base your recommendation on default heuristics: greenfield -> expand, enhancement -> selective, bugfix/hotfix/refactor -> hold, broad blast radius -> reduce. If the harness's native structured-ask tool is available (`AskUserQuestion` / `AskQuestion` / `question` / `request_user_input`), send exactly ONE question per call, validate fields against the runtime schema, and on schema error immediately fall back to a plain-text lettered list instead of retrying guessed payloads.",
    "Walk through the scope checklist interactively. Each checklist item that surfaces a decision should be presented to the user as a question, not as a monologue. Do not dump all items at once.",
    "Challenge premise and verify the problem framing before anything else.",
    "Take a position on every scope decision. Avoid hedging phrases like 'this could work' or 'there are many ways'; state your recommendation and one concrete condition that would change it.",
    "Use pushback patterns when framing is weak: vague scope -> force a specific user/problem, platform vision -> force a narrowest viable wedge, social proof -> demand behavioral evidence.",
    "Present one structural scope issue at a time for decision. Do NOT batch. Use structured options for each scope boundary question.",
    "Record explicit in-scope and out-of-scope contract.",
    "Once the user accepts or rejects a recommendation, commit fully. Do not re-argue.",
    "Before final scope approval, run an adversarial outside-voice review and reconcile every finding explicitly (accept/reject/defer with rationale).",
    "Bound review-loop retries: max 3 iterations or early stop at quality score >= 0.8.",
    "Produce a clean scope summary after all issues are resolved.",
    "**STOP.** Wait for explicit user approval of scope contract before advancing to design.",
    "**STOP BEFORE ADVANCE.** Mandatory delegation `planner` must be marked completed or explicitly waived in `.cclaw/state/delegation-log.json`. Then close the stage via `node .cclaw/hooks/stage-complete.mjs scope` (do not hand-edit `.cclaw/state/flow-state.json`)."
  ],
  process: [
    "Run pre-scope system audit (git log/diff/stash/debt markers).",
    "Run premise challenge and existing-solution leverage check.",
    "When mode is EXPAND/SELECTIVE, run brief landscape check before final scope lock.",
    "Calibrate quality bar against 2-3 strong existing modules/files.",
    "Produce 2-3 scope alternatives in a structured format (Name, Summary, Effort, Risk, Pros, Cons, Reuses) with minimum viable and ideal architecture options included.",
    "Choose scope mode with user approval.",
    "Run mode-specific analysis that matches the selected scope mode.",
    "Walk through scope review sections one at a time.",
    "Run outside-voice spec review loop (up to 3 iterations, quality score target >= 0.8).",
    "Write explicit scope contract, discretion areas, and deferred items.",
    "Freeze non-negotiable boundaries as stable Locked Decisions (D-XX IDs).",
    "Produce scope summary plus completion dashboard (section status, critical gaps, resolved decisions, unresolved items or `None`)."
  ],
  requiredGates: [
    { id: "scope_mode_selected", description: "One scope mode was explicitly selected." },
    { id: "scope_contract_written", description: "In-scope/out-of-scope contract is documented." },
    { id: "scope_user_approved", description: "User approved the final scope direction." }
  ],
  requiredEvidence: [
    "Artifact written to `.cclaw/artifacts/02-scope.md`.",
    "Pre-Scope System Audit findings are captured (git log/diff/stash/debt markers).",
    "In-scope and out-of-scope lists are explicit.",
    "Discretion areas are explicit (or marked as `None`).",
    "Selected mode and rationale are documented.",
    "Locked Decisions section lists stable D-XX IDs for non-negotiable boundaries.",
    "Premise challenge findings documented.",
    "Outside Voice findings and dispositions are recorded (accept/reject/defer with rationale).",
    "Spec review loop summary includes iteration count and quality score trajectory.",
    "Deferred items list with one-line rationale for each.",
    "Completion dashboard lists per-section status, critical/open gaps, decision count, and unresolved items (or `None`)."
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
    "locked decisions captured with stable D-XX IDs",
    "completion dashboard produced",
    "scope summary produced"
  ],
  commonRationalizations: [
    "Skipping pre-scope audit because the task looks small",
    "Scope silently expanded during discussion",
    "No explicit out-of-scope section",
    "Premise accepted without challenge",
    "Sycophantic agreement without evidence-based pushback",
    "Hedged recommendations that avoid taking a position",
    "Batching multiple scope issues into one question",
    "Re-arguing for smaller scope after user rejects reduction",
    "Using scope-reduction placeholders (`v1`, `for now`, `we can do later`) instead of explicit user-approved boundaries",
    "No selected mode in artifact",
    "Mode selected without heuristic justification",
    "No discretion section (or explicit `None`) in artifact",
    "No deferred/not-in-scope section",
    "No user approval marker",
    "Missing Locked Decisions section or decisions without D-XX IDs",
    "Skipping outside-voice review loop and treating first draft as final"
  ],
  policyNeedles: ["Scope mode", "In Scope", "Out of Scope", "Discretion Areas", "NOT in scope", "Premise Challenge", "Locked Decisions"],
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
    },
    {
      title: "Outside Voice Reconciliation",
      evaluationPoints: [
        "Were adversarial findings categorized as accept/reject/defer with rationale?",
        "Did any rejected finding still expose a real gap in assumptions?",
        "Is quality score trajectory improving across iterations?",
        "Did the review loop stop because quality threshold was met (>=0.8) or because retry budget was exhausted?"
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
    { section: "Pre-Scope System Audit", required: false, validationRule: "Must capture git log/diff/stash/debt-marker findings before premise challenge." },
    { section: "Prime Directives", required: false, validationRule: "For each scoped capability: named failure modes, explicit error surface, four data-flow paths, interaction edge cases, observability expectations, and deferred-item handling." },
    { section: "Premise Challenge", required: false, validationRule: "Must contain explicit answers to: right problem? direct path? what if nothing?" },
    { section: "Landscape Check", required: false, validationRule: "When mode is EXPAND/SELECTIVE, include at least one external reference insight and its impact on scope." },
    { section: "Taste Calibration", required: false, validationRule: "Must reference 2-3 strong in-repo modules/files that define the quality bar or explicitly justify omission." },
    { section: "Requirements", required: false, validationRule: "Table of stable requirement IDs (R1, R2, R3…) one per row with observable outcome, priority, and source. IDs are assigned once and never renumbered across scope/design/spec/plan/review; dropped requirements stay with Priority `DROPPED`." },
    { section: "Locked Decisions (D-XX)", required: false, validationRule: "List of stable locked decisions with IDs D-01, D-02... Each ID appears once, includes rationale, and is intended for downstream cross-stage traceability." },
    { section: "Implementation Alternatives", required: false, validationRule: "2-3 options with Name, Summary, Effort, Risk, Pros, Cons, and Reuses. Must include minimal viable and ideal architecture options." },
    { section: "Scope Mode", required: true, validationRule: "Must state selected mode and rationale with default heuristic justification." },
    { section: "Mode-Specific Analysis", required: false, validationRule: "Must document the analysis matching the selected scope mode: EXPAND (10x and delight opportunities), SELECTIVE (hold-scope baseline then cherry-picked expansions), HOLD (minimum-change-set hardening), REDUCE (ruthless cuts and follow-up split)." },
    { section: "In Scope / Out of Scope", required: true, validationRule: "Two separate explicit lists. Out-of-scope must not be empty." },
    { section: "Discretion Areas", required: false, validationRule: "Explicit list of implementer decision zones, or 'None' if scope is fully locked." },
    { section: "Deferred Items", required: false, validationRule: "Each item has one-line rationale. If empty, state 'None' explicitly." },
    { section: "Error & Rescue Registry", required: false, validationRule: "Each scoped capability has: failure mode, detection method, fallback decision." },
    { section: "Outside Voice Findings", required: false, validationRule: "Must list external/adversarial findings and disposition (accept/reject/defer) with rationale." },
    { section: "Spec Review Loop", required: false, validationRule: "Must record iterations (max 3), quality score per iteration, stop reason, and unresolved concerns." },
    { section: "Completion Dashboard", required: true, validationRule: "Lists per-review-section status, count of critical/open gaps, resolved decisions, and unresolved decisions (or 'None')." },
    { section: "Scope Summary", required: true, validationRule: "Clean summary: mode, strongest challenges, recommended path, accepted scope, deferred, excluded." },
    { section: "Dream State Mapping", required: false, validationRule: "If present (complex projects): CURRENT STATE, THIS PLAN, 12-MONTH IDEAL, and alignment verdict." },
    { section: "Temporal Interrogation", required: false, validationRule: "If present (complex projects): timeline simulation table with decision pressures and lock-now vs defer verdicts." }
  ]
};
