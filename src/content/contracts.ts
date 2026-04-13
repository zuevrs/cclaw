import type { FlowStage } from "../types.js";
import { nextCclawCommand, stageSchema } from "./stage-schema.js";
import { stageSkillFolder } from "./skills.js";

export function commandContract(stage: FlowStage): string {
  const schema = stageSchema(stage);
  const nextCommand = nextCclawCommand(stage);
  const skillPath = `.cclaw/skills/${stageSkillFolder(stage)}/SKILL.md`;
  const reads = schema.crossStageTrace.readsFrom;
  const readsLine = reads.length > 0 ? reads.join(", ") : "(first stage)";
  const hydrationLines = reads.length > 0
    ? reads
      .map((readPath) => {
        const parts = readPath.split("/");
        const fileName = parts[parts.length - 1] ?? readPath;
        return `- Canonical: \`.cclaw/runs/<activeRunId>/artifacts/${fileName}\` (fallback: \`${readPath}\`)`;
      })
      .join("\n")
    : "- (first stage — no upstream artifacts)";

  const gateIds = schema.requiredGates
    .map((g) => `\`${g.id}\``)
    .join(", ");

  return `# /cc-${stage}

Load and follow **${skillPath}** — it contains the full checklist, examples, interaction protocol, and verification discipline.

## HARD-GATE
${schema.hardGate}

## In / Out
- **Reads:** ${readsLine}
- **Writes:** \`.cclaw/artifacts/${schema.artifactFile}\` (canonical run copy: \`.cclaw/runs/<activeRunId>/artifacts/${schema.artifactFile}\`)
- **Next:** ${nextCommand}

## Context Hydration (mandatory before stage work)
1. Read \`.cclaw/state/flow-state.json\` and capture \`activeRunId\`.
2. Resolve canonical artifact root: \`.cclaw/runs/<activeRunId>/artifacts/\`.
3. Load required upstream artifacts for this stage:
${hydrationLines}
4. If a canonical run artifact is missing, fallback to the matching file under \`.cclaw/artifacts/\` and record that fallback in the stage artifact.
5. Write stage output to \`.cclaw/artifacts/${schema.artifactFile}\` and keep canonical run copy aligned at \`.cclaw/runs/<activeRunId>/artifacts/${schema.artifactFile}\`.

## Gates
${gateIds}

## Exit
${schema.exitCriteria.map((v) => `- ${v}`).join("\n")}

## Anchors
${schema.policyNeedles.map((v) => `- ${v}`).join("\n")}
`;
}
