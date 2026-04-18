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
\`1–5\` scale with a rationale. The runner picks \`<stage>.yaml\` when
\`cclaw eval --judge\` is invoked; every stage ships a starter rubric
below — edit the checks to match what your team cares about, and add
\`critical: true\` to the checks that should hard-fail nightly CI on
regression.

\`\`\`yaml
stage: brainstorm
checks:
  - id: distinctness
    prompt: "Are the proposed directions genuinely distinct (not rephrasings)?"
    scale: "1-5 where 5=fully distinct approaches"
    weight: 1.0
    critical: false
\`\`\`

See \`docs/evals.md\` for the full schema.
`;

interface StarterRubric {
  stage: string;
  checks: Array<{
    id: string;
    prompt: string;
    scale?: string;
    weight?: number;
    critical?: boolean;
  }>;
}

const STARTER_RUBRICS: StarterRubric[] = [
  {
    stage: "brainstorm",
    checks: [
      {
        id: "distinctness",
        prompt:
          "Are the proposed directions genuinely distinct (different approaches, not rephrasings of one idea)?",
        scale: "1-5 where 5 = every direction uses a materially different approach",
        weight: 1.0,
        critical: true
      },
      {
        id: "coverage",
        prompt:
          "Do the directions cover the problem space (at least one tackling cost, one velocity, one risk)?",
        scale: "1-5 where 5 = each major trade-off dimension has a direction",
        weight: 1.0
      },
      {
        id: "actionability",
        prompt:
          "Could a reader pick one direction and start a scope doc tomorrow without asking clarifying questions?",
        scale: "1-5 where 5 = every direction is concrete enough to scope immediately",
        weight: 1.0
      },
      {
        id: "recommendation-clarity",
        prompt:
          "Is the Recommendation section explicit, single-voiced, and consistent with the highest-ranked direction?",
        scale: "1-5 where 5 = recommendation names the chosen direction and the decisive trade-off",
        weight: 1.0,
        critical: true
      }
    ]
  },
  {
    stage: "scope",
    checks: [
      {
        id: "problem-statement",
        prompt:
          "Is the problem statement anchored on user/system behavior (not on a proposed solution)?",
        scale: "1-5 where 5 = problem is described independently of any implementation choice",
        weight: 1.0,
        critical: true
      },
      {
        id: "non-goals",
        prompt:
          "Are non-goals explicit and mutually-exclusive with the goals (no overlap, no vague 'we might' entries)?",
        scale: "1-5 where 5 = every non-goal is a crisp decision a future reader can defend",
        weight: 1.0
      },
      {
        id: "decision-ids",
        prompt:
          "Does the Decisions section use stable D-NN ids and name who (or what) owns each decision?",
        scale: "1-5 where 5 = every decision has a D-NN id and an explicit owner",
        weight: 1.0,
        critical: true
      },
      {
        id: "risks",
        prompt:
          "Are risks concrete (named system, threshold, or scenario) rather than generic hedges?",
        scale: "1-5 where 5 = each risk is testable by observing a specific signal",
        weight: 0.8
      }
    ]
  },
  {
    stage: "design",
    checks: [
      {
        id: "decision-trace",
        prompt:
          "Does the design doc restate every scope D-NN that drives the architecture, and call out the ones it rejects?",
        scale: "1-5 where 5 = full D-NN trace with explicit kept/rejected markers",
        weight: 1.0,
        critical: true
      },
      {
        id: "diagram-or-flow",
        prompt:
          "Is there at least one diagram or clearly labeled flow section that shows data and control moving across the system?",
        scale: "1-5 where 5 = diagram covers read path, write path, and failure path",
        weight: 1.0
      },
      {
        id: "alternatives-considered",
        prompt:
          "Are concrete alternatives considered with explicit trade-offs (cost, complexity, latency)?",
        scale: "1-5 where 5 = at least two alternatives are rejected with reasons tied to measurable properties",
        weight: 0.8
      },
      {
        id: "interface-stability",
        prompt:
          "Are public interfaces (APIs, queues, tables) named, typed, and marked as SEMVER-stable or experimental?",
        scale: "1-5 where 5 = every interface has a name, a type/shape, and a stability tag",
        weight: 1.0
      }
    ]
  },
  {
    stage: "spec",
    checks: [
      {
        id: "acceptance-criteria",
        prompt:
          "Does the spec have explicit Acceptance Criteria bullets that are unambiguously verifiable?",
        scale: "1-5 where 5 = each AC states an observable condition with clear pass/fail",
        weight: 1.0,
        critical: true
      },
      {
        id: "edge-cases",
        prompt:
          "Are failure modes and edge cases enumerated (empty input, concurrent writers, partial outage)?",
        scale: "1-5 where 5 = at least three distinct edge cases with expected behavior",
        weight: 1.0
      },
      {
        id: "test-plan-hooks",
        prompt:
          "Does the spec name the test surfaces (unit, integration, e2e, synthetic probe) that will validate each AC?",
        scale: "1-5 where 5 = every AC maps to at least one test surface",
        weight: 1.0
      },
      {
        id: "traceability",
        prompt:
          "Does the spec cite the originating scope decisions (D-NN) and design sections so future engineers can trace back?",
        scale: "1-5 where 5 = every material choice links to a D-NN or design heading",
        weight: 0.8,
        critical: true
      }
    ]
  },
  {
    stage: "plan",
    checks: [
      {
        id: "task-granularity",
        prompt:
          "Are tasks sized so one engineer can land each in a single PR (<1 day of work)?",
        scale: "1-5 where 5 = every T-NN fits in a single reviewable PR",
        weight: 1.0,
        critical: true
      },
      {
        id: "tdd-loop",
        prompt:
          "Does each task have explicit RED/GREEN/REFACTOR expectations or an equivalent TDD-compatible exit condition?",
        scale: "1-5 where 5 = every task says what test fails first and what code makes it pass",
        weight: 1.0,
        critical: true
      },
      {
        id: "dependency-graph",
        prompt:
          "Is the dependency order between tasks explicit (and minimal), so parallelizable work is called out?",
        scale: "1-5 where 5 = every task lists its blockers and independent tasks are marked parallelizable",
        weight: 0.8
      },
      {
        id: "scope-traceability",
        prompt:
          "Does the plan reference the scope D-NN ids that drive each task, and does coverage leave no decision orphaned?",
        scale: "1-5 where 5 = every D-NN appears in at least one task and every task names its D-NN",
        weight: 1.0
      }
    ]
  },
  {
    stage: "tdd",
    checks: [
      {
        id: "red-first",
        prompt:
          "Does the artifact show a failing test (RED) before the implementation change (GREEN)?",
        scale: "1-5 where 5 = RED command output is quoted and the fix lands after",
        weight: 1.0,
        critical: true
      },
      {
        id: "refactor-evidence",
        prompt:
          "Is there a REFACTOR step with a diff or named improvement (not just passing tests)?",
        scale: "1-5 where 5 = REFACTOR names a specific code-quality win and cites the affected file(s)",
        weight: 0.8
      },
      {
        id: "gate-evidence",
        prompt:
          "Does the artifact quote the output of the required gates (lint, typecheck, tests) after the change?",
        scale: "1-5 where 5 = every gate command is reproduced with its exit status",
        weight: 1.0,
        critical: true
      },
      {
        id: "learnings",
        prompt:
          "Does the artifact capture at least one durable learning (pattern, pitfall, follow-up) for future runs?",
        scale: "1-5 where 5 = learning is specific, filed under knowledge.jsonl or an equivalent store",
        weight: 0.6
      }
    ]
  },
  {
    stage: "review",
    checks: [
      {
        id: "two-layer-structure",
        prompt:
          "Does the review show both layers (automated gates + human judgment) with distinct evidence?",
        scale: "1-5 where 5 = Layer 1 cites tool outputs, Layer 2 cites reviewer reasoning",
        weight: 1.0,
        critical: true
      },
      {
        id: "blocker-severity",
        prompt:
          "Are issues classified by severity (blocker / major / minor) with one-line rationales?",
        scale: "1-5 where 5 = every finding names severity + consequence if not fixed",
        weight: 1.0
      },
      {
        id: "security-posture",
        prompt:
          "Does the review cover security-relevant areas explicitly (secrets, authz, PII, deps)?",
        scale: "1-5 where 5 = each security dimension is addressed (with 'n/a' counted as a deliberate pass)",
        weight: 0.8,
        critical: true
      },
      {
        id: "follow-ups",
        prompt:
          "Are non-blocking follow-ups filed as explicit tickets or knowledge-log entries (not left as prose)?",
        scale: "1-5 where 5 = every follow-up has a home and an owner",
        weight: 0.8
      }
    ]
  },
  {
    stage: "ship",
    checks: [
      {
        id: "release-readiness",
        prompt:
          "Does the artifact prove release readiness (gates green, changelog, version bump)?",
        scale: "1-5 where 5 = each readiness item is linked to concrete evidence",
        weight: 1.0,
        critical: true
      },
      {
        id: "rollback",
        prompt:
          "Is there an explicit rollback path (command, feature-flag, migration reversal)?",
        scale: "1-5 where 5 = rollback is reproducible from the doc with no context rehydration",
        weight: 1.0,
        critical: true
      },
      {
        id: "monitoring",
        prompt:
          "Are monitoring and alerting hooks named (dashboards, logs, SLO tripwires)?",
        scale: "1-5 where 5 = each hook has a canonical URL or query",
        weight: 0.8
      },
      {
        id: "retro-seed",
        prompt:
          "Does the artifact leave a retro seed (what went well, what to change for the next run)?",
        scale: "1-5 where 5 = at least one distinct 'keep' and one 'change' statement",
        weight: 0.6
      }
    ]
  }
];

