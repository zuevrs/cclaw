/**
 * v8.57 — utility slash commands.
 *
 * Two direct-callable primitives that expose cclaw's reviewer and critic
 * specialists outside the full `/cc` flow. Both commands are lightweight
 * shims: they reuse the existing specialist contracts (the same
 * `.cclaw/lib/agents/reviewer.md` / `.cclaw/lib/agents/critic.md` bodies
 * the `/cc` flow dispatches) but skip flow-state, triage, the artifact
 * tree, and slug tracking. Findings emit directly to chat; `--out
 * <path>` writes them as markdown.
 *
 * Naming convention: the `cclaw-` prefix distinguishes standalone
 * utility commands from the `cc-` flow primitives (`/cc`, `/cc-cancel`,
 * `/cc-idea`, `/cc-plan` namespace router, etc.). `/cclaw-review` is
 * NOT the same as `/cc-review` (the optional namespace-router shortcut
 * that resumes a flow at the review stage).
 */

export const CCLAW_REVIEW_COMMAND = `# /cclaw-review — utility reviewer pass (no flow)

Run the cclaw reviewer's 10-axis pass directly on a diff or set of files. This is an **escape valve** for ad-hoc moments: a quick sanity check on staged changes before commit, a focused review of two files mid-refactor, a second-opinion pass on a PR branch. No flow state, no triage, no artifact tree, no slug tracking.

For the full review pipeline (plan → build → review → critic → ship), use \`/cc <task>\` instead.

User arguments: \`{{ARGS}}\` — interpreted as in **Inputs** below.

## Inputs

| Args shape | What to review |
| --- | --- |
| (empty) | \`git diff --cached\` (staged changes). If empty, fall back to \`git diff HEAD\` (staged + unstaged). |
| \`<git-ref>\` or \`<ref>..<ref>\` | The diff at that ref / ref range (e.g. \`HEAD~3..HEAD\`). |
| \`<path> [<path> …]\` | Whole-file review of each path (current working-tree contents). |
| any of the above + \`--out <path>\` | After printing findings, also write them to \`<path>\` as markdown. |

Resolve the inputs once at the top of your turn. If the resolved input is empty (no staged or unstaged changes, no commits in the ref, no files at the paths), say so in one line and stop — there is nothing to review.

## Process

1. Read the reviewer contract at \`.cclaw/lib/agents/reviewer.md\` (the canonical specialist body; the same one \`/cc\` dispatches at the \`review\` stage). Apply it with the resolved diff / files as the review target.
2. Pick mode \`code\` for a diff or \`text-review\` for non-code files (\`*.md\` / \`*.txt\` only — anything that compiles or runs stays \`code\`).
3. Run the **10-axis pass** (\`correctness\`, \`test-quality\`, \`readability\`, \`architecture\`, \`complexity-budget\`, \`security\`, \`perf\`, \`edit-discipline\`, \`qa-evidence\`, \`nfr-compliance\`). Severities: \`critical\` / \`required\` / \`consider\` / \`nit\` / \`fyi\`.
4. **Axis gating for utility mode** (no plan, no AC, no flow state):
   - \`qa-evidence\` — **skip**. No \`qa.md\` exists to cross-check.
   - \`edit-discipline\` — skip sub-check 1 (touch-surface compliance; no plan). Sub-check 2 (pre-edit-investigation evidence) is also skipped unless the user has a \`build.md\` they explicitly pass via a path arg.
   - \`nfr-compliance\` — skip. No plan \`## Non-functional\` section to compare against.
   - The remaining 7 axes apply in full.
5. **Do not** read or write \`flow-state.json\`, \`.cclaw/flows/<slug>/\`, or any per-slug artifact. **Do not** patch \`plan.md\`, write \`review.md\`, or invoke the orchestrator's pause/resume gates.
6. Do not invoke \`security-reviewer\`. The utility command runs the standard reviewer only; deep security review remains a \`/cc\` flow concern.

## Output

Emit a single **Findings** table directly to chat (or as the entire markdown body when \`--out <path>\` is set):

\`\`\`text
| # | axis | severity | location | finding | suggested fix |
| --- | --- | --- | --- | --- | --- |
\`\`\`

Follow the table with one closing line: \`Verdict: <clear | warn | block>\` based on the severity ledger (any \`critical\` / \`required\` → \`block\`; any \`consider\` → \`warn\`; otherwise \`clear\`). Skip the verdict line if the input was empty.

When \`--out <path>\` is set, write the same body to \`<path>\` as a markdown file. Do not modify any other path on disk.

## Hard rules

- One invocation, one pass. Do not re-dispatch, do not loop, do not bounce findings to a fix-only loop. The user invokes \`/cc <task>\` if they want iteration.
- Never write to \`.cclaw/\` or any flow-state path. The utility command is structurally outside the flow.
- Never auto-commit, auto-push, or modify the working tree. Read-only on source.
- If the user wants the full ceremony (AC, plan traceability, per-criterion commits, critic falsification), point them at \`/cc <task>\` in one line and stop.
`;

