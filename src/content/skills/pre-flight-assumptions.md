---
name: pre-flight-assumptions
trigger: after triage-gate, before the first specialist dispatch — only when triage.path is NOT inline
---

# Skill: pre-flight-assumptions

Triage answers "**how much** work is this?" and "**how should we run it?**". Pre-flight answers "**on what assumptions** are we doing it?". They are different questions; this hop exists because silently-defaulted assumptions are the most common reason a small/medium build ships the wrong feature.

The pre-flight skill runs **once** per flow, between the triage gate (Hop 2) and the first specialist dispatch (Hop 3). It does not run on the inline / trivial path — a single-file edit has no architectural assumptions worth surfacing.

## What the orchestrator does

1. Read `triage.path` from `flow-state.json`.
2. If `path == ["build"]` (inline), skip this skill entirely. Go to dispatch.
3. **Ambiguity check.** Before composing assumptions, decide whether the user's request has more than one defensible reading. If yes, run the **interpretation-forks** sub-step (below) FIRST, persist the chosen fork to `triage.interpretationForks`, then continue with assumptions composition keyed off the chosen fork. If no, write `triage.interpretationForks: null` and proceed.
4. Otherwise (after step 3 resolves):
   1. Inspect the repo for stack inference. Read at most:
      - `package.json` / `pnpm-lock.yaml` (Node, framework + version, test runner);
      - `pyproject.toml` / `requirements.txt` (Python, framework + version);
      - `go.mod` (Go);
      - `Cargo.toml` (Rust);
      - `composer.json` (PHP);
      - `Gemfile` (Ruby);
      - the top-level README or AGENTS.md if it exists.
   2. Inspect the most recent shipped slug under `.cclaw/flows/shipped/` (if any) — its `assumptions:` block is your seed for what defaults the project already established.
   3. Compose 3–7 short, numbered assumptions covering:
      - **Stack** — language version, framework, runtime target, test runner.
      - **Conventions** — where tests live (`tests/`, `__tests__/`, alongside source), filename pattern (`*.test.ts`, `*.spec.ts`, `*_test.go`).
      - **Architecture defaults** that apply to this slug — CSS strategy, state strategy, auth strategy, persistence pattern. Skip items that are not relevant.
      - **Out-of-scope defaults** — what we will NOT do unless asked (mobile breakpoints, i18n, telemetry hooks).
   4. Surface them through the harness's structured ask tool. If the harness has none, fall back to a fenced block; same rule as the triage gate.
   5. Persist the user's confirmed list to `flow-state.json`'s `triage.assumptions`.

## Output shape — STRUCTURED ask

Render the numbered list as the question prompt, plus four options:

- prompt:

  Pre-flight — I'm about to run with these assumptions:

  1. Node 20.11; Next.js 14.1; React 19.0; Tailwind 3.4 (read from package.json).
  2. Tests live in `tests/` mirroring the production module path (`*.test.tsx`).
  3. CSS strategy: Tailwind utility classes + 1 `tokens.css` for color/space tokens (matches existing components).
  4. Auth strategy: session-based cookies via `next-auth` (current pattern).
  5. Out-of-scope: mobile breakpoints, i18n strings, telemetry events.

  Correct me now or I proceed with these.

- options:
  - <option label conveying: proceed with these assumptions as-is>
  - <option label conveying: edit one assumption>
  - <option label conveying: edit several assumptions>

The option slots are intent descriptors. Render every label and the prompt body in the user's conversation language. `Cancel` is not an option — if the user wants to abort before any specialist runs, they invoke `/cc-cancel` themselves; the orchestrator surfaces that command in plain prose only when the user looks stuck.

If the user picks "edit one" or "edit several" (whatever the user-language label was), follow up with a free-text ask for the corrected list. Re-confirm once with the structured tool, then persist.

If the user dismisses the question (timeout, harness limitation), default to "proceed with these" — the user has at least seen them once, and the next message can amend if needed.

## Output shape — FALLBACK (no structured ask)

```
Pre-flight assumptions
1. Node 20.11; Next.js 14.1; React 19.0; Tailwind 3.4 (from package.json).
2. Tests live in tests/ mirroring production module path.
3. CSS: Tailwind + tokens.css.
4. Auth: session cookies via next-auth.
5. Out of scope: mobile, i18n, telemetry.

Correct me now or I proceed.
[1] Proceed
[2] Edit one assumption — say which number and the replacement
[3] Edit several — paste the corrected list
```

To abort before any specialist runs, the user invokes `/cc-cancel` (a separate command). The fenced fallback never includes a Cancel row.

## Persistence shape

After the user accepts (with or without edits), patch `flow-state.json`:

