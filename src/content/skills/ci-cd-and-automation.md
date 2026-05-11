---
name: ci-cd-and-automation
trigger: stage=ship when the diff touches `.github/workflows/`, `.gitlab-ci.yml`, `azure-pipelines.yml`, `Jenkinsfile`, or any CI / CD configuration file; when an AC is on the CI / CD surface; when the user invokes `/cc` with a "fix CI" / "add CI step" / "speed up the build" intent
---

# Skill: ci-cd-and-automation

CI is the gate between "the change works on my machine" and "the change is safe to ship to production". When the gate is missing, every regression ships; when the gate is too slow, agents bypass it; when the gate is too permissive, it green-lights changes that break in prod. This skill is the canonical rubric for CI / CD work in cclaw: the quality-gate pipeline shape (lint → typecheck → test → coverage → security-audit → bundle-check), the GitHub Actions baseline template, optimisation patterns (caching / parallelism / path filters), and branch-protection essentials.

The skill is stage-windowed on `["ship"]` because CI work lives at the ship boundary: the slug is "make the gate that prevents bad ships", not "implement a feature". Triggers include the standard CI-config file patterns and any ship-stage dispatch whose AC mentions CI / CD / workflow / pipeline.

## When to use

- **When implementing or modifying a CI workflow file** (`.github/workflows/*.yml`, `.gitlab-ci.yml`, etc.). The quality-gate pipeline shape is the contract; deviations need a documented reason in the workflow's top-of-file comment.
- **When the user asks to "speed up CI" or "fix the failing check"**. Apply the optimisation patterns; do not paper over a real failure with `continue-on-error`.
- **When the slug ships a new project or a new package in a monorepo** — the project needs its quality gate before the first non-bootstrap commit lands. The baseline template is the start.
- **Reviewer-side** when scoring a CI-config diff. Cite this skill for the gate-completeness check, the optimisation patterns, and the branch-protection essentials.

## When NOT to apply

- **The slug is not touching CI / CD config.** Don't broaden a feature slug into a CI overhaul. CI work is its own slug; surface as "noticed but didn't touch" if the slug uncovered a CI gap.
- **You are running on a platform with no real CI** (a local-only project, a quick prototype not destined for any team workflow). The quality-gate pipeline is the contract; a project without `.github/workflows/` or equivalent does not benefit from cargo-culting one.
- **The project has a deliberate CI-skip policy** (e.g. a doc-only repo where the only check is link-validation). Don't add type / test / lint gates the project doesn't need. The baseline template's gates are the **default for code-shipping projects**; deviations are documented.
- **You are about to mock the CI gate to "make the build pass"** — re-running the check after disabling the failing job is the bug, not the fix. Diagnose the failure; never bypass.

## Quality-gate pipeline shape

The canonical pipeline runs these checks in order. Each stage either passes (continue) or fails (stop, surface to reviewer); no stage is `continue-on-error: true` in the baseline.

1. **Setup** — checkout, cache restore, dependency install. Time budget: ≤ 60s on a warm cache.
2. **Lint** — style and ruleset checks (`eslint`, `prettier --check`, `ruff`, `golangci-lint`). Time budget: ≤ 30s. Fail-fast: lint failures don't need test runs to surface.
3. **Typecheck** — static type analysis (`tsc --noEmit`, `mypy`, `pyright`). Time budget: ≤ 60s. Fail-fast: typecheck failures are spec violations.
4. **Test** — unit + integration test runs (`npm test`, `pytest`, `go test ./...`). Time budget: ≤ 5 minutes; if longer, parallelise or shard.
5. **Coverage** — test coverage report; gate at the project's pinned threshold (typical: ≥ 80% statements, ≥ 70% branches). Coverage regressions are findings, not silent.
6. **Security audit** — dependency vulnerability scan (`npm audit`, `pip-audit`, `cargo audit`). Gate at "no high or critical CVEs without a documented suppression". Suppressions live in a checked-in allowlist with an expiry date.
7. **Bundle check** (UI only) — bundle-size delta vs `main`; gate at the project's pinned `perfBudget.bundle` (typical: + 10% main JS, + 5% initial CSS).
8. **(Optional) E2E** — end-to-end / Playwright / Cypress run on a sampled fraction of PRs (typical: 10-20%). Required on `main` post-merge.

