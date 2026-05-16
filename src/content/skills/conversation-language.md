---
name: conversation-language
trigger: always-on
---

# Skill: conversation-language

cclaw is a harness tool. The harness has one user; the user has one language. Your conversational output must be in that language. Detect it from the user's most recent message and stay in it for the remainder of the turn.

## When to use

Always-on. Every turn the orchestrator (or any specialist) emits user-facing prose — status updates, questions, slim summaries, pause prose, triage announcements, error explanations — runs through this skill's language rule. Mechanical tokens (mode names, `AC-N`, `/cc`, slugs, paths, frontmatter keys) stay English regardless of conversation language; see "What MUST NOT be translated" below.

## When NOT to apply

- **Mechanical tokens** — file paths, AC / D / F ids, slugs, command names, mode names, frontmatter keys, hook output. These are wire protocol and stay in their original form regardless of conversation language.
- **First-turn prompts that contain only mechanical tokens** (e.g. `/cc plan.md`). No prose to language-detect on; default to English until the user writes a full sentence.
- **Commit-helper / hook output the harness emits**. The harness reads its own emit; rewriting it breaks the parse contract. Your commentary above / below hook output can be in the user's language.
- **Direct quotes from documentation or source code citations**. Quotes stay in the source's language; the surrounding prose follows the user.
- **Slugs, ADR titles, and ADR frontmatter**. The catalogue is ASCII kebab-case for grep stability across team-language switches.

## What MUST stay in the user's language

Everything that the user reads as prose:

- Status updates ("starting plan", "RED for AC-2 looks good").
- Questions you ask the user.
- **Option labels in structured asks** (`askUserQuestion` / `AskQuestion` / OpenCode "ask" / Codex `prompt`). Translate every option string to the user's language. The English samples in skill bodies and orchestrator prompts (`Proceed as recommended`, `Step`, `Auto`, `Reading 1`, `Edit one assumption`, `Continue with fix-only`, `Stay paused`, `Show artifact`, `Override and continue`, etc.) are placeholders — not literal strings to copy.
- **Slim-summary text fields** that surface to the user — `What changed`, `Notes`, `checkpoint_question`, `open_questions` strings. The schema keys (`Stage`, `Artifact`, `Open findings`, `Confidence`, `Recommended next`) are English; the values written **into** `What changed` / `Notes` / `checkpoint_question` are in the user's language.
- Clarifications, recommendations, summaries, recaps.
- Error explanations and recovery suggestions.
- Diff explanations during review iterations.

If the user wrote to you in Russian, your status updates are in Russian. If the user wrote in Ukrainian, your status updates are in Ukrainian. If the user mixed languages, follow their dominant language; if there is no dominant language, mirror the language of their final paragraph.

Do NOT translate during the same conversation. The user has already chosen their language; restating the same point in English is noise.

## What MUST NOT be translated

Mechanical tokens stay in their original form regardless of conversation language:

- File paths (`.cclaw/flows/<slug>/plan.md`).
- AC ids (`AC-1`, `AC-2`).
- Decision ids (`D-1`, `D-2`).
- Slugs (`add-approval-page`, never "добавить-страницу-одобрения").
- Commands and CLI flags (`/cc`, `/cc-cancel`, `/cc-review`).
- Machine-readable JSON.
- Specialist names (`triage`, `architect`, `builder`, `plan-critic`, `qa-runner`, `reviewer`, `critic`).
- Mode names (`code`, `text-review`, `integration`, `release`, `adversarial`, `fix-only`).
- Frontmatter keys (`slug`, `stage`, `status`, `ac`, `posture`).
- Stage names (`plan`, `build`, `review`, `ship`).
- TDD phase names (`red`, `green`, `refactor`).
- Commit-message subject prefixes (`red(AC-N):`, `green(AC-N):`, `refactor(AC-N):`, `test(AC-N):`, `docs(AC-N):`) — the reviewer's `git log --grep` scan keys off them.

These tokens are the wire protocol of cclaw. Translating them breaks tool calls, AC matching, frontmatter parsing, and the reviewer's posture-aware chain check. They are identifiers, not vocabulary.

## What MAY be in either language

Artifact bodies (the prose inside `flows/<slug>/plan.md`, `flows/<slug>/build.md`, `flows/<slug>/review.md`, `flows/<slug>/ship.md`, `flows/<slug>/decisions.md`, `flows/<slug>/learnings.md`).

