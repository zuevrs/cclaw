import fs from "node:fs/promises";
import path from "node:path";
import { RUNTIME_ROOT } from "./constants.js";
import { FLOW_STAGES } from "./types.js";
import { stageSchema } from "./content/stage-schema.js";
import { stageSkillFolder } from "./content/skills.js";
import { exists } from "./fs-utils.js";
import type { HarnessId } from "./types.js";

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

export interface PolicyOptions {
  harnesses?: HarnessId[];
}

const ALL_HARNESSES: HarnessId[] = ["claude", "cursor", "opencode", "codex"];

export async function policyChecks(projectRoot: string, options: PolicyOptions = {}): Promise<PolicyCheck[]> {
  const checks: PolicyCheck[] = [];
  const rules = [...POLICY_RULES];
  const activeHarnesses = new Set<HarnessId>(
    options.harnesses && options.harnesses.length > 0 ? options.harnesses : ALL_HARNESSES
  );

  for (const stage of FLOW_STAGES) {
    const folder = stageSkillFolder(stage);
    const schema = stageSchema(stage);
    const skillFile = `${RUNTIME_ROOT}/skills/${folder}/SKILL.md`;

    // --- skill mandatory sections ---
    for (const heading of [
      "## Process",
      "## Exit Criteria",
      "## Interaction Protocol",
      "## Anti-Patterns & Red Flags",
      "## HARD-GATE",
      "## Checklist",
      "## Context Loading",
      "## Automatic Subagent Dispatch",
      "## Cross-Stage Traceability",
      "## Artifact Validation",
      "## Completion Parameters",
      "## Shared Stage Guidance"
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
    if (["tdd", "review", "ship"].includes(stage)) {
      rules.push({
        filePath: skillFile,
        needle: "## Verification Before Completion",
        name: `skill:${stage}:section:verification_before_completion`
      });
    }
  }

  // --- utility skill checks ---
  const runtimeFile = (relativePath: string): string => `${RUNTIME_ROOT}/${relativePath}`;
  const utilitySkillChecks: Array<{ file: string; needle: string; name: string }> = [
    { file: runtimeFile("skills/learnings/SKILL.md"), needle: "strict JSONL schema", name: "utility_skill:learnings:jsonl_schema" },
    { file: runtimeFile("skills/learnings/SKILL.md"), needle: "knowledge.jsonl", name: "utility_skill:learnings:jsonl_store" },
    { file: runtimeFile("skills/learnings/SKILL.md"), needle: "type, trigger, action, confidence, domain, stage, origin_stage, origin_run, frequency, universality, maturity, created, first_seen_ts, last_seen_ts, project", name: "utility_skill:learnings:field_order" },
    { file: runtimeFile("skills/learnings/SKILL.md"), needle: "## Manual Actions", name: "utility_skill:learnings:manual_actions" },
    { file: runtimeFile("skills/learnings/SKILL.md"), needle: "## HARD-GATE", name: "utility_skill:learnings:hard_gate" },
    { file: runtimeFile("commands/start.md"), needle: "## Algorithm", name: "utility_command:start:algorithm" },
    { file: runtimeFile("commands/ideate.md"), needle: "## Algorithm", name: "utility_command:ideate:algorithm" },
    { file: runtimeFile("skills/flow-ideate/SKILL.md"), needle: "## Protocol", name: "utility_skill:ideate:protocol" },
    { file: runtimeFile("skills/flow-ideate/SKILL.md"), needle: "## HARD-GATE", name: "utility_skill:ideate:hard_gate" },
    { file: runtimeFile("commands/view.md"), needle: "## Routing", name: "utility_command:view:routing" },
    { file: runtimeFile("skills/flow-view/SKILL.md"), needle: "## Status Subcommand", name: "utility_skill:view:status_section" },
    { file: runtimeFile("skills/flow-view/SKILL.md"), needle: "## Tree Subcommand", name: "utility_skill:view:tree_section" },
    { file: runtimeFile("skills/flow-view/SKILL.md"), needle: "## Diff Subcommand", name: "utility_skill:view:diff_section" },
    { file: runtimeFile("skills/subagent-dev/SKILL.md"), needle: "## HARD-GATE", name: "utility_skill:sdd:hard_gate" },
    { file: runtimeFile("skills/subagent-dev/SKILL.md"), needle: "## Status Contract", name: "utility_skill:sdd:status_contract" },
    { file: runtimeFile("skills/subagent-dev/SKILL.md"), needle: "Implementer", name: "utility_skill:sdd:implementer_template" },
    { file: runtimeFile("skills/subagent-dev/SKILL.md"), needle: "## Model & Harness Routing Notes", name: "utility_skill:sdd:routing_notes" },
    { file: runtimeFile("skills/parallel-dispatch/SKILL.md"), needle: "## HARD-GATE", name: "utility_skill:parallel:hard_gate" },
    { file: runtimeFile("skills/parallel-dispatch/SKILL.md"), needle: "Review Army", name: "utility_skill:parallel:review_army" },
    { file: runtimeFile("skills/parallel-dispatch/SKILL.md"), needle: "Reconciliation", name: "utility_skill:parallel:reconciliation" },
    { file: runtimeFile("skills/parallel-dispatch/SKILL.md"), needle: "## Model & Harness Routing Notes", name: "utility_skill:parallel:routing_notes" },
    { file: runtimeFile("skills/research/repo-scan.md"), needle: "# Repo Scan Playbook", name: "utility_skill:research:repo_scan" },
    { file: runtimeFile("skills/research/learnings-lookup.md"), needle: "# Learnings Lookup Playbook", name: "utility_skill:research:learnings_lookup" },
    { file: runtimeFile("skills/research/framework-docs-lookup.md"), needle: "# Framework Docs Lookup Playbook", name: "utility_skill:research:framework_docs_lookup" },
    { file: runtimeFile("skills/research/best-practices-lookup.md"), needle: "# Best Practices Lookup Playbook", name: "utility_skill:research:best_practices_lookup" },
    { file: runtimeFile("skills/research/git-history.md"), needle: "# Git History Playbook", name: "utility_skill:research:git_history" },
    { file: runtimeFile("skills/session/SKILL.md"), needle: "## HARD-GATE", name: "utility_skill:session:hard_gate" },
    { file: runtimeFile("skills/session/SKILL.md"), needle: "## Session Start Protocol", name: "utility_skill:session:start" },
    { file: runtimeFile("skills/session/SKILL.md"), needle: "## Session Stop Protocol", name: "utility_skill:session:stop" },

    { file: runtimeFile("skills/using-cclaw/SKILL.md"), needle: "## Routing flow", name: "meta_skill:routing_flow" },
    { file: runtimeFile("skills/using-cclaw/SKILL.md"), needle: "## Task classification", name: "meta_skill:task_classification" },
    { file: runtimeFile("skills/using-cclaw/SKILL.md"), needle: "## Stage quick map", name: "meta_skill:stage_quick_map" },
    { file: runtimeFile("skills/using-cclaw/SKILL.md"), needle: "## Whole flow map", name: "meta_skill:whole_flow_map" },
    { file: runtimeFile("skills/using-cclaw/SKILL.md"), needle: "retro -> compound -> archive", name: "meta_skill:closeout_chain" },
    { file: runtimeFile("skills/using-cclaw/SKILL.md"), needle: "## Contextual Skill Activation", name: "meta_skill:contextual_skills" },
    { file: runtimeFile("skills/using-cclaw/SKILL.md"), needle: "## Protocol Behavior", name: "meta_skill:protocol_behavior" },
    { file: runtimeFile("skills/using-cclaw/SKILL.md"), needle: "## Failure guardrails", name: "meta_skill:failure_guardrails" },
    { file: runtimeFile("skills/session/SKILL.md"), needle: "## Session Resume Protocol", name: "utility_skill:session:resume" },
    { file: runtimeFile("skills/brainstorm/SKILL.md"), needle: "## Shared Stage Guidance", name: "stage_skill:shared_guidance_inline" },


    { file: runtimeFile("hooks/run-hook.mjs"), needle: "activeRunId", name: "hooks:session_start:active_run" },
    { file: runtimeFile("hooks/run-hook.mjs"), needle: "write_to_cclaw_runtime", name: "hooks:guard:risky_write_advisory" },
    { file: runtimeFile("hooks/run-hook.mjs"), needle: "stage_invocation_without_recent_flow_read", name: "hooks:workflow_guard:flow_read_reason" },
    { file: runtimeFile("hooks/run-hook.mjs"), needle: "stage_jump_", name: "hooks:workflow_guard:stage_jump_reason" },
    { file: runtimeFile("hooks/run-hook.mjs"), needle: "tdd_write_without_open_red", name: "hooks:workflow_guard:tdd_red_first" },
    { file: runtimeFile("hooks/run-hook.mjs"), needle: "context remaining is", name: "hooks:context:threshold_warning" },
    { file: runtimeFile("hooks/opencode-plugin.mjs"), needle: "activeRunId", name: "hooks:opencode:active_run" },
    { file: runtimeFile("hooks/run-hook.mjs"), needle: "Knowledge digest", name: "hooks:session_start:knowledge_digest" },
    { file: runtimeFile("hooks/opencode-plugin.mjs"), needle: "Knowledge digest", name: "hooks:opencode:knowledge_digest" }
  ];
  if (activeHarnesses.has("opencode")) {
    utilitySkillChecks.push({
      file: ".opencode/plugins/cclaw-plugin.mjs",
      needle: "\"tool.execute.before\"",
      name: "hooks:opencode:deployed_tool_hook"
    });
    utilitySkillChecks.push({
      file: ".opencode/plugins/cclaw-plugin.mjs",
      needle: "workflow-guard",
      name: "hooks:opencode:deployed_workflow_guard"
    });
  }
  if (activeHarnesses.has("cursor")) {
    utilitySkillChecks.push({
      file: ".cursor/rules/cclaw-workflow.mdc",
      needle: "cclaw-managed-cursor-workflow-rule",
      name: "rules:cursor:managed_marker"
    });
    utilitySkillChecks.push({
      file: ".cursor/rules/cclaw-workflow.mdc",
      needle: "/cc",
      name: "rules:cursor:next_command_guidance"
    });
  }

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
