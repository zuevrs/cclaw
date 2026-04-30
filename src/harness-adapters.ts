import fs from "node:fs/promises";
import path from "node:path";
import { RUNTIME_ROOT } from "./constants.js";
import { conversationLanguagePolicyMarkdown } from "./content/language-policy.js";
import { CCLAW_AGENTS, agentMarkdown } from "./content/core-agents.js";
import { IRON_LAWS } from "./content/iron-laws.js";
import { ensureDir, exists, writeFileSafe } from "./fs-utils.js";
import { type HarnessId } from "./types.js";

export const CCLAW_MARKER_START = "<!-- cclaw-start -->";
export const CCLAW_MARKER_END = "<!-- cclaw-end -->";

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const RUNTIME_AGENTS_BLOCK_SOURCE =
  `${escapeRegExp(CCLAW_MARKER_START)}[\\s\\S]*?${escapeRegExp(CCLAW_MARKER_END)}`;
const RUNTIME_AGENTS_BLOCK_PATTERN = new RegExp(RUNTIME_AGENTS_BLOCK_SOURCE, "u");
const RUNTIME_AGENTS_BLOCK_GLOBAL_PATTERN = new RegExp(RUNTIME_AGENTS_BLOCK_SOURCE, "gu");

export type SubagentFallback =
  /** Harness has real, isolated named subagent dispatch; no fallback needed. */
  | "native"
  /**
   * Harness has a real dispatcher but not cclaw-named agents. cclaw maps each
   * named role to the available built-in/generic subagent surface with a
   * structured role prompt.
   */
  | "generic-dispatch"
  /**
   * No isolated dispatch — the agent performs the named subagent's role
   * in-session with an explicit role announce + delegation-log entry
   * carrying evidenceRefs. Accepted as `completed` only when no true dispatch
   * surface exists.
   */
  | "role-switch"
  /**
   * Reserved escape hatch for future harnesses with no parity path.
   * Current shipped harnesses do not use this fallback.
   */
  | "waiver";

/**
 * How a harness discovers cclaw's `/cc*` entry points.
 *
 * - `command` — harness has a native custom slash-command system and reads
 *   flat markdown files from `<commandDir>/<fileName>.md` (Claude Code,
 *   Cursor, OpenCode).
 * - `skill` — harness ignores flat commands and reads SKILL.md from
 *   directories under a skills root (Codex CLI ≥0.89, Jan 2026). cclaw
 *   writes `<commandDir>/<skillName>/SKILL.md` and the agent invokes it
 *   either via `/use <skillName>` or via automatic description matching
 *   when the user's text mentions `/cc`, `/cc-idea`, or `/cc-cancel`.
 */
export type ShimKind = "command" | "skill";

export interface HarnessAdapter {
  id: HarnessId;
  reality: {
    declaredSupport: "full" | "generic" | "partial" | "none";
    runtimeLaunch: string;
    proofRequired: string;
    proofSource: string;
  };
  /**
   * Root directory where cclaw writes `/cc*` entry points.
   *
   * - For `shimKind: "command"` this is the directory containing flat
   *   markdown files (`<commandDir>/cc.md`, `<commandDir>/cc-idea.md`, …).
   * - For `shimKind: "skill"` this is the skills root that contains
   *   per-skill subdirectories (`<commandDir>/<skillName>/SKILL.md`).
   */
  commandDir: string;
  /** See {@link ShimKind}. Defaults to `"command"` if unspecified at a callsite. */
  shimKind: ShimKind;
  capabilities: {
    /**
     * Level of native subagent dispatch:
     * - `full`    — isolated workers + user-defined named subagents (Claude,
     *   OpenCode, Codex custom agents).
     * - `generic` — generic dispatcher without cclaw-named agents (Cursor).
     * - `partial` — limited or plugin-only dispatch surface.
     * - `none`    — no dispatch primitive at all.
     */
    nativeSubagentDispatch: "full" | "generic" | "partial" | "none";
    hookSurface: "full" | "plugin" | "limited" | "none";
    /**
     * Structured-ask primitive exposed by the harness.
     *
     * - `AskUserQuestion`   — Claude Code native tool (≤5 options × multi-question).
     * - `AskQuestion`       — Cursor native tool (≥2 options, multi-question, `allow_multiple`).
     * - `question`          — OpenCode native tool (header + options + "type custom"
     *   fallback); **gated**: requires `permission.question: "allow"` in
     *   `opencode.json`, and for ACP clients additionally needs
     *   `OPENCODE_ENABLE_QUESTION_TOOL=1`.
     * - `request_user_input` — Codex CLI tool (1-3 short questions); experimental
     *   and primarily surfaced inside Plan / Collaboration mode templates
     *   (`codex-rs/collaboration-mode-templates`). Available to agents running
     *   inside Codex but may be hidden on very old builds.
     * - `plain-text`        — fallback only; used when no native primitive is
     *   available (no shipping harness uses this in v0.41.0).
     */
    structuredAsk:
      | "AskUserQuestion"
      | "AskQuestion"
      | "question"
      | "request_user_input"
      | "plain-text";
    /**
     * Declared fallback pattern used when the harness cannot satisfy a
     * mandatory delegation natively. Drives `checkMandatoryDelegations`
     * and generated harness guidance.
     */
    subagentFallback: SubagentFallback;
  };
}

