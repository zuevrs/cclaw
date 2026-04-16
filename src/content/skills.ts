import { RUNTIME_ROOT } from "../constants.js";
import type { FlowStage } from "../types.js";
import { stageExamples, stageGoodBadExamples } from "./examples.js";
import { selfImprovementBlock } from "./learnings.js";
import type { StageSchema } from "./stage-schema.js";
import { stageAutoSubagentDispatch, stageSchema } from "./stage-schema.js";

function rationalizationTable(stage: FlowStage): string {
  const schema = stageSchema(stage);
  return `| Rationalization | Reality |
|---|---|
${schema.rationalizations.map((e) => `| ${e.claim} | ${e.reality} |`).join("\n")}`;
}

function cognitivePatternsList(stage: FlowStage): string {
  const schema = stageSchema(stage);
  if (schema.cognitivePatterns.length === 0) return "";
  const items = schema.cognitivePatterns
    .map((p, i) => `${i + 1}. **${p.name}** — ${p.description}`)
    .join("\n");
  return `## Cognitive Patterns\n\nThese are thinking instincts, not a checklist. Let them shape your perspective throughout the stage.\n\n${items}\n`;
}

function reviewSectionsBlock(stage: FlowStage): string {
  const schema = stageSchema(stage);
  if (schema.reviewSections.length === 0) return "";
  const sections = schema.reviewSections.map((sec) => {
    const points = sec.evaluationPoints.map((p) => `- ${p}`).join("\n");
    const stop = sec.stopGate
      ? "\n\n**STOP.** Present the most important question from this section to the user, even if your recommendation is clear. If no issues are found, state your assessment in one sentence and ask the user to confirm before moving on. If issues exist, present them ONE AT A TIME: describe the problem concretely, present 2-3 options, state your recommendation, and explain WHY."
      : "";
    return `### ${sec.title}\n\nEvaluate:\n${points}${stop}`;
  }).join("\n\n");
  return `## Review Sections\n\n**Anti-skip rule:** Never condense, abbreviate, or skip any review section. If a section genuinely has zero findings, say "No issues found" and move on — but you must evaluate it.\n\n${sections}\n`;
}

function crossStageTraceBlock(stage: FlowStage): string {
  const trace = stageSchema(stage).crossStageTrace;
  const reads = trace.readsFrom.length > 0
    ? trace.readsFrom.map((r) => `- ${r}`).join("\n")
    : "- (first stage — no upstream artifacts)";
  const writes = trace.writesTo.length > 0
    ? trace.writesTo.map((w) => `- ${w}`).join("\n")
    : "- (final stage — no downstream artifacts)";
  return `## Cross-Stage Traceability\n\n**Reads from:**\n${reads}\n\n**Writes to:**\n${writes}\n\n**Rule:** ${trace.traceabilityRule}\n`;
}

function artifactValidationBlock(stage: FlowStage): string {
  const validations = stageSchema(stage).artifactValidation;
  if (validations.length === 0) return "";
  const rows = validations.map((v) => {
    const req = v.required ? "REQUIRED" : "optional";
    return `| ${v.section} | ${req} | ${v.validationRule} |`;
  }).join("\n");
  return `## Artifact Validation\n\n| Section | Status | Validation Rule |\n|---|---|---|\n${rows}\n`;
}

function completionStatusBlock(stage: FlowStage): string {
  const statuses = stageSchema(stage).completionStatus;
  const items = statuses.map((s) => `- **${s}**`).join("\n");
  return `## Completion Status\n\nWhen this stage ends, report one of:\n${items}\n`;
}

function namedAntiPatternBlock(stage: FlowStage): string {
  const nap = stageSchema(stage).namedAntiPattern;
  if (!nap) return "";
  return `## Anti-Pattern: "${nap.title}"\n\n${nap.description}\n`;
}

function decisionRecordBlock(stage: FlowStage): string {
  const fmt = stageSchema(stage).decisionRecordFormat;
  if (!fmt) return "";
  return `## Decision Record Template\n\nUse this format for every non-trivial architecture or scope decision made during this stage:\n\n\`\`\`\n${fmt}\n\`\`\`\n`;
}

