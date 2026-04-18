import { RUNTIME_ROOT } from "../constants.js";
import type { FlowStage } from "../types.js";
import { STAGE_EXAMPLES_REFERENCE_DIR, stageDomainExamples, stageExamples, stageGoodBadExamples } from "./examples.js";
import { STAGE_COMMON_GUIDANCE_REL_PATH } from "./stage-common-guidance.js";
import type { StageSchema } from "./stage-schema.js";
import { stageAutoSubagentDispatch, stageSchema } from "./stage-schema.js";

const VERIFICATION_STAGES: FlowStage[] = ["tdd", "review", "ship"];
const DECISION_PROTOCOL_PATH = `${RUNTIME_ROOT}/references/protocols/decision.md`;
const COMPLETION_PROTOCOL_PATH = `${RUNTIME_ROOT}/references/protocols/completion.md`;

function whenNotToUseBlock(stage: FlowStage): string {
  const schema = stageSchema(stage);
  if (schema.whenNotToUse.length === 0) {
    return "";
  }
  return `## When Not to Use
${schema.whenNotToUse.map((item) => `- ${item}`).join("\n")}

`;
}

function contextLoadingBlock(stage: FlowStage): string {
  const trace = stageSchema(stage).crossStageTrace;
  const readLines = trace.readsFrom.length > 0
    ? trace.readsFrom.map((value) => `- \`${value}\``).join("\n")
    : "- (first stage — no upstream artifacts)";

  return `## Context Loading

Before execution:
1. Read \`.cclaw/state/flow-state.json\`.
2. Load active artifacts from \`.cclaw/artifacts/\`.
3. Load upstream artifacts required by this stage:
${readLines}
4. Use the injected knowledge digest from session-start; only fall back to full
   \`.cclaw/knowledge.jsonl\` when the digest is insufficient.
`;
}

function autoSubagentDispatchBlock(stage: FlowStage): string {
  const rules = stageAutoSubagentDispatch(stage);
  if (rules.length === 0) return "";

  const rows = rules
    .map((rule) => {
      const userGate = rule.requiresUserGate ? "required" : "not required";
      return `| ${rule.agent} | ${rule.mode} | ${userGate} | ${rule.when} |`;
    })
    .join("\n");
  const mandatory = stageSchema(stage).mandatoryDelegations;
  const mandatoryList = mandatory.length > 0 ? mandatory.map((a) => `\`${a}\``).join(", ") : "none";
  const delegationLogRel = `${RUNTIME_ROOT}/state/delegation-log.json`;

  return `## Automatic Subagent Dispatch

| Agent | Mode | User Gate | Trigger |
|---|---|---|---|
${rows}

Mandatory delegations for this stage: ${mandatoryList}.
Record completion/waiver in \`${delegationLogRel}\` before stage completion.
`;
}

function researchPlaybooksBlock(stage: FlowStage): string {
  const playbooks = stageSchema(stage).researchPlaybooks ?? [];
  if (playbooks.length === 0) return "";
  const rows = playbooks
    .map((playbook) => `- \`${RUNTIME_ROOT}/skills/${playbook}\``)
    .join("\n");
  return `## Research Playbooks

Use these in-thread research procedures before locking this stage. They are
playbooks (not delegated personas), so execute them in the primary agent context
and record outcomes in the stage artifact when relevant.

${rows}
`;
}

function reviewSectionsBlock(stage: FlowStage): string {
  const schema = stageSchema(stage);
  if (schema.reviewSections.length === 0) return "";
  const sections = schema.reviewSections
    .map((sec) => {
      const points = sec.evaluationPoints.map((p) => `- ${p}`).join("\n");
      const stop = sec.stopGate
        ? "\n\n**STOP:** resolve findings in this section before moving forward."
        : "";
      return `### ${sec.title}\n${points}${stop}`;
    })
    .join("\n\n");

  return `## Review Sections

${sections}
`;
}

function verificationBlock(stage: FlowStage): string {
  if (!VERIFICATION_STAGES.includes(stage)) return "";
  return `## Verification Before Completion

Provide fresh, stage-local verification evidence from this turn:

1. Run verification commands (tests/build/lint/type-check) for the changed scope.
2. Confirm output, do not infer success from prior runs.
3. If this is a bug fix, capture RED -> GREEN evidence for the regression path.

Reference utility skill:
\`.cclaw/skills/verification-before-completion/SKILL.md\`
`;
}

function waveExecutionModeBlock(stage: FlowStage): string {
  const schema = stageSchema(stage);
  if (!schema.waveExecutionAllowed) return "";

  return `## Wave Execution Mode

Execute the current dependency wave task-by-task (RED -> GREEN -> REFACTOR).
Stop on BLOCKED status or when user input is required.
Apply concise turn announces: one announce per wave boundary (or when risk/plan
changes materially), then execute tasks without repetitive boilerplate.

Detailed walkthrough:
\`.cclaw/${STAGE_EXAMPLES_REFERENCE_DIR}/tdd-wave-walkthrough.md\`
`;
}

