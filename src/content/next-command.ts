import { RUNTIME_ROOT } from "../constants.js";
import { stageSchema } from "./stage-schema.js";
import { stageSkillFolder } from "./skills.js";

const NEXT_SKILL_FOLDER = "flow-next-step";
const NEXT_SKILL_NAME = "flow-next-step";

function flowStatePath(): string {
  return `${RUNTIME_ROOT}/state/flow-state.json`;
}

function delegationLogPathLine(): string {
  return `${RUNTIME_ROOT}/state/delegation-log.json`;
}

/**
 * Command contract for /cc-next — the primary progression command.
 * Reads flow-state, starts the current stage if unfinished, or advances if all gates pass.
 */
export function nextCommandContract(): string {
  const flowPath = flowStatePath();
  const skillRel = `${RUNTIME_ROOT}/skills/${NEXT_SKILL_FOLDER}/SKILL.md`;
  const delegationPath = delegationLogPathLine();
  return `# /cc-next

## Purpose

**The primary progression command.** Read flow state, determine what to do:

- **Current stage not started / in progress** → load its skill and execute it.
- **Current stage complete (all gates passed)** → advance \`currentStage\` and load the next skill.
- **Flow complete** → report done.

This is the only progression command the user needs to drive the entire flow. Stage command contracts are internal implementation details loaded by \`/cc-next\`.

## HARD-GATE

- **Do not** invent gate completion: use only \`${flowPath}\` plus observable evidence in repo artifacts.
- **Do not** skip stages: advance only from \`currentStage\` to its configured successor.
- After ship completes, the closeout chain **retro -> compound -> archive** runs automatically, driven by \`closeout.shipSubstate\`. Do not ask the user to type those commands manually — follow the substate switch in Path B below.

## Algorithm (mandatory)

1. Read **\`${flowPath}\`**. If missing → **BLOCKED** (state missing).
2. Parse JSON. Capture \`currentStage\` and \`stageGateCatalog[currentStage]\`.
3. If \`staleStages[currentStage]\` exists, do not advance automatically. Re-run the stage artifact work, then clear the marker with \`/cc-ops rewind --ack <currentStage>\`.
4. Let \`G\` = \`requiredGates\` for **\`currentStage\`** from the stage schema.
5. Let \`catalog\` = \`stageGateCatalog[currentStage]\` from flow state.
6. **Satisfied** for gate id \`g\`: \`g\` in \`catalog.passed\` and \`g\` not in \`catalog.blocked\`.
7. Let \`M\` = \`mandatoryDelegations\` for \`currentStage\`.
8. If \`M\` is non-empty, inspect **\`${delegationPath}\`**. Treat as satisfied only if each mandatory agent is **completed** or **waived**.
9. If any mandatory delegation is missing and no waiver exists: **STOP** and ask the user whether to dispatch now or waive with rationale. Do not mark gates passed while delegation is unresolved.
10. If \`currentStage === "review"\` and \`catalog.blocked\` includes \`review_criticals_resolved\`, treat this as a hard remediation branch: recommend \`/cc-ops rewind tdd "review_blocked_by_critical"\` with the blocking finding IDs, and do not attempt to advance toward ship.

### Path A: Current stage is NOT complete (any gate unmet or delegation missing)

→ Load **\`${RUNTIME_ROOT}/skills/<skillFolder>/SKILL.md\`** and **\`${RUNTIME_ROOT}/commands/<currentStage>.md\`** for the current stage.
→ Execute that stage's protocol. The stage skill handles the full interaction including STOP points and gate tracking.
→ Stage completion must use \`bash .cclaw/hooks/stage-complete.sh <currentStage>\` (canonical), which validates delegations + gate evidence before mutating \`flow-state.json\`.

### Path B: Current stage IS complete (all gates passed, all delegations satisfied)

→ If current stage's \`next\` is **\`done\`**:

  When \`currentStage === "ship"\`, route by **\`closeout.shipSubstate\`**:
  - \`"idle"\` or missing -> set \`closeout.shipSubstate = "retro_review"\`, then
    load \`${RUNTIME_ROOT}/commands/retro.md\` + \`${RUNTIME_ROOT}/skills/flow-retro/SKILL.md\`
    and execute the retro protocol (draft + one structured accept/edit/skip ask).
  - \`"retro_review"\` -> continue the retro protocol (re-ask the structured
    question; the draft already exists — do not regenerate it).
  - \`"compound_review"\` -> load \`${RUNTIME_ROOT}/commands/compound.md\` +
    \`${RUNTIME_ROOT}/skills/flow-compound/SKILL.md\`, execute the compound
    scan, ask user **one** structured question (apply / skip) per candidate
    cluster or a single accept-all / skip choice, and advance substate on
    completion or skip.
  - \`"ready_to_archive"\` -> load \`${RUNTIME_ROOT}/commands/archive.md\` +
    \`${RUNTIME_ROOT}/skills/flow-archive/SKILL.md\`, run archive, reset state.
  - \`"archived"\` (transient) -> report "run archived" and stop.

  Otherwise report **"Flow complete. All stages finished."** and stop.

→ Otherwise: load **\`${RUNTIME_ROOT}/skills/<skillFolder>/SKILL.md\`** and **\`${RUNTIME_ROOT}/commands/<nextStage>.md\`** for the successor stage. Execute that stage's protocol.

### Track-aware successor resolution

\`flow-state.json\` carries a \`track\` field (\`"quick"\`, \`"medium"\`, or \`"standard"\`) and a \`skippedStages\` array.

- If \`track === "quick"\`, the critical path is **spec → tdd → review → ship**. When advancing, skip any stage listed in \`skippedStages\` — i.e. after the current stage completes, pick the next stage that is NOT in \`skippedStages\`.
- If \`track === "medium"\`, the critical path is **brainstorm → spec → plan → tdd → review → ship**. Scope and design are intentionally skipped unless the run is reclassified to standard.
- If \`track === "standard"\`, advance through all 8 stages in their natural order.
- Never reintroduce a skipped stage mid-run. If the user wants upstream scoping work, they must archive the run and start a new one with \`track: "standard"\`.

## Resume Semantics

\`/cc-next\` in a **new session** = resume from where you left off:
- Flow-state records \`currentStage\` and which gates have passed.
- The stage skill reads upstream artifacts and picks up context.
- \`closeout.shipSubstate\` carries the post-ship substate, so a crashed
  session during retro/compound/archive resumes at the exact step without
  regenerating the retro draft.
- No special resume command needed — \`/cc-next\` IS the resume command.

## Primary skill

**${skillRel}** — full protocol and stage table.
`;
}