```json
{
  "triage": {
    "complexity": "small-medium",
    "acMode": "soft",
    "path": ["plan", "build", "review", "ship"],
    "rationale": "...",
    "decidedAt": "...",
    "userOverrode": false,
    "runMode": "step",
    "assumptions": [
      "Node 20.11, Next.js 14.1, React 19.0, Tailwind 3.4",
      "Tests in tests/ mirroring module path",
      "CSS: Tailwind + tokens.css",
      "Auth: session cookies via next-auth",
      "Out of scope: mobile, i18n, telemetry"
    ]
  }
}
```

The list is **immutable** for the lifetime of the flow. If during build a sub-agent finds an assumption was wrong, it stops and surfaces — the orchestrator either runs `/cc-cancel` and starts fresh, or accepts the violation as an explicit user decision and records it in the build log.

## How sub-agents read assumptions

Every dispatch envelope from Hop 3 onward includes a one-line note:

```
Pre-flight assumptions: see triage.assumptions in flow-state.json
```

Sub-agents (planner, slice-builder, reviewer, etc.) read `flow-state.json > triage.assumptions` before authoring their artifact. The list is appended verbatim (under `## Assumptions`) to:

- `flows/<slug>/plan.md` — copy the list once after the Frame, so the plan stays self-contained for review.
- `flows/<slug>/plan.md` (`## Decisions` section) — design's Phase 4 D-N records cite triage assumptions in their Refs line. Legacy `decisions.md` files in shipped/<slug>/ from pre-v8.14 are read-only references.

A sub-agent that would need to break an assumption raises it as a finding (in slice-builder: stop and surface; in reviewer: `block`-severity finding) instead of silently overriding.

## Interpretation forks

Triage answers "how big is this work?". Pre-flight assumptions answer "on what stack defaults?". **Interpretation forks** answer the more-fundamental question: **"are we even building the same thing the user meant?"**

When the user's prompt has more than one defensible reading, you must surface 2–4 distinct interpretations **with tradeoffs and effort estimates** and let the user pick BEFORE you write assumptions. This is the most direct attack on silent misinterpretation, which is the #1 reason flows ship the wrong feature.

### When to surface forks

Run the fork sub-step when ANY of these signals fire:

- The verb is vague ("улучшить", "ускорить", "почистить", "улучшить UX", "make X better/faster/cleaner").
- The object is plural or unbounded ("compose", "the UI", "auth", "the build pipeline").
- Two distinct user-visible outcomes would each satisfy the literal request (e.g. "make search faster" can mean: latency tuning of existing search, swap to a faster backend, denormalise indexed fields, add caching).
- The user named a goal but not a measurement ("optimise", "harden", "refactor for clarity") and the right action depends on which axis they care about.

Do NOT run forks when the prompt names a concrete file/AC/behaviour ("rename `getCwd` to `getCurrentWorkingDirectory` across the project", "add a `lastLoginAt` column on `users`"). Those are unambiguous; jump straight to assumptions.

### How to compose forks

Compose 2–4 numbered interpretations. Each entry has THREE parts on three lines:

1. **What it does** — one short sentence in user terms (no jargon).
2. **Tradeoff** — one short sentence naming the cost or risk side of this reading vs. the others.
3. **Effort** — `small` (≤ 1 day, single module), `medium` (1-3 days, 2-4 modules), `large` (> 3 days, architectural seam).

Forks must be **mutually exclusive** (picking one rules the others out for this slug, even if a future slug picks a different one) and **collectively defensible** (each is a plausible reading of the prompt; no straw-man options).

### Output shape — STRUCTURED ask

Render the forks as the question prompt:

```
The request is ambiguous — pick the reading I should run with:

1. **Tune the existing query path.** Add an index on `messages.thread_id`, narrow the SELECT, batch-fetch attachments.
   Tradeoff: bounded gains (~30-60% faster); no architectural shift.
   Effort: small.

2. **Swap to a denormalised search index.** Project `messages` into a search-tuned table (Tantivy / Postgres FTS) refreshed on write.
   Tradeoff: 5-10× faster reads; new write-path complexity, sync risk.
   Effort: medium.

3. **Add an in-memory cache for hot threads.** LRU keyed by `(user_id, thread_id)`, invalidated on write.
   Tradeoff: latency wins on revisits, no help on cold reads; cache-coherency work.
   Effort: small.

<closing line in the user's language: "Pick one. If none fit, reply with the axis that actually matters and I will re-fork.">
```

Options:
- <option label conveying: pick reading 1 (the first numbered interpretation)>
- <option label conveying: pick reading 2 (the second numbered interpretation)>
- <option label conveying: pick reading 3 (the third numbered interpretation, only if it exists)>

Render the prompt body and every option label in the user's conversation language. `Cancel` is **not** offered — if the user wants to abort the flow, they invoke `/cc-cancel` themselves; if no reading fits, the user replies in free text and you re-compose the forks.

