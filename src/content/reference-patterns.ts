export interface ReferencePattern {
  id: string;
  fileName: string;
  title: string;
  triggers: string[];
  body: string;
}

const API_ENDPOINT = `# Pattern — new HTTP API endpoint

## When to use

The user asks for "an endpoint", "a route", "an API for X", or wants to expose data that today is only reachable through internal code.

## Pre-flight checklist

1. Read \`src/server/router.ts\` (or your project's equivalent) and the closest existing endpoint of the same shape.
2. Identify the AuthZ policy: who is allowed to call this? If the answer is "anyone", flag it back to the user explicitly. Anonymous endpoints are a deliberate decision.
3. Identify the request and response schema. If the project uses Zod / TypeBox / pydantic / etc., the AC is "schema parses + rejects bad payloads".

## AC shape

- AC-1: \`POST/GET <path>\` accepts <schema> and returns <schema>; verified by an integration test that hits the route.
- AC-2: AuthZ rejects unauthorized callers; verified by an integration test with no/forged credentials.
- AC-3 (optional): rate limit / quota where applicable; verified by a smoke test or by reading \`<rate limiter>\` config.

## Specialists to invoke

- \`architect\` — if the endpoint touches a new resource type or changes a response schema that other endpoints depend on.
- \`security-reviewer\` — always, when AuthZ is non-trivial or when the endpoint exposes user data.
- \`reviewer\` mode=\`code\` after build; \`integration\` after slice-builder if multiple files.

## Common pitfalls

- "Allow only authenticated users" without saying which roles → ask which roles.
- Adding the endpoint without updating the OpenAPI / TS client. Fold the regen into the same AC if the project has a generator.
- Forgetting structured logs / metrics. If logging is enforced project-wide, mention it as an AC.
`;

const AUTH_FLOW = `# Pattern — authentication flow change

## When to use

The user asks for "login", "OAuth", "passkeys", "MFA", "SSO", "session lifetime", or anything that touches \`req.user\` derivation.

## Pre-flight checklist

1. Read the existing auth entry points (route handlers, middleware, session store).
2. Identify which trust boundary changes (browser ↔ edge, edge ↔ service, service ↔ identity provider).
3. Identify whether the change is additive (new flow) or replacing (rewriting an existing flow). Replacement is always large/risky.
4. Pull threat-model assumptions from prior shipped slugs (\`grep refines: …\` on auth-related plans).

## AC shape

- AC-1: happy path — user successfully authenticates and \`req.user\` carries the expected claims.
- AC-2: rejection paths — invalid credentials / expired tokens / replay attempts each return the documented error and do not leak information.
- AC-3: session lifetime — sessions expire on the documented schedule and refresh tokens behave correctly.
- AC-4: telemetry — auth events emit the configured audit logs with the correct fields.

## Specialists to invoke

- \`architect\` — always, even if the change feels additive.
- \`security-reviewer\` mode=\`threat-model\` — always.
- \`security-reviewer\` mode=\`sensitive-change\` — at code-review time on the diff.
- \`reviewer\` mode=\`adversarial\` — at least once, looking for the case the author is biased to miss.

## Common pitfalls

- Implementing OAuth without state / PKCE.
- Letting the new flow coexist with an old one indefinitely. Either schedule the deprecation or document why both are required.
- Logging tokens or refresh tokens. Even partial prefixes are a security finding.
- Skipping the rejection-path AC because "it follows from the framework". Write it.
`;

const SCHEMA_MIGRATION = `# Pattern — database schema migration

## When to use

The user asks to add / drop / rename a column, change a type, add an index, partition a table, or otherwise alter persisted state.

## Pre-flight checklist

1. Read the migration directory (Prisma / Alembic / Knex / Atlas / SQL files) and look at the most recent migration of the same shape.
2. Decide forward-only vs. reversible. Production usually wants reversible until the rollout is locked.
3. Decide downtime: zero-downtime (write-both-read-old → backfill → write-new-read-new) vs. allowed downtime (single migration).
4. Identify whether ORMs / generated clients need to be regenerated. Add this to the AC if so.

## AC shape

- AC-1: migration applies to a fresh DB; verified by integration test booting against the new schema.
- AC-2: migration applies to a non-empty DB; verified by a backfill smoke test on a fixture.
- AC-3: rollback path; verified by re-running the down migration on the fixture and asserting equivalence.
- AC-4: ORM / client regenerated; verified by a typecheck on the consumers.

## Specialists to invoke

- \`architect\` — when the migration changes a relationship, partition strategy, or index that other features rely on.
- \`security-reviewer\` — when the migration touches columns holding user data, secrets, or audit history.

## Common pitfalls

- "Just add the column nullable" without the backfill plan. Always state when the column becomes \`NOT NULL\`.
- Adding an index that is going to take >5 minutes on prod without coordinating. Surface the ops impact in the plan.
- Forgetting downstream replicas / read replicas / DR replicas. Write a one-line note in ship notes.
`;

