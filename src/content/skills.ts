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

`;
}

function stageCompletionProtocol(schema: StageSchema): string {
  const stage = schema.stage;
  const gateIds = schema.requiredGates.map((g) => g.id);
  const gateList = gateIds.map((id) => `\`${id}\``).join(", ");
  const nextStage = schema.next === "done" ? null : schema.next;
  const mandatory = schema.mandatoryDelegations;
  const delegationLogRel = `${RUNTIME_ROOT}/state/delegation-log.json`;

  const stateUpdate = nextStage
    ? `   - Set \`currentStage\` to \`"${nextStage}"\`
   - Add \`"${stage}"\` to \`completedStages\` array
   - Move all gate IDs for this stage (${gateList}) into \`stageGateCatalog.${stage}.passed\`
   - Clear \`stageGateCatalog.${stage}.blocked\``
    : `   - Add \`"${stage}"\` to \`completedStages\` array
   - Move all gate IDs for this stage (${gateList}) into \`stageGateCatalog.${stage}.passed\`
   - Clear \`stageGateCatalog.${stage}.blocked\``;

  const delegationBlock =
    mandatory.length > 0
      ? `0. **Delegation pre-flight** (BLOCKING):
   - Mandatory agents for this stage: ${mandatory.map((a) => `\`${a}\``).join(", ")}.
   - For each mandatory agent: confirm it was dispatched (via Task/delegate) and completed, OR record an explicit waiver with reason in \`${delegationLogRel}\`.
   - Write a JSON entry per agent: \`{ "stage": "${stage}", "agent": "<name>", "mode": "mandatory", "status": "completed"|"waived", "waiverReason": "<if waived>", "ts": "<ISO timestamp>" }\`.
   - If the harness does not support delegation, record status \`"waived"\` with reason \`"harness_limitation"\`.
   - **Do NOT proceed to step 1 until every mandatory agent has an entry in the delegation log.**
`
      : "";

  let nextAction: string;
  if (nextStage) {
    const nextSchema = stageSchema(nextStage);
    const nextDescription = nextSchema.skillDescription.charAt(0).toLowerCase() + nextSchema.skillDescription.slice(1);
    nextAction = `4. Tell the user:\n\n   > **Stage \`${stage}\` complete.** Next: **${nextStage}** — ${nextDescription}\n   >\n   > Run \`/cc-next\` to continue.`;
  } else {
    nextAction = `4. Tell the user:\n\n   > **Flow complete.** All stages finished. The project is ready for release.`;
  }

  return `## Stage Completion Protocol

When all required gates are satisfied and the artifact is written:

${delegationBlock}1. **Update \`${RUNTIME_ROOT}/state/flow-state.json\`:**
${stateUpdate}
   - For each passed gate, add an entry to \`guardEvidence\`: \`"<gate_id>": "<artifact path or excerpt proving the gate>"\`. Do NOT leave \`guardEvidence\` empty.
2. **Persist artifact** at \`${RUNTIME_ROOT}/artifacts/${schema.artifactFile}\`. Do NOT manually copy into \`${RUNTIME_ROOT}/runs/\`; archival is handled by \`cclaw archive\`.
3. **Doctor pre-flight** — Run \`npx cclaw doctor\` (or the installed cclaw binary). If any check fails, resolve the issue (missing delegation entry, artifact section, gate evidence) and re-run until all checks pass. Do NOT proceed to the next step while doctor reports failures.
${nextAction}

**STOP.** Do not load the next stage skill yourself. The user will run \`/cc-next\` when ready (same session or new session).

## Resume Protocol

When resuming a stage in a NEW session (artifact exists but gates are not all passed in flow-state):
1. Read the existing artifact and check which gates can be verified from artifact evidence.
2. For each unverified gate, ask the user to confirm ONE gate at a time. Do NOT batch multiple gate confirmations in a single message.
3. Update \`guardEvidence\` for each confirmed gate before proceeding.
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
- Next command: \`/cc-next\` (loads whatever stage is current in flow-state)
- Required artifact: \`.cclaw/artifacts/${schema.artifactFile}\`
- Stage stays blocked if any required gate is unsatisfied
`;
}
