import type { StageSchemaInput } from "./schema-types.js";
import {
  REVIEW_LOOP_CHECKLISTS,
  reviewLoopPolicySummary,
  reviewLoopSecondOpinionSummary
} from "../review-loop.js";
import { decisionProtocolInstruction } from "../decision-protocol.js";

// ---------------------------------------------------------------------------
// SCOPE — reference: gstack CEO review
// ---------------------------------------------------------------------------

export const SCOPE: StageSchemaInput = {
  schemaShape: "v2",
  stage: "scope",
  complexityTier: "standard",
  skillFolder: "scope-shaping",
  skillName: "scope-shaping",
  skillDescription: "Strategic scope stage. Challenge premise and lock explicit in-scope/out-of-scope boundaries using CEO-level thinking.",
  philosophy: {
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
    ]
  },
  executionModel: {
    checklist: [
      "**Default path first** — read brainstorm, challenge premise, recommend one mode, draft 3-5 key in/out boundaries plus deferred items, then seek approval.",
      "**Optional audits by trigger** — run the pre-scope system audit only when configured; use deep-mode prime directives, dream-state mapping, and temporal interrogation only for complex/high-risk scope.",
      "**Premise and leverage check** — test whether this is the right problem, what happens if nothing changes, and what existing code can be reused.",
      "**Calibrate ambition** — for EXPAND/SELECTIVE candidates, do a brief landscape scan and align the quality bar to 2-3 strong in-repo modules.",
      "**Compare implementation alternatives** — give 2-3 distinct options with effort, risk, pros/cons, and explicit reuse; include minimal viable and ideal architecture options.",
      "**Select scope mode explicitly** — present expand/selective/hold/reduce with a recommendation and default heuristic justification.",
      "**Run mode-specific analysis** — expand, selective, hold, or reduce according to the selected mode; do not silently add or trim scope.",
      "**Handle deferred upside** — optionally park high-upside deferred/out-of-scope ideas in `.cclaw/seeds/`.",
      `**Outside voice when warranted** — run/reconcile the loop for complex/high-risk or configured scope; otherwise do a concise adversarial self-check. ${reviewLoopPolicySummary("scope")} ${reviewLoopSecondOpinionSummary("scope")}`,
      "**Write the scope contract** — include in-scope/out-of-scope, discretion areas, deferred items, locked decisions, error/rescue notes, completion dashboard, and explicit approval."
    ],
    interactionProtocol: [
      decisionProtocolInstruction(
        "scope mode selection",
        "present expand/selective/hold/reduce as labeled options with trade-offs and mark one as (recommended)",
        "recommend the option that best covers the prime-directive failure modes, four data-flow paths, observability, and deferred handling for the in-scope set with the smallest blast radius. Base your recommendation on default heuristics: greenfield -> expand, enhancement -> selective, bugfix/hotfix/refactor -> hold, broad blast radius -> reduce"
      ),
      "Do not walk the full checklist by default. Lead with the default scope contract; ask only when the answer changes in/out/deferred boundaries.",
      "Challenge premise first, take a firm position, and name one concrete condition that would change it.",
      "Push back on weak framing: vague scope needs a specific user/problem, platform vision needs a narrow wedge, social proof needs behavioral evidence.",
      "Resolve one structural scope issue at a time; otherwise state the assumption and move on.",
      "After acceptance/rejection, commit fully and do not re-argue.",
      `Before final approval, reconcile outside-voice findings when the loop runs and bound retries with ${reviewLoopPolicySummary("scope")}`,
      "**STOP.** Wait for explicit approval of the scope contract before advancing.",
      "**STOP BEFORE ADVANCE.** Mandatory delegation `planner` must be completed or explicitly waived, then close via `node .cclaw/hooks/stage-complete.mjs scope`."
    ],
    process: [
      "Run configured pre-scope audit only when enabled.",
      "Challenge premise, check existing-code leverage, and calibrate ambition/quality bar.",
      "Compare structured scope alternatives with minimum viable and ideal architecture options.",
      "Select scope mode with explicit user approval.",
      "Run the selected mode analysis and park high-upside deferred ideas when useful.",
      `Use outside-voice review only when complex/high-risk or configured; otherwise run a short adversarial self-check. If loop runs, enforce ${reviewLoopPolicySummary("scope")}`,
      "Write explicit scope contract, discretion areas, deferred items, and D-XX locked decisions.",
      "Produce scope summary and completion dashboard."
    ],
    requiredGates: [
      { id: "scope_mode_selected", description: "One scope mode was explicitly selected." },
      { id: "scope_contract_written", description: "In-scope/out-of-scope contract is documented." },
      { id: "scope_user_approved", description: "User approved the final scope direction." }
    ],
    requiredEvidence: [
      "Artifact written to `.cclaw/artifacts/02-scope-<slug>.md`.",
      "When `.cclaw/config.yaml::optInAudits.scopePreAudit` is true, Pre-Scope System Audit findings are captured (git log/diff/stash/debt markers).",
      "In-scope and out-of-scope lists are explicit.",
      "Discretion areas are explicit (or marked as `None`).",
      "Selected mode and rationale are documented.",
      "Locked Decisions section lists stable D-XX IDs for non-negotiable boundaries.",
      "Premise challenge findings documented.",
      "Outside Voice findings and dispositions are recorded (accept/reject/defer with rationale).",
      `Spec review loop summary includes iteration count and quality score trajectory per ${reviewLoopPolicySummary("scope")}`,
      reviewLoopSecondOpinionSummary("scope"),
      "Deferred items list with one-line rationale for each.",
      "When an upside deferred idea is parked, a seed file is created under `.cclaw/seeds/` and referenced in the artifact.",
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
    platformNotes: [
      "Scope contract paths must be repo-relative with forward slashes so they resolve identically on Windows, macOS, and Linux (`src/pkg/mod.ts`, NOT `src\\pkg\\mod.ts`).",
      "When invoking `git log`/`git diff` for the Pre-Scope audit, wrap glob patterns in single quotes on POSIX shells and double quotes on PowerShell (`git log -- 'src/**/*.ts'` vs `git log -- \"src/**/*.ts\"`). Document the command with the quoting style you actually ran.",
      "Do not hard-code machine-specific absolute paths (home dirs, drive letters) into the scope contract — keep boundaries repo-relative."
    ]
  },
  artifactRules: {
    artifactFile: "02-scope-<slug>.md",
    completionStatus: ["DONE", "DONE_WITH_CONCERNS", "BLOCKED"],
    crossStageTrace: {
      readsFrom: [".cclaw/artifacts/01-brainstorm-<slug>.md"],
      writesTo: [".cclaw/artifacts/02-scope-<slug>.md"],
      traceabilityRule: "Every scope boundary must be traceable to a brainstorm decision. Every downstream design choice must stay within the scope contract."
    },
    artifactValidation: [
      { section: "Upstream Handoff", required: false, validationRule: "Summarizes brainstorm/idea decisions, constraints, open questions, and explicit drift before scope decisions." },
      { section: "Pre-Scope System Audit", required: false, validationRule: "When `.cclaw/config.yaml::optInAudits.scopePreAudit` is true: must capture git log -30, git diff --stat, git stash list, and debt-marker scan (TODO/FIXME/XXX/HACK) before premise challenge." },
      { section: "Prime Directives", required: false, validationRule: "For each scoped capability: named failure modes, explicit error surface, four data-flow paths, interaction edge cases, observability expectations, and deferred-item handling." },
      { section: "Premise Challenge", required: false, validationRule: "Must contain explicit answers to: right problem? direct path? what if nothing?" },
      { section: "Landscape Check", required: false, validationRule: "When mode is EXPAND/SELECTIVE, include at least one external reference insight and its impact on scope." },
      { section: "Taste Calibration", required: false, validationRule: "Must reference 2-3 strong in-repo modules/files that define the quality bar or explicitly justify omission." },
      { section: "Requirements", required: false, validationRule: "Table of stable requirement IDs (R1, R2, R3…) one per row with observable outcome, priority, and source. IDs are assigned once and never renumbered across scope/design/spec/plan/review; dropped requirements stay with Priority `DROPPED`." },
      { section: "Locked Decisions (D-XX)", required: false, validationRule: "List of stable locked decisions with IDs D-01, D-02... Each ID appears once, includes rationale, and is intended for downstream cross-stage traceability." },
      { section: "Implementation Alternatives", required: false, validationRule: "2-3 options with Name, Summary, Effort, Risk, Pros, Cons, and Reuses. Must include minimal viable and ideal architecture options." },
      { section: "Scope Mode", required: true, validationRule: "Must state selected mode and rationale with default heuristic justification." },
      { section: "Mode-Specific Analysis", required: false, validationRule: "Deep/complex scope only: document the analysis matching the selected mode. Default path may record a concise mode rationale instead." },
      { section: "In Scope / Out of Scope", required: true, validationRule: "Two separate explicit lists. Out-of-scope must not be empty." },
      { section: "Discretion Areas", required: false, validationRule: "Explicit list of implementer decision zones, or 'None' if scope is fully locked." },
      { section: "Deferred Items", required: false, validationRule: "Each item has one-line rationale. If empty, state 'None' explicitly." },
      { section: "Error & Rescue Registry", required: false, validationRule: "Each scoped capability has: failure mode, detection method, fallback decision." },
      { section: "Outside Voice Findings", required: false, validationRule: "Must list external/adversarial findings and disposition (accept/reject/defer) with rationale." },
      { section: "Spec Review Loop", required: false, validationRule: `Must record iterations, quality score per iteration, stop reason, and unresolved concerns. Enforce ${reviewLoopPolicySummary("scope")}` },
      { section: "Completion Dashboard", required: true, validationRule: "Lists per-review-section status, count of critical/open gaps, resolved decisions, and unresolved decisions (or 'None')." },
      { section: "Scope Summary", required: true, validationRule: "Clean summary: mode, strongest challenges, recommended path, accepted scope, deferred, excluded." },
      { section: "Dream State Mapping", required: false, validationRule: "If present (complex projects): CURRENT STATE, THIS PLAN, 12-MONTH IDEAL, and alignment verdict." },
      { section: "Temporal Interrogation", required: false, validationRule: "If present (complex projects): timeline simulation table with decision pressures and lock-now vs defer verdicts." }
    ]
  },
  reviewLens: {
    outputs: ["scope mode decision", "scope contract", "discretion areas list", "deferred scope list", "scope summary", "scope completion dashboard"],
    reviewLoop: {
      stage: "scope",
      checklist: REVIEW_LOOP_CHECKLISTS.scope.map((dimension) => dimension.id),
      maxIterations: 3,
      targetScore: 0.8
    },
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
    ]
  },
  next: "design"
};