const UI_COMPONENT = `# Pattern — new or modified UI component

## When to use

The user asks for "a button", "a modal", "a chart", "a settings screen", or any visual surface change.

## Pre-flight checklist

1. Find the design source: Figma link, screenshot, prior component. If there is none, ask the user before authoring.
2. Inspect the existing design system (\`tokens.css\` or equivalent) for colours, spacing, typography. New tokens require a separate decision.
3. Identify state machines: hover, focus, disabled, error, loading, empty.
4. Identify accessibility requirements: keyboard navigation, screen-reader labels, focus order, prefers-reduced-motion.

## AC shape

- AC-1: component renders all documented states with snapshot tests for each.
- AC-2: keyboard navigation works (focus order verified by test).
- AC-3 (when applicable): screen-reader names; verified by axe / similar snapshot.
- AC-4: integration into the parent surface(s) named in the plan.

## Specialists to invoke

- \`reviewer\` mode=\`code\` always.
- \`reviewer\` mode=\`text-review\` if the component carries user-facing copy that wasn't previously approved.

## Common pitfalls

- Writing the component without states the design covers but the user didn't mention.
- Adding a new design token because the existing one is "almost right". Use the existing one or open a separate slug for token work.
- Skipping the empty / error / loading states because they "rarely happen". They are AC.
`;

const PERF_FIX = `# Pattern — performance fix

## When to use

The user reports "slow page", "high CPU", "high memory", "p99 latency", "timeouts", or asks to "make X faster".

## Pre-flight checklist

1. Reproduce or accept a measurement. Performance fixes without a measurement are speculation. If no measurement exists, the first AC is "measurement reproducible in CI".
2. Identify the slow path: which function, query, render, etc. Cite \`file:path:line\`.
3. Identify the budget: what number constitutes "fast enough"?

## AC shape

- AC-1: measurement reproducible (test, microbenchmark, or profiling artifact under \`docs/perf/\`).
- AC-2: budget achieved on the same measurement; verified by re-running the benchmark.
- AC-3: regression guard — a CI check or alert that fails when the budget is exceeded again.

## Specialists to invoke

- \`architect\` mode=\`feasibility\` — if the fix changes data structure, query plan, or cache topology.
- \`reviewer\` mode=\`adversarial\` — actively look for the case where the fix is faster on the benchmark but slower in production.

## Common pitfalls

- Optimising the wrong path. Always profile or trace before changing code.
- Caching without a clear invalidation story. The invalidation rule itself is an AC.
- Removing a guarded \`O(n)\` path because "it's never used" without a deprecation window.
`;

const REFACTOR = `# Pattern — pure refactor (no behaviour change)

## When to use

The user asks to "clean up", "simplify", "unify", "split", "extract", "rename", with no observable behaviour change.

## Pre-flight checklist

1. Confirm the refactor is truly behaviour-preserving. If any user-visible change sneaks in, the request is a refactor + behaviour change and must be split.
2. Identify a behavioural pin: a test that passes before and after, or a snapshot that should not change.

## AC shape

- AC-1: behaviour pinned — explicit set of tests / snapshots / fixtures that pass with the same expected output before and after.
- AC-2: refactor applied — file:line references for every renamed / moved / extracted symbol.
- AC-3 (optional): metrics — file count, average function length, cyclomatic complexity — improving as recorded in the build log.

## Specialists to invoke

- \`reviewer\` mode=\`code\` always.
- \`reviewer\` mode=\`text-review\` if the refactor renames public exports referenced in docs.

## Common pitfalls

- Slipping a fix into the refactor commit. Split it into a separate AC.
- Renaming public APIs without a deprecation alias. Surface this back as breaking.
- Refactoring across many directories at once. Slice by directory or by symbol family; one slug per slice.
`;