interface UtilityShimSpec {
  /** Filename used for command-kind harnesses (e.g. `cc-idea.md`). */
  fileName: string;
  /**
   * Skill directory name used for skill-kind harnesses. Codex invokes
   * skills via `/use <skillName>`, so we keep the token identical to
   * the public `cc-idea` / `cc-cancel` slash-tokens users type.
   * Collisions with stock OpenAI skills are
   * unlikely (they ship under unrelated names like `pdf-editor`).
   */
  skillName: string;
  /** User-visible command token without the leading slash (`idea`). */
  command: string;
  skillFolder: string;
  commandFile: string;
}

const UTILITY_SHIMS: UtilityShimSpec[] = [
  {
    fileName: "cc-idea.md",
    skillName: "cc-idea",
    command: "idea",
    skillFolder: "flow-idea",
    commandFile: "idea.md"
  },
  {
    fileName: "cc-cancel.md",
    skillName: "cc-cancel",
    command: "cancel",
    skillFolder: "flow-cancel",
    commandFile: "cancel.md"
  }
];

/** Skill-kind shim name for the root `/cc` entry point. */
const ENTRY_SHIM_SKILL_NAME = "cc";

const LEGACY_CODEX_SKILL_PREFIX = "cclaw-cc";

/**
 * Shims that older cclaw versions installed as top-level slash commands but
 * which we now treat as internal (skill-only, invoked by the agent, never
 * typed by users). On sync/upgrade we proactively delete any stale file from
 * harness command directories so `/cc-learn` etc. do not linger.
 */
const LEGACY_HARNESS_SHIMS: readonly string[] = ["cc-learn.md"];


export function harnessShimFileNames(): string[] {
  return [
    "cc.md",
    ...UTILITY_SHIMS.map((shim) => shim.fileName)
  ];
}

/** Skill folder names cclaw writes under `<commandDir>` for skill-kind harnesses. */
export function harnessShimSkillNames(): string[] {
  return [
    ENTRY_SHIM_SKILL_NAME,
    ...UTILITY_SHIMS.map((shim) => shim.skillName)
  ];
}

export const HARNESS_ADAPTERS: Record<HarnessId, HarnessAdapter> = {
  claude: {
    id: "claude",
    reality: {
      declaredSupport: "full",
      runtimeLaunch: "native Task launch",
      proofRequired: "spanId+dispatchId or workerRunId+ACK for isolated completion",
      proofSource: ".cclaw/state/delegation-events.jsonl plus delegation-log.json"
    },
    commandDir: ".claude/commands",
    shimKind: "command",
    capabilities: {
      nativeSubagentDispatch: "full",
      hookSurface: "full",
      structuredAsk: "AskUserQuestion",
      subagentFallback: "native"
    }
  },
  cursor: {
    id: "cursor",
    reality: {
      declaredSupport: "generic",
      runtimeLaunch: "generic Task/Subagent launch with cclaw role prompt",
      proofRequired: "spanId+dispatchId/evidenceRefs for generic-dispatch completion",
      proofSource: ".cclaw/state/delegation-events.jsonl plus artifact evidenceRefs"
    },
    commandDir: ".cursor/commands",
    shimKind: "command",
    capabilities: {
      // Cursor has a real Task tool with subagent_type (generalPurpose,
      // explore, shell, browser-use, …) but no user-defined named
      // subagents. cclaw maps each named agent (planner/reviewer/…) onto
      // generic dispatch with a role prompt.
      nativeSubagentDispatch: "generic",
      hookSurface: "full",
      structuredAsk: "AskQuestion",
      subagentFallback: "generic-dispatch"
    }
  },
  opencode: {
    id: "opencode",
    reality: {
      declaredSupport: "full",
      runtimeLaunch: "prompt-level launch via Task or @agent against generated .opencode/agents",
      proofRequired: "spanId+dispatchId+ackTs+completedTs before isolated completion",
      proofSource: ".opencode/agents/<agent>.md and .cclaw/state/delegation-events.jsonl"
    },
    commandDir: ".opencode/commands",
    shimKind: "command",
    capabilities: {
      // OpenCode supports project-local markdown subagents under
      // `.opencode/agents/`; primary agents can invoke them via the Task
      // tool or explicit `@agent` mention. cclaw materializes its core
      // roster there, so mandatory delegations are real isolated subagents.
      nativeSubagentDispatch: "full",
      hookSurface: "plugin",
      // OpenCode exposes a native `question` tool (header + options +
      // custom-answer fallback, multi-question navigation). It is
      // permission-gated — `opencode.json` must set
      // `permission.question: "allow"` and ACP clients must export
      // `OPENCODE_ENABLE_QUESTION_TOOL=1`. cclaw surfaces the tool name
      // in generated harness guidance; skills fall back to the shared
      // plain-text lettered list when the tool is denied or unavailable.
      structuredAsk: "question",
      subagentFallback: "native"
    }
  },
  codex: {
    id: "codex",
    reality: {
      declaredSupport: "full",
      runtimeLaunch: "prompt-level launch by asking Codex to spawn generated custom agents",
      proofRequired: "spanId+dispatchId+ackTs+completedTs before isolated completion",
      proofSource: ".codex/agents/<agent>.toml and .cclaw/state/delegation-events.jsonl"
    },
    // Codex CLI reads skills from the universal `.agents/skills/` path
    // (OpenAI Codex 0.89, Jan 2026). It does NOT have a native
    // `.codex/commands/*` slash-command discovery — cclaw installs
    // its entry points as skills here. Current Codex releases also support
    // native parallel subagents and project-local `.codex/agents/*.toml`
    // custom agents; cclaw materializes its core roster there. Since v0.114
    // (Mar 2026) Codex also exposes lifecycle hooks via `.codex/hooks.json`, behind
    // the `[features] codex_hooks = true` feature flag in
    // `~/.codex/config.toml`. cclaw writes that file on sync and
    // `hookSurface: "limited"` records the reality: SessionStart /
    // UserPromptSubmit / Stop fire for every turn, but PreToolUse /
    // PostToolUse only intercept the `Bash` tool.
    commandDir: ".agents/skills",
    shimKind: "skill",
    capabilities: {
      nativeSubagentDispatch: "full",
      hookSurface: "limited",
      // Codex CLI exposes `request_user_input` — an experimental tool
      // that asks 1-3 short questions and returns the user's answers.
      // It is the primitive the built-in Plan / Collaboration mode
      // templates use (see `codex-rs/collaboration-mode-templates`).
      // Agents running inside Codex can call it directly; cclaw wires
      // it into generated harness guidance. The shared plain-text
      // lettered list is the documented fallback when the tool is unavailable.
      structuredAsk: "request_user_input",
      subagentFallback: "native"
    }
  }
};


