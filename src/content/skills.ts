import { RUNTIME_ROOT, STAGE_TO_SKILL_FOLDER } from "../constants.js";
import { nextStage as nextStageForTrack } from "../flow-state.js";
import { FLOW_STAGES, type FlowStage, type FlowTrack } from "../types.js";
import { behaviorAnchorFor, stageExamples } from "./examples.js";
import { INVESTIGATION_DISCIPLINE_BLOCK } from "./templates.js";
import { reviewStackAwareRoutes, reviewStackAwareRoutingSummary, stageAutoSubagentDispatch, stageSchema, stageTrackRenderContext } from "./stage-schema.js";
import { renderTrackTerminology } from "./track-render-context.js";
import type { StageSchema } from "./stage-schema.js";
import { referencePatternsForStage } from "./reference-patterns.js";
import { harnessDelegationRecipes } from "../harness-adapters.js";
import type {
  ArtifactValidation,
  CrossStageTrace,
  ReviewSection,
  StageExecutionModel,
  StagePhilosophy,
  StageReviewLoop
} from "./stages/schema-types.js";

const VERIFICATION_STAGES: FlowStage[] = ["tdd", "review", "ship"];
const STAGE_LANGUAGE_POLICY_POINTER =
  "> Language policy: see `using-cclaw` section `Conversation Language Policy`.";

// ---------- Cross-cutting universal mechanics (Layer 2 building blocks) ----------
//
// These are shared, structural blocks that get injected into every stage skill.
// They check structural shape, not domain content. Each has a matching linter
// rule in `src/artifact-linter.ts` so artifacts can fail when shape is missing.

export const FORBIDDEN_SYCOPHANCY_PHRASES = [
  "you're absolutely right",
  "great point",
  "absolutely!",
  "thanks for catching",
  "thanks for the great",
  "good catch",
  "love this",
  "nailed it"
];

export const FORBIDDEN_PLACEHOLDER_TOKENS = [
  "TBD",
  "TODO",
  "FIXME",
  "implement later",
  "similar to Task",
  "add appropriate error handling",
  "add proper logging",
  "fill this in",
  "<placeholder>"
];

export const CONFIDENCE_FINDING_REGEX_SOURCE =
  "\\[P[123]\\]\\s*\\(confidence:\\s*\\d{1,2}/10\\)\\s+[^\\s]+(?::\\d+)?\\s+—";

export function stopPerIssueBlock(): string {
  return `## STOP-per-issue Protocol

After each critical section (premise / alternatives / mode pick / each review finding), STOP and record one decision marker before continuing:

- \`Q<n>:\` — issue or open question
- \`decision:\` — \`accept\` / \`reject\` / \`defer\` / \`skip — no issues\`
- \`rationale:\` — one line, evidence-backed

Do not batch decisions. Do not silently move on. The artifact MUST contain at least one \`decision:\` marker per critical section.
`;
}

export function confidenceCalibrationBlock(): string {
  return `## Confidence Calibration

Findings, recommendations, and review notes use the calibrated finding format:

\`[P1|P2|P3] (confidence: <n>/10) <repo-relative-path>[:<line>] — <one-line description>\`

- \`P1\` blocks merge; \`P2\` should be addressed; \`P3\` is nice-to-have.
- Confidence \`< 7\` — suppress unless severity is \`P1\`.
- "What evidence would change this?" — every finding must answer it inline or in the next bullet.
- Never assert "this is fine" without confidence; never assert confidence above \`8\` without a cited artifact, line, or test.
`;
}

export function outsideVoiceSlotBlock(): string {
  return `## Outside Voice Slot (optional)

Reserve a section titled \`## Outside Voice\` (or \`## Outside Voice — <model/critic>\`) for a second-model or fresh-context critic perspective when used. Required shape when present:

- \`source:\` — model id, critic agent name, or human reviewer handle
- \`prompt:\` — exact frame sent (or reference to \`docs/quality-gates.md\` recipe)
- \`tension:\` — at least one disagreement with the main draft, or \`none — converged\`
- \`resolution:\` — accepted / rejected / merged / deferred + one-line rationale

Empty when not used; do not fabricate an outside voice.
`;
}

export function antiSycophancyBlock(): string {
  const phrases = FORBIDDEN_SYCOPHANCY_PHRASES.map((p) => `\`${p}\``).join(", ");
  return `## Anti-sycophancy

Forbidden response openers when receiving review, critic output, or user feedback: ${phrases}.

Replace agreement theater with one of:

- \`Verified — <evidence>\` (you actually checked)
- \`Disagree — <reason>\` (you push back with substance)
- \`Investigating — <next step>\` (you do not yet know)

Never agree before reading the cited evidence. Never apologize for asking a clarifying question.
`;
}

export function noPlaceholdersBlock(): string {
  const tokens = FORBIDDEN_PLACEHOLDER_TOKENS.map((p) => `\`${p}\``).join(", ");
  return `## NO PLACEHOLDERS Rule

Plans, specs, designs, and review artifacts MUST NOT contain placeholder tokens: ${tokens}. Use repo-relative paths and concrete commands; if a value is genuinely unknown, write the open question explicitly with a \`Q<n>:\` marker and a \`decision: defer — <reason>\` row instead of inserting a placeholder token.
`;
}

export function watchedFailProofBlock(): string {
  return `## Watched-fail Proof

Any "the failure is real" claim (failing test, broken build, regression catch, deployment fail) MUST include a watched-fail proof line in the artifact:

\`proof: <iso-ts> | <observed snippet — first 200 chars> | source: <command or log path>\`

For TDD, watched-RED proof is mandatory before \`stage-complete\` accepts the slice. Dispatch \`slice-builder\` end-to-end: it owns RED/GREEN evidence rows, refactor coverage per the hook flags, \`<artifacts-dir>/tdd-slices/S-<id>.md\`, and (when wired) \`slice-completed\`. The linter mirrors phase history into auto-render markers in \`06-tdd.md\` — never hand-fill those fragments.
`;
}

