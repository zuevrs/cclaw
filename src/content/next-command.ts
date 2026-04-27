import { RUNTIME_ROOT } from "../constants.js";
import { nextStage as nextStageForTrack } from "../flow-state.js";
import { conversationLanguagePolicyMarkdown } from "./language-policy.js";
import { stageSchema } from "./stage-schema.js";
import {
  closeoutChainInline,
  closeoutNextCommandGuidance,
  closeoutSubstateInline,
  closeoutSubstateProtocolBullets
} from "./closeout-guidance.js";
import { stageSkillFolder } from "./skills.js";

const NEXT_SKILL_FOLDER = "flow-next-step";
const NEXT_SKILL_NAME = "flow-next-step";

function flowStatePath(): string {
  return `${RUNTIME_ROOT}/state/flow-state.json`;
}

function delegationLogPathLine(): string {
  return `${RUNTIME_ROOT}/state/delegation-log.json`;
}

function reconciliationNoticesPathLine(): string {
  return `${RUNTIME_ROOT}/state/reconciliation-notices.json`;
}

/**
 * Single source of truth for how /cc-next should treat Ralph Loop status.
 *
 * IMPORTANT: Ralph Loop is a **progress indicator + soft pre-advance nudge**,
 * not a hard gate. Hard enforcement always flows through flow-state.json
 * gates via `stage-complete.mjs`. Both the command contract and the skill
 * document render this same paragraph to prevent drift — see
 * `tests/e2e/next-command-ralph-loop-contract.test.ts`.
 */
export const RALPH_LOOP_CONTRACT_MARKER = "ralph-loop-contract:v1";

export function ralphLoopContractSnippet(): string {
  return `**Ralph Loop (tdd only).** When \`currentStage === "tdd"\`, read
\`${RUNTIME_ROOT}/state/ralph-loop.json\` (refreshed on every session-start
while the flow is in tdd) as a **progress indicator**:

- \`loopIteration\` — running count of RED → GREEN cycles already landed.
- \`acClosed\` — distinct acceptance-criterion IDs closed by GREEN rows
  (populated from \`acIds\` in \`tdd-cycle-log.jsonl\`).
- \`redOpenSlices\` — slices with an unsatisfied RED.

Ralph Loop is a **soft pre-advance nudge**, not a gate: do not advance
toward review while \`redOpenSlices\` is non-empty unless the user
explicitly defers a slice. Hard gate enforcement always flows through
\`flow-state.json\` gates via \`node .cclaw/hooks/stage-complete.mjs <stage>\`;
Ralph Loop fields never gate-check on their own.

<!-- ${RALPH_LOOP_CONTRACT_MARKER} -->`;
}

/**
 * Command contract for /cc-next — the primary progression command.
 * Reads flow-state, starts the current stage if unfinished, or advances if all gates pass.
 */
