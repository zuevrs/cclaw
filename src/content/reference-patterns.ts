import type { FlowStage } from "../types.js";

export interface ReferencePatternContract {
  stage: FlowStage;
  guidance: string[];
  artifactSections: string[];
}

export interface ReferencePattern {
  id: string;
  title: string;
  intent: string;
  useWhen: string;
  policyNeedles: string[];
  contracts: ReferencePatternContract[];
}

export const REFERENCE_PATTERNS: ReferencePattern[] = [
  {
    id: "socraticode_context_readiness",
    title: "Context Readiness",
    intent: "Do not draft from memory. Start once the agent can name upstream artifacts, discovered code patterns, template shape, and open blockers.",
    useWhen: "Every stage before writing or validating an artifact.",
    policyNeedles: ["Context Readiness", "upstream freshness", "template shape"],
    contracts: [
      {
        stage: "brainstorm",
        guidance: [
          "Capture discovered project context before asking approval questions.",
          "Separate observed facts from assumptions and open blockers."
        ],
        artifactSections: ["Context", "Discovered context"]
      },
      {
        stage: "scope",
        guidance: [
          "Name which brainstorm decisions are fresh enough to carry forward.",
          "If upstream decisions are stale or missing, stop for re-scope instead of inventing boundaries."
        ],
        artifactSections: ["Upstream Handoff", "Scope Contract"]
      },
      {
        stage: "design",
        guidance: [
          "Read blast-radius code before locking architecture.",
          "Use reference patterns as examples to adapt, not authority to copy."
        ],
        artifactSections: ["Codebase Investigation", "Reference-Grade Contracts"]
      },
      {
        stage: "tdd",
        guidance: [
          "Discover tests and affected contracts before opening a RED vertical slice.",
          "Map the slice to the active source item before editing production code."
        ],
        artifactSections: ["Test Discovery", "System-Wide Impact Check", "Acceptance Mapping"]
      },
      {
        stage: "review",
        guidance: [
          "Review only after current diff, test evidence, and source-item coverage are known.",
          "A no-finding verdict still needs inspected-surface evidence."
        ],
        artifactSections: ["Review Evidence Scope", "Completeness Snapshot"]
      },
      {
        stage: "ship",
        guidance: [
          "Ship only after fresh preflight, rollback trigger, and finalization mode are explicit.",
          "Treat stale review or missing rollback evidence as a blocker, not a concern."
        ],
        artifactSections: ["Preflight Results", "Rollback Plan", "Finalization"]
      }
    ]
  },
  {
    id: "addy_reference_grade_contracts",
    title: "Reference-Grade Contracts",
    intent: "Promote good examples into explicit contracts: source, invariant, adaptation, rejection boundary, and verification signal.",
    useWhen: "Brainstorm, scope, and design need reusable patterns without copying unrelated behavior.",
    policyNeedles: ["Reference Pattern Registry", "Reference-Grade Contracts", "accepted/rejected reference ideas"],
    contracts: [
      {
        stage: "brainstorm",
        guidance: [
          "Record which reference patterns informed each option and which were rejected.",
          "A challenger must name the reference idea that makes it meaningfully higher-upside."
        ],
        artifactSections: ["Reference Pattern Candidates", "Approaches"]
      },
      {
        stage: "scope",
        guidance: [
          "Lock accepted, rejected, and deferred reference ideas as scope boundaries.",
          "Do not let a reference expand scope unless the user explicitly opts in."
        ],
        artifactSections: ["Reference Pattern Registry", "Scope Contract"]
      },
      {
        stage: "design",
        guidance: [
          "For every mirrored pattern, name source, invariant, adaptation, and verification evidence.",
          "If a reference conflicts with local architecture, reject it and document the revival signal."
        ],
        artifactSections: ["Reference-Grade Contracts", "Patterns to Mirror", "Rejected Alternatives"]
      }
    ]
  },

  {
    id: "evanflow_coder_overseer",
    title: "Coder / Overseer Split",
    intent: "Keep implementation and validation context isolated: coders edit bounded slices, overseers read only, and integration overseers validate shared touchpoints.",
    useWhen: "TDD, review, and parallel worker orchestration need safe independent implementation with fresh verification.",
    policyNeedles: ["coder/overseer", "integration overseer", "non-overlap checks"],
    contracts: [
      {
        stage: "plan",
        guidance: [
          "Executable packets name file ownership, shared interfaces, expected failing test, passing command, and stop conditions.",
          "Parallel writers are allowed only after non-overlap checks for files, shared interfaces, migrations/config, and baseline cleanliness."
        ],
        artifactSections: ["Task List", "Dependency Batches", "Execution Posture"]
      },
      {
        stage: "tdd",
        guidance: [
          "Coder edits only the assigned slice after RED evidence; read-only overseer validates spec fit and assertion quality.",
          "When 3+ independent packets run, use an integration overseer for named touchpoints and integration tests."
        ],
        artifactSections: ["Execution Posture", "Per-Slice Review", "Verification Ladder"]
      },
      {
        stage: "review",
        guidance: [
          "Layered reviewers reconcile findings by source tag, confidence, owner, and verification requirement.",
          "Do not accept implementer self-review as overseer evidence."
        ],
        artifactSections: ["Review Evidence Scope", "Review Findings Contract"]
      }
    ]
  },
  {
    id: "superpowers_executable_packet",
    title: "Executable Packet",
    intent: "Plan tasks as self-contained packets with acceptance mapping, expected RED failure, GREEN command, allowed files, and stop conditions.",
    useWhen: "Plan and TDD need work items a fresh agent can execute without hidden parent context.",
    policyNeedles: ["executable packet", "expected failing test", "stop condition"],
    contracts: [
      {
        stage: "plan",
        guidance: [
          "Each task is copy-paste ready for a worker and includes acceptance criteria, file boundaries, expected failing test, passing command, and stop conditions.",
          "Tasks that depend on shared interfaces or migration/config files are serialized unless an integration contract exists."
        ],
        artifactSections: ["Task List", "Dependency Batches", "Execution Posture"]
      },
      {
        stage: "tdd",
        guidance: [
          "Open one packet as one vertical slice; do not mix unrelated packet evidence.",
          "Close packet only when RED, GREEN, REFACTOR, and verification evidence align."
        ],
        artifactSections: ["Acceptance Mapping", "RED Evidence", "GREEN Evidence", "REFACTOR Notes"]
      }
    ]
  },
  {
    id: "gstack_question_tuning",
    title: "Question Tuning",
    intent: "Ask only decision-changing questions, auto-assume low-risk two-way doors, and stop on one-way-door decisions.",
    useWhen: "Brainstorm/scope/spec interactions could drift into broad interrogation instead of useful approval gates.",
    policyNeedles: ["one decision-changing question", "two-way door", "one-way door"],
    contracts: [
      {
        stage: "brainstorm",
        guidance: [
          "Ask one decision-changing question at a time and record impact only when it changes direction or blocks progress.",
          "Continue on low-risk defaults; stop on scope, architecture, security, data loss, public API, migration, auth/pricing, or approval uncertainty."
        ],
        artifactSections: ["Sharpening Questions", "Selected Direction"]
      },
      {
        stage: "scope",
        guidance: [
          "Present labeled scope moves with one recommendation; wait for user opt-in before treating a mode as selected.",
          "Record what signal would change the recommendation."
        ],
        artifactSections: ["Scope Mode", "Scope Contract"]
      },
      {
        stage: "spec",
        guidance: [
          "Chunk acceptance criteria for approval and stop on assumptions with irreversible impact.",
          "Rewrite vague criteria before asking the user to approve."
        ],
        artifactSections: ["Acceptance Criteria", "Assumptions Before Finalization", "Approval"]
      }
    ]
  },
  {
    id: "evanflow_vertical_slice_tdd",
    title: "Vertical-Slice TDD",
    intent: "Execute behavior end-to-end in one reviewable slice instead of collecting unrelated test or implementation fragments.",
    useWhen: "TDD and review need to prove a source item moved from RED to GREEN with traceable behavior evidence.",
    policyNeedles: ["vertical slice", "RED vertical slice", "slice victory detector"],
    contracts: [
      {
        stage: "tdd",
        guidance: [
          "One vertical slice is one source item plus one or more ACs, tests, implementation, refactor notes, and verification evidence.",
          "Do not open a second vertical slice while RED evidence or regression repair remains open for the current slice."
        ],
        artifactSections: ["Execution Posture", "RED Evidence", "GREEN Evidence", "Verification Ladder"]
      },
      {
        stage: "review",
        guidance: [
          "Review source-item coverage by vertical slice, not by file count alone.",
          "A slice is review-ready only when RED, GREEN, REFACTOR, and verification evidence all line up."
        ],
        artifactSections: ["Completeness Snapshot", "Coverage Check"]
      }
    ]
  },
  {
    id: "superclaude_confidence_gates",
    title: "Confidence Gates",
    intent: "Require source verification before execution and a fresh self-check before completion claims.",
    useWhen: "Stage work could proceed from memory, duplicate an existing implementation, or close with stale evidence.",
    policyNeedles: ["pre-execution confidence", "post-implementation self-check", "source verification"],
    contracts: [
      {
        stage: "design",
        guidance: [
          "Before locking architecture, verify duplicate implementation risk, architecture fit, docs/source truth, and root-cause confidence.",
          "If confidence is low, stop for investigation instead of adding fallback layers."
        ],
        artifactSections: ["Codebase Investigation", "Architecture Confidence"]
      },
      {
        stage: "review",
        guidance: [
          "Review requirements met, assumptions verified, tests passing, and evidence freshness before any PASS verdict.",
          "Separate verified facts from implementer claims."
        ],
        artifactSections: ["Review Readiness Snapshot", "Final Verdict"]
      }
    ]
  },
  {
    id: "oh_my_worker_lifecycle",
    title: "Worker Lifecycle Evidence",
    intent: "Make asynchronous or delegated work inspectable through state, dispatch, evidence refs, and stale-worker handling.",
    useWhen: "Stages schedule subagents, role-switch work, or generic dispatch and need auditable completion evidence.",
    policyNeedles: ["dispatch lifecycle", "stale worker", "strict worker JSON schema"],
    contracts: [
      {
        stage: "plan",
        guidance: [
          "Plan only bounded worker packets with clear file ownership, stop conditions, and evidence expectations.",
          "Name any dispatch or concurrency governor before workers start."
        ],
        artifactSections: ["Task List", "Dependency Batches", "Execution Posture"]
      },
      {
        stage: "tdd",
        guidance: [
          "Every scheduled worker needs a terminal return with evidence refs or an explicit blocker route.",
          "A stale worker blocks completion until resolved, failed, or structurally waived."
        ],
        artifactSections: ["Execution Posture", "Verification Ladder", "Per-Slice Review"]
      },
      {
        stage: "review",
        guidance: [
          "Synthesize reviewer returns by status, source tag, evidence refs, and unresolved blockers.",
          "Do not treat missing worker output as a clean review."
        ],
        artifactSections: ["Review Evidence Scope", "Review Findings Contract"]
      }
    ]
  },
  {
    id: "gsd_hard_stop_routing",
    title: "Hard-Stop Routing",
    intent: "Advance only when unresolved checkpoints, stale handoffs, and verification debt are cleared or routed explicitly.",
    useWhen: "A stage wants to continue despite missing gates, stale rewind markers, or uncertain next command state.",
    policyNeedles: ["hard-stop next routing", "goal-backward verification", "operator line"],
    contracts: [
      {
        stage: "tdd",
        guidance: [
          "Start from the outcome that must be true, then verify source, tests, artifact wiring, and gate evidence from that goal backward.",
          "If source/test preflight blocks execution, route to the managed blocker taxonomy instead of fabricating RED evidence."
        ],
        artifactSections: ["TDD Blocker Taxonomy", "Verification Ladder"]
      },
      {
        stage: "ship",
        guidance: [
          "Block ship on unresolved checkpoints, stale handoffs, or verification debt.",
          "Report the compact operator line: stage, scope, validation issues, recovery state, and next action."
        ],
        artifactSections: ["Preflight Results", "Completion Status", "Handoff"]
      }
    ]
  },
  {
    id: "everyinc_delegation_preflight",
    title: "Delegation Preflight",
    intent: "Use delegation only when support, consent, baseline, non-overlap, batch size, and fallback mode are known.",
    useWhen: "A controller is about to fan out implementation or review work across multiple specialists.",
    policyNeedles: ["delegation preflight", "non-overlapping files", "layered review synthesis"],
    contracts: [
      {
        stage: "plan",
        guidance: [
          "Before parallel writers, verify support, user consent when needed, baseline cleanliness, non-overlapping files, batch size, and fallback mode.",
          "Shared interfaces, migrations, config, and generated surfaces need an integration contract or serial execution."
        ],
        artifactSections: ["Dependency Batches", "Execution Posture"]
      },
      {
        stage: "review",
        guidance: [
          "Dedupe layered reviewer findings with confidence, owner, and verification requirement.",
          "Keep user-facing synthesis separate from raw worker returns."
        ],
        artifactSections: ["Layered Review Synthesis", "Review Findings Contract"]
      }
    ]
  },
  {
    id: "ecc_worktree_control_plane",
    title: "Worktree Control Plane",
    intent: "Treat isolated worker state, handoff files, and orchestration snapshots as recoverable control-plane data rather than chat memory.",
    useWhen: "Parallel or resumable work needs clear seed paths, state files, handoffs, and cleanup visibility.",
    policyNeedles: ["worktree control plane", "handoff files", "orchestration snapshot"],
    contracts: [
      {
        stage: "plan",
        guidance: [
          "Name seed paths, worker handoff expectations, and integration touchpoints before isolated work begins.",
          "Cap ad-hoc teams and require agreement/conflict synthesis for any multi-agent result."
        ],
        artifactSections: ["Task List", "Dependency Batches", "Execution Posture"]
      },
      {
        stage: "ship",
        guidance: [
          "Confirm handoffs, cleanup, and orchestration state are captured before archive or closeout.",
          "Do not rely on chat transcript alone for recoverability."
        ],
        artifactSections: ["Handoff", "Completion Status"]
      }
    ]
  },
  {
    id: "walkinglabs_victory_detector",
    title: "Iterate / Victory Detector",
    intent: "Iterate while evidence is missing; stop only when the stage-specific victory detector is satisfied or a real blocker is named.",
    useWhen: "Content-only closeout wording for review and ship readiness.",
    policyNeedles: ["Victory Detector", "iterate until evidence", "fresh evidence"],
    contracts: [
      {
        stage: "review",
        guidance: [
          "Victory Detector: Layer 1, Layer 2, security sweep, structured findings, and acceptance/reproduction coverage evidence are complete with no unresolved criticals unless verdict is BLOCKED.",
          "If the detector fails, iterate findings or route back to TDD; do not say LGTM."
        ],
        artifactSections: ["Review Readiness Snapshot", "Final Verdict"]
      },
      {
        stage: "ship",
        guidance: [
          "Victory Detector: valid review verdict, fresh preflight, rollback trigger/steps, selected finalization enum, and execution result are present.",
          "If any detector field is stale or missing, keep status BLOCKED."
        ],
        artifactSections: ["Preflight Results", "Rollback Plan", "Finalization", "Completion Status"]
      }
    ]
  }
];

export function referencePatternsForStage(stage: FlowStage): ReferencePattern[] {
  return REFERENCE_PATTERNS.filter((pattern) =>
    pattern.contracts.some((contract) => contract.stage === stage)
  );
}

export function referencePatternContractsForStage(stage: FlowStage): ReferencePatternContract[] {
  return REFERENCE_PATTERNS.flatMap((pattern) =>
    pattern.contracts
      .filter((contract) => contract.stage === stage)
      .map((contract) => ({
        ...contract,
        guidance: [...contract.guidance],
        artifactSections: [...contract.artifactSections]
      }))
  );
}

export function referencePatternPolicyNeedles(stage: FlowStage): string[] {
  const needles: string[] = [];
  const seen = new Set<string>();
  for (const pattern of referencePatternsForStage(stage)) {
    for (const needle of pattern.policyNeedles) {
      if (seen.has(needle)) continue;
      seen.add(needle);
      needles.push(needle);
    }
  }
  return needles;
}
