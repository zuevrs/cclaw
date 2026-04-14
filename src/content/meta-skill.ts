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

When a task arrives, identify the development phase and invoke the matching command:

\`\`\`
Task arrives
    |
    +-- Vague idea / needs exploration?  --> /cc-brainstorm
    +-- Need to shape scope / challenge premises?  --> /cc-scope
    +-- Have scope, need architecture / design lock?  --> /cc-design
    +-- Have design, need formal specification?  --> /cc-spec
    +-- Have spec, need task breakdown / plan?  --> /cc-plan
    +-- Have plan, need to write tests first?  --> /cc-test
    +-- Have failing tests, need implementation?  --> /cc-build
    +-- Have implementation, need review?  --> /cc-review
    +-- Reviewed and approved, need to ship?  --> /cc-ship
    |
    +-- Cross-cutting:
    |   +-- Want to check/add project learnings?  --> /cc-learn
    |   +-- Want full brainstorm-to-plan in one shot?  --> /cc-autoplan
    |
    +-- No cclaw stage applies?  --> Respond normally
\`\`\`

## Flow State Check

Before starting work, ALWAYS:

1. Read \`.cclaw/state/flow-state.json\` for the current stage.
2. If a stage is active, invoke the matching \`/cc-*\` command.
3. If no stage applies (e.g. simple question, unrelated task), respond normally.

## Activation Rules

1. **Check for an applicable stage before starting work.** Stages encode processes that prevent common mistakes.
2. **Stages are workflows, not suggestions.** Follow the skill steps in order. Do not skip verification steps.
3. **One stage at a time.** Complete the current stage before advancing to the next.
4. **Gates must pass.** Every stage has required gates — the agent cannot claim completion without satisfying them.
5. **Artifacts are mandatory.** Each stage writes to \`.cclaw/artifacts/\` and keeps the active run copy in \`.cclaw/runs/<activeRunId>/artifacts/\` — this is the evidence trail.
6. **When in doubt, start with brainstorm.** If the task is non-trivial and there's no prior artifact, begin with \`/cc-brainstorm\`.

## Stage Quick Reference

| Stage | Command | HARD-GATE | Artifact |
|-------|---------|-----------|----------|
| Brainstorm | \`/cc-brainstorm\` | No implementation planning | \`01-brainstorm.md\` |
| Scope | \`/cc-scope\` | Challenge premises first | \`02-scope.md\` |
| Design | \`/cc-design\` | Search before building | \`03-design.md\` |
| Spec | \`/cc-spec\` | Observable + testable criteria | \`04-spec.md\` |
| Plan | \`/cc-plan\` | One task = one purpose | \`05-plan.md\` |
| Test | \`/cc-test\` | RED tests fail first | \`06-tdd.md\` |
| Build | \`/cc-build\` | Minimal code to pass RED | \`06-tdd.md\` (shared with test) |
| Review | \`/cc-review\` | Two-layer review | \`07-review.md\` |
| Ship | \`/cc-ship\` | All tests green on merge | \`08-ship.md\` |

## Skill Loading

Each \`/cc-*\` command loads:
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

**Activation rule:** When a contextual skill applies, read its SKILL.md and follow it as a supplementary lens alongside the current stage. Do not skip the stage workflow — the contextual skill adds depth, not a detour.

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
- \`.cclaw/skills/learnings/SKILL.md\` for durable memory capture and reuse
- \`.cclaw/skills/autoplan/SKILL.md\` when user requests multi-stage orchestration

## Decision Protocol

When a stage requires user input (approval, choice, direction), use this structured pattern:

1. **State the decision** in one sentence.
2. **Present options** as labeled choices (A, B, C...) with:
   - One-line description of each option
   - Trade-off or consequence
   - Mark one as **(recommended)** with brief why
3. **Use the harness ask-user tool** when available:
   - Claude Code: \`AskUserQuestion\` tool
   - Cursor: \`AskQuestion\` tool with options array
   - Codex/OpenCode: numbered list in message (no native ask tool)
4. **Wait for response.** Do not proceed until the user picks.
5. **Commit to the choice.** Once decided, do not re-argue.

### When to use structured asks vs conversational
- **Structured (tool):** Architecture choices, scope decisions, approval gates, mode selection, scope boundary issues
- **Conversational:** Clarifying questions, yes/no confirmations, "anything else?"

## Failure Modes

Watch for these anti-patterns:
- **Skipping stages** — jumping from brainstorm to build without design/spec/plan
- **Ignoring gates** — claiming completion without evidence
- **Premature implementation** — writing code before RED tests exist
- **Hollow reviews** — "looks good" without checking spec compliance
- **Cargo-cult artifacts** — filling templates without real thought

## Learnings Integration

At session start, check \`.cclaw/learnings.jsonl\` for project-specific knowledge:
- Run \`tail -n 20 .cclaw/learnings.jsonl\` and surface the top 3 highest-confidence entries
- Apply relevant learnings to the current task
- After each stage, reflect: did anything happen that would save 5+ minutes next time? If so, log it.

## Observation Hooks

If tool observation is enabled, cclaw captures tool usage patterns (PreToolUse/PostToolUse) to \`.cclaw/observations.jsonl\`. At session stop, observations are analyzed and valuable patterns are promoted to learnings. This is automatic — you do not need to manage it.
`;
}
