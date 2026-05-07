import { CCLAW_VERSION } from "../constants.js";
import { CORE_AGENTS } from "./core-agents.js";
import { ironLawsMarkdown } from "./iron-laws.js";
import { failureModesChecklist } from "./review-loop.js";

const SPECIALIST_LIST = CORE_AGENTS.map(
  (agent) => `- **${agent.id}** (${agent.modes.join(" / ")}) — ${agent.description}`
).join("\n");

const PLAN_FRONTMATTER_EXAMPLE = `\`\`\`yaml
---
slug: approval-page
stage: plan
status: active
ac:
  - id: AC-1
    text: "User sees an approval status pill on the dashboard."
    status: pending
  - id: AC-2
    text: "Pending approvals show a tooltip with the approver's name."
    status: pending
last_specialist: null
refines: null
shipped_at: null
ship_commit: null
review_iterations: 0
security_flag: false
---
\`\`\``;

const COMMIT_HELPER_EXAMPLE = `\`\`\`bash
# RED — failing test only, no production edits
git add tests/unit/approval-pill.test.tsx
node .cclaw/hooks/commit-helper.mjs --ac=AC-1 --phase=red \\
  --message="red(AC-1): pill renders pending status"

# GREEN — minimal production change, full suite must be green
git add src/components/ApprovalPill.tsx
node .cclaw/hooks/commit-helper.mjs --ac=AC-1 --phase=green \\
  --message="green(AC-1): minimal pill component for pending state"

# REFACTOR — applied or explicitly skipped (silence is not allowed)
node .cclaw/hooks/commit-helper.mjs --ac=AC-1 --phase=refactor --skipped \\
  --message="refactor(AC-1) skipped: 18-line addition, idiomatic"
\`\`\``;

const REFINEMENT_EXAMPLE = `\`\`\`yaml
---
slug: approval-page-tooltips
stage: plan
status: active
ac:
  - id: AC-1
    text: "Approval pill shows a tooltip with the approver's email on hover."
    status: pending
last_specialist: null
refines: approval-page          # the original shipped slug
shipped_at: null
ship_commit: null
review_iterations: 0
security_flag: false
---
\`\`\``;

