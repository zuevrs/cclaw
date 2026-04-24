/**
 * Session guidelines content for Cclaw.
 * Describes recommended behavior at session boundaries.
 * Pure markdown generation — no runtime logic.
 */

export function sessionHooksSkillMarkdown(): string {
  return `---
name: session
description: "Session boundary guidelines: what to do when a session starts, ends, or reaches a stop condition."
---

# Session Guidelines

## Overview

This skill defines recommended behavior at **session boundaries** — start, stop, and resume. These guidelines help agents maintain continuity, avoid losing context, and enforce quality gates at natural breakpoints.

These are prompt-discipline guidelines that complement the real hooks cclaw generates. The hooks handle automatic context injection at session start/stop; these guidelines cover manual steps the agent should follow.

## HARD-GATE

**Never end a session with uncommitted or untested changes.** If you must stop, leave a short handoff in the current artifact or commit message.

## Session Start Protocol

When a new session begins in any harness:

1. **Read flow state:** Load \`.cclaw/state/flow-state.json\` to find the current stage and completed stages.
2. **Load knowledge:** Stream the tail of \`.cclaw/knowledge.jsonl\` (strict JSONL store) and surface the most relevant rules/patterns.
3. **Check for in-progress work:** If the last stage is incomplete, remind the user and offer to resume.
4. **Load iron laws:** Read \`.cclaw/state/iron-laws.json\` to know which laws are strict in this repo.
5. **Read AGENTS.md:** The cclaw block contains routing and rules — follow them.

### What to show the user at session start

\`\`\`
Cclaw flow state: [current stage] ([N] of 8 stages completed)
Knowledge highlights: [rule/pattern 1], [rule/pattern 2], [rule/pattern 3]
Next action: /cc-[stage] to continue, or describe what you'd like to do.
\`\`\`

## Session Stop Protocol

Before ending a session or when context is full:

1. **Verify no pending changes:** All modified files must be either committed or explicitly reverted.
2. **Update flow state:** Mark the current stage as its actual status (DONE / DONE_WITH_CONCERNS / BLOCKED).
3. **Write knowledge:** If any non-obvious reusable insight appears, append one strict-schema JSON line to \`.cclaw/knowledge.jsonl\` with type \`rule\`, \`pattern\`, \`lesson\`, or \`compound\`.
4. **Leave handoff context:** Put blockers and remaining work in the current stage artifact, not a separate state file.

### Stop conditions (agent must halt and report)

- Repeated verification failure (3+ attempts at the same check)
- Unclear requirements that block progress
- Security concern discovered that needs human review
- Context window approaching limit — compact or hand off

## Session Resume Protocol

When resuming work after a break:

1. Re-read \`.cclaw/state/flow-state.json\` (may have changed externally).
2. Re-read the current stage's artifact to verify it matches the last handoff.
3. Re-load recent knowledge entries.
4. Continue from the last incomplete step — do not restart the stage.

## Context Management

When approaching context limits:

1. **Prefer subagents** for deep investigation (results return as summary, not full context).
2. **Compact strategically** — at logical breakpoints (after a stage completes), not mid-task.
3. **Never compact during:** active debugging, mid-refactor, or while holding uncommitted changes.
4. **After compaction:** re-read flow state and current artifact before continuing.

## Common Rationalizations

| Rationalization | Reality |
|---|---|
| "I'll remember where I was" | Context is lost between sessions. Write it down. |
| "This is almost done, no need for handoff" | "Almost done" is the most dangerous state — changes are half-applied. |
| "The tests will tell me the state" | Tests tell you pass/fail, not intent or remaining work. |

## Red Flags

- Ending a session with modified but uncommitted files
- No flow state update after completing work
- Restarting a stage from scratch instead of resuming from artifact context
- Ignoring knowledge from prior sessions
`;
}

export function sessionHooksAgentsMdBlock(): string {
  return `### Session Guidelines

Session boundary behavior (real hooks inject context automatically; guidelines cover manual steps):
- **Start:** Hooks inject flow state + knowledge snapshot. Check for in-progress work, show status.
- **Stop:** Hooks remind about handoff. Verify no pending changes, update flow state, append useful knowledge.
- **Resume:** Re-read state, verify artifact, re-load knowledge, continue from last step.

Skill: \`.cclaw/skills/session/SKILL.md\`
Policy: \`.cclaw/skills/iron-laws/SKILL.md\`
`;
}