function visualCommunicationBlock(stage: FlowStage): string {
  if (stage !== "design") return "";
  return `## Visual Communication Rules

Diagrams are load-bearing artifacts in the design stage, not decoration. A diagram that encodes structure wrongly (or hides structure behind generic labels) misleads every downstream reader. Apply these rules to **every** diagram in the design artifact:

1. **Concrete names, never generic.** "Service A → Service B" is not a diagram; it is a shape. Every node must name a real component the team will build or touch (\`NotificationPublisher\`, \`FeedReadModel\`, \`Stripe webhook handler\`). If you cannot name it concretely, the design is not ready.
2. **Every arrow is labeled.** Label with the message, action, or protocol it carries (\`publishEvent(user_id, payload)\`, \`GET /snapshot\`, \`dedupe-key upsert\`). Unlabeled arrows silently lose the contract between components.
3. **Direction is explicit.** Use arrowheads, not bare lines; draw the flow of *data* (not "dependency") unless the diagram type is explicitly a dependency graph, in which case say so in a one-line caption.
4. **Distinguish sync vs async.** Use a convention and state it once in a legend: e.g. solid arrow = synchronous request/response, dashed arrow = async message via queue/bus, double arrow = two-way. Async edges always name the queue or topic.
5. **Show at least one failure edge.** Every non-trivial diagram needs one branch that represents the degraded or error path (timeout, reconnect, fallback to cache, poison-message routing). A diagram with only the happy path hides the interesting half of the design.
6. **One level of detail per diagram.** Do not mix "service-level" and "class-level" on the same canvas. If you need both, produce two diagrams — one at the system boundary, one at the internal module — and cross-reference them.
7. **Caption, not decoration.** Each diagram gets a one-sentence caption below it stating what the reader should take away ("*Publish path with idempotent outbox; SSE stream reads the projection, not the bus directly*"). If you cannot write the caption in one sentence, the diagram is doing two things at once.
8. **Prefer text-based formats** (Mermaid, ASCII) over binary images in \`.cclaw/artifacts/\` so diffs stay reviewable. Binary/SVG is allowed when the diagram is already the source of truth elsewhere (e.g. \`docs/architecture/\`) and the artifact embeds a link plus a text-based summary.

If a diagram cannot satisfy rules 1–5, do NOT include it — a missing diagram is honest; a misleading diagram is worse. Surface the gap in **Unresolved Decisions** and proceed without the diagram until the decisions that would populate it are locked.
`;
}

function contextLoadingBlock(stage: FlowStage): string {
  const trace = stageSchema(stage).crossStageTrace;
  const readLines = trace.readsFrom.length > 0
    ? trace.readsFrom
      .map((value) => `- \`${value}\``)
      .join("\n")
    : "- (first stage — no upstream artifacts)";

  return `## Context Loading

Before starting stage execution:
1. Read \`.cclaw/state/flow-state.json\`.
2. Resolve active artifact root: \`.cclaw/artifacts/\`.
3. Load upstream artifacts required by this stage:
${readLines}
4. Stream \`.cclaw/knowledge.jsonl\` (strict-JSONL knowledge store) and apply relevant entries before making decisions.
`;
}

function whenNotToUseBlock(stage: FlowStage): string {
  const schema = stageSchema(stage);
  if (!schema.whenNotToUse || schema.whenNotToUse.length === 0) {
    return "";
  }
  return `## When Not to Use
${schema.whenNotToUse.map((item) => `- ${item}`).join("\n")}

`;
}

