import fs from "node:fs/promises";
import path from "node:path";
import { RUNTIME_ROOT } from "./constants.js";
import { FLOW_STAGES } from "./types.js";
import { stageSchema, stagePolicyNeedles } from "./content/stage-schema.js";
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
    { file: runtimeFile("skills/learnings/SKILL.md"), needle: "strict JSONL schema", name: "utility_skill:learnings:jsonl_schema" },
    { file: runtimeFile("skills/learnings/SKILL.md"), needle: "knowledge.jsonl", name: "utility_skill:learnings:jsonl_store" },
    { file: runtimeFile("skills/learnings/SKILL.md"), needle: "type, trigger, action, confidence, domain, stage, origin_stage, origin_feature, frequency, universality, maturity, created, first_seen_ts, last_seen_ts, project", name: "utility_skill:learnings:field_order" },
    { file: runtimeFile("skills/learnings/SKILL.md"), needle: "## Subcommands", name: "utility_skill:learnings:subcommands" },
    { file: runtimeFile("skills/learnings/SKILL.md"), needle: "## HARD-GATE", name: "utility_skill:learnings:hard_gate" },
    { file: runtimeFile("commands/learn.md"), needle: "## Subcommands", name: "utility_command:learn:subcommands" },
    { file: runtimeFile("commands/ideate.md"), needle: "## Algorithm", name: "utility_command:ideate:algorithm" },
    { file: runtimeFile("skills/flow-ideate/SKILL.md"), needle: "## Protocol", name: "utility_skill:ideate:protocol" },
    { file: runtimeFile("skills/flow-ideate/SKILL.md"), needle: "## HARD-GATE", name: "utility_skill:ideate:hard_gate" },
    { file: runtimeFile("commands/status.md"), needle: "bar:", name: "utility_command:status:visual_bar" },
    { file: runtimeFile("commands/status.md"), needle: "/cc-view tree · /cc-view diff", name: "utility_command:status:tree_diff_link" },
    { file: runtimeFile("commands/tree.md"), needle: "## Algorithm", name: "utility_command:tree:algorithm" },
    { file: runtimeFile("skills/flow-tree/SKILL.md"), needle: "## Protocol", name: "utility_skill:tree:protocol" },
    { file: runtimeFile("skills/flow-tree/SKILL.md"), needle: "## HARD-GATE", name: "utility_skill:tree:hard_gate" },
    { file: runtimeFile("commands/diff.md"), needle: "## Algorithm", name: "utility_command:diff:algorithm" },
    { file: runtimeFile("skills/flow-diff/SKILL.md"), needle: "## Protocol", name: "utility_skill:diff:protocol" },
    { file: runtimeFile("skills/flow-diff/SKILL.md"), needle: "## HARD-GATE", name: "utility_skill:diff:hard_gate" },
    { file: runtimeFile("commands/feature.md"), needle: "## Subcommands", name: "utility_command:feature:subcommands" },
    { file: runtimeFile("skills/using-git-worktrees/SKILL.md"), needle: "## Protocol", name: "utility_skill:feature:protocol" },
    { file: runtimeFile("skills/using-git-worktrees/SKILL.md"), needle: "## HARD-GATE", name: "utility_skill:feature:hard_gate" },
    { file: runtimeFile("commands/tdd-log.md"), needle: "## Subcommands", name: "utility_command:tdd_log:subcommands" },
    { file: runtimeFile("skills/tdd-cycle-log/SKILL.md"), needle: "## Protocol", name: "utility_skill:tdd_log:protocol" },
    { file: runtimeFile("skills/tdd-cycle-log/SKILL.md"), needle: "## HARD-GATE", name: "utility_skill:tdd_log:hard_gate" },
    { file: runtimeFile("commands/retro.md"), needle: "## Algorithm", name: "utility_command:retro:algorithm" },
    { file: runtimeFile("skills/flow-retro/SKILL.md"), needle: "## Protocol", name: "utility_skill:retro:protocol" },
    { file: runtimeFile("skills/flow-retro/SKILL.md"), needle: "## HARD-GATE", name: "utility_skill:retro:hard_gate" },
    { file: runtimeFile("commands/compound.md"), needle: "## Algorithm", name: "utility_command:compound:algorithm" },
    { file: runtimeFile("skills/flow-compound/SKILL.md"), needle: "## Protocol", name: "utility_skill:compound:protocol" },
    { file: runtimeFile("skills/flow-compound/SKILL.md"), needle: "## HARD-GATE", name: "utility_skill:compound:hard_gate" },
    { file: runtimeFile("commands/rewind.md"), needle: "## Algorithm", name: "utility_command:rewind:algorithm" },
    { file: runtimeFile("skills/flow-rewind/SKILL.md"), needle: "## Protocol", name: "utility_skill:rewind:protocol" },
    { file: runtimeFile("skills/flow-rewind/SKILL.md"), needle: "## HARD-GATE", name: "utility_skill:rewind:hard_gate" },
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
    { file: runtimeFile("skills/using-cclaw/SKILL.md"), needle: "## Contextual skill activation", name: "meta_skill:contextual_skills" },
    { file: runtimeFile("skills/using-cclaw/SKILL.md"), needle: "## Protocol references", name: "meta_skill:protocol_refs" },
    { file: runtimeFile("skills/using-cclaw/SKILL.md"), needle: "## Failure guardrails", name: "meta_skill:failure_guardrails" },
    { file: runtimeFile("references/protocols/decision.md"), needle: "# Decision Protocol", name: "protocol:decision" },
    { file: runtimeFile("references/protocols/completion.md"), needle: "# Stage Completion Protocol", name: "protocol:completion" },
    { file: runtimeFile("references/protocols/ethos.md"), needle: "# Engineering Ethos", name: "protocol:ethos" },
    { file: runtimeFile("skills/session/SKILL.md"), needle: "## Session Resume Protocol", name: "utility_skill:session:resume" },
    { file: runtimeFile("skills/brainstorming/SKILL.md"), needle: "common-guidance.md", name: "stage_skill:shared_guidance_reference" },

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
    { file: runtimeFile("skills/executing-plans/SKILL.md"), needle: "## HARD-GATE", name: "utility_skill:executing_plans:hard_gate" },
    { file: runtimeFile("skills/executing-plans/SKILL.md"), needle: "## Execution Protocol", name: "utility_skill:executing_plans:protocol" },
    { file: runtimeFile("skills/executing-plans/SKILL.md"), needle: "## Batch Checklist", name: "utility_skill:executing_plans:batches" },
    { file: runtimeFile("skills/verification-before-completion/SKILL.md"), needle: "## HARD-GATE", name: "utility_skill:verification_before_completion:hard_gate" },
    { file: runtimeFile("skills/verification-before-completion/SKILL.md"), needle: "## Protocol", name: "utility_skill:verification_before_completion:protocol" },
    { file: runtimeFile("skills/finishing-a-development-branch/SKILL.md"), needle: "## HARD-GATE", name: "utility_skill:finishing_branch:hard_gate" },
    { file: runtimeFile("skills/finishing-a-development-branch/SKILL.md"), needle: "## Protocol", name: "utility_skill:finishing_branch:protocol" },
    { file: runtimeFile("skills/context-engineering/SKILL.md"), needle: "## HARD-GATE", name: "utility_skill:context_engineering:hard_gate" },
    { file: runtimeFile("skills/context-engineering/SKILL.md"), needle: "## Context Modes", name: "utility_skill:context_engineering:modes" },
    { file: runtimeFile("skills/context-engineering/SKILL.md"), needle: "## Mode Switching Protocol", name: "utility_skill:context_engineering:switch" },
    { file: runtimeFile("skills/source-driven-development/SKILL.md"), needle: "## HARD-GATE", name: "utility_skill:source_driven:hard_gate" },
    { file: runtimeFile("skills/source-driven-development/SKILL.md"), needle: "## Protocol", name: "utility_skill:source_driven:protocol" },
    { file: runtimeFile("skills/source-driven-development/SKILL.md"), needle: "## Selection Heuristics", name: "utility_skill:source_driven:heuristics" },
    { file: runtimeFile("skills/frontend-accessibility/SKILL.md"), needle: "## HARD-GATE", name: "utility_skill:frontend_accessibility:hard_gate" },
    { file: runtimeFile("skills/frontend-accessibility/SKILL.md"), needle: "## Checklist", name: "utility_skill:frontend_accessibility:checklist" },
    { file: runtimeFile("skills/frontend-accessibility/SKILL.md"), needle: "## Anti-Patterns", name: "utility_skill:frontend_accessibility:anti_patterns" },
    { file: runtimeFile("contexts/default.md"), needle: "Context Mode: default", name: "context_mode:default" },
    { file: runtimeFile("contexts/execution.md"), needle: "Context Mode: execution", name: "context_mode:execution" },
    { file: runtimeFile("contexts/review.md"), needle: "Context Mode: review", name: "context_mode:review" },
    { file: runtimeFile("contexts/incident.md"), needle: "Context Mode: incident", name: "context_mode:incident" },

    { file: runtimeFile("hooks/session-start.sh"), needle: "ACTIVE_RUN=", name: "hooks:session_start:active_run" },
    { file: runtimeFile("hooks/session-start.sh"), needle: "checkpoint.json", name: "hooks:session_start:checkpoint_ref" },
    { file: runtimeFile("hooks/session-start.sh"), needle: "stage-activity.jsonl", name: "hooks:session_start:activity_ref" },
    { file: runtimeFile("hooks/session-start.sh"), needle: "suggestion-memory.json", name: "hooks:session_start:suggestion_memory" },
    { file: runtimeFile("hooks/session-start.sh"), needle: "context-warnings.jsonl", name: "hooks:session_start:context_warning_ref" },
    { file: runtimeFile("hooks/stop-checkpoint.sh"), needle: "checkpoint.json", name: "hooks:stop:checkpoint_write" },
    { file: runtimeFile("hooks/prompt-guard.sh"), needle: "write_to_cclaw_runtime", name: "hooks:guard:risky_write_advisory" },
    { file: runtimeFile("hooks/workflow-guard.sh"), needle: "stage_invocation_without_recent_flow_read", name: "hooks:workflow_guard:flow_read_reason" },
    { file: runtimeFile("hooks/workflow-guard.sh"), needle: "stage_jump_", name: "hooks:workflow_guard:stage_jump_reason" },
    { file: runtimeFile("hooks/workflow-guard.sh"), needle: "tdd_write_without_open_red", name: "hooks:workflow_guard:tdd_red_first" },
    { file: runtimeFile("hooks/context-monitor.sh"), needle: "remaining is", name: "hooks:context:threshold_warning" },
    { file: runtimeFile("hooks/opencode-plugin.mjs"), needle: "activeRunId", name: "hooks:opencode:active_run" },
    { file: runtimeFile("hooks/session-start.sh"), needle: "Knowledge digest", name: "hooks:session_start:knowledge_digest" },
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
      needle: "workflow-guard.sh",
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
      needle: "/cc-next",
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
