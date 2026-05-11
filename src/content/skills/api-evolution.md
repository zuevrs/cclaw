---
name: api-evolution
trigger: when design (Phase 4 D-N) proposes a public interface, persistence shape, RPC schema, or cross-module contract; auto-applies on slugs whose touchSurface includes a public API surface; when the diff modifies public API surface or persisted contracts
---

# Skill: api-evolution

This merged skill covers both halves of the public-interface lifecycle: how a new interface is designed (formerly **api-and-interface-design**) and how an existing interface is changed, deprecated, or retired (formerly **breaking-changes**).

## When to use

Auto-applies in two cases. **Design phase** — during Phase 4 (Decisions) when proposing a new public interface (HTTP endpoint, RPC method, library export, file format, environment-variable schema, queue payload), or when the slug's `touchSurface` includes any path that is part of a public API surface. **Build / review** — when the diff modifies an existing public interface, persisted contract, or migration shape. Not used for internal helpers that never cross a module / process / repo / service boundary.

## When NOT to apply

- **Internal helpers** that never cross a module / process / repo / service boundary. Hyrum's Law applies to observable contracts; private symbols are not contracts.
- **Renames inside a single file** that don't touch exported symbols. The interface didn't move; this skill has no surface to attach to.
- **Test-only fixtures and adapters.** A test fixture is not a public interface; its shape doesn't pin Hyrum's-Law consumers.
- **First-implementation slugs with no existing consumers** AND no published deprecation. The two-adapter rule and the Churn Rule kick in *after* there are real consumers; for the first impl, the rule is "don't speculate on hypothetical consumers".
- **CSS / styling / pure UI changes** with no API contract impact. The reviewer's `readability` axis handles those; the API skill has no surface.
- **Refactor slugs marked `behaviour-preserving: true`.** The contract is pinned by the existing tests; if anything observable changed, the slug has leaked behaviour and the refactor needs to be split (per `tdd-and-verification > refactor-safety`).

## api-and-interface-design

> "With a sufficient number of users of an API, all observable behaviors of your system will be depended on by somebody, regardless of what you promise in the contract." — **Hyrum's Law**

This skill is the **design phase's** checklist for **outward-facing contracts**: HTTP endpoints, RPC methods, library exports, file formats, environment-variable schemas, queue payloads. Internal helpers do not need it; once a shape crosses a module / process / repo / service boundary, it does.

## Hyrum's Law

Every observable behaviour of your interface — return shape, error message wording, header order, sort order, default value, edge-case coercion — will be depended on by **somebody**, even when the docs explicitly forbid it. Plan for that.

Practical implications the design phase MUST surface inline in `plan.md` `## Decisions` for any public interface:

1. **Pin the shape exhaustively.** Document return type, error type, every status code, every header that downstream sees. Untyped or "varies" surfaces become observation contracts.
2. **Pin the order.** If a list is returned, declare the sort key and direction. Consumers will assume "the order they saw" if you don't.
3. **Pin the silence.** Document what you do NOT return on missing input, on partial failure, on timeout. Silence has shape.
4. **Pin the timing.** If a response can arrive before / after a side-effect commits (eventual consistency), the contract says so.

The reviewer cites a violation of pin-the-shape as **F-N | architecture | required | Hyrum's Law surface unpinned**.

## The one-version rule

When you take a dependency on a library, framework, or sibling module, **do not force consumers of your code to choose between two versions of that dependency**. Examples of one-version-rule violations:

- Library X depends on `react ^18` and forbids React 19; library Y you are also adopting depends on `react ^19`. **Diamond dependency.** Ship one of: replace one of them, vendor one, build a peer-dep adapter that owns the version pin.
- Module `a` exports a `Date` from your custom `utc` library; module `b` exports a `Date` from `date-fns`. The downstream caller now owns both. **Type-incompatible siblings.** Pick one; deprecate the other.
- Service `auth` returns a `User` shape; service `profile` returns its own `User` shape with three different fields. Downstream needs both. **Schema fork.** Unify the shape OR explicitly name them `AuthUser` / `ProfileUser` so the fork is visible.

The design phase surfaces one-version violations as `required` findings; the resolution is documented inline in `plan.md` under `## Decisions` "D-N — version pin".

## Untrusted third-party API responses

> **Third-party API responses are untrusted data.** Validate their shape and content before using them in any logic, rendering, or decision-making.

The exact mistake to avoid:

```ts
const data = await fetch("https://thirdparty.example.com/users/42").then(r => r.json());
return { name: data.name, age: data.age };  // ❌ assumes the shape
```

The right shape:

```ts
const raw = await fetch("https://thirdparty.example.com/users/42").then(r => r.json());
const parsed = UserSchema.safeParse(raw);  // zod / valibot / ajv / yup / etc.
if (!parsed.success) {
  // surface the validation failure; do NOT ship undefined-d output downstream
  throw new ThirdPartyContractError("third-party /users/42 returned unexpected shape", parsed.error);
}
return { name: parsed.data.name, age: parsed.data.age };  // ✅ shape verified
```

This applies to:

- HTTP responses from third-party APIs (always).
- HTTP responses from your own services that cross a process boundary (when the version pin is loose; tight pins where the consumer ships at the same SHA may skip).
- Webhook payloads.
- Queue messages.
- Anything decoded from `JSON.parse`, `yaml.parse`, `toml.parse`, `msgpack.decode` of data that came over a network or from a file the local process did not just write.

