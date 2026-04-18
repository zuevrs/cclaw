/**
 * Static scaffold for `.cclaw/evals/`. Written on `cclaw init` and refreshed
 * on `cclaw sync` only if the files are missing (user content wins). The
 * scaffold is intentionally minimal: a usable default config plus short
 * READMEs that point at `docs/evals.md` for authoring guidance.
 */

export const EVAL_CONFIG_YAML = `# cclaw eval config
# See docs/evals.md for the full schema and rollout plan.
#
# All values can be overridden at runtime with CCLAW_EVAL_* environment
# variables (env wins). Secrets like CCLAW_EVAL_API_KEY never live here.
provider: zai
baseUrl: https://api.z.ai/api/coding/paas/v4
model: glm-5.1

# Default fidelity tier when --tier is not supplied.
#   A = single-shot API call (cheap)
#   B = SDK with tool use     (realistic)
#   C = multi-stage workflow  (end-to-end)
defaultTier: A

# Per-call timeout and retry budget.
timeoutMs: 120000
maxRetries: 2

# Optional hard-stop on estimated USD spend per day. Leave unset for no cap.
# dailyUsdCap: 5

# Regression thresholds used by CI.
regression:
  # Fail when overall score drops by more than this fraction (e.g. -0.15 = 15%).
  failIfDeltaBelow: -0.15
  # Fail when any single critical rubric drops below this absolute score.
  failIfCriticalBelow: 3.0
`;

export const EVAL_CORPUS_README = `# Eval Corpus

Seed cases live in \`./<stage>/<id>.yaml\`, one file per case.
See \`docs/evals.md\` for the schema.

Minimal shape:

\`\`\`yaml
id: brainstorm-01
stage: brainstorm
input_prompt: |
  One short paragraph describing the user's task.
context_files: []
expected:
  # verifier-specific hints; optional
\`\`\`

Start with 3 structural cases per stage (24 total), then expand to 5 per
stage (40 total) once rule verifiers land. Tier B/C runs may add
\`context_files\` pulled from real projects to exercise the sandbox.
`;

export const EVAL_RUBRICS_README = `# Eval Rubrics

LLM-judge rubrics. Each rubric is a short list of checks scored on a
\`1–5\` scale with a rationale:

\`\`\`yaml
stage: brainstorm
checks:
  - id: distinctness
    prompt: "Are the proposed directions genuinely distinct (not rephrasings)?"
    scale: "1-5 where 5=fully distinct approaches"
    weight: 1.0
\`\`\`

Rubric authoring happens when Tier A runs start producing artifacts, so we
score the *right* properties rather than retrofitting generic quality checks.
See \`docs/evals.md\` for the full schema.
`;

export const EVAL_BASELINES_README = `# Eval Baselines

Frozen score snapshots used by regression gates. Baselines are committed to
git and updated explicitly via \`cclaw eval --update-baseline --confirm\`.

Each baseline file is a JSON document keyed by stage and case id. Do not edit
by hand; CI will flag baseline churn.
`;

export const EVAL_REPORTS_README = `# Eval Reports

Generated reports (JSON + Markdown) land here. This directory is gitignored.
Run \`cclaw eval --dry-run\` to preview configuration without producing a
report.
`;