/**
 * Stages that perform real investigation work. The shared
 * `INVESTIGATION_DISCIPLINE_BLOCK` is rendered once per stage skill in this
 * set so the search → graph → narrow-read → draft ladder appears verbatim
 * across the elicitation/spec/plan/tdd/review pipeline. `ship` is excluded:
 * it consumes the upstream trace rather than producing one.
 */
export const INVESTIGATION_DISCIPLINE_STAGES: ReadonlySet<FlowStage> = new Set<FlowStage>([
  "brainstorm",
  "scope",
  "design",
  "spec",
  "plan",
  "tdd",
  "review"
]);

export function investigationDisciplineBlock(): string {
  return INVESTIGATION_DISCIPLINE_BLOCK;
}

export function behaviorAnchorBlock(stage: FlowStage): string {
  const anchor = behaviorAnchorFor(stage);
  if (!anchor) return "";
  const ruleHint = anchor.ruleHint && anchor.ruleHint.trim().length > 0
    ? `\n\nRule hint: ${anchor.ruleHint.trim()}`
    : "";
  return `## Behavior anchor

Anchored to artifact section: \`${anchor.section}\`.

- Bad: ${anchor.bad}
- Good: ${anchor.good}${ruleHint}
`;
}

function crossCuttingMechanicsBlock(stage: FlowStage): string {
  // All stages share the universal mechanics, but each stage's matching
  // linter rules decide what is mandatory vs. structural-only.
  const blocks: string[] = [
    stopPerIssueBlock(),
    confidenceCalibrationBlock(),
    outsideVoiceSlotBlock(),
    antiSycophancyBlock(),
    noPlaceholdersBlock()
  ];
  if (stage === "tdd" || stage === "review" || stage === "ship") {
    blocks.push(watchedFailProofBlock());
  }
  if (INVESTIGATION_DISCIPLINE_STAGES.has(stage)) {
    blocks.push(investigationDisciplineBlock());
  }
  const anchor = behaviorAnchorBlock(stage);
  if (anchor.length > 0) {
    blocks.push(anchor);
  }
  return blocks.join("\n");
}

function whenNotToUseBlock(items: string[]): string {
  if (items.length === 0) {
    return "";
  }
  return `## When Not to Use
${items.map((item) => `- ${item}`).join("\n")}

`;
}

/**
 * TDD-only prelude after `<EXTREMELY-IMPORTANT>`: wave routing + canonical
 * `slice-builder` dispatch. Uses literal commands so pattern-matching on read
 * matches operator scripts.
 *
 * Empty for non-TDD stages.
 */
export function tddTopOfSkillBlock(stage: FlowStage): string {
  if (stage !== "tdd") return "";
  return `## TDD orchestration primer

**MANDATE — controller never implements.** In TDD the controller plans, dispatches, and reconciles. **NEVER edit production code, tests, or run cargo/npm/pytest yourself in the controller chat.** Every slice's RED → GREEN → REFACTOR → DOC cycle MUST happen inside an isolated \`slice-builder\` span dispatched via the harness Task tool. Inline code edits in the controller chat are a protocol violation that defeats parallelism, evidence isolation, and the audit ledger.

**Step 1 — Wave status (always first):**
\`node .cclaw/cli.mjs internal wave-status --json\`

The output names: \`waves[]\` (closed/open), \`nextDispatch.waveId\`, \`nextDispatch.mode\` (\`wave-fanout\` or \`single-slice\`), \`nextDispatch.readyToDispatch\` (slice ids), and \`nextDispatch.pathConflicts\` (overlapping \`claimedPaths\` between members).

**Step 2 — Decide automatically (no user question when paths disjoint):**

| \`mode\`         | \`pathConflicts\` | Action                                                                                                                                  |
|------------------|-------------------|-----------------------------------------------------------------------------------------------------------------------------------------|
| \`wave-fanout\`  | \`[]\`            | **Fan out the entire wave in one tool batch.** Emit one \`Task\` per ready slice in a single controller message. Do NOT ask the user.   |
| \`wave-fanout\`  | non-empty         | Issue exactly one AskQuestion (resolve the overlap, drop the conflicting slice, or downgrade to single-slice for the disputed member).  |
| \`single-slice\` | —                 | One \`Task\` for the next ready slice.                                                                                                  |

**Step 3 — Dispatch protocol per slice:** in the SAME controller message that issues the \`Task\` call:

1. Append \`delegation-record --status=scheduled\` for the \`slice-builder\` span (one row per slice; reuse the same \`spanId\` across the entire RED → GREEN → REFACTOR → DOC lifecycle).
2. Append \`delegation-record --status=launched\` immediately after.
3. Issue the harness Task call: \`Task(subagent_type=<harness slice-builder mapping>, description="slice-builder <slice-id>", prompt="<full slice context, claimedPaths, plan-row, AC ids, paths to source/tests, slice-card path>")\`.
4. The slice-builder span ACKs locally (\`delegation-record --status=acknowledged\`) and runs the **complete** RED → GREEN → REFACTOR → DOC cycle inside the span — including writing \`tdd-slices/S-<id>.md\` and emitting \`--phase=red\`, \`--phase=green\`, \`--phase=refactor\` (or \`--phase=refactor-deferred\` with rationale), and \`--phase=doc\` rows on its own.
5. The controller waits for ALL parallel spans to terminate before reconciling. Do not page back into the controller chat between spans.

**Step 4 — Wave closeout:** after all in-flight slices report \`completed\`:

1. Re-run \`wave-status --json\`. Confirm the wave is \`closed\` and the next dispatch is the following wave (or \`closeout\`).
2. If \`integrationCheckRequired\` is true, dispatch \`integration-overseer\` (proactive) and append the \`cclaw_integration_overseer_skipped\` audit kind only when the contract waives it.
3. If \`wave-status\` reports another \`wave-fanout\` next dispatch with disjoint paths, **immediately repeat Step 2 — do not pause for \"continue\"**.
4. When all waves are closed and no more slices remain ready, run \`stage-complete tdd\`.

**Step 5 — Auto-advance after stage-complete:** when \`stage-complete\` returns \`ok\` with a new \`currentStage\`, immediately load the next stage skill and continue. The user does NOT need to retype \`/cc\`. Announce \"Stage tdd complete → entering <next>. Continuing.\" and proceed.

Wave resume: reuse \`wave-status\` outputs and parallelize unfinished members instead of restarting finished slices.

---
`;
}

