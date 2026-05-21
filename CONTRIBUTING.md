# Contributing to cclaw

cclaw is dogfooded — we use cclaw to develop cclaw. New behaviour usually means new prompt content under `src/content/`, not new TypeScript. Read [README.md](README.md) first; this file is the operational on-ramp.

## Test commands

```bash
npm test                # full vitest suite (must be green before any PR)
npm run build           # tsc + skill markdown copy + bin chmod
npm run smoke:runtime   # build + node scripts/smoke-init.mjs (runtime smoke)
npm run release:check   # build + verify-bin + test + npm pack --dry-run + smoke
```

The runtime is < 1 KLOC; almost every change touches a prompt under `src/content/specialist-prompts/`, a skill body under `src/content/skills/`, or a runbook under `src/content/runbooks-on-demand.ts`. Tripwire tests under `tests/unit/v8*.test.ts` pin the contracts those surfaces carry.

## Commit conventions

cclaw enforces a posture-driven commit-prefix contract on its own development. The canonical skill is [`src/content/skills/commit-hygiene.md`](src/content/skills/commit-hygiene.md); the cross-cutting catalog is [`src/content/anti-rationalizations.ts`](src/content/anti-rationalizations.ts) under category `commit-discipline`.

In strict mode (the default for cclaw's own slugs):

- Slice work uses `red(SL-N):` / `green(SL-N):` / `refactor(SL-N):` (pick the prefix from the slice's `Posture` value in `plan.md > ## Plan / Slices`).
- AC verification uses `verify(AC-N): passing` (one commit per AC, test-only or empty diff).

Subjects ≤72 characters, imperative voice, no `WIP` / `fixes` / `git add -A`.

## Adding a slug (release process)

Every release is one slug: `vX.Y.Z`. The process lives in the runbooks the LLM follows when you run `/cc`; the human-facing version is:

1. Branch off `main` (e.g. `vX.Y.Z/<semantic-kebab>`).
2. Bump `package.json` to the target version; run `npm install` to refresh `package-lock.json`.
3. Add a `CHANGELOG.md` entry at the top — tone matches recent entries (e.g. v8.109, v8.108).
4. Run `npm test` (must be all green), `npm run build`, `npm run smoke:runtime`.
5. Open one PR; do not auto-merge.

See [`src/content/runbooks-on-demand.ts`](src/content/runbooks-on-demand.ts) for the dispatch-time runbooks and [`src/content/start-command.ts`](src/content/start-command.ts) for the orchestrator body.

## License

MIT. See [LICENSE](LICENSE).
