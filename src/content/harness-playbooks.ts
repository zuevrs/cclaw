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
2. Build the \`prompt\` from the cclaw agent contract in
   \`.cclaw/agents/<agent>.md\`, prefaced with a single line naming the
   cclaw role (\`You are the cclaw <agent>. Follow the contract below.\`).
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
description: "OpenCode has plugin-based dispatch hooks but no isolated subagent worker primitive. cclaw uses an in-session role-switch with a delegation-log entry + evidenceRefs."
---

# OpenCode — Parity Playbook

**Fallback: role-switch.** OpenCode exposes tool/session event hooks via a
plugin but does not provide an isolated subagent worker. cclaw closes the
delegation gate by role-switching inside the same session: the agent
announces the role, performs the work against the contract, and records
evidence.

## Role-switch protocol

1. Announce the role explicitly in a single message:

   > Acting as cclaw **<agent>** per \`.cclaw/agents/<agent>.md\`. No other
   > role may be assumed until the delegation row is closed.

2. Execute the role's contract. Do NOT interleave other roles' work.
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
description: "OpenAI Codex has no subagent dispatch primitive. cclaw uses role-switch with evidenceRefs; silent auto-waiver is explicitly disabled."
---

# OpenAI Codex — Parity Playbook

**Fallback: role-switch.** Codex has no subagent dispatch — neither named
nor generic. cclaw used to silently auto-waive mandatory delegations on
Codex; v0.33 disables that shortcut. The agent must role-switch in-session
and record evidence, or the delegation gate blocks stage completion.

## Role-switch protocol

Identical to OpenCode. Key requirements:

1. **Explicit announce.** Before performing the role, emit a single
   message naming the role and citing \`.cclaw/agents/<agent>.md\`.
2. **No role interleaving.** Do not mix, for example, reviewer and
   test-author work into the same turn — close one delegation before
   opening another.
3. **EvidenceRefs are mandatory.** Under Codex's role-switch fallback a
   \`completed\` row without \`evidenceRefs\` is treated as
   \`missingEvidence\` by \`cclaw doctor\` and blocks the gate.

## Stage-specific role maps

| Stage      | Mandatory roles                  | Artifact to cite in evidenceRefs     |
|------------|----------------------------------|--------------------------------------|
| scope      | \`planner\`                      | \`.cclaw/artifacts/02-scope.md\`     |
| design     | \`planner\`                      | \`.cclaw/artifacts/03-design.md\`    |
| plan       | \`planner\`                      | \`.cclaw/artifacts/05-plan.md\`      |
| tdd        | \`test-author\`                  | \`.cclaw/artifacts/06-tdd.md\`       |
| review     | \`reviewer\`, \`security-reviewer\` | \`.cclaw/artifacts/07-review.md\`  |
| ship       | \`doc-updater\`                  | \`.cclaw/artifacts/08-ship.md\`      |

## Why no auto-waiver anymore?

Silent auto-waiver on Codex let entire stages complete without any
reviewer or test-author work. That defeats cclaw's hard gates. v0.33
replaces it with an explicit role-switch obligation: the agent still gets
a path forward, but the path is visible in the delegation log.

If a team genuinely wants to skip a delegation on Codex, they must
manually append a \`status: "waived"\` row with a one-line
\`waiverReason\` — the same audit trail any Claude/Cursor install would
need.

## Verification

\`cclaw doctor\` passes when every mandatory agent for the active stage
has a \`completed\` row with \`fulfillmentMode: "role-switch"\` and at
least one \`evidenceRef\`.
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
