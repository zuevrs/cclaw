/**
 * Per-harness parity playbooks.
 *
 * cclaw's subagent contracts (planner / reviewer / security-reviewer /
 * test-author / doc-updater) assume Claude-style isolated workers. On
 * harnesses without that primitive, the agent has to fulfil the role via a
 * documented fallback (generic Task dispatch, role-switch in-session, …).
 *
 * Each playbook is:
 *   1. short (≤ ~150 lines markdown),
 *   2. executable — reproducible by an agent without reading the whole repo,
 *   3. evidence-first — always records a delegation-log entry with
 *      `fulfillmentMode` and `evidenceRefs` so `cclaw doctor` can tell the
 *      role was actually performed.
 *
 * Playbooks are materialised at
 * `.cclaw/references/harnesses/<harness>-playbook.md` by install/sync/upgrade.
 */

import { HARNESS_ADAPTERS } from "../harness-adapters.js";
import type { HarnessId } from "../types.js";

export const HARNESS_PLAYBOOKS_DIR = "references/harnesses";

export function harnessPlaybookRelativePath(harness: HarnessId): string {
  return `${HARNESS_PLAYBOOKS_DIR}/${harness}-playbook.md`;
}

export function harnessPlaybookFileName(harness: HarnessId): string {
  return `${harness}-playbook.md`;
}

const CLAUDE_PLAYBOOK = `---
harness: claude
fallback: native
description: "Claude Code has real isolated subagent workers with user-defined named types. No fallback required — this playbook is reference-only."
---

# Claude Code — Parity Playbook

**Status: native.** Claude Code supports isolated subagent workers via the
\`Task\` tool with user-defined \`subagent_type\` (\`planner\`, \`reviewer\`,
\`security-reviewer\`, \`test-author\`, \`doc-updater\`). Each dispatch runs in
its own context and produces a return message visible only to the parent
agent.

This playbook exists so the harness matrix has one reference shape; Claude
itself has no parity gap to close.

## Dispatch pattern

1. Pick the \`subagent_type\` matching the cclaw agent (e.g. \`reviewer\`).
2. Provide a specific, self-contained \`prompt\` — the subagent cannot see
   prior assistant turns.
3. Record a delegation entry before dispatch:

   \`\`\`json
   {
     "stage": "review",
     "agent": "reviewer",
     "mode": "mandatory",
     "status": "scheduled",
     "fulfillmentMode": "isolated",
     "spanId": "dspan-..."
   }
   \`\`\`

4. After the subagent returns, update the entry to \`status: "completed"\`
   and attach \`evidenceRefs\` pointing at the artifact section that
   captures the subagent's output.

## Verification

\`cclaw doctor\` will pass the \`delegation:mandatory:current_stage\` check
when each mandatory agent has a \`completed\` row for the active run.
`;

const CURSOR_PLAYBOOK = `---
harness: cursor
fallback: generic-dispatch
description: "Cursor has a generic Task dispatcher with subagent_type (generalPurpose, explore, shell, …) but no user-defined named subagents. cclaw maps planner/reviewer/test-author/… onto generic dispatch with a structured role prompt."
---

# Cursor — Parity Playbook

**Fallback: generic-dispatch.** Cursor's \`Task\` tool supports
\`subagent_type\` from a fixed vocabulary (\`generalPurpose\`, \`explore\`,
\`shell\`, \`browser-use\`, …). Real isolation, but no user-defined agent
names. cclaw closes the gap by mapping each named cclaw agent onto the
generic dispatcher with a strict role prompt.

## Named-agent → Cursor subagent_type map

| cclaw agent          | Cursor \`subagent_type\` | Readonly? | Rationale |
|----------------------|-------------------------|-----------|-----------|
| \`planner\`          | \`explore\`              | yes       | Pure research, no writes. |
| \`reviewer\`         | \`explore\`              | yes       | Reads diff + context, emits findings. |
| \`security-reviewer\`| \`explore\`              | yes       | Reads code, produces report; no fixes. |
| \`test-author\`      | \`generalPurpose\`       | no        | Writes tests, runs them, iterates. |
| \`doc-updater\`      | \`generalPurpose\`       | no        | Edits docs, re-runs build. |

## Dispatch pattern

1. Pick the mapped \`subagent_type\` from the table above.
2. Build the \`prompt\` from the cclaw agent role brief in
   \`.cclaw/agents/<agent>.md\`, prefaced with a single line naming the
   cclaw role (\`You are the cclaw <agent>. Follow the role brief below.\`).
3. Set \`readonly: true\` when the table says yes — Cursor enforces it.
4. Before dispatch, append a delegation row:

   \`\`\`json
   {
     "stage": "tdd",
     "agent": "test-author",
     "mode": "mandatory",
     "status": "scheduled",
     "fulfillmentMode": "generic-dispatch",
     "spanId": "dspan-..."
   }
   \`\`\`

5. After dispatch returns, transition the row to \`completed\` with
   \`evidenceRefs\` citing the artifact anchor where the result landed.

## Why not upgrade Cursor to a full tier-1?

Cursor has dispatch + hooks + \`AskQuestion\`. The missing piece is
**user-defined named subagents**. Semantically this is the difference
between Claude's \`test-author\` (a distinct runtime worker registered by
cclaw) and Cursor's \`generalPurpose\` worker that cclaw *asks* to act as a
test-author. Good enough for parity; different enough to keep the labels
honest.

## Verification

\`cclaw doctor\` passes when the delegation row exists with
\`fulfillmentMode: "generic-dispatch"\` (or \`completed\` rows for the
mandatory agents in general). No evidenceRef requirement applies here —
Cursor dispatch is real isolation.
`;

