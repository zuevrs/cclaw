/**
 * Opt-in language rule packs for stage hooks and the meta-skill router.
 * These are generated under `.cclaw/rules/lang`, not as default skills.
 */

export function languageTypescriptSkill(): string {
  return `---
name: language-typescript
description: "TypeScript rule pack. Opt-in language lens. Use when reviewing or writing TypeScript/JavaScript diffs during tdd or review — enforces type-safety, runtime-boundary validation, and idiomatic patterns."
---

# TypeScript Rule Pack

## Quick Start

> 1. Activate during tdd or review whenever the diff touches \`.ts\`, \`.tsx\`, \`.mts\`, \`.cts\`, or \`.js\` files.
> 2. Walk the rule tiers in order. Tier-1 violations block merge. Tier-2 need a named follow-up.
> 3. Cite each finding as \`file:line — <rule id> — <one-line remediation>\`.

## HARD-GATE

Do not approve a TypeScript change that ships \`any\`, \`@ts-ignore\`, or
\`@ts-expect-error\` *without* (a) a comment explaining why, (b) a linked issue,
and (c) an assertion that the blast radius is bounded to the current file.
No exceptions in production code paths.

## Tier 1 — blocking rules

1. **No silent \`any\`.** Unknown inputs must be typed as \`unknown\` first, then narrowed.
2. **Runtime validate trust boundaries.** HTTP bodies, env vars, file contents, and
   IPC payloads must be parsed through a schema validator (zod, valibot, io-ts) before
   being treated as typed data.
3. **No \`as\` without a narrowing reason.** \`value as Foo\` is only acceptable when
   preceded by a runtime check that proves the shape (e.g. \`if ("id" in value)\`).
4. **Exhaustive switches on discriminated unions.** Every \`switch\` on a tagged
   union must end with a \`default\` branch that assigns to \`never\` to surface
   missing cases at compile time.
5. **Promise hygiene.** No unawaited promises in \`async\` functions; no
   \`void promise\` unless documented. Use \`@typescript-eslint/no-floating-promises\`.
6. **Null-safety at the boundary.** Optional chaining (\`?.\`) and nullish
   coalescing (\`??\`) must only be used when the null path is handled, not as a
   silent default.

## Tier 2 — follow-up rules

7. Prefer \`readonly\` for arrays/object fields that are not mutated.
8. Prefer \`type\` aliases for unions, \`interface\` for extendable object shapes.
9. Name generic parameters descriptively once they carry semantic meaning (\`TEvent\`, \`TPayload\`).
10. Avoid re-exporting entire namespaces; named re-exports keep bundle analysis tractable.
11. Co-locate test fixtures with their types to keep drift visible.

## Anti-patterns

- "It compiles, ship it" — compilation is necessary, not sufficient. Runtime boundary validation is the gate.
- Casting library return types to tighten them without reading the library's actual contract.
- Wrapping every function in \`try/catch\` and swallowing the error — errors must either be rethrown typed or mapped to a Result/Either shape.
- Using enums where a string-literal union would do (enums carry runtime cost and erase at tree-shaking time only when \`const\`).

## Review output shape

\`\`\`
- **Rule:** T1-2 (runtime validate trust boundaries)
- **File:line:** src/api/users.ts:42
- **Finding:** POST body cast directly to \`UserCreateInput\`; no schema parse.
- **Remediation:** Parse through \`userCreateSchema\` (zod) before passing to the service layer.
\`\`\`
`;
}

export function languagePythonSkill(): string {
  return `---
name: language-python
description: "Python rule pack. Opt-in language lens. Use when reviewing or writing Python diffs during tdd or review — enforces typing, exception hygiene, and idiomatic patterns."
---

# Python Rule Pack

## Quick Start

> 1. Activate during tdd or review whenever the diff touches \`.py\` / \`.pyi\` files.
> 2. Walk the rule tiers in order. Tier-1 violations block merge. Tier-2 need a named follow-up.
> 3. Cite each finding as \`file:line — <rule id> — <one-line remediation>\`.

## HARD-GATE

Do not approve a Python change that catches bare \`except:\` or \`except Exception:\`
in production code *without* (a) re-raising, (b) logging with \`logger.exception\`, or
(c) a comment explaining the intentional swallow. Silent broad catches are the
single biggest source of "works on my machine" bugs in Python services.

## Tier 1 — blocking rules

1. **Type hints on public APIs.** Every exported function, method, and dataclass
   must have full type hints. Use \`from __future__ import annotations\` or PEP 604 union syntax.
2. **No mutable default arguments.** \`def f(x=[])\` is a bug. Use \`None\` + inline default.
3. **Exception specificity.** Catch the narrowest exception class you actually handle.
4. **Context managers for resources.** Files, sockets, DB sessions, locks — always \`with\`.
5. **No bare \`assert\` in production code.** \`assert\` is stripped under \`python -O\`.
   For invariants, raise \`ValueError\`/\`RuntimeError\` explicitly.
6. **Deterministic imports.** No conditional imports at module top level except for
   platform branches; no import-time side effects.

## Tier 2 — follow-up rules

7. Prefer \`@dataclass(slots=True, frozen=True)\` for value objects.
8. Prefer \`pathlib.Path\` over \`os.path\` for new code.
9. Use f-strings for interpolation; reserve \`%\` and \`.format\` for logger messages (lazy eval).
10. Use \`logging.getLogger(__name__)\` per module; never the root logger.
11. Pin dependency ranges in \`pyproject.toml\`; lock with \`uv lock\` / \`pip-compile\`.

## Async-specific

- Do not mix \`requests\`/sync I/O inside \`async def\`. Use \`httpx.AsyncClient\` / \`aiofiles\`.
- \`asyncio.gather\` with \`return_exceptions=False\` cancels siblings on first failure — be explicit.
- Every task created with \`asyncio.create_task\` must have its reference kept and awaited.

## Anti-patterns

- Using \`**kwargs\` to avoid writing a real signature.
- Monkey-patching modules from tests without a \`contextlib.contextmanager\` cleanup.
- Treating \`__init__.py\` as a place to run logic (imports only).
- Re-inventing \`itertools\`/\`functools\` instead of using stdlib.

## Review output shape

\`\`\`
- **Rule:** P1-3 (exception specificity)
- **File:line:** users/service.py:88
- **Finding:** \`except Exception\` around DB call silently drops integrity errors.
- **Remediation:** Catch \`IntegrityError\` explicitly; re-raise everything else.
\`\`\`
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
 * pack. A single folder keeps discovery trivial for hooks and for `doctor`.
 */
export const LANGUAGE_RULE_PACK_DIR = ["rules", "lang"] as const;

export const LANGUAGE_RULE_PACK_GENERATORS: Record<string, () => string> = {
  typescript: languageTypescriptSkill,
  python: languagePythonSkill,
  go: languageGoSkill
};

/**
 * Legacy per-language folders under `.cclaw/skills/` used in v0.7.0. Listed
 * here so `cclaw sync` and `doctor` can surface drift and the installer can
 * clean them up after the move to `.cclaw/rules/lang/`.
 */
export const LEGACY_LANGUAGE_RULE_PACK_FOLDERS = [
  "language-typescript",
  "language-python",
  "language-go"
] as const;
