# cclaw evals

Eval-driven prompt engineering for cclaw. Skill and prompt changes land with a
measured score delta rather than subjective review.

## Status

| Step | Version | Status | What it adds |
| --- | --- | --- | --- |
| 0 | 0.22.0 | shipped | `cclaw eval` CLI, directory scaffold, config loader, corpus loader, report writer |
| 1 | 0.23.0 | shipped | Structural verifier, baselines, 24-case seed corpus, PR-blocking CI gate |
| 2 | 0.24.0 | shipped | Rule-based verifiers (keywords, regex, counts, uniqueness) + cross-stage traceability, 40-case corpus |
| 3 | 0.25.0 | shipped | LLM judge + single-shot agent (now `fixture` mode with `--judge`), cost guard, nightly CI |
| 4 | 0.26.0 | shipped | Agent mode: multi-turn AUT with sandbox-confined tools (read/write/glob/grep) |
| 5 | 0.27.0 | shipped | Workflow mode: multi-stage run, cross-artifact consistency, `cclaw eval diff`, release CI |
| 6 | 0.28.0 | shipped | Mode rename (`fixture/agent/workflow`), progress logger, `--background` + `runs`, `--compare-model`, `--max-cost-usd`, signed baselines |

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
defaultMode: fixture  # fixture | agent | workflow (legacy defaultTier: A|B|C still works)
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
| `CCLAW_EVAL_MODE` | Default mode (`fixture` / `agent` / `workflow`) when `--mode` is not supplied. |
| `CCLAW_EVAL_TIER` | Deprecated alias for `CCLAW_EVAL_MODE` (A=fixture, B=agent, C=workflow). |
| `CCLAW_EVAL_DAILY_USD_CAP` | Enable hard-stop on estimated daily spend (persisted per UTC day). Unset = no cap. |
| `CCLAW_EVAL_MAX_COST_USD` | Per-run in-memory USD cap; independent from the daily cap. |
| `CCLAW_EVAL_TIMEOUT_MS` | Per-call timeout in milliseconds. |
| `CCLAW_EVAL_MAX_RETRIES` | Retry budget on transient API errors. |
| `CCLAW_EVAL_JUDGE_SAMPLES` | Number of samples the LLM judge aggregates per artifact. Must be odd (default: `3`). |
| `CCLAW_EVAL_JUDGE_TEMPERATURE` | Sampling temperature for the judge call. Default `0.3`. |
| `CCLAW_EVAL_AGENT_TEMPERATURE` | Sampling temperature for single-shot / agent-mode runs. Default `0.2`. |
| `CCLAW_EVAL_TOOL_MAX_TURNS` | Agent-mode turn cap for the with-tools loop. Default `8`. |
| `CCLAW_EVAL_TOOL_MAX_ARG_BYTES` | Max bytes accepted for a single tool-call arguments payload. Default `65536`. |
| `CCLAW_EVAL_TOOL_MAX_RESULT_BYTES` | Max bytes returned to the model per tool call (truncated with marker). Default `32768`. |
| `CCLAW_EVAL_WORKFLOW_MAX_TOTAL_TURNS` | Workflow-mode ceiling on total turns across every stage in one workflow case. Default `40`. |

Example local setup (z.ai GLM):

```bash
export CCLAW_EVAL_API_KEY="sk-..."
cclaw eval --dry-run      # prints `apiKey: set`
```

## CLI

