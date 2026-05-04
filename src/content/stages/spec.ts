import type { StageSchemaInput } from "./schema-types.js";

// ---------------------------------------------------------------------------
// SPEC
// ---------------------------------------------------------------------------

export const SPEC: StageSchemaInput = {
  schemaShape: "v2",
  stage: "spec",
  complexityTier: "standard",
  skillFolder: "spec",
  skillName: "spec",
  skillDescription: "Specification stage. Produce measurable, testable requirements without ambiguity.",
  philosophy: {
    hardGate: "Do NOT plan tasks or write implementation code. This stage produces a specification document only. Every requirement must be expressed in observable, testable terms.",
    ironLaw: "EVERY ACCEPTANCE CRITERION MUST BE OBSERVABLE AND TESTABLE — OR IT DOES NOT EXIST.",
    purpose: "Create a testable specification aligned with approved design and constraints.",
    whenToUse: [
      "After design lock",
      "Before planning and implementation",
      "When acceptance criteria must be measurable"
    ],
    whenNotToUse: [
      "Design decisions are still unresolved or disputed",
      "The task is implementation-only cleanup with unchanged behavior",
      "You still need to challenge scope rather than author requirements"
    ],
    commonRationalizations: [
      "High-level goals without measurable outcomes",
      "Implicit assumptions",
      "Proceeding to plan before approval",
      "Using vague adjectives (fast, intuitive, robust) without thresholds",
      "No explicit assumptions section",
      "No approval record",
      "No testability mapping",
      "Assumptions not surfaced before sign-off",
      "Edge cases missing or deferred"
    ]
  },
  executionModel: {
    checklist: [
      "Read upstream — standard track loads design + scope; medium loads brainstorm/spec handoff; quick loads `00-idea.md` plus any reproduction context. Cross-reference only artifacts that exist on the active track.",
      "Define measurable acceptance criteria — each criterion must be observable and falsifiable. No vague adjectives.",
      "Capture edge cases — for each criterion, define at least one boundary condition and one error condition.",
      "**Constraints carry-forward (do NOT re-author).** Scope OWNS external/regulatory/system/integration constraints in `## Scope Contract > Constraints`. Cite them in `## Constraints and Assumptions > Constraints` (or mark `See scope: <ref>`). Add a constraint here only when spec-stage analysis surfaced a NEW one not present in scope. Spec OWNS testable assumptions (next bullet). Only non-critical preference/default assumptions may continue; STOP on uncertainty about scope, architecture, security, data loss, public API, migration, auth/pricing, or required user approval.",
      "**Assumptions Before Finalization (spec-only owner).** Spec OWNS testable assumptions: list each with source/confidence, validation path, and accepted/rejected/open disposition in `## Assumptions Before Finalization`. Do NOT duplicate scope's constraints here as assumptions.",
      "Build the Acceptance Mapping contract — for each AC, map upstream design decision, observable evidence, verification method, and likely test level. If any column is unclear, rewrite the criterion.",
      "Run Spec Self-Review — explicitly verify placeholder/consistency/scope/ambiguity checks before approval.",
      "Present acceptance criteria to the user in 3-5-item batches, pausing for explicit ACK between batches (see Interaction Protocol).",
      "Write spec artifact and request user approval — wait for explicit confirmation before proceeding."
    ],
    interactionProtocol: [
      "Express each requirement in observable terms.",
      "Resolve ambiguity before moving to plan. Challenge vague language.",
      "Capture assumptions explicitly, not implicitly.",
      "Before final spec approval, present the assumptions section as its own checkpoint so the user can accept, revise, or mark an assumption unknown.",
      "**Chunk acceptance criteria for review.** When presenting the spec to the user for sign-off, deliver acceptance criteria in batches of 3-5 and **pause for explicit ACK** (via Decision Protocol) before sending the next batch. Do not dump the full criteria wall in one message — small batches surface objections earlier and keep the sign-off meaningful. Full spec writeup still lands in `04-spec.md`, but the conversation itself must be digestible.",
      "Require user confirmation on the written spec. **STOP.** Do NOT proceed to plan until user approves.",
      "For each criterion, ask: what exact evidence proves this passed? If the evidence or verification command/manual step is vague, rewrite.",
      "When encountering ambiguity, classify it before acting: (A) ask user for missing info, (B) enumerate non-critical interpretations and pick one with justification, (C) propose hypothesis with validation path. Do NOT silently resolve ambiguity. STOP on scope, architecture, security, data loss, public API, migration, auth/pricing, or user-approval uncertainty.",
      "Investigation discipline: follow the shared `## Investigation Discipline` block — derive ACs from cited upstream paths/refs (`02-scope.md#R-2`, `03-design.md#DD-1`) instead of pasting their bodies into delegation prompts.",
      "Behavior anchor: see the shared `## Behavior anchor` block in this skill — the bad/good pair anchors how each `Acceptance Criteria` row must carry an observable predicate plus the evidence path."
    ],
    process: [
      "Define measurable acceptance criteria.",
      "Capture constraints, assumptions, and edge cases.",
      "Review assumptions before finalization: source/confidence, validation path, and accepted/rejected/open disposition.",
      "Annotate parallel-slice metadata on each acceptance criterion: `parallelSafe` (true|false) and `touchSurface` (repo-relative paths/modules expected to change) so downstream plan units and TDD lanes stay conflict-aware (v6.13.0).",
      "Confirm every verification method is concrete enough for plan/TDD to use later.",
      "Present acceptance criteria to the user in 3-5-item batches, pausing for explicit ACK between batches (see Interaction Protocol).",
      "Write spec artifact and request approval."
    ],
    requiredGates: [
      { id: "spec_acceptance_measurable", description: "Acceptance criteria are measurable and observable." },
      { id: "spec_testability_confirmed", description: "Each criterion has a described test method." },
      { id: "spec_assumptions_surfaced", description: "Assumptions were explicitly reviewed with source/confidence, validation path, and disposition before approval." },
      { id: "spec_self_review_complete", description: "Spec Self-Review covers placeholder, consistency, scope, and ambiguity checks before approval." },
      { id: "spec_user_approved", description: "User approved the final written spec." }
    ],
    requiredEvidence: [
      "Artifact written to `.cclaw/artifacts/04-spec.md`.",
      "Each acceptance criterion maps to upstream design decision, observable evidence, verification method, and likely test level.",
      "Edge cases documented per criterion.",
      "Assumptions Before Finalization section records source/confidence, validation path, and accepted/rejected/open disposition.",
      "Spec Self-Review section covers placeholder, consistency, scope, and ambiguity checks with any patches noted.",
      "Approval marker captured in artifact.",
      "For quick bug-fix specs, reproduction contract records symptom, repro steps, expected RED test, and acceptance criterion."
    ],
    inputs: ["design artifact", "business constraints", "quality requirements"],
    requiredContext: [
      "design lock baseline",
      "regulatory or system boundaries",
      "integration constraints"
    ],
    blockers: [
      "non-measurable criteria",
      "constraints missing",
      "assumptions not surfaced before approval",
      "open ambiguities remain"
    ],
    exitCriteria: [
      "spec approved by user",
      "required gates marked satisfied",
      "plan-ready acceptance mapping exists",
      "assumptions reviewed before finalization",
      "testability confirmed for all criteria"
    ],
    platformNotes: [
      "Acceptance criteria that reference CLI commands must name the executable portably (`node`, `npm`, `pytest`) and avoid OS-specific shell features (`&&` is safe, `||` differs subtly between cmd.exe and POSIX — prefer explicit multi-step descriptions).",
      "When a criterion specifies file-content expectations, use `LF` as the canonical newline and state any CRLF-on-Windows tolerance explicitly (most git-managed repos normalize via `.gitattributes`; the criterion should not implicitly depend on autocrlf).",
      "Timezone-sensitive criteria (timestamps, retention windows) must pin UTC or note the source of truth — clocks differ across CI runners (GitHub macOS vs Linux image vs Windows image)."
    ]
  },
  artifactRules: {
    artifactFile: "04-spec.md",
    completionStatus: ["DONE", "DONE_WITH_CONCERNS", "BLOCKED"],
    crossStageTrace: {
      readsFrom: [".cclaw/artifacts/03-design-<slug>.md", ".cclaw/artifacts/02-scope-<slug>.md"],
      writesTo: [".cclaw/artifacts/04-spec.md"],
      traceabilityRule: "Every acceptance criterion must trace to a design decision. Every downstream plan task must trace to a spec criterion."
    },
    artifactValidation: [
      { section: "Upstream Handoff", required: false, validationRule: "Summarizes scope/design decisions, constraints, open questions, and explicit drift before acceptance criteria." },
      { section: "Acceptance Criteria", required: true, validationRule: "Each criterion is observable, measurable, and falsifiable. Standard track should include Requirement Ref and Design Decision Ref columns; quick track may instead link each AC to the reproduction contract or bug slice. AC IDs (AC-1, AC-2…) are stable across revisions — dropped ACs stay with Priority `DROPPED`. v6.13.0: each AC declares `parallelSafe` (true|false) and `touchSurface` (paths/modules) for parallel slice planning." },
      { section: "Quick Reproduction Contract", required: false, validationRule: "Quick bug-fix specs own the reproduction contract: symptom, repro steps, expected RED test behavior, and acceptance criterion." },
      { section: "Edge Cases", required: true, validationRule: "At least one boundary and one error condition per criterion." },
      { section: "Constraints and Assumptions", required: false, validationRule: "Constraints are CARRIED FORWARD from scope's `## Scope Contract > Constraints` (cite with `See scope: <ref>` or copy with attribution). New spec-stage constraints (rare) get a citation to the spec-stage Q&A row that surfaced them. Assumptions are owned by `## Assumptions Before Finalization` — do NOT duplicate them here. Section may be `- See scope: 02-scope.md#constraints.` for the common case." },
      { section: "Assumptions Before Finalization", required: true, validationRule: "Each assumption has source/confidence, validation path, and accepted/rejected/open disposition before the Approval section is finalized." },
      { section: "Acceptance Mapping", required: true, validationRule: "Each criterion maps to upstream design decision, observable evidence, verification method, likely test level (unit/integration/e2e/manual), and command or manual steps when known." },
      { section: "Non-Functional Requirements", required: false, validationRule: "If present: performance thresholds, security constraints, scalability limits, reliability targets with measurable values." },
      { section: "Interface Contracts", required: false, validationRule: "If present: for each module boundary list produces (outputs) and consumes (inputs) with data types." },
      { section: "Synthesis Sources", required: false, validationRule: "If present: cite at least one upstream/context source with what it supplied and confidence." },
      { section: "Behavior Contract", required: false, validationRule: "If present: list >=3 behaviors in user-story or Given/When/Then shape (or `- None.` for single-step specs)." },
      { section: "Architecture Modules", required: false, validationRule: "If present: module responsibilities only (no code fences or function/class signatures); keep module count within a single coherent subsystem." },
      { section: "Spec Self-Review", required: true, validationRule: "Must explicitly cover placeholder, consistency, scope, and ambiguity checks plus applied patches/remaining concerns." },
      { section: "Approval", required: true, validationRule: "Explicit user approval marker present." }
    ]
  },
  reviewLens: {
    outputs: [
      "measurable specification",
      "acceptance-to-testability map",
      "approved spec artifact"
    ],
    reviewSections: [
      {
        title: "Acceptance Criteria Audit",
        evaluationPoints: [
          "Is every criterion observable (can you point to evidence of pass/fail)?",
          "Is every criterion measurable (numeric threshold or boolean outcome)?",
          "Is every criterion falsifiable (can you describe what failure looks like)?",
          "Does every criterion trace to a design decision (Design Decision Ref)?",
          "Are there any vague adjectives (fast, intuitive, robust) without thresholds?"
        ],
        stopGate: true
      },
      {
        title: "Testability Audit",
        evaluationPoints: [
          "Does every criterion have a concrete row in Acceptance Mapping?",
          "Does every test specify a verification approach (unit, integration, e2e, manual)?",
          "Does every verification method include a runnable command or concrete manual steps when known?",
          "Were assumptions surfaced before finalization with source/confidence, validation path, and disposition?",
          "Are edge cases (boundary + error) defined for every criterion?",
          "Are commands specific enough to run later (not vague `run tests` wording)?"
        ],
        stopGate: true
      }
    ]
  },
  next: "plan",
};
