# cclaw evals

Eval-driven prompt engineering for cclaw. Skill and prompt changes land with a
measured score delta rather than subjective review. See
[`docs/roadmap.md`](./roadmap.md) Phase 7 for the rollout plan.

## Status

| Step | Version | Status | What it adds |
| --- | --- | --- | --- |
| 0 | 0.22.0 | shipped | `cclaw eval` CLI, directory scaffold, config loader, corpus loader, report writer |
| 1 | 0.23.0 | shipped | Structural verifier, baselines, 24-case seed corpus, PR-blocking CI gate |
| 2 | 0.24.0 | shipped | Rule-based verifiers (keywords, regex, counts, uniqueness) + cross-stage traceability, 40-case corpus |
| 3 | 0.25.0 | shipped | LLM judge + Tier A single-shot, cost guard, nightly CI |
| 4 | 0.26.0 | planned | Tier B agent with tools + sandbox |
| 5 | 0.27.0 | planned | Tier C multi-stage workflow + release CI |
| 6 | 0.28.0 | planned | HTML reports, cross-model diff, polish |

## Quickstart

After `cclaw init`, the following tree is materialized:

```
.cclaw/evals/
├── config.yaml         # provider, model, thresholds (user-owned)
├── corpus/             # eval cases per stage (user-owned)
├── rubrics/            # LLM judge rubrics (user-owned, LLM step onward)
├── baselines/          # frozen scores for regression gates (user-owned)
└── reports/            # generated reports (gitignored)
```

Verify the install without any API calls:

```bash
cclaw eval --dry-run
```

Output shows the resolved config, provenance (`default` / `file` / `env` /
`file+env`), whether an API key is set, corpus counts per stage, and which
verifier families are available at the current cclaw version.

## Configuration

### File: `.cclaw/evals/config.yaml`

Default values come from `src/eval/config-loader.ts`. Any top-level key can be
omitted; defaults apply. Unknown keys are rejected.

```yaml
provider: zai
baseUrl: https://api.z.ai/api/coding/paas/v4
model: glm-5.1
defaultTier: A        # A | B | C
timeoutMs: 120000
maxRetries: 2
# dailyUsdCap: 5      # optional hard cap; unset = no cap
regression:
  failIfDeltaBelow: -0.15
  failIfCriticalBelow: 3.0
```

### Environment variables

Env vars override both defaults and `config.yaml`. Secrets never live in the
repo — only `CCLAW_EVAL_API_KEY` is supplied this way.

| Variable | Effect |
| --- | --- |
| `CCLAW_EVAL_API_KEY` | Authentication for the OpenAI-compatible endpoint. Required once the LLM judge step ships. |
| `CCLAW_EVAL_BASE_URL` | Override `baseUrl`. |
| `CCLAW_EVAL_MODEL` | Override `model` (used by both agent-under-test and judge unless `judgeModel` is set). |
| `CCLAW_EVAL_JUDGE_MODEL` | Override `judgeModel` for cross-model judging. |
| `CCLAW_EVAL_PROVIDER` | Override the free-form `provider` label shown in reports. |
| `CCLAW_EVAL_TIER` | Default tier (A/B/C) when `--tier` is not supplied. |
| `CCLAW_EVAL_DAILY_USD_CAP` | Enable hard-stop on estimated daily spend. Unset = no cap. |
| `CCLAW_EVAL_TIMEOUT_MS` | Per-call timeout in milliseconds. |
| `CCLAW_EVAL_MAX_RETRIES` | Retry budget on transient API errors. |
| `CCLAW_EVAL_JUDGE_SAMPLES` | Number of samples the LLM judge aggregates per artifact. Must be odd (default: `3`). |
| `CCLAW_EVAL_JUDGE_TEMPERATURE` | Sampling temperature for the judge call. Default `0.3`. |
| `CCLAW_EVAL_AGENT_TEMPERATURE` | Sampling temperature for Tier A single-shot agent runs. Default `0.2`. |

Example local setup (z.ai GLM):

```bash
export CCLAW_EVAL_API_KEY="sk-..."
cclaw eval --dry-run      # prints `apiKey: set`
```

## CLI

```text
cclaw eval [flags]
  --stage=<id>         Limit to one flow stage (brainstorm|scope|design|spec|plan|tdd|review|ship).
  --tier=<A|B|C>       Fidelity tier. A=single-shot, B=tools, C=workflow.
  --schema-only        Structural verifiers only (sections / forbidden / lengths / frontmatter).
  --rules              Structural + rule verifiers (keywords, regex, counts, uniqueness) + cross-stage traceability.
  --judge              Include the LLM judge (median-of-N rubric scoring; requires CCLAW_EVAL_API_KEY).
  --dry-run            Validate config + corpus, print summary, do not execute.
  --json               Emit machine-readable JSON on stdout.
  --no-write           Skip writing the report to .cclaw/evals/reports/.
  --update-baseline    Overwrite baselines from the current (passing) run.
  --confirm            Acknowledge --update-baseline (prevents accidental resets).
```