```text
cclaw eval [flags]
  --stage=<id>           Limit to one flow stage (brainstorm|scope|design|spec|plan|tdd|review|ship).
  --mode=<fixture|agent|workflow>
                         fixture  = verify existing artifacts (structural / rules / judge).
                         agent    = LLM drafts one stage's artifact in a sandbox with tools.
                         workflow = LLM runs the full multi-stage flow.
  --tier=<A|B|C>         Deprecated alias for --mode (A=fixture, B=agent, C=workflow).
  --schema-only          Structural verifiers only (sections / forbidden / lengths / frontmatter).
  --rules                Structural + rule verifiers (keywords, regex, counts, uniqueness) + traceability.
  --judge                Include the LLM judge (median-of-N rubric scoring; requires CCLAW_EVAL_API_KEY).
  --dry-run              Validate config + corpus, print summary, do not execute.
  --json                 Emit machine-readable JSON on stdout.
  --no-write             Skip writing the report to .cclaw/evals/reports/.
  --update-baseline      Overwrite baselines from the current (passing) run.
  --confirm              Acknowledge --update-baseline (prevents accidental resets).
  --quiet                Silence the stderr progress logger.
  --max-cost-usd=<n>     Abort when committed USD spend crosses <n> (per-run cap).
  --compare-model=<id>   Run the corpus twice (configured model + <id>) and diff results.
  --background           Detach the run, write output to .cclaw/evals/runs/<id>/run.log, return now.

Subcommands:
  cclaw eval diff <old> <new>                 Compare two reports; exit 1 on regression.
  cclaw eval runs                             List backgrounded runs.
  cclaw eval runs status <id|latest>          Show status for a specific run.
  cclaw eval runs tail <id|latest>            Print the run log.
```

### Observability

`cclaw eval` prints a one-line-per-case progress log to stderr by
default, e.g.:

```
[cclaw eval] start mode=workflow cases=3
[cclaw eval] [1/3] workflow-01 (plan) ...
[cclaw eval]   stage brainstorm ok in 8.2s $0.0041
[cclaw eval]   stage scope ok in 6.1s $0.0029
[cclaw eval] retry llm attempt 2/3 in 1.0s (LLM transport error.)
[cclaw eval] [1/3] workflow-01 (plan) PASS in 47.3s $0.0187
[cclaw eval] done pass=3 fail=0 total=3 in 2m18s
```

Pair with `--background` to free the terminal on long workflow-mode
runs and attach later with `cclaw eval runs tail latest`.

### Signed baselines

Baselines written from v0.28.0 onward carry a sha256 digest over their
canonical `{schemaVersion, stage, cases}` block plus a `signedAt`
timestamp. `loadBaseline` verifies the digest when present and throws
`BaselineSignatureError` on mismatch, so hand-edited baselines fail
loudly instead of silently shifting the regression bar. Older baselines
(no signature) continue to load unchanged and acquire a signature the
next time they are regenerated.

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
context_files: []                         # optional; agent/workflow sandbox copy list
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

The canonical 41-case corpus used by cclaw's own CI lives under
`tests/fixtures/eval-demo/.cclaw/evals/corpus/` (24 structural + 16
rules + 1 agent-mode demo) and is the reference for authoring new cases.

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

## Agent mode (formerly "Tier B")

`--mode=agent` runs a multi-turn AUT for a single stage. The runner:

1. Provisions a per-case sandbox at `os.tmpdir()/cclaw-eval-<uuid>/`.
2. Copies every path listed in `context_files` into the sandbox
   (subdirectories preserved). Entries must resolve inside the
   project root.
3. Loads the stage `SKILL.md` as the system prompt (same contract as
   fixture mode with `--judge`).
4. Runs up to `toolMaxTurns` chat turns with OpenAI-style
   function-calling. Each tool call:
   - resolves its path inside the sandbox (absolute paths, `..`,
     symlink escapes, and NUL bytes are rejected),
   - enforces `toolMaxArgumentsBytes` on the arguments payload, and
   - truncates results at `toolMaxResultBytes` with a visible
     cutoff marker.
5. Disposes the sandbox in a `finally` so CI never leaks temp dirs.

Built-in tools (OpenAI function schema):

- `read_file(path, offset?, limit?)` — UTF-8 text read, 1-indexed line
  slicing.
