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
      "**Explore project context** — check files, docs, recent commits to understand what already exists.",
      "**Assess depth tier first** — classify the request as Lightweight / Standard / Deep. Lightweight = narrow/localized ask; Standard = cross-module but bounded; Deep = platform or multi-surface product change.",
      "**Assess scope** — if the request covers multiple independent subsystems, flag it and help decompose before deep-diving. Each sub-project gets its own brainstorm cycle.",
      "**Short-circuit gate** — if requirements are already concrete and unambiguous, write a compact brainstorm stub (context, problem, approved intent, constraints, assumptions) and hand off to scope with one explicit approval.",
      "**Ask only decision-changing questions** — after context scan, either recommend a path or ask one question whose likely answers produce different approaches. If not, choose the default and state the assumption.",
      "**Propose 2-3 architecturally distinct approaches** — with real trade-offs and no recommendation yet. At least one option must be a higher-upside challenger that raises ambition vs the user's initial ask.",
      "**Collect user reaction** — ask which approach feels closest and what concerns remain before stating your recommendation.",
      "**Recommend only after reaction** — use this shape: `I recommend X because you prioritized A and rejected/softened B; this leaves C deliberately out.`",
      "**Plant-seed shelf (optional)** — when a non-selected approach is still promising, capture it as `.cclaw/seeds/SEED-<YYYY-MM-DD>-<slug>.md` with `trigger_when`, hypothesis, and suggested action instead of losing it.",
      "**Present only useful sections** — scale to complexity. Lightweight asks get a compact stub; standard/deep asks cover architecture, key components, and data flow.",
      "**Optional visual companion** — when architecture/data flow complexity is medium+ offer a compact diagram (ASCII or Mermaid) before artifact write-up.",
      "**Write artifact** to `.cclaw/artifacts/01-brainstorm-<slug>.md`.",
      "**Document-quality pass** — run a brief adversarial review of the artifact (gaps, contradictions, missing trade-offs), then patch before user review.",
      "**Self-review** — scan for placeholders/TODOs, check internal consistency, verify scope is focused, resolve any ambiguity.",
      "**User reviews artifact** — for compact stubs ask one approval question; for standard/deep artifacts ask explicit approve/request-changes.",
      "**Handoff** — only then complete stage and point to `/cc-next`."
    ],
    interactionProtocol: [
      "Explore what exists before asking what to build — check project files first.",
      "If the idea is vague or could mean many different things, your FIRST question narrows to a specific kind of project. Do not ask detail questions until the project type is clear.",
      "Ask at most one question per turn, and only when the answer changes the approach. Prefer multiple choice. No bundled questions.",
      "After 2-3 questions, summarize your emerging understanding before continuing so the user can correct course early.",
      "Question litmus test: if the two most likely answers do not lead to different architectures or scope boundaries, make the choice yourself and state it as an assumption.",
      "Present design in sections scaled to complexity — compact for simple aspects, detailed only for nuanced ones. Avoid approval-by-section on lightweight stubs.",
      "When proposing approaches, do NOT reveal your recommendation yet. Present options first, gather reaction, then recommend.",
      "At least one approach must be a higher-upside challenger; avoid three same-altitude variants.",
      "State explicitly what is being approved when requesting approval.",
      "Run a brief self-review (placeholders, contradictions, scope, ambiguity) before presenting the artifact.",
      "**STOP.** Wait for explicit user approval after writing the artifact. Do NOT auto-advance."
    ],
    process: [
      "Explore project context: check files, docs, recent activity.",
      "Classify depth tier (Lightweight / Standard / Deep) before diving.",
      "Assess scope: flag if request is too broad, help decompose first.",
      "Apply short-circuit when requirements are already concrete enough for scope.",
      "Ask clarifying questions one at a time — focus on purpose, constraints, success criteria.",
      "Propose 2-3 architecturally distinct approaches with trade-offs (one must be higher-upside challenger).",
      "Collect user reaction before giving your recommendation.",
      "Recommend after reaction and explain how feedback changed the recommendation.",
      "Optionally plant promising non-selected approaches into `.cclaw/seeds/SEED-<YYYY-MM-DD>-<slug>.md` with trigger_when/action notes.",
      "Present design sections incrementally, get approval after each.",
      "Write approved direction to `.cclaw/artifacts/01-brainstorm-<slug>.md`.",
      "Run document-quality pass to close contradictions and weak trade-off reasoning.",
      "Self-review: placeholder scan, internal consistency, scope check, ambiguity check.",
      "Request explicit user approval of the artifact.",
      "Handoff to scope only after approval is explicit."
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
      { section: "Approaches", required: true, validationRule: "Must compare 2-3 architecturally distinct options with real trade-offs and include one row labeled `challenger: higher-upside`." },
      { section: "Approach Reaction", required: true, validationRule: "Must summarize user reaction before recommendation, including concerns that changed direction." },
      { section: "Selected Direction", required: true, validationRule: "Must include the selected approach, rationale tied to user reaction/feedback, and explicit approval marker." },
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