export function nextCommandContract(): string {
  const flowPath = flowStatePath();
  const skillRel = `${RUNTIME_ROOT}/skills/${NEXT_SKILL_FOLDER}/SKILL.md`;
  const delegationPath = delegationLogPathLine();
  const reconciliationNoticesPath = reconciliationNoticesPathLine();
  return `# /cc-next

## Purpose

**The primary progression command.** Read flow state, determine what to do:

- **Current stage not started / in progress** → load its skill and execute it.
- **Current stage complete (all gates passed)** → advance \`currentStage\` and load the next skill.
- **Ship complete** → continue the resumable ${closeoutChainInline()} closeout via \`/cc-next\`.
- **Flow complete** → report done after closeout has archived the run.

This is the only progression command the user needs to drive the entire flow. Stage command contracts are internal implementation details loaded by \`/cc-next\`.

## HARD-GATE

${conversationLanguagePolicyMarkdown()}
- **Do not** invent gate completion: use only \`${flowPath}\` plus observable evidence in repo artifacts.
- **Do not** skip stages: advance only from \`currentStage\` to its configured successor.
- ${closeoutNextCommandGuidance()}

## Algorithm (mandatory)

1. Read **\`${flowPath}\`**. If missing → **BLOCKED** (state missing).
2. Parse JSON. Capture \`currentStage\` and \`stageGateCatalog[currentStage]\`.
3. If \`staleStages[currentStage]\` exists, do not advance automatically. Report the stale marker reason/rewindId, re-run the stage artifact work, then clear only the current stage marker with \`cclaw internal rewind --ack <currentStage>\`.
4. Read **\`${reconciliationNoticesPath}\`** when present. If it contains entries for \`activeRunId + currentStage\` and the listed gate is still blocked in \`stageGateCatalog[currentStage].blocked\`, emit a structured warning before any stage-advance decision.
5. Let \`G\` = \`requiredGates\` for **\`currentStage\`** from the stage schema.
6. Let \`catalog\` = \`stageGateCatalog[currentStage]\` from flow state.
7. **Satisfied** for gate id \`g\`: \`g\` in \`catalog.passed\` and \`g\` not in \`catalog.blocked\`.
8. Let \`M\` = \`mandatoryDelegations\` for \`currentStage\`.
9. If \`M\` is non-empty, inspect **\`${delegationPath}\`**. Treat as satisfied only if each mandatory agent is **completed** or **waived**.
10. For each satisfied mandatory delegation row, verify \`evidenceRefs\` is a non-empty array (unless status is \`waived\` with rationale). Missing evidenceRefs means delegation is unresolved.
11. If any mandatory delegation is missing and no waiver exists: **STOP** and ask the user whether to dispatch now or waive with rationale. Do not mark gates passed while delegation is unresolved.
12. If \`currentStage === "review"\` and \`catalog.blocked\` includes \`review_criticals_resolved\`, treat this as a hard remediation branch: recommend the managed command \`cclaw internal rewind tdd "review_blocked_by_critical <finding-ids>"\`, and do not attempt to advance toward ship. After TDD rework, require \`cclaw internal rewind --ack tdd\` before continuing.

### Path A: Current stage is NOT complete (any gate unmet or delegation missing)

→ Load **\`${RUNTIME_ROOT}/skills/<skillFolder>/SKILL.md\`** for the current stage.
→ Execute that stage's protocol. The stage skill handles the full interaction including STOP points and gate tracking.
→ Stage completion must use \`node .cclaw/hooks/stage-complete.mjs <currentStage>\` (canonical), which validates delegations + gate evidence before mutating \`flow-state.json\`.

${ralphLoopContractSnippet()}

### Path B: Current stage IS complete (all gates passed, all delegations satisfied)

→ If current stage's \`next\` is **\`done\`**:

  ${closeoutSubstateProtocolBullets()}

  Otherwise report **"Flow complete. All stages finished."** and stop.

→ Otherwise: load **\`${RUNTIME_ROOT}/skills/<skillFolder>/SKILL.md\`** for the successor stage. Execute that stage's protocol.

### Track-aware successor resolution

\`flow-state.json\` carries a \`track\` field (\`"quick"\`, \`"medium"\`, or \`"standard"\`) and a \`skippedStages\` array.

- If \`track === "quick"\`, the critical path is **spec → tdd → review → ship**. When advancing, skip any stage listed in \`skippedStages\` — i.e. after the current stage completes, pick the next stage that is NOT in \`skippedStages\`.
- If \`track === "medium"\`, the critical path is **brainstorm → spec → plan → tdd → review → ship**. Scope and design are intentionally skipped unless the run is reclassified to standard.
- If \`track === "standard"\`, advance through all 8 stages in their natural order.
- Never manually reintroduce a skipped stage mid-run. If evidence shows the track was wrong, stop and use the managed start-flow helper with \`--reclassify\`; only that managed reclassification may add upstream stages back into the active track.

## Resume Semantics

\`/cc-next\` in a **new session** = resume from where you left off:
- Flow-state records \`currentStage\` and which gates have passed.
- The stage skill reads upstream artifacts and picks up context.
- ${closeoutSubstateInline()} carries the post-ship substate, so a crashed
  session during retro/compound/archive resumes at the exact step without
  regenerating the retro draft.
- No special resume command needed — \`/cc-next\` IS the resume command.

## Headless mode

When orchestrated by another skill/subagent, emit exactly one JSON envelope and
no narrative text:

\`\`\`json
{"version":"1","kind":"gate-result","stage":"<currentStage>","payload":{"command":"/cc-next","decision":"resume_or_advance","nextStage":"<nextStage>"},"emittedAt":"<ISO-8601>"}
\`\`\`

Validate envelopes with:
\`cclaw internal envelope-validate --stdin\`

## Primary skill

**${skillRel}** — full protocol and stage table.

## Surface reference

Use the flow-start skill plus \`.cclaw/state/flow-state.json\` for orientation when needed.
`;
}

/**
 * Skill body for /cc-next — the primary flow progression command.
 */
