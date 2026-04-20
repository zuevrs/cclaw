import { HARNESS_ADAPTERS, harnessTier } from "../harness-adapters.js";
import type { HarnessId } from "../types.js";
import { STAGE_TO_SKILL_FOLDER } from "../constants.js";
import { HOOK_EVENTS_BY_HARNESS, HOOK_SEMANTIC_EVENTS } from "./hook-events.js";
import {
  HARNESS_PLAYBOOKS_DIR,
  harnessPlaybookFileName
} from "./harness-playbooks.js";
import { HARNESS_TOOL_REFS_DIR } from "./harness-tool-refs.js";

function harnessTitle(harness: HarnessId): string {
  switch (harness) {
    case "claude":
      return "Claude Code";
    case "cursor":
      return "Cursor";
    case "opencode":
      return "OpenCode";
    case "codex":
      return "OpenAI Codex";
  }
}

function tierDescription(tier: string): string {
  if (tier === "tier1") return "full native automation";
  if (tier === "tier2") return "partial automation with waivers";
  return "compatibility shim";
}

export function harnessIntegrationDocMarkdown(): string {
  const harnesses = Object.keys(HARNESS_ADAPTERS) as HarnessId[];
  const stageSkillRows = Object.entries(STAGE_TO_SKILL_FOLDER)
    .map(([stage, skillFolder]) => `| \`${stage}\` | \`${skillFolder}\` |`)
    .join("\n");
  const hookCasingRows = [
    "| Claude Code | `claude` | PascalCase (`SessionStart`, `PreToolUse`) |",
    "| Cursor | `cursor` | camelCase (`sessionStart`, `preToolUse`) |",
    "| OpenCode | `opencode` | camelCase (`sessionStart`, `preToolUse`) |",
    "| OpenAI Codex | `codex` | PascalCase (`SessionStart`, `PreToolUse`) |"
  ].join("\n");
  const capabilityRows = harnesses
    .map((harness) => {
      const adapter = HARNESS_ADAPTERS[harness];
      const tier = harnessTier(harness);
      const caps = adapter.capabilities;
      const playbook = `\`${HARNESS_PLAYBOOKS_DIR}/${harnessPlaybookFileName(harness)}\``;
      return `| ${harnessTitle(harness)} | \`${harness}\` | \`${tier}\` (${tierDescription(tier)}) | ${caps.nativeSubagentDispatch} | ${caps.subagentFallback} | ${caps.hookSurface} | ${caps.structuredAsk} | ${playbook} |`;
    })
    .join("\n");

  const hookRows = HOOK_SEMANTIC_EVENTS.map((eventName) => {
    const columns = harnesses
      .map((harness) => {
        const mapping = HOOK_EVENTS_BY_HARNESS[harness][eventName];
        return mapping ?? "missing";
      })
      .join(" | ");
    return `| \`${eventName}\` | ${columns} |`;
  }).join("\n");

  return `# Harness Integration Matrix

Generated from \`src/harness-adapters.ts\` capabilities and hook event mappings.

## Capability tiers

| Harness | ID | Tier | Native dispatch | Fallback | Hook surface | Structured ask | Playbook |
|---|---|---|---|---|---|---|---|
${capabilityRows}

Fallback legend:

- \`native\` — first-class named subagent dispatch (Claude).
- \`generic-dispatch\` — generic Task dispatcher mapped to cclaw roles (Cursor).
- \`role-switch\` — in-session role announce + delegation-log entry with evidenceRefs (OpenCode, Codex).
- \`waiver\` — no parity path; reserved for harnesses that cannot role-switch (none shipped).

## Parallel research dispatch semantics

Design-stage research fleet uses the same parity model:

- **Claude / Cursor**: dispatch all four research lenses in one turn
  (stack, features, architecture, pitfalls) and synthesize into
  \`.cclaw/artifacts/02a-research.md\`.
- **OpenCode / Codex**: execute the same four lenses via sequential
  role-switch, each with explicit announce -> execute -> evidence trail.
  This preserves auditability when native parallel dispatch is unavailable.

## Semantic hook event coverage

| Event | Claude | Cursor | OpenCode | Codex |
|---|---|---|---|---|
${hookRows}

## Hook event casing

Hook keys are intentionally harness-native and must not be normalized:

| Harness | ID | Event key casing |
|---|---|---|
${hookCasingRows}

Use the exact event names from each harness schema. Treating all hooks as one
shared casing silently breaks generated wiring.

## Interpretation

- \`tier1\`: full native delegation + structured asks + full hook surface.
- \`tier2\`: usable flow with capability gaps; mandatory delegation can require waivers.
- Codex-specific ceiling: \`PreToolUse\` can only intercept \`Bash\`. Direct
  \`Write\`/\`Edit\` to \`.cclaw/state/flow-state.json\` cannot be hard-blocked
  at hook level, so the canonical path is
  \`bash .cclaw/hooks/stage-complete.sh <stage>\` plus the non-blocking
  \`UserPromptSubmit\` state nudge.

## Shared command contract

All harnesses receive the same utility commands:

- \`/cc\` - flow entry and resume
- \`/cc-next\` - stage progression
- \`/cc-ideate\` - ideate mode for ranked repo-improvement backlog
- \`/cc-view\` - read-only router for status/tree/diff
- \`/cc-ops\` - operations router for feature/tdd-log/retro/compound/archive/rewind

Read-only subcommands:
- \`/cc-view status\` - visual flow snapshot
- \`/cc-view tree\` - deep flow tree (stages, artifacts, stale markers)
- \`/cc-view diff\` - before/after flow-state diff map

Operations subcommands:
- \`/cc-ops feature ...\` - git-worktree feature isolation and routing
- \`/cc-ops tdd-log ...\` - explicit RED/GREEN/REFACTOR evidence log
- \`/cc-ops retro\` - mandatory retrospective gate before archive
- \`/cc-ops compound\` - lift repeated learnings into durable rules/skills
- \`/cc-ops archive\` - archive active run from harness flow
- \`/cc-ops rewind ...\` - rewind flow and invalidate downstream stages
- \`/cc-ops rewind --ack ...\` - clear stale stage markers after redo

Stage order remains canonical:
\`brainstorm -> scope -> design -> spec -> plan -> tdd -> review -> ship\`

## Stage -> skill folder mapping

| Stage | Skill folder |
|---|---|
${stageSkillRows}

This map is generated from \`src/constants.ts::STAGE_TO_SKILL_FOLDER\` so
skill-path naming stays explicit and stable even when stage ids differ from
folder names.

## Install surfaces

Always generated:

- \`.cclaw/commands/*.md\`
- \`.cclaw/skills/*/SKILL.md\`
- \`.cclaw/references/**\`
- \`.cclaw/state/*.json|*.jsonl\`
- \`AGENTS.md\` managed block

Harness-specific additions:

- \`claude\`: \`.claude/commands/cc*.md\`, \`.claude/hooks/hooks.json\`
- \`cursor\`: \`.cursor/commands/cc*.md\`, \`.cursor/hooks.json\`, \`.cursor/rules/cclaw-workflow.mdc\`
- \`opencode\`: \`.opencode/commands/cc*.md\`, \`.opencode/plugins/cclaw-plugin.mjs\`, opencode plugin registration
- \`codex\`: \`.agents/skills/cc/SKILL.md\`, \`.agents/skills/cc-next/SKILL.md\`, \`.agents/skills/cc-ideate/SKILL.md\`, \`.agents/skills/cc-view/SKILL.md\`, \`.agents/skills/cc-ops/SKILL.md\`, \`.codex/hooks.json\` (Codex CLI reads \`.agents/skills/\` for custom skills and consumes \`.codex/hooks.json\` on v0.114+ when \`[features] codex_hooks = true\` is set in \`~/.codex/config.toml\`. \`.codex/commands/\` and the legacy \`.agents/skills/cclaw-cc*/\` layout from v0.39.x are auto-cleaned on sync.)

## Runtime observability

- \`.cclaw/state/harness-gaps.json\` captures per-harness capability gaps for the active config.
- \`cclaw doctor\` validates shim, hook, and lifecycle surfaces against this capability model.
`;
}

