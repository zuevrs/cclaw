import { RUNTIME_ROOT } from "../constants.js";
import { stageSchema } from "./stage-schema.js";
import { stageSkillFolder } from "./skills.js";

const NEXT_SKILL_FOLDER = "flow-next-step";
const NEXT_SKILL_NAME = "flow-next-step";

function flowStatePath(): string {
  return `${RUNTIME_ROOT}/state/flow-state.json`;
}

function configPathLine(): string {
  return `${RUNTIME_ROOT}/config.yaml`;
}

function delegationLogPathLine(): string {
  return `${RUNTIME_ROOT}/runs/<activeRunId>/delegation-log.json`;
}

/**
 * Command contract for /cc-next - agent reads flow state, evaluates gates, advances or reports blockers.
 * Wire into install (write to `.cclaw/commands/next.md` + harness shim `cc-next.md`) in a follow-up; not invoked by CLI.
 */
export function nextCommandContract(): string {
  const flowPath = flowStatePath();
  const skillRel = `${RUNTIME_ROOT}/skills/${NEXT_SKILL_FOLDER}/SKILL.md`;
  const delegationPath = delegationLogPathLine();
  return `# /cc-next

## Purpose

Single **continue** command: read flow state, verify **current stage** gate satisfaction, verify any **mandatory delegations**, then either **hand off to the next stage** (load its skill and proceed) or **list blocking gates / pauses** so the user knows what to finish first.

## HARD-GATE

- **Do not** invent gate completion: use only \`${flowPath}\` plus observable evidence in repo artifacts.
- **Do not** skip stages: the only valid advance is from \`currentStage\` to that stage's configured successor in the flow schema (same order as \`/cc-brainstorm\` -> \`/cc-ship\`).
- **Do not** treat \`/cc-next\`, \`autoAdvance\`, or user impatience as permission to bypass \`WAIT_FOR_CONFIRM\`, \`Do NOT auto-advance\`, explicit approval pauses, or mandatory delegation requirements from the current stage skill.
- If the flow is already at the terminal stage with all ship gates satisfied, **report completion** instead of advancing.

## Algorithm (mandatory)

1. Read **\`${flowPath}\`** (create parent dirs only if you are also initializing a broken install - otherwise treat missing file as **BLOCKED**: state missing).
2. Parse JSON. Capture \`currentStage\`, \`activeRunId\` (must be present), and the current run-scoped context.
3. Load **\`${skillRel}\`** - canonical semantics for gate evaluation and continuation live there.
4. Let \`G\` = \`requiredGates\` for **\`currentStage\`** from the stage schema (authoritative list of gate ids).
5. Let \`catalog\` = \`stageGateCatalog[currentStage]\` from flow state (if missing, treat all gates as unmet).
6. **Satisfied** for gate id \`g\`: \`g\` in \`catalog.passed\` and \`g\` not in \`catalog.blocked\`.
7. **Unmet** = gates in \`G\` that are not satisfied **or** appear in \`catalog.blocked\`.
8. Let \`M\` = \`mandatoryDelegations\` for **\`currentStage\`** from the stage schema.
9. If \`M\` is non-empty, inspect **\`${delegationPath}\`**. A mandatory delegation counts only if that agent is recorded as **completed** or explicitly **waived** by the user. Missing or in-progress entries are blocking.
10. Respect explicit pause rules from the current stage skill (for example \`WAIT_FOR_CONFIRM\`, \`Do NOT auto-advance\`, or "wait for explicit approval"). \`/cc-next\` is a convenience command, not authorization to bypass confirmation gates.
11. If **any** unmet gates, blocking pause rules, or missing mandatory delegations remain: print a short **Blocking gates** list (id + human description from schema \`requiredGates\`, plus any missing delegation or approval requirement). Do **not** invoke the next stage skill yet.
12. If **all** required gates and mandatory delegations are satisfied:
   - If current stage's \`next\` is **\`done\`**: report **flow complete**; stop.
   - Otherwise let \`nextStage\` be the schema successor of \`currentStage\`. Load **\`${RUNTIME_ROOT}/skills/<skillFolder>/SKILL.md\`** and **\`${RUNTIME_ROOT}/commands/<nextStage>.md\`** using the real \`skillFolder\` and stage id from the schema for \`nextStage\`, then run that stage's protocol in-agent (equivalent to invoking \`/cc-\` + \`nextStage\`) without asking the user to re-type the slash-command. While doing so, obey the current and next stage skills' explicit pause rules; if either skill says to pause, stop and report readiness instead of auto-continuing through that gate.

## Primary skill

**${skillRel}** - full protocol, gate/flow tie-in, and interaction with \`autoAdvance\` in **\`${configPathLine()}\`**.
`;
}