export function harnessDispatchSurface(harnessId: HarnessId): string {
  switch (harnessId) {
    case "claude":
      return "Use Claude Code Task with the cclaw agent name as subagent_type; record fulfillmentMode: \"isolated\".";
    case "cursor":
      return "Use Cursor Subagent/Task with a generic subagent_type (explore for read-only mapping, generalPurpose for broader work, shell/browser-use when specifically needed) and paste the cclaw role prompt; record fulfillmentMode: \"generic-dispatch\" with evidenceRefs.";
    case "opencode":
      return "Use OpenCode subagents: invoke the generated .opencode/agents/<agent>.md agent via Task or @<agent>; if agents or plugin registration are missing, run `cclaw sync` and check opencode.json(.c) plugin registration with `npx cclaw-cli sync`; record scheduled/launched/acknowledged/completed events with spanId+dispatchId before claiming fulfillmentMode: \"isolated\".";
    case "codex":
      return "Use Codex native subagents: ask Codex to spawn the generated .codex/agents/<agent>.toml agent(s) by name; if hooks are inert, set `[features] codex_hooks = true` in ~/.codex/config.toml or rerun init/sync repair, then `npx cclaw-cli sync`; record scheduled/launched/acknowledged/completed events with spanId+dispatchId before claiming fulfillmentMode: \"isolated\".";
  }
}

export interface HarnessDelegationRecipe {
  harnessId: HarnessId;
  dispatchSurface: "claude-task" | "cursor-task" | "opencode-agent" | "codex-agent";
  agentDefinitionDirectory: string;
  agentDefinitionExample: string;
  invocationLine: string;
  fulfillmentMode: "isolated" | "generic-dispatch";
  /**
   * Step-by-step lifecycle commands rendered with structural placeholders only:
   *  `<agent-name>`, `<stage>`, `<run-id>`, `<span-id>`, `<dispatch-id>`,
   *  `<agent-def-path>`, `<iso-ts>`. No domain/example values.
   */
  lifecycleCommands: string[];
}

/**
 * Per-harness lifecycle recipe used by skills and harness docs to render the
 * canonical scheduled -> launched -> acknowledged -> completed sequence in
 * structural form. The recipe never embeds task-specific or domain-specific
 * placeholders — only neutral angle-bracket tokens (`<agent-name>`, `<stage>`,
 * `<span-id>`, `<dispatch-id>`, `<agent-def-path>`, `<iso-ts>`).
 *
 * This function returns the **canonical primary recipe** for each shipped
 * harness — the dispatch surface that maps 1:1 onto the harness's vendor-
 * native subagent surface:
 *
 * - `claude` -> `claude-task` (isolated)
 * - `cursor` -> `cursor-task` (generic-dispatch)
 * - `opencode` -> `opencode-agent` (isolated)
 * - `codex` -> `codex-agent` (isolated)
 *
 * The remaining `--dispatch-surface` enum values (`generic-task`,
 * `role-switch`, `manual`) are universal fallback paths available to any
 * harness when the canonical surface is unavailable; they are documented in
 * the dispatch-surface table in `docs/harnesses.md` rather than per-harness
 * here, because their lifecycle commands are structurally identical except
 * for the surface token. No shipped harness has a non-canonical *primary*
 * surface, so this function only needs to enumerate the four canonical
 * recipes above.
 */