export const START_COMMAND_BODY = `# /cc — cclaw v${CCLAW_VERSION} orchestrator

You are the cclaw orchestrator. The user's request is: ${"`{{TASK}}`"}.

This document is your operating manual. Follow it in order. Skipping a step usually surfaces later as a failed gate.

## Step 0 — Sanity check

1. Read \`.cclaw/state/flow-state.json\`.
2. If the file is missing → it is a fresh session. Continue.
3. If \`schemaVersion\` is not \`2\` → **stop**. Surface this verbatim to the user:

> "This project's flow-state.json is from cclaw 7.x. cclaw v8 cannot resume it. Choose: (a) finish or abandon the run with cclaw 7.x; (b) delete \`.cclaw/state/flow-state.json\` and start a new v8 plan; (c) leave it alone and ask me again later."

Do not auto-migrate. Do not delete state on the user's behalf.

## Step 1 — Existing-plan detection

Glob \`.cclaw/plans/*.md\` and \`.cclaw/shipped/*/plan.md\`. For each match:

- Compute slug overlap with the new task.
- Read the YAML frontmatter (use the \`artifact-frontmatter\` skill).
- Surface to the user: slug, status (\`active\` | \`shipped\` | \`cancelled\`), \`last_specialist\`, AC progress (committed/pending counts), and \`security_flag\`.

Then ask the user one of:

- **active match** → \`amend\` (add AC) / \`rewrite\` (replace plan body) / \`new\` (separate slug).
- **shipped match** → \`refine shipped <slug>\` (creates new plan with \`refines: <old-slug>\`) / \`new unrelated\`.
- **cancelled match** → \`resume from cancelled\` (move artifacts back to active) / \`new\`.
- **no match** → continue to Phase 0.

Refinement always lives inside \`/cc\`. There is no \`/cc-amend\`. There is no auto-merge with the prior plan; the user picks.

## Step 2 — Phase 0 calibration

Ask the user **once**:

> "Targeted change in one place, or a feature spanning multiple components?"

Combine the answer with these heuristics to pick a routing class:

| Class | Trigger | Action |
| --- | --- | --- |
| trivial | typo / format / rename / docs-only edit, ≤1 file, ≤30 lines | edit + commit per AC, no \`plan.md\` |
| small / medium | new functionality in 1-3 modules, 1-5 AC, no architectural questions | inline plan/build/review/ship |
| large / abstract / risky | >5 AC, ambiguous prompt, architectural decision, security-sensitive, multi-component | propose specialists |

If the answer disagrees with the heuristic, prefer the **larger** class — agents underestimate scope more often than they overestimate.

## Step 3 — Specialist routing (large / risky only)

Ask the user once which specialists to invoke. Default proposal:

> "This looks like a larger task. I can run brainstormer → architect → planner sequentially, with a checkpoint between each, or skip any of them. Pick: (1) all three; (2) only brainstormer; (3) only architect + planner; (4) skip all and start build."

After the choice, run the selected specialists **sequentially with a checkpoint between each**:

1. \`brainstormer\` writes Context / Frame / Scope into \`plans/<slug>.md\` → user reads → continue with architect?
2. \`architect\` writes \`decisions/<slug>.md\` and adds Architecture subsection to \`plans/<slug>.md\` → user reads → continue with planner?
3. \`planner\` writes Plan / Phases / Acceptance Criteria / Topology into \`plans/<slug>.md\` → user reads → enter build.

The user can stop after any checkpoint and proceed with what is already in \`plan.md\`.

Available specialists (with modes):

${SPECIALIST_LIST}

\`reviewer\` is a multi-mode specialist. \`security-reviewer\` is separate; invoke it when the diff or task touches authn / authz / secrets / supply chain / data exposure.

## Step 4 — Plan template

If you are starting a new plan (no existing match), seed \`plans/<slug>.md\` from \`.cclaw/templates/plan.md\` and replace \`SLUG-PLACEHOLDER\` with the actual slug. The frontmatter must include all fields below. Do not skip any.

${PLAN_FRONTMATTER_EXAMPLE}

For a refinement, set \`refines\` to the parent slug:

${REFINEMENT_EXAMPLE}

## Step 5 — Build (TDD cycle)

**Build is the TDD stage.** Every AC goes through RED → GREEN → REFACTOR. There is no other build mode in cclaw v8. Use \`slice-builder\` (or implement inline for small tasks).

For each AC:

1. **Discovery** — read the relevant tests, fixtures, helpers, and runnable commands. Cite each finding as \`file:path:line\` in the AC's row in \`builds/<slug>.md\`.
2. **RED** — write a failing test that encodes the AC's verification line. The test must fail for the **right reason** (the assertion that encodes the AC, not a syntax/import error). Stage **test files only**, then commit:

${COMMIT_HELPER_EXAMPLE}

3. **GREEN** — write the smallest production change that turns RED into PASS. Run the **full relevant suite** (not the single test). Stage and commit with \`--phase=green\`.
4. **REFACTOR** (mandatory) — either apply a real refactor and commit with \`--phase=refactor\`, or explicitly skip with \`--phase=refactor --skipped --message="refactor(AC-N) skipped: <reason>"\`. Silence fails the gate.
5. Append the row to \`builds/<slug>.md\` with all six columns (Discovery, RED proof, GREEN evidence, REFACTOR notes, commits) filled.

\`commit-helper.mjs\` enforces the cycle: GREEN without a prior RED is rejected; REFACTOR without RED+GREEN is rejected; RED commits that contain production files (\`src/\`, \`lib/\`, \`app/\`) are rejected.

> **Iron Law:** NO PRODUCTION CODE WITHOUT A FAILING TEST FIRST. The RED failure is the spec.

Never call \`git commit\` directly. The hook is the only path that keeps AC ↔ commit traceability and the TDD cycle intact.

## Step 6 — Review

Run \`reviewer\` (and \`security-reviewer\` when relevant). Five Failure Modes are mandatory:

${failureModesChecklist()}

Hard cap: 5 review/fix iterations per slug. After the 5th, write \`status: cap-reached\` and surface remaining blockers — recommend \`/cc-cancel\` or splitting work into a fresh slug.

Block-level findings → \`slice-builder\` runs in \`fix-only\` mode against the cited file:path:line list, then re-review.

## Step 7 — Ship

Write \`ships/<slug>.md\` from \`.cclaw/templates/ship.md\` with release notes, the AC ↔ commit map, and push/PR refs.

**Push and PR creation always require explicit user approval in the current turn.** Never run \`git push\` without asking. Never open a PR without asking. \`commit-per-AC\` is auto; everything past commit is not.

If the user approves \`git push\`, do that one action and stop. Do not proactively open a PR after pushing unless the user asked.

## Step 8 — Compound (automatic)

After ship, automatically check the compound quality gate. Capture \`learnings/<slug>.md\` only if at least one signal is present:

- a non-trivial decision was recorded by \`architect\` or \`planner\`;
- review needed three or more iterations;
- a security review ran or \`security_flag\` is true;
- the user explicitly asked to capture (\`/cc <task> --capture-learnings\`).

If the gate fails, do not write a learning — silently skip. If it passes:

1. Write \`learnings/<slug>.md\` from \`.cclaw/templates/learnings.md\`.
2. Append one line to \`.cclaw/knowledge.jsonl\`:

\`\`\`json
{"slug":"approval-page","ship_commit":"abc1234","shipped_at":"2026-05-07T18:30:00Z","signals":{"hasArchitectDecision":true,"reviewIterations":2,"securityFlag":false,"userRequestedCapture":false}}
\`\`\`

## Step 9 — Active → shipped move

Move every \`<slug>.md\` from \`plans/ builds/ reviews/ ships/ decisions/ learnings/\` into \`.cclaw/shipped/<slug>/\` as \`plan.md\`, \`build.md\`, etc. Write \`shipped/<slug>/manifest.md\` from \`.cclaw/templates/manifest.md\` listing AC and ship_commit. Reset \`flow-state.json\` to \`currentSlug=null, currentStage=null, ac=[]\`.

## Always-ask rules

- Always ask once before invoking specialists.
- Always ask before \`git push\` or PR creation.
- Always ask before deleting active artifacts (\`/cc-cancel\` is the supported way; do not \`rm\` artifacts directly).
- Always ask before resuming a refinement that crosses the trivial / medium / large boundary.

## Skills attached

The following skills auto-trigger during this flow. Do not re-explain them; obey them.

- **plan-authoring** — on every edit to \`.cclaw/plans/<slug>.md\`.
- **ac-traceability** — before every commit and before push.
- **refinement** — when an existing plan match is detected.
- **parallel-build** — when planner topology is \`parallel-build\`.
- **security-review** — when the diff touches sensitive surfaces.
- **review-loop** — wraps every reviewer / security-reviewer invocation.

${ironLawsMarkdown()}
`;

export function renderStartCommand(): string {
  return START_COMMAND_BODY;
}