function autoSubagentDispatchBlock(stage: FlowStage): string {
  const rules = stageAutoSubagentDispatch(stage);
  if (rules.length === 0) return "";
  const rows = rules
    .map((rule) => {
      const userGate = rule.requiresUserGate ? "required" : "not required";
      return `| ${rule.agent} | ${rule.mode} | ${rule.when} | ${rule.purpose} | ${userGate} |`;
    })
    .join("\n");

  const mandatory = stageSchema(stage).mandatoryDelegations;
  const mandatoryList =
    mandatory.length > 0 ? mandatory.map((a) => `\`${a}\``).join(", ") : "(none — only proactive dispatch applies)";
  const delegationLogRel = `${RUNTIME_ROOT}/state/delegation-log.json`;

  return `## Automatic Subagent Dispatch

Machine-only work should be delegated to specialist agents automatically according to the matrix below.

| Agent | Mode | When | Purpose | User Gate |
|---|---|---|---|---|
${rows}

**Gate rule:** user interaction is required only for approval/override decisions. Do not ask the user to manually trigger machine-only specialist checks.

## Delegation Enforcement

Before completing this stage, verify that ALL mandatory delegations are recorded. If using a harness that supports Task/delegate tools, each mandatory agent must have been invoked. If the harness does not support delegation, record a waiver with reason \`harness_limitation\` in the delegation log.

Mandatory agents for this stage: ${mandatoryList}. Stage transition is BLOCKED until all are **completed** or **explicitly waived** by the user (waived entries must name the agent and carry an explicit waiver reason).

On session stop or stage completion, the agent should write delegation entries to \`${delegationLogRel}\` for audit.
`;
}

const VERIFICATION_STAGES: FlowStage[] = ["tdd", "review", "ship"];

function waveExecutionModeBlock(stage: FlowStage): string {
  const schema = stageSchema(stage);
  if (!schema.waveExecutionAllowed) {
    return "";
  }
  return `## Wave Execution Mode

After plan approval (**WAIT_FOR_CONFIRM** / \`plan_wait_for_confirm\` satisfied), process **all tasks in the current dependency wave** sequentially: **RED → GREEN → REFACTOR** per task, recording evidence per slice. **Stop** only on **BLOCKED**, a test failure that **requires user input**, or **wave completion** (every task in the wave has the required RED / GREEN / REFACTOR evidence per the plan artifact).

### Walkthrough — Wave 1 with 3 tasks

The example below is **illustrative only** — do not copy the command names blindly, match them to your stack.

Assume Wave 1 from the plan artifact contains three tasks:

| Task ID | Description | AC | Verification |
|---|---|---|---|
| T-1 \`[~3m]\` | Add \`User.emailNormalized\` column | AC-1 | \`npm test -- users/schema\` |
| T-2 \`[~4m]\` | Normalize on write in \`UserRepo.save\` | AC-1 | \`npm test -- users/repo\` |
| T-3 \`[~3m]\` | Reject duplicates in \`UserService.signup\` | AC-2 | \`npm test -- users/service\` |

**Execution transcript** (one slice at a time, evidence captured per step):

**T-1 — RED**

> Run: \`npm test -- users/schema\` → **FAIL** (missing column: \`emailNormalized\`). Captured the failure stack as RED evidence. No production code touched yet.

**T-1 — GREEN**

> Added the column in the schema module. Re-ran \`npm test -- users/schema\` → **PASS**. Ran the full suite \`npm test\` → **PASS**. Captured both outputs as GREEN evidence.

**T-1 — REFACTOR**

> Extracted the column definition into a shared \`NormalizedEmail\` type used by T-2/T-3. Re-ran \`npm test\` → **PASS**. Captured REFACTOR note: "Extracted NormalizedEmail type to keep T-2/T-3 DRY; zero behavior change, all tests still green."

**T-2 — RED / GREEN / REFACTOR**: same shape — write the repo test that expects normalised writes, watch it fail (RED), implement normalisation inside \`UserRepo.save\` only (GREEN), then refactor the normaliser out of the repo into a helper shared with T-3 (REFACTOR).

**T-3 — RED / GREEN / REFACTOR**: write the service-level duplicate test that expects a rejection, watch it fail (RED), add the duplicate check in \`UserService.signup\` (GREEN), refactor the error message into a named constant (REFACTOR).

**Wave gate check**

After T-3 REFACTOR, before declaring Wave 1 done:

1. Run the **full suite** (\`npm test\`) one final time → **PASS** captured as wave-exit evidence.
2. Verify the TDD artifact contains RED, GREEN, and REFACTOR evidence for T-1, T-2, **and** T-3. No partial waves.
3. Only now mark Wave 1 complete. Wave 2 cannot start until this step.

**When to stop mid-wave (do NOT push through)**

- A RED test fails for a reason you did not predict (e.g. an unrelated flaky test) → **pause**, diagnose, log an operational-self-improvement entry, and decide with the user before proceeding.
- A GREEN step would require touching code outside the task's acceptance criterion → **pause**, the task is scoped wrong; adjust the plan or open a follow-up task.
- The same RED failure reappears after a GREEN change → **escalate** per the 3-attempts rule; do not keep patching.

`;
}

