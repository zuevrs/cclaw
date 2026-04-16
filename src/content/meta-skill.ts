/**
 * using-cclaw meta-skill — injected at SessionStart via hooks.
 *
 * Like agent-skills' using-agent-skills, this teaches the agent HOW to use
 * cclaw: skill discovery flowchart, activation rules, skill behaviors.
 * The full text is injected by session-start.sh so the agent always has
 * routing context without needing to read files first.
 */

export const META_SKILL_NAME = "using-cclaw";

export function usingCclawSkillMarkdown(): string {
  return `---
name: using-cclaw
description: "Meta-skill: discovers and activates the right cclaw stage for the current task. Injected at every session start. This is the routing brain — follow the flowchart before starting any work."
---

# Using Cclaw

This meta-skill helps you discover and apply the right cclaw stage for the current task. It is injected at every session start so you always have routing context.

## Skill Discovery Flowchart

Use \`/cc\` to start or \`/cc-next\` to continue:

\`\`\`
Task arrives
    |
    +-- New idea / starting fresh?  --> /cc <idea>  (starts brainstorm)
    +-- Resuming / continuing?  --> /cc  or  /cc-next
    +-- Want to check/add project knowledge?  --> /cc-learn
    +-- No cclaw stage applies?  --> Respond normally
\`\`\`

Stage progression is handled automatically by \`/cc-next\`. The flow moves through:
brainstorm → scope → design → spec → plan → tdd → review → ship

## Flow State Check

Before starting work, ALWAYS:

1. Read \`.cclaw/state/flow-state.json\` for the current stage.
2. If a stage is active, continue with \`/cc\` or \`/cc-next\` (do not jump directly to per-stage commands).
3. If no stage applies (e.g. simple question, unrelated task), respond normally.

## Activation Rules

1. **Check for an applicable stage before starting work.** Stages encode processes that prevent common mistakes.
2. **Stages are workflows, not suggestions.** Follow the skill steps in order. Do not skip verification steps.
3. **One stage at a time.** Complete the current stage before advancing to the next.
4. **Gates must pass.** Every stage has required gates — the agent cannot claim completion without satisfying them.
5. **Artifacts are mandatory.** Each stage writes to \`.cclaw/artifacts/\`; completed features are archived later with \`cclaw archive\`.
6. **When in doubt, use \`/cc\`.** If the task is non-trivial and there's no prior artifact, run \`/cc <idea>\` to start brainstorming.

## Stage Quick Reference

| Stage | How to enter | HARD-GATE | Artifact |
|-------|--------------|-----------|----------|
| Brainstorm | \`/cc <idea>\` (or \`/cc\` on fresh flow) | No implementation planning | \`01-brainstorm.md\` |
| Scope | via \`/cc-next\` | Challenge premises first | \`02-scope.md\` |
| Design | via \`/cc-next\` | Search before building | \`03-design.md\` |
| Spec | via \`/cc-next\` | Observable + testable criteria | \`04-spec.md\` |
| Plan | via \`/cc-next\` | One task = one purpose | \`05-plan.md\` |
| TDD | via \`/cc-next\` | RED → GREEN → REFACTOR per slice | \`06-tdd.md\` |
| Review | via \`/cc-next\` | Two-layer review | \`07-review.md\` |
| Ship | via \`/cc-next\` | All tests green on merge | \`08-ship.md\` |

## Skill Loading

\`/cc-next\` (and \`/cc\`) automatically loads the right stage files:
1. **\`.cclaw/skills/<stage>/SKILL.md\`** — the full procedural guide (read this first and follow it)
2. **\`.cclaw/commands/<stage>.md\`** — thin orchestrator (entry/exit summary, gates, anchors)

Skills contain: checklist, examples, cognitive patterns, interaction protocol, gates, evidence requirements, verification, cross-stage traceability, anti-patterns, and self-improvement prompts.

## Contextual Skills (auto-activated, no commands needed)

These skills live in \`.cclaw/skills/\` but have no slash commands. They activate automatically based on context:

| Skill | Folder | Activates when... |
|-------|--------|-------------------|
| Security Review | \`security/\` | During review/ship stages; when code handles auth, user input, secrets, or external data |
| Debugging | \`debugging/\` | When tests fail unexpectedly; runtime errors; behavior doesn't match spec |
| Performance | \`performance/\` | During review; when code is perf-sensitive (DB queries, rendering, bundle size) |
| CI/CD | \`ci-cd/\` | During ship; when pipeline config or deployment is involved |
| Documentation | \`docs/\` | During ship; when adding public APIs, architecture changes, or breaking changes |
| Executing Plans | \`executing-plans/\` | After plan approval during sustained task execution waves |
| Context Engineering | \`context-engineering/\` | When work mode changes (execution, review, incident) or context pressure rises |
| Source-Driven Development | \`source-driven-development/\` | Before introducing new patterns/helpers; when deciding reuse vs net-new structure |
| Frontend Accessibility | \`frontend-accessibility/\` | For user-facing UI changes and accessibility quality gates |

**Activation rule:** When a contextual skill applies, read its SKILL.md and follow it as a supplementary lens alongside the current stage. Do not skip the stage workflow — the contextual skill adds depth, not a detour.

## Custom Skills (project-owned, sync-safe)

\`.cclaw/custom-skills/\` is a sync-safe directory. \`cclaw sync\` and \`cclaw upgrade\` **never overwrite** files there.

Use it to add **project-specific** skills that complement the managed library:

- Each skill: \`.cclaw/custom-skills/<folder>/SKILL.md\` following the public-API frontmatter schema documented in \`.cclaw/custom-skills/README.md\`.
- The frontmatter public API is stable across cclaw releases: \`name\`, \`description\` (required), plus optional \`stages\`, \`triggers\`, \`hardGate\`, \`owners\`, \`version\`.
- Routing precedence when loading a stage:
  1. Active stage skill under \`.cclaw/skills/<stage>/\`.
  2. Managed utility skills whose trigger matches (\`landscape-check\`, \`security-audit\`, \`adversarial-review\`, etc.).
  3. **Custom skills** whose \`stages\` array includes the active stage (or is missing) AND whose \`description\` / \`triggers\` match the prompt.
- Custom skills are **never mandatory delegations** — they are opt-in lenses. If you need a mandatory dispatch, promote the skill upstream or add a managed specialist instead.
- Activate by mentioning the skill name explicitly, or rely on semantic routing from the description + triggers.
- See \`.cclaw/custom-skills/README.md\` for the full convention and a starter template under \`.cclaw/custom-skills/example/\`.

If a custom skill turns out to generalize (e.g. another project would want the same lens), promote it to a managed skill via a contribution to the cclaw repo — managed skills get versioning and maintenance.

## Progressive Disclosure (Depth / See Also)

Use this loading order to keep context lean while preserving depth:

1. Start with the active stage skill in \`.cclaw/skills/<stage>/SKILL.md\`.
2. Load exactly one contextual utility skill only if its trigger appears.
3. Open command contract (\`.cclaw/commands/<stage>.md\`) only for gate/handoff wording.
4. Expand to adjacent stage skills only when transition ambiguity exists.

### Depth triggers
- **Flaky/failing tests:** \`.cclaw/skills/debugging/SKILL.md\`
- **Security-sensitive change:** \`.cclaw/skills/security/SKILL.md\`
- **Performance risk:** \`.cclaw/skills/performance/SKILL.md\`
- **Release/deploy concerns:** \`.cclaw/skills/ci-cd/SKILL.md\`
- **Public API/docs impact:** \`.cclaw/skills/docs/SKILL.md\`
- **Specialist delegation needed:** \`.cclaw/skills/subagent-dev/SKILL.md\` and \`.cclaw/skills/parallel-dispatch/SKILL.md\`

### See also
- \`.cclaw/skills/session/SKILL.md\` for session start/stop/resume behavior
- \`.cclaw/skills/learnings/SKILL.md\` for durable knowledge capture and reuse
## Decision Protocol

When a stage requires user input (approval, choice, direction), use this structured pattern:

1. **State the decision** in one sentence.
2. **Present options** as labeled choices (A, B, C...) with:
   - One-line description of each option
   - Trade-off or consequence
   - **\`Completeness: X/10\`** — how thoroughly does this option cover the dimensions the stage cares about (failure modes, data flow, blast radius, observability, rollback, etc. — pick the dimensions that matter for *this* decision and subtract for each gap). Force a numeric score; vague text scores ≤ 5.
   - Mark one as **(recommended)** with brief why
3. **Pick the highest-scoring option as the recommendation.** If scores tie, prefer the option with the smallest blast radius (review/ship), the lowest risk (design/spec), or the most reversible outcome (ship finalization).
4. **Use the harness ask-user tool** when available:
   - Claude Code: \`AskUserQuestion\` tool
   - Cursor: \`AskQuestion\` tool with options array
   - Codex/OpenCode: numbered list in message (no native ask tool)
5. **Wait for response.** Do not proceed until the user picks.
6. **Commit to the choice.** Once decided, do not re-argue.

### Completeness scoring rubric (apply per option)

| Score | Meaning |
|---|---|
| 9-10 | Closes the decision with no carry-over risk; covers every dimension stage cares about. |
| 7-8 | Closes the decision with a small named follow-up; one dimension partially covered. |
| 5-6 | Plausible but leaves at least one dimension visibly open; needs follow-up before next stage. |
| 3-4 | Workaround, not a solution; defers the real problem. |
| 0-2 | Wishful thinking; do not recommend. |

Always show the score next to the option label, e.g. \`(B) [Completeness: 8/10]\`.

### When to use structured asks vs conversational
- **Structured (tool):** Architecture choices, scope decisions, approval gates, mode selection, scope boundary issues
- **Conversational:** Clarifying questions, yes/no confirmations, "anything else?"

## Failure Modes

Watch for these anti-patterns:
- **Skipping stages** — jumping from brainstorm to tdd without design/spec/plan
- **Ignoring gates** — claiming completion without evidence
- **Premature implementation** — writing code before RED tests exist
- **Hollow reviews** — "looks good" without checking spec compliance
- **Cargo-cult artifacts** — filling templates without real thought

## Knowledge Integration

At session start and stage transitions, check \`.cclaw/knowledge.md\` for project-specific knowledge:
- Review recent entries and apply relevant rules/patterns to the current task
- If you discover a non-obvious reusable rule or pattern, append a new entry with type \`rule\`, \`pattern\`, or \`lesson\`

Knowledge capture is append-only and should preserve historical context rather than rewriting prior entries.
`;
}