export function harnessDelegationRecipe(harnessId: HarnessId): HarnessDelegationRecipe {
  const helper = "node .cclaw/hooks/delegation-record.mjs";
  const common = "--stage=<stage> --agent=<agent-name> --mode=mandatory --span-id=<span-id> --dispatch-id=<dispatch-id>";
  switch (harnessId) {
    case "claude":
      return {
        harnessId,
        dispatchSurface: "claude-task",
        agentDefinitionDirectory: ".claude/agents/",
        agentDefinitionExample: ".claude/agents/<agent-name>.md",
        invocationLine: "Call Task with subagent_type=<agent-name> and prompt body that paraphrases the stage skill role.",
        fulfillmentMode: "isolated",
        lifecycleCommands: [
          `${helper} ${common} --status=scheduled --dispatch-surface=claude-task --agent-definition-path=.claude/agents/<agent-name>.md --json`,
          `${helper} ${common} --status=launched --dispatch-surface=claude-task --agent-definition-path=.claude/agents/<agent-name>.md --launched-ts=<iso-ts> --json`,
          `${helper} ${common} --status=acknowledged --dispatch-surface=claude-task --agent-definition-path=.claude/agents/<agent-name>.md --ack-ts=<iso-ts> --json`,
          `${helper} ${common} --status=completed --dispatch-surface=claude-task --agent-definition-path=.claude/agents/<agent-name>.md --completed-ts=<iso-ts> --json`
        ]
      };
    case "cursor":
      return {
        harnessId,
        dispatchSurface: "cursor-task",
        agentDefinitionDirectory: ".cclaw/agents/",
        agentDefinitionExample: ".cclaw/agents/<agent-name>.md",
        invocationLine: "Call Task with a generic subagent_type and paste the cclaw role prompt; capture worker output as evidenceRefs in the artifact.",
        fulfillmentMode: "generic-dispatch",
        lifecycleCommands: [
          `${helper} ${common} --status=scheduled --dispatch-surface=cursor-task --agent-definition-path=.cclaw/agents/<agent-name>.md --json`,
          `${helper} ${common} --status=launched --dispatch-surface=cursor-task --agent-definition-path=.cclaw/agents/<agent-name>.md --launched-ts=<iso-ts> --json`,
          `${helper} ${common} --status=acknowledged --dispatch-surface=cursor-task --agent-definition-path=.cclaw/agents/<agent-name>.md --ack-ts=<iso-ts> --json`,
          `${helper} ${common} --status=completed --dispatch-surface=cursor-task --agent-definition-path=.cclaw/agents/<agent-name>.md --completed-ts=<iso-ts> --evidence-ref=<artifact-anchor> --json`
        ]
      };
    case "opencode":
      return {
        harnessId,
        dispatchSurface: "opencode-agent",
        agentDefinitionDirectory: ".opencode/agents/",
        agentDefinitionExample: ".opencode/agents/<agent-name>.md",
        invocationLine: "Invoke the generated agent via Task or `@<agent-name>`; the agent body lives in `.opencode/agents/<agent-name>.md`.",
        fulfillmentMode: "isolated",
        lifecycleCommands: [
          `${helper} ${common} --status=scheduled --dispatch-surface=opencode-agent --agent-definition-path=.opencode/agents/<agent-name>.md --json`,
          `${helper} ${common} --status=launched --dispatch-surface=opencode-agent --agent-definition-path=.opencode/agents/<agent-name>.md --launched-ts=<iso-ts> --json`,
          `${helper} ${common} --status=acknowledged --dispatch-surface=opencode-agent --agent-definition-path=.opencode/agents/<agent-name>.md --ack-ts=<iso-ts> --json`,
          `${helper} ${common} --status=completed --dispatch-surface=opencode-agent --agent-definition-path=.opencode/agents/<agent-name>.md --completed-ts=<iso-ts> --json`
        ]
      };
    case "codex":
      return {
        harnessId,
        dispatchSurface: "codex-agent",
        agentDefinitionDirectory: ".codex/agents/",
        agentDefinitionExample: ".codex/agents/<agent-name>.toml",
        invocationLine: "Ask Codex to spawn the named custom agent; the agent definition lives in `.codex/agents/<agent-name>.toml`.",
        fulfillmentMode: "isolated",
        lifecycleCommands: [
          `${helper} ${common} --status=scheduled --dispatch-surface=codex-agent --agent-definition-path=.codex/agents/<agent-name>.toml --json`,
          `${helper} ${common} --status=launched --dispatch-surface=codex-agent --agent-definition-path=.codex/agents/<agent-name>.toml --launched-ts=<iso-ts> --json`,
          `${helper} ${common} --status=acknowledged --dispatch-surface=codex-agent --agent-definition-path=.codex/agents/<agent-name>.toml --ack-ts=<iso-ts> --json`,
          `${helper} ${common} --status=completed --dispatch-surface=codex-agent --agent-definition-path=.codex/agents/<agent-name>.toml --completed-ts=<iso-ts> --json`
        ]
      };
  }
}

/** All four harness recipes in tier-stable order. */
export function harnessDelegationRecipes(): HarnessDelegationRecipe[] {
  return harnessesByTier().map((id) => harnessDelegationRecipe(id));
}

export function harnessDispatchFallback(harnessId: HarnessId): string {
  const adapter = HARNESS_ADAPTERS[harnessId];
  if (adapter.capabilities.subagentFallback !== "role-switch") {
    return "Role-switch is only a degradation path if the active runtime cannot expose the declared dispatch surface; include non-empty evidenceRefs when used.";
  }
  return "Use a visible role-switch pass with non-empty evidenceRefs because this harness has no true dispatch surface.";
}

export type HarnessTier = "tier1" | "tier2" | "tier3";

export function harnessTier(harnessId: HarnessId): HarnessTier {
  const capabilities = HARNESS_ADAPTERS[harnessId].capabilities;
  if (
    capabilities.nativeSubagentDispatch === "full" &&
    capabilities.structuredAsk !== "plain-text" &&
    capabilities.hookSurface === "full"
  ) {
    return "tier1";
  }
  if (capabilities.hookSurface !== "none" || capabilities.nativeSubagentDispatch !== "none") {
    return "tier2";
  }
  return "tier3";
}

/**
 * Harness IDs ordered from best (tier1) to least-capable. Stable sort — same
 * tier preserves declaration order.
 */
export function harnessesByTier(): HarnessId[] {
  return (Object.keys(HARNESS_ADAPTERS) as HarnessId[]).sort((a, b) => {
    const tierOrder = { tier1: 0, tier2: 1, tier3: 2 };
    return tierOrder[harnessTier(a)] - tierOrder[harnessTier(b)];
  });
}