function renderRubric(rubric: StarterRubric): string {
  const lines: string[] = [];
  lines.push(`# Starter rubric for the \`${rubric.stage}\` stage.`);
  lines.push(`# Edit the checks to reflect your team's bar before running`);
  lines.push(`# \`cclaw eval --judge\`. Every check id is used verbatim in`);
  lines.push(`# report output and baseline files, so keep slugs stable once`);
  lines.push(`# they start appearing in CI.`);
  lines.push(`stage: ${rubric.stage}`);
  lines.push(`checks:`);
  for (const check of rubric.checks) {
    lines.push(`  - id: ${check.id}`);
    lines.push(`    prompt: >-`);
    lines.push(`      ${check.prompt}`);
    if (check.scale !== undefined) {
      lines.push(`    scale: ${JSON.stringify(check.scale)}`);
    }
    if (check.weight !== undefined) {
      lines.push(`    weight: ${check.weight}`);
    }
    if (check.critical === true) {
      lines.push(`    critical: true`);
    }
  }
  return `${lines.join("\n")}\n`;
}

export const EVAL_RUBRIC_FILES: ReadonlyArray<{ stage: string; contents: string }> =
  STARTER_RUBRICS.map((rubric) => ({
    stage: rubric.stage,
    contents: renderRubric(rubric)
  }));

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
