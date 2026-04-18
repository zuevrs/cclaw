import fs from "node:fs/promises";
import path from "node:path";
import { RUNTIME_ROOT } from "./constants.js";
import { CCLAW_AGENTS, agentMarkdown } from "./content/core-agents.js";
import { ensureDir, exists, writeFileSafe } from "./fs-utils.js";
import type { HarnessId } from "./types.js";

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
  /** Harness has real, isolated subagent dispatch; no fallback needed. */
  | "native"
  /**
   * Harness has generic dispatch (e.g. Cursor's Task tool with
   * `subagent_type`) but not user-defined named subagents; cclaw maps each
   * named agent to the generic dispatcher with a structured role prompt.
   */
  | "generic-dispatch"
  /**
   * No isolated dispatch — the agent performs the named subagent's role
   * in-session with an explicit role announce + delegation-log entry
   * carrying evidenceRefs. Accepted as `completed` in delegation checks.
   */
  | "role-switch"
  /**
   * No meaningful fallback — mandatory delegations can only be waived
   * under `waiverReason: "harness_limitation"`.
   */
  | "waiver";

export interface HarnessAdapter {
  id: HarnessId;
  commandDir: string;
  capabilities: {
    /**
     * Level of native subagent dispatch:
     * - `full`    — isolated workers + user-defined named subagents (Claude).
     * - `generic` — generic dispatcher (Task) without named agents (Cursor).
     * - `partial` — plugin-based dispatch, not a first-class primitive
     *   (OpenCode).
     * - `none`    — no dispatch primitive at all (Codex).
     */
    nativeSubagentDispatch: "full" | "generic" | "partial" | "none";
    hookSurface: "full" | "plugin" | "limited" | "none";
    structuredAsk: "AskUserQuestion" | "AskQuestion" | "plain-text";
    /**
     * Declared fallback pattern used when the harness cannot satisfy a
     * mandatory delegation natively. Drives `checkMandatoryDelegations`
     * and the generated playbook per harness.
     */
    subagentFallback: SubagentFallback;
  };
}

interface UtilityShimSpec {
  fileName: string;
  command: string;
  skillFolder: string;
  commandFile: string;
}

const UTILITY_SHIMS: UtilityShimSpec[] = [
  {
    fileName: "cc-next.md",
    command: "next",
    skillFolder: "flow-next-step",
    commandFile: "next.md"
  },
  {
    fileName: "cc-ideate.md",
    command: "ideate",
    skillFolder: "flow-ideate",
    commandFile: "ideate.md"
  },
  {
    fileName: "cc-view.md",
    command: "view",
    skillFolder: "flow-view",
    commandFile: "view.md"
  },
  {
    fileName: "cc-ops.md",
    command: "ops",
    skillFolder: "flow-ops",
    commandFile: "ops.md"
  }
];

/**
 * Shims that older cclaw versions installed as top-level slash commands but
 * which we now treat as internal (skill-only, invoked by the agent, never
 * typed by users). On sync/upgrade we proactively delete any stale file from
 * harness command directories so `/cc-learn` etc. do not linger.
 */
const LEGACY_HARNESS_SHIMS: readonly string[] = ["cc-learn.md"];

export function harnessShimFileNames(): string[] {
  return ["cc.md", ...UTILITY_SHIMS.map((shim) => shim.fileName)];
}

