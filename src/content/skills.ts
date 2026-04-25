import { RUNTIME_ROOT, STAGE_TO_SKILL_FOLDER } from "../constants.js";
import { nextStage as nextStageForTrack } from "../flow-state.js";
import type { FlowStage, FlowTrack } from "../types.js";
import { stageExamples } from "./examples.js";
import { reviewStackAwareRoutes, reviewStackAwareRoutingSummary, stageAutoSubagentDispatch, stageSchema, stageTrackRenderContext } from "./stage-schema.js";
import type { StageSchema } from "./stage-schema.js";
import { conversationLanguagePolicyMarkdown } from "./language-policy.js";
import type {
  ArtifactValidation,
  CrossStageTrace,
  ReviewSection,
  StageExecutionModel,
  StagePhilosophy,
  StageReviewLoop
} from "./stages/schema-types.js";

const VERIFICATION_STAGES: FlowStage[] = ["tdd", "review", "ship"];

function whenNotToUseBlock(items: string[]): string {
  if (items.length === 0) {
    return "";
  }
  return `## When Not to Use
${items.map((item) => `- ${item}`).join("\n")}

`;
}

function contextLoadingBlock(trace: CrossStageTrace, executionModel: StageExecutionModel): string {
  const readLines = trace.readsFrom.length > 0
    ? trace.readsFrom.map((value) => `- \`${value}\``).join("\n")
    : "- (first stage — no upstream artifacts)";
  const inputs = executionModel.inputs.length > 0
    ? executionModel.inputs.map((item) => `- ${item}`).join("\n")
    : "- (first stage — no required inputs)";
  const requiredContext = executionModel.requiredContext.length > 0
    ? executionModel.requiredContext.map((item) => `- ${item}`).join("\n")
    : "- None beyond this skill";

  return `## Context Loading

Before execution:
1. Read \`.cclaw/state/flow-state.json\`.
2. Load active artifacts from \`.cclaw/artifacts/\`.
3. Load upstream artifacts required by this stage:
${readLines}
4. Extract upstream decisions, constraints, and open questions into the current
   artifact's \`Upstream Handoff\` section when that section exists.
5. Before doing stage work, give a compact user-facing drift preamble: "Carrying forward: <1-3 bullets>. Drift since upstream: None / <specific drift>. Recommendation: continue / re-scope."
6. If you change an upstream decision, record an explicit drift reason in the
   current artifact before continuing.
7. Confirm stage inputs:
${inputs}
8. Confirm required context:
${requiredContext}
9. Use the injected knowledge digest from session-start; only fall back to full
   \`.cclaw/knowledge.jsonl\` when the digest is insufficient.
`;
}