/**
 * Review-only prelude: mandates parallel reviewer / security-reviewer dispatch
 * via harness Task and forbids inline authoring of findings.
 *
 * Empty for non-review stages.
 */
export function reviewTopOfSkillBlock(stage: FlowStage): string {
  if (stage !== "review") return "";
  return `## Review orchestration primer

**MANDATE — controller never authors findings inline.** In review the controller orchestrates; \`reviewer\` (functional/spec/correctness/architecture/perf/observability) and \`security-reviewer\` (security sweep + dependency/version audit) are the **mandatory delegated workers** that produce findings, lens coverage, and the verdict input. Typing \`## Layer 1 Findings\`, \`## Layer 2 Findings\`, \`## Lens Coverage\`, or \`## Final Verdict\` content directly into \`07-review.md\` in the controller chat is a protocol violation. The controller writes ONLY the reconciled multi-specialist verdict block AFTER all reviewer Tasks return.

**Step 1 — Diff scope (always first):**
\`git diff --stat <base>...HEAD\` and \`git diff --name-only <base>...HEAD\`.
If the diff is empty, exit early with APPROVED (no changes to review).

**Step 2 — Dispatch the review army in PARALLEL (single controller message):**

| Lens                     | Worker                | Mandatory? |
|--------------------------|-----------------------|------------|
| Spec compliance / Layer 1 | \`reviewer\`         | yes        |
| Layer 2 cross-slice / correctness / observability | \`reviewer\` | yes |
| Security sweep + dep/version audit | \`security-reviewer\` | yes (or \`NO_SECURITY_IMPACT\` attestation) |
| Adversarial second opinion | \`reviewer\` (adversarial framing) | only if trust boundaries moved OR diff is large+high-risk |

Emit ONE \`Task\` per lens in a single controller message. For each lens:

1. Append \`delegation-record --status=scheduled\` for the lens span (one row per lens; reuse the same \`spanId\` for the lens lifecycle).
2. Append \`delegation-record --status=launched\` immediately after.
3. Issue the harness Task call: \`Task(subagent_type=<harness reviewer/security-reviewer mapping>, description="<lens> review", prompt="<diff range, files, AC ids, upstream artifacts (spec, design, tdd Per-Slice Reviews), expected output schema for 07-review-army.json>")\`.
4. The reviewer span ACKs locally and writes its findings/lens coverage to \`07-review-army.json\` (and the structured findings table in \`07-review.md\`) on its own — including \`NO_SECURITY_IMPACT\` rationale if a security pass yields zero findings.
5. The controller waits for ALL lens spans to return before reconciling.

**Step 3 — Reconcile and verdict:** after all lens spans complete:

1. Run \`validateReviewArmy\` (helper or linter) on \`07-review-army.json\`.
2. Dedup by fingerprint, mark multi-specialist confirmations.
3. Confirm acceptance criteria coverage and Pre-Critic / Lens Coverage / Anti-sycophancy fields are present (linter requires them).
4. Compute the final verdict: APPROVED, APPROVED_WITH_CONCERNS, or BLOCKED.
5. If BLOCKED, emit \`ROUTE_BACK_TO_TDD\` with the blocking finding ids and the managed \`npx cclaw-cli internal rewind tdd\` command. Do NOT silently stop.

**Step 4 — Auto-advance after stage-complete:** when \`stage-complete review\` returns \`ok\` with a new \`currentStage\` (typically \`ship\`), immediately load the next stage skill and continue. Announce \"Stage review complete → entering <next>. Continuing.\" and proceed without waiting for the user to retype \`/cc\`.

---
`;
}


function artifactTemplatePathForStage(stage: FlowStage): string {
  const stageIndex = FLOW_STAGES.indexOf(stage) + 1;
  const stageNumber = String(stageIndex).padStart(2, "0");
  return `${RUNTIME_ROOT}/templates/${stageNumber}-${stage}.md`;
}

function contextLoadingBlock(
  stage: FlowStage,
  trace: CrossStageTrace,
  executionModel: StageExecutionModel
): string {
  const readLines = trace.readsFrom.length > 0
    ? trace.readsFrom.map((value) => `- \`${value}\``).join("\n")
    : "- (first stage — no upstream artifacts)";
  const inputs = executionModel.inputs.length > 0
    ? executionModel.inputs.map((item) => `- ${item}`).join("\n")
    : "- (first stage — no required inputs)";
  const requiredContext = executionModel.requiredContext.length > 0
    ? executionModel.requiredContext.map((item) => `- ${item}`).join("\n")
    : "- None beyond this skill";
  const artifactTemplatePath = artifactTemplatePathForStage(stage);

  return `## Context Loading

Before execution:
1. Read \`.cclaw/state/flow-state.json\`.
   - If the file is missing, do **not** invent an active run — this is normal for fresh init. Route to \`/cc <idea>\` first.
2. Load active artifacts from \`.cclaw/artifacts/\`.
3. Load upstream artifacts required by this stage:
${readLines}
4. Read the state contract from \`.cclaw/templates/state-contracts/<stage>.json\` for required fields, taxonomies, and derived markdown path.
5. Read the canonical artifact template at \`${artifactTemplatePath}\` to preserve heading/per-row tables contracts (stable section names and column order) plus calibrated review block scaffolding. Preserve existing substantive bullets/rows already in the artifact; never overwrite the artifact wholesale from the template — patch only sections you author this turn.
6. Extract upstream decisions, constraints, and open questions into the current artifact's \`Upstream Handoff\` section when present.
7. Confirm context readiness: upstream artifact freshness, required context, canonical template shape, relevant in-repo/reference patterns, and unresolved blockers are known. If any item is missing, load it or stop before drafting.
8. Before doing stage work, give a compact user-facing drift preamble: "Carrying forward: <1-3 bullets>. Drift since upstream: None / <specific drift>. Recommendation: continue / re-scope."
9. If you change an upstream decision, record an explicit drift reason in the current artifact before continuing.
10. Confirm stage inputs:
${inputs}
11. Confirm required context:
${requiredContext}
12. Use the injected knowledge digest; only fall back to full \`.cclaw/knowledge.jsonl\` when insufficient.
`;
}

