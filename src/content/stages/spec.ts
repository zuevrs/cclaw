import type { StageSchemaInput } from "./schema-types.js";

// ---------------------------------------------------------------------------
// SPEC
// ---------------------------------------------------------------------------

export const SPEC: StageSchemaInput = {
  schemaShape: "v2",
  stage: "spec",
  complexityTier: "standard",
  skillFolder: "specification-authoring",
  skillName: "specification-authoring",
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
      "Edge cases missing or deferred"
    ]
  },
  executionModel: {
    checklist: [
      "Read upstream — load design artifact and scope contract. Cross-reference architecture decisions.",
      "Define measurable acceptance criteria — each criterion must be observable and falsifiable. No vague adjectives.",
      "Capture edge cases — for each criterion, define at least one boundary condition and one error condition.",
      "Document constraints and assumptions — regulatory, system, integration, and performance boundaries. Surface implicit assumptions explicitly.",
      "Confirm testability — for each acceptance criterion, describe the test that would prove it. If untestable, rewrite the criterion.",
      "Present acceptance criteria to the user in 3-5-item batches, pausing for explicit ACK between batches (see Interaction Protocol).",
      "Write spec artifact and request user approval — wait for explicit confirmation before proceeding."
    ],
    interactionProtocol: [
      "Express each requirement in observable terms.",
      "Resolve ambiguity before moving to plan. Challenge vague language.",
      "Capture assumptions explicitly, not implicitly.",
      "**Chunk acceptance criteria for review.** When presenting the spec to the user for sign-off, deliver acceptance criteria in batches of 3-5 and **pause for explicit ACK** (via Decision Protocol) before sending the next batch. Do not dump the full criteria wall in one message — small batches surface objections earlier and keep the sign-off meaningful. Full spec writeup still lands in `04-spec.md`, but the conversation itself must be digestible.",
      "Require user confirmation on the written spec. **STOP.** Do NOT proceed to plan until user approves.",
      "For each criterion, ask: how would you test this? If the answer is unclear, rewrite.",
      "When encountering ambiguity, classify it before acting: (A) ask user for missing info, (B) enumerate interpretations and pick one with justification, (C) propose hypothesis with validation path. Do NOT silently resolve ambiguity."
    ],
    process: [
      "Define measurable acceptance criteria.",
      "Capture constraints, assumptions, and edge cases.",
      "Build testability map: criterion -> test description.",
      "Confirm testability for each criterion.",
      "Present acceptance criteria to the user in 3-5-item batches, pausing for explicit ACK between batches (see Interaction Protocol).",
      "Write spec artifact and request approval."
    ],
    requiredGates: [
      { id: "spec_acceptance_measurable", description: "Acceptance criteria are measurable and observable." },
      { id: "spec_testability_confirmed", description: "Each criterion has a described test method." },
      { id: "spec_user_approved", description: "User approved the final written spec." }
    ],
    requiredEvidence: [
      "Artifact written to `.cclaw/artifacts/04-spec.md`.",
      "Each acceptance criterion maps to a testable outcome.",
      "Edge cases documented per criterion.",
      "Approval marker captured in artifact."
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
      "open ambiguities remain"
    ],
    exitCriteria: [
      "spec approved by user",
      "required gates marked satisfied",
      "plan-ready acceptance mapping exists",
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
      { section: "Acceptance Criteria", required: true, validationRule: "Each criterion is observable, measurable, and falsifiable. Table must include a Requirement Ref column linking to R# IDs in 02-scope-<slug>.md (legacy 02-scope.md is accepted during migration) and a Design Decision Ref column tracing back to design artifact. AC IDs (AC-1, AC-2…) are stable across revisions — dropped ACs stay with Priority `DROPPED`." },
      { section: "Edge Cases", required: true, validationRule: "At least one boundary and one error condition per criterion." },
      { section: "Constraints and Assumptions", required: false, validationRule: "All implicit assumptions surfaced. Constraints have sources." },
      { section: "Testability Map", required: true, validationRule: "Each criterion maps to a concrete test description with verification approach (unit, integration, e2e, manual) and command or manual steps." },
      { section: "Vague to Fixed", required: false, validationRule: "If present: table with original vague wording and rewritten observable/testable version for each ambiguous requirement." },
      { section: "Non-Functional Requirements", required: false, validationRule: "If present: performance thresholds, security constraints, scalability limits, reliability targets with measurable values." },
      { section: "Interface Contracts", required: false, validationRule: "If present: for each module boundary list produces (outputs) and consumes (inputs) with data types." },
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
          "Does every criterion have a concrete test description in the Testability Map?",
          "Does every test specify a verification approach (unit, integration, e2e, manual)?",
          "Does every test include a runnable command or manual steps?",
          "Are edge cases (boundary + error) defined for every criterion?",
          "Can you run every verification command right now and get a meaningful result?"
        ],
        stopGate: true
      }
    ]
  },
  next: "plan",
};
