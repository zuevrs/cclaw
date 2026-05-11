---
name: commit-message-quality
trigger: before every commit-helper.mjs invocation
---

# Skill: commit-message-quality

`commit-helper.mjs` accepts any non-empty message, but the AC traceability chain only stays useful if the messages stay readable.

## Rules

1. **Imperative voice** — "Add StatusPill component", not "Added" or "Adding".
2. **Subject ≤72 characters** — long subjects truncate in `git log --oneline` and CI signals.
3. **Subject does not repeat the AC id** — the hook already appends `refs: AC-N`.
4. **Body when needed** — second-line blank, then a short rationale paragraph and any non-obvious context. Use `--message` for the subject; if the message must be multi-line, write it to a file and pass `--file`.
5. **Cite finding ids in fix commits** — `fix: F-2 separate rejected token`.

## Anti-patterns

- "WIP", "fixes", "stuff", "more". The reviewer rejects these as F-1 `block`.
- Subject lines that paraphrase the diff. Diff is the diff; the message is the why.
- Co-author trailers in solo commits.

## When to amend

Never amend a commit produced by `commit-helper.mjs` after the SHA is recorded in `flow-state.json`. Amend changes the SHA and breaks the AC chain. If the message is wrong, write a short note in `flows/<slug>/build.md` and move on; it is recoverable in review.