function autoSubagentDispatchBlock(stage: FlowStage, track: FlowTrack): string {
  const rules = stageAutoSubagentDispatch(stage);
  if (rules.length === 0) return "";

  const schema = stageSchema(stage, track);
  const rows = rules
    .map((rule) => {
      const userGate = rule.requiresUserGate ? "required" : "not required";
      const dispatchClass = rule.dispatchClass ?? "stage-specialist";
      const returnSchema = rule.returnSchema ?? "agent-default";
      const runPhase = rule.runPhase ?? "any";
      return `| ${rule.agent} | ${rule.mode} | ${runPhase} | ${dispatchClass} | ${returnSchema} | ${userGate} | ${rule.when} | ${rule.purpose} |`;
    })
    .join("\n");
  const mandatory = schema.mandatoryDelegations;
  const mandatoryList = mandatory.length > 0 ? mandatory.map((a) => `\`${a}\``).join(", ") : "none";
  const delegationLogRel = `${RUNTIME_ROOT}/state/delegation-log.json`;
  const delegationEventsRel = `${RUNTIME_ROOT}/state/delegation-events.jsonl`;
  const hasPostElicitation = rules.some((rule) => rule.runPhase === "post-elicitation");
  const runPhaseLegend = hasPostElicitation
    ? `\nRun Phase legend: \`post-elicitation\` = run only AFTER the adaptive elicitation Q&A loop converges (forcing questions answered/skipped/waived OR user stop-signal recorded). \`pre-elicitation\` = run before any user dialogue (rare). \`any\` = no ordering constraint.`
    : "";
  return `## Automatic Subagent Dispatch
| Agent | Mode | Run Phase | Class | Return Schema | User Gate | Trigger | Purpose |
|---|---|---|---|---|---|---|---|
${rows}
Mandatory: ${mandatoryList}. Record lifecycle rows in \`${delegationLogRel}\` and append-only \`${delegationEventsRel}\` before completion.${runPhaseLegend}
### Harness Dispatch Contract — use true harness dispatch: Claude Task, Cursor generic dispatch, OpenCode \`.opencode/agents/<agent>.md\` via Task/@agent, Codex \`.codex/agents/<agent>.toml\`. Do not collapse OpenCode or Codex to role-switch by default. Worker ACK Contract: ACK must include \`spanId\`, \`dispatchId\`, \`dispatchSurface\`, \`agentDefinitionPath\`, and \`ackTs\`; never claim \`fulfillmentMode: "isolated"\` without matching lifecycle proof. Canonical helper (same flags as \`delegation-record.mjs --help\`): \`node .cclaw/hooks/delegation-record.mjs --stage=<stage> --agent=<agent> --mode=<mandatory|proactive> --status=<scheduled|launched|acknowledged|completed|...> --span-id=<id> --dispatch-id=<id> --dispatch-surface=<surface> --agent-definition-path=<path> [--ack-ts=<iso>] [--evidence-ref=<ref>] --json\`. Lifecycle order: \`scheduled → launched → acknowledged → completed\` on one span (reuse the same span id); completed isolated/generic rows require a prior ACK event for that span or \`--ack-ts=<iso>\`. For a partial audit trail, \`--repair --span-id=<id> --repair-reason="<why>"\` appends missing phases (see \`--help\`) instead of inventing shortcuts.

If you must re-dispatch the same agent in the same stage before the previous span has a terminal row, pass \`--supersede=<prevSpanId>\` (closes the previous span as \`stale\` with \`supersededBy=<newSpanId>\`) or \`--allow-parallel\` (records both spans as concurrently active and tags the new row with \`allowParallel: true\`). Without one of those flags, a duplicate scheduled write on the same \`(stage, agent)\` pair fails with \`exit 2\` and \`{ ok: false, error: "dispatch_duplicate" }\`. Lifecycle timestamps are also validated: \`startTs ≤ launchedTs ≤ ackTs ≤ completedTs\` and per-span \`ts\` is non-decreasing — non-monotonic values fail with \`exit 2\` and \`{ ok: false, error: "delegation_timestamp_non_monotonic" }\`.

${perHarnessLifecycleRecipeBlock()}`;
}

function perHarnessLifecycleRecipeBlock(): string {
  const recipes = harnessDelegationRecipes();
  const rows = recipes
    .map((recipe) => `| \`${recipe.harnessId}\` | \`${recipe.dispatchSurface}\` | \`${recipe.agentDefinitionExample}\` | \`${recipe.fulfillmentMode}\` |`)
    .join("\n");
  return `### Per-Harness Lifecycle Recipe — placeholders only
Reuse the same \`<span-id>\` and \`<dispatch-id>\` across scheduled -> launched -> acknowledged -> completed; substitute neutral tokens \`<agent-name>\`, \`<stage>\`, \`<iso-ts>\`, \`<artifact-anchor>\`. Full command sequences live in \`docs/harnesses.md\`.
| Harness | Dispatch surface | Agent definition path | fulfillmentMode |
|---|---|---|---|
${rows}
`;
}