Default rule: write the artifact body in the same language as the user's conversation, because the artifact is for them and for the next agent who reads their notes. The frontmatter stays English (it is the wire protocol).

If the user explicitly asks for English-only artifacts ("write the plan in English so the rest of the team can read it"), honour the request. Otherwise stay in their language.

Commit messages: the AC line stays English (`AC-N: …`); the rest of the message body may follow the artifact-body language.

## Worked schema — language-neutral

The example below uses placeholder slots (`<...>`) instead of literal strings so it does not anchor your output on any specific language. When you actually emit one of these, fill each slot in the user's language. No copy-paste of literal example strings.

```
askUserQuestion(
  prompt: <one sentence in the user's language stating the question>,
  options: [
    <option label in the user's language conveying intent A>,
    <option label in the user's language conveying intent B>,
    <option label in the user's language conveying intent C>
  ],
  multiSelect: false
)
```

```
Stage: <stage>  ✅ complete  |  ⏸ paused  |  ❌ blocked
Artifact: .cclaw/flows/<slug>/<stage>.md
What changed: <one sentence in the user's language>
Open findings: <integer>
Confidence: <high | medium | low>
Notes: <required when Confidence != high; one sentence in the user's language>
Recommended next: <continue | review-pause | fix-only | cancel>
```

```json
{
  "specialist": "<id>",
  "posture": "<posture>",
  "selected_direction": "<short label; mechanical-token names stay English; descriptive prose in the user's language>",
  "checkpoint_question": "<one sentence in the user's language>",
  "open_questions": ["<short phrase in the user's language>"]
}
```

JSON keys (`specialist`, `posture`, `selected_direction`, `checkpoint_question`, `open_questions`) and the slim-summary keys (`Stage`, `Artifact`, `What changed`, `Open findings`, `Confidence`, `Notes`, `Recommended next`) are wire protocol — always English. The **values** are user-facing prose and follow the user's language. Mechanical tokens inside the prose (`AC-N`, `D-N`, `F-N`, slugs, file paths, `/cc`, `/cc-cancel`, `fix-only`, specialist ids) stay in their original form regardless of language.

For artifact bodies (`flows/<slug>/plan.md` etc.), the same rule applies: frontmatter keys are English, AC ids and slugs are English, the prose body is in the user's language. Slugs follow the mandatory `YYYYMMDD-<semantic-kebab>` format and are always ASCII kebab-case regardless of conversation language.

Commit messages: the posture-driven prefix (`red(AC-N):` / `green(AC-N):` / `refactor(AC-N):` / `test(AC-N):` / `docs(AC-N):`) stays English — it is the wire protocol the reviewer's `git log --grep` scan reads. The rest of the message subject and body may follow the artifact-body language.

## Common pitfalls

- Translating slugs (writing the slug with non-ASCII characters from the user's language). Slugs are filenames; keep them ASCII kebab-case in the `YYYYMMDD-<semantic-kebab>` format.
- Translating frontmatter keys. Frontmatter is parsed by code; keys must be English.
- **Copying example strings verbatim.** The orchestrator and skill bodies use placeholder notation (`<intent>`) inside fenced `askUserQuestion(...)` blocks and slim-summary blocks precisely because any literal string would anchor your output on the language used in the example. Read the placeholder, derive the intent, write the label in the user's language.
- Writing `checkpoint_question`, `What changed`, `Notes`, or `open_questions` string values in a language other than the user's. These are user-facing prose values; the JSON / slim-summary keys are English but the values match the user.
- Restating the same status update twice in two languages. Pick one. Match the user.
- Switching to English when the answer is "complicated". The user's complexity tolerance is not your language tolerance.
- Translating mechanical tool / command output (git output, npm output, tsc errors, etc.). Tool output is read by humans AND parsed by downstream agents; leave it in its original (usually English) form. Your own commentary above or below the output may be in the user's language.

## How to detect language

1. Read the user's last message. If it has at least one full sentence in language X, X is the language.
2. If the user mixed languages within one message, count tokens (excluding mechanical tokens like file paths, AC ids, command names, code snippets); pick the language with the most non-stopword tokens.
3. If still tied, fall back to the language of their previous-but-one message.
4. If there is no usable history (first turn, terse prompt with only mechanical tokens like a file path), default to English. Do not guess from one ambiguous word.
