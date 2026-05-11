---
name: api-and-interface-design
trigger: when design (Phase 4 D-N) proposes a public interface, persistence shape, RPC schema, or cross-module contract; auto-applies on slugs whose touchSurface includes a public API surface
---

# Skill: api-and-interface-design

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
- **Breaking** — renamed, removed, type-changed, semantic-changed. Bump the **major** version. `breaking-changes` skill kicks in. Coexistence (new + old together) is preferred over hard cutover.
- **Deprecation** — old surface stays available; new surface is the recommended path. Document the sunset date and the migration step.

For internal-only APIs without a version number, the design phase names the **release window** during which the deprecation alias stays alive.

## Hard rules

- **Pin everything observable.** Shape, order, silence, timing.
- **One version of every dependency** across the consumer's reachable graph.
- **Validate untrusted external responses.** Always. No "they're a sister team, it's fine".
- **No port without two adapters.** A "we might swap it" port is dead code.
- **Consistent error model per boundary.** Pick one, document it, do not mix.

## Composition

The design phase (Phase 4) reads this skill before authoring any inline D-N that introduces or changes a public interface. The reviewer reads it for any review iteration on a slug whose `touchSurface` includes a public API. The planner does NOT read this skill — interface design is the design phase's surface, not the planner's; if the slug only has a planner pass (small/medium routing skipped design), the planner adds a `## Concerns` bullet pointing at this skill as a follow-up.