function researchPlaybooksBlock(playbooks: string[]): string {
  if (playbooks.length === 0) return "";
  const rows = playbooks
    .map((playbook) => `\`${RUNTIME_ROOT}/skills/${playbook}\``)
    .join("; ");
  return `## Research Playbooks
Execute in primary agent context before locking the stage; record outcomes in the artifact when relevant: ${rows}.
`;
}
function referencePatternsBlock(stage: FlowStage): string {
  const patterns = referencePatternsForStage(stage);
  if (patterns.length === 0) return "";
  const summaries = patterns
    .map((pattern) => {
      const contract = pattern.contracts.find((item) => item.stage === stage);
      const sections = contract ? contract.artifactSections.join(", ") : "n/a";
      return `${pattern.title} (sections: ${sections})`;
    })
    .join("; ");
  return `## Reference Patterns
Prompt-only; no runtime/delegation changes. These compact pattern titles come from the internal registry; use the behavior and artifact sections, not the source project history. Use: ${summaries}.
`;
}


function reviewSectionsBlock(sectionsInput: ReviewSection[]): string {
  if (sectionsInput.length === 0) return "";
  const sections = sectionsInput
    .map((sec) => {
      const points = sec.evaluationPoints.map((p) => `- ${p}`).join("\n");
      const title = sec.stopGate ? `${sec.title} (STOP gate)` : sec.title;
      return `### ${title}\n${points}`;
    })
    .join("\n\n");

  return `## Review Sections

${sections}
`;
}

function stackAwareReviewRoutingBlock(stage: FlowStage): string {
  if (stage !== "review") return "";
  const routes = reviewStackAwareRoutes()
    .map((route) => `- ${route.stack}: ${route.signals.map((signal) => `\`${signal}\``).join(", ")} -> ${route.agent} lens for ${route.focus}.`)
    .join("\n");
  return `## Stack-Aware Review Routing
${reviewStackAwareRoutingSummary()}

Default general review still runs. Add only the matching stack lens when repo signals or changed files justify it.

${routes}
`;
}

function reviewLoopBlock(reviewLoop?: StageReviewLoop): string {
  if (!reviewLoop) return "";
  const checklist = reviewLoop.checklist.map((item) => `- \`${item}\``).join("\n");
  return `## Outside Voice Review Loop
- Stage: \`${reviewLoop.stage}\`
- Target score: \`${reviewLoop.targetScore}\`
- Max iterations: \`${reviewLoop.maxIterations}\`
- Checklist dimensions:
${checklist}
`;
}

function verificationBlock(stage: FlowStage): string {
  if (!VERIFICATION_STAGES.includes(stage)) return "";
  return `## Verification Before Completion

This is the gate function for completion claims. No "done", "all good", or
"tests pass" unless fresh evidence from this turn proves it.

- Run verification commands (tests/build/lint/type-check) for the changed scope.
- Before \`tdd -> review\` and \`review -> ship\`, discover the real test command
  from repo config (package scripts, pytest/go/cargo/maven/gradle signals) and
  cite that exact command in the gate evidence.
- Confirm output directly; do not infer success from prior runs or green memories.
- If this is a bug fix, capture RED -> GREEN evidence for the regression path.
- If a command fails, report the failure as diagnostic evidence and stop before completion.
- If you only inspected files or reasoned about the change, say so; that is not verification.

Keep this verification evidence in the artifact before completion.
`;
}

function batchExecutionModeBlock(stage: FlowStage, track: FlowTrack): string {
  const schema = stageSchema(stage, track);
  if (!schema.batchExecutionAllowed) return "";
  const orderingGuidance = track === "quick"
    ? "Use spec acceptance items / bug reproduction slices for ordering."
    : "Use plan slices for ordering.";

  return `## Batch Execution Mode

Execute the current dependency batch task-by-task (RED -> GREEN -> REFACTOR).
Stop on BLOCKED status or when user input is required.
Apply concise turn announces: one announce per batch boundary (or when risk/source
changes materially), then execute tasks without repetitive boilerplate.

Detailed walkthrough:
${orderingGuidance} Keep RED -> GREEN -> REFACTOR evidence in the TDD artifact.
`;
}

function crossStageTraceBlock(trace: CrossStageTrace): string {
  const reads = trace.readsFrom.length > 0
    ? trace.readsFrom.map((r) => `- ${r}`).join("\n")
    : "- (first stage — no upstream artifacts)";
  const writes = trace.writesTo.length > 0
    ? trace.writesTo.map((w) => `- ${w}`).join("\n")
    : "- (terminal stage)";

  return `## Cross-Stage Traceability

Reads from:
${reads}

Writes to:
${writes}

Rule: ${trace.traceabilityRule}
`;
}

function artifactValidationBlock(validations: ArtifactValidation[]): string {
  if (validations.length === 0) return "";
  const rows = validations
    .map((v) => {
      const req = v.required ? "REQUIRED" : "recommended";
      return `| ${v.section} | ${req} | ${v.validationRule} |`;
    })
    .join("\n");
  return `## Artifact Validation

| Section | Tier | Validation rule |
|---|---|---|
${rows}
`;
}

function mergedAntiPatterns(philosophy: StagePhilosophy, execution: StageExecutionModel): string {
  const merged: string[] = [];
  const seen = new Set<string>();
  for (const item of [...philosophy.commonRationalizations, ...execution.blockers]) {
    const key = item.trim().toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(item);
  }
  return merged.map((item) => `- ${item}`).join("\n");
}