const OPENCODE_PLAYBOOK = `---
harness: opencode
fallback: role-switch
description: "OpenCode has plugin-based dispatch hooks and a native structured-ask tool (question) but no isolated subagent worker primitive. cclaw uses an in-session role-switch with a delegation-log entry + evidenceRefs, and emits Decision Protocol calls through the question tool when it is permitted."
---

# OpenCode — Parity Playbook

**Fallback: role-switch.** OpenCode exposes tool/session event hooks via a
plugin but does not provide an isolated subagent worker. cclaw closes the
delegation gate by role-switching inside the same session: the agent
announces the role, performs the work against the role brief, and records
evidence.

**Structured ask: native \`question\` tool.** OpenCode ships a first-class
\`question\` primitive (header + question text + options, plus a
"type custom" fallback; supports multi-question navigation). It is
permission-gated:

- \`opencode.json\` must grant \`permission.question: "allow"\` (or be
  covered by a \`"*": "allow"\` default).
- ACP clients additionally need \`OPENCODE_ENABLE_QUESTION_TOOL=1\` set
  on the \`opencode acp\` process.

When the tool is permitted, every Decision Protocol call maps to a single
\`question\` invocation. When it is denied or the host doesn't expose it,
fall back to the shared plain-text lettered list — same skeleton, same
artifact decision log. Full mapping:
\`.cclaw/references/harness-tools/opencode.md\`.

## Role-switch protocol

1. Announce the role explicitly in a single message:

   > Acting as cclaw **<agent>** per \`.cclaw/agents/<agent>.md\`. No other
   > role may be assumed until the delegation row is closed.

2. Execute the role's brief. Do NOT interleave other roles' work.
3. Write the result into the stage artifact (e.g. TDD work lands in
   \`.cclaw/artifacts/06-tdd.md\`).
4. Append a delegation row:

   \`\`\`json
   {
     "stage": "tdd",
     "agent": "test-author",
     "mode": "mandatory",
     "status": "completed",
     "fulfillmentMode": "role-switch",
     "evidenceRefs": [
       ".cclaw/artifacts/06-tdd.md#red-run",
       ".cclaw/artifacts/06-tdd.md#green-run"
     ],
     "spanId": "dspan-..."
   }
   \`\`\`

5. \`evidenceRefs\` **must** point at concrete artifact anchors — not
   placeholder text. \`cclaw doctor\` will report \`missingEvidence\` if
   the array is empty under a role-switch fallback.

## Exception: OpenCode plugin dispatch

If the project configures a plugin-based dispatch path (e.g. a tool that
spawns a worker process), set \`fulfillmentMode: "generic-dispatch"\`
instead of \`role-switch\` and omit the role-announce step. evidenceRefs
remain optional but recommended.

## Verification

\`cclaw doctor\` passes when every mandatory agent for the active stage
has either a \`completed\` row with evidenceRefs (role-switch) or a
\`completed\` row under plugin dispatch.
`;

