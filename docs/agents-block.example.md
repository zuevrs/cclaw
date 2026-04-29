# Example AGENTS.md Managed Block

This is a compact example of the routing block cclaw writes into `AGENTS.md`
during `npx cclaw-cli init` / `npx cclaw-cli sync`. The generated block in a real project is
authoritative; this file exists so readers can see what the harness will read.

## Instruction Priority

1. User message in the current turn.
2. Active stage skill and command contract.
3. The `using-cclaw` meta-skill.
4. Contextual utility skills.
5. Training priors.

## Commands

| Command | Purpose |
|---|---|
| `/cc` | Entry point. No args resumes current stage; with a prompt it classifies the task and starts the right flow. |
| `/cc-idea` | Idea mode. Produces a ranked repo-improvement backlog. |
| `/cc-view` | Read-only status/tree/diff visibility. |

Stage order is `brainstorm > scope > design > spec > plan > tdd > review > ship`,
then closeout is `retro > compound > archive`. `/cc` loads the right
stage skill automatically; gates and mandatory delegations must pass before
handoff.
