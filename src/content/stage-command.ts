import { RUNTIME_ROOT } from "../constants.js";
import type { FlowStage } from "../types.js";
import { stageSkillFolder } from "./skills.js";

export function stageCommandShimMarkdown(stage: FlowStage): string {
  const skillPath = `${RUNTIME_ROOT}/skills/${stageSkillFolder(stage)}/SKILL.md`;
  return `# /cc-${stage}

This is a thin compatibility shim for the \`${stage}\` flow stage.

Load and follow the authoritative stage skill:

- \`${skillPath}\`

Normal stage resume and advancement uses \`/cc-next\`. Use \`/cc-next\` to read
\`.cclaw/state/flow-state.json\`, select the active stage, and advance only after
that stage's gates pass. Do not duplicate the stage protocol here.
`;
}