function ironLawsAgentsMdBlock(): string {
  const enforcedLawIds = new Set([
    "stop-clean-or-handoff",
    "review-coverage-complete-before-ship"
  ]);
  const enforcedRows = IRON_LAWS
    .filter((law) => enforcedLawIds.has(law.id))
    .map((law) => `| \`${law.id}\` | ${law.rule} | ${law.enforcement} |`)
    .join("\n");
  const advisoryRows = IRON_LAWS
    .filter((law) => !enforcedLawIds.has(law.id))
    .map((law) => {
      const appliesTo = law.appliesTo === "all" ? "all stages" : law.appliesTo.join(", ");
      return `- \`${law.id}\` (applies to: ${appliesTo})`;
    })
    .join("\n");

  return `### Iron Laws

These rules are always-on. The hook-enforced runtime laws are:

| ID | Rule | Enforced by |
|---|---|---|
${enforcedRows}

Advisory laws are stage-owned through each stage's HARD-GATE block:

${advisoryRows}
`;
}

function agentsMdBlock(): string {
  return `${CCLAW_MARKER_START}
## Cclaw — Workflow Adapter

> Auto-generated by \`cclaw sync\`. Do not edit this managed block manually.
> Existing project rules in this repository take precedence over cclaw defaults.

${conversationLanguagePolicyMarkdown()}
## Anti-Slop Guard

Treat quality as a hard requirement, not style preference:

1. Confirm there is a real problem statement before proposing broad changes.
2. Prefer one focused change over bundled unrelated edits.
3. Verify claims with fresh evidence in this turn.
4. If uncertain, escalate with options instead of fabricating certainty.

### Activation Rule

Before responding to a coding request:
1. Read \`.cclaw/state/flow-state.json\` for the current stage.
2. Use \`/cc\` to start, resume, or continue the flow.
3. If no stage applies, respond normally.

${ironLawsAgentsMdBlock()}

### Task Classification (before \`/cc\`)

| Class | Examples | Route |
|---|---|---|
| Software — non-trivial | feature, refactor, migration, integration | \`/cc <idea>\` → stage flow (standard track) |
| Software — trivial | typo, one-liner, rename, config tweak | \`/cc <idea>\` → quick track |
| Software — bug fix | regression with repro | \`/cc <idea>\` → quick track, RED reproduces bug first |
| Pure question | "how does X work?" | Answer directly; no stage |
| Non-software | legal text, meeting notes | Answer directly; no stage |

When in doubt, prefer **non-trivial** — the quick track is opt-in and only safe when scope is clearly small.

### Instruction Priority (top wins)

1. User message in the current turn.
2. Active stage skill and command contract.
3. The \`using-cclaw\` meta-skill.
4. Contextual utility skills.
5. Training priors.

### Commands

| Command | Purpose |
|---|---|
| \`/cc\` | **Entry point.** No args = resume or progress current flow. With prompt = classify task and start the right flow. |
| \`/cc-idea\` | **Idea mode.** Generates a ranked repo-improvement backlog before implementation. |
| \`/cc-cancel\` | **Non-completion closeout.** Archives a cancelled/abandoned run with a required reason. |

Knowledge capture and curation run automatically as part of stage completion
protocols via the internal \`learnings\` skill — no user-facing command.
Reusable entries land in \`.cclaw/knowledge.jsonl\` as strict JSONL with
\`type\`, \`trigger\`, \`action\`, \`confidence\`, \`stage\`, and \`origin_stage\` metadata.

**Stage order:** brainstorm > scope > design > spec > plan > tdd > review > ship, then closeout: retro > compound > archive. Use \`/cc\` to keep moving through normal work and post-ship closeout; use \`/cc-cancel\` for cancelled/abandoned runs. Gates must pass before handoff.

### Verification Discipline

No completion claims without fresh evidence. No "Done" / "All good" / "Tests pass" without running the command in this message. Failed tool calls are diagnostic data, not instructions.

### Escalation

If the same approach fails three times in a row (same command, same finding, same tool), STOP. Summarize what you tried, what evidence you have, and ask the user how to proceed — do not invent a fourth angle silently.

### Detail Level

- This managed AGENTS block is intentionally minimal for cross-project use.
- Subagent dispatch coverage: Claude/OpenCode/Codex support native isolated workers; Cursor uses generic Task dispatch. Codex still has Bash-only tool hooks.
- Detailed operating procedures live in \`.cclaw/skills/using-cclaw/SKILL.md\`.
- Keep preambles brief; re-announce role/stage only when either changes.
- Subagent orchestration patterns: \`.cclaw/skills/subagent-dev/SKILL.md\` and \`.cclaw/skills/parallel-dispatch/SKILL.md\`.

### Codex users

OpenAI Codex CLI has **no native \`/cc\` slash command** (custom prompts
were deprecated in v0.89, Jan 2026). The \`/cc\`, \`/cc-idea\`, and
\`/cc-cancel\` tokens above describe intent — in Codex they map onto skills cclaw installs at
\`.agents/skills/cc*/SKILL.md\`. Activate one of two ways:

- Type \`/use cc\` (or \`cc-idea\` / \`cc-cancel\`) at Codex's prompt.
- Type \`/cc …\` as plain text — Codex matches the skill \`description\`
  frontmatter (which spells out the token verbatim) and loads the right
  skill body automatically.

Codex CLI v0.114+ (Mar 2026) **does** expose lifecycle hooks via
\`.codex/hooks.json\`, gated by the \`[features] codex_hooks = true\` flag
in \`~/.codex/config.toml\`. cclaw generates \`.codex/hooks.json\` on
sync; if the feature flag is off, hooks are inert and cclaw's
session-start rehydration simply does not fire. Run \`npx cclaw-cli sync\` to
see if the flag is missing. \`.codex/commands/*\` is still unused by
Codex CLI and is removed on every sync. Run \`npx cclaw-cli sync\` for
hook coverage details (Bash-only \`PreToolUse\`/\`PostToolUse\`; other events are full).
${CCLAW_MARKER_END}`;
}


