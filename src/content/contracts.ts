import type { FlowStage } from "../types.js";
import { stageSchema } from "./stage-schema.js";
import { stageSkillFolder } from "./skills.js";

export function commandContract(stage: FlowStage): string {
  const schema = stageSchema(stage);
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
- **Writes:** \`.cclaw/artifacts/${schema.artifactFile}\` (run snapshot under \`.cclaw/runs/<activeRunId>/artifacts/${schema.artifactFile}\` is synchronized by cclaw runtime)
- **Next:** \`/cc-next\` (updates flow-state and loads the next stage)

## Context Hydration (mandatory before stage work)
1. Read \`.cclaw/state/flow-state.json\` and capture \`activeRunId\`.
2. Resolve canonical artifact root: \`.cclaw/runs/<activeRunId>/artifacts/\`.
3. Load required upstream artifacts for this stage:
${hydrationLines}
4. If a canonical run artifact is missing, fallback to the matching file under \`.cclaw/artifacts/\` and record that fallback in the stage artifact.
5. Write stage output to \`.cclaw/artifacts/${schema.artifactFile}\`. Do NOT manually copy into run directories; cclaw sync/runtime keeps run snapshots aligned.

## Gates
${gateIds}

## Exit
${schema.exitCriteria.map((v) => `- ${v}`).join("\n")}

## Anchors
${schema.policyNeedles.map((v) => `- ${v}`).join("\n")}
`;
}