export function harnessDocsOverviewMarkdown(): string {
  const harnesses = Object.keys(HARNESS_ADAPTERS) as HarnessId[];
  const rows = harnesses
    .map((harness) => {
      const tier = harnessTier(harness);
      const toolMap = `\`.cclaw/${HARNESS_TOOL_REFS_DIR}/${harness}.md\``;
      const playbook = `\`.cclaw/${HARNESS_PLAYBOOKS_DIR}/${harnessPlaybookFileName(harness)}\``;
      return `| ${harnessTitle(harness)} | \`${harness}\` | \`${tier}\` | ${toolMap} | ${playbook} |`;
    })
    .join("\n");

  return `# Harness Docs Overview

Single entrypoint for harness-specific references generated by cclaw sync.

## Core references

- Integration matrix: \`.cclaw/references/harnesses.md\`
- Tool-map index: \`.cclaw/references/${HARNESS_TOOL_REFS_DIR}/README.md\`
- Playbook index: \`.cclaw/references/${HARNESS_PLAYBOOKS_DIR}/README.md\`

## Per-harness quick links

| Harness | ID | Tier | Tool map | Playbook |
|---|---|---|---|---|
${rows}

## How to use this pack

1. Start with \`harnesses.md\` to understand capability/tier differences.
2. Open the harness-specific tool map before writing stage logic that depends on tool names.
3. Open the harness-specific playbook before asserting delegation parity behavior.
4. If docs disagree, treat \`harnesses.md\` + harness adapter capabilities as source of truth and regenerate.
`;
}