function autoSubagentDispatchBlock(stage: FlowStage, track: FlowTrack): string {
  const rules = stageAutoSubagentDispatch(stage);
  if (rules.length === 0) return "";

  const rows = rules
    .map((rule) => {
      const userGate = rule.requiresUserGate ? "required" : "not required";
      return `| ${rule.agent} | ${rule.mode} | ${userGate} | ${rule.when} |`;
    })
    .join("\n");
  const mandatory = stageSchema(stage, track).mandatoryDelegations;
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

function researchPlaybooksBlock(playbooks: string[]): string {
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

  return `## Batch Execution Mode

Execute the current dependency batch task-by-task (RED -> GREEN -> REFACTOR).
Stop on BLOCKED status or when user input is required.
Apply concise turn announces: one announce per batch boundary (or when risk/plan
changes materially), then execute tasks without repetitive boilerplate.

Detailed walkthrough:
Use the current plan artifact for batch order and keep RED -> GREEN -> REFACTOR evidence in the TDD artifact.
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
  const mandatoryAgents = schema.reviewLens.mandatoryDelegations;
  const mandatory = schema.reviewLens.mandatoryDelegations.length > 0
    ? schema.reviewLens.mandatoryDelegations.map((a) => `\`${a}\``).join(", ")
    : "none";
  const resolvedNextStage = nextStageForTrack(schema.stage, track);
  const nextStage = resolvedNextStage ?? "done";
  const nextDescription = nextStage === "done"
    ? "flow complete"
    : stageSchema(nextStage, track).skillDescription;

  return `## Completion Parameters

- \`stage\`: \`${schema.stage}\`
- \`next\`: \`${nextStage}\` (${nextDescription})
- \`gates\`: ${gateList}
- \`artifact\`: \`${RUNTIME_ROOT}/artifacts/${schema.artifactRules.artifactFile}\`
- \`mandatory delegations\`: ${mandatory}
- \`completion helper\`: \`node .cclaw/hooks/stage-complete.mjs ${schema.stage}\`
- \`completion helper with evidence\`: \`node .cclaw/hooks/stage-complete.mjs ${schema.stage} --evidence-json '{"<gate_id>":"<evidence note>"}' --passed=<gate_id>[,<gate_id>]\`
- \`completion helper JSON diagnostics\`: append \`--json\` to receive a machine-readable validation failure summary.
- Fill \`## Learnings\` before closeout: either \`- None this stage.\` or JSON bullets with required keys \`type\`, \`trigger\`, \`action\`, \`confidence\` (knowledge-schema compatible).
- Record mandatory delegation completion/waiver in \`${RUNTIME_ROOT}/state/delegation-log.json\` with rationale as needed.${mandatoryAgents.length > 0 ? ` If a mandatory delegation cannot run in this harness, use \`--waive-delegation=${mandatoryAgents.join(",")} --waiver-reason="<why safe>"\` on the completion helper.` : ""}
- Never edit raw \`flow-state.json\` to complete a stage, even in advisory mode; that bypasses validation, gate evidence, and Learnings harvest. If the helper fails, stop and report the exact command/output instead of applying a manual state workaround.
- Completion protocol: verify required gates, update the artifact, then use the completion helper with \`--evidence-json\` and \`--passed\` for every satisfied gate.
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

export function stageSkillMarkdown(stage: FlowStage, track: FlowTrack = "standard"): string {
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

${quickStartBlock(stage, track)}

${conversationLanguagePolicyMarkdown()}
## Philosophy
${philosophy.purpose}

## Complexity Tier
- Active tier: \`${schema.complexityTier}\`
- Mandatory delegations at this tier: ${mandatoryDelegationSummary}
- Track render context: \`${trackContext.track}\` (${trackContext.usesPlanTerminology ? "plan-first wording" : "acceptance-first wording"})

## When to Use
${philosophy.whenToUse.map((item) => `- ${item}`).join("\n")}

${whenNotToUseBlock(philosophy.whenNotToUse)}
## HARD-GATE
${philosophy.hardGate}

## Anti-Patterns & Red Flags
${mergedAntiPatterns(philosophy, executionModel)}

## Process

This is the stage **state machine** — the canonical ordered flow. For every detailed step, gate, and wording, follow the Checklist below; this diagram is the map, not the territory.

${processFlowMermaid.length > 0 ? processFlowMermaid : "```mermaid\nflowchart TD\n  S1[\"Execute Checklist\"] --> S2[\"Satisfy required gates\"] --> S3[\"Verify before closeout\"]\n```"}

${platformNotesBlock}${contextLoadingBlock(artifactRules.crossStageTrace, executionModel)}
${autoSubagentDispatchBlock(stage, track)}
${stackAwareReviewRoutingBlock(stage)}
${researchPlaybooksBlock(executionModel.researchPlaybooks ?? [])}

## Checklist

You MUST complete these steps in order:

${checklistItems}

${stageExamples(stage)}

## Interaction Protocol

These are **rules for HOW you interact with the user** during this stage — tone, question shape, decision gating. Ordered steps of *what to do* live in the Checklist; do not treat these as an alternative sequence.

${interactionFocus.length > 0 ? interactionFocus.map((item, i) => `${i + 1}. ${item}`).join("\n") : "- Keep communication concise and decision-focused; rely on the Checklist for execution order."}

Decision protocol: ask only decision-changing questions, record the chosen option, rationale, risk, and rollback when the stage makes a non-trivial call.

${batchExecutionModeBlock(stage, track)}
## Required Gates
${gateList}

## Required Evidence
${evidenceList}

${verificationBlock(stage)}

## Exit Criteria
${executionModel.exitCriteria.map((item) => `- [ ] ${item}`).join("\n")}

${completionParametersBlock(schema, track)}
## Artifact Rules
- Artifact target: \`${RUNTIME_ROOT}/artifacts/${artifactRules.artifactFile}\`

${crossStageTraceBlock(artifactRules.crossStageTrace)}
${artifactValidationBlock(artifactRules.artifactValidation)}

## Review Lens
${reviewLoopSection ? `${reviewLoopSection}\n` : ""}## Outputs
${reviewLens.outputs.map((item) => `- ${item}`).join("\n")}

${reviewSectionsBlock(reviewLens.reviewSections)}

## Shared Stage Guidance
- Follow the handoff menu: advance, revise, pause, rewind, or archive only when the user explicitly chooses it.
- Carry upstream decisions forward explicitly; record drift instead of silently changing direction.
- Before closeout, fill \`## Learnings\` with \`- None this stage.\` or 1-3 strict JSON bullets.
- Keep decisions explicit: context, options, chosen option, rationale, risk, and rollback.
`;
}