/**
 * Skill body for /cc-next - flow logic and continue semantics.
 */
export function nextCommandSkillMarkdown(): string {
  const flowPath = flowStatePath();
  const cfgPath = configPathLine();
  const delegationPath = delegationLogPathLine();

  const stageRows = (["brainstorm", "scope", "design", "spec", "plan", "test", "build", "review", "ship"] as const)
    .map((stage) => {
      const schema = stageSchema(stage);
      const next = schema.next === "done" ? "(terminal)" : `/cc-${schema.next}`;
      const skillMd = `${RUNTIME_ROOT}/skills/${stageSkillFolder(stage)}/SKILL.md`;
      return `| \`${stage}\` | ${next} | \`${skillMd}\` |`;
    })
    .join("\n");

  return `---
name: ${NEXT_SKILL_NAME}
description: "Evaluate current stage gates from flow state; advance to the next /cc-* stage or list blockers."
---

# Flow: /cc-next (gate-aware continuation)

## When to use

- You want **one command** instead of manually typing the next \`/cc-*\` after a stage.
- You are unsure whether **current stage gates** are satisfied.
- The user said **continue**, **next**, or **pick up where we left off**.

## HARD-GATE

Do **not** mark gates satisfied from memory alone. Cite **artifact evidence** (paths, excerpts) consistent with \`requiredGates\` for \`currentStage\`. If evidence is missing, list the gate as **unmet**. Also treat missing mandatory delegations or unresolved confirmation pauses as blockers even if someone claims the stage is "basically done."

## Read flow state

1. Open **\`${flowPath}\`**.
2. Record \`currentStage\`, \`activeRunId\`, and \`stageGateCatalog[currentStage]\` (\`required\`, \`passed\`, \`blocked\` arrays).
3. If the file is missing or invalid JSON -> **BLOCKED** (report; do not advance).
4. Resolve the current delegation ledger at **\`${delegationPath}\`** using the recorded \`activeRunId\`.

## Evaluate gates for \`currentStage\`

For each gate id in the stage schema's \`requiredGates\` for \`currentStage\`:

- **Met** if the id is in \`catalog.passed\` and **not** in \`catalog.blocked\`.
- **Blocked** if the id is in \`catalog.blocked\` (always list these first).
- **Unmet** if not met (explain what evidence or artifact action is still needed, using the gate's description from the schema).

Also evaluate stage-level transition blockers:

- Read \`mandatoryDelegations\` from the current stage schema.
- If any mandatory agent is required, inspect **\`${delegationPath}\`**. Treat that agent as satisfied only if the ledger records it as **completed** or explicitly **waived** by the user.
- Treat explicit pause rules from the current stage skill (for example \`WAIT_FOR_CONFIRM\`, \`Do NOT auto-advance\`, or "wait for explicit approval") as authoritative. **/cc-next** does not override them.

If **any** gate is unmet or blocked, or any mandatory delegation / confirmation pause remains unresolved -> output **Blocking gates** (bulleted: \`id\` or agent name - reason). **Stop** without loading the next stage skill.

## Advance (all gates satisfied)

1. Look up \`currentStage\` in the transition table below. If next is **terminal**, print **Flow complete** and stop.
2. Let \`nextStage\` be the \`To\` stage. Read **\`${RUNTIME_ROOT}/commands/<nextStage>.md\`** and **\`${RUNTIME_ROOT}/skills/<folder>/SKILL.md\`** for that row.
3. **Continue semantics:** execute that stage's protocol **in the same session** as a natural handoff (you are now "in" \`nextStage\` until it completes or blocks).
4. Honor **\`${cfgPath}\`**: \`autoAdvance\` only applies where the stage skill allows it. Explicit pause / confirmation rules in either the current or next stage always win.
5. If the next stage reaches a confirmation gate or a "do not auto-advance" boundary, stop there and report readiness instead of claiming automatic advancement through that gate.

## Stage order (reference)

| Stage | Next command | Skill path |
|---|---|---|
${stageRows}

## Relation to per-stage skills

Wave auto-execute (\`waveExecutionAllowed\`) applies only to **test** and **build** skills after plan approval - see those SKILL.md files. **/cc-next** does not replace RED/GREEN/REFACTOR discipline; it only removes friction **between** stages.

## Anti-patterns

- Advancing when \`blocked\` is non-empty for the current stage.
- Treating \`passed\` as trusted when artifact evidence contradicts it.
- Using **/cc-next** to bypass \`WAIT_FOR_CONFIRM\`, explicit approval pauses, or missing mandatory delegations.
- Skipping **review** or **ship** because "the code looks fine".
`;
}