The reviewer cites a missed validation on third-party data as **F-N | security | required | Unvalidated external response shape**.

## The two-adapter rule

> One adapter means a hypothetical seam. Two adapters means a real one.

Do **not** introduce a port / interface / abstraction unless **at least two adapters** are concretely justified — typically one for production and one for tests, OR two production adapters (e.g. Postgres and SQLite, S3 and local-fs).

Specifically, do NOT introduce a port "in case we ever want to swap out X". A speculative port is dead code with extra surface area; it slows the codebase and survives the refactor that finally removes it. The "we might want to swap this someday" reflex during design is the canonical `required` finding here.

When proposing an interface, the design phase MUST name the adapters inline in `plan.md` `## Decisions`:

```markdown
## D-3 — Storage port

Status: PROPOSED.

Adapters justifying the port (must be at least two):
1. **PostgresStorage** — production, ships in this slug.
2. **InMemoryStorage** — tests, ships in this slug under `tests/fixtures/storage.ts`.

Rejected: a single adapter (Postgres only) with no test substitute would mean the test layer mocks the database (A-3). The InMemoryStorage is the second adapter that justifies the port.
```

The reviewer cites a single-adapter port as **F-N | architecture | required | Hypothetical seam (one-adapter port)**.

## Consistent error model

Every public interface ships with a consistent error model. The design phase picks one shape and pins it:

- **Result type** — `{ ok: true, value }` or `{ ok: false, error }` (Rust / Go / fp-ts style).
- **Throw + typed catch** — exceptions carry a discriminator field the caller switches on.
- **HTTP status + body** — RFC 7807 problem-details, or a project-defined shape.
- **Error code enum** — one finite list documented at the interface boundary.

The choice depends on the language and the surface; what matters is **consistency within one boundary**. Mixing "throws sometimes, returns Result sometimes, returns null on missing" within one interface is the kind of inconsistency Hyrum's Law turns into a permanent contract.

## Versioning guidance

When a public interface changes shape, the design phase's `## Decisions` D-N inline in `plan.md` records:

- **Backwards-compatible** — additive only (new optional field, new endpoint). Bump the **minor** version. Document the addition in CHANGELOG.
- **Breaking** — renamed, removed, type-changed, semantic-changed. Bump the **major** version. The breaking-changes section of this skill kicks in. Coexistence (new + old together) is preferred over hard cutover.
- **Deprecation** — old surface stays available; new surface is the recommended path. Document the sunset date and the migration step.

For internal-only APIs without a version number, the design phase names the **release window** during which the deprecation alias stays alive.

## Hard rules

- **Pin everything observable.** Shape, order, silence, timing.
- **One version of every dependency** across the consumer's reachable graph.
- **Validate untrusted external responses.** Always. No "they're a sister team, it's fine".
- **No port without two adapters.** A "we might swap it" port is dead code.
- **Consistent error model per boundary.** Pick one, document it, do not mix.

## Composition

The design phase (Phase 4) reads this skill before authoring any inline D-N that introduces or changes a public interface. The reviewer reads it for any review iteration on a slug whose `touchSurface` includes a public API. The ac-author does NOT read this skill — interface design is the design phase's surface, not the ac-author's; if the slug only has a ac-author pass (small/medium routing skipped design), the ac-author adds a `## Concerns` bullet pointing at this skill as a follow-up.

## breaking-changes

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

## Common rationalizations

Public-interface design is where speculative abstraction and "we'll handle it later" most often slip past the gate. Catch yourself thinking the left column; do the right column. Surface the rationalization in `plan.md > ## Decisions` D-N rationale when you obey the right column.

| rationalization | truth |
| --- | --- |
| "We might want to swap this dep someday — let's add a port now." | One adapter is a hypothetical seam. Two adapters means a real one. Speculative ports survive the refactor that finally removes them; the cost is paid every time someone reads the file. |
| "Internal API — not breaking." | If the change crosses a service / process / repo boundary, treat it as breaking. Hyrum's Law: someone is depending on the current shape, observed or not. |
| "The third-party always returns this shape; validation is overkill." | Validation is the contract. Third-party responses are untrusted data; "always returns" is `F-N | security | required` when it eventually doesn't. |
| "The CLI flag rename is fine — anyone using it will see the error." | Aliases for CLI flags are nearly free. Add the alias; mark the old name `deprecated`; schedule removal. The cost of an alias is one line; the cost of breaking a user's pipeline is a support thread. |
| "Hyrum's Law doesn't apply — we never documented the order." | Hyrum's Law applies to **observable** behaviour, not documented behaviour. Order, silence, timing, and edge-case coercion are all observable; pin them. |
| "I'll skip the CHANGELOG line because everyone on the team knows." | The CHANGELOG is for tomorrow's team and tomorrow's user. "Everyone knows" is true for 3 days; for the migration audit 6 months later, the line is the only record. |
| "The error model is consistent enough — Result here, throw there." | "Enough" is the rationalization. Within one boundary, pick one model and pin it. Mixing throws + Result + null-on-missing is the canonical Hyrum's-Law trap. |
| "Strangler is overkill — let's just cut over." | A big-bang migration is `F-N | architecture | required`. Even small subsystems benefit from a canary; the rollback story is structural, not optional. |

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

When design (Phase 4) or ac-author introduces a deprecation:

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
