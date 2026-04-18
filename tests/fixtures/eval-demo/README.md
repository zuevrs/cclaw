# eval-demo fixture

Project-shaped directory used as the canonical corpus for `cclaw eval`
in CI. Forty-one cases across all 8 stages: 24 structural fixtures
(3 per stage × 8), 16 rules-only cases, and 1 Tier B demo that seeds
`README.md` into the sandbox. The structure is intentionally identical
to what a real user sees inside `.cclaw/evals/` after `cclaw init` so
bugs in layout resolution surface here first.

Run locally:

```
cd tests/fixtures/eval-demo
node ../../../dist/cli.js eval --schema-only
```

Regression test: `tests/integration/eval-structural.test.ts` copies this
tree into a temp dir, asserts a clean run, then mutates one fixture and
asserts exit 1.