/** Removes the cclaw AGENTS.md block. */
export function stripCclawBlock(content: string): string {
  let updated = content.replace(RUNTIME_AGENTS_BLOCK_GLOBAL_PATTERN, "");
  return updated.replace(/\n{3,}/g, "\n\n").trim();
}

async function syncRoutingFile(filePath: string, title: string): Promise<void> {
  const block = agentsMdBlock();

  if (!(await exists(filePath))) {
    await writeFileSafe(filePath, `# ${title}\n\n${block}\n`);
    return;
  }

  const content = await fs.readFile(filePath, "utf8");
  if (RUNTIME_AGENTS_BLOCK_PATTERN.test(content)) {
    const stripped = stripCclawBlock(content);
    const updated = stripped.length > 0 ? `${stripped}\n\n${block}\n` : `${block}\n`;
    await writeFileSafe(filePath, updated);
  } else {
    await writeFileSafe(filePath, `${content.trimEnd()}\n\n${block}\n`);
  }
}

async function syncAgentsMd(projectRoot: string, harnesses: HarnessId[] = []): Promise<void> {
  // AGENTS.md is universal — always injected or created. Claude Code, Cursor,
  // Codex, and OpenCode all read it when present.
  await syncRoutingFile(path.join(projectRoot, "AGENTS.md"), "AGENTS");

  // CLAUDE.md is Claude Code's preferred routing file. If the claude harness
  // is active, we materialise the routing block there too (create if missing,
  // otherwise keep append-and-refresh semantics). For non-claude installs, we
  // still refresh CLAUDE.md when it already exists — never silently drop it.
  const claudePath = path.join(projectRoot, "CLAUDE.md");
  const claudeExists = await exists(claudePath);
  const claudeHarnessActive = harnesses.includes("claude");
  if (claudeExists || claudeHarnessActive) {
    await syncRoutingFile(claudePath, "CLAUDE");
  }
}

async function removeCclawFromRoutingFile(filePath: string): Promise<void> {
  if (!(await exists(filePath))) return;

  const content = await fs.readFile(filePath, "utf8");
  if (!RUNTIME_AGENTS_BLOCK_PATTERN.test(content)) return;

  const stripped = stripCclawBlock(content);
  if (stripped.replace(/\s/g, "").length === 0) {
    await fs.rm(filePath, { force: true });
  } else {
    await writeFileSafe(filePath, `${stripped}\n`);
  }
}

export async function removeCclawFromAgentsMd(projectRoot: string): Promise<void> {
  await removeCclawFromRoutingFile(path.join(projectRoot, "AGENTS.md"));
  await removeCclawFromRoutingFile(path.join(projectRoot, "CLAUDE.md"));
}

function utilityShimBehavior(command: string): string {
  switch (command) {
    case "cc":
      return "This is the entry command, not a flow stage. It may initialize or resume flow state after confirmation.";
    case "idea":
      return "This is an ideation command, not a flow stage. It may write ideation artifacts/seeds but does not advance flow state.";
    case "cancel":
      return "This is a non-completion closeout utility, not a flow stage. It requires a reason and archives cancelled or abandoned work without presenting it as completed.";
    default:
      return "This is a utility command, not a flow stage.";
  }
}

function utilityShimContent(harness: HarnessId, command: string, skillFolder: string, commandFile: string): string {
  const shimName = command === "cc" ? "cc" : `cc-${command}`;
  return `---
name: ${shimName}
description: Generated shim for ${harness}. Utility command — not a flow stage.
source: generated-by-cclaw
---

# cclaw ${command}

Load and execute:
1. \`.cclaw/skills/${skillFolder}/SKILL.md\`
2. \`.cclaw/commands/${commandFile}\`

${utilityShimBehavior(command)}
`;
}


/**
 * Frontmatter `description` that triggers the skill when the user types any
 * of the classic cclaw slash-tokens. Codex's skill matcher runs on the skill
 * description verbatim, so we spell out every vocabulary Codex users type
 * instead of relying on semantics.
 */
function codexSkillDescription(command: string): string {
  switch (command) {
    case "cc":
      return `Entry point for the cclaw track-aware workflow ending in ship plus auto-closeout (retro → compound → archive). Use whenever the user types \`/cc\`, \`/cclaw\`, or asks to "start the flow", "begin cclaw", "kick off the workflow", "classify this task", or wants to start/resume a non-trivial software change. No args = resume the active stage from \`.cclaw/state/flow-state.json\`. With a prompt = classify and pick a track (quick/medium/standard).`;
    case "idea":
      return `Read-only repo-improvement idea mode for cclaw. Use when the user types \`/cc-idea\` or asks to "scan the repo for TODOs/tech debt", "generate a backlog", "brainstorm improvement ideas", or wants a ranked list of candidate ideas before committing to a single flow. Does not mutate \`.cclaw/state/flow-state.json\`.`;
    case "cancel":
      return `Cancel or abandon the active cclaw run. Use when the user types \`/cc-cancel\` or asks to cancel, abandon, stop, discard, or reset an unfinished run. Requires a reason and archives with cancelled/abandoned disposition.`;
    default:
      return `Generated cclaw skill for ${command}.`;
  }
}