- `write_file(path, content)` — writes UTF-8, creates parents.
- `glob(pattern)` — `**`/`*`/`?` globbing over the sandbox, results
  capped at 500.
- `grep(pattern, caseInsensitive?, maxMatches?)` — JS-regex line
  search with a hard 500-match ceiling.

Artifact resolution prefers a sandbox file (`artifact.md`,
`artifact.txt`, `ARTIFACT.md`) if the model writes one; otherwise the
terminal assistant message is the artifact.

Agent-mode cases look identical to fixture-mode cases plus a
`context_files` list:

```yaml
id: spec-06-tier-b-demo
stage: spec
input_prompt: |
  Read the seeded README.md and produce a one-paragraph spec with one
  acceptance criterion.
context_files:
  - README.md
expected:
  judge:
    required_checks:
      - acceptance-criteria-coverage
```

Exit criteria (met for v0.26.0):

- `runWithTools` returns a `ToolUseSummary` (turns, calls, errors,
  deniedPaths, per-tool counts) surfaced in reports.
- Sandbox cleanup asserted by unit test (no leftover dirs).
- Escape attempts (`../etc/passwd`, `/etc/passwd`, symlink jumps) are
  refused and recorded in `deniedPaths`.
- `MaxTurnsExceededError` aborts the case cleanly.

## Workflow mode (formerly "Tier C")

`--mode=workflow` chains the agent-mode with-tools loop across a sequence of stages
(`brainstorm → scope → design → spec → plan`, any non-empty subset is
allowed) so a single eval case simulates the full early-lifecycle arc.
Runs live under `.cclaw/evals/corpus/workflows/*.yaml`, not per-stage
directories.

The orchestrator (`src/eval/agents/workflow.ts`):

1. Creates one sandbox for the whole case and seeds `context_files`.
2. For each stage, clears leftover `artifact.md` candidates, calls
   `runWithTools({ externalSandbox, promptPreamble })`, and persists the
   produced artifact to `stages/<stage>.md` inside the sandbox. Later
   stages read those files with the existing `read_file` tool, so the
   contract matches what an IDE agent would see.
3. Surfaces a `WorkflowRunSummary` on `EvalCaseResult` with per-stage
   durations, turns, tool calls, token usage, cost, and (when `--judge`
   is set) the rubric medians.
4. Disposes the sandbox in a `finally` so temp dirs never leak.

Cross-artifact consistency checks run after all stages complete
(`src/eval/verifiers/workflow-consistency.ts`):

- `ids_flow` — every match of `id_pattern` in the `from` stage must
  appear in each `to` stage. Typical entry: `{ id_pattern: "D-\\d+",
  from: scope, to: [design, plan] }`.
- `placeholder_free` — none of the listed phrases (default `TBD`,
  `TODO`, `placeholder`, case-insensitive) may appear in the named
  stages.
- `no_contradictions` — if `must` appears in the anchor stage, `forbid`
  must NOT appear in any listed `stages`. Vacuously satisfied when the
  anchor itself is absent.

A workflow-mode case YAML mirrors the single-stage shape but declares a
`stages` array and an optional `consistency` block:

```yaml
id: workflow-01-feature-addition
description: Dark mode toggle end-to-end.
stages:
  - name: brainstorm
    input_prompt: |
      Explore dark mode directions and recommend one.
  - name: scope
    input_prompt: |
      Read stages/brainstorm.md and produce decisions D-01..D-0N.
  - name: plan
    input_prompt: |
      Read every prior stages/*.md and plan with every D-XX referenced.
consistency:
  ids_flow:
    - id_pattern: "D-\\d+"
      from: scope
      to: [plan]
  placeholder_free:
    stages: [brainstorm, scope, plan]
  no_contradictions:
    - stage: scope
      must: "theme storage: localStorage"
      forbid: "theme storage: server"
      stages: [plan]
```

Run the full workflow corpus with judge rubrics attached:

```bash
cclaw eval --mode=workflow --judge
```

