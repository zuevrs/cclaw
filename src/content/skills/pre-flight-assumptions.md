---
name: pre-flight-assumptions
trigger: reference doc only — the assumption surface moved to the architect's Bootstrap phase in v8.21 (v8.62 unified flow: now a single architect dispatch covers all complexity classes)
---

# Skill: pre-flight-assumptions

**fold notice — this skill is a reference doc, not a runtime step.**

Triage answers "**how much** work is this?" and "**how should we run it?**". The assumption confirmation answers "**on what assumptions** are we doing it?". They are different questions, and the silently-defaulted-assumption problem is real: it is the most common reason a small/medium build ships the wrong feature.

Pre-v8.21, this skill ran as a standalone **preflight step** between triage and the first specialist dispatch. It surfaced a numbered list of assumptions through the harness's structured ask, captured the user's confirmation, and persisted the list to `flow-state.json > triage.assumptions`. v8.21 collapsed the preflight into the first-specialist's Bootstrap turn. v8.62 unified flow then collapsed the two-specialist split (design Phase 0/1 on large-risky, ac-author Phase 0 on small-medium) into a single `architect` Bootstrap phase that owns the assumption surface across every non-inline complexity class.

## When to use

Reference doc only — there is no longer a runtime preflight step. The actual capture surface lives in `agents/architect.md` (Bootstrap phase) on both strict and soft flows. Read this skill when you need to understand the assumption-list composition rules (3-7 items, stack / conventions / architecture / out-of-scope) that both ceremony tiers share, or when you are debugging a resumed pre-v8.21 flow.

## When NOT to apply

- **`triage.path == ["build"]` (inline / trivial).** Single-file edits have no architectural assumptions worth surfacing; the assumption step is structurally absent.
- **Resume from a paused flow.** The architect's Bootstrap reads `triage.assumptions` from disk as ground truth and does NOT re-prompt. The user already answered.
- **Pre-v8.21 flows with populated `triage.assumptions`.** The legacy preflight step captured the list; the new Bootstrap short-circuits the ask on read. Reading this skill helps debug; running it again does not.
- **Mid-flight build / review dispatch.** Once the architect's Bootstrap stamped the list, downstream specialists read from disk — they don't re-author or re-ask.
- **Mid-plan dialogue.** v8.62 unified flow forbids the architect from emitting a user-facing clarifying turn mid-plan; the architect resolves ambiguity silently with best judgment and records the chosen interpretation in `plan.md > ## Plan`.

## Common pitfalls

See `triage-gate.md` for the triage gate's optional seed of `triage.assumptions` from the most-recent-shipped-slug. See `flow-resume.md` for the resume rule (never re-prompt on resume). See `agents/architect.md` Bootstrap for the actual ownership contract.

## Where the surface lives now

- **`triage.complexity == "large-risky"` (strict) AND `triage.complexity == "small-medium"` (soft)** → the architect's **Bootstrap** phase (`agents/architect.md`) owns the assumption surface. Bootstrap runs silently, reads any pre-seeded `triage.assumptions` from the triage gate, and records the assumption list to `triage.assumptions` as part of the single architect dispatch. v8.62 unified flow runs one shape across complexity classes; the depth of the architect's Frame → Compose pass varies, but Bootstrap is uniform.
- **`triage.path == ["build"]`** (inline / trivial) → no assumption surface. A single-file edit has no architectural assumptions worth surfacing.

## Why the fold

- The user's original audit flagged the legacy double-ask as "дико переусложнено" — the discovery specialist's first turn already opened with a clarifying question, and a separate preflight step right before it produced two back-to-back asks that asked overlapping things.
- v8.62 unified flow collapsed the two-specialist split (design + ac-author) into a single `architect` that owns Bootstrap across all complexity classes. The architect opens with the same content as the legacy preflight step would have produced, inside its own context, and resolves any forks silently using best judgment (no mid-plan dialogue).
- `triage.assumptions` stays a first-class field on `flow-state.json` (same wire format, same schema, same downstream readers). Only the *capture surface* moved.

## What still applies (from the legacy skill body)

The composition rules for an assumptions list are unchanged — the architect's Bootstrap phase uses the same playbook:

- **Stack** — language version, framework, runtime target, test runner.
- **Conventions** — where tests live, filename pattern.
- **Architecture defaults** — CSS strategy, state strategy, auth strategy, persistence pattern (skip items not relevant).
- **Out-of-scope defaults** — what we will NOT do unless asked.
- **3-7 numbered items, one sentence each, citation when non-obvious.**

The interpretation-forks sub-step (when the prompt has multiple readings) also lives inside the architect's Bootstrap / Frame phases. v8.62 unified flow forbids mid-plan dialogue, so the architect picks the most-defensible reading inline ("Reading this as X (Y rejected because …)") and persists to `triage.interpretationForks`. If the user wants to think before code is written, the correct entry point is `/cc research <topic>`.

## Worked example

See `agents/architect.md` Bootstrap for the canonical opening shape. The legacy v8.20-and-earlier preflight worked-example (3-7 numbered items, "tell me if any is wrong" close, silence = accept) carries forward unchanged inside the new architect surface; on v8.62+ the architect runs silently without the user-facing "tell me" close, recording the same list to `triage.assumptions` and the same content to `plan.md > ## Plan`.

## Migration note (pre-v8.21 flows)

Flows started on v8.20 or earlier where the legacy preflight step already captured `triage.assumptions` continue to work unchanged. The architect's Bootstrap on resume reads the populated list as ground truth and **does not re-prompt**. The fold is purely about the capture surface for **fresh** v8.21+ flows.