const SECURITY_HARDENING = `# Pattern — security hardening

## When to use

The user asks to "harden", "fix CVE", "rotate keys", "tighten CSP", "patch SSRF", "fix prototype pollution", or follows an incident.

## Pre-flight checklist

1. Identify the threat the hardening prevents. Citing the CVE / advisory / incident note is mandatory.
2. Identify whether the change is reactive (close an open finding) or proactive (defence in depth). Tag the plan accordingly.
3. Confirm the rollout cannot itself break the system: a hardening that fails closed in production is worse than a slower fix.

## AC shape

- AC-1: the threat path is blocked; verified by a regression test that exercises the threat.
- AC-2: the regression guard runs in CI on every push.
- AC-3: documentation / runbook updated to reflect the new posture.

## Specialists to invoke

- \`security-reviewer\` mode=\`threat-model\` always.
- \`security-reviewer\` mode=\`sensitive-change\` on the diff.
- \`reviewer\` mode=\`adversarial\` — second pair of eyes on the regression test (does it actually exercise the threat?).

## Common pitfalls

- Closing the finding without the regression guard. Without the guard, the next refactor reopens it.
- Adding a deny-list when an allow-list would do.
- Using a string-matching guard for a structural problem (e.g. blocking SSRF by checking the URL string instead of resolving DNS first).
`;

const DOC_REWRITE = `# Pattern — documentation rewrite

## When to use

The user asks to "rewrite the README", "update docs", "fix the quickstart", "polish the changelog".

## Pre-flight checklist

1. Identify the intended audience for the doc. The audience determines what stays and what is cut.
2. Identify the constraints: tone of voice, length, must-include sections, what to drop.
3. Pull the canonical source for any claim the doc will make. The doc must not invent flags / endpoints / commands.

## AC shape

- AC-1: doc passes a manual smoke read-through (a small checklist verified by the author).
- AC-2: every code snippet in the doc compiles / runs against the current code (verified by a snapshot test or runnable example).
- AC-3 (when applicable): cross-doc links remain valid.

## Specialists to invoke

- \`reviewer\` mode=\`text-review\` always.
- \`reviewer\` mode=\`release\` if the doc is the user-facing release notes.

## Common pitfalls

- Mixing a doc rewrite with a code change. They are separate slugs.
- Promoting the doc rewrite into a "while we're here" refactor. Refuse, surface as a follow-up.
- Forgetting the changelog. If the rewrite changes any quickstart command, add a release-notes line.
`;

export const REFERENCE_PATTERNS: ReferencePattern[] = [
  { id: "api-endpoint", fileName: "api-endpoint.md", title: "API endpoint", triggers: ["new endpoint", "route", "API", "REST", "GraphQL"], body: API_ENDPOINT },
  { id: "auth-flow", fileName: "auth-flow.md", title: "Authentication flow", triggers: ["login", "OAuth", "SSO", "MFA", "passkey", "auth"], body: AUTH_FLOW },
  { id: "schema-migration", fileName: "schema-migration.md", title: "Schema migration", triggers: ["migration", "schema", "alter table", "column"], body: SCHEMA_MIGRATION },
  { id: "ui-component", fileName: "ui-component.md", title: "UI component", triggers: ["component", "button", "modal", "screen", "design"], body: UI_COMPONENT },
  { id: "perf-fix", fileName: "perf-fix.md", title: "Performance fix", triggers: ["slow", "perf", "latency", "p99", "memory"], body: PERF_FIX },
  { id: "refactor", fileName: "refactor.md", title: "Pure refactor", triggers: ["refactor", "cleanup", "rename", "extract"], body: REFACTOR },
  { id: "security-hardening", fileName: "security-hardening.md", title: "Security hardening", triggers: ["CVE", "security", "harden", "patch", "SSRF", "XSS"], body: SECURITY_HARDENING },
  { id: "doc-rewrite", fileName: "doc-rewrite.md", title: "Documentation rewrite", triggers: ["docs", "README", "quickstart", "changelog"], body: DOC_REWRITE }
];

export const REFERENCE_PATTERNS_INDEX = `# .cclaw/lib/patterns/

Eight reference patterns the orchestrator pulls from before authoring a plan. Each pattern declares its trigger keywords, the pre-flight checklist, the AC shape, the specialists to invoke, and the common pitfalls.

| pattern | triggers |
| --- | --- |
${REFERENCE_PATTERNS.map((p) => `| [\`${p.fileName}\`](./${p.fileName}) | ${p.triggers.join(", ")} |`).join("\n")}

When a task hits more than one pattern (e.g. an endpoint that is also security-sensitive), the orchestrator opens both files and merges their AC shape sections.
`;