Use `CCLAW_EVAL_WORKFLOW_MAX_TOTAL_TURNS` (or `workflowMaxTotalTurns` in
`config.yaml`) to cap the total turns a workflow may consume across
all stages — useful when a long chain risks draining the daily spend
cap.

### Comparing runs (`cclaw eval diff`)

`cclaw eval diff <old> <new>` renders a side-by-side summary of two
report JSON files under `.cclaw/evals/reports/`. Each selector may be:

- a `cclawVersion` string (e.g. `0.26.0`) — matched against the
  `cclawVersion` field in any report,
- a filename relative to `.cclaw/evals/reports/`, or
- the literal `latest` — the most recent report by mtime.

The diff prints summary deltas, per-case pass/fail transitions,
verifier score drops, and (for workflow mode) stage-level duration and
cost deltas. Exit code is `1` whenever any case regressed or any
verifier dropped; `0` when the diff is clean. Add `--json` to get the
structured payload for downstream automation.

Exit criteria (met for v0.27.0):

- `runWorkflow` threads artifacts via the shared sandbox and unit tests
  assert both stage chaining and error propagation.
- Consistency verifier emits deterministic per-rule verifier results
  with stable ids.
- `cclaw eval --mode=workflow` produces a `WorkflowRunSummary` on each
  case with per-stage metrics; `cclaw eval diff` exits non-zero on
  regressions.

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

Three workflows share the corpus under `tests/fixtures/eval-demo/`:

| Workflow | Triggers | Verifiers | Needs secrets | Gates PRs |
| --- | --- | --- | --- | --- |
| `evals-structural.yml` | `pull_request`, `workflow_dispatch` | Structural + rules + traceability | No | Yes |
| `evals-nightly.yml` | `schedule` (03:17 UTC), `workflow_dispatch` | Structural + rules + judge (fixture mode) | `CCLAW_EVAL_API_KEY`, `CCLAW_EVAL_BASE_URL` | No (advisory) |
| `evals-release.yml` | `push` to `v*` tag, `workflow_dispatch` | Workflow mode + judge + consistency | `CCLAW_EVAL_API_KEY`, `CCLAW_EVAL_BASE_URL` | No (advisory) |

The nightly and release workflows skip automatically when the API-key
secret is not configured — safe default for forks and during rollout.
The release workflow additionally appends the generated Markdown report
to the matching GitHub Release body so reviewers can skim per-stage
cost, duration, and consistency results alongside the auto-drafted
notes. Reports and the daily spend ledger are uploaded as workflow
artifacts with a 30–90 day retention.

## Architecture

- **Agent-under-test (AUT)** — consumes the stage skill and produces an artifact. Three modes: `fixture` (verify existing), `agent` (draft one stage), `workflow` (run the full chain).
- **Judge** — LLM judge step; evaluates an artifact against a rubric. Structured JSON output, median-of-3.
- **Verifiers** — five kinds: `structural`, `rules`, `judge`, `workflow`, `consistency`. Cheaper verifiers run first and can short-circuit expensive ones; `consistency` runs only in workflow mode and is deterministic.
- **Sandbox** — used from agent mode onward. Every case runs in `os.tmpdir()/cclaw-eval-<uuid>/` with tool access limited to that path.
- **LLM client** — official `openai` npm package pointed at any OpenAI-compatible `baseURL`. Exposes an `onRetry` observer so the progress logger can surface backoff sleeps in real time.

## Security & cost

- No secrets committed; API key reads from env.
- `dailyUsdCap` is opt-in. When set, the runner aborts once estimated spend crosses the threshold.
- `reports/` is gitignored; everything else under `.cclaw/evals/` is tracked so teams share corpus, rubrics, baselines, and config.

## Deferred

Running the actual IDE harnesses (claude-code / cursor-agent) against
GLM-class models through a proxy is a separate design problem and is not part
of the eval CLI today.
