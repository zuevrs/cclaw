export interface AutoTriggerSkill {
  id: string;
  fileName: string;
  description: string;
  triggers: string[];
  body: string;
}

const PLAN_AUTHORING = `---
name: plan-authoring
trigger: when writing or updating .cclaw/plans/<slug>.md
---

# Skill: plan-authoring

Use this skill whenever you create or modify a file under \`.cclaw/plans/\`.

## Rules

1. **Frontmatter is mandatory.** Every plan starts with the YAML block from \`.cclaw/templates/plan.md\`. Required keys: \`slug\`, \`stage\`, \`status\`, \`ac\`, \`last_specialist\`, \`refines\`, \`shipped_at\`, \`ship_commit\`, \`review_iterations\`, \`security_flag\`.
2. **AC ids are sequential** starting at \`AC-1\`. They must match the AC table inside the body.
3. **Each AC is observable.** Verification line is mandatory. If you cannot write the verification, the AC is not real.
4. **The traceability block at the end** is rebuilt by \`commit-helper.mjs\`. Do not edit it by hand once a commit was recorded.
5. **Out-of-scope items** stay in the body. Do not let them leak into AC.

## When refining a shipped slug

- Quote at most one paragraph from \`.cclaw/shipped/<old-slug>/plan.md\`.
- Set \`refines: <old-slug>\` in the new plan's frontmatter.
- Do not copy the shipped AC verbatim — write fresh AC for the refinement.

## What to refuse

- Plans without AC.
- Plans whose AC count exceeds 12 (split first).
- Plans that change scope between brainstormer and planner without going back to brainstormer.
`;

const AC_TRACEABILITY = `---
name: ac-traceability
trigger: when committing changes for an active cclaw run
---

# Skill: ac-traceability

cclaw v8 has one mandatory gate: every commit produced inside \`/cc\` references exactly one AC, and the AC ↔ commit chain is recorded in \`flow-state.json\`.

## Rules

1. Use \`node .cclaw/hooks/commit-helper.mjs --ac=AC-N --message="..."\` for every AC commit. Do not call \`git commit\` directly.
2. Stage only AC-related changes before invoking the hook.
3. The hook will refuse the commit if:
   - \`AC-N\` is not declared in the active plan;
   - \`flow-state.json\` schemaVersion is not \`2\`;
   - nothing is staged.
4. After the commit succeeds, the hook records the SHA in \`flow-state.json\` under the matching AC and re-renders the traceability block in \`plans/<slug>.md\`.
5. \`runCompoundAndShip\` refuses to ship a slug with any pending AC. There is no override.

## When you accidentally committed without the hook

- \`flow-state.json\` is now out of sync with the working tree.
- Run the hook manually for the affected AC: \`node .cclaw/hooks/commit-helper.mjs --ac=AC-N --message="resync"\` while staging an empty change is not allowed; instead, edit \`.cclaw/state/flow-state.json\` to add the SHA to the AC entry by hand and verify with the orchestrator before continuing.
`;

const REFINEMENT = `---
name: refinement
trigger: when /cc detects an existing plan (active or shipped) for the new task
---

# Skill: refinement

\`/cc\` performs existing-plan detection at the start of every invocation. When it finds a fuzzy match, the user is asked to choose one of:

- **amend** — keep the active plan, add new AC, leave already-committed AC intact;
- **rewrite** — replace the active plan body and AC entirely (commits remain in git, but AC ids restart);
- **refine shipped** — create a new plan with \`refines: <old-slug>\` linking to the shipped slug;
- **new** — start an unrelated plan.

## Rules for refinement

1. \`refines: <old-slug>\` is set in the new plan's frontmatter and must match a real shipped slug.
2. Do not move artifacts out of \`.cclaw/shipped/\`. The shipped slug stays read-only.
3. The new plan can quote up to one paragraph from the shipped plan but must restate the full Context for the refinement.
4. AC ids restart at AC-1 in the new plan. Do not number "AC-13" because the shipped slug had 12 AC.
5. \`knowledge.jsonl\` will record the new entry with \`refines: <old-slug>\` so the index forms a chain.

## What the orchestrator surfaces

- last_specialist of the active plan, so the user can see "stopped at architect" or "review iteration 3 in progress".
- The AC table with their statuses (\`pending\` / \`committed\`).
- Whether \`security_flag\` was set.
- A direct link to \`.cclaw/shipped/<slug>/manifest.md\` if the match is a shipped slug.
`;