function stageCompletionProtocol(schema: StageSchema): string {
  const stage = schema.stage;
  const gateIds = schema.requiredGates.map((g) => g.id);
  const gateList = gateIds.map((id) => `\`${id}\``).join(", ");
  const nextStage = schema.next === "done" ? "done" : schema.next;
  const mandatory = schema.mandatoryDelegations;
  const mandatoryList =
    mandatory.length > 0 ? mandatory.map((a) => `\`${a}\``).join(", ") : "none";

  const nextDescription =
    schema.next === "done"
      ? "flow complete — release cut and handoff signed off"
      : (() => {
          const nextSchema = stageSchema(schema.next as FlowStage);
          return nextSchema.skillDescription.charAt(0).toLowerCase() + nextSchema.skillDescription.slice(1);
        })();

  return `## Stage Completion Protocol

Apply the **Shared Stage Completion Protocol** from \`.cclaw/skills/using-cclaw/SKILL.md\` with these parameters — do NOT re-derive the generic steps here.

**Completion Parameters**
- \`stage\` — \`${stage}\`
- \`next\` — \`${nextStage}\` (${nextDescription})
- \`gates\` — ${gateList}
- \`artifact\` — \`${RUNTIME_ROOT}/artifacts/${schema.artifactFile}\`
- \`mandatory\` — ${mandatoryList}

When all required gates are satisfied and the artifact is written, execute the shared procedure (delegation pre-flight → flow-state update → artifact persistence → \`npx cclaw doctor\` → user handoff → STOP) using the parameters above. If any check fails, resolve the issue and re-run before proceeding.

## Resume Protocol

When resuming this stage in a NEW session (artifact exists but not all of ${gateList} are passed), follow the **Shared Resume Protocol** in \`.cclaw/skills/using-cclaw/SKILL.md\` — confirm one gate at a time, update \`guardEvidence\` for each, never batch confirmations.
`;
}

function stageTransitionAutoAdvanceBlock(schema: StageSchema): string {
  return stageCompletionProtocol(schema);
}

function progressiveDisclosureBlock(stage: FlowStage): string {
  const schema = stageSchema(stage);
  const stageSpecificRefs: Record<FlowStage, string[]> = {
    brainstorm: [
      "- `.cclaw/skills/learnings/SKILL.md` — to capture durable framing insights early"
    ],
    scope: [
      "- `.cclaw/skills/learnings/SKILL.md` — to persist rejected assumptions and constraints"
    ],
    design: [
      "- `.cclaw/skills/performance/SKILL.md` — when architectural choices carry perf trade-offs",
      "- `.cclaw/skills/security/SKILL.md` — when design choices touch auth/secrets/trust boundaries"
    ],
    spec: [
      "- `.cclaw/skills/docs/SKILL.md` — for API/contract wording quality and ADR-style decision capture",
      "- `.cclaw/skills/learnings/SKILL.md` — to preserve acceptance criteria traps and edge-case learnings"
    ],
    plan: [
      "- `.cclaw/skills/subagent-dev/SKILL.md` — for specialist delegation prompts by task slice",
      "- `.cclaw/skills/parallel-dispatch/SKILL.md` — for multi-agent review planning and reconciliation setup"
    ],
    tdd: [
      "- `.cclaw/skills/debugging/SKILL.md` — when RED behavior is unclear, flakes appear, or implementation fails tests",
      "- `.cclaw/skills/subagent-dev/SKILL.md` — for machine-only test-slice delegation",
      "- `.cclaw/skills/performance/SKILL.md` — when implementation choices impact latency/throughput"
    ],
    review: [
      "- `.cclaw/skills/security/SKILL.md` — mandatory lens for exploitable risk detection",
      "- `.cclaw/skills/parallel-dispatch/SKILL.md` — for review-army dispatch and reconciliation discipline"
    ],
    ship: [
      "- `.cclaw/skills/ci-cd/SKILL.md` — for release gates, pipeline health, and deployment guardrails",
      "- `.cclaw/skills/docs/SKILL.md` — for release docs, migration notes, and ADR/public API updates"
    ]
  };

  return `## Progressive Disclosure

### Depth
- Primary stage procedure (this file): \`.cclaw/skills/${schema.skillFolder}/SKILL.md\`
- Orchestrator contract (gate language and handoff): \`.cclaw/commands/${stage}.md\`
- Artifact structure baseline: \`.cclaw/templates/${schema.artifactFile}\`
- Runtime state truth source: \`.cclaw/state/flow-state.json\` + \`.cclaw/artifacts/\` + \`.cclaw/knowledge.jsonl\`

### See also
- Meta routing and activation rules: \`.cclaw/skills/using-cclaw/SKILL.md\`
- Session continuity and checkpoint behavior: \`.cclaw/skills/session/SKILL.md\`
${stageSpecificRefs[stage].join("\n")}
- Progression command: \`/cc-next\` (reads flow-state, loads the next stage)
`;
}

