# eval-demo fixture

Project-shaped directory used as the canonical corpus for `cclaw eval`
in CI. Twenty-four cases (3 per stage × 8 stages) exercise the structural
verifier. The structure is intentionally identical to what a
real user sees inside `.cclaw/evals/` after `cclaw init` so bugs in
layout resolution surface here first.

Run locally:

```
cd tests/fixtures/eval-demo
node ../../../dist/cli.js eval --schema-only
```

Regression test: `tests/integration/eval-structural.test.ts` copies this
tree into a temp dir, asserts a clean run, then mutates one fixture and
asserts exit 1.
