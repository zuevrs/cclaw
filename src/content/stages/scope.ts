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
      "**Compact CEO pass first** — read brainstorm, name the job-to-be-done, challenge whether this is the right product slice, and propose the highest-leverage scope in one pass. For simple apps, keep this to a tight scope contract instead of a full strategy workshop.",
      "**Premise and leverage check** — answer in the artifact: *Right problem? Direct path? What if nothing? Where can we leverage existing code? What is the reversibility cost?* Take a position; do not hedge.",
      "**Draft the 10-star vs current-slice boundary** — show what would make the product meaningfully better, then explicitly choose what ships now, what is deferred, and what is excluded without using vague `later/for now` placeholders.",
      "**Pick one of four gstack modes with the user** — SCOPE EXPANSION, SELECTIVE EXPANSION, HOLD SCOPE, or SCOPE REDUCTION. Recommend one, state why and what signal would change it, then STOP for the user's mode/scope approval before writing the final artifact.",
      "**Run mode-specific analysis** — match the analysis to the chosen mode: SCOPE EXPANSION enumerates 10x opportunities + delight features; SELECTIVE EXPANSION lists baseline + cherry-picked additions with leverage rationale; HOLD SCOPE proves rigor on the current slice; SCOPE REDUCTION names the smallest useful wedge and what is cut, with follow-up split.",
      "**Compare implementation alternatives** — include minimum viable, product-grade, and ideal architecture options with effort (S/M/L/XL), risk (Low/Med/High), pros, cons, and reuses. Recommend one and tie it to mode.",
      "**Run outside voice before final approval** — for simple/low-risk scope, record one concise adversarial self-check row; for complex/high-risk/configured scope, iterate until threshold. Record the loop summary in `## Spec Review Loop`, but do not treat it as user approval.",
      "**Ask only one decision-changing question** — if the user rejects the contract but is unsure, offer 3-4 concrete scope moves instead of open-ended interrogation.",
      "**Write the scope contract after approval** — include in-scope/out-of-scope, discretion areas, deferred items, locked decisions, error/rescue notes, completion dashboard, scope summary (with canonical mode token + next-stage handoff), and explicit approval evidence."
    ],
    interactionProtocol: [
      decisionProtocolInstruction(
        "scope mode selection",
        "present expand/selective/hold/reduce as labeled options with trade-offs and mark one as (recommended)",
        "recommend the option that best covers the prime-directive failure modes, four data-flow paths, observability, and deferred handling for the in-scope set with the smallest blast radius. Base your recommendation on default heuristics: greenfield -> expand, enhancement -> selective, bugfix/hotfix/refactor -> hold, broad blast radius -> reduce"
      ),
      "Do not walk the full checklist by default. Lead with a proposed scope contract and the one decision that matters most; label the mode as recommended, not selected, until the user answers.",
      "For simple web-app flows, default to HOLD SCOPE or SELECTIVE EXPANSION, show the exact in/out/deferred contract as a proposal, and STOP for one explicit approval before writing the final scope artifact or completing the stage.",
      "Challenge premise first, take a firm position, and name one concrete condition that would change it.",
      "Push back on weak framing: vague scope needs a specific user/problem, platform vision needs a narrow wedge, social proof needs behavioral evidence.",
      "Resolve one structural scope issue at a time; otherwise state the assumption and move on.",
      "If the user says no but cannot name the change, offer concrete moves: keep scope, add one obvious adjacent capability, reduce to wedge, or re-open stack/product direction.",
      `Before final approval, record outside-voice findings and a \`## Spec Review Loop\` table using ${reviewLoopPolicySummary("scope")}`,
      "**STOP.** Wait for explicit user approval of the scope mode and scope contract before writing final approval language or advancing.",
      "**STOP BEFORE ADVANCE.** Mandatory delegation `planner` must be completed or explicitly waived. If no isolated planner is available, use `--waive-delegation=planner --waiver-reason=\"role-switch scope self-review completed\"`. Then close with `node .cclaw/hooks/stage-complete.mjs scope --passed=scope_mode_selected,scope_contract_written,scope_user_approved --evidence-json '{\"scope_mode_selected\":\"<user-approved mode + rationale>\",\"scope_contract_written\":\"<artifact path + sections>\",\"scope_user_approved\":\"<explicit user approval quote or summary>\"}'`. `scope_user_approved` must cite the user's approval; review-loop evidence alone is not approval."
    ],
    process: [
      "Run configured pre-scope audit only when enabled.",
      "Run the gstack-style CEO scope pass scaled to risk: job-to-be-done, premise challenge, 10-star upside, smallest useful wedge, and what would change the recommendation.",
      "Compare minimum viable, product-grade, and ideal architecture scope alternatives with explicit reuse/effort/risk.",
      "Recommend a scope mode with explicit rationale, then ask for user opt-in before treating it as selected.",
      "Run outside voice / adversarial self-check before final approval and record a valid `## Spec Review Loop` table.",
      "Write explicit scope contract, discretion areas, deferred items, error/rescue registry, and D-XX locked decisions.",
      "Produce scope summary, completion dashboard, and exact next-stage handoff before asking final approval."
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
      "Outside Voice findings and dispositions are recorded (accept/reject/defer with rationale) before final approval.",
      `Spec review loop summary includes a table with columns Iteration, Quality Score, Findings, plus Stop reason, Target score, and Max iterations. This is outside-voice evidence only; it does not satisfy user approval. ${reviewLoopPolicySummary("scope")}`,
      reviewLoopSecondOpinionSummary("scope"),
      "Deferred items list with one-line rationale for each.",
      "When an upside deferred idea is parked, a seed file is created under `.cclaw/seeds/` and referenced in the artifact.",
      "Completion dashboard lists per-section status, critical/open gaps, decision count, and unresolved items (or `None`).",
      "Scope Summary includes a next-stage handoff naming the track-aware successor (`design` for standard, `spec` for medium) and the decisions/artifacts it must carry forward."
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
      { section: "Premise Challenge", required: false, validationRule: "Must list at least 3 question/answer rows in a markdown table or bullet list (gstack default trio: right problem? direct path? what if we do nothing? — extend with leverage and reversibility for richer scope). The linter enforces structure, not English wording — answers may be in any language." },
      { section: "Landscape Check", required: false, validationRule: "When mode is EXPAND/SELECTIVE, include at least one external reference insight and its impact on scope." },
      { section: "Taste Calibration", required: false, validationRule: "Must reference 2-3 strong in-repo modules/files that define the quality bar or explicitly justify omission." },
      { section: "Requirements", required: false, validationRule: "Table of stable requirement IDs (R1, R2, R3…) one per row with observable outcome, priority, and source. IDs are assigned once and never renumbered across scope/design/spec/plan/review; dropped requirements stay with Priority `DROPPED`." },
      { section: "Locked Decisions (D-XX)", required: false, validationRule: "List of stable locked decisions with IDs D-01, D-02... Each ID appears once, includes rationale, and is intended for downstream cross-stage traceability." },
      { section: "Implementation Alternatives", required: false, validationRule: "2-3 options with Name, Summary, Effort, Risk, Pros, Cons, and Reuses. Must include minimal viable and ideal architecture options." },
      { section: "Scope Mode", required: true, validationRule: "Must state selected mode and rationale with default heuristic justification." },
      { section: "Mode-Specific Analysis", required: false, validationRule: "Deep/complex scope only: document the analysis matching the selected mode. Default path may record a concise mode rationale instead." },
      { section: "In Scope / Out of Scope", required: true, validationRule: "Two separate explicit lists. Canonical form is one `## In Scope / Out of Scope` section with `### In Scope` and `### Out of Scope`; legacy split `## In Scope` and `## Out of Scope` headings are accepted. Out-of-scope must not be empty." },
      { section: "Discretion Areas", required: false, validationRule: "Explicit list of implementer decision zones, or 'None' if scope is fully locked." },
      { section: "Deferred Items", required: false, validationRule: "Each item has one-line rationale. If empty, state 'None' explicitly." },
      { section: "Error & Rescue Registry", required: false, validationRule: "Each scoped capability has: failure mode, detection method, fallback decision." },
      { section: "Outside Voice Findings", required: false, validationRule: "Must list external/adversarial findings and disposition (accept/reject/defer) with rationale." },
      { section: "Spec Review Loop", required: false, validationRule: `Must record iterations, quality score per iteration, stop reason, and unresolved concerns. Enforce ${reviewLoopPolicySummary("scope")}` },
      { section: "Completion Dashboard", required: true, validationRule: "Lists per-review-section status, count of critical/open gaps, resolved decisions, and unresolved decisions (or 'None')." },
      { section: "Scope Summary", required: true, validationRule: "Compact recap of the locked scope. Must name the selected mode using one of the canonical tokens (`SCOPE EXPANSION`, `SELECTIVE EXPANSION`, `HOLD SCOPE`, `SCOPE REDUCTION`) and record the track-aware next-stage handoff (`design` for standard, `spec` for medium); the linter checks structure, not English wording." },
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
