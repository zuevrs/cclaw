import type { StageSchemaInput } from "./schema-types.js";

// ---------------------------------------------------------------------------
// BRAINSTORM — reference: superpowers brainstorming
// ---------------------------------------------------------------------------

export const BRAINSTORM: StageSchemaInput = {
  schemaShape: "v2",
  stage: "brainstorm",
  complexityTier: "standard",
  skillFolder: "brainstorm",
  skillName: "brainstorm",
  skillDescription: "Problem-discovery stage. Build a concise Problem Decision Record, choose lite/standard/deep depth, compare distinct directions, and hand approved decisions to scope.",
  philosophy: {
    hardGate: "Do NOT invoke implementation skills, write code, scaffold projects, or mutate product behavior until a concrete direction is approved by the user.",
    ironLaw: "NO ARTIFACT IS COMPLETE WITHOUT AN EXPLICITLY APPROVED DIRECTION — SILENCE IS NOT APPROVAL.",
    purpose: "Turn an initial idea into an approved problem frame and direction, using domain-neutral problem discovery (product, technical-maintenance, research, ops, or infrastructure framing) before proposing solutions.",
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
      "**ADAPTIVE ELICITATION COMES FIRST (no exceptions, no subagent dispatch before).** Load `.cclaw/skills/adaptive-elicitation/SKILL.md`. Walk the brainstorm forcing questions one-at-a-time via the harness-native question tool, append one row to `## Q&A Log` (`Turn | Question | User answer (1-line) | Decision impact`) after each user answer. Continue until all forcing questions are answered/skipped/waived OR user records an explicit stop-signal row. Only then proceed to delegations, drafts, or analysis. The linter `qa_log_below_min` rule will block `stage-complete` if Q&A Log is below floor.",
      "**Explore project context** — after the elicitation loop converges, inspect existing files/docs/recent activity to refine the Discovered context section; capture matching files/patterns/seeds in `Context > Discovered context` so downstream stages don't redo discovery.",
      "**Brainstorm forcing questions (must be covered or explicitly waived)** — what pain are we solving, what is the direct path, what happens if we do nothing, who is the first operator/user affected, and what no-go boundaries are non-negotiable.",
      "**Classify stage depth** — choose `lite` for clear low-risk tasks, `standard` for normal engineering/product changes, or `deep` for ambiguity, architecture, external dependency, security/data risk, or explicit think-bigger requests.",
      "**Write the Problem Decision Record** — pick a free-form `Frame type` label that names how this work is framed (examples: product, technical-maintenance, research-spike, ops-incident, infrastructure), then fill the universal Framing fields: affected user/role/operator, current state/failure mode/opportunity, desired observable outcome, evidence/signal, why now, do-nothing consequence, and non-goals.",
      "**Premise check (one pass)** — answer the three gstack-style questions in the artifact body: *Right problem? Direct path? What if we do nothing?* Take a position; do not hedge.",
      "**Reframe with How Might We** — write a single `How Might We …?` line that names the user/operator, the desired outcome, and the constraint. This is the altitude check before approaches.",
      "**Run Clarity Gate** — record ambiguity score (0.00-1.00), decision boundaries, reaffirmed non-goals, and residual-risk handoff before locking recommendations. If ambiguity remains high (>0.40), ask one decision-changing question before recommending.",
      "**Sharpening question discipline** — ask one decision-changing question at a time. Do not default to 3-5 batched questions; record only questions that changed the direction or a critical stop decision.",
      "**Use compact discovery for low-risk asks** — for concrete bounded requests, do one context pass, compare one baseline and one challenger, and move to draft once context is sufficient; do not drag the user through a full workshop.",
      "**Early-exit concrete asks** — for unambiguous implementation-only requests, write a compact Problem Decision Record plus short-circuit handoff (context, approved intent, constraints, assumptions, next-stage risks) and request explicit approval when the draft is ready.",
      "**Ask only decision-changing questions** — one at a time; if answers would not change approach and are non-critical preference/default assumptions, state the assumption and continue; STOP on scope, architecture, security, data loss, public API, migration, auth/pricing, or user approval uncertainty.",
      "**Compare 2-3 distinct approaches with stable Role/Upside columns** — Role values are `baseline` | `challenger` | `wild-card`; Upside is `low` | `modest` | `high` | `higher`; include real trade-offs, reuse notes, and reference-pattern source/disposition when a known pattern influenced the option; include exactly one challenger with explicit `high` or `higher` upside.",
      "**Collect reaction before recommending** — ask which option feels closest and what concern remains, then recommend based on that reaction.",
      "**Write the `Not Doing` list** — name 3-5 things this brainstorm explicitly is not committing to (vs. deferred). This protects scope from silent enlargement and the next stage from rework.",
      "**Run early Ralph loop discipline** — after each producer iteration, append a `Critic Pass` JSONL row to `.cclaw/state/early-loop-log.jsonl`, refresh `.cclaw/state/early-loop.json`, and iterate until open concerns clear or convergence guard escalates.",
      "**Embedded Grill (post-pick, one-at-a-time)** — after `Selected Direction` is named, if grilling triggers fire (irreversibility, security/auth boundary, domain-model ambiguity per `adaptive-elicitation:Conditional Grilling`), continue the elicitation loop with sharper questions **one at a time**, appended to `## Q&A Log` and reflected as rows in `## Embedded Grill`. Do NOT batch the 3-5 grill checks — each one follows the Core Protocol (ask, wait, log, self-eval, ask next).",
      "**Self-review before user approval** — re-read the artifact and patch contradictions, weak trade-offs, placeholders, ambiguity, and weak handoff language. Record the result in `Self-Review Notes` using the calibrated review format: `- Status: Approved` (or `Issues Found`), `- Patches applied:` with inline note or sub-bullets, `- Remaining concerns:` with inline note or sub-bullets. Use `Patches applied: None` and `Remaining concerns: None` when there is nothing to record.",
      "**Request explicit approval to close the stage** — state exactly what direction is being approved after the adaptive elicitation loop converges; do not advance without approval and artifact review.",
      "**Handoff packet** — only after approval, produce a scope handoff packet with selected direction, why rejected options were rejected, explicit non-goals, unresolved questions, risk hints, and explicit drift from the initial ask so scope starts from locked upstream decisions instead of rediscovering intent."
    ],
    interactionProtocol: [
      "\"If something is unclear, stop. Name what's confusing. Ask.\"",
      "Start from observed project context; if the idea is vague, first narrow the project type with **one** structured question, then keep going.",
      "Select depth explicitly: `lite`, `standard`, or `deep`; keep lite concise, but escalate when risk/ambiguity changes decisions.",
      "Lead with the premise check (right problem / direct path / what if nothing) and the `How Might We` reframing before approaches; both go in the artifact, not just the chat.",
      "Ask at most one question per turn, only when decision-changing; if using a structured question tool, send exactly one question object, not a multi-question form.",
      "Run the shared adaptive elicitation cycle from `.cclaw/skills/adaptive-elicitation/SKILL.md`, including stop-signal handling (RU/EN/UA), smart-skip, conditional grilling triggers, and append-only `## Q&A Log` updates.",
      "Only non-critical preference/default assumptions may continue inline. STOP and ask when uncertainty affects scope, architecture, security, data loss, public API, migration, auth/pricing, or user approval.",
      "For simple low-risk greenfield work, present a compact A/B choice with one recommended path and one higher-upside challenger; keep the artifact concise but structurally complete (Context, Premise, How Might We, Sharpening Questions, Approaches, Reaction, Selected Direction, Not Doing).",
      "Show approaches before the recommendation; include a higher-upside challenger and gather reaction first.",
      "Self-review before approval: re-read the artifact, fix contradictions/placeholders/weak trade-offs, then ask for approval. Do not ask for approval on a draft you have not re-read.",
      "State exactly what is being approved, then **STOP** until the user explicitly approves the artifact."
    ],
    process: [
      "Explore project context and classify depth/scope.",
      "Use compact discovery for simple apps, short-circuit implementation-only asks, or ask one decision-changing question at a time.",
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
      "Problem Decision Record includes a `Frame type` label and the universal Framing fields (affected user/role/operator, current state/failure mode/opportunity, desired observable outcome, evidence/signal, why now, do-nothing consequence, non-goals).",
      "Clarity Gate records ambiguity score, decision boundaries, reaffirmed non-goals, and residual-risk handoff.",
      "Clarifying questions are one-at-a-time and captured only when they change a decision or stop condition.",
      "2-3 approaches with trade-offs are recorded, including one higher-upside challenger option and reference-pattern source/disposition when applicable.",
      "User reaction to approaches is captured before final recommendation.",
      "Final recommendation explicitly reflects user reaction.",
      "Early-loop status is reflected via `Victory Detector` / `Critic Pass` sections and `.cclaw/state/early-loop.json` when concerns remain.",
      "Selected Direction includes the handoff to the track-aware next stage: scope on standard, spec on medium when scope/design are skipped.",
      "When a promising option is parked, a seed file is created under `.cclaw/seeds/` and referenced in the artifact.",
      "Approved direction and approval marker are present.",
      "Assumptions and open questions are captured (or explicitly marked as none).",
      "Scope handoff packet includes selected direction, upstream decisions used, explicit drift, confidence, unresolved questions, next-stage risk hints, and non-goals."
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
      { section: "Context", required: true, validationRule: "Must reference project state and relevant existing code or patterns. A `Discovered context` subsection (or list) is recommended for downstream traceability." },
      { section: "Problem Decision Record", required: true, validationRule: "Must include a free-form `Frame type` label (examples only: product, technical-maintenance, research-spike, ops-incident, infrastructure) and the universal Framing fields: affected user/role/operator, current state/failure mode/opportunity, desired observable outcome, evidence/signal, why now, do-nothing consequence, non-goals. The linter checks that the section has meaningful content; the field labels themselves are the structural contract." },
      { section: "Premise Check", required: false, validationRule: "Recommended: explicit answers to `Right problem?`, `Direct path?`, `What if we do nothing?` — take a position, do not hedge." },
      { section: "How Might We", required: false, validationRule: "Recommended: a single `How Might We …?` line naming the user, the outcome, and the binding constraint." },
      { section: "Clarity Gate", required: false, validationRule: "Recommended before recommendation lock: include ambiguity score (0.00-1.00), decision boundaries, reaffirmed non-goals, and residual-risk handoff for scope." },
      { section: "Sharpening Questions", required: false, validationRule: "Recommended only when needed: one decision-changing question per turn with explicit `Decision impact`; compact tasks may record `None - early exit` with rationale." },
      { section: "Clarifying Questions", required: false, validationRule: "Must capture question, answer, and decision impact for each clarifying question." },
      { section: "Approach Tier", required: true, validationRule: "Must classify depth as lite/standard/deep and explain the risk/uncertainty signal." },
      { section: "Short-Circuit Decision", required: false, validationRule: "Must include Status/Why/Scope handoff lines when short-circuit is discussed; compact stubs are valid for concrete asks." },
      { section: "Reference Pattern Candidates", required: false, validationRule: "Recommended when examples influence direction: list pattern/source, reusable invariant, accept/reject/defer disposition, and reason before approaches are finalized." },
      { section: "Approaches", required: true, validationRule: "Must compare 2-3 distinct options with real trade-offs. Use the canonical `Role` column with `baseline` | `challenger` | `wild-card` and the `Upside` column with `low` | `modest` | `high` | `higher`; include exactly one challenger row with `high` or `higher` upside, and cite reference-pattern source/disposition when applicable." },
      { section: "Approach Reaction", required: true, validationRule: "Must appear before Selected Direction and summarize user reaction before recommendation, including `Closest option`, `Concerns`, and what changed after reaction." },
      { section: "Selected Direction", required: true, validationRule: "Must include the selected approach, explicit approval marker, rationale traceable to Approach Reaction, and a scope handoff packet with selected direction, decisions, drift, confidence, unresolved questions, risk hints, and non-goals." },
      { section: "Embedded Grill", required: false, validationRule: "Recommended after Selected Direction: 3-5 rows covering hidden constraints, reversibility/rollback, scope boundaries, existing-pattern fit, and domain-language alignment. Each row records question, recommended answer, and disposition (accept/refine/reject)." },
      { section: "Not Doing", required: false, validationRule: "Recommended: 3-5 explicitly non-committed items (distinct from deferred). Protects scope from silent enlargement and the next stage from rework." },
      { section: "Design", required: false, validationRule: "Must cover architecture, key components, and data flow scaled to complexity." },
      { section: "Visual Companion", required: false, validationRule: "If architecture/data-flow complexity is medium+, include compact ASCII/Mermaid diagram or explicitly justify omission." },
      { section: "Victory Detector", required: false, validationRule: "Recommended early-loop checkpoint: cite `.cclaw/state/early-loop.json`, current iteration/maxIterations, open concern count, convergence status, and iterate/ready/escalate decision." },
      { section: "Critic Pass", required: false, validationRule: "Recommended producer/critic log contract: each iteration appends one JSONL row to `.cclaw/state/early-loop-log.jsonl` with runId, stage, iteration, and open concerns." },
      { section: "Self-Review Notes", required: false, validationRule: "Recommended: use the calibrated review format — `- Status: Approved` (or `Issues Found`), `- Patches applied:` (inline note or sub-bullets, use `None` if nothing changed), `- Remaining concerns:` (inline note or sub-bullets, use `None` if nothing remains). Done before requesting user approval." },
      { section: "Assumptions and Open Questions", required: false, validationRule: "Must capture unresolved assumptions/open questions, or explicitly state none." }
    ],
    trivialOverrideSections: [
      "Context",
      "Problem Decision Record",
      "Approach Tier",
      "Short-Circuit Decision",
      "Selected Direction"
    ]
  },
  reviewLens: {
    outputs: [
      "Problem Decision Record",
      "approved direction",
      "alternatives with trade-offs",
      "brainstorm artifact"
    ],
    reviewSections: []
  },
  next: "scope"
};