function completionParametersBlock(schema: StageSchema, track: FlowTrack): string {
  const gateList = schema.executionModel.requiredGates.map((g) => `\`${g.id}\``).join(", ");
  // Mandatory agents are dropped on `quick` track. Surface
  // the empty list so the rendered SKILL.md doesn't tell quick-track runs to
  // dispatch agents the linter is going to skip.
  const trackAwareMandatoryAgents = track === "quick" ? [] : schema.reviewLens.mandatoryDelegations;
  const mandatoryAgents = trackAwareMandatoryAgents;
  const mandatory = trackAwareMandatoryAgents.length > 0
    ? trackAwareMandatoryAgents.map((a) => `\`${a}\``).join(", ")
    : track === "quick" && schema.reviewLens.mandatoryDelegations.length > 0
      ? "none (skipped: quick track)"
      : "none";
  const resolvedNextStage = nextStageForTrack(schema.stage, track);
  const nextStage = resolvedNextStage ?? "done";
  const nextDescription = nextStage === "done"
    ? "flow complete"
    : stageSchema(nextStage, track).skillDescription;

  return `### Completion Parameters

- \`stage\`: \`${schema.stage}\`
- \`next\`: \`${nextStage}\` (${nextDescription})
- \`gates\`: ${gateList}
- \`artifact\`: \`${RUNTIME_ROOT}/artifacts/${schema.artifactRules.artifactFile}\`
- \`mandatory delegations\`: ${mandatory}
- \`completion helper\`: \`node .cclaw/hooks/stage-complete.mjs ${schema.stage}\`
- \`completion helper with evidence\`: \`node .cclaw/hooks/stage-complete.mjs ${schema.stage} --evidence-json '{"<gate_id>":"<evidence note>"}' --passed=<gate_id>[,<gate_id>]\`
- \`completion helper JSON diagnostics\`: append \`--json\` to receive a machine-readable validation failure summary.
- \`delegation lifecycle proof\`: use the delegation helper recipe in this section with explicit lifecycle rows: \`--status=scheduled\` -> \`--status=launched\` -> \`--status=acknowledged\` -> \`--status=completed\` (completed isolated/generic requires prior ACK for the same span or \`--ack-ts=<iso>\`).
- Fill \`## Learnings\` before closeout: either \`- None this stage.\` or JSON bullets with required keys \`type\`, \`trigger\`, \`action\`, \`confidence\` (knowledge-schema compatible).
- If you edit any completed-stage artifact after it shipped (\`completedStageMeta\` timestamps exist), append a short \`## Amendments\` section with dated bullets (timestamp + reason) instead of overwriting the archived narrative silently — advisory linter rule \`stage_artifact_post_closure_mutation\` enforces visibility when this trail is missing.
- Record mandatory delegation lifecycle in \`${RUNTIME_ROOT}/state/delegation-log.json\` and append proof events to \`${RUNTIME_ROOT}/state/delegation-events.jsonl\`; the ledger is current state, the event log is audit proof.${mandatoryAgents.length > 0 ? ` If a mandatory delegation cannot run in this harness, use \`--waive-delegation=${mandatoryAgents.join(",")} --waiver-reason="<why safe>"\` on the completion helper.` : ""} If proactive delegations were intentionally skipped, first issue a short-lived waiver token with \`cclaw-cli internal waiver-grant --stage <stage> --reason "<short-slug>"\`, then rerun the completion helper with \`--accept-proactive-waiver=<token> --accept-proactive-waiver-reason="<why safe>"\` after explicit user approval. Tokens expire in 30 minutes and are single-use; bare \`--accept-proactive-waiver\` is no longer accepted.
- Never edit raw \`flow-state.json\` to complete a stage, even in advisory mode; that bypasses validation, gate evidence, and Learnings harvest. If a helper fails, report a one-line human-readable failure plus fenced JSON diagnostics; never echo the invoking command line or apply a manual state workaround.
- Stage completion claim requires \`stage-complete\` exit 0 in the current turn. Quote the single-line success JSON exactly as printed to stdout (for example \`{"ok":true,"command":"stage-complete",...}\` including \`completedStages\` / \`currentStage\` / \`runId\`); do not paraphrase. Do not infer success from empty stdout or from skipped retries (quiet mode always emits one JSON line on success).
- Completion protocol: verify required gates, update the artifact, then use the completion helper with \`--evidence-json\` and \`--passed\` for every satisfied gate.
`;
}

