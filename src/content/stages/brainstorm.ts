import type { StageSchemaInput } from "./schema-types.js";

// ---------------------------------------------------------------------------
// BRAINSTORM — reference: superpowers brainstorming
// ---------------------------------------------------------------------------

export const BRAINSTORM: StageSchemaInput = {
  schemaShape: "v2",
  stage: "brainstorm",
  complexityTier: "standard",
  skillFolder: "brainstorming",
  skillName: "brainstorming",
  skillDescription: "Design-first stage. Explore context, understand intent through collaborative dialogue, propose distinct approaches, and lock an approved direction before scope/design work.",
  philosophy: {
    hardGate: "Do NOT invoke implementation skills, write code, scaffold projects, or mutate product behavior until a concrete direction is approved by the user.",
    ironLaw: "NO ARTIFACT IS COMPLETE WITHOUT AN EXPLICITLY APPROVED DIRECTION — SILENCE IS NOT APPROVAL.",
    purpose: "Turn an initial idea into an approved design direction through natural collaborative dialogue — understanding the problem before proposing solutions.",
    whenToUse: [
      "Starting a new feature or behavior change",
      "Requirements are ambiguous or trade-offs are unclear",
      "Before any implementation-stage command or architecture commitment"
    ],
    whenNotToUse: [
      "A valid approved direction already exists and only execution remains",
      "The request is a pure release/finalization action with no new product decisions",
      "The task is retrospective only (post-ship audit with no new solution choices)"
    ],
    commonRationalizations: [
      "Asking questions without exploring existing project context first",
      "Asking bundled or purely informational questions that don't change decisions",
      "Proposing cosmetic option variants instead of architecturally distinct approaches",
      "Revealing recommendation before collecting user reaction",
      "Three same-altitude approaches with no higher-upside challenger",
      "Jumping directly into implementation",
      "Requesting approval without stating what decision is being approved",
      "Questions that only gather preferences without design impact",
      "Options that are variants of one approach, not distinct alternatives"
    ]
  },
  executionModel: {
    checklist: [
      "**Explore project context** — inspect existing files/docs/recent activity before asking what to build.",
      "**Classify depth and scope** — pick Lightweight / Standard / Deep; decompose independent subsystems before deeper work.",
      "**Short-circuit concrete asks** — for unambiguous requests, write a compact brainstorm stub (context, problem, approved intent, constraints, assumptions) and ask for one explicit approval.",
      "**Ask only decision-changing questions** — one at a time; if answers would not change approach, state the assumption and continue.",
      "**Compare 2-3 distinct approaches** — include real trade-offs, withhold recommendation, and include one higher-upside challenger.",
      "**Collect reaction before recommending** — ask which option feels closest and what concern remains, then recommend based on that reaction.",
      "**Write and tighten the artifact** — scale sections to complexity, optionally add a compact diagram, then patch contradictions, weak trade-offs, placeholders, and ambiguity.",
      "**Request explicit approval** — state exactly what direction is being approved; do not advance without approval and artifact review.",
      "**Handoff** — only after approval, complete the stage and point to `/cc-next`."
    ],
    interactionProtocol: [
      "Start from observed project context; if the idea is vague, first narrow the project type.",
      "Ask at most one question per turn, only when decision-changing; if using a structured question tool, send exactly one question object, not a multi-question form.",
      "If likely answers do not change architecture or scope boundaries, choose the default and state the assumption.",
      "Show approaches before the recommendation; include a higher-upside challenger and gather reaction first.",
      "State exactly what is being approved, then **STOP** until the user explicitly approves the artifact."
    ],
    process: [
      "Explore project context and classify depth/scope.",
      "Short-circuit concrete asks or ask one decision-changing question at a time.",
      "Compare 2-3 distinct approaches, including a higher-upside challenger.",
      "Collect reaction, then recommend with rationale tied to that reaction.",
      "Optionally park promising non-selected ideas in `.cclaw/seeds/`.",
      "Write and self-review `.cclaw/artifacts/01-brainstorm-<slug>.md`.",
      "Request explicit approval before handoff to scope."
    ],
    requiredGates: [
      { id: "brainstorm_approaches_compared", description: "2-3 architecturally distinct approaches were compared with real trade-offs and a recommendation." },
      { id: "brainstorm_direction_approved", description: "User approved a concrete direction and what exactly was approved is stated." },
      { id: "brainstorm_artifact_reviewed", description: "User reviewed the written brainstorm artifact and confirmed readiness." }
    ],
    requiredEvidence: [
      "Artifact written to `.cclaw/artifacts/01-brainstorm-<slug>.md`.",
      "Project context was explored (files, docs, or recent activity referenced).",
      "Clarifying questions and their answers are captured.",
      "2-3 approaches with trade-offs are recorded, including one higher-upside challenger option.",
      "User reaction to approaches is captured before final recommendation.",
      "Final recommendation explicitly reflects user reaction.",
      "When a promising option is parked, a seed file is created under `.cclaw/seeds/` and referenced in the artifact.",
      "Approved direction and approval marker are present.",
      "Assumptions and open questions are captured (or explicitly marked as none)."
    ],
    inputs: ["problem statement", "constraints", "success criteria"],
    requiredContext: [
      "existing project context and patterns",
      "current behavior of affected area",
      "business and delivery constraints"
    ],
    researchPlaybooks: [
      "research/repo-scan.md",
      "research/learnings-lookup.md"
    ],
    blockers: [
      "no explicit approval",
      "critical ambiguity unresolved",
      "project context not explored"
    ],
    exitCriteria: [
      "approved design direction documented",
      "required gates marked satisfied",
      "no implementation action taken",
      "artifact reviewed by user"
    ],
    platformNotes: [
      "Write artifact paths in POSIX form (`.cclaw/artifacts/01-brainstorm-<slug>.md`) even on Windows — the runtime normalizes separators. Do NOT commit Windows-style backslashes into the artifact or flow-state.",
      "Slugify titles with lowercase ASCII letters, digits, and single dashes only — avoid spaces and case-sensitive names so the file resolves identically on case-insensitive filesystems (macOS/Windows default).",
      "When linking to files inside the artifact, use repo-relative forward-slash paths (`src/foo/bar.ts`) so reviewers on any OS can click through."
    ]
  },
  artifactRules: {
    artifactFile: "01-brainstorm-<slug>.md",
    completionStatus: ["DONE", "DONE_WITH_CONCERNS", "BLOCKED"],
    crossStageTrace: {
      readsFrom: [],
      writesTo: [".cclaw/artifacts/01-brainstorm-<slug>.md"],
      traceabilityRule: "Scope and design decisions must trace back to explored context and approved brainstorm direction."
    },
    artifactValidation: [
      { section: "Context", required: true, validationRule: "Must reference project state and relevant existing code or patterns." },
      { section: "Problem", required: true, validationRule: "Must define what we're solving, success criteria, and constraints." },
      { section: "Clarifying Questions", required: false, validationRule: "Must capture question, answer, and decision impact for each clarifying question." },
      { section: "Approach Tier", required: true, validationRule: "Must classify depth as Lightweight/Standard/Deep and explain why." },
      { section: "Short-Circuit Decision", required: false, validationRule: "Must include Status/Why/Scope handoff lines when short-circuit is discussed; compact stubs are valid for concrete asks." },
      { section: "Approaches", required: true, validationRule: "Must compare 2-3 architecturally distinct options with real trade-offs; include at least one table/bullet row containing both `challenger` and `higher-upside`." },
      { section: "Approach Reaction", required: true, validationRule: "Must appear before Selected Direction and summarize user reaction before recommendation, including `Closest option`, `Concerns`, and what changed after reaction." },
      { section: "Selected Direction", required: true, validationRule: "Must include the selected approach, an explicit approval marker, and rationale tied to user reaction/feedback/concerns so the recommendation traces to the user response." },
      { section: "Design", required: false, validationRule: "Must cover architecture, key components, and data flow scaled to complexity." },
      { section: "Visual Companion", required: false, validationRule: "If architecture/data-flow complexity is medium+, include compact ASCII/Mermaid diagram or explicitly justify omission." },
      { section: "Assumptions and Open Questions", required: false, validationRule: "Must capture unresolved assumptions/open questions, or explicitly state none." }
    ],
    trivialOverrideSections: [
      "Context",
      "Problem",
      "Approach Tier",
      "Short-Circuit Decision",
      "Selected Direction"
    ]
  },
  reviewLens: {
    outputs: [
      "approved design direction",
      "alternatives with trade-offs",
      "brainstorm artifact"
    ],
    reviewSections: []
  },
  next: "scope"
};