function crossStageTraceBlock(stage: FlowStage): string {
  const trace = stageSchema(stage).crossStageTrace;
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

function artifactValidationBlock(stage: FlowStage): string {
  const validations = stageSchema(stage).artifactValidation;
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

function mergedAntiPatterns(schema: StageSchema): string {
  const merged: string[] = [];
  const seen = new Set<string>();
  for (const item of [...schema.commonRationalizations, ...schema.blockers]) {
    const key = item.trim().toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(item);
  }
  return merged.map((item) => `- ${item}`).join("\n");
}

function stageSpecificSeeAlso(stage: FlowStage): string[] {
  const refs: Record<FlowStage, string[]> = {
    brainstorm: [
      `- \`${RUNTIME_ROOT}/skills/learnings/SKILL.md\``,
      `- \`${RUNTIME_ROOT}/references/stages/brainstorm-examples.md\``
    ],
    scope: [
      `- \`${RUNTIME_ROOT}/skills/learnings/SKILL.md\``,
      `- \`${RUNTIME_ROOT}/references/stages/scope-examples.md\``
    ],
    design: [
      `- \`${RUNTIME_ROOT}/skills/security/SKILL.md\``,
      `- \`${RUNTIME_ROOT}/skills/performance/SKILL.md\``
    ],
    spec: [
      `- \`${RUNTIME_ROOT}/skills/docs/SKILL.md\``,
      `- \`${RUNTIME_ROOT}/references/stages/spec-examples.md\``
    ],
    plan: [
      `- \`${RUNTIME_ROOT}/skills/subagent-dev/SKILL.md\``,
      `- \`${RUNTIME_ROOT}/skills/parallel-dispatch/SKILL.md\``
    ],
    tdd: [
      `- \`${RUNTIME_ROOT}/skills/debugging/SKILL.md\``,
      `- \`${RUNTIME_ROOT}/references/stages/tdd-wave-walkthrough.md\``
    ],
    review: [
      `- \`${RUNTIME_ROOT}/skills/security/SKILL.md\``,
      `- \`${RUNTIME_ROOT}/skills/parallel-dispatch/SKILL.md\``,
      `- \`${RUNTIME_ROOT}/skills/verification-before-completion/SKILL.md\``
    ],
    ship: [
      `- \`${RUNTIME_ROOT}/skills/ci-cd/SKILL.md\``,
      `- \`${RUNTIME_ROOT}/skills/docs/SKILL.md\``,
      `- \`${RUNTIME_ROOT}/skills/verification-before-completion/SKILL.md\``,
      `- \`${RUNTIME_ROOT}/skills/finishing-a-development-branch/SKILL.md\``
    ]
  };
  return refs[stage];
}

function completionParametersBlock(schema: StageSchema): string {
  const gateList = schema.requiredGates.map((g) => `\`${g.id}\``).join(", ");
  const mandatory = schema.mandatoryDelegations.length > 0
    ? schema.mandatoryDelegations.map((a) => `\`${a}\``).join(", ")
    : "none";
  const nextStage = schema.next === "done" ? "done" : schema.next;
  const nextDescription = schema.next === "done"
    ? "flow complete"
    : stageSchema(schema.next as FlowStage).skillDescription;

  return `## Completion Parameters

- \`stage\`: \`${schema.stage}\`
- \`next\`: \`${nextStage}\` (${nextDescription})
- \`gates\`: ${gateList}
- \`artifact\`: \`${RUNTIME_ROOT}/artifacts/${schema.artifactFile}\`
- \`mandatory delegations\`: ${mandatory}

Apply shared completion logic from:
\`${COMPLETION_PROTOCOL_PATH}\`
`;
}

function quickStartBlock(stage: FlowStage): string {
  const schema = stageSchema(stage);
  const gatePreview = schema.requiredGates.slice(0, 3).map((g) => `\`${g.id}\``).join(", ");
  return `## Quick Start

1. Announce at start: "Using \`${schema.skillName}\` to ${schema.purpose}".
2. Obey HARD-GATE and Iron Law.
3. Execute checklist in order and persist \`${RUNTIME_ROOT}/artifacts/${schema.artifactFile}\`.
4. Satisfy gates (${gatePreview}${schema.requiredGates.length > 3 ? ` +${schema.requiredGates.length - 3}` : ""}).
`;
}

/**
 * Long-form Wave Execution walkthrough. Rendered once into
 * \`.cclaw/references/stages/tdd-wave-walkthrough.md\` by the installer.
 */
export const TDD_WAVE_WALKTHROUGH_MARKDOWN = `# TDD — Wave Execution Walkthrough

Detailed RED / GREEN / REFACTOR transcript for a 3-task wave. Illustrative
only — do not copy the command names blindly, match them to your stack.

## Wave 1 example tasks

| Task ID | Description | AC | Verification |
|---|---|---|---|
| T-1 \`[~3m]\` | Add \`User.emailNormalized\` column | AC-1 | \`npm test -- users/schema\` |
| T-2 \`[~4m]\` | Normalize on write in \`UserRepo.save\` | AC-1 | \`npm test -- users/repo\` |
| T-3 \`[~3m]\` | Reject duplicates in \`UserService.signup\` | AC-2 | \`npm test -- users/service\` |

## Execution transcript

### T-1 — RED

> Run: \`npm test -- users/schema\` → **FAIL** (missing column: \`emailNormalized\`). Captured the failure stack as RED evidence. No production code touched yet.

### T-1 — GREEN

> Added the column in the schema module. Re-ran \`npm test -- users/schema\` → **PASS**. Ran the full suite \`npm test\` → **PASS**. Captured both outputs as GREEN evidence.

### T-1 — REFACTOR

> Extracted the column definition into a shared \`NormalizedEmail\` type used by T-2/T-3. Re-ran \`npm test\` → **PASS**. Captured REFACTOR note: "Extracted NormalizedEmail type to keep T-2/T-3 DRY; zero behavior change, all tests still green."

### T-2 — RED / GREEN / REFACTOR

Write the repo test that expects normalised writes, watch it fail (RED), implement normalisation inside \`UserRepo.save\` only (GREEN), then refactor the normaliser out of the repo into a helper shared with T-3 (REFACTOR).

### T-3 — RED / GREEN / REFACTOR

Write the service-level duplicate test that expects a rejection, watch it fail (RED), add the duplicate check in \`UserService.signup\` (GREEN), refactor the error message into a named constant (REFACTOR).

## Wave gate check

After T-3 REFACTOR, before declaring Wave 1 done:

1. Run the full suite (\`npm test\`) one final time → **PASS** captured as wave-exit evidence.
2. Verify the TDD artifact contains RED, GREEN, and REFACTOR evidence for T-1, T-2, **and** T-3. No partial waves.
3. Only now mark Wave 1 complete. Wave 2 cannot start until this step.

## When to stop mid-wave (do NOT push through)

- A RED test fails for a reason you did not predict (e.g. an unrelated flaky test) → **pause**, diagnose, log an operational-self-improvement entry, and decide with the user before proceeding.
- A GREEN step would require touching code outside the task's acceptance criterion → **pause**, the task is scoped wrong; adjust the plan or open a follow-up task.
- The same RED failure reappears after a GREEN change → **escalate** per the 3-attempts rule; do not keep patching.
`;

export function stageSkillFolder(stage: FlowStage): string {
  return stageSchema(stage).skillFolder;
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
  const stageRefs = stageSpecificSeeAlso(stage);

  return `---
name: ${schema.skillName}
description: "${schema.skillDescription}"
---

# ${schema.skillName}

<EXTREMELY-IMPORTANT>

**IRON LAW — ${stage.toUpperCase()}:** ${schema.ironLaw}

If you are about to violate the Iron Law, STOP. No amount of urgency, partial progress, or clever reinterpretation overrides it. Escalate via the Decision Protocol or abandon the stage.

</EXTREMELY-IMPORTANT>

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
${researchPlaybooksBlock(stage)}

## Outputs
${schema.outputs.map((item) => `- ${item}`).join("\n")}

## HARD-GATE
${schema.hardGate}

## Checklist

You MUST complete these steps in order:

${checklistItems}

${stageGoodBadExamples(stage)}
${stageDomainExamples(stage)}
${stageExamples(stage)}

## Interaction Protocol
${schema.interactionProtocol.map((item, i) => `${i + 1}. ${item}`).join("\n")}

Shared decision/ask-user protocol:
\`${DECISION_PROTOCOL_PATH}\`

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

## Anti-Patterns & Red Flags
${mergedAntiPatterns(schema)}

## Verification
${schema.exitCriteria.map((item) => `- [ ] ${item}`).join("\n")}

${completionParametersBlock(schema)}
## Shared Stage Guidance
See:
- \`${STAGE_COMMON_GUIDANCE_REL_PATH}\`
- \`${DECISION_PROTOCOL_PATH}\`
- \`${COMPLETION_PROTOCOL_PATH}\`

## See Also
- \`${RUNTIME_ROOT}/skills/using-cclaw/SKILL.md\`
- \`${RUNTIME_ROOT}/skills/session/SKILL.md\`
${stageRefs.join("\n")}
- \`${RUNTIME_ROOT}/commands/${stage}.md\`
`;
}