const CODEX_PLAYBOOK = `---
harness: codex
fallback: role-switch
description: "OpenAI Codex exposes lifecycle hooks (v0.114+, gated by the codex_hooks feature flag) but no subagent dispatch and no custom slash commands. cclaw ships entry points as skills under .agents/skills/cc*/ and wires .codex/hooks.json; mandatory delegations fall back to role-switch with evidenceRefs."
---

# OpenAI Codex — Parity Playbook

Codex CLI has a different shape from Claude/Cursor:

- **Entry points are skills.** \`/cc\`, \`/cc-next\`, \`/cc-ideate\`,
  \`/cc-view\`, \`/cc-ops\` are generated as skills at
  \`.agents/skills/cc/SKILL.md\` (and \`cc-next/\`, \`cc-view/\`,
  \`cc-ideate/\`, \`cc-ops/\`). They activate via Codex's native
  \`/use <skillName>\` command or automatically when the user's prompt
  mentions any of the \`/cc\`-style tokens (skill descriptions include
  them verbatim). Codex CLI removed custom prompts in v0.89 (Jan 2026);
  there is no way to register a true custom slash command.
- **Lifecycle hooks.** Codex CLI ≥ v0.114 (Mar 2026) exposes lifecycle
  hooks at \`.codex/hooks.json\`, gated behind the experimental
  \`[features] codex_hooks = true\` flag in \`~/.codex/config.toml\`.
  cclaw writes \`.codex/hooks.json\` on sync; if the flag is off, the
  file is simply inert and \`cclaw doctor\` emits a warning. \`cclaw init\`
  offers to patch the flag with explicit user consent.
- **Tool interception is Bash-only.** Codex's \`PreToolUse\` and
  \`PostToolUse\` events only fire for the \`Bash\` tool. \`Write\`,
  \`Edit\`, \`WebSearch\`, and MCP tool calls are **not** gated by hooks.
  cclaw partially compensates by wiring \`UserPromptSubmit\` to both
  \`prompt-guard.sh\` and a non-blocking
  \`cclaw internal verify-current-state --quiet\` nudge that emits
  unmet-delegation / missing-evidence warnings before the turn executes.
  This is still a nudge, not a hard block: workflow-guard (TDD red-first,
  artifact presence) only fires on Bash turns. See the hook coverage matrix below.
- **Legacy paths.** \`.codex/commands/*\` was never consumed by Codex and
  is removed on every \`cclaw sync\`. The v0.39.x \`.agents/skills/cclaw-cc*/\`
  layout is replaced by \`.agents/skills/cc*/\` and the old folders are
  auto-removed on sync. Do not restore either by hand.

## Structured ask: native \`request_user_input\` tool

Codex exposes \`request_user_input\` — an experimental tool that accepts
1-3 short questions and returns the user's answers in the same order.
It is the primitive the built-in Plan / Collaboration mode templates use
(see \`codex-rs/collaboration-mode-templates/templates/plan.md\`), and
agents running inside Codex can call it directly. Answers come back as
free-form strings, not option IDs — keep lettered options inline in the
question text so the user's reply maps cleanly to the artifact
decision log.

cclaw stage skills invoke \`request_user_input\` for every Decision
Protocol call when the tool is available, and fall back to the shared
plain-text lettered list when Codex returns a schema error or when the
current host hides the tool (older builds, non-collaboration mode). Full
mapping: \`.cclaw/references/harness-tools/codex.md\`.

## Fallback: role-switch

Codex has no subagent dispatch — neither named nor generic. Mandatory
delegations must be role-switched in-session. Silent auto-waiver was
disabled in v0.33 and remains off.

1. **Explicit announce.** Before performing the role, emit a single
   message naming the role and citing \`.cclaw/agents/<agent>.md\`.
2. **No role interleaving.** Close one delegation before opening
   another; never mix, for example, reviewer and test-author work in
   the same turn.
3. **EvidenceRefs are mandatory.** A \`completed\` row without
   \`evidenceRefs\` is treated as \`missingEvidence\` by \`cclaw doctor\`
   and blocks the stage gate.

## Stage-specific role maps

| Stage      | Mandatory roles                  | Artifact to cite in evidenceRefs     |
|------------|----------------------------------|--------------------------------------|
| scope      | \`planner\`                      | \`.cclaw/artifacts/02-scope.md\`     |
| design     | \`planner\`                      | \`.cclaw/artifacts/03-design.md\`    |
| plan       | \`planner\`                      | \`.cclaw/artifacts/05-plan.md\`      |
| tdd        | \`test-author\`                  | \`.cclaw/artifacts/06-tdd.md\`       |
| review     | \`reviewer\`, \`security-reviewer\` | \`.cclaw/artifacts/07-review.md\`  |
| ship       | \`doc-updater\`                  | \`.cclaw/artifacts/08-ship.md\`      |

## Invocation cheatsheet

- \`/use cc\` — open the \`/cc\` skill and pick a track.
- \`/use cc-next\` — advance the flow one stage.
- \`/use cc-ops\` — compound / archive / rewind.
- \`bash .cclaw/hooks/stage-complete.sh <stage>\` — canonical stage closeout helper;
  validates delegations + gate evidence before mutating \`flow-state.json\`.
- Typing \`/cc …\` or \`/cc-next …\` in plain text also works: Codex
  matches the skill descriptions (which spell out these tokens) and
  auto-loads the right skill body.
- Use Codex's built-in \`/skill\` UI to enable or disable
  cclaw skills per session.

## Feature flag — how to enable hooks

Codex CLI ignores \`.codex/hooks.json\` unless \`codex_hooks = true\`
appears under \`[features]\` in \`~/.codex/config.toml\`:

\`\`\`toml
[features]
codex_hooks = true
\`\`\`

\`cclaw init --codex\` prompts to write this automatically (one-line
diff, preserving the rest of \`config.toml\` untouched). Decline the
prompt to leave the file alone; the skill-level \`/use cc\` entry points
continue to work regardless.

## Hook coverage matrix

| Hook intent | Codex mapping | Coverage |
|-------------|---------------|----------|
| SessionStart rehydration | \`SessionStart\` matcher \`startup|resume\` → \`session-start.sh\` | Full. |
| PreToolUse prompt-guard | \`PreToolUse\` matcher \`Bash\` + \`UserPromptSubmit\` → \`prompt-guard.sh\` | Bash tool calls are gated inline; \`UserPromptSubmit\` catches prompts before any tool fires, so non-Bash writes (\`Write\`/\`Edit\`) are still prompt-guarded at the turn boundary. |
| UserPromptSubmit state nudge | \`UserPromptSubmit\` → \`cclaw internal verify-current-state --quiet\` | Non-blocking warning only. Prints unmet mandatory delegation / gate-evidence counts before the turn; cannot block non-Bash \`Write\`/\`Edit\`. |
| PreToolUse workflow-guard | \`PreToolUse\` matcher \`Bash\` → \`workflow-guard.sh\` | Bash-only. For \`Write\`/\`Edit\` calls the agent performs the TDD-order / artifact check in-turn (see the stage skill). |
| PostToolUse context-monitor | \`PostToolUse\` matcher \`Bash\` → \`context-monitor.sh\` | Bash-only. Other tool calls get context-monitored at end-of-turn via \`.cclaw/references/protocols/ethos.md\`. |
| Stop checkpoint | \`Stop\` → \`stop-checkpoint.sh\` | Full. |
| PreCompact digest | Not supported — Codex has no \`PreCompact\` event. | Covered by \`/cc-ops retro\` and the user running \`/cc-view status\` before Codex's \`/compact\` command. |

## Verification

\`cclaw doctor\` on a codex-enabled install checks:

- \`shim:codex:cc:present\` and \`frontmatter\` (plus the four utility
  skills \`cc-next\`, \`cc-view\`, \`cc-ops\`, \`cc-ideate\`).
- \`hook:schema:codex\` validates \`.codex/hooks.json\` shape.
- \`hook:wiring:codex\` verifies the generated hooks reference every
  runtime script cclaw needs (session-start, prompt-guard, workflow-guard,
  context-monitor, stop-checkpoint).
- \`warning:codex:feature_flag\` is emitted as a warning (not an error)
  when \`~/.codex/config.toml\` is missing the \`codex_hooks\` feature
  flag — hooks silently do nothing in that state.
- \`warning:codex:legacy_commands_dir\` and
  \`warning:codex:legacy_cclaw_cc_skills\` catch leftovers from older
  cclaw versions.
- Every mandatory agent for the active stage has a \`completed\` row
  with \`fulfillmentMode: "role-switch"\` and at least one \`evidenceRef\`.
`;

