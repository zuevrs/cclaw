import type { StageSchemaInput } from "./schema-types.js";

// ---------------------------------------------------------------------------
// PLAN
// ---------------------------------------------------------------------------

export const PLAN: StageSchemaInput = {
  schemaShape: "v2",
  stage: "plan",
  complexityTier: "standard",
  skillFolder: "planning-and-task-breakdown",
  skillName: "planning-and-task-breakdown",
  skillDescription: "Execution planning stage with strict confirmation gate before implementation.",
  philosophy: {
    hardGate: "Do NOT write code or tests. Planning only. This stage produces a task graph and execution order. WAIT_FOR_CONFIRM before any handoff to implementation.",
    ironLaw: "EVERY TASK IS 2–5 MINUTES, FULLY SPELLED OUT, AND CARRIES A STABLE ID — NO PLACEHOLDERS, NO ‘ETC.’.",
    purpose: "Create small executable tasks with dependencies and pause for explicit user confirmation.",
    whenToUse: [
      "After spec approval",
      "Before writing tests or implementation",
      "When delivery path and dependency order are needed"
    ],
    whenNotToUse: [
      "Specification is unapproved or lacks measurable acceptance criteria",
      "Execution is already in TDD stage with active slice evidence",
      "The request is only release packaging with no task decomposition needed"
    ],
    commonRationalizations: [
      "Horizontal decomposition without end-to-end slices",
      "Tasks without verification steps",
      "Starting execution before approval",
      "Tasks that touch multiple unrelated areas",
      "Using placeholder tokens or scope-reduction phrases (`v1`, `for now`, `later`) in task definitions",
      "No dependency graph",
      "No WAIT_FOR_CONFIRM marker",
      "No explicit dependency batches",
      "Tasks exceed one coherent outcome",
      "No acceptance mapping",
      "Locked decisions are missing or not mapped",
      "Scope-reduction language appears without explicit approved defer decision"
    ]
  },
  executionModel: {
    checklist: [
      "Read upstream — load spec, design, and scope artifacts. Cross-reference acceptance criteria.",
      "Build dependency graph — identify task ordering, parallel opportunities, and blocking dependencies.",
      "Group tasks into dependency batches — batch N+1 cannot start until batch N has verification evidence.",
      "Slice into vertical tasks — each task targets 2-5 minutes, produces one testable outcome, and touches one coherent area.",
      "Attach verification — every task has an acceptance criterion mapping and a concrete verification command.",
      "Annotate slice-review metadata — if `.cclaw/config.yaml::sliceReview.enabled` is true, every task row additionally carries `touchCount` (rough number of files expected to change) and `touchPaths` (glob hints, e.g. `migrations/**`, `src/auth/**`). A task may set `highRisk: true` to force a review pass regardless of thresholds. These fields feed the TDD stage's Per-Slice Review checkpoint; when `sliceReview` is disabled they are optional.",
      "Map scope Locked Decisions — every D-XX from scope is referenced by at least one plan task (or explicitly marked deferred with reason).",
      "Run anti-placeholder + anti-scope-reduction scans — block `TODO/TBD/...` and phrasing like `v1`, `for now`, `later` for locked boundaries.",
      "Define checkpoints — mark points where progress should be validated before continuing.",
      "WAIT_FOR_CONFIRM — write plan artifact and explicitly pause. **STOP.** Do NOT proceed until user confirms. Then close the stage with `node .cclaw/hooks/stage-complete.mjs plan` and tell user to run `/cc-next`."
    ],
    interactionProtocol: [
      "Plan in read-only mode relative to implementation.",
      "Split work into small vertical slices (target 2-5 minute tasks).",
      "Publish explicit dependency batches with entry and exit checks for each batch.",
      "Attach verification step to every task.",
      "Preserve locked scope boundaries: no silent scope reduction language in task rows.",
      "Enforce WAIT_FOR_CONFIRM: present the plan summary with options (A) Approve / (B) Revise / (C) Reject.",
      "**STOP.** Do NOT proceed until user explicitly approves.",
      "**STOP BEFORE ADVANCE.** Mandatory delegation `planner` must be marked completed or explicitly waived in `.cclaw/state/delegation-log.json`. Then close the stage via `node .cclaw/hooks/stage-complete.mjs plan` and tell the user to run `/cc-next`."
    ],
    process: [
      "Build dependency graph and ordered slices.",
      "Group slices into execution batches and define gate criteria per batch.",
      "Define each task with acceptance mapping and verification commands.",
      "Trace every locked decision (D-XX) to plan tasks or explicit defer rationale.",
      "Record checkpoints and blockers.",
      "Write plan artifact and pause at WAIT_FOR_CONFIRM."
    ],
    requiredGates: [
      { id: "plan_tasks_sliced_2_5_min", description: "Tasks are small, executable slices." },
      { id: "plan_dependency_batches_defined", description: "Tasks are grouped into executable batches with gate checks." },
      { id: "plan_acceptance_mapped", description: "Each task maps to a spec acceptance criterion." },
      { id: "plan_wait_for_confirm", description: "Execution blocked until explicit user confirmation." }
    ],
    requiredEvidence: [
      "Artifact written to `.cclaw/artifacts/05-plan.md`.",
      "Task list includes acceptance mapping.",
      "Locked decision coverage table present with D-XX trace links.",
      "Dependency graph documented.",
      "Dependency batches documented with batch-by-batch verification gates.",
      "WAIT_FOR_CONFIRM status recorded."
    ],
    inputs: ["approved spec", "codebase context", "delivery constraints"],
    requiredContext: [
      "spec acceptance criteria",
      "current architecture",
      "known technical debt and dependencies"
    ],
    blockers: [
      "tasks too broad",
      "dependency uncertainty unresolved",
      "batch boundaries are unclear",
      "locked decisions from scope are not mapped to tasks",
      "no explicit confirmation"
    ],
    exitCriteria: [
      "plan quality gates complete",
      "WAIT_FOR_CONFIRM present and unresolved until user approves",
      "artifact ready for TDD execution",
      "acceptance mapping complete"
    ],
    platformNotes: [
      "Per-task verification commands must be runnable on Windows PowerShell, macOS bash/zsh, and Linux bash. Prefer `npm run <script>` / `pnpm <script>` / `pytest -k <name>` over raw shell one-liners so the command portability is handled by the script runner.",
      "If a task command needs globbing, wrap the glob in single quotes on POSIX and escape as needed on PowerShell (`'src/**/*.ts'` vs `\"src/**/*.ts\"`). Note the quoting variant when the task is expected to run in mixed-OS CI.",
      "Environment variables referenced from tasks must be named in uppercase with underscores (`CCLAW_PROJECT_ROOT`) and set via a cross-shell wrapper (e.g. `cross-env` for Node tasks) — do not inline `KEY=value cmd` style that fails in PowerShell/cmd.exe."
    ]
  },
  artifactRules: {
    artifactFile: "05-plan.md",
    completionStatus: ["DONE", "DONE_WITH_CONCERNS", "BLOCKED"],
    crossStageTrace: {
      readsFrom: [".cclaw/artifacts/04-spec.md", ".cclaw/artifacts/03-design-<slug>.md", ".cclaw/artifacts/02-scope-<slug>.md"],
      writesTo: [".cclaw/artifacts/05-plan.md"],
      traceabilityRule: "Every task must trace to a spec acceptance criterion. Every locked scope decision (D-XX) must trace to at least one plan task or explicit defer rationale. Every downstream RED test must trace to a plan task."
    },
    artifactValidation: [
      { section: "Dependency Graph", required: false, validationRule: "Ordering and parallel opportunities explicit. No circular dependencies." },
      { section: "Dependency Batches", required: true, validationRule: "Every task belongs to a batch. Each batch has an exit gate and dependency statement." },
      { section: "Task List", required: true, validationRule: "Each task row includes ID, description, acceptance criterion, verification command, and effort estimate (S/M/L). Every task must also carry a minutes estimate within the 2-5 minute budget. When the sliceReview feature is enabled in the cclaw config, each task row additionally declares touchCount, touchPaths, and an optional highRisk flag so the TDD stage can decide whether a Per-Slice Review pass is required." },
      { section: "Acceptance Mapping", required: true, validationRule: "Every spec criterion is covered by at least one task." },
      { section: "Locked Decision Coverage", required: false, validationRule: "Every locked decision ID (D-XX) from scope is listed with linked task IDs or explicit defer rationale." },
      { section: "Risk Assessment", required: false, validationRule: "If present: per-task or per-batch risk identification with likelihood, impact, and mitigation strategy." },
      { section: "Boundary Map", required: false, validationRule: "If present: per-batch or per-task interface contracts listing what each task produces (exports) and consumes (imports) from other tasks." },
      { section: "WAIT_FOR_CONFIRM", required: true, validationRule: "Explicit marker present. Status: pending until user approves." },
      { section: "No-Placeholder Scan", required: false, validationRule: "Confirmation that a text scan for `TODO`, `TBD`, `FIXME`, `<fill-in>`, `<your-*-here>`, `xxx`, or bare ellipses has zero hits in the task list. A placeholder is a deferred decision masquerading as a plan." },
      { section: "No Scope Reduction Language Scan", required: false, validationRule: "Confirmation that scope-reduction phrases (`v1`, `for now`, `later`, `temporary`, `placeholder`) are absent from task rows when locked decisions exist." }
    ]
  },
  reviewLens: {
    outputs: ["task graph", "dependency batch plan", "ordered plan", "explicit confirmation checkpoint"],
    reviewSections: [
      {
        title: "Task Decomposition Audit",
        evaluationPoints: [
          "Does every task target a single coherent area (vertical slice)?",
          "Can each task be completed in 2-5 minutes?",
          "Does every task have an acceptance criterion link and verification command?",
          "Are there tasks that touch multiple unrelated areas?",
          "Would a new engineer understand and start each task within two minutes?"
        ],
        stopGate: true
      },
      {
        title: "Batch Completeness Audit",
        evaluationPoints: [
          "Does every task belong to exactly one batch?",
          "Does each batch have a verification gate?",
          "Are batch dependencies explicit and acyclic?",
          "Is the acceptance mapping complete — every spec criterion covered?",
          "Are there hidden dependencies between tasks in different batches?"
        ],
        stopGate: true
      },
      {
        title: "Five-Minute Budget + No-Placeholders Audit",
        evaluationPoints: [
          "Does every task carry an explicit minutes estimate (e.g. `[~3m]`) and does every estimate fit the 2-to-5-minute budget? Estimates >5 minutes must be split.",
          "Are all file paths, test commands, and verification commands copy-pasteable as written — no `TODO`, `TBD`, `FIXME`, `<fill-in>`, `<your-*-here>`, `xxx`, or ellipsis standing in for omitted args?",
          "Does every acceptance-criterion reference resolve to a real R# / AC-### in the spec (not a blank link)?",
          "If an estimate is genuinely uncertain (first-time integration, unfamiliar library), is the uncertainty named explicitly and scheduled as a spike task in batch 0, rather than hidden behind a large estimate?"
        ],
        stopGate: true
      }
    ]
  },
  next: "tdd",
};
