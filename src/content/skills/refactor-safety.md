---
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
- mark the old name with a `@deprecated` JSDoc / equivalent;
- record the deprecation deadline in `flows/<slug>/ship.md`.

If the project policy forbids deprecation aliases (some libraries), the refactor is breaking; `security_flag` does not apply but breaking-change handling does (see breaking-changes skill).

## Verification

Refactor AC verification is "no behavioural diff": tests pass, snapshots unchanged, fixtures unchanged. If anything changes, the refactor leaked behaviour and must be split.

## Code-simplification catalog

Three rules that turn "make it simpler" from a feeling into mechanical, reviewer-checkable behaviour.

### Chesterton's Fence — understand WHY before removing

Before deleting a check, a guard, an early-return, an "obviously redundant" branch, a comment, an option flag, or a config knob, **understand why it exists**. The framing:

> "If you see a fence across a road and don't understand why it's there, don't tear it down."

Mechanically:

1. **Read the git history of the fence.** `git log -L ":<symbol>:<file>"` or `git blame` on the relevant lines. The commit message of the introduction often tells you why.
2. **Search for related tests.** A fence often has a regression test pinning it; if the test fails when you remove the fence, the fence was load-bearing.
3. **Search for callers / dependents.** Even if the fence looks self-contained, an external test or runtime check may rely on its presence.
4. **If you cannot find a reason, ask** before removing. "I'm about to delete this guard at `src/auth.ts:127`; `git blame` traces it back to a 2022 incident commit but no test covers it. Is it safe?"

The reviewer cites a fence-removal without due-diligence as **F-N | correctness | required | Chesterton's Fence violation**.

### Rule of 500 — invest in automation past the threshold

If a refactor would touch **more than 500 lines** of code by hand, **stop and invest in automation** instead. Options:

- **Codemod** — `jscodeshift`, `ts-morph`, `Bowery` for JS/TS; `libcst` for Python; `gofmt` / `go-rewrite` for Go.
- **AST transform script** — purpose-built one-shot script using the language's AST library.
- **`sed` / structural search-and-replace** — when the change is regular and AST is overkill.

Why the threshold:

- Hand-rolling 500+ line changes is where attention slips. Drive-by edits, missed call sites, partially-applied patterns become normal.
- Automation makes the change **inspectable at the rule level** instead of the diff level: the reviewer walks "the rule" once, then runs it against the diff, instead of reading 500+ touched lines.
- Repeating the same change in the future is free once the codemod exists.

Document the chosen automation inline in `plan.md` under `## Decisions` (D-N) before running it. The reviewer cites a hand-rolled mass-refactor as **F-N | architecture | consider | Rule of 500 violation**.

### Structural simplification patterns

When the refactor is "make this easier to read", apply named patterns. Each is a one-line rule the reviewer can cite:

| Symptom | Pattern | One-line rule |
|---|---|---|
| Deep nesting (`if/if/if/if`) | **Guard clauses** | Invert the condition; return early. |
| Boolean flag parameter (`createUser(name, email, isAdmin)`) | **Options object** | Replace flags with a discriminated options object. |
| Long parameter list (`> 4 args`) | **Parameter object** | Group related args into a single typed object. |
| Repeated null checks at every call site | **Null object** | Return a typed empty value instead of `null`; checks become uniform. |
| Boolean output of a switch / chain | **Polymorphism** | Replace conditional with a per-type method. |
| Unrelated functions with shared local state | **Extract class** | Group state + methods that operate on it. |
| Lost intermediate values in a long chain | **Extract variable** | Name intermediate steps; the diff reads as prose. |
| Inline comment explaining what code does | **Extract function** | Move the block into a function whose name replaces the comment. |

Each pattern is a refactor; each refactor still ships under `--phase=refactor`. The reviewer cites a missed pattern as severity `consider`, never `required` — pattern hygiene is a polish concern, not a correctness concern.

### Hard rules

- **Chesterton's Fence applies before any deletion** — comments, branches, option flags, env-var defaults included.
- **The 500-line threshold is a hard line** — over it, codemod or split the slug.
- **Pattern names go in commit messages.** `refactor(AC-3): extract guard clauses in paginate()` is the right shape; `refactor(AC-3): cleanup` is not.
