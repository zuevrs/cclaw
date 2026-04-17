import type { FlowStage } from "../types.js";
import { stageSchema } from "./stage-schema.js";
import { stageSkillFolder } from "./skills.js";

export function commandContract(stage: FlowStage): string {
  const schema = stageSchema(stage);
  const skillPath = `.cclaw/skills/${stageSkillFolder(stage)}/SKILL.md`;
  const reads = schema.crossStageTrace.readsFrom;
  const readsLine = reads.length > 0 ? reads.join(", ") : "(first stage)";
  const hydrationLines = reads.length > 0
    ? reads.map((readPath) => `- \`${readPath}\``).join("\n")
    : "- (first stage — no upstream artifacts)";

  const gateIds = schema.requiredGates
    .map((g) => `\`${g.id}\``)
    .join(", ");

  const writes = schema.crossStageTrace.writesTo;
  const writesLine = writes.map((w) => `\`${w}\``).join(", ");
  const primaryArtifact = `.cclaw/artifacts/${schema.artifactFile}`;
  const writeStepPaths = writes.length > 1
    ? writes.map((w) => `\`${w}\``).join(" and ")
    : `\`${primaryArtifact}\``;

  return `# /cc-${stage}

Load and follow **${skillPath}** — it contains the full checklist, examples, interaction protocol, and verification discipline.

## HARD-GATE
${schema.hardGate}

## In / Out
- **Reads:** ${readsLine}
- **Writes:** ${writesLine}
- **Next:** \`/cc-next\` (updates flow-state and loads the next stage)

## Context Hydration (mandatory before stage work)
1. Read \`.cclaw/state/flow-state.json\`.
2. Resolve active artifact root: \`.cclaw/artifacts/\`.
3. Load required upstream artifacts for this stage:
${hydrationLines}
4. Stream \`.cclaw/knowledge.jsonl\` and apply relevant JSON-line entries (strict schema: type, trigger, action, confidence, domain, stage, created, project).
5. Write stage output to ${writeStepPaths}.
6. Do NOT copy artifacts into \`.cclaw/runs/\`; archival is handled by \`/cc-ops archive\` (agent-facing wrapper over archive runtime).

## Gates
${gateIds}

## Exit
${schema.exitCriteria.map((v) => `- ${v}`).join("\n")}

## Anchors
${schema.policyNeedles.map((v) => `- ${v}`).join("\n")}
`;
}
