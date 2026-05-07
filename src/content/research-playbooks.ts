export interface ResearchPlaybook {
  id: string;
  fileName: string;
  title: string;
  body: string;
}

const READ_BEFORE_WRITE = `# Research — read before you write

Planner mode \`research\` exists because writing a plan against a codebase you have not read produces speculation. This playbook scopes "read enough" without becoming a stall.

## Inputs you must read

| signal | read |
| --- | --- |
| AC mentions a file | the file (or the relevant function within it) |
| AC mentions a test | the test file |
| AC implies a public API change | the export site + at least one consumer |
| AC implies a schema change | the migration directory + the ORM model |
| AC implies a config change | the config file + every place it is read |
| AC implies a CI change | the workflow file + the policy doc, if any |

## Inputs you may skim

| signal | skim |
| --- | --- |
| README mentions the area | the relevant README section |
| There is a prior shipped slug for the same area | \`.cclaw/shipped/<slug>/manifest.md\` |
| There are prior decisions in the area | \`.cclaw/shipped/<slug>/decisions.md\` |

## Inputs you may ignore

- The whole codebase. You are not writing a survey paper.
- Files outside the AC's declared file set.
- Library source unless the AC depends on a private library detail.

## Output

The research mode does not produce its own artifact. It feeds two sections of \`plans/<slug>.md\`:

- the **Context** paragraph, citing what you read;
- the **Plan** phases, with file:line references.

## Stop conditions

Stop reading when you can answer:

1. Where will the change land? (file:line)
2. Who calls / depends on the changed code?
3. What is the verification (test, command, manual step)?
4. What is the smallest commit that satisfies AC-1?

If you can answer all four, stop reading and start authoring AC.
`;

const HOW_TO_READ_TESTS = `# Research — reading existing tests effectively

When the task is to add or modify behaviour, the existing test suite is the fastest way to understand the contract.

## Where to look first

1. **The test file with the same name as the module** (\`src/foo.ts\` → \`tests/unit/foo.test.ts\` or \`src/foo.test.ts\`). Read the highest-fidelity tests there: integration > unit, behavioural > snapshot.
2. **The most recent test file in the same directory.** It usually reflects the current style, fixture conventions, and mocking choices.
3. **The shared fixtures.** \`tests/helpers/\` (or equivalent) carries the project's idea of "a normal record"; reuse it instead of inventing.

## What to extract

- The contract the module advertises. Tests are the contract.
- The test runner conventions: \`describe\` / \`it\` / \`test\`, async style, mock library.
- The "doesn't crash on edge X" tests — these often map directly to AC verification lines.

## What to ignore

- Snapshot tests for unrelated parts of the file.
- Coverage gaps in adjacent modules.
- Tests skipped with \`.skip\` / \`xit\` / \`@pytest.mark.skip\` — they are usually intentional or stale.

## Output

You do not modify tests during research. Findings flow back to the plan as:

- AC verification lines that reference an existing test ("AC-2 verified by \`tests/unit/foo.test.ts: handles empty input\`"); or
- a new AC ("AC-3: add a test that pins the empty-input case").
`;

const HOW_TO_READ_DEPENDENCIES = `# Research — reading dependencies and integration boundaries

When the task crosses a module boundary or depends on a library upgrade, you must read both sides of the boundary.

## Internal boundaries

- The exported surface (\`index.ts\` / \`__init__.py\` / \`mod.rs\`) and the consumers.
- Any DI registration or factory wiring.
- The integration test that covers the boundary, if it exists.

If no integration test exists, "add one" is often a valid AC.

## External boundaries (third-party libraries)

- The library's documented API for the version pinned in the project (not the latest version).
- Any compatibility shims the project added (look for files with \`compat\` / \`shim\` / \`adapter\` in the name).
- The version constraint in \`package.json\` / \`pyproject.toml\` / \`Cargo.toml\` / equivalent.

If you discover the project uses a feature that the pinned version does not have, escalate back to architect.

## Output

Research findings feed the plan as:

- a one-line "boundary inventory" in the Plan phases (e.g. "Phase 1 — extend boundary at \`src/server/api/index.ts\` to expose the new route");
- a security_flag if the boundary is across a trust boundary (network, IPC, eval).
`;

const HOW_TO_TIME_BOX = `# Research — time-boxing

Research can dominate a slug if you let it. Time-box.

## Default budget

- 5-10 minutes of reading per AC.
- 15-30 minutes total for medium tasks.
- Up to 60 minutes for large/risky tasks; if you exceed 60 minutes, the task is too large and should be split.

## Signals that you are over-reading

- You re-read the same file twice without finding new information.
- You start reading "interesting" code outside the AC scope.
- You start drafting unrelated refactors mentally.

When any of these triggers, stop reading. Author the plan with what you have. The reviewer will catch holes; you do not need to be exhaustive at plan-stage.

## Signals that you are under-reading

- You cannot cite a single \`file:path:line\` reference.
- You cannot name the verification step for an AC.
- You are speculating about library behaviour rather than reading the call site.

In all three cases, read more before authoring.
`;

const HOW_TO_USE_PRIOR_SLUGS = `# Research — using prior shipped slugs

Refinement is the cheapest path to a high-quality plan. Use it.

## When to look at prior slugs

- Existing-plan detection found a match (slug or body overlap).
- The user said "remember when we did X" / "like the previous one" / "fix the thing we shipped last week".
- The task touches an area that has been shipped within the past month.

## What to extract from a prior shipped slug

| from | extract |
| --- | --- |
| \`shipped/<slug>/manifest.md\` | AC ↔ commit map; ship_commit |
| \`shipped/<slug>/plan.md\` | Context, Frame, Out-of-scope items (still useful) |
| \`shipped/<slug>/decisions.md\` | architectural decisions and their consequences |
| \`shipped/<slug>/learnings.md\` | what we got wrong; what to keep doing |
| \`shipped/<slug>/review.md\` | findings from the last review (some may still apply) |

## What not to do

- Do not copy AC verbatim into the new plan. AC restart at AC-1 in a refinement.
- Do not assume the architecture is unchanged. Re-validate; the refinement may invalidate prior assumptions.
- Do not treat the prior \`learnings.md\` as ground truth. It captures what we learned at the time; new evidence may overrule it.
`;

export const RESEARCH_PLAYBOOKS: ResearchPlaybook[] = [
  { id: "read-before-write", fileName: "read-before-write.md", title: "Research — read before you write", body: READ_BEFORE_WRITE },
  { id: "reading-tests", fileName: "reading-tests.md", title: "Research — reading existing tests", body: HOW_TO_READ_TESTS },
  { id: "reading-dependencies", fileName: "reading-dependencies.md", title: "Research — reading dependencies and boundaries", body: HOW_TO_READ_DEPENDENCIES },
  { id: "time-boxing", fileName: "time-boxing.md", title: "Research — time-boxing", body: HOW_TO_TIME_BOX },
  { id: "prior-slugs", fileName: "prior-slugs.md", title: "Research — using prior shipped slugs", body: HOW_TO_USE_PRIOR_SLUGS }
];

export const RESEARCH_PLAYBOOKS_INDEX = `# .cclaw/research/

Research playbooks loaded by \`planner\` mode=\`research\`. Each playbook is a small, focused checklist; they compose with each other.

| playbook | when |
| --- | --- |
${RESEARCH_PLAYBOOKS.map((p) => `| [\`${p.fileName}\`](./${p.fileName}) | ${p.title.replace(/^Research — /u, "")} |`).join("\n")}
`;