const PLAYBOOK_BY_HARNESS: Record<HarnessId, string> = {
  claude: CLAUDE_PLAYBOOK,
  cursor: CURSOR_PLAYBOOK,
  opencode: OPENCODE_PLAYBOOK,
  codex: CODEX_PLAYBOOK
};

export function harnessPlaybookMarkdown(harness: HarnessId): string {
  const body = PLAYBOOK_BY_HARNESS[harness];
  if (!body) {
    throw new Error(`No playbook defined for harness "${harness}".`);
  }
  return body;
}

export function harnessPlaybooksIndexMarkdown(): string {
  const rows = (Object.keys(HARNESS_ADAPTERS) as HarnessId[])
    .map((h) => {
      const fallback = HARNESS_ADAPTERS[h].capabilities.subagentFallback;
      return `| \`${h}\` | ${fallback} | [\`${harnessPlaybookFileName(h)}\`](./${harnessPlaybookFileName(h)}) |`;
    })
    .join("\n");
  return `# Harness parity playbooks

Each playbook describes the concrete pattern cclaw expects when the
harness does not natively satisfy a mandatory delegation contract.

| Harness | Fallback | Playbook |
|---|---|---|
${rows}

## How cclaw uses these files

- \`cclaw doctor\` verifies that every installed harness has its playbook
  present under \`.cclaw/references/harnesses/\`.
- Stage skills (TDD, review, ship) cite the active harness's playbook
  instead of inlining the fallback pattern.
- The \`delegation:mandatory:current_stage\` check expects
  \`fulfillmentMode\` to match the harness's declared \`subagentFallback\`
  (\`isolated\`, \`generic-dispatch\`, or \`role-switch\`).

## When to edit

Playbooks are generated by \`cclaw upgrade\`. Local edits are overwritten.
To customise the parity pattern for a specific repository, override the
skill that cites the playbook, not the playbook itself.
`;
}
