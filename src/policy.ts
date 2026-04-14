import fs from "node:fs/promises";
import path from "node:path";
import { COMMAND_FILE_ORDER, RUNTIME_ROOT } from "./constants.js";
import { stageSchema, stagePolicyNeedles } from "./content/stage-schema.js";
import { stageSkillFolder } from "./content/skills.js";
import { exists } from "./fs-utils.js";

interface PolicyRule {
  filePath: string;
  needle: string;
  name: string;
}

const POLICY_RULES: PolicyRule[] = [];

export interface PolicyCheck {
  name: string;
  ok: boolean;
  details: string;
}

export async function policyChecks(projectRoot: string): Promise<PolicyCheck[]> {
  const checks: PolicyCheck[] = [];
  const rules = [...POLICY_RULES];

  for (const stage of COMMAND_FILE_ORDER) {
    const folder = stageSkillFolder(stage);
    const schema = stageSchema(stage);
    const commandFile = `${RUNTIME_ROOT}/commands/${stage}.md`;
    const skillFile = `${RUNTIME_ROOT}/skills/${folder}/SKILL.md`;

    // --- thin command mandatory sections ---
    for (const heading of [
      "## HARD-GATE",
      "## Gates",
      "## Exit",
      "## Anchors",
      "## Context Hydration"
    ]) {
      rules.push({
        filePath: commandFile,
        needle: heading,
        name: `command:${stage}:section:${heading.replace(/^## /, "").toLowerCase().replace(/[^a-z0-9]+/g, "_")}`
      });
    }

    // --- command must reference the skill ---
    rules.push({
      filePath: commandFile,
      needle: `${folder}/SKILL.md`,
      name: `command:${stage}:skill_ref`
    });

    // --- skill mandatory sections ---
    for (const heading of [
      "## Process",
      "## Verification",
      "## Interaction Protocol",
      "## Common Rationalizations",
      "## Red Flags",
      "## HARD-GATE",
      "## Checklist",
      "## Context Loading",
      "## Automatic Subagent Dispatch",
      "## Cognitive Patterns",
      "## Cross-Stage Traceability",
      "## Completion Status",
      "## Artifact Validation"
    ]) {
      rules.push({
        filePath: skillFile,
        needle: heading,
        name: `skill:${stage}:section:${heading.replace(/^## /, "").toLowerCase().replace(/[^a-z0-9]+/g, "_")}`
      });
    }

    // --- gate IDs in skills ---
    for (const gate of schema.requiredGates) {
      rules.push({
        filePath: skillFile,
        needle: `\`${gate.id}\``,
        name: `skill:${stage}:gate:${gate.id}`
      });
    }

    // --- verification section for build/review/ship skills ---
    if (["build", "review", "ship"].includes(stage)) {
      rules.push({
        filePath: skillFile,
        needle: "## Verification Before Completion",
        name: `skill:${stage}:section:verification_before_completion`
      });
    }

    // --- policy needles in commands ---
    for (const needle of stagePolicyNeedles(stage)) {
      rules.push({
        filePath: commandFile,
        needle,
        name: `command:${stage}:anchor:${needle.toLowerCase().replace(/[^a-z0-9]+/g, "_")}`
      });
    }
  }

  // --- utility skill checks ---
  const runtimeFile = (relativePath: string): string => `${RUNTIME_ROOT}/${relativePath}`;
  const utilitySkillChecks: Array<{ file: string; needle: string; name: string }> = [
    { file: runtimeFile("skills/learnings/SKILL.md"), needle: "## Learning Entry Schema", name: "utility_skill:learnings:schema" },
    { file: runtimeFile("skills/learnings/SKILL.md"), needle: "## Subcommands", name: "utility_skill:learnings:subcommands" },
    { file: runtimeFile("skills/learnings/SKILL.md"), needle: "## Confidence Decay", name: "utility_skill:learnings:decay" },
    { file: runtimeFile("skills/learnings/SKILL.md"), needle: "## HARD-GATE", name: "utility_skill:learnings:hard_gate" },
    { file: runtimeFile("skills/autoplan/SKILL.md"), needle: "## Phase Sequence", name: "utility_skill:autoplan:phases" },
    { file: runtimeFile("skills/autoplan/SKILL.md"), needle: "Decision Principles", name: "utility_skill:autoplan:principles" },
    { file: runtimeFile("skills/autoplan/SKILL.md"), needle: "## Decision Taxonomy", name: "utility_skill:autoplan:taxonomy" },
    { file: runtimeFile("skills/autoplan/SKILL.md"), needle: "## HARD-GATE", name: "utility_skill:autoplan:hard_gate" },
    { file: runtimeFile("skills/autoplan/SKILL.md"), needle: "## Restore Points", name: "utility_skill:autoplan:restore_points" },
    { file: runtimeFile("commands/learn.md"), needle: "## Subcommands", name: "utility_command:learn:subcommands" },
    { file: runtimeFile("commands/autoplan.md"), needle: "## Phase Sequence", name: "utility_command:autoplan:phases" },
    { file: runtimeFile("commands/autoplan.md"), needle: "## Decision Principles", name: "utility_command:autoplan:principles" },
    { file: runtimeFile("skills/subagent-dev/SKILL.md"), needle: "## HARD-GATE", name: "utility_skill:sdd:hard_gate" },
    { file: runtimeFile("skills/subagent-dev/SKILL.md"), needle: "## Status Contract", name: "utility_skill:sdd:status_contract" },
    { file: runtimeFile("skills/subagent-dev/SKILL.md"), needle: "Implementer", name: "utility_skill:sdd:implementer_template" },
    { file: runtimeFile("skills/parallel-dispatch/SKILL.md"), needle: "## HARD-GATE", name: "utility_skill:parallel:hard_gate" },
    { file: runtimeFile("skills/parallel-dispatch/SKILL.md"), needle: "Review Army", name: "utility_skill:parallel:review_army" },
    { file: runtimeFile("skills/parallel-dispatch/SKILL.md"), needle: "Reconciliation", name: "utility_skill:parallel:reconciliation" },
    { file: runtimeFile("skills/session/SKILL.md"), needle: "## HARD-GATE", name: "utility_skill:session:hard_gate" },
    { file: runtimeFile("skills/session/SKILL.md"), needle: "## Session Start Protocol", name: "utility_skill:session:start" },
    { file: runtimeFile("skills/session/SKILL.md"), needle: "## Session Stop Protocol", name: "utility_skill:session:stop" },

    { file: runtimeFile("skills/using-cclaw/SKILL.md"), needle: "## Skill Discovery Flowchart", name: "meta_skill:discovery" },
    { file: runtimeFile("skills/using-cclaw/SKILL.md"), needle: "## Activation Rules", name: "meta_skill:activation" },
    { file: runtimeFile("skills/using-cclaw/SKILL.md"), needle: "## Stage Quick Reference", name: "meta_skill:reference" },
    { file: runtimeFile("skills/using-cclaw/SKILL.md"), needle: "## Failure Modes", name: "meta_skill:failure_modes" },
    { file: runtimeFile("skills/using-cclaw/SKILL.md"), needle: "## Contextual Skills", name: "meta_skill:contextual_skills" },
    { file: runtimeFile("skills/using-cclaw/SKILL.md"), needle: "## Decision Protocol", name: "meta_skill:decision_protocol" },
    { file: runtimeFile("skills/session/SKILL.md"), needle: "## Session Resume Protocol", name: "utility_skill:session:resume" },

    { file: runtimeFile("skills/security/SKILL.md"), needle: "## HARD-GATE", name: "utility_skill:security:hard_gate" },
    { file: runtimeFile("skills/security/SKILL.md"), needle: "## Checklist", name: "utility_skill:security:checklist" },
    { file: runtimeFile("skills/security/SKILL.md"), needle: "## Severity Classification", name: "utility_skill:security:severity" },

    { file: runtimeFile("skills/debugging/SKILL.md"), needle: "## HARD-GATE", name: "utility_skill:debugging:hard_gate" },
    { file: runtimeFile("skills/debugging/SKILL.md"), needle: "## The Protocol", name: "utility_skill:debugging:protocol" },
    { file: runtimeFile("skills/debugging/SKILL.md"), needle: "Step 1 — Reproduce", name: "utility_skill:debugging:reproduce" },
    { file: runtimeFile("skills/debugging/SKILL.md"), needle: "## Testing-Specific Anti-Patterns", name: "utility_skill:debugging:test_antipatterns" },

    { file: runtimeFile("skills/performance/SKILL.md"), needle: "## HARD-GATE", name: "utility_skill:performance:hard_gate" },
    { file: runtimeFile("skills/performance/SKILL.md"), needle: "## Workflow", name: "utility_skill:performance:workflow" },
    { file: runtimeFile("skills/performance/SKILL.md"), needle: "## Core Web Vitals Reference", name: "utility_skill:performance:cwv" },

    { file: runtimeFile("skills/ci-cd/SKILL.md"), needle: "## HARD-GATE", name: "utility_skill:cicd:hard_gate" },
    { file: runtimeFile("skills/ci-cd/SKILL.md"), needle: "## Quality Gate Pipeline", name: "utility_skill:cicd:pipeline" },
    { file: runtimeFile("skills/ci-cd/SKILL.md"), needle: "## CI Debugging Protocol", name: "utility_skill:cicd:debugging" },

    { file: runtimeFile("skills/docs/SKILL.md"), needle: "## HARD-GATE", name: "utility_skill:docs:hard_gate" },
    { file: runtimeFile("skills/docs/SKILL.md"), needle: "## ADR (Architecture Decision Record)", name: "utility_skill:docs:adr" },
    { file: runtimeFile("skills/docs/SKILL.md"), needle: "## README Guidance", name: "utility_skill:docs:readme" },

    { file: runtimeFile("hooks/session-start.sh"), needle: "ACTIVE_RUN=", name: "hooks:session_start:active_run" },
    { file: runtimeFile("hooks/session-start.sh"), needle: "checkpoint.json", name: "hooks:session_start:checkpoint_ref" },
    { file: runtimeFile("hooks/session-start.sh"), needle: "stage-activity.jsonl", name: "hooks:session_start:activity_ref" },
    { file: runtimeFile("hooks/session-start.sh"), needle: "suggestion-memory.json", name: "hooks:session_start:suggestion_memory" },
    { file: runtimeFile("hooks/session-start.sh"), needle: "context-warnings.jsonl", name: "hooks:session_start:context_warning_ref" },
    { file: runtimeFile("hooks/stop-checkpoint.sh"), needle: "checkpoint.json", name: "hooks:stop:checkpoint_write" },
    { file: runtimeFile("hooks/prompt-guard.sh"), needle: "write_to_cclaw_runtime", name: "hooks:guard:risky_write_advisory" },
    { file: runtimeFile("hooks/context-monitor.sh"), needle: "remaining is", name: "hooks:context:threshold_warning" },
    { file: runtimeFile("hooks/observe.sh"), needle: "stage-activity.jsonl", name: "hooks:observe:activity_write" },
    { file: runtimeFile("hooks/summarize-observations.mjs"), needle: "frequent-errors-", name: "hooks:summarize:runtime_module" },
    { file: runtimeFile("hooks/opencode-plugin.mjs"), needle: "activeRunId", name: "hooks:opencode:active_run" },
    { file: ".opencode/plugins/cclaw-plugin.mjs", needle: "\"tool.execute.before\"", name: "hooks:opencode:deployed_tool_hook" }
  ];

  for (const check of utilitySkillChecks) {
    rules.push({
      filePath: check.file,
      needle: check.needle,
      name: check.name
    });
  }

  const contentCache = new Map<string, string | null>();
  const readCached = async (filePath: string): Promise<string | null> => {
    if (contentCache.has(filePath)) {
      return contentCache.get(filePath) ?? null;
    }
    if (!(await exists(filePath))) {
      contentCache.set(filePath, null);
      return null;
    }
    const content = await fs.readFile(filePath, "utf8");
    contentCache.set(filePath, content);
    return content;
  };

  for (const rule of rules) {
    const filePath = path.join(projectRoot, rule.filePath);
    const content = await readCached(filePath);
    if (content === null) {
      checks.push({
        name: rule.name,
        ok: false,
        details: `${filePath} not found`
      });
      continue;
    }

    checks.push({
      name: rule.name,
      ok: content.includes(rule.needle),
      details: `expect "${rule.needle}" in ${filePath}`
    });
  }

  return checks;
}
