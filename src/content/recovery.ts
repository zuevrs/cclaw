export interface RecoveryPlaybook {
  id: string;
  fileName: string;
  title: string;
  body: string;
}

const AC_TRACEABILITY_BREAK = `# Recovery — AC traceability broken

The orchestrator detects a broken AC ↔ commit chain when:

- \`flow-state.json\` has an AC with \`status: pending\` but \`builds/<slug>.md\` already has a row for that AC;
- the commit-helper hook was bypassed (a plain \`git commit\` produced a SHA that flow-state does not know about);
- a force-push rewrote SHAs that flow-state had recorded.

## Symptoms

- \`runCompoundAndShip()\` refuses to run with: \`Cannot ship <slug>: AC traceability gate failed. Pending AC: ...\`
- a review iteration finds an AC labelled \`pending\` with a commit cited in \`builds/<slug>.md\`.

## Recovery steps

1. Identify the affected AC ids and the actual commit SHAs from \`git log\`.
2. Open \`.cclaw/state/flow-state.json\` and locate the matching AC entry.
3. Set \`commit\` to the verified SHA and \`status\` to \`committed\`.
4. Re-render the traceability block in \`plans/<slug>.md\`: every AC gets a single line \`AC-N → commit <short-sha>\`.
5. Re-run review-stage for the affected AC. The reviewer must see the correct chain before ship proceeds.

## What not to do

- Do not delete \`.cclaw/state/flow-state.json\` to "start fresh". The active artifacts still reference the slug; deleting state desynchronizes everything.
- Do not edit historical commits to "fix" the message. The ship gate trusts SHAs, not messages.
- Do not amend the commit produced by commit-helper. Amending changes the SHA and breaks the chain again.
`;

const REVIEW_CAP_REACHED = `# Recovery — review hard cap reached

The reviewer reached iteration 5 with outstanding block-level findings.

## Symptoms

- \`reviews/<slug>.md\` has 5 iteration blocks; the last one carries \`status: cap-reached\`.
- The orchestrator surfaces remaining findings and recommends \`/cc-cancel\` or splitting.

## Recovery steps

Pick one of:

### Option A — \`/cc-cancel\` and re-plan

1. \`/cc-cancel reason="cap reached on <slug>"\`.
2. Read the cap-reached block to identify the still-broken AC.
3. \`/cc <task>\` with a tighter scope. Often the cap was reached because the slug bundled two changes; split them.
4. The cancelled artifacts under \`.cclaw/flows/cancelled/<slug>/\` can be referenced from the new plan via the Refs section.

### Option B — fold remaining findings into a fresh slug

1. Manually move \`.cclaw/flows/<slug>/plan.md\` and friends out of the active directory (e.g. into \`.cclaw/flows/cancelled/\` for archive).
2. Reset flow-state.
3. \`/cc <new task>\` for the leftovers.

### Option C — escalate to a human review

If the cap is genuinely a tooling failure (e.g. the reviewer kept hallucinating the same finding), capture the iteration logs as a decision record and ask a human to break the loop.

## What not to do

- Do not raise the iteration cap. The cap exists because past iteration 5 the marginal value of another iteration is near zero.
- Do not silently force \`clear\` to ship. The block findings are real; ignoring them puts garbage into shipped/.
- Do not fork the slug into ten micro-slugs. Two or three is healthy; ten is fragmentation.
`;

const PARALLEL_BUILD_CONFLICT = `# Recovery — parallel-build slice conflict

Two slice-builders touch the same file or write conflicting changes during a \`parallel-build\` wave.

## Symptoms

- Slice-builder #2 reports a path conflict with slice-builder #1 mid-wave.
- The integration reviewer finds two commits both editing the same file.
- Build log shows two AC committing to the same file.

## Recovery steps

1. Pause the wave. Stop dispatching new slice-builders.
2. Read \`builds/<slug>.md\` to understand which AC each commit closes.
3. Decide ownership:
   - if the file legitimately needs both changes, integration reviewer reconciles them and creates a single fix-only commit referencing both AC;
   - if one slice should not have touched the file, slice-builder mode=\`fix-only\` reverts the offending hunk and re-implements the AC inside its declared file set.
4. Re-run the integration reviewer.

## Pre-flight prevention

- Planner topology=\`parallel-build\` must verify disjoint file sets before recommending the topology.
- The orchestrator must surface the file-set partition to the user before dispatching slices.
- Slice-builders never read each other's working trees mid-wave.

## What not to do

- Do not "merge" the conflicting commits with \`git rebase\` or \`git merge\` inside \`/cc\`. The AC chain breaks.
- Do not have one slice-builder re-do another slice-builder's AC. Hand it back to the original slice-builder via fix-only.
- Do not silently rewrite the topology to inline mid-wave. Cancel the wave, re-plan, restart.
`;

