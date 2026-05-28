/**
 * Single source of truth for the six developer-experience (DevEx)
 * dimensions.
 *
 * One consumer today, one shape ready for two tomorrow:
 *
 * - {@link "src/content/specialist-prompts/plan-critic.ts" | PLAN_CRITIC_PROMPT} —
 *   the pre-build `plan-critic` specialist on `rubricMode: "devex"` dispatches.
 *   Walks plan.md against the six DevEx dimensions when triage detects an SDK / API
 *   / CLI / library / public-interface surface; below-6 grades become `DX-N`
 *   findings appended to plan.md's `## Plan-devex findings` section. Block-
 *   ship on strict at severity ≥ medium.
 *
 * Why one const, not "next slug bakes the rubric into the prompt": the
 * design-quality rubric showed that consumers fragment fast — the moment a
 * second surface (post-build reviewer axis, research lens, learnings table)
 * picks up the same vocabulary, the literal table drifts. The lift here is
 * pre-emptive: when a future release adds a reviewer `devex` axis or a
 * `research-devex` lens, they share these helpers and the dimensions
 * cannot drift across surfaces.
 *
 * The exported {@link renderDevexQualityRubricTable} produces the verbatim
 * markdown the plan-critic prompt (rubricMode: "devex") embeds; surface-
 * specific wrapping (intro / "translate to plan.md" rules / verdict shape)
 * lives in the consuming specialist's prompt body. Reference: gstack plan-devex-review
 * SKILL.md lines 1019-1129 (the persona / competitive benchmark / magical
 * moment opening sequence) — cclaw bakes the dimensions into the rubric
 * but keeps the prompt single-shot (no AskUserQuestion pauses — the
 * always-auto contract).
 */

/**
 * One dimension of the devex-quality rubric. The six dimensions are
 * stable and immutable; new dimensions require a major version bump.
 *
 * - `key` — short identifier used in headings / grep / test assertions.
 *   Hyphenated kebab-case for stability across markdown rendering.
 * - `name` — display name used in the rendered table row and in finding
 *   bodies ("API ergonomics: 4/10 ...").
 * - `summary` — one-line "what it covers" cell, second column of the
 *   rubric table.
 * - `anchor10` — "what a 10 looks like" reference, third column. Each
 *   anchor names the concrete state a finished plan would commit to;
 *   below-6 grades land when the plan's commitment falls short.
 */
export interface DevexQualityDimension {
  readonly key: string;
  readonly name: string;
  readonly summary: string;
  readonly anchor10: string;
}

export const DEVEX_QUALITY_DIMENSIONS: readonly DevexQualityDimension[] = [
  {
    key: "getting-started",
    name: "getting started (TTHW)",
    summary:
      "time to Hello World — does the plan account for the first-run flow? from clone / install to a working call, how many steps, how many minutes, how many copy-pastes? are required prerequisites named?",
    anchor10:
      "first-run flow named end-to-end in plan.md: install command, first call (curl / SDK snippet / CLI invocation), expected output; TTHW estimated in minutes; prerequisites enumerated (runtime version, API key, peer deps); a quickstart AC verifies the path from a clean machine; competitor TTHW benchmark cited (Stripe 30s, Vercel 2min) if comparable products exist"
  },
  {
    key: "api-ergonomics",
    name: "API ergonomics",
    summary:
      "cognitive load per call — are method / function / command names predictable? do similar operations look similar? is the happy path the shortest path? are required arguments minimal and optional ones discoverable?",
    anchor10:
      "method / endpoint / command names follow a consistent convention (verb-noun, resource-action, etc.) named in plan.md; required args minimised; sensible defaults documented; the most common call is the shortest signature; type signatures committed in plan.md (TypeScript / OpenAPI / CLI synopsis); an AC verifies one-line invocation for the primary use case"
  },
  {
    key: "error-messages",
    name: "error messages",
    summary:
      "does the plan budget for actionable errors? is there a strategy for failure-mode UX? do errors name what went wrong, why it matters, and what the developer should do next? are error codes stable / documented?",
    anchor10:
      "plan.md commits to a structured error format (code + message + remediation hint); error catalogue exists or is named as a deliverable; each failure mode lists the message text the developer will see; an AC verifies that at least one canonical error path renders the actionable shape (not just `Error: undefined`); error vocabulary chosen for the developer reading at 2am, not for the runtime emitting"
  },
  {
    key: "docs",
    name: "docs",
    summary:
      "does the plan include doc updates? are doc gaps flagged? is the README / SDK reference / CLI --help kept in lockstep with the surface change? are examples committed (runnable, not pseudo-code)?",
    anchor10:
      "plan.md names every doc surface to update (README sections, SDK reference, CLI --help text, OpenAPI spec, changelog entry); examples committed alongside code (not deferred); doc AC verifies the doc + code stay in sync (e.g. doctest, snippet runner, schema diff); doc tone matches the persona (YC founder skimming vs platform engineer evaluating)"
  },
  {
    key: "upgrade-path",
    name: "upgrade path",
    summary:
      "if the change is breaking, is migration documented? is a codemod considered? is the deprecation window named? do users get a migration guide rather than `BREAKING:` in the changelog and nothing else?",
    anchor10:
      "plan.md classifies the change explicitly (additive / backward-compatible / breaking); for breaking: migration guide section named as a deliverable, codemod considered (cite the codemod tool if the language has one — jscodeshift, ts-morph, ruff — or explicitly document why not), deprecation window named (one major / two minors / etc.), warning emitted before removal; an AC verifies the migration guide example runs against the old → new shape"
  },
  {
    key: "measurement",
    name: "measurement",
    summary:
      "does the plan instrument usage to inform future iterations? are telemetry / logging / structured-event hooks named? can a future product call answer 'how many developers hit this code path' / 'where do they drop off' / 'which errors fire most'?",
    anchor10:
      "plan.md commits to one of: structured event emission (analytics SDK / custom logger), opt-in telemetry with clear privacy boundary, exposed metrics endpoint (Prometheus / OTLP), or explicit `## Not measuring (and why)` block if telemetry is structurally out of scope; an AC verifies the events fire at the named code paths; the events are named in vocabulary a future product call can group by (e.g. `sdk.client.init.success` not `event_42`)"
  }
] as const;