function delegationAndCompletionBlock(schema: StageSchema, track: FlowTrack): string {
  const dispatchBlock = autoSubagentDispatchBlock(schema.stage, track).trim();
  const completionBlock = completionParametersBlock(schema, track).trim();
  const normalizedDispatch = dispatchBlock.length > 0
    ? dispatchBlock.replace(/^## Automatic Subagent Dispatch/mu, "### Automatic Subagent Dispatch")
    : "### Automatic Subagent Dispatch\nNo automatic subagent dispatch rules for this stage.";

  return `## Delegation & Completion

${normalizedDispatch}

${completionBlock}

### Stage Closure (harness-only UX)

- **NEVER paste the \`stage-complete.mjs\` command line into chat.** The user does not run cclaw manually; seeing \`node .cclaw/hooks/stage-complete.mjs ... --evidence-json '{...}' --waive-delegation=...\` is noise. Run the helper via the tool layer; report only the resulting summary.
- **NEVER paste the \`--evidence-json\` payload into chat.** It is structured data for the helper, not for the user. The same evidence already lives in the artifact section.
- On failure, report a compact human-readable summary based on the helper's JSON \`findings\` array — list failing section names only (one line each), include the full helper JSON in a single fenced \`json\` block. Do not echo the invoking command.
- **NEVER run shell hash commands** (\`shasum\`, \`sha256sum\`, \`md5sum\`, \`Get-FileHash\`, \`certutil\`, etc.) for hash compute. If the linter ever asks for a hash, that is a linter bug — report failure and stop, do not auto-fix in bash.
- The helper defaults to quiet (\`CCLAW_STAGE_COMPLETE_QUIET=1\`): no pretty-printed chatter, but **stdout still prints exactly one line** of machine-readable success JSON (same contract as \`start-flow\` in quiet mode).
`;
}

function quickStartBlock(stage: FlowStage, track: FlowTrack): string {
  const schema = stageSchema(stage, track);
  const gatePreview = schema.executionModel.requiredGates.slice(0, 3).map((g) => `\`${g.id}\``).join(", ");
  return `## Quick Start

1. Announce at start: "Using \`${schema.skillName}\` to ${schema.philosophy.purpose}".
2. Obey HARD-GATE and Iron Law.
3. Execute checklist in order and persist \`${RUNTIME_ROOT}/artifacts/${schema.artifactRules.artifactFile}\`.
4. Satisfy gates (${gatePreview}${schema.executionModel.requiredGates.length > 3 ? ` +${schema.executionModel.requiredGates.length - 3}` : ""}).
`;
}

export function stageSkillFolder(stage: FlowStage): string {
  return STAGE_TO_SKILL_FOLDER[stage];
}

function normalizedGuidanceKey(value: string): string {
  return value
    .replace(/`[^`]+`/gu, " ")
    .replace(/[*_]/gu, " ")
    .replace(/[^a-z0-9]+/giu, " ")
    .replace(/\s+/gu, " ")
    .trim()
    .toLowerCase();
}

function mermaidNodeLabel(raw: string, index: number): string {
  const stripped = raw
    .replace(/`[^`]+`/gu, "")
    .replace(/\*\*/gu, "")
    .replace(/[*_]/gu, "")
    .replace(/\[[^\]]*\]\([^)]*\)/gu, "")
    .split(/[—:.;]/u)[0]
    ?.trim() ?? "";
  const words = stripped.split(/\s+/u).filter((word) => word.length > 0);
  const short = words.slice(0, 4).join(" ");
  const label = short.length === 0
    ? `Step ${index + 1}`
    : short.replace(/["`]/gu, "");
  return label.length > 48 ? `${label.slice(0, 45)}...` : label;
}

const MERMAID_PROCESS_MAX_NODES = 10;

function renderProcessFlowMermaid(executionModel: StageExecutionModel): string {
  if (executionModel.processFlow && executionModel.processFlow.trim().length > 0) {
    return `\`\`\`mermaid\n${executionModel.processFlow.trim()}\n\`\`\``;
  }
  const source = executionModel.process.length > 0
    ? executionModel.process
    : executionModel.checklist;
  if (source.length === 0) {
    return "";
  }
  const limited = source.slice(0, MERMAID_PROCESS_MAX_NODES);
  const nodes = limited.map((item, index) => ({
    id: `S${index + 1}`,
    label: mermaidNodeLabel(item, index)
  }));
  const lines = ["flowchart TD"];
  for (const node of nodes) {
    lines.push(`  ${node.id}["${node.label}"]`);
  }
  for (let i = 0; i < nodes.length - 1; i += 1) {
    lines.push(`  ${nodes[i]!.id} --> ${nodes[i + 1]!.id}`);
  }
  if (source.length > MERMAID_PROCESS_MAX_NODES) {
    lines.push(`  S${nodes.length} --> More["...see full Checklist"]`);
  }
  return `\`\`\`mermaid\n${lines.join("\n")}\n\`\`\``;
}

function renderPlatformNotesBlock(notes: string[] | undefined): string {
  if (!notes || notes.length === 0) {
    return "";
  }
  const body = notes.map((item) => `- ${item}`).join("\n");
  return `## Platform Notes
${body}

`;
}

function dedupeGuidance(
  items: string[],
  blockedBy: string[]
): string[] {
  const blocked = new Set(
    blockedBy
      .map((item) => normalizedGuidanceKey(item))
      .filter((item) => item.length > 0)
  );
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of items) {
    const key = normalizedGuidanceKey(item);
    if (key.length === 0) continue;
    if (blocked.has(key)) continue;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }
  return result;
}