Exit codes:

- `0` — success (dry-run, or every case passed and no baseline regression)
- `1` — one or more cases failed, or any baseline-tracked verifier regressed
- other — propagated from the usual cclaw error paths

Baseline workflow:

1. After intentional structural changes, run
   `cclaw eval --schema-only --update-baseline --confirm`.
2. Review the diff of `.cclaw/evals/baselines/<stage>.json` in git.
3. Commit the baseline update in the same PR as the prompt/skill change.
4. Subsequent PRs compare against the committed baselines; any verifier
   that flipped from `ok:true` to `ok:false` triggers a critical failure
   and exit code 1.

## Corpus schema

One file per case: `.cclaw/evals/corpus/<stage>/<id>.yaml`. An optional
`fixture.md` alongside the case provides a pre-generated artifact the
structural verifier runs against before the live agent loop ships.

```yaml
id: brainstorm-01
stage: brainstorm
input_prompt: |
  One short paragraph describing the user's task.
context_files: []                         # optional; Tier B/C sandbox copy list
fixture: ./brainstorm-01/fixture.md       # artifact under test
expected:
  structural:
    required_sections:                    # case-insensitive, match any heading level
      - Directions
      - Recommendation
    forbidden_patterns:                   # case-insensitive substring check
      - TBD
      - TODO
      - placeholder
    required_frontmatter_keys:            # keys expected in leading YAML frontmatter
      - stage
      - author
      - created_at
    min_lines: 8
    max_lines: 120
    # min_chars: 200
    # max_chars: 6000
```

The canonical 40-case corpus used by cclaw's own CI lives under
`tests/fixtures/eval-demo/.cclaw/evals/corpus/` and is the reference for
authoring new cases.

### Rule-based expectations (`expected.rules`)

Zero-LLM content checks that run with `cclaw eval --rules`. Every field
is optional; omit the section entirely if the case has none. Matching is
run against the artifact body (frontmatter is stripped before
evaluation).

```yaml
expected:
  rules:
    must_contain:                        # plain-substring, case-sensitive
      - "tailwind"
      - "RSC"
    must_not_contain:                    # fail if any appears
      - "lorem ipsum"
    regex_required:
      - pattern: "\\bD-\\d+\\b"          # at least one match required
        flags: g
        description: "Decision IDs are present"
    regex_forbidden:
      - pattern: "\\bTODO\\b"
        flags: i
        description: "No TODO markers"
    min_occurrences:                     # phrase: >=N occurrences
      "acceptance criteria": 1
    max_occurrences:                     # phrase: <=N occurrences
      "we think": 0
    unique_bullets_in_section:           # list items must be unique under
      - Decisions                        # the given H2/H3 headings (case-insensitive)
      - Non-Goals
```

Each rule emits a verifier result with a granular id, e.g.:

- `rules:contains:tailwind` / `rules:not-contains:lorem-ipsum`
- `rules:regex-required:d-xx` / `rules:regex-forbidden:todo`
- `rules:min-occurrences:acceptance-criteria`
- `rules:max-occurrences:we-think`
- `rules:unique-in-section:decisions`

### Traceability expectations (`expected.traceability`)

Asserts that identifiers extracted from a `source` artifact propagate
into downstream artifacts (`require_in`). Typical use: `scope` decisions
(`D-01`, `D-02`, ...) must appear in both `plan` and `tdd`.

```yaml
id: plan-01-dark-mode
stage: plan
fixture: ./plan-01-dark-mode/fixture.md
extra_fixtures:
  scope: ../../scope/scope-01-dark-mode/fixture.md
  tdd: ../../tdd/tdd-01-dark-mode/fixture.md
expected:
  traceability:
    id_pattern: "\\bD-\\d+\\b"   # regex defining a traceable id
    id_flags: g
    source: scope                # "self" or any key under extra_fixtures
    require_in:                  # every id from source must appear in each target
      - self                     # the primary fixture (the case under test)
      - tdd
```

- `source: self` is valid — extract ids from the primary artifact and
  check they appear in the targets (e.g. a `review` fixture must cite
  every `T-XX` it introduces).
- Each target emits its own verifier result:
  `traceability:scope->self`, `traceability:scope->tdd`, etc.
- Missing or unreadable `extra_fixtures` fail the case with a structured
  error rather than a silent pass.

### Per-case judge expectations (`expected.judge`)

Optional hints the judge consults when scoring a specific case. All
fields are optional.

```yaml
expected:
  judge:
    rubric: brainstorm            # override the default stage rubric
    samples: 5                    # override global judgeSamples for this case
    required_checks:              # fail the case if the rubric drops these ids
      - distinctness
      - recommendation-clarity
    minimum_scores:               # per-check floor below which the case fails
      distinctness: 4
      recommendation-clarity: 4
```

