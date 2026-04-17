import { HARNESS_ADAPTERS, harnessTier } from "../harness-adapters.js";
import type { HarnessId } from "../types.js";
import { HOOK_EVENTS_BY_HARNESS, HOOK_SEMANTIC_EVENTS } from "./hook-events.js";

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
  return "manual fallback only";
}

export function harnessIntegrationDocMarkdown(): string {
  const harnesses = Object.keys(HARNESS_ADAPTERS) as HarnessId[];
  const capabilityRows = harnesses
    .map((harness) => {
      const adapter = HARNESS_ADAPTERS[harness];
      const tier = harnessTier(harness);
      return `| ${harnessTitle(harness)} | \`${harness}\` | \`${tier}\` (${tierDescription(tier)}) | ${adapter.capabilities.nativeSubagentDispatch} | ${adapter.capabilities.hookSurface} | ${adapter.capabilities.structuredAsk} |`;
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

| Harness | ID | Tier | Native subagent dispatch | Hook surface | Structured ask |
|---|---|---|---|---|---|
${capabilityRows}

## Semantic hook event coverage

| Event | Claude | Cursor | OpenCode | Codex |
|---|---|---|---|---|
${hookRows}

## Interpretation

- \`tier1\`: full native delegation + structured asks + full hook surface.
- \`tier2\`: usable flow with capability gaps; mandatory delegation can require waivers.
- \`tier3\`: manual-only fallback; no native automation guarantees.

## Shared command contract

All harnesses receive the same utility commands:

- \`/cc\` - flow entry and resume
- \`/cc-next\` - stage progression
- \`/cc-learn\` - knowledge capture/lookup
- \`/cc-status\` - read-only flow snapshot
- \`/cc-feature\` - multi-feature workspace management
- \`/cc-retro\` - mandatory retrospective gate before archive
- \`/cc-rewind\` - rewind flow and invalidate downstream stages
- \`/cc-rewind-ack\` - clear stale stage markers after redo

Stage order remains canonical:
\`brainstorm -> scope -> design -> spec -> plan -> tdd -> review -> ship\`

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
- \`codex\`: \`.codex/commands/cc*.md\`, \`.codex/hooks.json\`

## Runtime observability

- \`.cclaw/state/harness-gaps.json\` captures per-harness capability gaps for the active config.
- \`cclaw doctor\` validates shim, hook, and lifecycle surfaces against this capability model.
`;
}