export function stageSkillMarkdown(
  stage: FlowStage,
  track: FlowTrack = "standard",
  _packageVersion?: string | null
): string {
  const schema = stageSchema(stage, track);
  const trackContext = stageTrackRenderContext(track);
  const philosophy = schema.philosophy;
  const executionModel = schema.executionModel;
  const artifactRules = schema.artifactRules;
  const reviewLens = schema.reviewLens;
  const mandatoryDelegations = reviewLens.mandatoryDelegations;
  const gateList = executionModel.requiredGates
    .map((g) => `- \`${g.id}\` — ${g.description}`)
    .join("\n");
  const evidenceList = executionModel.requiredEvidence
    .map((e) => `- [ ] ${e}`)
    .join("\n");
  const checklistItems = executionModel.checklist
    .map((item, i) => `${i + 1}. ${item}`)
    .join("\n");
  const interactionFocus = dedupeGuidance(
    executionModel.interactionProtocol,
    [...executionModel.checklist, ...executionModel.process]
  ).slice(0, 5);
  const processFlowMermaid = renderProcessFlowMermaid(executionModel);
  const platformNotesBlock = renderPlatformNotesBlock(executionModel.platformNotes);
  const reviewLoopSection = reviewLoopBlock(reviewLens.reviewLoop);
  const mandatoryDelegationSummary = mandatoryDelegations.length > 0
    ? mandatoryDelegations.map((name) => `\`${name}\``).join(", ")
    : "none";

  return `---
name: ${schema.skillName}
description: "${schema.skillDescription}"
---

# ${schema.skillName}

<EXTREMELY-IMPORTANT>

**IRON LAW — ${stage.toUpperCase()}:** ${philosophy.ironLaw}

If you are about to violate the Iron Law, STOP. No amount of urgency, partial progress, or clever reinterpretation overrides it. Escalate via the Decision Protocol or abandon the stage.

</EXTREMELY-IMPORTANT>

${renderTrackTerminology(tddTopOfSkillBlock(stage) + reviewTopOfSkillBlock(stage), trackContext)}${quickStartBlock(stage, track)}

${STAGE_LANGUAGE_POLICY_POINTER}
## Philosophy
${philosophy.purpose}

## Complexity Tier
- Active tier: \`${schema.complexityTier}\`; mandatory delegations: ${mandatoryDelegationSummary}
- Scale-to-complexity: execute required gates/sections; keep optional/deep sections compact unless risk, novelty, or config triggers them.
- Track render context: \`${trackContext.track}\` (${trackContext.usesPlanTerminology ? "plan-first wording" : "acceptance-first wording"})

## When to Use
${philosophy.whenToUse.map((item) => `- ${item}`).join("\n")}

${whenNotToUseBlock(philosophy.whenNotToUse)}
## HARD-GATE
${philosophy.hardGate}

## Anti-Patterns & Red Flags
${mergedAntiPatterns(philosophy, executionModel)}

## Process

Stage state machine (map only; Checklist is authoritative):
${processFlowMermaid.length > 0 ? processFlowMermaid : "```mermaid\nflowchart TD\n  S1[\"Execute Checklist\"] --> S2[\"Satisfy required gates\"] --> S3[\"Verify before closeout\"]\n```"}

${platformNotesBlock}${contextLoadingBlock(stage, artifactRules.crossStageTrace, executionModel)}
${delegationAndCompletionBlock(schema, track)}
${stackAwareReviewRoutingBlock(stage)}
${researchPlaybooksBlock(executionModel.researchPlaybooks ?? [])}
${referencePatternsBlock(stage)}

## Checklist

You MUST complete these steps in order:

${checklistItems}

${stageExamples(stage)}

## Interaction Protocol

These are **rules for HOW you interact with the user** during this stage — tone, question shape, decision gating. Ordered steps of *what to do* live in the Checklist; do not treat these as an alternative sequence.

${interactionFocus.length > 0 ? interactionFocus.map((item, i) => `${i + 1}. ${item}`).join("\n") : "- Keep communication concise and decision-focused; rely on the Checklist for execution order."}

Decision protocol: ask only decision-changing questions, record the chosen option, rationale, risk, and rollback when the stage makes a non-trivial call.

${batchExecutionModeBlock(stage, track)}
${crossCuttingMechanicsBlock(stage)}
## Required Gates
${gateList}

## Required Evidence
${evidenceList}

${verificationBlock(stage)}

## Exit Criteria
${executionModel.exitCriteria.map((item) => `- [ ] ${item}`).join("\n")}

## Artifact Rules
- Artifact target: \`${RUNTIME_ROOT}/artifacts/${artifactRules.artifactFile}\`

${crossStageTraceBlock(artifactRules.crossStageTrace)}
${artifactValidationBlock(artifactRules.artifactValidation)}

## Review Lens
${reviewLoopSection ? `${reviewLoopSection}\n` : ""}## Outputs
${reviewLens.outputs.map((item) => `- ${item}`).join("\n")}

${reviewSectionsBlock(reviewLens.reviewSections)}

## Shared Stage Guidance
- At STOP/closeout points, offer the shared handoff choices only when a user decision is needed.
- Carry upstream decisions forward explicitly; record drift instead of silently changing direction.
- Before closeout, fill \`## Learnings\` with \`- None this stage.\` or 1-3 strict JSON bullets.
- Keep decisions explicit: context, options, chosen option, rationale, risk, and rollback.
`;
}

export function executingWavesSkillMarkdown(): string {
  return `---
name: executing-waves
description: "Execute multi-wave work using existing cclaw run resume + verify-current-state — no new CLI needed."
---

# Executing Waves (Persistent Multi-Wave Work)

## Overview

Long-form work (large refactors, multi-stage uplifts) often spans many waves.
This skill documents how the controller persists work across waves WITHOUT new
CLI commands, using existing \`cclaw run resume\` and \`internal verify-current-state\`.

## When to Use

- Work spans 2+ commits / waves with cohesion concerns between waves.
- Each wave has its own stage cycle (brainstorm -> scope -> design -> spec -> plan -> tdd -> review -> ship).
- User wants explicit per-wave verification before the next wave starts.
- Risk of cross-wave drift exists.

## Anti-Pattern

- Running many waves linearly without verification between them, accumulating drift.
- Treating a wave as only a commit boundary without re-verifying upstream decisions.

## Process

1. **Wave Start**: author wave plan as \`.cclaw/wave-plans/<wave-n>.md\` referencing previous wave's ship artifact.
2. **Carry-forward Audit**: at brainstorm of the next wave, re-read previous wave ship artifact and explicitly record in the existing \`## Wave Carry-forward\` section:
   - Carrying forward: <scope D-XX decision references still valid>
   - Drift detected: <decisions no longer valid + reason>
   - Re-scope needed: <yes/no>
   - Never create a second \`## Locked Decisions\` heading in brainstorm; reference prior D-XX IDs inline.
3. **Resume Path**: if a wave was interrupted mid-stage, \`cclaw run resume\` restores state. Run \`internal verify-current-state\` before continuing.
4. **Wave End**: at ship, architect cross-stage verification runs from dispatch matrix. If \`DRIFT_DETECTED\`, fix before ship.
5. **Next Wave Trigger**: launch new \`/cc <topic>\` for next wave and reference previous wave ship artifact in upstream handoff.

## Status Markers

- \`wave-status: in-progress\` — current stage incomplete.
- \`wave-status: blocked-by-prev\` — waiting on previous wave verification.
- \`wave-status: shipped\` — wave shipped, next wave can start.
- \`wave-status: rolled-back\` — previous wave invalidated, current wave needs rebase.

## Linter Hooks

- If multi-wave work is detected (>1 wave-plan files in \`.cclaw/wave-plans/\`), current brainstorm artifact MUST contain \`## Wave Carry-forward\` section with drift audit.
- If carry-forward drift is missing in multi-wave context, emit \`[P1] wave.drift_unaddressed\`.
`;
}