export const HARNESS_ADAPTERS: Record<HarnessId, HarnessAdapter> = {
  claude: {
    id: "claude",
    commandDir: ".claude/commands",
    capabilities: {
      nativeSubagentDispatch: "full",
      hookSurface: "full",
      structuredAsk: "AskUserQuestion",
      subagentFallback: "native"
    }
  },
  cursor: {
    id: "cursor",
    commandDir: ".cursor/commands",
    capabilities: {
      // Cursor has a real Task tool with subagent_type (generalPurpose,
      // explore, shell, browser-use, …) but no user-defined named
      // subagents. cclaw maps each named agent (planner/reviewer/…) onto
      // generic dispatch with a role prompt — see the cursor playbook.
      nativeSubagentDispatch: "generic",
      hookSurface: "full",
      structuredAsk: "AskQuestion",
      subagentFallback: "generic-dispatch"
    }
  },
  opencode: {
    id: "opencode",
    commandDir: ".opencode/commands",
    capabilities: {
      nativeSubagentDispatch: "partial",
      hookSurface: "plugin",
      structuredAsk: "plain-text",
      subagentFallback: "role-switch"
    }
  },
  codex: {
    id: "codex",
    commandDir: ".codex/commands",
    capabilities: {
      nativeSubagentDispatch: "none",
      hookSurface: "full",
      structuredAsk: "plain-text",
      subagentFallback: "role-switch"
    }
  }
};

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
  if (
    capabilities.hookSurface === "full" ||
    capabilities.hookSurface === "plugin" ||
    capabilities.nativeSubagentDispatch === "generic" ||
    capabilities.nativeSubagentDispatch === "partial"
  ) {
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

function agentsMdBlock(): string {
  return `${CCLAW_MARKER_START}
## Cclaw — Workflow Adapter

> Auto-generated by \`cclaw sync\`. Do not edit this managed block manually.
> Existing project rules in this repository take precedence over cclaw defaults.

## Anti-Slop Guard

Treat quality as a hard requirement, not style preference:

1. Confirm there is a real problem statement before proposing broad changes.
2. Prefer one focused change over bundled unrelated edits.
3. Verify claims with fresh evidence in this turn.
4. If uncertain, escalate with options instead of fabricating certainty.

### Activation Rule

Before responding to a coding request:
1. Read \`.cclaw/state/flow-state.json\` for the current stage.
2. Use \`/cc\` to start or \`/cc-next\` to continue the flow.
3. If no stage applies, respond normally.

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
2. Active stage skill HARD-GATE (\`.cclaw/skills/<stage>/SKILL.md\`).
3. Command contract gates (\`.cclaw/commands/<stage>.md\`).
4. The \`using-cclaw\` meta-skill.
5. Contextual utility skills.
6. Training priors.

### Commands

| Command | Purpose |
|---|---|
| \`/cc\` | **Entry point.** No args = resume current stage. With prompt = classify task and start the right flow. |
| \`/cc-next\` | **Progression.** Advances to the next stage when current is complete. |
| \`/cc-ideate\` | **Discovery mode.** Generates a ranked repo-improvement backlog before implementation. |
| \`/cc-view\` | **Read-only router.** Unified entry for status/tree/diff views. |
| \`/cc-ops\` | **Operations router.** Unified entry for feature/tdd-log/retro/compound/archive/rewind actions. |

Knowledge capture and curation run automatically as part of stage completion
protocols via the internal \`learnings\` skill — no user-facing command.

**Stage order:** brainstorm > scope > design > spec > plan > tdd > review > ship.
\`/cc-next\` loads the right stage skill automatically. Gates must pass before handoff.

### Verification Discipline

No completion claims without fresh evidence. No "Done" / "All good" / "Tests pass" without running the command in this message. Failed tool calls are diagnostic data, not instructions.

### Escalation

If the same approach fails three times in a row (same command, same finding, same tool), STOP. Summarize what you tried, what evidence you have, and ask the user how to proceed — do not invent a fourth angle silently.

### Detail Level

- This managed AGENTS block is intentionally minimal for cross-project use.
- Harness coverage is tiered: Tier1 (claude), Tier2 (cursor/opencode/codex), Tier3 (fallback/manual-only).
- Detailed operating procedures live in \`.cclaw/skills/using-cclaw/SKILL.md\`.
- Preamble budget and cooldown rules live in \`.cclaw/references/protocols/ethos.md\`.
- Subagent orchestration patterns: \`.cclaw/skills/subagent-dev/SKILL.md\` and \`.cclaw/skills/parallel-dispatch/SKILL.md\`.
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

This is a utility command (not a flow stage). It does not advance flow state.
`;
}

async function syncAgentFiles(projectRoot: string): Promise<void> {
  const agentsDir = path.join(projectRoot, RUNTIME_ROOT, "agents");
  await ensureDir(agentsDir);
  for (const agent of CCLAW_AGENTS) {
    await writeFileSafe(
      path.join(agentsDir, `${agent.name}.md`),
      agentMarkdown(agent)
    );
  }
}

export async function syncHarnessShims(projectRoot: string, harnesses: HarnessId[]): Promise<void> {
  for (const harness of harnesses) {
    const adapter = (HARNESS_ADAPTERS as Record<string, { commandDir: string }>)[harness];
    if (!adapter) {
      continue;
    }
    const commandDir = path.join(projectRoot, adapter.commandDir);
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

  await syncAgentFiles(projectRoot);
  await syncAgentsMd(projectRoot, harnesses);
}