const FRONTMATTER_CORRUPTION = `# Recovery — frontmatter corruption

A YAML parser error appears when the orchestrator tries to read \`plans/<slug>.md\` or another active artifact.

## Symptoms

- Existing-plan detection silently skips a plan it should have matched.
- The frontmatter parser throws \`FrontmatterError: Invalid YAML frontmatter: ...\`.
- The orchestrator surfaces "Artifact is missing the required YAML frontmatter block (---)".

## Recovery steps

1. Open the artifact in your editor.
2. Compare against the canonical template in \`.cclaw/lib/templates/<stage>.md\`.
3. Fix the YAML — the most common errors are:
   - missing closing \`---\`;
   - tabs inside the YAML block (use spaces);
   - unquoted strings containing \`:\` (quote them);
   - invalid date / timestamp values.
4. Re-run the operation that surfaced the error.

## Defensive workflow

- Every edit to an artifact frontmatter should go through \`syncFrontmatter()\` rather than hand-editing whenever possible. The function reads, patches, re-renders, and re-writes atomically.
- AC entries in frontmatter are arrays of objects; do not collapse them to one-line strings.
- Treat the AC body table and the frontmatter \`ac\` array as the same data; \`mergeAcceptanceCriteria()\` keeps them aligned.

## What not to do

- Do not delete the frontmatter and rewrite from scratch when only one field is wrong; you lose history (review_iterations, last_specialist).
- Do not ignore the parser error and assume the orchestrator will "figure it out". Existing-plan detection silently drops corrupt artifacts.
`;

const SCHEMA_MISMATCH = `# Recovery — flow-state schemaVersion mismatch

\`/cc\` refuses to run because \`.cclaw/state/flow-state.json\` carries \`schemaVersion: 1\` (cclaw 7.x) instead of \`schemaVersion: 2\`.

## Symptoms

- \`/cc\` prints: "This project's flow-state.json is from cclaw 7.x. cclaw v8 cannot resume it."
- \`commit-helper.mjs\` refuses to record commits with \`schemaVersion mismatch\`.

## Recovery options

The orchestrator surfaces three options. Pick one explicitly:

### (a) Finish or abandon the run with cclaw 7.x

If you have an in-flight 7.x run and want to ship it, do that first. After ship, the active state is reset and the project can install cclaw v8 cleanly.

### (b) Delete \`.cclaw/state/flow-state.json\` and start fresh

For projects that are not mid-run, this is the right answer. The artifacts under \`.cclaw/flows/<slug>/\` are not deleted; only the state file is.

\`\`\`bash
rm .cclaw/state/flow-state.json
npx cclaw-cli sync
\`\`\`

\`cclaw sync\` writes a fresh \`flow-state.json\` with \`schemaVersion: 2\`.

### (c) Leave it alone

If you want to continue using cclaw 7.x for now, do not run any v8 \`/cc\` commands. Pin the toolkit version in your project to \`7.7.1\`.

## What not to do

- Do not edit the \`schemaVersion\` field by hand. Version 2 has different fields than version 1; mismatched fields fail validation downstream.
- Do not delete the artifacts under \`.cclaw/flows/<slug>/\` — they survive the version transition; only the state file does not.
- Do not run \`cclaw-cli upgrade\` while a 7.x run is mid-flight. Finish the run first.
`;

export const RECOVERY_PLAYBOOKS: RecoveryPlaybook[] = [
  { id: "ac-traceability-break", fileName: "ac-traceability-break.md", title: "Recovery — AC traceability broken", body: AC_TRACEABILITY_BREAK },
  { id: "review-cap-reached", fileName: "review-cap-reached.md", title: "Recovery — review hard cap reached", body: REVIEW_CAP_REACHED },
  { id: "parallel-build-conflict", fileName: "parallel-build-conflict.md", title: "Recovery — parallel-build slice conflict", body: PARALLEL_BUILD_CONFLICT },
  { id: "frontmatter-corruption", fileName: "frontmatter-corruption.md", title: "Recovery — frontmatter corruption", body: FRONTMATTER_CORRUPTION },
  { id: "schema-mismatch", fileName: "schema-mismatch.md", title: "Recovery — flow-state schemaVersion mismatch", body: SCHEMA_MISMATCH }
];

export const RECOVERY_INDEX = `# .cclaw/lib/recovery/

Recovery playbooks for the most common failure modes. The orchestrator opens these when an automated check fails or when a specialist asks for guidance.

| playbook | symptom |
| --- | --- |
${RECOVERY_PLAYBOOKS.map((p) => `| [\`${p.fileName}\`](./${p.fileName}) | ${p.title.replace(/^Recovery — /u, "")} |`).join("\n")}
`;
