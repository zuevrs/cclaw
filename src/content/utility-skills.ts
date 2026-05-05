/**
 * Opt-in language rule packs for stage hooks and the meta-skill router.
 * These are generated under `.cclaw/rules/lang`, not as default skills.
 */

export function languageTypescriptSkill(): string {
  return `---
name: language-typescript
description: "TypeScript rule pack. Compact opt-in lens for tdd/review when diffs touch TS/JS files."
---

# TypeScript Rule Pack

Use this only when a diff includes \`.ts\`, \`.tsx\`, \`.mts\`, \`.cts\`, or \`.js\`.

## Blocking rules

1. **No silent \`any\` or blanket \`@ts-ignore\`.** Unknown input starts as \`unknown\` and gets narrowed.
2. **Validate trust boundaries at runtime.** HTTP/env/file/IPC payloads require schema parse before typed use.
3. **No floating promises.** Await promises or explicitly document fire-and-forget behavior.
4. **Exhaustive union handling.** Discriminated-union switches must fail loudly on missing branches.

## Follow-up rules

- Prefer immutable/readonly data by default.
- Keep types local and explicit at module boundaries.
- Add/adjust tests when changing inferred public behavior.

## Output format

\`file:line — rule id — concise remediation\`
`;
}

export function languagePythonSkill(): string {
  return `---
name: language-python
description: "Python rule pack. Compact opt-in lens for tdd/review when diffs touch Python files."
---

# Python Rule Pack

Use this only when a diff includes \`.py\` / \`.pyi\`.

## Blocking rules

1. **No broad silent catches.** Avoid bare \`except\` / \`except Exception\` unless re-raised or justified.
2. **No mutable defaults.** Use \`None\` + local initialization.
3. **Type exported surfaces.** Public functions/classes include clear type hints.
4. **Resource safety by default.** File/DB/network handles use context managers.

## Follow-up rules

- Prefer explicit, narrow exceptions.
- Keep async and sync I/O models separated.
- Add/adjust tests with behavior changes.

## Output format

\`file:line — rule id — concise remediation\`
`;
}

export function languageGoSkill(): string {
  return `---
name: language-go
description: "Go rule pack. Opt-in language lens. Use when reviewing or writing Go diffs during tdd or review — enforces error handling discipline, concurrency safety, and idiomatic patterns."
---

# Go Rule Pack

## Quick Start

> 1. Activate during tdd or review whenever the diff touches \`.go\` files.
> 2. Walk the rule tiers in order. Tier-1 violations block merge. Tier-2 need a named follow-up.
> 3. Cite each finding as \`file:line — <rule id> — <one-line remediation>\`.

## HARD-GATE

Do not approve a Go change that discards an \`error\` return value with \`_ = ...\`
in production code *without* a comment explaining why the error is provably
irrelevant. Discarded errors are Go's #1 source of silent data loss.

## Tier 1 — blocking rules

1. **Every \`error\` is checked or explicitly wrapped with \`fmt.Errorf("%w", err)\`.**
2. **No goroutine leaks.** Every \`go func()\` must have a stop condition visible in
   the diff: a \`context.Context\` cancellation, a \`done\` channel, or a bounded
   input channel that will close.
3. **Context propagation.** Any function that does I/O, RPC, or long work must take
   \`ctx context.Context\` as the first parameter.
4. **No mutex by value.** Fields of type \`sync.Mutex\` / \`sync.RWMutex\` must be
   pointers *or* the containing struct must be used only via pointer receivers.
5. **Defer placement.** \`defer file.Close()\` must immediately follow a successful
   open, before any code path that can return early.
6. **\`for range\` capture hygiene** (pre-Go 1.22): copy loop variables before
   capturing in goroutines or deferred functions. From Go 1.22+ the language fixes
   this, but confirm the repo's \`go\` directive in \`go.mod\`.

## Tier 2 — follow-up rules

7. Prefer small interfaces defined at the consumer site, not upstream.
8. Prefer \`errors.Is\` / \`errors.As\` over string matching.
9. Avoid \`init()\` except for registering with a framework.
10. Use \`t.Helper()\` inside test helpers so failure lines point at the caller.
11. Use \`//go:build\` tags for OS-specific code, not runtime \`runtime.GOOS\` checks.

## Concurrency-specific

- Buffered channels are a performance hint, not a correctness fix. Unbuffered first.
- \`sync.WaitGroup\` \`Add\` must happen **before** \`go\`, not inside the goroutine.
- \`atomic\` operations must be paired on the same variable — do not mix \`atomic.Load\`
  with plain reads of the same field.
- Shared maps require a mutex or \`sync.Map\`; Go's race detector in CI is non-negotiable.

## Anti-patterns

- Returning \`interface{}\` / \`any\` to "keep options open" — narrow it now.
- Building "smart" error types that lose the wrapped chain.
- Using \`panic\` for control flow in library code (allowed only for unrecoverable invariants).
- Ignoring \`go vet\` warnings because "the code works".

## Review output shape

\`\`\`
- **Rule:** G1-2 (no goroutine leaks)
- **File:line:** internal/worker/pool.go:57
- **Finding:** \`go w.loop()\` has no stop condition; context is not threaded through.
- **Remediation:** Accept \`ctx\` in \`Start\` and select on \`ctx.Done()\` inside \`loop\`.
\`\`\`
`;
}

/**
 * Language rule packs live under `.cclaw/rules/lang/<pack>.md`. They are NOT
 * skills (no folder, no `SKILL.md`) — they are opt-in **rule files** that the
 * meta-skill router and stage hooks consult when the corresponding language
 * appears in a diff. The pack id doubles as the on-disk filename stem.
 */
export const LANGUAGE_RULE_PACK_FILES = {
  typescript: "typescript.md",
  python: "python.md",
  go: "go.md"
} as const;

/**
 * Folder (relative to runtime root) that holds every enabled language rule
 * pack. A single folder keeps discovery trivial for hooks and for `sync`.
 */
export const LANGUAGE_RULE_PACK_DIR = ["rules", "lang"] as const;

export const LANGUAGE_RULE_PACK_GENERATORS: Record<string, () => string> = {
  typescript: languageTypescriptSkill,
  python: languagePythonSkill,
  go: languageGoSkill
};

/**
 * Older per-language folders under `.cclaw/skills/`. Listed
 * here so `cclaw sync` and `sync` can surface drift and the installer can
 * clean them up after the move to `.cclaw/rules/lang/`.
 */
export const LEGACY_LANGUAGE_RULE_PACK_FOLDERS = [
  "language-typescript",
  "language-python",
  "language-go"
] as const;