If the user dismisses every reading (replies with "none of these" or equivalent in the user's language), do NOT silently pick the first option. Surface a follow-up free-text ask in the user's language naming the axes that drive the choice (e.g. for the search example: latency vs throughput vs write-amplification vs read-locality). Re-compose the forks once the user names the axis.

### Persistence

Persist the chosen reading verbatim into `flow-state.json`'s `triage.interpretationForks`:

```json
{
  "triage": {
    "interpretationForks": [
      "Tune the existing query path. Add an index on messages.thread_id, narrow the SELECT, batch-fetch attachments."
    ]
  }
}
```

The array contains the **chosen** reading only (verbatim, not a paraphrase). The rejected readings are NOT persisted — they were the interpretation menu, not state. The chosen reading then becomes the framing input for the assumptions composition AND for every dispatch envelope from Hop 3 onward (alongside the assumptions).

### When the prompt was unambiguous

Write `triage.interpretationForks: null` and skip straight to assumptions. The orchestrator's later finding-of-record is "no interpretation fork was needed; the prompt named a concrete behaviour".

### Hard rules

- **Forks before assumptions, not after.** Assumptions are keyed off the chosen reading. Composing assumptions before the fork is resolved produces assumptions for the wrong reading.
- **Never silently pick.** If you cannot decide between readings, the user picks. The orchestrator never authors the chosen-fork sentence on the user's behalf.
- **Effort estimates are honest, not anchoring.** A "small" fork that is actually large costs the user trust. Tag `small` only for single-module, ≤ 1 day work.
- **Forks are not a brainstorming session.** 2–4 readings, max. If you have 7 ideas, the prompt is not just ambiguous — it is underspecified, and you should ask the user to narrow it before forking.

## Sizing rules

- **3–7 assumptions, no more.** A long list is noise; the user stops reading after item 5.
- **One sentence per assumption, no half-paragraphs.** Pick the most relevant version / pattern / boundary.
- **Cite where you got each one** when non-obvious — `(from package.json)`, `(from latest shipped slug 'auth-cleanup')`, `(my default — confirm)`. The citation tells the user what is observed vs. defaulted.
- **Never invent specifics you have not read.** If you cannot cite a concrete version from a real file, say so: "(default; the project did not pin a Tailwind version)".

## What the pre-flight is NOT

- It is not a planning step. It does not write AC or design.
- It is not design's Frame (Phase 2). The Frame answers "what are we building?"; pre-flight answers "on what stack and conventions?".
- It is not a security review. Sensitive surfaces still get `security-reviewer` later in the flow.
- It is not optional in soft / strict modes. The whole point is to surface defaults; skipping it defeats the skill.

## Worked example — Russian conversation

User: "Сделай страницу настроек профиля."

Pre-flight prompt (structured ask):

```
Pre-flight — допущения, с которыми буду работать:

1. Next.js 14.1, React 19.0, TypeScript 5.4 (из package.json).
2. Тесты в tests/ рядом с компонентом, файлы *.test.tsx (как в существующих компонентах).
3. CSS: Tailwind + общий tokens.css (как в components/ui/).
4. Тёмная тема через CSS variables, не next-themes (текущая стратегия).
5. Сохранение в БД через существующий route /api/profile (Prisma + Postgres). localStorage не используем.
6. Server component для каркаса страницы, client component только для формы.

Поправь сейчас или продолжаю с этим.
```

Options follow the same intent shape as in the structured-ask schema above (proceed / edit one / edit several), rendered in the user's conversation language. There is no Cancel option — `/cc-cancel` is a separate explicit command that the user types if they want to abort.

Note: in this Russian example the prompt body, the numbered assumptions, and the (omitted) option labels would all be in Russian to match the user. `tokens.css`, `tests/`, `*.test.tsx`, `/api/profile`, `Prisma`, `Tailwind`, `/cc-cancel` stay in their original form regardless of conversation language — they are mechanical tokens (see `conversation-language.md`).

## Common pitfalls

- **Listing 12+ assumptions.** That is a checklist, not an assumptions block. Keep it 3–7.
- **Mixing assumptions with the plan.** The plan goes into `plan.md`. The assumptions are pre-plan context.
- **Skipping pre-flight on `small-medium` because "the user knows the stack".** The user *does* know; pre-flight makes sure the orchestrator knows the same things.
- **Re-running pre-flight on resume.** It runs once per flow. Resume reads the saved `assumptions` from `flow-state.json` and proceeds.
- **Defaulting an assumption from training data instead of the repo.** If you cannot cite a file or shipped slug, mark the assumption with "(my default — confirm)" so the user knows it is a guess.
- **Pre-flight on the inline path.** Skip. Trivial change, no assumptions to surface.
