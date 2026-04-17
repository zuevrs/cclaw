import type { StageSchemaInput } from "./schema-types.js";

// ---------------------------------------------------------------------------
// BRAINSTORM — reference: superpowers brainstorming
// ---------------------------------------------------------------------------

export const BRAINSTORM: StageSchemaInput = {
  stage: "brainstorm",
  skillFolder: "brainstorming",
  skillName: "brainstorming",
  skillDescription: "Design-first stage. Explore context, understand intent through collaborative dialogue, propose distinct approaches, and lock an approved direction before scope/design work.",
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
  checklist: [
    "**Explore project context** — check files, docs, recent commits to understand what already exists.",
    "**Assess scope** — if the request covers multiple independent subsystems, flag it and help decompose before deep-diving. Each sub-project gets its own brainstorm cycle.",
    "**Ask clarifying questions** — one at a time, understand purpose, constraints, and success criteria. Prefer multiple choice when possible. Each question should change what we build, not just gather trivia.",
    "**Propose 2-3 architecturally distinct approaches** — with real trade-offs and your recommendation. Lead with the recommended option and explain why.",
    "**Present design by sections** — scale each section to its complexity. Ask after each section whether it looks right so far. Cover: architecture, key components, data flow.",
    "**Write artifact** to `.cclaw/artifacts/01-brainstorm.md`.",
    "**Self-review** — scan for placeholders/TODOs, check internal consistency, verify scope is focused, resolve any ambiguity.",
    "**User reviews artifact** — ask the user to review the written artifact and explicitly approve or request changes.",
    "**Handoff** — only then complete stage and point to `/cc-next`."
  ],
  interactionProtocol: [
    "Explore what exists before asking what to build — check project files first.",
    "If the idea is vague or could mean many different things, your FIRST question narrows to a specific kind of project. Do not ask detail questions until the project type is clear.",
    "Ask exactly one question per turn. Prefer multiple choice. No bundled questions.",
    "After 2-3 questions, summarize your emerging understanding before continuing so the user can correct course early.",
    "Each question should change a concrete design decision. Litmus test: if the two most likely answers do not lead to different architectures, make the choice yourself and state it.",
    "Present design in sections scaled to their complexity — a few sentences for simple aspects, detailed for nuanced ones. Get approval after each section.",
    "When proposing approaches, lead with your recommendation and explain why.",
    "State explicitly what is being approved when requesting approval.",
    "Run a brief self-review (placeholders, contradictions, scope, ambiguity) before presenting the artifact.",
    "**STOP.** Wait for explicit user approval after writing the artifact. Do NOT auto-advance."
  ],
  process: [
    "Explore project context: check files, docs, recent activity.",
    "Assess scope: flag if request is too broad, help decompose first.",
    "Ask clarifying questions one at a time — focus on purpose, constraints, success criteria.",
    "Propose 2-3 architecturally distinct approaches with trade-offs and a recommendation.",
    "Present design sections incrementally, get approval after each.",
    "Write approved direction to `.cclaw/artifacts/01-brainstorm.md`.",
    "Self-review: placeholder scan, internal consistency, scope check, ambiguity check.",
    "Request explicit user approval of the artifact.",
    "Handoff to scope only after approval is explicit."
  ],
  requiredGates: [
    { id: "brainstorm_context_explored", description: "Project context (files, docs, existing patterns) was checked before asking questions." },
    { id: "brainstorm_idea_understood", description: "Agent and user share the same understanding of the problem, constraints, and success criteria." },
    { id: "brainstorm_approaches_compared", description: "2-3 architecturally distinct approaches were compared with real trade-offs and a recommendation." },
    { id: "brainstorm_direction_approved", description: "User approved a concrete direction and what exactly was approved is stated." },
    { id: "brainstorm_artifact_reviewed", description: "User reviewed the written brainstorm artifact and confirmed readiness." }
  ],
  requiredEvidence: [
    "Artifact written to `.cclaw/artifacts/01-brainstorm.md`.",
    "Project context was explored (files, docs, or recent activity referenced).",
    "Clarifying questions and their answers are captured.",
    "2-3 approaches with trade-offs and recommendation are recorded.",
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
  outputs: [
    "approved design direction",
    "alternatives with trade-offs",
    "brainstorm artifact"
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
  antiPatterns: [
    "Asking questions without exploring existing project context first",
    "Asking bundled or purely informational questions that don't change decisions",
    "Proposing cosmetic option variants instead of architecturally distinct approaches",
    "Jumping directly into implementation",
    "Requesting approval without stating what decision is being approved"
  ],
  redFlags: [
    "No project context exploration before questions",
    "Questions that only gather preferences without design impact",
    "Options that are variants of one approach, not distinct alternatives",
    "Approval requested without explicit decision context"
  ],
  policyNeedles: [
    "Explore project context",
    "One question at a time",
    "2-3 architecturally distinct approaches",
    "State what is being approved",
    "Self-review before handoff",
    "Do NOT implement, scaffold, or modify behavior"
  ],
  artifactFile: "01-brainstorm.md",
  next: "scope",
  reviewSections: [],
  completionStatus: ["DONE", "DONE_WITH_CONCERNS", "BLOCKED"],
  crossStageTrace: {
    readsFrom: [],
    writesTo: [".cclaw/artifacts/01-brainstorm.md"],
    traceabilityRule: "Scope and design decisions must trace back to explored context and approved brainstorm direction."
  },
  artifactValidation: [
    { section: "Context", required: true, validationRule: "Must reference project state and relevant existing code or patterns." },
    { section: "Problem", required: true, validationRule: "Must define what we're solving, success criteria, and constraints." },
    { section: "Clarifying Questions", required: true, validationRule: "Must capture question, answer, and decision impact for each clarifying question." },
    { section: "Approaches", required: true, validationRule: "Must compare 2-3 architecturally distinct options with real trade-offs and recommendation." },
    { section: "Selected Direction", required: true, validationRule: "Must include the selected approach, rationale, and explicit approval marker." },
    { section: "Design", required: true, validationRule: "Must cover architecture, key components, and data flow scaled to complexity." },
    { section: "Assumptions and Open Questions", required: true, validationRule: "Must capture unresolved assumptions/open questions, or explicitly state none." }
  ]
};