export function nextCommandSkillMarkdown(): string {
  const flowPath = flowStatePath();
  const delegationPath = delegationLogPathLine();
  const reconciliationNoticesPath = reconciliationNoticesPathLine();

  const stageRows = (["brainstorm", "scope", "design", "spec", "plan", "tdd", "review", "ship"] as const)
    .map((stage) => {
      const skillMd = `${RUNTIME_ROOT}/skills/${stageSkillFolder(stage)}/SKILL.md`;
      const standardNext = nextStageForTrack(stage, "standard") ?? "(terminal)";
      const mediumNext = nextStageForTrack(stage, "medium") ?? "not in track";
      const quickNext = nextStageForTrack(stage, "quick") ?? "not in track";
      return `| \`${stage}\` | \`${standardNext}\` | \`${mediumNext}\` | \`${quickNext}\` | \`${skillMd}\` |`;
    })
    .join("\n");

  const naturalStageRows = (["brainstorm", "scope", "design", "spec", "plan", "tdd", "review", "ship"] as const)
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

## Operator Output Contract

${conversationLanguagePolicyMarkdown()}
Default output should be compact, like OMC/OMX operator surfaces:

\`\`\`
Stage: <currentStage> (<track>)
Gates: <passed>/<required> passed, <blocked> blocked
Delegations: <done>/<mandatory> done
Blockers: <none | gate/delegation/reconciliation ids>
Next: <exact next action, usually /cc-next or one named remediation>
\`\`\`

Only expand beyond this when blocked, when asking a structured question, or when
the user explicitly requests detail. Do not dump full artifacts in progression output.

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
3. If \`staleStages[currentStage]\` exists, show the marker reason/rewindId, re-run the stage, and clear only the current marker via \`cclaw internal rewind --ack <currentStage>\` before advancing.
4. If the file is missing or invalid JSON → **BLOCKED** (report and stop).
5. Read \`${reconciliationNoticesPath}\` when present. For entries matching \`activeRunId + currentStage\` whose gate is still in \`stageGateCatalog[currentStage].blocked\`, show a warning with gate id + reason before proceeding.

### Step 2: Evaluate gates

For each gate id in \`requiredGates\` for \`currentStage\`:
- **Met** if in \`catalog.passed\` and not in \`catalog.blocked\`.
- **Unmet** otherwise.

Check \`mandatoryDelegations\` via **\`${delegationPath}\`** — satisfied only if **completed** or **waived**.
Also verify each completed mandatory delegation row has non-empty \`evidenceRefs\` (waived rows must include rationale).
If a mandatory delegation is missing and no waiver exists, **STOP** and ask:
(A) dispatch now, (B) waive with rationale, (C) cancel stage advance.

If reconciliation warnings were emitted in Step 1, treat them as a pre-advance stop point: require explicit acknowledgement before continuing Path A or Path B.

### Step 3: Act

**Path A — stage NOT complete (any gate unmet):**

Load the current stage skill:
- \`${RUNTIME_ROOT}/skills/<skillFolder>/SKILL.md\`

Execute the stage protocol. The stage skill handles interaction, STOP points, gate tracking, and stage completion via \`node .cclaw/hooks/stage-complete.mjs <stage>\` (canonical flow-state mutation path).

${ralphLoopContractSnippet()}

Special-case for review: if \`review_criticals_resolved\` is in \`blocked\`, route to rework instead of looping review forever — recommend \`cclaw internal rewind tdd "review_blocked_by_critical <finding-ids>"\`, then \`cclaw internal rewind --ack tdd\` after TDD rework.

**Path B — stage IS complete (all gates met, all delegations done):**

If \`next\` is \`done\`:

When \`currentStage\` is \`ship\`, automatically drive the **closeout chain**
by inspecting ${closeoutSubstateInline()}:

| shipSubstate          | Action                                              |
|-----------------------|-----------------------------------------------------|
| \`idle\` / missing      | Flip to \`retro_review\` and start retro protocol     |
| \`retro_review\`        | Draft/update \`09-retro.md\`, ask accept/edit/skip  |
| \`compound_review\`     | Compound closeout: overlap scan, refresh/supersede, ask approve/skip |
| \`ready_to_archive\`    | Run \`npx cclaw-cli archive\`; reset flow-state on success |
| \`archived\`            | Report "run archived"; stop                         |

Each step owns its own state transition. \`/cc-next\` keeps retro and compound
in-session, then uses the archive runtime only at \`ready_to_archive\`.

Otherwise report **"Flow complete. All stages finished."** and stop.

Otherwise (non-terminal \`next\`): load the next stage skill and begin execution.

## Stage order

This table is the track-aware critical path. It must match \`flow-state.json.track\`; do not follow the natural schema edge when the active track skips a stage. After \`ship\`, \`/cc-next\` continues closeout via ${closeoutSubstateInline()}: ${closeoutChainInline()}.

| Stage | Standard next | Medium next | Quick next | Skill path |
|---|---|---|---|---|
${stageRows}

Natural schema edge reference for diagnostics only:

| Stage | Natural next | Skill path |
|---|---|---|
${naturalStageRows}

## Anti-patterns

- Advancing when \`blocked\` is non-empty for the current stage.
- Treating \`passed\` as trusted when artifact evidence contradicts it.
- Skipping **review** or **ship** because "the code looks fine".
- Loading a stage skill directly instead of using \`/cc-next\` for progression.
`;
}