The ordering is deliberate: cheaper / fail-faster checks run first so a typo doesn't wait 5 minutes for the test suite. Lint + typecheck together gate within ~90s; the full pipeline runs in ≤ 8 minutes on a clean PR.

Each stage emits a JUnit / equivalent report so the reviewer can read the failure surface without re-running the suite. The CI workflow's `summary` step composes the slim summary (pass / fail per stage); the reviewer reads the summary, not the raw logs, unless the failure is unclear.

## GitHub Actions baseline template

The reference workflow for a Node.js / TypeScript project (adapt the steps for the project's stack). Drop into `.github/workflows/ci.yml` on a fresh project.

```yaml
name: CI

on:
  pull_request:
    branches: [main]
  push:
    branches: [main]

# Use the most restrictive permissions possible.
permissions:
  contents: read

# Cancel in-progress runs for the same PR when a new commit lands.
concurrency:
  group: ${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: true

jobs:
  build-and-test:
    name: Build and Test (Node ${{ matrix.node }})
    runs-on: ubuntu-latest
    strategy:
      fail-fast: false
      matrix:
        node: [20, 22]
    steps:
      - name: Checkout
        uses: actions/checkout@v4
        with:
          # Fetch enough history for coverage-diff against main.
          fetch-depth: 100

      - name: Setup Node.js ${{ matrix.node }}
        uses: actions/setup-node@v4
        with:
          node-version: ${{ matrix.node }}
          cache: npm

      - name: Install dependencies
        run: npm ci

      - name: Lint
        run: npm run lint

      - name: Typecheck
        run: npm run typecheck

      - name: Test
        run: npm test -- --coverage

      - name: Upload coverage
        if: matrix.node == 20
        uses: codecov/codecov-action@v4
        with:
          fail_ci_if_error: true

  security-audit:
    name: Security Audit
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm
      - run: npm ci --omit=optional
      - run: npm audit --audit-level=high

  bundle-check:
    name: Bundle Size
    runs-on: ubuntu-latest
    if: github.event_name == 'pull_request'
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm
      - run: npm ci
      - run: npm run build
      - name: Bundle delta
        run: npx bundlewatch --config bundlewatch.config.json
```

Project-specific adjustments:

- **Monorepo**: add a `paths` filter per package so the workflow runs only when relevant files changed; use `pnpm filter` / `nx affected` / equivalent to scope the test run.
- **Python / Go / Rust**: replace `setup-node` + `npm ci` with the stack's equivalent (`setup-python` + `pip install -e .[dev]`; `setup-go` + `go mod download`; `actions-rust-lang/setup-rust` + `cargo build`).
- **Container builds**: add a separate `docker-build` job using `docker/build-push-action@v6` with a buildx cache.
- **Windows / macOS coverage**: extend the matrix with `os: [ubuntu-latest, windows-latest, macos-latest]` when the project ships to those platforms.

## CI optimisation patterns

The pipeline must be fast to be respected. Three patterns, in order of impact:

### Pattern 1 — Caching

| asset | cache key | typical hit rate | typical save |
| --- | --- | --- | --- |
| npm / pnpm / yarn dependencies | `package-lock.json` hash | 85-95% | 60-120s per run |
| Python `~/.cache/pip` | `requirements*.txt` hash | 80-90% | 30-90s |
| Go `~/go/pkg/mod` | `go.sum` hash | 85-95% | 30-60s |
| Cargo target dir | `Cargo.lock` hash | 70-85% | 60-300s |
| Docker layer cache | git SHA + Dockerfile path | 60-80% | 30-600s |
| Test result cache (Nx, Turbo, Jest cache) | source-tree hash | 50-80% | 30-300s |

Cache restore is cheap; cache miss is the baseline. Always fall back gracefully — never `if: cache-hit == 'true'` skip a critical step.

### Pattern 2 — Parallelism

Run independent stages in parallel jobs (`jobs:` siblings, not serial `steps:` in one job). The baseline template above runs `build-and-test`, `security-audit`, and `bundle-check` as three parallel jobs; the wall-clock time is the slowest job's time, not the sum.

For test suites > 5 minutes, shard the run:

- Vitest / Jest: `--shard 1/4` ... `--shard 4/4` across four parallel jobs.
- Playwright: `--shard=1/4` ... and the official `playwright-merge-reports` to combine.
- Pytest: `pytest-split` or `pytest-xdist` for parallel-within-job, with the matrix sharding across-jobs.

Parallel sharding is worth setting up when the single-shard test run exceeds 5 minutes; below that, the orchestration overhead eats the win.

### Pattern 3 — Path filters

Run a workflow only when the affected files changed. GitHub Actions supports `paths:` / `paths-ignore:` on `pull_request` / `push` triggers; the `dorny/paths-filter` action provides finer-grained per-job filtering.

```yaml
on:
  pull_request:
    paths:
      - 'src/**'
      - 'tests/**'
      - 'package.json'
      - 'package-lock.json'
      - '.github/workflows/ci.yml'
```

Doc-only changes (`.md`, `README`, `CHANGELOG`) skip the full CI pipeline. They should still pass a lighter link-validation / markdown-lint job — that's a separate workflow with its own `paths:` filter.

For monorepos, per-package path filters drop CI time dramatically. A PR touching only `packages/web/` shouldn't run the `packages/server/` test suite.

## Branch protection essentials

The CI gate is meaningful only when the branch protection rule enforces it. Configure on `main` (or the project's default branch):

| setting | value | reason |
| --- | --- | --- |
| Require pull request reviews before merging | ≥ 1 approval | code review is a separate quality gate from CI |
| Require status checks to pass | every job from the baseline (`Build and Test`, `Security Audit`, `Bundle Size`, etc.) | the CI gate is enforceable only when status checks block merge |
| Require branches to be up to date before merging | yes | prevents stale-merge regressions |
| Require linear history | yes (project preference; squash + rebase get the same effect) | clean `git log` |
| Require signed commits | yes (where org policy permits) | supply-chain assurance |
| Restrict who can push to matching branches | repo admins + bots | prevents direct-to-`main` |
| Disallow force pushes | yes | preserves history |
| Disallow deletions | yes | preserves the branch |
| Require deployments to succeed | (optional) the deployment workflow | gates merge on deploy-preview health |

When the project also has a `release/*` or `staging` branch, apply the same rule set (typically a subset; release branches often allow admin force-push for hotfixes — that is a deliberate deviation that should be documented in the branch-protection rule's note).

Never bypass branch protection to "fix something quickly". The bypass is the bug.

## Common rationalizations

| rationalization | truth |
| --- | --- |
| "The test is flaky — I'll mark it `continue-on-error` and fix it later." | "Later" doesn't come; the flaky test is now hidden, and the regression it would have caught ships silently. The right fix: quarantine the test (skip + open an issue), not bypass the suite. |
| "CI is slow because of the test suite — I'll just disable a few non-critical tests." | "Non-critical" tests catch the regressions you didn't predict. The right fix: shard / parallelise / cache / split into a separate "fast-PR-gate + slow-nightly" pair, not delete. |
| "I'll skip the security audit on this PR — it's just a doc change." | The security audit runs on the `package-lock.json` / `requirements.txt` regardless of which files the PR touched. A "doc change" that bumps a transitive dep introduces the vulnerability. Run the audit; the path-filter check (skip when no `package*` file changed) is the right gate, not `if: false`. |
| "Coverage dropped by 1% — that's noise." | Coverage delta is a signal. A 1% drop in a PR that adds new code means new code shipped untested. Either the new code is genuinely untestable (document in PR description) or the PR is missing tests. Don't normalise the drop. |
| "Bundle size grew by 12KB — users won't notice." | Bundle size accumulates. A 12KB delta per PR × 50 PRs = 600KB. The `perfBudget.bundle` ceiling exists to stop the accumulation, not to gate a specific PR. Hold the budget per PR. |
| "I'll merge despite the failing check — the failure is unrelated." | Branch protection should prevent this; if it doesn't, the failing check is either (a) actually related (your "unrelated" hypothesis is wrong) or (b) a CI bug (the check itself needs fixing — that is the slug). Either way the merge is premature. |
| "We don't need branch protection — the team is small enough to coordinate verbally." | Verbal coordination scales to 2-3 people maybe; CI branch protection scales to N. Adding branch protection is one PR; removing it after the team grows is "we should have done this earlier". Set it up day one. |
| "The CI cache is making things weird — I'll disable caching." | Caching weirdness is real but always has a specific cause (cache-key drift, invalidation bug, OS difference). Diagnose; don't disable. A no-cache CI is a slow CI; slow CI gets bypassed. |

## Red flags

Stop and revisit when any appear in the diff:

- **`continue-on-error: true` on a real check** (test / typecheck / lint / security audit). The check is not blocking; the gate is theatre.
- **`if: false` or `if: github.actor == '...'` on a job that should run for everyone.** Whitelist-bypassing a gate by user or label is a routing bug, not a fix.
- **A workflow with no `concurrency` block** that runs on every push. Stale PR runs queue indefinitely; cancel-in-progress should be the default.
- **`fetch-depth: 0` everywhere** (`checkout@v4` defaults to depth 1; depth 0 fetches all history). Full history is needed for coverage-diff and `git blame` jobs; everywhere else it is wasted bandwidth.
- **A dependency on a third-party action without a pinned SHA.** Pin actions to a commit SHA (`uses: actions/checkout@b4ffde65f...`), not a tag (`@v4`). Tag re-pointing is a supply-chain vector.
- **`permissions: write-all`** on a workflow that doesn't need it. Use the most-restrictive permissions; expand per-job only when a step requires it.
- **A test or lint command that doesn't fail-fast** when an early check fails. The pipeline should stop at lint failure, not run the test suite to find the same failure 5 minutes later.
- **CI workflow that mutates the working tree and commits back.** Auto-commits from CI (formatting, generated files) create a feedback loop and obscure the human-authored history. Generate locally; CI verifies.
- **A `secrets.GITHUB_TOKEN` passed to a third-party action.** The token can read / write the repo. Use a minimally-scoped fine-grained PAT or OIDC.

## Verification

Before merging a CI-config change:

- [ ] All baseline gates (lint / typecheck / test / coverage / security audit / bundle check) are present in the workflow.
- [ ] No gate is `continue-on-error: true` without a documented reason in the workflow header.
- [ ] Caching is configured for the stack's package manager.
- [ ] Concurrency group + `cancel-in-progress: true` is set.
- [ ] Path filters (where appropriate) drop CI time on no-op file changes.
- [ ] Test suite runs in ≤ 5 minutes (or is sharded; the wall-clock is the constraint).
- [ ] Security audit runs on every PR; suppressions (if any) live in a checked-in allowlist with an expiry date.
- [ ] Branch protection on `main` requires every baseline status check.
- [ ] Actions are pinned to commit SHA, not floating tags.
- [ ] Permissions are the most restrictive (`contents: read` baseline; expand per-job as needed).
- [ ] The slim summary records the gate completeness ("CI: 8/8 baseline gates present; security audit suppressions: 0; bundle delta: −1.2KB").

If any box is unchecked → fix or surface as a deviation with explicit `Notes:` text and an issue number.

## Cross-references

- `tdd-and-verification > verification-loop` — the CI gate is the verification-loop running in a different process. Locally `build → typecheck → lint → test` is the same chain CI runs; alignment is mandatory.
- `commit-hygiene > commit-message-quality` — CI-config commit messages follow the same `<type>(<scope>): <subject>` shape; the `<scope>` is `ci` for workflow changes.
- `review-discipline > Seven-axis review` — CI-config diffs are scored on the `architecture` + `security` axes (workflow correctness; permissions / secret handling).
- `performance-optimization > Bundle budget` — the bundle-check job in CI enforces the `perfBudget.bundle` thresholds.
- `api-evolution > breaking changes` — a CI-gate change that removes a check IS a breaking-change to the contract (the gate that downstream consumers trusted). Document in CHANGELOG.
- `documentation-and-adrs` — non-trivial CI architecture (e.g. adopting a release-please bot, migrating to GitHub Actions reusable workflows) deserves an ADR.

---

*Adapted from the addy-osmani ci-cd-and-automation pattern. The 8-stage quality gate ordering, the GitHub Actions baseline template, the three optimisation patterns (caching / parallelism / path filters), and the branch-protection essentials table are addy's; the cclaw fitting is the ship-stage-windowing, the integration with the existing reviewer axes, the alignment with `tdd-and-verification`'s verification-loop, and cclaw's two-column rationalizations table. GitHub Actions syntax is current as of 2026.*
