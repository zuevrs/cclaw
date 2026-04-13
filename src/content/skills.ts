import { RUNTIME_ROOT } from "../constants.js";
import type { FlowStage } from "../types.js";
import { stageExamples } from "./examples.js";
import { selfImprovementBlock } from "./learnings.js";
import type { StageSchema } from "./stage-schema.js";
import { nextCclawCommand, stageAutoSubagentDispatch, stageSchema } from "./stage-schema.js";

function artifactFileName(artifactPath: string): string {
  const parts = artifactPath.split("/");
  return parts[parts.length - 1] ?? artifactPath;
}

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
      ? "\n\n**STOP.** For each issue found in this section, present it ONE AT A TIME. Describe the problem concretely, present 2-3 options, state your recommendation, and explain WHY. Only proceed to the next section after ALL issues in this section are resolved."
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
      .map((value) => {
        const fileName = artifactFileName(value);
        return `- Canonical: \`.cclaw/runs/<activeRunId>/artifacts/${fileName}\` (fallback: \`${value}\`)`;
      })
      .join("\n")
    : "- (first stage — no upstream artifacts)";

  return `## Context Loading

Before starting stage execution:
1. Read \`.cclaw/state/flow-state.json\` and capture \`activeRunId\`.
2. Resolve canonical run artifact root: \`.cclaw/runs/<activeRunId>/artifacts/\`.
3. Load upstream artifacts required by this stage:
${readLines}
4. If canonical run artifact is missing, fallback to the \`.cclaw/artifacts/\` mirror and record that fallback.
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
  const delegationLogRel = `${RUNTIME_ROOT}/runs/<activeRunId>/delegation-log.json`;

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

const VERIFICATION_STAGES: FlowStage[] = ["build", "review", "ship"];

function waveExecutionModeBlock(stage: FlowStage): string {
  const schema = stageSchema(stage);
  if (!schema.waveExecutionAllowed) {
    return "";
  }
  return `## Wave Execution Mode

After plan approval (**WAIT_FOR_CONFIRM** / \`plan_wait_for_confirm\` satisfied), process **all tasks in the current dependency wave** sequentially: **RED → GREEN → REFACTOR** per task, recording evidence per slice. **Stop** only on **BLOCKED**, a test failure that **requires user input**, or **wave completion** (every task in the wave has the required RED / GREEN / REFACTOR evidence per the plan artifact).

`;
}

function stageRequiresExplicitPause(schema: StageSchema): boolean {
  const pauseRules = [
    /\bWAIT_FOR_CONFIRM\b/,
    /Do NOT auto-advance/i,
    /wait for explicit user approval/i,
    /wait for explicit approval/i,
    /explicitly pause/i
  ];
  const stageText = [
    schema.hardGate,
    ...schema.checklist,
    ...schema.interactionProtocol,
    ...schema.process,
    ...schema.exitCriteria
  ];

  return stageText.some((line) => pauseRules.some((rule) => rule.test(line)));
}

function stageTransitionAutoAdvanceBlock(schema: StageSchema, nextCommand: string): string {
  if (schema.next === "done") {
    return "";
  }
  if (stageRequiresExplicitPause(schema)) {
    return `## Stage transition (autoAdvance)

If project config at \`${RUNTIME_ROOT}/config.yaml\` has \`autoAdvance: true\`, treat it as advisory only. This stage has an explicit pause or confirmation rule, so do NOT auto-advance after the gates pass. Suggest the next command (\`${nextCommand}\`) only after the required confirmation is satisfied, then wait.

`;
  }
  return `## Stage transition (autoAdvance)

If project config at \`${RUNTIME_ROOT}/config.yaml\` has \`autoAdvance: true\`, proceed to the next stage automatically after all gates pass for this stage. Otherwise, suggest the next command (\`${nextCommand}\`) and wait.

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
  const nextCommand = nextCclawCommand(stage);
  const topGates = schema.requiredGates.slice(0, 3).map((g) => `\`${g.id}\``).join(", ");
  return `## Quick Start (minimum compliance)

> **Even if you read nothing else, do these 3 things:**
> 1. Obey the HARD-GATE below — violating it invalidates the entire stage.
> 2. Complete every checklist step in order and write the artifact to \`.cclaw/artifacts/${schema.artifactFile}\` (canonical run copy: \`.cclaw/runs/<activeRunId>/artifacts/${schema.artifactFile}\`).
> 3. Do not claim completion without satisfying gates: ${topGates}${schema.requiredGates.length > 3 ? ` (+${schema.requiredGates.length - 3} more)` : ""}.
>
> **Next command after this stage:** ${nextCommand}
`;
}

export function stageSkillMarkdown(stage: FlowStage): string {
  const schema = stageSchema(stage);
  const nextCommand = nextCclawCommand(stage);

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

${stageExamples(stage)}
${namedAntiPatternBlock(stage)}
${cognitivePatternsList(stage)}
## Interaction Protocol
${schema.interactionProtocol.map((item, i) => `${i + 1}. ${item}`).join("\n")}

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

## Blockers
${schema.blockers.length > 0 ? schema.blockers.map((item) => `- ${item}`).join("\n") : "- None — stage can always proceed"}

## Anti-Patterns
${schema.antiPatterns.map((item) => `- ${item}`).join("\n")}

## Red Flags
${schema.redFlags.map((item) => `- ${item}`).join("\n")}

${completionStatusBlock(stage)}
## Verification
${schema.exitCriteria.map((item) => `- [ ] ${item}`).join("\n")}

${stageTransitionAutoAdvanceBlock(schema, nextCommand)}
${selfImprovementBlock(stage)}
## Handoff
- Next command: ${nextCommand}
- Required artifact: \`.cclaw/artifacts/${schema.artifactFile}\` (canonical: \`.cclaw/runs/<activeRunId>/artifacts/${schema.artifactFile}\`)
- Stage stays blocked if any required gate is unsatisfied
`;
}