const PARALLEL_BUILD = `---
name: parallel-build
trigger: when planner topology = parallel-build
---

# Skill: parallel-build

\`parallel-build\` is the only parallelism allowed during build. It is opt-in. The orchestrator never picks it without planner naming it explicitly in \`plans/<slug>.md\` Topology section.

## Pre-conditions

1. 4 or more AC.
2. AC touch disjoint file sets — no path overlap between any two AC.
3. No AC depends on the output of another AC in the same wave.

## Execution

1. Spawn one \`slice-builder\` per slice. Each slice owns one or more AC.
2. Each slice-builder records its commits in \`builds/<slug>.md\` with the AC ids it owns.
3. After all slice-builders finish, invoke \`reviewer\` in mode \`integration\`.
4. Integration reviewer checks: path conflicts, double-edits, AC↔commit chain across all slices, integration tests covering the boundary.
5. If integration finds problems, the orchestrator dispatches \`slice-builder\` in \`fix-only\` mode bound to the cited findings.

## Hard rules

- The reviewer in \`integration\` mode is mandatory. There is no shortcut.
- Slice-builders never read each other's working trees mid-flight.
- A slice-builder that detects a conflict with another slice stops and raises an integration finding.
`;

const SECURITY_REVIEW = `---
name: security-review
trigger: when the diff touches authn / authz / secrets / supply chain / data exposure
---

# Skill: security-review

The orchestrator dispatches \`security-reviewer\` automatically when the active task or diff touches sensitive surfaces. You can also invoke it explicitly with \`/cc <task> --security-review\`.

## Rules

1. \`security-reviewer\` is a separate specialist from \`reviewer\`. They can run in parallel against the same diff.
2. \`security-reviewer\` decisions of severity \`security\` are block-level: ship is blocked until they are resolved by slice-builder mode=fix-only and the security review reruns clear.
3. \`security_flag: true\` in plan frontmatter triggers the compound learning gate even if no other quality signal is present.

## Threat-model checklist (mandatory)

For every \`threat-model\` invocation, write \`ok\` / \`flag\` / \`n/a\` for each:

1. Authentication
2. Authorization
3. Secrets (committed credentials, env, signing keys)
4. Supply chain (new third-party deps, version pinning, provenance)
5. Data exposure (logging, transmission, storage of user data)

## Pure UI / docs diffs

State explicitly that all five items are \`n/a\` and write a one-line justification per item. Do not skip the checklist.
`;

const REVIEW_LOOP = `---
name: review-loop
trigger: when reviewer or security-reviewer is invoked
---

# Skill: review-loop

Every review iteration runs the **Five Failure Modes** checklist:

1. Hallucinated actions
2. Scope creep
3. Cascading errors
4. Context loss
5. Tool misuse

For each, the reviewer answers yes/no with a citation when "yes". A "yes" without a citation is itself a finding.

## Hard cap

- 5 review iterations per slug. After the 5th, the reviewer writes \`status: cap-reached\` and stops.
- The orchestrator surfaces remaining blockers and recommends \`/cc-cancel\` or splitting the work into a fresh slug.

## Decision values

- \`block\` — slice-builder mode=fix-only must run; re-review after.
- \`warn\` — record warnings; ship may proceed.
- \`clear\` — ready for ship.
- \`cap-reached\` — see hard cap above.
`;