export const CCLAW_CRITIC_COMMAND = `# /cclaw-critic — utility critic pass on any document (no flow)

Run the cclaw critic's adversarial 8-section protocol directly on a single document. The input can be any plan, design, RFC, PR description, README, ADR, or other artifact the user wants pressure-tested. This is an **escape valve** for ad-hoc moments outside the full \`/cc\` flow.

For the full critic pass on a shipped cclaw slug (\`plan.md\` + \`build.md\` + \`review.md\` in scope), use \`/cc <task>\` instead — the orchestrator dispatches the critic at the critic step automatically.

User arguments: \`{{ARGS}}\` — interpreted as in **Inputs** below.

## Inputs

| Args shape | Behaviour |
| --- | --- |
| \`<path>\` | Required. Path to the document to critique. Must exist and be a regular file. |
| \`<path> --out <out-path>\` | Same; also write findings to \`<out-path>\` as markdown after printing. |

If \`<path>\` is missing, unreadable, or the file does not exist, say so in one line and stop. There is no default; the critic always operates on a named document.

## Process

1. Read the critic contract at \`.cclaw/lib/agents/critic.md\` (the canonical specialist body; the same one \`/cc\` dispatches at the critic step). Apply it with the document content as the artifact to falsify.
2. Mode: **adversarial** (the utility command always runs adversarial mode; the gap-only path is reserved for the in-flow soft-mode dispatch). This activates §3 (four falsification techniques) plus the multi-perspective lens sweep.
3. **Document-type lens selection** — pick the lens set matching the document:
   - Planning docs (\`plan.md\` / RFC / proposal / spec / design with proposed AC or open questions) → **plan-stage lenses** (executor / stakeholder / skeptic).
   - Already-built docs (\`review.md\` / shipped \`design.md\` / PR description / post-mortem / ADR / README of an implemented feature) → **code-stage lenses** (security / new-hire / ops).
   - Mixed → both sets; the adversarial output contract still requires findings from **at least 3 lenses total**.
4. **Section gating for utility mode** (no flow state, no plan/build/review.md tuple in scope):
   - §1 predictions — run as written (3-5 predictions before reading the document in detail; in adversarial mode 5-7).
   - §2 gap analysis — run, but adapt the criterion / AC / NFR / D-N sub-buckets to whatever the document actually carries (acceptance lines, requirements, design decisions, open questions, risks). The bucket labels in the findings table follow the document's own vocabulary, not the cclaw plan vocabulary.
   - §3 adversarial findings — run all four techniques (assumption violation, composition failures, cascade construction, abuse cases) plus the lens sweep.
   - §4 Criterion check — adapt to "are the document's stated objectives the right objectives, not are they met?" Re-read the user's prompt or the document's own goal statement; compare each verifiable criterion / requirement / acceptance line against the goal.
   - §5 goal-backward — adapt to "does the document solve the problem its first paragraph claims to solve?"
   - §6 realist check — run as written: would a thoughtful peer ship this document?
   - §7 verdict — \`pass\` / \`iterate\` / \`block-ship\` mapped to \`pass\` / \`iterate\` / \`reject\` for the document context.
   - §8 summary — predictions / gaps / adversarial-findings counts + verdict.
5. **Do not** read or write \`flow-state.json\`, \`.cclaw/flows/<slug>/\`, or any per-slug artifact. **Do not** write \`critic.md\` or invoke the orchestrator's gates.
6. Token budget: aim for the strict-adversarial range (12-18k); hard 20k cap (input + output combined), same as the in-flow critic.

## Output

Emit the critic findings directly to chat (or as the entire markdown body when \`--out <path>\` is set). Use the section structure from the critic contract:

- **§1 Predictions** — 3-5 (or 5-7 in adversarial) rows: prediction · verification path · outcome (\`confirmed\` / \`refuted\` / \`partial\`).
- **§2 Gap analysis** — findings table: \`G-N | Class | Severity | Anchor | Description | Suggested patch\`.
- **§3 Adversarial findings** — findings table: \`F-N | Technique-or-Lens | Anchor | Description | Failure consequence | Severity\`. Lenses cited as \`human-perspective:<lens>\` in the technique column.
- **§4-§7** — short prose paragraphs per the critic contract.
- **§8 Summary** — one-line slim summary: \`Verdict: <pass | iterate | reject>  Predictions: <N>  Gaps: <N>  Adversarial: <N>  Confidence: <high | medium | low>\`.

When \`--out <path>\` is set, write the same body to \`<path>\` as a markdown file. Do not modify any other path on disk.

## Hard rules

- One invocation, one pass. Do not re-dispatch, do not loop. If the user wants a second pass after editing, they re-invoke \`/cclaw-critic <path>\`.
- Never write to \`.cclaw/\` or any flow-state path. The utility command is structurally outside the flow.
- Never auto-commit, auto-push, or modify any path other than the optional \`--out\` target.
- If the input document is a cclaw plan / build / review artifact (lives under \`.cclaw/flows/<slug>/\`), suggest in one line that \`/cc <task>\` is the better entry point (the orchestrator dispatches the critic with full flow context — plan + build + review + triage in scope) — then run the utility pass anyway.
`;

export function renderCclawReviewCommand(): string {
  return CCLAW_REVIEW_COMMAND;
}

export function renderCclawCriticCommand(): string {
  return CCLAW_CRITIC_COMMAND;
}

/**
 * The two utility command file names installed alongside `cc.md` /
 * `cc-cancel.md` / `cc-idea.md` in every enabled harness's commands
 * directory. Exported so the install layer, smoke script, and tests
 * share a single source of truth — adding a third utility command
 * (e.g. v8.58's `/cclaw-plan-critic`) is a one-line edit here.
 */
export const UTILITY_COMMAND_FILES: ReadonlyArray<{
  fileName: string;
  render: () => string;
}> = [
  { fileName: "cclaw-review.md", render: renderCclawReviewCommand },
  { fileName: "cclaw-critic.md", render: renderCclawCriticCommand }
];