/**
 * Render the six-dimension rubric table as the exact markdown the
 * plan-critic prompt (on `rubricMode: "devex"` dispatches) embeds.
 * Three columns: dimension name, "what it covers", "what a 10 looks like".
 * The leading header + separator are emitted so the consumer can drop
 * the result into the prompt body verbatim.
 *
 * The function takes NO arguments — the dimensions are immutable. Any
 * future consumer can render the same table without drifting.
 */
export function renderDevexQualityRubricTable(): string {
  const header =
    "| dimension | what it covers | what a 10 looks like |\n| --- | --- | --- |";
  const rows = DEVEX_QUALITY_DIMENSIONS.map(
    (d) => `| **${d.name}** | ${d.summary} | ${d.anchor10} |`
  ).join("\n");
  return `${header}\n${rows}`;
}

/**
 * Canonical AI-slop signals for the DevEx surface. Mirrors the
 * `DESIGN_QUALITY_AI_SLOP_SIGNALS` shape: when ≥2 signals fire on the
 * same plan, plan-critic (on `rubricMode: "devex"` dispatches)
 * emits a single umbrella `DX-N` finding rather than per-signal noise.
 * The signals are intentionally concrete (developer-experience clichés
 * that ship without thought), not vague (good docs / bad docs).
 */
export const DEVEX_QUALITY_AI_SLOP_SIGNALS: readonly string[] = [
  "method names that read like marketing (e.g. `client.smartFetch()`, `api.executeIntelligently()`) — the developer cannot predict what the call does from the name alone",
  "error messages that wrap the underlying exception without translation (`Error: undefined`, `failed to do thing: failed to do thing`) — no remediation hint, no error code, no anchor for the developer to grep",
  "docs that list every parameter but never show a working call — reference without an example, or one example that requires three undocumented prerequisites",
  "breaking changes shipped with `BREAKING:` in the changelog and nothing else — no migration guide, no codemod, no deprecation window, no warning emitted before removal",
  "telemetry stubs named `event_42` / `metric_a` / `untitled_counter` — the data is captured but the future product call cannot group on it because nobody knows what it means",
  "first-run flow that assumes the reader already has the SDK installed, the API key provisioned, the runtime upgraded — TTHW is implicitly measured in days, not minutes, but the plan calls it a quickstart"
] as const;

/**
 * Render the AI-slop checklist as the exact markdown the plan-devex
 * prompt embeds. Bulleted list, one signal per line, in declaration
 * order. Wrapping intro lives in the consumer prompt.
 */
export function renderDevexQualityAiSlopChecklist(): string {
  return DEVEX_QUALITY_AI_SLOP_SIGNALS.map((s) => `- ${s}`).join("\n");
}