function verificationBlock(stage: FlowStage): string {
  if (!VERIFICATION_STAGES.includes(stage)) return "";
  return `## Verification Before Completion

**Iron law:** Do not claim this stage is complete without fresh verification evidence from THIS message.

### Gate Function
For every completion claim, follow this sequence:
1. **Identify** the verification command (test suite, build, lint, type-check).
2. **Run** the full command — not a subset, not a cached result.
3. **Read** the complete output — do not summarize without reading.
4. **Verify** the output matches the expected success state.
5. **Only then** make the completion claim with the evidence.

### Evidence Requirements
| Claim | Requires | NOT Sufficient |
|---|---|---|
| "Tests pass" | Fresh test run output showing all pass | "I believe tests pass" or prior run |
| "Build succeeds" | Fresh build output with exit code 0 | "Should build fine" |
| "No lint errors" | Fresh linter output | "I didn't introduce any" |
| "Bug is fixed" | Regression test: remove fix → fails, restore → passes | "The fix looks correct" |

### Forbidden Language
Do not use these phrases before verification:
- "Everything works," "All good," "Done," "Successfully completed"
- "Should be fine," "I'm confident that," "This will work"
- "Tests should pass," "The build should succeed"

### Regression Test Pattern
When fixing a bug:
1. Write a test that reproduces the bug → verify it **fails**.
2. Apply the fix → verify the test **passes**.
3. Revert the fix → verify the test **fails again**.
4. Restore the fix → verify the full suite passes.
`;
}

export function stageSkillFolder(stage: FlowStage): string {
  return stageSchema(stage).skillFolder;
}

function quickStartBlock(stage: FlowStage): string {
  const schema = stageSchema(stage);
  const topGates = schema.requiredGates.slice(0, 3).map((g) => `\`${g.id}\``).join(", ");
  return `## Quick Start (minimum compliance)

> **Even if you read nothing else, do these 3 things:**
> 1. Obey the HARD-GATE below — violating it invalidates the entire stage.
> 2. Complete every checklist step in order and write the artifact to \`.cclaw/artifacts/${schema.artifactFile}\`.
> 3. Do not claim completion without satisfying gates: ${topGates}${schema.requiredGates.length > 3 ? ` (+${schema.requiredGates.length - 3} more)` : ""}.
>
> **After this stage:** update \`flow-state.json\` and tell the user to run \`/cc-next\`.
`;
}

