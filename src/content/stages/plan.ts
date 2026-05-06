import type { StageSchemaInput } from "./schema-types.js";

// ---------------------------------------------------------------------------
// PLAN
// ---------------------------------------------------------------------------

export const PLAN: StageSchemaInput = {
  schemaShape: "v2",
  stage: "plan",
  complexityTier: "standard",
  skillFolder: "plan",
  skillName: "plan",
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
      "No execution posture for sequencing, risk, and checkpoint cadence",
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
      "Task Contract — every task has one coherent outcome, AC mapping, exact verification command/manual step, and expected evidence snippet or pass condition. Avoid vague `run tests` wording.",
      "Annotate slice-review metadata — task rows may carry `touchCount` (rough number of files expected to change), `touchPaths` (glob hints, e.g. `migrations/**`, `src/auth/**`), and optional `highRisk: true` to force a review pass. These fields feed the TDD stage's Per-Slice Review point.",
      "For every `### Implementation Unit U-<n>`, declare parallel metadata bullets: `id`, `dependsOn` (unit ids or `none`), `claimedPaths` (repo-relative), `parallelizable` (true|false), `riskTier` (low|standard|high), optional `lane` — used for conflict-aware wave plans and schedulers.",
      "Map scope Locked Decisions — every D-XX ID from scope is referenced by at least one plan task (or explicitly marked deferred with reason).",
      "Run anti-placeholder + anti-scope-reduction scans — block `TODO/TBD/...` and phrasing like `v1`, `for now`, `later` for locked boundaries.",
      "Define validation points — mark where progress must be checked before continuing, with concrete command and expected evidence.",
      "Define execution posture — record whether execution should be sequential, dependency-batched, parallel-safe, or blocked; include risk triggers and RED/GREEN/REFACTOR checkpoint/commit expectations when the repo workflow supports them. This fulfills the `plan_execution_posture_recorded` gate.",
      "**Author the FULL Parallel Execution Plan.** Inside the `<!-- parallel-exec-managed-start -->` block, enumerate ALL waves W-02..W-N covering EVERY T-NNN task in `## Task List` — no `we'll author waves later`, `next batch only`, or open-ended Backlog handwave is acceptable. Each task gets a slice with `sliceId | taskId | dependsOn | claimedPaths | parallelizable | riskTier | lane`. Spike rows (`S-N`) and tasks marked `deferred` in an explicit `Deferred:` column may be omitted, but every other T-NNN must be claimed. This fulfills the `plan_parallel_exec_full_coverage` gate. The TDD stage downstream is a pure consumer of these waves — if the plan does not author them, TDD cannot fan out that work.",
      "After authoring/refreshing the managed parallel-exec block, render a Mermaid `flowchart` or `gantt` covering waves (`W-*`) and slice dependencies (`S-*`) so parallelism and fan-in boundaries are visually auditable.",
      "WAIT_FOR_CONFIRM — write plan artifact and explicitly pause. **STOP.** Do NOT proceed until user confirms. Then close the stage with `node .cclaw/hooks/stage-complete.mjs plan` and tell user to run `/cc`."
    ],
    interactionProtocol: [
      "Plan in read-only mode relative to implementation.",
      "Split work into small vertical slices (target 2-5 minute tasks).",
      "Publish explicit dependency batches with entry and exit checks for each batch.",
      "Expose execution posture: sequential vs batch/parallel, stop conditions, and checkpoint cadence for the TDD handoff.",
      "Keep same-wave `claimedPaths` disjoint; if overlap exists, split waves or serialize explicitly before handoff.",
      "Attach exact verification command/manual step and expected evidence to every task.",
      "Preserve locked scope boundaries: no silent scope reduction language in task rows.",
      "Enforce WAIT_FOR_CONFIRM: present the plan summary with options (A) Approve / (B) Revise / (C) Reject.",
      "**STOP.** Do NOT proceed until user explicitly approves.",
      "**STOP BEFORE ADVANCE.** Mandatory delegation `planner` must be marked completed or explicitly waived in `.cclaw/state/delegation-log.json`. Then close the stage via `node .cclaw/hooks/stage-complete.mjs plan` and tell the user to run `/cc`.",
      "Investigation discipline: follow the shared `## Investigation Discipline` block — when defining `Implementation Units`, list cited paths in the `Files` and `Patterns to follow` rows instead of pasting code into chat or delegations.",
      "Behavior anchor: see the shared `## Behavior anchor` block in this skill — the bad/good pair anchors how `Execution Posture` may only claim parallel-safe with disjoint units and a cited interface contract."
    ],
    process: [
      "Build dependency graph and ordered slices.",
      "Group slices into execution batches and define gate criteria per batch.",
      "Define each task with acceptance mapping, verification command/manual step, and expected evidence/pass condition.",
      "Trace every locked decision (D-XX) to plan tasks or explicit defer rationale.",
      "Record validation points, blockers, and execution posture.",
      "For high-risk/multi-batch plans, add a calibrated findings pass and explicit regression iron-rule acknowledgement.",
      "Write plan artifact and pause at WAIT_FOR_CONFIRM."
    ],
    requiredGates: [
      { id: "plan_tasks_sliced_2_5_min", description: "Tasks are small, executable slices." },
      { id: "plan_dependency_batches_defined", description: "Tasks are grouped into executable batches with gate checks and execution posture." },
      { id: "plan_acceptance_mapped", description: "Each task maps to a spec acceptance criterion." },
      { id: "plan_execution_posture_recorded", description: "Execution posture is recorded before implementation handoff." },
      { id: "plan_parallel_exec_full_coverage", description: "Every T-NNN task in `## Task List` (other than spikes/explicitly-deferred) is assigned to at least one slice inside the `<!-- parallel-exec-managed-start -->` block; TDD cannot fan out work that the plan never authored as waves." },
      { id: "plan_wave_paths_disjoint", description: "Within each authored wave, slice `claimedPaths` remain disjoint so `wave-fanout` can dispatch safely without overlap conflicts." },
      { id: "plan_module_introducing_slice_wires_root", description: "When a slice introduces a new module file, the stack-adapter's wiring aggregator (Rust `lib.rs`, Python `__init__.py`, Node-TS barrel when present) must appear in the same slice's claim or a transitive predecessor's claim so RED can be expressed." },
      { id: "plan_wait_for_confirm", description: "Execution blocked until explicit user confirmation." }
    ],
    requiredEvidence: [
      "Artifact written to `.cclaw/artifacts/05-plan.md`.",
      "Task list includes acceptance mapping, exact verification command/manual step, and expected evidence/pass condition.",
      "Locked decision coverage table present with D-XX trace links.",
      "Dependency graph documented.",
      "Dependency batches documented with batch-by-batch verification gates.",
      "Execution posture documented with sequencing, stop conditions, and TDD checkpoint expectations.",
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
      "execution posture is missing or contradicts dependency batches",
      "locked decisions from scope are not mapped to tasks",
      "no explicit confirmation"
    ],
    exitCriteria: [
      "plan quality gates complete",
      "WAIT_FOR_CONFIRM present and unresolved until user approves",
      "artifact ready for TDD execution",
      "execution posture ready for TDD handoff",
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
      { section: "Upstream Handoff", required: false, validationRule: "Summarizes spec/design/scope decisions, constraints, open questions, and explicit drift before task breakdown." },
      { section: "Dependency Graph", required: false, validationRule: "Ordering and parallel opportunities explicit. No circular dependencies." },
      { section: "Dependency Batches", required: true, validationRule: "Every task belongs to a batch. Each batch has an exit gate and dependency statement." },
      { section: "Task List", required: true, validationRule: "Each task row includes ID, description, acceptance criterion, exact verification command/manual step, expected evidence/pass condition, and effort estimate (S/M/L). Every task must also carry a minutes estimate within the 2-5 minute budget. When present, touchCount/touchPaths/highRisk metadata drives Per-Slice Review escalation in TDD." },
      { section: "Acceptance Mapping", required: true, validationRule: "Every spec criterion is covered by at least one task." },
      { section: "Execution Posture", required: true, validationRule: "States sequential/batch/parallel posture, stop conditions, risk triggers, and RED/GREEN/REFACTOR checkpoint or commit expectations for TDD when consistent with the repo workflow." },
      { section: "Locked Decision Coverage", required: false, validationRule: "Every locked decision ID (D-XX) from scope is listed with linked task IDs or explicit defer rationale." },
      { section: "Risk Assessment", required: false, validationRule: "If present: per-task or per-batch risk identification with likelihood, impact, and mitigation strategy." },
      { section: "Boundary Map", required: false, validationRule: "If present: per-batch or per-task interface contracts listing what each task produces (exports) and consumes (imports) from other tasks." },
      { section: "Implementation Units", required: false, validationRule: "If present: each `### Implementation Unit U-<n>` includes Goal, Files, Approach, Test scenarios, Verification fields, plus bullets (`id`, `dependsOn`, `claimedPaths`, `parallelizable`, `riskTier`, optional `lane`)." },
      { section: "Calibrated Findings", required: false, validationRule: "If present: either `None this stage` or one or more lines in `[P1|P2|P3] (confidence: <n>/10) <path>[:<line>] — <description>` format." },
      { section: "Regression Iron Rule", required: false, validationRule: "If present: includes `Iron rule acknowledged: yes`." },
      { section: "WAIT_FOR_CONFIRM", required: true, validationRule: "Explicit marker present. Status: pending until user approves." },
      { section: "Plan Quality Scan", required: false, validationRule: "If present: includes a placeholder scan (`TODO`/`TBD`/`FIXME`/`<fill-in>`/`<your-*-here>`/`xxx`/bare ellipsis) and a scope-reduction language scan (`v1`, `for now`, `later`, `temporary`, `placeholder`) with zero hits in task rows when locked decisions exist." }
    ]
  },
  reviewLens: {
    outputs: ["task graph", "dependency batch plan", "ordered plan", "explicit confirmation gate"],
    reviewSections: [
      {
        title: "Task Decomposition Audit",
        evaluationPoints: [
          "Does every task target a single coherent area (vertical slice)?",
          "Can each task be completed in 2-5 minutes?",
          "Does every task have an acceptance criterion link, exact verification command/manual step, and expected evidence/pass condition?",
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
          "Are there hidden dependencies between tasks in different batches?",
          "Does the Execution Posture match the dependency graph and stop risky parallelism?"
        ],
        stopGate: true
      },
      {
        title: "Five-Minute Budget + No-Placeholders Audit",
        evaluationPoints: [
          "Does every task carry an explicit minutes estimate (e.g. `[~3m]`) and does every estimate fit the 2-to-5-minute budget? Estimates >5 minutes must be split.",
          "Are all file paths, test commands, verification commands, and expected evidence copy-pasteable/specific as written — no `TODO`, `TBD`, `FIXME`, `<fill-in>`, `<your-*-here>`, `xxx`, bare `run tests`, or ellipsis standing in for omitted args?",
          "Does every acceptance-criterion reference resolve to a real R# / AC-### in the spec (not a blank link)?",
          "If an estimate is genuinely uncertain (first-time integration, unfamiliar library), is the uncertainty named explicitly and scheduled as a spike task in batch 0, rather than hidden behind a large estimate?"
        ],
        stopGate: true
      }
    ]
  },
  next: "tdd",
};