const COMMIT_MESSAGE_QUALITY = `---
name: commit-message-quality
trigger: before every commit-helper.mjs invocation
---

# Skill: commit-message-quality

\`commit-helper.mjs\` accepts any non-empty message, but the AC traceability chain only stays useful if the messages stay readable.

## Rules

1. **Imperative voice** — "Add StatusPill component", not "Added" or "Adding".
2. **Subject ≤72 characters** — long subjects truncate in \`git log --oneline\` and CI signals.
3. **Subject does not repeat the AC id** — the hook already appends \`refs: AC-N\`.
4. **Body when needed** — second-line blank, then a short rationale paragraph and any non-obvious context. Use \`--message\` for the subject; if the message must be multi-line, write it to a file and pass \`--file\`.
5. **Cite finding ids in fix commits** — \`fix: F-2 separate rejected token\`.

## Anti-patterns

- "WIP", "fixes", "stuff", "more". The reviewer rejects these as F-1 \`block\`.
- Subject lines that paraphrase the diff. Diff is the diff; the message is the why.
- Co-author trailers in solo commits.

## When to amend

Never amend a commit produced by \`commit-helper.mjs\` after the SHA is recorded in \`flow-state.json\`. Amend changes the SHA and breaks the AC chain. If the message is wrong, write a short note in \`builds/<slug>.md\` and move on; it is recoverable in review.
`;

const AC_QUALITY = `---
name: ac-quality
trigger: when authoring or reviewing AC entries
---

# Skill: ac-quality

Three checks per AC:

1. **Observable** — a user, test, or operator can tell whether it is satisfied without reading the diff.
2. **Independently committable** — a single commit covering only this AC is meaningful.
3. **Verifiable** — there is an explicit verification line (test name, manual step, or command).

## Smell check

| smell | example | rewrite |
| --- | --- | --- |
| sub-task | "implement the helper" | "search returns BM25-ranked results for queries with multiple terms" |
| vague verification | "tests pass" | "verified by tests/unit/search.test.ts: 'returns BM25-ranked hits'" |
| internal detail | "refactor the cache" | "cache hit rate >90% on the dashboard repaint scenario" |
| compound AC | "build the page and add analytics" | split into two AC |

## Numbering

- AC ids start at \`AC-1\` and are sequential.
- Refinement slugs restart at \`AC-1\` even when they refine a slug that had AC-1..AC-12.
- Do not reuse an AC id within the same slug; if you delete an AC, the remaining ids stay sequential after compaction.

## When to add an AC mid-flight

You don't. Adding AC during build is scope creep. Either the new work fits an existing AC (no new id), or it should be a follow-up (\`/cc-idea\`) or a fresh slug.
`;

const REFACTOR_SAFETY = `---
name: refactor-safety
trigger: when the slug is identified as a pure refactor
---

# Skill: refactor-safety

Refactors must be **behaviour-preserving**. The harness enforces this with three structural rules.

## Pin behaviour first

Before any rewrite, identify the pin:

- existing tests that should pass with the same expected output;
- a snapshot or fixture set that should not change;
- a manual repro the user accepts as the contract.

If no pin exists, "add a pin" is AC-1 of the refactor.

## One refactor at a time

A refactor slug must contain refactor changes only. A bug fix that would have been "while we're here" is a separate slug. The pin from the refactor slug is then valid input for the fix slug.

## Public API discipline

If the refactor renames or restructures public exports:

- add a deprecation alias so external consumers still compile;
- mark the old name with a \`@deprecated\` JSDoc / equivalent;
- record the deprecation deadline in \`ships/<slug>.md\`.

If the project policy forbids deprecation aliases (some libraries), the refactor is breaking; \`security_flag\` does not apply but breaking-change handling does (see breaking-changes skill).

## Verification

Refactor AC verification is "no behavioural diff": tests pass, snapshots unchanged, fixtures unchanged. If anything changes, the refactor leaked behaviour and must be split.
`;

