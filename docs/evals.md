# cclaw evals

Eval-driven prompt engineering for cclaw. Skill and prompt changes land with a
measured score delta rather than subjective review. See
[`docs/roadmap.md`](./roadmap.md) Phase 7 for the rollout plan.

## Status

| Step | Version | Status | What it adds |
| --- | --- | --- | --- |
| 0 | 0.22.0 | shipped | `cclaw eval` CLI, directory scaffold, config loader, corpus loader, report writer |
| 1 | 0.23.0 | shipped | Structural verifier, baselines, 24-case seed corpus, PR-blocking CI gate |
| 2 | 0.24.0 | planned | Rule-based verifiers + traceability checks |
| 3 | 0.25.0 | planned | LLM judge + Tier A single-shot, nightly CI |
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
  --schema-only        Structural verifiers only (default).
  --rules              Structural + rule verifiers (not wired yet).
  --judge              Include LLM judging (not wired yet; requires CCLAW_EVAL_API_KEY).
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

The canonical 24-case corpus used by cclaw's own CI lives under
`tests/fixtures/eval-demo/.cclaw/evals/corpus/` and is the reference for
authoring new cases.

Rubric schema (LLM judge step onward): `.cclaw/evals/rubrics/<stage>.yaml`.

```yaml
stage: brainstorm
checks:
  - id: distinctness
    prompt: "Are the proposed directions genuinely distinct (not rephrasings)?"
    scale: "1-5 where 5=fully distinct approaches"
    weight: 1.0
```

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
