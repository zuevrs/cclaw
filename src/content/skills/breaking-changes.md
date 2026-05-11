---
name: breaking-changes
trigger: when the diff modifies public API surface or persisted contracts
---

# Skill: breaking-changes

A change is breaking when:

- a public export is renamed, removed, or changes signature;
- a CLI flag is renamed or removed;
- a wire format (HTTP, RPC, queue payload) changes shape or required fields;
- a persisted contract (DB schema, file format, env var) changes in a way that requires migration.

## Rules

1. **Plan must declare it.** Set `breaking_change: true` (or note it explicitly in the plan body).
2. **Migration must exist.** `flows/<slug>/ship.md` carries a migration section: who is affected, what they need to do, when the old path stops working.
3. **Deprecation window.** Public libraries — at least one minor version. Internal services — at least one deploy cycle and one alert.
4. **Release notes.** The CHANGELOG line must start with `BREAKING:` and link to the migration section.

## Coexistence

When possible, ship the new path alongside the old. Examples:

- new endpoint path next to the old one;
- new column added before the old one is dropped;
- new env var name accepted along with the old (with a deprecation log line);
- new function exported with the new name; old name aliased to it.

Coexistence is not always possible (e.g. wire-format changes for older clients you cannot upgrade). When it is not possible, surface this back to the design phase; the decision must be recorded inline in `flows/<slug>/plan.md` under `## Decisions`.

## Common pitfalls

- "Internal API, not breaking." If the change crosses a service boundary, treat it as breaking.
- Renaming a CLI flag without an alias. Aliases for CLI flags are nearly always free; add them.
- Skipping the CHANGELOG line because "everyone knows". They do not.
- Forgetting the alert window for internal services. The deploy cycle is not enough; users need a heads-up.

## Deprecation & migration patterns

Three patterns that cover the lifecycle of an API or contract from "still works, please move" to "removed".

### The Churn Rule

> **If you own the infrastructure being deprecated, you are responsible for migrating your users — or providing backward-compatible updates that require no migration.**

Practically: the team that ships the deprecation owns the migration of every consumer they can identify. They do NOT throw the deprecation over the wall and tell every downstream team to fix their code "by the deadline".

When design (Phase 4) or planner introduces a deprecation:

1. **Identify consumers.** Search the org for callers (`rg` in monorepo, dependency-graph tools across repos, package-registry usage stats).
2. **Choose the migration cost split.** Either (a) the deprecator ships an adapter that wraps the old surface to use the new one (zero migration cost for consumers, higher cost for the deprecator), OR (b) the deprecator pairs with each consumer's owner to land the migration commit (higher coordination cost, but the new shape is the only shape after the cutover).
3. **Document the choice as a D-N in `plan.md` `## Decisions`** (legacy: `decisions.md` on pre-v8.14 resumes). "We picked path (a) because there are 47 internal consumers; path (b) would mean 47 PRs across 12 teams."

A deprecation that names no migration owner and no consumer plan is **F-N | architecture | required | Churn Rule violation**.

### The Strangler Pattern

For larger migrations (replacing a subsystem, not a single function), use the Strangler:

```
phase 0: 100% old path, 0% new path. New path is built in parallel; verified against the old.
phase 1: 1% traffic to new path (canary). Both paths active.
phase 2: 10% → 50% traffic, with monitoring on parity (new behaves like old, or differs in expected ways only).
phase 3: 100% traffic to new path. Old path is fenced off but still in the codebase.
phase 4: Old path removed.
```

Each phase has explicit ship-gate criteria and rollback steps. The Strangler is documented as a multi-D-N block inside `plan.md` `## Decisions` (legacy: `decisions.md` on pre-v8.14 resumes) with the per-phase entry/exit criteria; the orchestrator surfaces "we are in Strangler phase N" in slim summaries until phase 4 ships.

A migration that jumps from phase 0 to phase 4 in one slug is **F-N | architecture | required | Big-bang migration** (no canary, no rollback).

### Zombie Code lifecycle

> Zombie code is code nobody owns but everybody depends on.

Symptom: `git log` shows the last meaningful change was 2-3+ years ago; the original author has left; nobody on the current team can describe what it does or why; but multiple production paths still call it.

The design phase's response when zombie code is identified:

1. **Either assign an owner and maintain it properly** — surface as a finding (`F-N | architecture | required`); the orchestrator opens a follow-up slug to write tests, document, and refactor.
2. **Or deprecate it with a concrete migration plan** — apply the Churn Rule and the Strangler Pattern to retire the code.

What you do **NOT** do: leave zombie code in the diff because "we don't have time to deal with it". Every flow that ships through zombie code makes the eventual cleanup more expensive.

The reviewer cites a knowingly-ignored zombie-code dependency as **F-N | architecture | consider | Zombie code reliance** (severity `required` if the zombie code is on a security-sensitive path).
