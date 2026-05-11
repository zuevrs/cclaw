---
name: source-driven
trigger: when design (deep posture, Phase 4 D-N) or ac-author is dispatched/active in strict mode AND the task is framework-specific
---

# Skill: source-driven

Framework-specific code (React hooks, Django views, Next.js routing, Prisma migrations, Tailwind utilities, etc.) must be **grounded in official documentation, not memory**. Training data goes stale: APIs deprecate, signatures change, recommended patterns evolve. Source-driven means: detect the stack, fetch the relevant doc page, implement against it, cite the URL.

## When NOT to apply

- **`triage.acMode == "inline"` (trivial).** Single-line edits don't need URL citations; the audit-trail cost is wasted on a typo fix.
- **Pure logic** (loops, data structures, internal helpers, project-local utility functions). Correctness is version-independent; the docs add no signal.
- **Internal-only modules** that never cross a framework boundary. Citing React docs for a function that doesn't import React is noise.
- **Refactor slugs with `behaviour-preserving: true`.** The behaviour is pinned by existing tests; no new framework decision is being made.
- **`triage.acMode == "soft"` without an explicit `source_driven: true` flag.** Soft mode is opt-in for source-driven citations; the default keeps the small/medium loop fast.
- **`UNVERIFIED:` is honest, not lazy.** When official docs are unreachable AND the harness has no `user-context7`, marking the surface `UNVERIFIED:` is the correct outcome — don't paper over with a Stack Overflow link.

## When this skill applies

| Triage | Stack signal | Apply? |
| --- | --- | --- |
| `strict` (large-risky / security-flagged) | framework-specific code in scope | **always** — required for design (D-N records) and ac-author |
| `soft` (small-medium) | framework-specific code in scope | **opt-in** — enable when the user asks for "source-driven" or "verified" implementation |
| `inline` (trivial) | any | **never** — single-line edits don't need citations |
| any | pure logic (loops, data structures, internal helpers) | skip — correctness is version-independent |

The orchestrator passes `source_driven: true` in the dispatch envelope when it applies. Specialists honour the flag.

## The four-step process

```
DETECT ──→ FETCH ──→ IMPLEMENT ──→ CITE
   │          │           │           │
   ▼          ▼           ▼           ▼
What       Get the     Follow the   Show the
stack +    relevant    documented   URL inline
versions?  page, not   patterns     in code +
           homepage                 in artifact
```

### Step 1 — Detect stack and versions

Read the project's dependency file. Cite the file you read.

| Manifest | Versions to extract |
| --- | --- |
| `package.json` + lockfile | Node engines, framework dep version (React, Vue, Next.js, Express, etc.), test runner, linter |
| `composer.json` | PHP version, framework version (Symfony, Laravel) |
| `pyproject.toml` / `requirements.txt` | Python version, framework version (Django, Flask, FastAPI) |
| `go.mod` | Go version, framework version (gin, echo, chi) |
| `Cargo.toml` | Rust edition, crate version |
| `Gemfile` | Ruby version, framework version (Rails, Sinatra) |

Surface the result explicitly in the artifact:

```text
STACK DETECTED:
- React 19.1.0 (from package.json)
- Vite 6.2.0 (from package.json)
- Tailwind CSS 4.0.3 (from package.json)
→ Fetching official docs for the patterns this slug needs.
```

If a version is missing or ambiguous (e.g. `"react": "^19.0.0"`, lockfile pinned to a release-candidate), **ask the user once** before proceeding. Don't guess.

### Step 2 — Fetch official documentation

Fetch the **deep link** for the specific feature in scope. Not the homepage. Not the search result. Not "the React docs".

#### Cache lookup before fetch (mandatory)

cclaw keeps a local fetch cache at `.cclaw/cache/sdd/<host>/<url-path>.{html,etag,last-modified}`. The cache is gitignored and per-project. Behaviour:

```
url = https://react.dev/reference/react/useActionState

cache key  = .cclaw/cache/sdd/react.dev/reference/react/useActionState

files:
  .cclaw/cache/sdd/react.dev/reference/react/useActionState.html
  .cclaw/cache/sdd/react.dev/reference/react/useActionState.etag           (optional)
  .cclaw/cache/sdd/react.dev/reference/react/useActionState.last-modified  (optional)
```

For every URL you would fetch:

1. **Compute the cache key** from the URL host and path. Drop the query string only when it is purely tracking (utm_*, gclid, fbclid). Keep documentation-meaningful query like `?v=18` or `#useActionState-with-form` (anchors are part of the URL but never affect cache key — they are page-internal).
2. **Cache hit, no validators on disk:** if the `.html` file exists and is < 24h old, **use it directly**. No network. Do not refetch.
3. **Cache hit, validators present (any age):** issue a conditional GET with `If-None-Match: <etag>` and/or `If-Modified-Since: <last-modified>`. On `304 Not Modified`, use the cached body. On `200`, replace the cached body and validators atomically.
4. **Cache miss:** fetch normally. Save the response body to `<key>.html` and the validator headers to `<key>.etag` / `<key>.last-modified` if the response provided them. Set the file mtime to now (treated as the cache's "fetched_at").
5. **Network unavailable / 4xx / 5xx:** if a cached body exists, use it and add a `stale-cache` line to the artifact's `sources:` block. If no cached body, mark the citation `UNVERIFIED` and continue (see "UNVERIFIED marker" below).

The cache is a **per-project** courtesy, not a global mirror. Every project that uses cclaw has its own cache; the cache is also gitignored (a duplicate fetch from a teammate is a few hundred kB, not a real cost).

The harness's web-fetch tool (or `user-context7` MCP) is the network layer; cclaw layers the cache on top. When the harness has `user-context7`, the resolved doc URL is the cache key (Context7 returns canonical URLs).

Cite the cached file alongside the URL in the `sources:` block:

```yaml
sources:
  - url: https://react.dev/reference/react/useActionState#usage
    used_for: AC-1 (form submission state pattern)
    fetched_at: 2026-05-08T22:45Z
    cache_path: .cclaw/cache/sdd/react.dev/reference/react/useActionState.html
    cache_status: hit-fresh   # one of: hit-fresh | hit-revalidated | miss-fetched | stale-cache
    version: react@19.1.0
```

The reviewer treats `cache_status: stale-cache` as a finding (axis=correctness, severity=consider) — the user should confirm the doc is still current.

#### Source hierarchy

| Bad | Good |
| --- | --- |
| `react.dev` | `react.dev/reference/react/useActionState#usage` |
| "search Django auth" | `docs.djangoproject.com/en/6.0/topics/auth/` |
| StackOverflow answer | `react.dev/blog/2024/12/05/react-19#actions` |

#### Source hierarchy (in order of authority)

1. Official documentation for the detected version (`react.dev`, `docs.djangoproject.com`, `symfony.com/doc`).
2. Official blog / changelog (`react.dev/blog`, `nextjs.org/blog`).
3. Web standards (`MDN`, `web.dev`, `html.spec.whatwg.org`).
4. Browser/runtime compatibility (`caniuse.com`, `node.green`).

**Not authoritative** — do not cite as primary:

- Stack Overflow answers (community Q&A, not a spec).
- Blog posts or tutorials, even popular ones.
- AI-generated documentation summaries.
- Your own training data — that is the whole point.

If the detected version's docs disagree with an older blog post, the docs win. If two official sources conflict (e.g. migration guide vs. API reference), surface the conflict to the user; do not silently pick one.

### Step 3 — Implement following documented patterns

Match the API signatures and patterns in the doc page. If the docs deprecate a pattern, do not use the deprecated version.

When existing project code conflicts with current docs:

```text
CONFLICT DETECTED:
The existing codebase uses `useState` for form loading state,
but React 19 docs recommend `useActionState` for this pattern.
(Source: https://react.dev/reference/react/useActionState)

Options:
A) Adopt the modern pattern (useActionState) — matches current docs.
B) Match existing code (useState) — keeps codebase consistent.
→ Which approach do you prefer?
```

Do not silently adopt one. The user picks; the decision goes inline in `plan.md` under `## Decisions` (design Phase 4) or in the plan body (ac-author mode).

### Step 4 — Cite sources inline

Every framework-specific decision gets a citation. The user must be able to verify every choice without trusting the agent's memory.

In **plan.md** (v8.14+; legacy `decisions.md` for pre-v8.14 shipped slugs), include a `sources:` block under the relevant AC or D-N decision. Each entry includes the cache fields from Step 2 — they make the source-driven trail reproducible offline:

```yaml
sources:
  - url: https://react.dev/reference/react/useActionState#usage
    used_for: AC-1 (form submission state pattern)
    fetched_at: 2026-05-08T22:45Z
    cache_path: .cclaw/cache/sdd/react.dev/reference/react/useActionState.html
    cache_status: miss-fetched
    version: react@19.1.0
  - url: https://react.dev/blog/2024/12/05/react-19#actions
    used_for: D-1 (rationale for picking useActionState over manual useState)
    fetched_at: 2026-05-08T22:46Z
    cache_path: .cclaw/cache/sdd/react.dev/blog/2024/12/05/react-19.html
    cache_status: hit-fresh
    version: react@19.x
```

In **code comments**, cite the doc URL near the pattern:

```typescript
// React 19 form handling with useActionState.
// Source: https://react.dev/reference/react/useActionState#usage
const [state, formAction, isPending] = useActionState(submitOrder, initialState);
```

Citation rules:

- Full URLs, not shortened.
- Prefer deep links with anchors (`/useActionState#usage` over `/useActionState`).
- Quote the specific passage when it supports a non-obvious decision (e.g. "useTransition now supports async functions [...] to handle pending states automatically").
- Include browser/runtime support data when recommending platform features.

## UNVERIFIED marker (when docs are missing)

If you cannot find official documentation for a pattern (cclaw's `user-context7` MCP returns nothing, the framework has no public docs for the feature, etc.):

- Mark the AC / decision with `unverified: true` in frontmatter.
- Add an inline marker in the artifact body:

```text
UNVERIFIED: I could not find official documentation for this pattern.
This is based on training data and may be outdated.
Verify before using in production.
```

- The reviewer treats `unverified: true` as a finding (axis: correctness, severity: required) on iteration 1. Ship blocks until the user either confirms the pattern is intentional or surfaces a doc URL the agent can cite.

Honesty about what you couldn't verify is more valuable than confident guessing.

## Specialist contracts

- **ac-author** in `source_driven` envelope: every framework-specific AC carries a `sources` block (URL + which AC it supports + fetched timestamp + version). AC without a citation in framework code → reviewer F-N axis=correctness, severity=required.
- **design** (Phase 4) in `source_driven` envelope: every `D-N` whose decision rests on framework behaviour (rendering model, state management strategy, persistence pattern, security posture) carries a `sources` block inline. Design without a citation surfaces "I could not find current documentation; this decision is based on training data" — explicit, not silent.
- **slice-builder** in `source_driven` envelope: pulls the URL from `plan.md` (inline D-N) into the code comment when implementing the pattern. Does not independently re-fetch (design/ac-author already did the work).
- **reviewer** runs the citation check as part of the `correctness` axis pass. Open finding when:
  - a framework-specific AC has no `sources` block;
  - a citation URL is to a non-authoritative source (Stack Overflow, blog, training data);
  - a citation is to a doc page for a different framework version than the one in the project.

## MCP integration (when the harness has `user-context7`)

cclaw recognises `user-context7` as the source-of-truth fetcher. When `source_driven: true` is in the envelope, the ac-author / design (Phase 4 D-N) SHOULD prefer:

1. `mcp_user-context7_resolve-library-id` to map a package name to a Context7 library id.
2. `mcp_user-context7_get-library-docs` to fetch the relevant docs at the detected version.

If the harness does not have `user-context7` (or the user disabled it), the specialist falls back to the harness's web-fetch tool (browser tool, fetch, curl) against the official docs URL — same source-hierarchy rules apply.

## Common pitfalls

- "I'm confident about this API" — confidence is not evidence. Verify.
- "Fetching docs wastes tokens" — hallucinating wastes more. One fetch prevents an hour of debugging the deprecated signature.
- "The docs won't have what I need" — if they don't, that is itself information; the pattern may not be officially recommended.
- "I'll just disclaim 'might be outdated'" — disclaimers don't help. Either verify and cite, or mark UNVERIFIED.
- "This task is simple, no need to check" — simple tasks become templates. The user copies your useState pattern into ten components before realising useActionState exists.
- Fetching the homepage instead of the deep link. Token waste with no signal.
- Citing the docs once but using the pattern from memory. The point of source-driven is you wrote what the doc said, not what you remembered the doc said.

## Verification checklist (reviewer uses this)

After implementing under `source_driven`:

- [ ] Stack and versions identified from a real manifest file (cited `file:line`).
- [ ] Official docs fetched for each framework-specific pattern (deep link, not homepage).
- [ ] No Stack Overflow / blog / training-data citations as primary sources.
- [ ] Code follows current-version patterns (no deprecated APIs).
- [ ] Non-trivial decisions include a `sources` block with full URL.
- [ ] Conflicts between docs and existing project code surfaced to the user.
- [ ] Anything unverifiable marked `UNVERIFIED:` explicitly.