export function stageSkillMarkdown(stage: FlowStage): string {
  const schema = stageSchema(stage);

  const gateList = schema.requiredGates
    .map((g) => `- \`${g.id}\` — ${g.description}`)
    .join("\n");

  const evidenceList = schema.requiredEvidence
    .map((e) => `- [ ] ${e}`)
    .join("\n");

  const checklistItems = schema.checklist
    .map((item, i) => `${i + 1}. ${item}`)
    .join("\n");

  return `---
name: ${schema.skillName}
description: "${schema.skillDescription}"
---

# ${schema.skillName}

${quickStartBlock(stage)}
## Overview
${schema.purpose}

## When to Use
${schema.whenToUse.map((item) => `- ${item}`).join("\n")}

${whenNotToUseBlock(stage)}
## Inputs
${schema.inputs.length > 0 ? schema.inputs.map((item) => `- ${item}`).join("\n") : "- (first stage — no required inputs)"}

## Required Context
${schema.requiredContext.length > 0 ? schema.requiredContext.map((item) => `- ${item}`).join("\n") : "- None beyond this skill"}

${contextLoadingBlock(stage)}
${autoSubagentDispatchBlock(stage)}
## Outputs
${schema.outputs.map((item) => `- ${item}`).join("\n")}

## HARD-GATE
${schema.hardGate}

## Checklist

You MUST complete these steps in order:

${checklistItems}

${stageGoodBadExamples(stage)}
${stageExamples(stage)}
${namedAntiPatternBlock(stage)}
${cognitivePatternsList(stage)}
## Interaction Protocol
${schema.interactionProtocol.map((item, i) => `${i + 1}. ${item}`).join("\n")}

**See \`.cclaw/skills/using-cclaw/SKILL.md\` "Shared Decision + Tool-Use Protocol"** for the full AskUserQuestion format, error/retry budget, and the 3-attempt escalation rule. Do not duplicate those rules here — apply them verbatim.

${waveExecutionModeBlock(stage)}
## Required Gates
${gateList}

## Required Evidence
${evidenceList}

## Process
${schema.process.map((item, i) => `${i + 1}. ${item}`).join("\n")}

${reviewSectionsBlock(stage)}
${verificationBlock(stage)}
${crossStageTraceBlock(stage)}
${artifactValidationBlock(stage)}
${visualCommunicationBlock(stage)}
${decisionRecordBlock(stage)}
## Common Rationalizations
${rationalizationTable(stage)}

## Anti-Patterns
${[...schema.antiPatterns, ...schema.blockers].map((item) => `- ${item}`).join("\n")}

## Red Flags
${schema.redFlags.map((item) => `- ${item}`).join("\n")}

${completionStatusBlock(stage)}
## Verification
${schema.exitCriteria.map((item) => `- [ ] ${item}`).join("\n")}

${stageTransitionAutoAdvanceBlock(schema)}
${progressiveDisclosureBlock(stage)}
${selfImprovementBlock(stage)}
## Handoff

Before closing the stage, announce the handoff explicitly so the user can steer. Use the **Handoff Menu** below; never auto-advance silently, even when \`/cc-next\` is available.

### Handoff Menu

Offer the user a lettered choice at the end of the stage (use \`AskUserQuestion\` / \`AskQuestion\` when the harness supports it, otherwise plain lettered text):

- **A) Advance** — run \`/cc-next\` and continue to the next stage. Default when all gates are satisfied and there are no open concerns.
- **B) Revise this stage** — stay on the current stage; apply the user's feedback, then re-ask for handoff.
- **C) Pause / park** — save state; stop here. Useful when the user wants to share the artifact with a human reviewer before continuing.
- **D) Rewind** — move to a prior stage (user names which). Use when downstream work revealed that an earlier stage was wrong.
- **E) Abandon** — mark the flow as cancelled; no further stages will run. Artifacts remain on disk.

Recommendation rules:
- If all required gates are satisfied AND the stage's completion status is \`DONE\`, recommend **A (Advance)**.
- If completion status is \`DONE_WITH_CONCERNS\`, recommend **B (Revise)** and name the concern.
- If completion status is \`BLOCKED\`, recommend **B (Revise)** or **C (Pause)** depending on whether the blocker is internal or external.

Reference data for the user:
- Next command: \`/cc-next\` (loads whatever stage is current in flow-state)
- Required artifact: \`.cclaw/artifacts/${schema.artifactFile}\`
- Stage stays blocked if any required gate is unsatisfied
`;
}