/**
 * Skill body for /cc-next — the primary flow progression command.
 */
export function nextCommandSkillMarkdown(): string {
  const flowPath = flowStatePath();
  const delegationPath = delegationLogPathLine();

  const stageRows = (["brainstorm", "scope", "design", "spec", "plan", "tdd", "review", "ship"] as const)
    .map((stage) => {
      const schema = stageSchema(stage);
      const next = schema.next === "done" ? "(terminal)" : schema.next;
      const skillMd = `${RUNTIME_ROOT}/skills/${stageSkillFolder(stage)}/SKILL.md`;
      return `| \`${stage}\` | \`${next}\` | \`${skillMd}\` |`;
    })
    .join("\n");

  return `---
name: ${NEXT_SKILL_NAME}
description: "The primary progression command. Reads flow state, starts/resumes the current stage or advances to the next one."
---

# /cc-next — Flow Progression

## Overview

\`/cc-next\` is **the only command you need** to drive the entire cclaw flow.

**How it works:**
1. Reads \`flow-state.json\` to find \`currentStage\`
2. Checks if all gates for that stage are satisfied
3. If **not** → loads the stage skill and starts/resumes execution
4. If **yes** → advances to the next stage and loads its skill

**Resume:** \`/cc-next\` in a new session picks up from where \`flow-state.json\` says you are.

## HARD-GATE

Do **not** mark gates satisfied from memory alone. Cite **artifact evidence** (paths, excerpts). If evidence is missing, list the gate as **unmet**. Do **not** skip stages.

## Algorithm

### Step 1: Read state

1. Open **\`${flowPath}\`**.
2. Record \`currentStage\` and \`stageGateCatalog[currentStage]\`.
3. If \`staleStages[currentStage]\` exists, re-run the stage and clear marker via \`/cc-ops rewind --ack <currentStage>\` before advancing.
4. If the file is missing or invalid JSON → **BLOCKED** (report and stop).

### Step 2: Evaluate gates

For each gate id in \`requiredGates\` for \`currentStage\`:
- **Met** if in \`catalog.passed\` and not in \`catalog.blocked\`.
- **Unmet** otherwise.

Check \`mandatoryDelegations\` via **\`${delegationPath}\`** — satisfied only if **completed** or **waived**.
If a mandatory delegation is missing and no waiver exists, **STOP** and ask:
(A) dispatch now, (B) waive with rationale, (C) cancel stage advance.

### Step 3: Act

**Path A — stage NOT complete (any gate unmet):**

Load the current stage's skill and command contract:
- \`${RUNTIME_ROOT}/skills/<skillFolder>/SKILL.md\`
- \`${RUNTIME_ROOT}/commands/<currentStage>.md\`

Execute the stage protocol. The stage skill handles interaction, STOP points, gate tracking, and stage completion via \`bash .cclaw/hooks/stage-complete.sh <stage>\` (canonical flow-state mutation path).

Special-case for review: if \`review_criticals_resolved\` is in \`blocked\`, route to rework instead of looping review forever — recommend \`/cc-ops rewind tdd "review_blocked_by_critical"\`.

**Path B — stage IS complete (all gates met, all delegations done):**

If \`next\` is \`done\`:

When \`currentStage\` is \`ship\`, automatically drive the **closeout chain**
by inspecting \`closeout.shipSubstate\`:

| shipSubstate          | Action                                              |
|-----------------------|-----------------------------------------------------|
| \`idle\` / missing      | Flip to \`retro_review\` and start retro protocol     |
| \`retro_review\`        | Continue retro protocol (re-ask accept/edit/skip)   |
| \`compound_review\`     | Run compound scan with a single approve/skip ask    |
| \`ready_to_archive\`    | Run archive skill; reset flow-state on success      |
| \`archived\`            | Report "run archived"; stop                         |

Each step owns its own state transition. \`/cc-next\` never shells out to
\`cclaw doctor\` or \`cclaw archive\` automatically — it loads the matching
skill and command contract and executes the protocol in-session.

Otherwise report **"Flow complete. All stages finished."** and stop.

Otherwise (non-terminal \`next\`): load the next stage's skill and command
contract, begin execution.

## Stage order

| Stage | Next | Skill path |
|---|---|---|
${stageRows}

## Anti-patterns

- Advancing when \`blocked\` is non-empty for the current stage.
- Treating \`passed\` as trusted when artifact evidence contradicts it.
- Skipping **review** or **ship** because "the code looks fine".
- Loading a stage skill directly instead of using \`/cc-next\` for progression.
`;
}