const BREAKING_CHANGES = `---
name: breaking-changes
trigger: when the diff modifies public API surface or persisted contracts
---

# Skill: breaking-changes

A change is breaking when:

- a public export is renamed, removed, or changes signature;
- a CLI flag is renamed or removed;
- a wire format (HTTP, RPC, queue payload) changes shape or required fields;
- a persisted contract (DB schema, file format, env var) changes in a way that requires migration.

## Rules

1. **Plan must declare it.** Set \`breaking_change: true\` (or note it explicitly in the plan body).
2. **Migration must exist.** \`ships/<slug>.md\` carries a migration section: who is affected, what they need to do, when the old path stops working.
3. **Deprecation window.** Public libraries — at least one minor version. Internal services — at least one deploy cycle and one alert.
4. **Release notes.** The CHANGELOG line must start with \`BREAKING:\` and link to the migration section.

## Coexistence

When possible, ship the new path alongside the old. Examples:

- new endpoint path next to the old one;
- new column added before the old one is dropped;
- new env var name accepted along with the old (with a deprecation log line);
- new function exported with the new name; old name aliased to it.

Coexistence is not always possible (e.g. wire-format changes for older clients you cannot upgrade). When it is not possible, surface this back to architect; the decision must be recorded in \`decisions/<slug>.md\`.

## Common pitfalls

- "Internal API, not breaking." If the change crosses a service boundary, treat it as breaking.
- Renaming a CLI flag without an alias. Aliases for CLI flags are nearly always free; add them.
- Skipping the CHANGELOG line because "everyone knows". They do not.
- Forgetting the alert window for internal services. The deploy cycle is not enough; users need a heads-up.
`;

export const AUTO_TRIGGER_SKILLS: AutoTriggerSkill[] = [
  {
    id: "plan-authoring",
    fileName: "plan-authoring.md",
    description: "Auto-applies whenever the agent edits .cclaw/plans/<slug>.md.",
    triggers: ["edit:.cclaw/plans/*.md", "create:.cclaw/plans/*.md"],
    body: PLAN_AUTHORING
  },
  {
    id: "ac-traceability",
    fileName: "ac-traceability.md",
    description: "Enforces commit-helper invocation and AC↔commit chain.",
    triggers: ["before:git-commit", "before:git-push"],
    body: AC_TRACEABILITY
  },
  {
    id: "refinement",
    fileName: "refinement.md",
    description: "Activates when /cc detects an existing plan match.",
    triggers: ["existing-plan-detected"],
    body: REFINEMENT
  },
  {
    id: "parallel-build",
    fileName: "parallel-build.md",
    description: "Rules and execution playbook for the parallel-build topology.",
    triggers: ["topology:parallel-build"],
    body: PARALLEL_BUILD
  },
  {
    id: "security-review",
    fileName: "security-review.md",
    description: "Activates when the diff touches sensitive surfaces.",
    triggers: ["security-flag:true", "diff:auth|secrets|supply-chain|pii"],
    body: SECURITY_REVIEW
  },
  {
    id: "review-loop",
    fileName: "review-loop.md",
    description: "Wraps every reviewer / security-reviewer invocation.",
    triggers: ["specialist:reviewer", "specialist:security-reviewer"],
    body: REVIEW_LOOP
  },
  {
    id: "commit-message-quality",
    fileName: "commit-message-quality.md",
    description: "Enforces commit-message conventions for commit-helper.mjs.",
    triggers: ["before:commit-helper"],
    body: COMMIT_MESSAGE_QUALITY
  },
  {
    id: "ac-quality",
    fileName: "ac-quality.md",
    description: "Three-check rubric for every AC entry; smell tests + numbering rules.",
    triggers: ["edit:.cclaw/plans/*.md", "specialist:planner", "specialist:reviewer:text-review"],
    body: AC_QUALITY
  },
  {
    id: "refactor-safety",
    fileName: "refactor-safety.md",
    description: "Behaviour-preservation rules for pure-refactor slugs.",
    triggers: ["task:refactor", "pattern:refactor"],
    body: REFACTOR_SAFETY
  },
  {
    id: "breaking-changes",
    fileName: "breaking-changes.md",
    description: "Detect and document breaking changes; coexistence rules and CHANGELOG template.",
    triggers: ["diff:public-api", "frontmatter:breaking_change=true"],
    body: BREAKING_CHANGES
  }
];