/**
 * Skill body for codex-kind shims. Deliberately terse — the meat lives in
 * `.cclaw/skills/` and `.cclaw/commands/`, and Codex's progressive-disclosure
 * model loads skill bodies lazily, so we want a pointer plus the honest
 * harness caveat, not a duplicated contract.
 */
function codexSkillBody(command: string, skillFolder: string, commandFile: string): string {
  const slashToken = command === "cc" ? "/cc" : `/cc-${command}`;
  const title = command === "cc" ? "cclaw /cc (Codex adapter)" : `cclaw ${slashToken} (Codex adapter)`;
  const extraContractHeading = command === "cc"
    ? "If you have not already loaded the cclaw meta-skill this session, also load `.cclaw/skills/using-cclaw/SKILL.md` — it is the routing brain for stage/utility selection."
    : "This skill is a utility entry point, not a flow stage. Do not mutate `.cclaw/state/flow-state.json` directly.";
  const skillSlug = command === "cc" ? "cc" : `cc-${command}`;

  return `# ${title}

You are running inside the OpenAI Codex harness. Codex has **no native
\`${slashToken}\` slash command** — custom prompts were deprecated in
Codex CLI v0.89 (Jan 2026). cclaw ships its entry points as skills
under \`.agents/skills/${skillSlug}/\` so the user can either:

- Type \`/use ${skillSlug}\` at the Codex prompt, or
- Type \`${slashToken} …\` (or describe the intent in natural language) — Codex's
  skill matcher picks this skill up via the description frontmatter.

Lifecycle hooks **are** available in Codex CLI v0.114+ (behind the
\`[features] codex_hooks = true\` flag in \`~/.codex/config.toml\`) and
cclaw installs a matching \`.codex/hooks.json\`; run \`npx cclaw-cli sync\`
for the current hook surface and limitations.

## Protocol

1. Read \`.cclaw/state/flow-state.json\` first to know the active stage,
   track, and run metadata.
2. Load and follow \`.cclaw/skills/${skillFolder}/SKILL.md\` as the
   authoritative skill — its gates, artifacts, and delegations are
   canonical.
3. Load \`.cclaw/commands/${commandFile}\` for the full command contract
   (protocol, validation, post-state expectations).
4. ${extraContractHeading}

## Honest caveats

- Codex has native parallel subagents. cclaw writes project custom agents
  under \`.codex/agents/*.toml\`; ask Codex to spawn the relevant cclaw
  agent(s) by name, wait for their results, write evidence into the active
  artifact, then append completed delegation rows with \`fulfillmentMode:
  "isolated"\`. Use role-switch only if this Codex build has subagents
  unavailable or disabled, and then include non-empty \`evidenceRefs\`.
- Codex's \`PreToolUse\` / \`PostToolUse\` hooks currently only intercept
  the \`Bash\` tool. \`Write\`, \`Edit\`, \`WebSearch\`, and MCP tool calls
  are **not** gated by hooks — use \`npx cclaw-cli sync\` for what cclaw
  substitutes with in-turn agent steps for those call classes.
- Codex's \`SessionStart\` matcher only supports \`startup|resume\`. Claude
  and Cursor also fire on \`clear\` and \`compact\`, so mid-session
  context resets there re-inject cclaw's bootstrap automatically. In
  Codex you must re-announce the active stage yourself after any
  \`/clear\` or compaction — the skill does not reload implicitly.
`;
}

function codexSkillMarkdown(command: string, skillName: string, skillFolder: string, commandFile: string): string {
  const description = codexSkillDescription(command);
  const frontmatter = [
    "---",
    `name: ${skillName}`,
    `description: ${description}`,
    "source: generated-by-cclaw",
    "---",
    ""
  ].join("\n");
  return `${frontmatter}${codexSkillBody(command, skillFolder, commandFile)}`;
}

async function writeCommandKindShims(commandDir: string, harness: HarnessId): Promise<void> {
  await ensureDir(commandDir);
  await writeFileSafe(
    path.join(commandDir, "cc.md"),
    utilityShimContent(harness, "cc", "flow-start", "start.md")
  );
  for (const shim of UTILITY_SHIMS) {
    await writeFileSafe(
      path.join(commandDir, shim.fileName),
      utilityShimContent(harness, shim.command, shim.skillFolder, shim.commandFile)
    );
  }
  for (const legacy of LEGACY_HARNESS_SHIMS) {
    const legacyPath = path.join(commandDir, legacy);
    try {
      await fs.unlink(legacyPath);
    } catch {
      // fine — file may not exist (fresh install) or may be on read-only FS
    }
  }
}

async function writeSkillKindShims(commandDir: string): Promise<void> {
  await ensureDir(commandDir);
  await writeFileSafe(
    path.join(commandDir, ENTRY_SHIM_SKILL_NAME, "SKILL.md"),
    codexSkillMarkdown("cc", ENTRY_SHIM_SKILL_NAME, "flow-start", "start.md")
  );
  for (const shim of UTILITY_SHIMS) {
    await writeFileSafe(
      path.join(commandDir, shim.skillName, "SKILL.md"),
      codexSkillMarkdown(shim.command, shim.skillName, shim.skillFolder, shim.commandFile)
    );
  }
}

/**
 * Legacy codex surfaces cclaw wrote before v0.39.0 that Codex CLI never
 * consumed (`.codex/commands/*.md` had no discovery primitive). We keep
 * removing `.codex/commands/` on every sync so upgrades from those
 * installs leave a clean slate, but as of v0.40.0 we DO write
 * `.codex/hooks.json` again — Codex CLI grew a real hooks API in
 * v0.114.0 (Mar 2026), and that file is the current, supported target.
 *
 * This function also removes skill folders named after the old
 * `cclaw-cc*` scheme (v0.39.0 / v0.39.1) now that cclaw installs them
 * as plain `cc*`. Leaving them around would make Codex list two skills
 * for the same entry point.
 */