## Rubrics

Each stage owns a rubric at `.cclaw/evals/rubrics/<stage>.yaml`.
`cclaw init` seeds a starter rubric for every flow stage; `cclaw sync`
preserves user edits and only writes files that are missing.

```yaml
stage: brainstorm
checks:
  - id: distinctness
    prompt: "Are the proposed directions genuinely distinct (not rephrasings)?"
    scale: "1-5 where 5=fully distinct approaches"
    weight: 1.0
    critical: true       # any sample scoring <= 2 fails the case
    minimumScore: 3      # per-check floor; median must be >= this
```

Schema:

- `stage` — required, must match the directory name.
- `checks[]` — non-empty list. Each `id` is a kebab-case string that
  becomes the verifier id (`judge:<id>`).
- `prompt` — the question the judge answers; also shown in reports.
- `scale` — optional free-form hint (e.g., `"1-5 where 5=best"`).
  Regardless of the hint, the judge always returns integer scores
  `1..5` so rubric aggregation math stays stable.
- `weight` — optional, default `1.0`. Currently used for display only;
  pass/fail is decided per-check.
- `critical` — optional, default `false`. When `true`, any sample
  scoring `<= 2` fails the case even if the median passes.
- `minimumScore` — optional per-check floor. When set, the median score
  must be `>= minimumScore` for the case to pass.

### Judge output contract

The judge is asked for strict JSON of the form:

```json
{
  "scores": { "distinctness": 4, "coverage": 5 },
  "rationales": { "distinctness": "…", "coverage": "…" }
}
```

Each rubric check runs through N samples (default `judgeSamples: 3`,
must be odd). The runner:

1. Clamps each score to `[1, 5]`.
2. Drops samples that omit a check id and records `coverage`.
3. Aggregates per-check median + mean.
4. Fails the verifier if the median is below `minimumScore` or a
   `critical` check has any sample `<= 2`.

Judge scores appear as a dedicated "Judge scores" table in the
generated markdown report alongside per-check rationales from the first
sample.

## Cost guard

The optional `dailyUsdCap` (config) / `CCLAW_EVAL_DAILY_USD_CAP` (env)
hard-stops the run once the cumulative estimated USD cost for the
current UTC day would exceed the cap. The runner maintains a per-day
ledger at `.cclaw/evals/.spend-YYYY-MM-DD.json` (gitignored) so
consecutive invocations on the same day share a budget.

Pricing is resolved in order:

1. `tokenPricing[<model>]` from `config.yaml` if supplied.
2. Built-in schedule for known models (GLM 5.1 and friends).
3. Fallback schedule for unknown models (conservative upper bound).

Set `tokenPricing` to override defaults without editing source:

```yaml
tokenPricing:
  glm-5.1:
    input: 0.0005      # USD per 1K prompt tokens
    output: 0.0015     # USD per 1K completion tokens
```

## CI

Two workflows share the corpus under `tests/fixtures/eval-demo/`:

| Workflow | Triggers | Verifiers | Needs secrets | Gates PRs |
| --- | --- | --- | --- | --- |
| `evals-structural.yml` | `pull_request`, `workflow_dispatch` | Structural + rules + traceability | No | Yes |
| `evals-nightly.yml` | `schedule` (03:17 UTC), `workflow_dispatch` | Structural + rules + judge (Tier A) | `CCLAW_EVAL_API_KEY`, `CCLAW_EVAL_BASE_URL` | No (advisory) |

The nightly workflow skips automatically when the API-key secret is not
configured — safe default for forks and during rollout. Reports and the
daily spend ledger are uploaded as workflow artifacts with a 30-day
retention.

## Architecture

- **Agent-under-test (AUT)** — consumes the stage skill and produces an artifact. Three fidelity tiers.
- **Judge** — LLM judge step; evaluates an artifact against a rubric. Structured JSON output, median-of-3.
- **Verifiers** — four kinds: `structural`, `rules`, `judge`, `workflow`. Cheaper tiers run first and can short-circuit expensive ones.
- **Sandbox** — Tier B step onward. Every case runs in `os.tmpdir()/cclaw-eval-<uuid>/` with tool access limited to that path.
- **LLM client** — official `openai` npm package pointed at any OpenAI-compatible `baseURL`. Wired alongside the LLM judge step.

## Security & cost

- No secrets committed; API key reads from env.
- `dailyUsdCap` is opt-in. When set, the runner aborts once estimated spend crosses the threshold.
- `reports/` is gitignored; everything else under `.cclaw/evals/` is tracked so teams share corpus, rubrics, baselines, and config.

## Deferred to Phase 8

Running the actual IDE harnesses (claude-code / cursor-agent) against
GLM-class models through a proxy is a separate design problem; see
`docs/roadmap.md` Phase 8.