async function cleanupLegacyCodexSurfaces(projectRoot: string): Promise<void> {
  const legacyCommandsDir = path.join(projectRoot, ".codex/commands");
  try {
    await fs.rm(legacyCommandsDir, { recursive: true, force: true });
  } catch {
    // best-effort cleanup
  }

  // Remove old `cclaw-cc*` skill folders if they exist from a previous
  // cclaw install. Idempotent; best-effort.
  const legacySkillsRoot = path.join(projectRoot, ".agents/skills");
  let legacySkillNames: string[] = [];
  try {
    legacySkillNames = (await fs.readdir(legacySkillsRoot, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory() && entry.name.startsWith(LEGACY_CODEX_SKILL_PREFIX))
      .map((entry) => entry.name);
  } catch {
    legacySkillNames = [];
  }
  for (const name of legacySkillNames) {
    const folder = path.join(legacySkillsRoot, name);
    try {
      await fs.rm(folder, { recursive: true, force: true });
    } catch {
      // best-effort
    }
  }

  // If `.codex/` is now empty we drop it — happens when neither hooks
  // are enabled nor the user has their own state there. Otherwise we
  // leave the directory alone.
  try {
    const codexDir = path.join(projectRoot, ".codex");
    const entries = await fs.readdir(codexDir);
    if (entries.length === 0) {
      await fs.rmdir(codexDir);
    }
  } catch {
    // directory absent or non-empty
  }
}

function codexAgentToml(agent: (typeof CCLAW_AGENTS)[number]): string {
  const instructions = `${agentMarkdown(agent)}\n\n${enhancedAgentInstruction(agent.name)}`.trim();
  const sandboxMode = agent.tools.some((tool) => ["Write", "Edit", "Bash"].includes(tool))
    ? "workspace-write"
    : "read-only";
  return [
    `name = ${JSON.stringify(agent.name)}`,
    `description = ${JSON.stringify(agent.description)}`,
    `sandbox_mode = ${JSON.stringify(sandboxMode)}`,
    'developer_instructions = """',
    instructions.replace(/"""/gu, '\"\"\"'),
    '"""',
    ""
  ].join("\n");
}

function opencodeAgentMarkdown(agent: (typeof CCLAW_AGENTS)[number]): string {
  const editPermission = agent.tools.some((tool) => ["Write", "Edit"].includes(tool)) ? "ask" : "deny";
  const bashPermission = (agent.tools as readonly string[]).includes("Bash") ? "ask" : "deny";
  return `---
description: ${JSON.stringify(agent.description)}
mode: subagent
permission:
  edit: ${editPermission}
  bash: ${bashPermission}
---

${agentMarkdown(agent)}`;
}

function enhancedAgentInstruction(agentName: string): string {
  return `## Worker ACK Contract\n\nYou are the cclaw ${agentName} subagent. Follow the parent prompt as the task boundary. ACK first with JSON containing spanId, dispatchId or workerRunId, dispatchSurface, agentDefinitionPath, ackTs, and status: "ACK". Finish with the strict return schema plus the same spanId+dispatchId proof so the parent can append .cclaw/state/delegation-events.jsonl and .cclaw/state/delegation-log.json. Do not let the parent claim isolated completion without matching ACK/result proof. Do not recursively orchestrate other agents unless the parent explicitly asks.`;
}

async function syncAgentFiles(projectRoot: string, harnesses: HarnessId[]): Promise<void> {
  const agentsDir = path.join(projectRoot, RUNTIME_ROOT, "agents");
  await ensureDir(agentsDir);
  for (const agent of CCLAW_AGENTS) {
    await writeFileSafe(
      path.join(agentsDir, `${agent.name}.md`),
      agentMarkdown(agent)
    );
  }

  if (harnesses.includes("opencode")) {
    const opencodeAgentsDir = path.join(projectRoot, ".opencode/agents");
    await ensureDir(opencodeAgentsDir);
    for (const agent of CCLAW_AGENTS) {
      await writeFileSafe(
        path.join(opencodeAgentsDir, `${agent.name}.md`),
        opencodeAgentMarkdown(agent)
      );
    }
  }

  if (harnesses.includes("codex")) {
    const codexAgentsDir = path.join(projectRoot, ".codex/agents");
    await ensureDir(codexAgentsDir);
    for (const agent of CCLAW_AGENTS) {
      await writeFileSafe(
        path.join(codexAgentsDir, `${agent.name}.toml`),
        codexAgentToml(agent)
      );
    }
  }
}

export async function syncHarnessShims(projectRoot: string, harnesses: HarnessId[]): Promise<void> {
  // Legacy codex cleanup is unconditional — even installs that never enabled
  // codex but previously did will see stale `.codex/commands/*.md` and
  // `.codex/hooks.json` get removed on upgrade.
  await cleanupLegacyCodexSurfaces(projectRoot);

  for (const harness of harnesses) {
    const adapter = HARNESS_ADAPTERS[harness];
    if (!adapter) continue;
    const commandDir = path.join(projectRoot, adapter.commandDir);
    if (adapter.shimKind === "skill") {
      await writeSkillKindShims(commandDir);
    } else {
      await writeCommandKindShims(commandDir, harness);
    }
  }

  await syncAgentFiles(projectRoot, harnesses);
  await syncAgentsMd(projectRoot, harnesses);
}
