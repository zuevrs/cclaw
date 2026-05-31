import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  renderDispatchSkillsIndex,
  type DispatchSkillsIndexEntry,
  type GateEnvelope
} from "./skills.js";

export interface OnDemandRunbook {
  id: string;
  fileName: string;
  title: string;
  body: string;
}

/**
 * Load a per-runbook markdown body from disk at module-import time.
 *
 * The `src/content/runbooks/<id>.md` source layout holds long-form prose
 * lifted out of the architect and builder prompts. Mirrors the resolution
 * pattern in
 * {@link import("./skills.js").readSkill} (`src/content/skills.ts`):
 *
 * - dev / test:  `<repo>/src/content/runbooks-on-demand.ts` →
 *                `<repo>/src/content/runbooks/<file>`
 * - dist:        `<repo>/dist/content/runbooks-on-demand.js` →
 *                `<repo>/dist/content/runbooks/<file>`
 *
 * The build step `scripts/copy-skill-md.mjs` mirrors
 * `src/content/runbooks/*.md` into `dist/content/runbooks/` after `tsc`
 * (alongside the analogous skills mirror) so both layouts work.
 *
 * Hard-fail with a clear error rather than papering over with an empty
 * string — a missing runbook body would silently ship a broken install.
 */
function readRunbook(fileName: string): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const full = path.resolve(here, "runbooks", fileName);
  let raw: string;
  try {
    raw = readFileSync(full, "utf8");
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new Error(`cclaw: failed to read runbook body ${full} (${reason})`);
  }
  // Normalize CRLF → LF for the same reasons as `readSkill` (install
  // pipeline copies the body byte-for-byte into `.cclaw/lib/runbooks/`
  // where downstream tooling expects POSIX newlines).
  return raw.replace(/\r\n/gu, "\n");
}

/**
 * Canonical reviewer-dispatch envelope shapes the orchestrator
 * encounters.
 *
 * The install pipeline pre-renders the gate-resolved skills slice for
 * each shape (via {@link renderDispatchSkillsIndex}) so the
 * dispatch-skills-index runbook is a static index of the high-traffic
 * per-envelope skills-pointer blocks the orchestrator might need to
 * paste into a live reviewer dispatch envelope.
 *
 * The cached table covers the top three traffic shapes only. Other
 * shapes — `security-sensitive`, `NFR-bearing`, and `every gate flag
 * set` — are derived on-demand by the orchestrator via the on-disk
 * reviewer.md superset (fall-back rule documented below). The fall-back
 * path is the same
 * `buildAutoTriggerBlock(stage, gateEnvelope)` runtime that
 * {@link renderDispatchSkillsIndex} wraps, so semantic correctness is
 * preserved on every envelope shape; the table is a fast-path index,
 * not a closed enum.
 *
 * Production-path caller of
 * `buildAutoTriggerBlock(stage, gateEnvelope)` so the token-axes runtime
 * path is reachable from production code, not only from tests.
 */
const REVIEWER_DISPATCH_ENVELOPES: ReadonlyArray<{
  label: string;
  envelope: GateEnvelope;
  notes: string;
}> = [
  {
    label: "no flags — empty envelope",
    envelope: {},
    notes:
      "Every surface-driven gated axis filtered out (qa-evidence / design-quality / security / nfr-compliance / edit-discipline). Reviewer renders the six base axes (correctness / readability / architecture / security / perf / edit-discipline) plus the always-on stage skills; no gated-axis companion-skill pointers are pinned. Only fires in practice on doc-only ceremony=soft slugs or as the structural baseline when the orchestrator has not yet stamped surface-driven flags."
  },
  {
    label: "strict-mode baseline — edit-discipline",
    envelope: {
      editDisciplineActive: true
    },
    notes:
      "Canonical strict-mode reviewer dispatch envelope on a plan that respects plan-critic §6.5 (Not-Doing section non-empty). edit-discipline always fires in strict / soft and now carries the folded Not-Doing scope-drift cross-reference. (The orchestrator may also stamp `walkScopeDriftAxis` / `walkAssumptionCoverageAxis` as plan-state signals for the Not-Doing fold + assumption-validation subsystem, but neither pins an additional companion skill.) Highest-traffic shape across the corpus."
  },
  {
    label: "UI / design slug — qa-evidence + design-quality stacked on the strict baseline",
    envelope: {
      editDisciplineActive: true,
      walkQaEvidenceAxis: true,
      walkDesignQualityAxis: true
    },
    notes:
      "Strict-mode UI slug — `triage.surfaces` ∩ {ui, web} ≠ ∅ AND `triage.designSurface == true`. The two surface-driven gates ride on top of the strict-mode baseline. Other shapes (security-sensitive, NFR-bearing, every-gate) derive on-demand via the on-disk reviewer.md static superset fall-back path; see the fall-back rules table below."
  }
];

/**
 * Pre-rendered dispatch-skills-index entries. Computed once at
 * module-import time so `dispatch-skills-index.md`'s body composer is a
 * pure string concatenation; the install pipeline writes the runbook
 * verbatim. Exported so the tripwire suite
 * (`tests/unit/v894-auto-trigger-gate-wiring.test.ts`) can assert
 * per-envelope skill membership without re-deriving the gate filter.
 */
export const REVIEWER_DISPATCH_SKILLS_INDEX: ReadonlyArray<DispatchSkillsIndexEntry> =
  REVIEWER_DISPATCH_ENVELOPES.map(({ label, envelope, notes }) => {
    const entry = renderDispatchSkillsIndex("review", envelope, label);
    return Object.assign(entry, { notes });
  });

function renderDispatchSkillsIndexRunbook(): string {
  const sections = REVIEWER_DISPATCH_SKILLS_INDEX.map((entry) => {
    const envJson = JSON.stringify(entry.envelope, null, 2);
    const idsLine =
      entry.activeSkillIds.length > 0
        ? entry.activeSkillIds.map((id) => `\`${id}\``).join(", ")
        : "_(none active)_";
    const notes =
      (entry as DispatchSkillsIndexEntry & { notes?: string }).notes ?? "";
    return [
      `### ${entry.label}`,
      "",
      `**Envelope flags**`,
      "",
      "```json",
      envJson,
      "```",
      "",
      `**Active skill ids** (${entry.activeSkillIds.length} pin${entry.activeSkillIds.length === 1 ? "" : "s"}): ${idsLine}`,
      "",
      `**Notes.** ${notes}`,
      "",
      "**Rendered block** — paste into the reviewer dispatch envelope's `Active skills:` field to override the static superset from `agents/reviewer.md`:",
      "",
      "```markdown",
      entry.block,
      "```"
    ].join("\n");
  }).join("\n\n");

  return `# On-demand runbook — dispatch-skills-index (Phase C G-2 fix)

The orchestrator opens this runbook when authoring any reviewer dispatch envelope (and, by extension, any specialist dispatch whose target stage carries gated axis skills).

## How to use this runbook

1. **Construct the reviewer dispatch envelope normally** — \`Stage: review\`, \`Slug: <slug>\`, \`Ceremony mode: <inline | soft | strict>\`, plus the gate flags the orchestrator already stamps per \`start-command.md > Review hop\` (\`securityFlag\`, \`walkDesignQualityAxis\`, \`walkScopeDriftAxis\`, \`walkAssumptionCoverageAxis\`, \`walkQaEvidenceAxis\`, \`planHasNonFunctional\`, \`editDisciplineActive\`).
2. **Look up the matching shape below** by comparing the envelope's flag set against the **Envelope flags** JSON in each section. When the envelope is a strict subset of one of the tabulated shapes' flags, use that shape's **Rendered block** verbatim. When the envelope flags don't match any tabulated shape (a rare combination), fall back to: (a) the on-disk \`agents/reviewer.md\` static superset (correct but token-wasteful), OR (b) regenerate the block at orchestrator time by walking the \`AUTO_TRIGGER_SKILLS\` table in \`src/content/skills.ts\` and applying each skill's gate predicate against the envelope.
3. **Paste the **Rendered block** into the reviewer dispatch envelope** as an \`Active skills (per envelope):\` field, positioned IMMEDIATELY after the required-reads block and BEFORE the inputs/output-contract block (so the sub-agent reads the gate-resolved slice before it interprets \`agents/reviewer.md\`'s superset). The sub-agent treats this field as authoritative; the on-disk \`agents/reviewer.md\` superset is a fall-back hint when the dispatch envelope omits the field entirely (legacy envelopes).
4. **The skill-body claims in \`reviewer-axis-*.md\` are accurate.** The per-skill \`## When to use\` paragraphs name "the orchestrator's dispatch envelope carries the \`walkXAxis\` flag". The function is called at INSTALL time, not at dispatch time, and the call happens here (the dispatch-skills-index runbook composer in \`src/content/runbooks-on-demand.ts\`), not from any runtime orchestrator code.

## Canonical envelope shapes

${sections}

## Fall-back rules

the cached fast-path table above lists the three highest-traffic shapes only (no-flags / strict-baseline / UI+design). Other shapes (security-sensitive, NFR-bearing, every-gate) derive on-demand via the rules below; semantic correctness is preserved because the on-disk \`agents/reviewer.md\` is the static superset of every gated axis and \`buildAutoTriggerBlock(stage, gateEnvelope)\` is the same runtime the cached entries wrap.

| envelope condition | what to do |
| --- | --- |
| matches one of the three cached shapes above | use that shape's **Rendered block** verbatim |
| every gate flag is unset / \`false\` | use the **no flags — empty envelope** section; expect zero gated-axis pointers in the rendered block |
| envelope carries a combination not in the cached three | fall back to the on-disk \`agents/reviewer.md\` static superset (token-wasteful but correct — the reviewer sub-agent reads the superset as a hint when no \`Active skills (per envelope):\` field is set); OR derive the block at orchestrator time by walking \`AUTO_TRIGGER_SKILLS\` in \`src/content/skills.ts\` and applying each skill's gate predicate against the envelope (this is what \`buildAutoTriggerBlock(stage, gateEnvelope)\` does internally) |

## Symmetry note for non-reviewer stages

The non-reviewer stages (\`plan\` / \`build\` / \`qa\` / \`triage\` / \`ship\` / \`compound\`) currently have NO stage-scoped skills with a gate predicate — every \`AUTO_TRIGGER_SKILLS\` entry tagged for those stages either rides every dispatch (no gate) or rides via \`stages: ["always"]\` (no stage filter). So the dispatch envelope flags don't affect their rendered block, and the on-disk \`agents/<specialist>.md\` static block is already the precise per-dispatch list for those specialists. This runbook covers the reviewer stage only because the reviewer is the only specialist with gated skills. If a future specialist adds gated skills (e.g. a future \`plan-critic\` rubricMode-specific dispatch axis gated on UI-density flags), add a per-stage table here mirroring the reviewer one.
`;
}

const DISPATCH_SKILLS_INDEX = renderDispatchSkillsIndexRunbook();

const DISPATCH_ENVELOPE = `# On-demand runbook — dispatch envelope shape

The orchestrator opens this runbook **before authoring any specialist dispatch envelope**. The shape below is the contract every \`/cc\` dispatch follows; the wire format is identical across harnesses (Claude Code, Cursor, OpenCode, Codex). When the orchestrator announces a dispatch in its message to the user, the announcement uses this shape verbatim so the harness picks it up consistently.

## Envelope shape

\`\`\`
Dispatch <specialist>
─ Required ethos read: .cclaw/lib/cclaw-ethos.md  (cclaw ethos — Boil the Lake / Search Before Building / Surgical Edits / User Sovereignty / 3 knowledge layers; the single source of truth for cross-cutting specialist behaviour; prepended above the contract so every specialist opens it first)
─ Required first read: .cclaw/lib/agents/<specialist>.md  (your contract — modes, hard rules, output schema, worked examples; do NOT skip)
─ Required second read: .cclaw/lib/skills/<wrapper>.md  (your wrapping skill — see "Stage → wrapper" in start-command)
─ Stage: <plan | build | review | ship>
─ Slug: <slug>
─ Ceremony mode: <inline | soft | strict>
─ Model tier: <fast | balanced | powerful>  (harness hint — the orchestrator stamps the specialist's tier from \`config.modelPreferences\` merged onto the defaults; harnesses that route on the hint pick the model, others ignore it and fall back to the harness default)
─ Pre-flight assumptions: see triage.assumptions in flow-state.json
─ Inputs the sub-agent reads after the ethos + contract + wrapper:
    - .cclaw/state/flow-state.json
    - .cclaw/flows/<slug>/<stage>.md (if it exists)
    - .cclaw/lib/templates/<stage>.md
    - other artifacts the stage needs (decisions, research-*, build, review)
─ Output contract (sub-agent writes):
    - .cclaw/flows/<slug>/<stage>.md (the main artifact)
    - return a slim summary block (≤6 lines, see start-command "Slim summary")
    - DO NOT mutate flow-state.json — only the orchestrator touches it
─ Forbidden:
    - dispatch other specialists (composition is the orchestrator's job)
    - run git commands other than \`git add\` / \`git commit -m "<prefix>(AC-N): ..."\` (no \`git push\`, no \`git rebase\`, no \`git reset\`)
    - read or modify files outside the slug's touch surface
\`\`\`

## Model-tier hint

Every envelope carries a \`Model tier:\` line. The orchestrator computes the tier by merging \`.cclaw/config.yaml > modelPreferences\` onto the per-specialist default policy below:

| Specialist | Default tier |
| --- | --- |
| \`builder\` (formerly \`slice-builder\`) | \`fast\` |
| \`learnings-research\` / \`repo-research\` | \`fast\` |
| \`triage\` / \`investigator\` / \`architect\` | \`balanced\` |
| \`plan-critic\` (single dispatch, all rubrics — generic / design / devex) | \`balanced\` |
| \`qa-runner\` / \`reviewer\` | \`balanced\` |
| \`critic\` | \`powerful\` |

Harnesses that support tier-based routing (custom OpenCode profiles, Claude Code agent.toml, etc.) honour the hint; harnesses that don't ignore the line and fall back to their own default model. Tier values are constrained to the literal union \`fast | balanced | powerful\` — anything else is dropped at resolve time and the default tier survives.

The first three reads are non-negotiable. The **ethos read** is prepended one position above the agent contract because the five cclaw principles (Boil the Lake / Search Before Building / Surgical Edits / User Sovereignty / 3 knowledge layers) shape HOW every specialist interprets its own contract — a specialist that reads its agent file without the ethos will silently default to Layer 2 "popular" patterns where the codebase already has a Layer 1 "tried-and-true" answer. The ethos lives at \`.cclaw/lib/cclaw-ethos.md\` (single file, written at install time from \`src/content/ethos.ts\`); specialists do NOT restate the ethos in their own prompt body (dedup — the per-specialist Iron-Law restatements that pre-dated this preamble were removed because they drifted across specialists). A sub-agent that skips its contract file will hallucinate its own role definition (we observed this in production — early discovery specialists ran with a 30-line summary instead of their full contract). If the harness has a sub-agent system message, the orchestrator places those three reads as the sub-agent's first instructions; if the harness dispatches via plain "spawn a fresh context", the orchestrator puts them at the top of the inline prompt. Either way, the sub-agent opens \`.cclaw/lib/cclaw-ethos.md\` before \`.cclaw/lib/agents/<specialist>.md\` before doing anything else.

## Inline-fallback (no sub-agent dispatch support)

If the harness does not support sub-agent dispatch, run the specialist inline in a fresh context (clear the prior conversation if you can). Record the fallback in the artifact's frontmatter (\`subAgentDispatch: inline-fallback\`). This is not an error.

## What the sub-agent must NOT do

- dispatch other specialists (composition is the orchestrator's job, not theirs);
- push, rebase, force-update, or merge branches (the orchestrator owns the ship stage);
- modify files outside the slug's touch surface.

In strict mode the builder commits each AC with the posture-driven prefix (\`red(AC-N): ...\` / \`green(AC-N): ...\` / \`refactor(AC-N): ...\` / \`test(AC-N): ...\` / \`docs(AC-N): ...\`); the reviewer verifies the chain ex-post via \`git log --grep="(AC-N):"\`. In soft / inline mode plain \`git commit\` is fine (one cycle for the feature).
`;

const PARALLEL_BUILD = `# On-demand runbook — parallel-build fan-out

Open this runbook only when the architect artifact declares \`topology: parallel-build\` with ≥2 slices AND \`ceremonyMode == strict\`. For sequential build, see \`.cclaw/lib/runbooks/build.md\`.

## Trigger

When the architect artifact declares \`topology: parallel-build\` with ≥2 slices and \`ceremonyMode == strict\`, the orchestrator fans out one \`builder\` sub-agent per slice, **capped at 5**, each in its own \`git worktree\`. This is the only fan-out cclaw uses outside of \`ship\`.

## Fan-out shape

\`\`\`text
                                  flows/<slug>/plan.md
                                  topology: parallel-build
                                  slices: [s-1, s-2, s-3]   (max 5)
                                              │
                                              ▼
                            git worktree add .cclaw/worktrees/<slug>-s-1 -b cclaw/<slug>/s-1
                            git worktree add .cclaw/worktrees/<slug>-s-2 -b cclaw/<slug>/s-2
                            git worktree add .cclaw/worktrees/<slug>-s-3 -b cclaw/<slug>/s-3
                                              │
                          ┌───────────────────┼───────────────────┐
                          ▼                   ▼                   ▼
                   builder         builder         builder
                   (s-1; AC-1, AC-2)     (s-2; AC-3)           (s-3; AC-4, AC-5)
                   cwd: …/<slug>-s-1      cwd: …/<slug>-s-2     cwd: …/<slug>-s-3
                   RED→GREEN→REFACTOR     RED→GREEN→REFACTOR    RED→GREEN→REFACTOR
                   per AC, in slice       per AC, in slice      per AC, in slice
                          │                   │                   │
                          └───────────────────┼───────────────────┘
                                              ▼
                              reviewer (mode=code, integration sweep)
                                  reads each branch, checks
                                  cross-slice conflicts, AC↔commit
                                  chain across the wave
                                              │
                                              ▼
                          merge cclaw/<slug>/s-1 → main, then s-2, then s-3
                          (fast-forward when wave was clean; otherwise stop and ask)
                                              │
                                              ▼
                          git worktree remove .cclaw/worktrees/<slug>-s-N (per slice)
\`\`\`

## Dispatch envelope (per slice)

\`\`\`
Dispatch builder
─ Stage: build
─ Slug: <slug>
─ Slice: s-N  (acIds: [AC-N, AC-N+1])
─ Working tree: .cclaw/worktrees/<slug>-s-N
─ Branch: cclaw/<slug>/s-N
─ Ceremony mode: strict
─ Touch surface (only paths this slice may modify): [<paths from plan>]
─ Output: .cclaw/flows/<slug>/build.md (append, marked with slice id)
─ Forbidden: read or modify any path outside touch surface; read another slice's worktree mid-flight; merge or rebase
\`\`\`

## After every builder returns

1. Patch \`flow-state.json\` with the per-slice progress.
2. When **every** slice has reported, dispatch \`reviewer\` mode=\`code\` (integration sweep; one sub-agent, reads from each branch).
3. On clear integration review, merge slices into main one at a time. On block, dispatch \`builder\` mode=\`fix-only\` against the cited file:line refs, then re-run the reviewer.
4. Worktree cleanup happens after merge; the cclaw branches stay until ship.

## Hard rules

- **More than 5 parallel slices is forbidden.** If architect produced >5, the architect must merge thinner slices into fatter ones before build; do not generate "wave 2".
- Slice-builders never read each other's worktrees mid-flight. A slice that detects a conflict with another stops and raises an integration finding.
- **Parallel-build fallback (T1-5)** — when the harness lacks sub-agent dispatch or worktree creation fails (non-git repo, permissions, dirty working tree, harness limit reached), parallel-build degrades to inline-sequential. The fallback is **not silent**:
  - Render an explicit warning to the user in their language naming the cause (e.g., "harness does not support parallel sub-agents — falling back to sequential build, will run AC-1..AC-N one after another"), AND
  - Use the harness's structured ask to surface a single \`accept-fallback\` option (and inform the user they may invoke \`/cc-cancel\` themselves if the loss of parallelism makes the work not worth doing under sequential timing) — the orchestrator must wait for the user's explicit \`accept-fallback\` reply before dispatching the sequential builder. The parallel→sequential decision changes wall-clock substantially; the user gets to make the call.
  - Record the fallback in \`flows/<slug>/build.md\` frontmatter (\`subAgentDispatch: inline-fallback\`, \`fallback_reason: <one-line>\`, \`fallback_accepted_at: <iso>\`) so the reviewer sees it. The fallback is not an error, but it is a visible event with a recorded user-acknowledgement.
- always-auto applies to chained stages; the integration-review ask above still surfaces because a parallel→sequential fallback materially changes wall-clock budgets, and that is a user-visible decision rather than an internal verdict.
`;

const FINALIZE = `# On-demand runbook — finalize (ship → shipped)

Open this runbook **only after the compound step completes** and \`flows/<slug>/ship.md\` carries \`status: shipped\`. Finalize is the orchestrator's job, never a sub-agent's.

## Per-AC verified gate (precondition, available)

Before running any of the steps below, run the per-criterion verified gate. The gate is the precondition: finalize is refused when any AC failed verification, with no silent escape hatch.

### Gate procedure

1. Read \`flow-state.json > triage.ceremonyMode\`.
2. If \`ceremonyMode == "inline"\` — gate **skipped**; finalize may proceed (inline mode has no per-criterion tracking).
3. Otherwise, parse the \`AC verified:\` line from:
   - **strict mode** — the latest builder slim summary (last \`build\` or \`fix-only\` cycle that returned \`continue\`) AND the latest reviewer slim summary. The reviewer's line takes precedence when the two disagree; reviewer's evidence is authoritative because builder's attestation is self-reported.
   - **soft mode** — same two summaries, looking for the single \`feature=yes|no\` token.
4. Evaluate:
   - **All ACs (strict) or feature (soft) have \`=yes\`** → gate **passes**; proceed to Steps 1-8 below.
   - **Any AC has \`=no\`** OR **the \`AC verified:\` line is missing from either summary** → gate **fails**; orchestrator **refuses finalize** and surfaces a structured ask:

\`\`\`
Per-AC verification gate failed before finalize.

Unverified ACs from latest slim summaries:
- <list each AC-N with verified=no, with the source summary cited (builder iteration N, reviewer iteration N)>
- <e.g. "AC-3 verified=no (builder iter 2 — slim summary line 4); reviewer iter 1 confirmed: open F-2 required finding tied to AC-3">

Options:
[1] Bounce to builder fix-only to close the unverified AC.
[2] Show the latest slim summaries.
[3] Stay paused — end the turn.
\`\`\`

The gate **never** auto-rescues — there is no \`accept-unverified-and-finalize\` option. The slug stays in active state until either every AC is \`=yes\` (gate passes naturally) or the user types \`/cc-cancel\` to discard the flow explicitly. The rationale: finalize moves artifacts into \`flows/shipped/<slug>/\` and resets \`flow-state.json\`; once finalized, the unverified AC is invisible to the next \`/cc\` run, and the slug-vs-shipped-AC drift becomes permanent.

### Edge cases

- **\`AC verified\` line missing from builder summary** — treat as \`every AC = no\`. The builder is required to emit the line (see builder prompt § Slim summary). Missing line is a fix-only bounce on the builder itself — the orchestrator dispatches \`builder mode=fix-only\` with a one-line note: "re-emit slim summary with \`AC verified\` line".
- **\`AC verified\` line missing from reviewer summary** — same treatment; the reviewer is required to emit the line. Bounce dispatches \`reviewer mode=code\` with a one-line note.
- **builder says \`AC-N=yes\` but reviewer says \`AC-N=no\`** — reviewer wins. The reviewer's downgrade reflects evidence in the ledger; builder's claim is self-reported and the gate respects the second opinion.
- **builder says \`AC-N=no\` but reviewer says \`AC-N=yes\`** — builder wins. The build couldn't verify itself; reviewer's \`yes\` is a process error (reviewer should have downgraded). Bounce to builder fix-only to close AC-N legitimately, then re-review.
- **inline ACs intermixed with strict ACs** is structurally impossible — \`ceremonyMode\` is per-flow, not per-criterion. If you observe this in the wild, the flow-state is corrupted; surface and stop.

This gate adds one network-free check to every finalize step. It exists because the older \`Open findings\` counter was too coarse — a slug could have \`Open findings: 0\` and still ship with an AC that was silently deferred ("AC-3 deferred — follow-up slug"). The per-criterion line forces the deferral to be explicit and forces the orchestrator to ask before letting the gap close silently.

## Steps (in order, in the orchestrator's own context)

1. **Pre-condition check.** \`flows/<slug>/ship.md\` exists with \`status: shipped\` (or equivalent gate). If the gate is \`block\`, do NOT finalise — stay paused. If the path was \`inline\` (trivial), there is nothing to finalise; skip finalize entirely. **Per-AC verified gate** (above) must have passed; if it has not, do NOT finalise.
2. **Create the shipped directory.** \`mkdir -p .cclaw/flows/shipped/<slug>\`. Idempotent: if the directory already exists (re-run, race), continue without error.
3. **Move every artifact.** Use \`git mv\` when the repo is a git workspace and the active flow files are tracked; otherwise plain \`mv\`. Move (do NOT copy) every file in \`flows/<slug>/\`:
   - \`plan.md\`
   - \`build.md\` (when present)
   - \`review.md\` (when present)
   - \`ship.md\`
   - \`decisions.md\` (when present — large-risky only, legacy shipped flows)
   - \`learnings.md\` (when written by the compound step)
   - \`pre-mortem.md\` (only on \`legacy-artifacts: true\` — default collapses pre-mortem into \`review.md\` as a section)
   - \`research-repo.md\` (when written by repo-research)
   - \`research-learnings.md\` (only on \`legacy-artifacts: true\` — default keeps learnings inline in the architect's slim-summary)
   The word "copy" must not appear in the dispatch envelope or in your own actions. \`cp\` is forbidden here. The active directory must end up empty after the moves.
4. **Stamp the shipped frontmatter on \`ship.md\`.** manifest.md is collapsed into \`ship.md\`'s frontmatter. Update \`ship.md\`'s frontmatter to include the final flow signals (snake_case keys per artefact-frontmatter convention): \`slug\`, \`shipped_at\`, \`ceremony_mode\`, \`complexity\`, \`security_flag\`, \`review_iterations\`, \`ac_count\`, \`finalization_mode\`. Body of \`ship.md\` keeps the AC↔commit map (strict) or condition checklist (soft); add an "## Artefact index" section listing the artefacts that ended up in the shipped dir (one bullet per file). Users on the opt-in \`legacy-artifacts: true\` config still get a separate \`manifest.md\` in addition.
5. **Post-condition check (mandatory).** \`flows/<slug>/\` (the active directory) must be empty. If it is not, you have made a mistake — list the residue, surface it to the user, do NOT continue. The most common cause is mistakenly using \`cp\` instead of \`git mv\`/\`mv\`. Once the active dir is empty, \`rmdir flows/<slug>\` to remove the now-empty directory.
6. **Promote ADRs (PROPOSED → ACCEPTED).** Scan \`flows/shipped/<slug>/plan.md\` (just moved in step 3; D-N records are inlined there) and any legacy \`flows/shipped/<slug>/decisions.md\` (shipped flows) for \`ADR: docs/decisions/ADR-NNNN-<slug>.md (PROPOSED)\` lines. For each found ADR file, edit the frontmatter in place: \`status: PROPOSED\` → \`status: ACCEPTED\`; add \`accepted_at: <iso>\`; add \`accepted_in_slug: <slug>\`; add \`accepted_at_commit: <ship-commit-sha>\`. Commit each promotion with \`docs(adr-NNNN): promote to ACCEPTED via <slug>\`. Skip the entire step when no PROPOSED ADR was found. Do NOT promote ADRs the architect did not propose for this slug. See \`.cclaw/lib/skills/documentation-and-adrs.md\` for the full lifecycle (including supersession bookkeeping for ADRs that supersede an earlier ACCEPTED one).
7. **Reset flow-state.** Write \`createInitialFlowState\` defaults to \`.cclaw/state/flow-state.json\` (\`currentSlug: null\`, \`currentStage: null\`, \`triage: null\`, \`ac: []\`, \`reviewIterations: 0\`, \`securityFlag: false\`, \`lastSpecialist: null\`). The shipped manifest is the durable record; flow-state is now a clean slot ready for the next \`/cc\`.
8. **Render the final summary** to the user: one block citing \`shipped/<slug>/ship.md\` (the file that now carries the manifest frontmatter — or \`shipped/<slug>/manifest.md\` on \`legacy-artifacts: true\`), the AC count, any captured learnings, and any ADR ids promoted to \`ACCEPTED\` in step 6.

## Hard rules

- **No "copy" anywhere.** Sub-agent dispatches do NOT mention copying. The orchestrator's own actions use \`git mv\` (preferred when the files are git-tracked) or \`mv\` (when not). \`cp\` is a bug.
- **No partial finalize.** If any \`mv\` fails (filesystem error, permission, lock), stop and surface the failure. Do not leave half the flow in shipped and half in active.
- **No re-entrant finalize on resume.** If \`flows/<slug>/\` is already empty when you reach finalize (a previous run finalised), check that \`shipped/<slug>/ship.md\` exists with \`status: shipped\` in its frontmatter; if it does, this slug is already shipped — reset flow-state and tell the user "already finalised in <iso>". Do NOT recreate the artefacts. (On \`legacy-artifacts: true\` you can also key off \`shipped/<slug>/manifest.md\`.)
`;

const CAP_REACHED_RECOVERY = `# On-demand runbook — cap-reached recovery (review iteration 5)

Open this runbook **only when \`flow-state.json > reviewCounter\` reaches 5** without convergence. For the standard review loop, see \`.cclaw/lib/runbooks/review.md\`.

## Review-cap (stop-and-report)

Track the cap with \`flow-state.json > reviewCounter\` (introduced sibling of \`reviewIterations\`; \`reviewIterations\` continues to be the monotonic lifetime counter, \`reviewCounter\` is the cap-budget that the user can extend). Increment \`reviewCounter\` on every reviewer dispatch in parallel with \`reviewIterations\`. flows resumed on start at \`reviewCounter: 0\` even if \`reviewIterations\` already reflects prior dispatches — the cap is a fresh budget on resume.

**When \`reviewCounter\` reaches \`5\`**, do NOT dispatch another reviewer. Stop and report per the always-auto failure matrix (\`runbooks/always-auto-failure-handling.md\`). The reviewer auto-fix loop is capped at 3 iterations by the always-auto matrix; a slug reaching \`reviewCounter == 5\` means a prior \`keep-iterating-anyway\` override (see below) bought two extra rounds and the flow still failed to converge. The status block names the iteration count, the residual blockers, and the canonical recovery options:

1. \`/cc-cancel\` to discard the slug and reapply the cap-reached split-plan below (orchestrator authors the recommended split into \`review.md\`, the user starts the first split slug fresh).
2. \`/cc\` (continue) after the user edits the diff to address residual findings. Resume re-dispatches reviewer with \`reviewCounter\` reset to 3 (the always-auto matrix replaces the legacy \`keep-iterating-anyway\` picker with explicit user re-invocation; the audit-log entry stamped on resume records \`iterationOverride: true\` for telemetry).

The split-plan and architecture severity gates below stay verbatim — they describe the *content* the orchestrator authors into \`review.md\` before the stop-and-report, not the picker mechanics.

## Cap-reached split-plan (T1-10)

When the 5th iteration ends without \`clear\` or \`warn\`, the review **does not just surface "residual blockers"**; the orchestrator (with the reviewer's help) authors a **split/handoff mini-plan** in the same review.md iteration block, under \`## Cap-reached recovery\`:

1. **Why we stopped** — one sentence: which findings persisted across iterations 4-5, what fix attempts converged or oscillated.
2. **Recommended split** — list of follow-up slugs the orchestrator should propose (\`<slug>-fix-A\`, \`<slug>-rearchitect-B\`, etc.) with one bullet per slug naming what AC / surface that slug would own. The split is the actionable path forward, not just a list of complaints.
3. **What ships now (if anything)** — a yes/no with reason. When AC-1..AC-K are clean and AC-K+1..AC-N are blocked, the recommendation is "ship AC-1..AC-K under the current slug, open \`<slug>-followup\` for the rest". When everything is entangled, the recommendation is "ship nothing under this slug; open \`<slug>-rearchitect\`".
4. **Handoff envelope** — for each recommended split slug, the input artifact references (\`flows/<slug>/plan.md#AC-3\`, \`flows/<slug>/review.md#F-7\`) the next slug should preload.

After this block is authored, the orchestrator surfaces a structured ask to the user with the split options (or "discard, re-triage from scratch"). \`/cc-cancel\` remains available as a typed command for nuking the slug.

## Architecture severity gates ship (always-auto stop-and-report)

The reviewer prompt's "Architecture severity priors" rule names a stronger gate: an unresolved finding with \`severity=required\` AND \`axis=architecture\` **gates ship across every ceremonyMode** — not only in \`strict\`. The orchestrator enforces this at the ship gate: when the open ledger contains any \`required + architecture\` row, the always-auto chain stops and reports (per \`runbooks/always-auto-failure-handling.md\`) rather than auto-advancing. The status block names the \`required + architecture\` finding(s) and offers \`/cc\` (continue after the user edits the diff to resolve the architecture finding, or accepts the warning by editing review.md to downgrade the row before resume) or \`/cc-cancel\` (discard). Other \`severity=required\` findings continue to follow the standard ceremonyMode table (gate in strict, carry-over in soft).

Concretely: when the reviewer's slim summary marks \`ship_gate: architecture\` (set whenever a \`required + architecture\` row is open), the orchestrator does NOT auto-advance to ship. The legacy in-chat picker options (\`accept-warns-and-ship\`, \`fix-only\`, \`stay-paused\`) are retired — the user resolves the gate by editing the relevant artifact and re-invoking \`/cc\`, or discards with \`/cc-cancel\`.
`;

const HANDOFF_GATES = `# On-demand runbook — handoff gates (self-review before reviewer, ship before push)

Open this runbook on **two** pre-handoff inspections:

- After every builder return, **before deciding whether to dispatch the reviewer** (see \`## Pre-reviewer dispatch gate (self-review)\` below). Cheap to run (you already have the JSON in context) and saves one full reviewer cycle per failed attestation.
- After the review stage is clear / warn, **before any push / PR action** (see \`## Pre-ship dispatch gate (ship-gate)\` below). The ship gate is where the orchestrator surfaces a structured ask to the user.

Both surfaces share a pre-handoff inspection shape: read the latest slim summary or ledger, evaluate a deterministic rule, and either advance or bounce. The two sections below carry the per-gate procedure.

## Pre-reviewer dispatch gate (self-review)

### What builder returns

builder's strict-mode JSON summary returns a \`self_review\` array with five rule attestations per AC: \`tests-fail-then-pass\`, \`build-clean\`, \`no-shims\`, \`touch-surface-respected\`, \`coverage-assessed\`. (Soft mode: one block per rule with \`ac: "feature"\`.) Each entry carries \`verified: true|false\` and a non-empty \`evidence\` string.

Before you dispatch the reviewer, **inspect \`self_review\`** in your own context. The reviewer never sees this field; it is your gate.

### Decision rule

- **All entries \`verified: true\` AND \`evidence\` non-empty** → dispatch reviewer normally.
- **Any \`verified: false\`** OR **any empty/missing \`evidence\`** OR **\`self_review\` array missing entirely** → **bounce the slice straight back to builder with mode=fix-only**, citing the failed rule(s) and the builder's own evidence string in the dispatch envelope. Do NOT dispatch reviewer.

### Fix-only bounce envelope

The fix-only bounce envelope reuses the builder dispatch envelope shape; the "Inputs" line names the failed rules instead of a Findings fix list:

\`\`\`
Dispatch builder
─ Stage: build (self-review fix-only)
─ Slug: <slug>
─ AC: <AC-N> (the AC whose self_review failed)
─ Failed rules: <one line per failed rule, copying the builder's own evidence>
─ Output: .cclaw/flows/<slug>/build.md (append a "Self-review fix" iteration block above the existing Summary)
─ Then: re-emit the strict-mode JSON summary with self_review[] re-attested
\`\`\`

### Escalation on repeated failures

Repeated self-review failures (third bounce) escalate to user: render the failed evidence and ask whether to continue or split the AC.

### Parallel-build behaviour

In parallel-build the gate runs **per slice**: a slice whose self-review fails bounces back; **healthy slices proceed** to integration review independently. Do not block a clean slice waiting on a sibling's fix-only loop.

## Pre-ship dispatch gate (ship-gate)

### Ship-stage reviewer dispatch

The ship stage dispatches a single reviewer:

- \`reviewer\` mode=\`code\` (release sweep) — always. Includes the \`security\` axis at full threat-model depth when \`security_flag\` is true (absorbed from the former \`security-reviewer\` specialist).

Inputs: \`.cclaw/flows/<slug>/plan.md\`, build.md, review.md.

**Shared diff context (single parse pass).** Before the dispatch, run \`git diff --stat <plan-base>..HEAD\` and \`git diff --name-only <plan-base>..HEAD\` once in the orchestrator's context. Pass the parsed shape (touched files list, additions/deletions per file, total LOC delta) to the reviewer in the dispatch envelope under a \`Shared diff:\` block. The release-sweep reviewer reads everything; its security-axis sweep prioritises files matching sensitive patterns when \`security_flag\` is true. The reviewer still independently \`git show <SHA>\` per finding to read commit-level context; only the aggregated diff shape is shared.

Output: \`.cclaw/flows/<slug>/ship.md\` with the go/no-go decision, AC↔commit map (strict) or condition checklist (soft), release notes, and rollback plan.

After ship, run the compound learning gate.

### Ship-gate user ask (finalization mode)

When the ship gate is passed (Victory Detector green) and finalization is required, the orchestrator surfaces a structured ask to the user. First it **infers the recommended finalization from repo signals** — read once, in the orchestrator's own context, before building the ask:

| Repo signal | Recommended default |
| --- | --- |
| no \`.git/\` (or \`triage.downgradeReason: "no-git"\`) | \`no-vcs\` |
| git, no \`origin\` remote | \`merge\` (local merge into base) |
| git + remote + \`gh\` CLI available + a PR/CI convention (\`.github/workflows/\` present OR open PRs exist) | \`open-PR\` |
| git + remote, no PR convention | \`push-only\` |

The ask still lists all five \`finalization_mode\` enum values (full power retained), but the inferred one is surfaced **first and labelled "(recommended)"** with a one-clause "why" — so the common case is a single confirming tap, not a cold pick from five. **\`Cancel\` is NOT one of them**. \`/cc-cancel\` remains the explicit user-typed command for discarding a flow; structured asks for finalization MUST NOT include a "Cancel" row, because choosing "Cancel" mid-finalization leaves shipped artefacts in a half-moved state with no defined recovery.

\`\`\`
askUserQuestion(
  prompt: <one sentence in the user's language stating: ship gate passed; the recommended finalization is <inferred mode> because <one-clause repo-signal reason>; choose how to finalize the slug>,
  options: [
    <the inferred-default option, listed FIRST, label suffixed "(recommended)" + its expected git behaviour>,
    <the remaining four finalization_mode options, in enum order, each with its expected behaviour:
       merge into base branch locally (verify clean merge, record merged SHA) /
       open a PR with structured body (gh pr create, record URL) /
       push the branch upstream and stop (git push -u origin HEAD) /
       discard the branch locally — requires typed confirmation next turn /
       no VCS available — record a manual handoff target and rollback owner>
  ],
  multiSelect: false
)
\`\`\`

If the user wants to abandon the flow at this point, they type \`/cc-cancel\` (out-of-band of the structured ask). The orchestrator does not pre-offer that as a clickable option, because:
1. The flow has already passed code-mode review + the critic's pre-mortem; cancelling here is unusual.
2. The shipped artefacts may have already been partially written (manifest-as-frontmatter, learnings.md); cancelling mid-finalize requires a different recovery path than \`/cc-cancel\` from earlier stages.

### Post-ship micro-edit hint

After every successful ship (regardless of finalization mode), the orchestrator surfaces a one-line plain-prose hint pointing the user at the refine entry point:

> "If you need to adjust this slug after shipping, run \`/cc <slug> <description>\` — triage picks the ceremony (a tiny tweak lands as a single-commit patch, anything larger runs the full refine)."

The hint mechanics:

- **One line, plain prose** in the user's language (the mechanical tokens \`/cc\`, \`<slug>\`, and \`<description>\` stay English — they're the wire protocol).
- **Always emitted** on a clean ship — every finalization mode (merge / open-PR / push-only / discard-local / no-vcs) surfaces the same hint. The hint is non-coercive informational text; it does NOT block, does NOT add a structured ask, does NOT consume an iteration of the chain.
- **Substitute \`<slug>\` for the just-shipped slug** when rendering the hint to the user — the literal slug (\`20260514-auth-flow\`) lands in the prose so the user can copy-paste the suggestion verbatim. \`<description>\` stays as a placeholder.
- **Refine trade-off**: when triage downgrades the follow-up to inline it skips architect, plan-critic (all rubrics — generic / design / devex), qa, critic, and the ship-gate ask (single commit + \`patch-N.md\` next to the parent). Tasks that touch ≥3 files, add a new AC, or carry schema/migration/auth/public-API wording will NOT downgrade — they run the full soft/strict refine with its review + critic passes. Full procedure in \`runbooks/refine-mode.md\`.

The hint exists so post-ship "tiny tweak" tasks have a frictionless entry point. Dogfooded slugs routinely paid the full ceremony cost on 2-line follow-ups; surfacing the refine option immediately after ship is the cheapest place to teach the user the fork exists.

### Ship-gate decision matrix

| reviewer:code release sweep (incl. security axis) | gate |
| --- | --- |
| clear | clear → ship may proceed |
| block | block → fix-only loop |

The \`security\` axis is one of the reviewer's nine axes (absorbed the former \`security-reviewer\` specialist). A \`block\`-severity finding on \`security\` is handled the same as a \`block\` on any other axis — block → fix-only loop. \`security_flag: true\` in plan frontmatter forces the reviewer to walk the security axis at full threat-model depth (authn / authz / secrets / supply chain / data exposure / encoding / taint) regardless of which surfaces the diff touched.

The adversarial pre-mortem is no longer part of the ship gate — it runs earlier, in the \`critic\` post-implementation pass (strict, or soft + risk trigger). See \`critic-steps.md\`.
`;

const HANDOFF_ARTIFACTS = `# On-demand runbook — handoff artifacts (HANDOFF.json + .continue-here.md)

Open this runbook **after every stage exit** — at the end of plan / build / review / ship. The unified flow runs the entire plan stage as a single architect dispatch (no Phase 7 sign-off; no Phase 1 Clarify pause); the architect's dispatch return is the stage exit for plan. HANDOFF.json is for resume-across-sessions checkpoints, not for intra-dispatch checkpoints.

## HANDOFF.json schema

\`\`\`json
{
  "slug": "<slug>",
  "stage_completed": "plan | build | review | ship",
  "stage_started_at": "<iso>",
  "stage_completed_at": "<iso>",
  "next_stage": "build | review | ship | done",
  "next_specialist": "<id> | null",
  "open_findings": <count>,
  "review_iterations": <count>,
  "feasibility_stamp": "green | yellow | red | null",
  "ci_smoke_passed": <boolean | null>,
  "release_notes_filled": <boolean | null>,
  "security_flag": <boolean>,
  "blocked_by": <"low-confidence" | "review-pause" | "cap-reached" | "user-decline" | null>,
  "resume_command": "/cc",
  "resume_envelope": {
    "required_first_read": ".cclaw/lib/agents/<next_specialist>.md",
    "required_second_read": ".cclaw/lib/skills/<next_wrapper>.md",
    "inputs": [".cclaw/state/flow-state.json", ".cclaw/flows/<slug>/<next_stage>.md", "..."]
  }
}
\`\`\`

## .continue-here.md shape (rendered in user's conversation language)

\`\`\`markdown
# Continue here — <slug>

**Stage just completed:** <stage> (<one-sentence verdict in user's language>)
**Where we are:** <one-sentence summary of the slug's current state — AC count, review iterations, open findings>
**What's next:** <one-sentence description of the next stage in user's language>
**To resume:** \`/cc\`  (or \`/cc-cancel\` to discard the slug)

## Open questions or pauses
- <bullet per pending decision the user must make; empty when none>

## Recent activity
- <last 3-5 specialist returns in chronological order, each as one short bullet>
\`\`\`

## Lifecycle

- Each stage exit (or discovery checkpoint) **rewrites both files from scratch** — they are idempotent snapshots, not appended logs. Stale data is the ship.md bug applied to handoff state; the fix is "always re-author".
- \`runCompoundAndShip\` moves both files into \`shipped/<slug>/\` alongside the canonical 7 stages (the T0-10 directory scan handles them automatically). Shipped flows preserve their final HANDOFF.json + .continue-here.md as a record of how the slug ended.
- \`/cc-cancel\` moves both into \`cancelled/<slug>/\`.
- The detect step may consult \`HANDOFF.json\` as a fallback when \`flow-state.json\` is missing or unparseable (hardening: file may be deleted by accident, but HANDOFF.json snapshots can rebuild the resume context).

## When the orchestrator rewrites

When a sub-agent dispatch's slim-summary returns, the orchestrator: (1) patches \`flow-state.json\`; (2) re-renders both handoff files; (3) renders the slim summary in the conversation; (4) ends the turn. Step 2 is mandatory — skipping it leaves the next \`/cc\` invocation rebuilding context the wrong way.
`;

const COMPOUND_REFRESH = `# On-demand runbook — compound refresh + discoverability self-check

Open this runbook **after a compound capture writes a line to \`.cclaw/state/knowledge.jsonl\`**, when:

- \`knowledge.jsonl\` line count is a multiple of 5 after the new line is appended (compound-refresh trigger).

(retired the manual stage-shortcut router that previously exposed an on-demand entry point; the 5-line cadence is now the sole trigger.)

For the compound gate itself (does this slug capture learnings?), see start-command's Compound step.

## Compound-refresh sub-step (T2-4, everyinc pattern)

Every **5th** capture, the orchestrator runs a **knowledge-refresh** pass over the file. The point: append-only is durable but lossy on signal-to-noise — duplicates accumulate, superseded findings persist, and cross-cutting themes never get consolidated. The refresh applies six actions to the existing entries (the \`recall_count\` each entry carries is already current — the compound step stamps it from the flow's \`Recalled-priors\` lines BEFORE this refresh runs):

1. **dedup** — entries whose touchSurface + tags + learnings shape are near-identical (Jaccard ≥ 0.8 over the touchSurface union AND tags union AND verbatim-overlap of learnings). Keep the most recent entry, mark the others \`status: dedup-of <newer-slug>\`. The newer entry inherits the older entries' \`historicSlugs: []\` array so the lineage isn't lost.
2. **keep** — entry is unique, non-stale, still cited by at least one open antipattern reference. No change.
3. **update** — entry is unique but a later slug refined the lesson (different phrasing, sharper boundary). Patch the entry's \`learnings\` field with the newer phrasing; keep the older slug citation alongside the newer one. Mark \`refined_at: <iso>\`, \`refined_via_slug: <newer-slug>\`.
4. **consolidate** — 2+ entries on the same theme but different surfaces (e.g., 3 entries about "fix-only loops on auth flows that drifted in scope"). Merge into a single entry with a richer learnings paragraph and \`mergedFrom: [slug-list]\`. The merged entry's \`learnings\` is authored by the orchestrator (synthesis), not copy-paste.
5. **replace** — old entry is genuinely superseded (architecture changed, library replaced). Keep the old entry but mark \`status: superseded-by <newer-slug>\`; the search/scoring layer treats superseded entries as \`-2\` to keep them out of top-3 picks but still findable for archaeology.
6. **prune (recall-aware)** — the compounding half of the loop. An entry with \`recall_count: 0\` (or absent) AND a cautionary \`outcome_signal\` (\`reverted\` / \`follow-up-bug\` / \`manual-fix\`) AND \`shipped_at\` older than the \`compoundRefreshFloor\` window is noise that never paid off at a quality gate: mark \`status: pruned-low-signal\` (scored \`-2\`, like \`superseded\` — out of top-3 picks but still findable). Conversely, an entry with a **rising \`recall_count\`** and a non-cautionary outcome (\`good\` / \`unknown\`) is proven-useful: never prune it, and prefer it in the top-3 (\`recall_count\` breaks ties above raw recency). Lessons that keep getting recalled at the reviewer / critic gates rise; lessons that never get recalled fade — that is what makes the store compound rather than merely accumulate.

The refresh runs **inline in the orchestrator's context** as the 5th capture finishes. Output: a new \`.cclaw/knowledge-refresh-<iso>.md\` log file (one block per action, citing slug ids) so the user can see what changed. Failures (file unparseable, IO error) write the log but skip the actions; the original \`knowledge.jsonl\` is unchanged.

## Trigger thresholds (configurable in \`.cclaw/config.yaml\`)

- \`compoundRefreshEvery: 5\` — run every Nth capture; default 5; set to \`0\` to disable.
- \`compoundRefreshFloor: 10\` — skip refresh until \`knowledge.jsonl\` has ≥10 lines (otherwise the refresh has nothing to dedup against).

The refresh is implicit on the cadence above; there is no user-facing manual entry point (retired the stage-shortcut router that exposed one).

## Discoverability self-check (T2-12)

After ship completes (finalize done), the orchestrator scans \`AGENTS.md\` / \`CLAUDE.md\` / \`README.md\` for any mention of \`knowledge.jsonl\` or \`flows/shipped/\`. When **none** of these files mention either path, the orchestrator surfaces a one-line note in the user's language ("This project's knowledge.jsonl now has N entries but the AGENTS.md / CLAUDE.md / README.md don't reference it. Want me to add a 1-line discovery note so future agents know it exists? [add / skip-this-time / never]"). The user picks; on \`add\`, the orchestrator appends a single line to the most appropriate root file (preferring AGENTS.md, then CLAUDE.md, then README.md):

\`\`\`markdown
- \`.cclaw/knowledge.jsonl\` — append-only learnings catalogue from cclaw flows; cclaw specialists read this before authoring plans (\`learnings-research\` helper).
\`\`\`

This makes the catalogue discoverable to future agents/humans who don't already know cclaw's conventions. Without the note, a fresh contributor (or a different harness's bootstrap) won't know it exists.

The discoverability check runs **once per slug** (only when ship completes), and respects the user's \`never\` choice for the rest of the session.
`;

const PAUSE_RESUME = `# On-demand runbook — pause and resume mechanics (always-auto)

The orchestrator opens this runbook on every stage exit when \`triage.path\` is **non-inline** (i.e., the path contains any of \`plan\` / \`review\` / \`ship\`, not just \`build\`). Inline / trivial paths (\`triage.path == ["build"]\`) never pause — they skip pause/resume entirely, so they never open this runbook.

the user-facing \`step\` / \`auto\` choice was retired. Every non-inline flow runs **always-auto** end-to-end with no approval pickers at the plan / review / critic gates. The orchestrator chains stages automatically; \`/cc\` is the resume verb that fires only after a stop-and-report status block (see \`runbooks/always-auto-failure-handling.md\` for the failure matrix and the canonical status-block shape). The orchestrator body keeps the orchestrator-wide invariants (\`/cc\` is the only resume verb, \`Confidence: low\` is a hard gate, hard failures route per the always-auto matrix). The full mechanics — including the resume-from-fresh-session rules and the chain-vs-stop decision — live here.

## Always-auto chain rule

After every dispatch returns: (1) render the **cockpit line** to the user — a plain-language digest of the slim summary, never the raw envelope (see start-command \`### Cockpit render\`: stage label not specialist, no axis tokens / \`AC-N\` / SHAs / ceremony; the full artifact is on disk for the next stage's sub-agent and for any user who wants the detail); (2) re-author \`HANDOFF.json\` + \`.continue-here.md\` (see \`runbooks/handoff-artifacts.md\`); (3) **immediately dispatch the next stage** in \`triage.path\` — no waiting, no approval picker — UNLESS one of the always-auto hard-failure conditions fires (see \`runbooks/always-auto-failure-handling.md\`).

The architect dispatch runs silently as a single on-demand sub-agent (unified flow). There is no mid-plan Clarify dialogue and no Phase 7 sign-off pause; the orchestrator chains automatically once the architect's slim summary returns.

## Stop-and-report (the only thing that ends the turn)

The orchestrator ends its turn ONLY when a hard-failure condition fires (per the always-auto matrix in \`runbooks/always-auto-failure-handling.md\`). The stop-and-report status block is plain prose; the user re-invokes \`/cc\` (continue) or \`/cc-cancel\` (discard) from the command palette. There is no in-chat picker.

## Confidence as a hard gate (always-auto)

Every slim summary carries a \`Confidence: high | medium | low\` line — a quality signal for the dispatch that just returned, not a prediction of the next stage:

- \`high\` — chain to next stage normally.
- \`medium\` — render the cockpit line inline with a "— medium confidence, see Notes" suffix; chain anyway. The \`Notes:\` line is required when confidence is medium.
- \`low\` — **hard gate.** Stop chaining and surface the stop-and-report status block (per \`runbooks/always-auto-failure-handling.md\`) with the specialist's \`Notes\` verbatim. User reads, decides, and recovers via \`/cc\` (continue under a follow-up) or \`/cc-cancel\` (discard).

A specialist returning \`Confidence: low\` MUST write a non-empty \`Notes:\` line explaining the dimension that drove confidence down (missing input, unverified citation, partial coverage). Repeated low-confidence on the same stage is a routing signal: re-triage with a richer path or split the slug rather than re-dispatching the same specialist.

## Common rules

Resume from a fresh session works because everything is on disk: \`flow-state.json\` has \`currentSlug\` + \`currentStage\` + \`triage\`, \`flows/<slug>/*.md\` carries the artifacts. The next \`/cc\` invocation enters Detect, finds the active flow, and continues silently from \`currentStage\` (see the Detect dispatch matrix in the orchestrator body).

\`/cc-cancel\` is the **only** way to discard an active flow; it is never offered as a clickable option in any structured question. The orchestrator surfaces it as plain prose inside the stop-and-report status block ("\`/cc-cancel\` to discard").
`;

const ALWAYS_AUTO_FAILURE_HANDLING = `# On-demand runbook — always-auto failure handling

The orchestrator opens this runbook on every chain decision after a specialist returns its slim summary. A deterministic failure matrix replaces the user-facing \`step\` / \`auto\` choice: the flow chains stages automatically until a failure condition fires; on failure the orchestrator either auto-fixes (capped at 3 iterations) or stops immediately and surfaces a stop-and-report status block.

## Failure routing matrix (locked)

| Failure | Behaviour |
| --- | --- |
| Build failure (\`suite-status: failed\` or compile error) | Auto-fix loop: dispatch \`builder\` in \`fix-only\` mode with the failure context prepended. Cap = 3 iterations. After the 3rd failed iteration, stop and report. |
| Reviewer \`block\` OR \`Recommended next: fix-only\` with ≥1 \`required\`/\`critical\` finding | Auto-fix loop: dispatch \`builder\` in \`fix-only\` mode with the findings prepended. Cap = 3 iterations. After the 3rd failed iteration, stop and report. The hard cap of 5 review/fix iterations still applies; the cap of 3 is the tighter of the two. |
| Critic \`verdict: block-ship\` | **Stop immediately and report.** No auto-iteration — re-running the critic on unchanged code produces the same verdict; the user must edit the diff (or accept the ship as-is) and re-invoke \`/cc\`. |
| Catastrophic (git operation fail, sub-agent dispatch fail, file I/O fail) | Stop and report. Include the underlying error message in the status block's \`Reason:\` field. |
| \`Recommended next: cancel\` | Stop and report. The specialist recommended stopping; the user decides whether to \`/cc\` (continue under a follow-up) or \`/cc-cancel\` (discard). |
| \`Confidence: low\` (any specialist) | Stop and report. Surface the Notes verbatim in the status block. |
| plan-critic \`verdict: cancel\` OR \`verdict: revise\` after iter 1 | Stop and report. The plan-critic believes the plan is structurally broken (cancel) or the revise loop hit the iteration cap (revise iter 1). |
| qa-runner \`verdict: blocked\` OR \`verdict: iterate\` after iter 1 | Stop and report. Browser tooling unavailable / manual steps required (blocked) or qa iterate loop hit the iteration cap (iterate iter 1). |
| reviewer \`status: cap-reached\` (5th review/fix iteration without convergence) | Stop and report. See \`runbooks/cap-reached-recovery.md\` for the split-plan procedure. |
| builder \`Status: NEEDS_CONTEXT\` | **Stop and report.** The builder identified a specific missing input (file, symbol, decision the plan doesn't pin) and self-rescue didn't close the gap. Status block surfaces the \`Notes:\` line verbatim so the user can see exactly what is missing. On \`/cc\` continue, the orchestrator re-dispatches the builder with the new context (typically the user edited \`CONTEXT.md\` or \`plan.md > ## Assumptions\` between the stop and the resume). No auto-retry — re-running on unchanged inputs produces the same status. See \`.cclaw/lib/skills/summary-format.md\` (Part II — Builder status protocol) for the per-slice loop + aggregation rule. |
| builder \`Status: BLOCKED\` | **Stop and report.** The builder hit an unresolvable obstacle (per-slice review failed its 2-attempt cap, posture mismatch, dependency cycle, surface conflict). Status block surfaces the \`Notes:\` line verbatim PLUS the builder's recommended resolution from a fixed set: \`provide more context\` / \`break the slice smaller\` / \`escalate to architect\` / \`accept and ship as-is\`. Orchestrator does NOT auto-retry. On \`/cc\` continue, the orchestrator resumes with the resolution applied (typically a \`plan.md\` edit, an architect re-dispatch, or a context addition). See \`.cclaw/lib/skills/summary-format.md\` § "BLOCKED" for triggering conditions. |
| builder \`Status: DONE_WITH_CONCERNS\` | **Proceed AND log.** The builder landed the work and the per-slice reviews passed, but the builder flagged forward-looking risks. Orchestrator appends a \`## Concerns\` section to \`build.md\` (one bullet per concern, copied verbatim from the slim summary's \`Notes:\` line + the build.md \`## Summary > Potential concerns\` bullets) and chains to the next stage. The reviewer reads \`## Concerns\` as additional finding seeds. No stop fires; the user sees the concerns in the cockpit line. |

## Stop-and-report status block (uniform shape)

When any of the above fires, the orchestrator writes ONE structured status block in plain prose (user's language), then ends its turn. The block uses this shape:

\`\`\`
Stopped at <stage> (<slug>).
Reason: <one short sentence; e.g. "Build failure after 3 auto-fix iterations" or "Critic verdict: block-ship">.
Artifact: <relative path to the most relevant artifact; e.g. .cclaw/flows/<slug>/critic.md>.
What changed since last stop: <one short sentence; omit if first stop>.
To continue: /cc (no args) — orchestrator continues from <currentStage>.
To discard: /cc-cancel — moves artifacts to .cclaw/flows/cancelled/<slug>/.
\`\`\`

The block is **plain prose**, not a structured ask. There is no option list, no "[1] continue [2] discard" picker. The user re-invokes \`/cc\` or \`/cc-cancel\` from their command palette. The status block stays in the chat log so the user can re-read it; it is not interactive.

## Recovery rules

- **\`/cc\` (no args) after stop** — the orchestrator reads \`flow-state.json\` + \`HANDOFF.json\` and continues from the saved \`currentStage\`. For build-failure / reviewer-fix stops, the auto-fix iteration counter is **preserved**; if the user wants a fresh 3-iteration budget after their own manual fix, they delete \`.cclaw/state/<slug>-fix-iter.json\` or invoke \`/cc-cancel\` + a fresh \`/cc\`.
- **\`/cc-cancel\` after stop** — runs the standard cancel runtime; artifacts move to \`cancelled/<slug>/\`, state resets.
- **\`/cc <new-task>\` after stop** — errors per the Detect matrix (active flow exists). User must \`/cc-cancel\` first.

## Auto-fix iteration counter

The orchestrator maintains a small JSON sidecar at \`.cclaw/state/<slug>-fix-iter.json\` recording the per-stage fix iteration count:

\`\`\`json
{
  "buildFixIterations": 1,
  "reviewerFixIterations": 0,
  "lastFailureKind": "build",
  "lastFailureAt": "2026-05-15T12:34:56Z"
}
\`\`\`

The counter increments on every fix-only dispatch and resets when the corresponding stage returns a clean slim summary (build → \`suite-status: passed\`; reviewer → \`decision: clear\`). The orchestrator reads the counter at every chain decision; on the 4th failed iteration the orchestrator surfaces the stop-and-report status block instead of dispatching another fix.

## Catastrophic failure handling

Catastrophic failures (git ops fail, sub-agent dispatch fail, file I/O fail) are distinct from "the sub-agent's verdict failed" — they mean the orchestrator itself could not complete a step. Always-auto treats them identically to other stops: write the stop-and-report status block with the underlying error message in \`Reason:\`, end the turn. Do NOT auto-retry catastrophic failures; the user must decide whether the underlying issue (disk full, network down, git index corrupted) is recoverable.

## Builder status protocol (structured status routing)

The builder slim summary carries a structured \`Status:\` line from a fixed set: \`DONE\` / \`DONE_WITH_CONCERNS\` / \`NEEDS_CONTEXT\` / \`BLOCKED\`. The orchestrator routes each status deterministically per the matrix above; this section codifies the surface behaviour. The full skill body lives at \`.cclaw/lib/skills/summary-format.md\` (Part II — Builder status protocol).

### Per-status orchestrator behaviour (deterministic)

- **\`DONE\`** — chain to the next stage automatically. The slim summary surfaces verbatim to the user. No extra orchestrator action.
- **\`DONE_WITH_CONCERNS\`** — append a \`## Concerns\` section to \`.cclaw/flows/<slug>/build.md\` (one bullet per concern, sourced from the slim summary's \`Notes:\` line + the build.md \`## Summary > Potential concerns\` bullets); chain to the next stage. The reviewer reads \`## Concerns\` as additional finding seeds. The aggregation invariant is monotone (see \`summary-format.md\` § "Status protocol — aggregation rule"): if the dispatch-level Status is \`DONE_WITH_CONCERNS\`, at least one per-slice block flagged a concern.
- **\`NEEDS_CONTEXT\`** — emit the canonical stop-and-report status block (per the "Stop-and-report status block" shape above) with \`Reason: Builder NEEDS_CONTEXT — <Notes line verbatim>\`. The block surfaces the specific missing input (file, symbol, decision) in plain prose for the user. End the turn. On \`/cc\` continue, the orchestrator re-dispatches the builder with the new context in the envelope (typically the user edited \`CONTEXT.md\` or \`plan.md > ## Assumptions\` between the stop and the resume). On \`/cc-cancel\`, the cancel runtime runs as usual.
- **\`BLOCKED\`** — emit the canonical stop-and-report status block with \`Reason: Builder BLOCKED — <Notes line verbatim>\`. The block ALSO surfaces the builder's recommended resolution as plain prose. End the turn. The orchestrator does NOT auto-retry; re-running the builder on unchanged inputs produces the same \`BLOCKED\` verdict. Recovery is \`/cc\` continue (after the user applies the recommended resolution — typically a \`plan.md\` edit, an architect re-dispatch, or a context addition) or \`/cc-cancel\` (discard).

### Recommended-resolution vocabulary (BLOCKED only)

The builder's \`BLOCKED\` Notes line MUST cite a recommended resolution from this fixed set:

- **\`provide more context\`** — the slice's input space was thinner than the work required; the user adds the missing context to \`CONTEXT.md\` / envelope and continues. Equivalent to a delayed \`NEEDS_CONTEXT\` discovered only after the per-slice review failed.
- **\`break the slice smaller\`** — the slice was too large or too entangled; the architect splits it into 2+ smaller slices with tighter \`Surface\` columns. Re-dispatches plan-critic (if gate fires) then builder.
- **\`escalate to architect\`** — the slice as written has a structural issue (posture mismatch, dependency cycle, surface conflict, missing AC coverage) that the builder cannot resolve in place. Architect re-dispatches to revise plan.md.
- **\`accept and ship as-is\`** — the blocker is real but the user judges it acceptable for this slug (typical: "the perf regression on this slice is 7%; we'll fix in a follow-up"). User edits plan.md or accepts the warnings, then \`/cc\` continues.

The orchestrator surfaces the recommended resolution verbatim — it does not paraphrase or interpret. The user picks the recovery action; the orchestrator does not auto-select.

### Per-slice vs dispatch-level Status

Strict mode emits TWO surfaces:

- **Per-slice status** lives in each slice's JSON \`self_review\` block (the \`status\` field). It drives the in-builder per-slice review loop (whether to bounce the slice through fix-only or proceed to the next slice).
- **Dispatch-level status** lives at the top of the slim summary's \`Status:\` line. It drives the orchestrator's chain decision. The aggregation rule is **monotone**: any per-slice \`BLOCKED\` → dispatch \`BLOCKED\`; any per-slice \`NEEDS_CONTEXT\` (no \`BLOCKED\`) → dispatch \`NEEDS_CONTEXT\`; any per-slice \`DONE_WITH_CONCERNS\` (no \`BLOCKED\` / \`NEEDS_CONTEXT\`) → dispatch \`DONE_WITH_CONCERNS\`; only when every slice is \`DONE\` → dispatch \`DONE\`.

The monotone rule is intentional: the orchestrator's chain decision should be conservative; one slice that needs help should not be hidden behind sibling slices that finished cleanly. Sibling slices that committed cleanly stay landed; the dispatch-level stop tells the user to resolve the blocker on the one slice that's stuck.

Soft mode emits ONE dispatch-level Status (the whole feature is one cycle; no per-slice aggregation).

## Anti-rationalization table

| rationalization | truth |
| --- | --- |
| "Build failure — surely 4 retries is fine, the code is almost there." | Cap is 3 for a reason. Past iter 3 the auto-fix loop has consistently failed to find the issue; stop and report so the user can decide. |
| "Critic block-ship — maybe one more round and the verdict will flip." | No. The critic walks code that didn't change; the verdict will be identical. Stop and report; the user edits the diff. |
| "Catastrophic error — let me retry once before reporting." | No. Catastrophic = orchestrator-level failure (git, dispatch, I/O). Retry policy is the user's call; report immediately. |
| "Confidence: low on the slim summary — maybe the specialist was being conservative." | No. The specialist set \`Confidence: low\` because it could not verify. Stop and surface the Notes; the user decides. |
| "I'll auto-cancel and start fresh after the 3rd failed iteration." | No. Auto-cancel is never the right move — the user might have made progress they want to keep. Stop and let the user decide between \`/cc\` and \`/cc-cancel\`. |
| "Builder NEEDS_CONTEXT — let me try once more with the same envelope; maybe it finds it this time." | No. The builder already attempted self-rescue (re-read CONTEXT.md, grep, check \`## Assumptions\`). Re-dispatching on the same envelope produces the same result. Stop and surface the specific missing input so the user can provide it. |
| "Builder BLOCKED — let me auto-retry to give it one more chance." | No. \`BLOCKED\` is the post-cap status (per-slice review failed its 2-attempt cap). Re-running on unchanged inputs produces the same verdict. The recommended resolution names the recovery action; surface it and let the user apply it. |
| "Builder DONE_WITH_CONCERNS — the reviewer will catch real bugs anyway, I'll skip the \`## Concerns\` log." | No. The reviewer reads \`## Concerns\` as finding seeds; skipping the log silently drops the builder's forward-looking signal. Append the section even when it feels routine. |
`;

const CRITIC_STEPS = `# On-demand runbook — critic steps (pre-implementation + post-implementation)

cclaw has **two** critic specialists that share a dispatch envelope shape and the falsificationist pass discipline but fire at different points in the flow:

| stage | when | reads | output | verdicts |
| --- | --- | --- | --- | --- |
| **plan-critic** | between architect and builder | plan.md only (read-only on the codebase) | flows/<slug>/plan-critic.md | \`pass\` / \`revise\` / \`cancel\` |
| **critic** | between reviewer-clear and ship | plan.md + build.md + review.md + diff | flows/<slug>/critic.md | \`pass\` / \`iterate\` / \`block-ship\` |

Both stages ship together because they catch different problem classes — plan-critic walks the plan itself ("is this plan structurally buildable?"); the post-impl critic walks the built diff ("did we build the right thing well?"). The orchestrator opens the matching section below for the transition in flight.

## Shared cross-stage rules

- **Pre-commitment predictions** are authored BEFORE the rest of the protocol runs (plan-critic §6; post-impl critic §1). Same discipline shape: 3-5 predictions naming verification paths and final outcomes (\`confirmed\` / \`refuted\` / \`partial\`); the discipline activates deliberate search instead of passive reading.
- **Anti-rationalization pointer.** Both specialists reference the shared \`.cclaw/lib/anti-rationalizations.md\` catalog for cross-cutting rationalizations; only specialist-unique rows live inline in the prompt body.
- **Iteration cap = 1.** Each specialist dispatches at most twice per slug (iteration 0 + one allowed retry). A third dispatch is structurally forbidden — the orchestrator stops and reports per the always-auto failure matrix instead.
- **Slim summary shape.** Both return a ≤7-line slim summary with \`specialist\`, \`verdict\`, severity-bucketed findings count, \`iteration\`, \`confidence\`, and an optional \`notes\` line (required when confidence != high).

## Pre-implementation pass (plan-critic)

The orchestrator opens this section **on every \`architect\` slim-summary return** when the gate evaluates to true. plan-critic is the pre-implementation adversarial specialist that runs between \`architect\` and \`builder\` on a tight subset of flows. It walks what is **missing or wrong** in the plan itself rather than the post-impl critic's "did we build the right thing well?" pass. plan-critic carries up to three **rubric scaffolds** — \`generic\` (structural plan shape), \`design\` (visual / accessibility / interaction), \`devex\` (SDK / API / CLI / library). The orchestrator computes the active \`rubrics\` set (each rubric independently gated, below) and dispatches plan-critic **ONCE**; the specialist walks every active rubric in one pass and returns ONE merged verdict (worst-of). The contract lives in \`.cclaw/lib/agents/plan-critic.md\`; this section covers what the orchestrator does *around* the single dispatch.

### plan-critic gating (per-rubric gates; the dispatch fires when ANY rubric is active)

The orchestrator computes the active \`rubrics\` set deterministically, then dispatches plan-critic ONCE iff the set is non-empty. Each rubric is independently gated:

**\`generic\` rubric** (default; structural plan-shape audit) — active when ALL four hold:

1. \`triage.ceremonyMode == "strict"\` (soft / inline plans don't carry the granularity surface to critique).
2. \`triage.complexity != "trivial"\` (trivial flows have no plan stage; small-medium and large-risky plans are both eligible).
3. \`triage.problemType\` ≠ \`"refines"\` (refines slugs extend prior shipped work; the parent already shipped + survived its post-impl critic).
4. AC count ≥ 2 (a single-AC plan has no internal granularity / dependency surface).

**\`design\` rubric** (visual / accessibility / interaction lens) — active when (\`triage.designSurface == true\` OR \`triage.surfaces\` ∩ {\`ui\`, \`design\`, \`frontend\`, \`ux\`} ≠ ∅) AND \`ceremonyMode ∈ {soft, strict}\` AND plan.md exists.

**\`devex\` rubric** (SDK / API / CLI / library lens) — active when (\`triage.devexSurface == true\` OR \`triage.surfaces\` ∩ {\`cli\`, \`library\`, \`api\`} ≠ ∅) AND \`ceremonyMode ∈ {soft, strict}\` AND plan.md exists.

When the active set is empty, plan-critic is **structurally skipped** — the orchestrator advances directly from architect's slim summary to builder dispatch. Widening any gate is a scope decision, not a within-slug runtime call.

### plan-critic dispatch envelope

\`\`\`
Dispatch plan-critic
─ Required first read: .cclaw/lib/agents/plan-critic.md  (your contract — per-rubric gates, rubric protocol, merged verdict, slim summary)
─ Required second read: .cclaw/lib/anti-rationalizations.md  (catalog; the prompt body cites it)
─ Stage: plan-critic
─ Slug: <slug>
─ Rubrics: [<active subset of generic / design / devex>]  (the set whose gates fired; non-empty by definition)
─ Ceremony mode: <soft | strict>  (generic requires strict; design / devex allow soft)
─ AC count: <N>    (from plan.md frontmatter; ≥2 when generic is active)
─ Iteration: <0 | 1>  (0 on first dispatch; 1 on the one allowed revise loop — per dispatch, not per rubric)
─ Findings to address (iteration 1 only): <verbatim §4 hand-off blocks of every non-passing rubric, concatenated generic → design → devex>
─ Inputs the sub-agent reads after the contract + catalog:
    - .cclaw/state/flow-state.json (triage)
    - .cclaw/flows/<slug>/plan.md (Frame, Spec, NFR, AC, Decisions, Pre-mortem, Topology)
    - .cclaw/lib/templates/plan-critic.md
    - CONTEXT.md at the project root, if it exists
─ Output contract:
    - .cclaw/flows/<slug>/plan-critic.md (generic rubric — single-shot, overwrite on re-dispatch)
    - append-only ## Plan-design findings / ## Plan-devex findings sections in plan.md (design / devex rubrics, when active)
    - return a slim summary block (≤7 lines, one merged verdict across the active rubrics)
    - DO NOT mutate flow-state.json — only the orchestrator touches it
─ Forbidden:
    - edit plan.md / build.md / review.md / source / tests
    - dispatch other specialists (composition is the orchestrator's job)
    - exceed 7k tokens (input + output combined; itself a finding when approached)
\`\`\`

### plan-critic verdict handling (merged slim summary → orchestrator routing)

The single dispatch returns ONE **merged verdict** — the worst-of across the active rubrics' sub-verdicts (\`cancel\` > \`block\` > \`revise\` > \`pass\`). The orchestrator branches on (merged verdict, iteration):

| merged verdict | iteration | \`currentStage\` after | what the orchestrator does (always-auto) |
| --- | --- | --- | --- |
| \`pass\` | 0 or 1 | \`"plan"\` → advance to \`"build"\` | chain to builder dispatch. \`iterate\` / \`fyi\` / \`low\` rows ride along as advisory notes for builder + reviewer. |
| \`revise\` | 0 | stays \`"plan"\`, \`lastSpecialist: "plan-critic"\` | dispatch \`architect\` again, with every non-passing rubric's §4 hand-off block (concatenated generic → design → devex) prepended to the envelope \`Inputs\` line. architect updates plan.md, then the orchestrator re-dispatches plan-critic ONCE more (iteration 1, same \`rubrics\` set). |
| \`revise\` | 1 | stays \`"plan"\` | stop and report (\`runbooks/always-auto-failure-handling.md\`). The revise loop hit the iteration cap; recovery via \`/cc\` (continue after the user edits plan.md or accepts the warnings) or \`/cc-cancel\` (discard). |
| \`block\` | 0 or 1 | stays \`"plan"\` | stop and report. A \`design\` / \`devex\` rubric returned \`block\` (coherence failure that blocks ship); recovery via \`/cc\` (continue after re-architecting) or \`/cc-cancel\` (discard). |
| \`cancel\` | 0 or 1 | stays \`"plan"\` | stop and report. The \`generic\` rubric found the plan structurally not buildable; recovery via \`/cc\` (continue after re-architecting) or \`/cc-cancel\` (discard). |

**Confidence: low** in the plan-critic's slim summary stops and reports per the always-auto failure matrix. The plan-critic MUST write a non-empty \`notes:\` line when confidence is not \`high\`; the orchestrator surfaces the Notes verbatim in the status block.

### plan-critic iteration cap enforcement

- \`planCriticIteration\` starts at 0 (initial dispatch about to fire) and increments to 1 after the first slim-summary return. The counter is **per dispatch** — one value for the whole \`rubrics\` set, not per rubric.
- The orchestrator dispatches plan-critic **at most twice per slug**: once at iteration 0, optionally once at iteration 1 (only on a \`revise\` merged verdict from iter 0). A third dispatch is structurally not allowed — the orchestrator stops and reports per the always-auto failure matrix instead.
- A flow that goes \`revise\` (iter 0) → architect revise → \`revise\` (iter 1) is the canonical "1 revise loop max" path. After the second \`revise\`, the orchestrator emits the stop-and-report status block; the user resumes with \`/cc\` (continue after editing the plan) or \`/cc-cancel\` (discard).
- A \`cancel\` or \`block\` merged verdict at any iteration immediately stops and reports (per \`runbooks/always-auto-failure-handling.md\`); iteration does not advance.
- The iteration cap is independent of \`reviewIterations\` (post-impl review loop) and \`criticIteration\` (post-impl critic). All three counters are tracked separately.

### plan-critic FlowState patches

**Immediately before dispatching plan-critic (iteration 0 OR iteration 1):**

\`\`\`json
{
  "currentStage": "plan",
  "lastSpecialist": "architect"
}
\`\`\`

(\`currentStage\` stays \`"plan"\` because plan-critic is structurally part of the plan stage — it sits between architect and builder.)

**After plan-critic returns slim summary (orchestrator has read it, BEFORE user-gate decision):**

\`\`\`json
{
  "currentStage": "plan",
  "lastSpecialist": "plan-critic",
  "planCriticIteration": <0 if first dispatch returning; 1 if second dispatch returning>,
  "planCriticVerdict": "pass | revise | block | cancel",
  "planCriticDispatchedAt": "<iso timestamp>"
}
\`\`\`

**After pass verdict (advance to build):** \`currentStage\` advances to \`"build"\`. The plan-critic fields stay; they are immutable for the rest of the flow.

**After revise verdict (iter 0, bounce to architect):** \`currentStage\` stays \`"plan"\`; \`lastSpecialist\` is patched back to \`"architect"\` only after architect's revise dispatch returns its slim summary. The active rubrics' artifacts (plan-critic.md + plan.md's design / devex sections) stay on disk; architect's next dispatch reads them.

**After a cancel / block / revise-cap stop-and-report:** the user's resume drives the next state transition — \`/cc-cancel\` clears the flow; re-architect (the user edits plan.md, then \`/cc\`) resets the plan stage and re-dispatches the architect with the plan-critic findings prepended to its envelope; accept-warnings-and-proceed (\`/cc\` without a plan edit on a \`revise\`) advances to builder despite the \`revise\` verdict. The plan-critic fields stay verbatim as the audit trail.

## Post-implementation pass (critic)

The orchestrator opens this section **on every transition from \`review\` to \`critic\`** and at every block-ship stop-and-report resume. The critic is the on-demand adversarial specialist that runs between the reviewer's final \`clear\` and the ship gate. It walks what is *missing* (gap analysis + pre-commitment predictions + goal-backward verification + Criterion check + realist check + — in adversarial mode — assumption-violation / composition / cascade / abuse cases), rather than re-walking the reviewer's nine axes. The contract that drives the dispatch lives in \`.cclaw/lib/agents/critic.md\`; this section covers what the orchestrator does *around* the dispatch.

### critic ceremonyMode gating (Q1, no flag exposed)

| \`triage.ceremonyMode\` | does critic run? | mode | typical token budget |
| --- | --- | --- | --- |
| \`inline\` | **no — skipped** (\`triage.path\` never includes \`critic\` on inline) | — | 0 |
| \`soft\` | **yes** | \`gap\` (light) — predictions ≤3, §3 adversarial skipped, §5 goal-backward collapsed to one paragraph | 5-7k |
| \`strict\` | **yes** | \`gap\` (full) by default; auto-escalates to \`adversarial\` (\§3 emitted in full + per-D-N devil's-advocate sweep) when any §8 trigger fires | 10-15k (gap) / 12-18k (adversarial), hard cap 20k |

### critic escalation triggers (§8, OR-conditions — any one fires escalation on \`ceremonyMode: strict\`)

1. **Architectural-tier change** — touchSurface includes ≥2 files marked \`tier: architectural\` in plan.md OR the build introduced one.
2. **Test-first + zero failing tests in build.md** — slug posture is \`test-first\` AND the TDD log shows zero \`RED\` rows (Q5: narrow trigger, do NOT widen to "missing RED excerpt"; the difference matters — a slug with \`RED\` rows that lack a captured excerpt is a build.md audit-trail gap to be flagged, not a critic escalator).
3. **Large surface size** — \`git diff --stat\` reports ≥10 files OR ≥500 net lines changed since the plan committed.
4. **\`security_flag: true\`** OR the reviewer's \`security\` axis fired with severity-required findings during review (absorbed from the former \`security-reviewer\`).
5. **\`reviewIterations >= 4\`** — the slug needed near-cap iterations to converge; hidden complexity signal.

The orchestrator computes the trigger set deterministically from \`flow-state.json\` + \`plan.md\` frontmatter + \`build.md\` table + \`git diff --stat\` BEFORE dispatching critic. The dispatch envelope stamps the firing triggers verbatim so the prompt copies them into \`critic.md > frontmatter > escalation_triggers\`.

Mapping fired-triggers count to \`criticEscalation\`:

- \`ceremonyMode: soft\` AND exactly one trigger fired → \`light\` (still \`gap\` mode; one extra technique permitted).
- \`ceremonyMode: strict\` AND any trigger fired → \`full\` (\`adversarial\` mode; all four §3 techniques + devil's-advocate sweep).
- Otherwise → \`none\` (\`gap\` mode unchanged).

### critic cap & rerun rules

- **Hard cap: 1 critic re-run per slug.** \`criticIteration\` starts at 1 on the first dispatch, increments to 2 on a rerun, and would refuse a third — stopping and reporting per the always-auto failure matrix (same shape as the 5-iteration reviewer cap; no in-chat picker).
- **Block-ship → stop-and-report (two recovery paths, both resume via \`/cc\`):** **fix and re-review** — the user edits the diff to close the gap, then \`/cc\` re-dispatches \`builder\` in \`fix-only\` mode, re-runs \`reviewer\` (this DOES increment \`reviewIterations\` — the cap still applies), then re-runs \`critic\` (increments \`criticIteration\`). **accept-and-ship** — the user re-invokes \`/cc\` to accept the gap as-is; the orchestrator records \`criticOverride\` + the block-ship reason in \`learnings.md\` and proceeds to ship. \`/cc-cancel\` discards.
- **Independence:** critic dispatches do NOT increment \`reviewIterations\`. The two counters are independent; the critic-cap stop-and-report fires only on a third critic dispatch, even if the reviewer-cap is far from reached.

### critic verdict handling (slim summary → orchestrator routing)

| critic \`Verdict:\` | \`currentStage\` after | what the orchestrator does (always-auto) |
| --- | --- | --- |
| \`pass\` | \`"ship"\` | chain to ship |
| \`iterate\` | \`"ship"\` | open critic gaps with severity \`iterate\` are copied verbatim into \`ship.md > ## Risks carried over\`; one line to the user ("Critic returned iterate (\<N\> gaps carried over). Continuing to ship.") then chain to ship |
| \`block-ship\` | stays \`"critic"\` | **stop immediately and report** per the always-auto failure matrix (\`runbooks/always-auto-failure-handling.md\`). No auto-iteration on critic block-ship — re-running the critic on unchanged code produces the same verdict. Recovery via \`/cc\` (continue under a follow-up after editing the diff; consumes the one allowed critic rerun) or \`/cc-cancel\` (discard). Single-line summary cites the \`block-ship\` G-N / F-N anchors verbatim. |

**Confidence: low** in the critic's slim summary stops and reports per the always-auto failure matrix. The critic MUST write a non-empty \`Notes:\` line when Confidence is not \`high\`; the orchestrator surfaces the Notes verbatim in the status block.

### critic FlowState patches

**Immediately before dispatching critic:**

\`\`\`json
{
  "currentStage": "critic",
  "lastSpecialist": null
}
\`\`\`

**After critic returns slim summary (orchestrator has read it, BEFORE user-gate decision):**

\`\`\`json
{
  "currentStage": "critic",
  "lastSpecialist": "critic",
  "criticIteration": 1,
  "criticVerdict": "pass | iterate | block-ship",
  "criticGapsCount": <integer; open gaps with severity != fyi>,
  "criticEscalation": "none | light | full"
}
\`\`\`

**After ship begins (user approved continue or auto-chain fired):** \`currentStage\` advances to \`"ship"\`. The critic fields stay; they are immutable for the rest of the flow.

`;

const QA_STAGE = `# On-demand runbook — qa step

The orchestrator opens this runbook **on every builder GREEN slim-summary return** when the qa gate evaluates to true. \`qa-runner\` is the behavioural-acceptance specialist that runs between \`build\` and \`review\` on UI-touching slugs in non-inline mode. It walks the **rendered page** (Playwright > browser-MCP > manual) and emits one evidence row per UI-tagged AC. The contract that drives the dispatch lives in \`.cclaw/lib/agents/qa-runner.md\`; this runbook covers what the orchestrator does *around* the dispatch.

Distinct from \`debug-and-browser.md\` (live-system diagnostic discipline, fires on stop-the-line) and from \`reviewer.md > qa-evidence axis\` (post-qa cross-check that qa.md rows match the diff). The three together close the behavioural-QA gap that cclaw previously handled only implicitly through the reviewer's nine-axis pass.

## Gating (the three AND conditions — orchestrator enforces deterministically)

qa-runner runs ONLY when ALL of these hold:

1. \`triage.surfaces\` includes at least one of \`"ui"\` or \`"web"\` (CLI / library / API / data / infra / docs-only slugs structurally skip qa).
2. \`triage.ceremonyMode != "inline"\` (trivial / one-shot slugs skip qa; inline budget cannot afford a structured pass).
3. \`qaIteration < 1\` (hard cap — a third dispatch is structurally not allowed; the orchestrator stops and reports per the always-auto failure matrix instead).

For any other combination, qa-runner is **structurally skipped**. The orchestrator advances directly from builder's GREEN slim summary to reviewer dispatch, as today. The gate is **AND** across all three; widening any condition (e.g. running qa on \`ceremonyMode: inline\`) is a scope decision, not a within-slug runtime call.

Backwards compat: a legacy flow whose \`triage.surfaces\` field is absent reads as \`["other"]\` and skips qa — the orchestrator does not retro-fit qa onto legacy slugs.

## Dispatch envelope

\`\`\`
Dispatch qa-runner
─ Required first read: .cclaw/lib/agents/qa-runner.md  (your contract — gate, browser-tool hierarchy, evidence rubric, verdict semantics, slim summary)
─ Required second read: .cclaw/lib/skills/debug-and-browser.md  (the cross-cutting QA discipline — its "QA acceptance discipline" section: tier definitions, evidence requirements, anti-rationalizations)
─ Stage: qa
─ Slug: <slug>
─ Ceremony mode: <strict | soft>  (gate enforces non-inline; inline is structurally impossible here)
─ Surfaces: <list from triage.surfaces — e.g. ["ui"], ["web"], ["ui", "api"]>
─ UI ACs: <list of AC ids whose touchSurface includes UI files, computed from plan.md AC table>
─ Iteration: <0 | 1>  (0 on first dispatch; 1 on the one allowed iterate loop)
─ Findings to address (iteration 1 only): <verbatim §7 hand-off block from the iter-0 qa.md>
─ Inputs the sub-agent reads after the contract + skill:
    - .cclaw/state/flow-state.json (triage)
    - .cclaw/flows/<slug>/plan.md (AC table with touchSurface column)
    - .cclaw/flows/<slug>/build.md (GREEN evidence — what the builder already verified)
    - .cclaw/flows/<slug>/qa.md (iter-0 artifact, when re-dispatching at iter 1)
    - .cclaw/lib/templates/qa.md
    - CONTEXT.md at the project root, if it exists
─ Output contract:
    - .cclaw/flows/<slug>/qa.md (single-shot — overwrite on re-dispatch, no append-only ledger)
    - .cclaw/flows/<slug>/qa-assets/<ac-id>-<n>.png (screenshots, only when evidence_tier == browser-mcp)
    - tests/e2e/<slug>-<ac>.spec.ts (Playwright specs, only when evidence_tier == playwright AND project ships Playwright)
    - return a slim summary block (≤7 lines)
    - DO NOT mutate flow-state.json — only the orchestrator touches it
─ Forbidden:
    - edit production source (src/**) — qa-runner is read-only; builder owns production fixes
    - edit plan.md / build.md / review.md / flow-state.json
    - dispatch other specialists (composition is the orchestrator's job)
    - npm install Playwright as a side effect (downgrade to Tier 2 / 3 + surface a fyi finding instead)
    - exceed 10k tokens (input + output combined; itself a finding when approached)
\`\`\`

## Verdict handling (slim summary → orchestrator routing)

qa-runner returns one of three verdicts. The orchestrator branches on (verdict, iteration):

| verdict | iteration | \`currentStage\` after | what the orchestrator does (always-auto) |
| --- | --- | --- | --- |
| \`pass\` | 0 or 1 | \`"qa"\` → advance to \`"review"\` | chain to reviewer dispatch. The reviewer's \`qa-evidence\` axis re-reads qa.md and cross-checks each row against the diff. \`fyi\` findings ride along as advisory notes. |
| \`iterate\` | 0 | stays \`"qa"\`, \`lastSpecialist: "qa-runner"\` | dispatch \`builder\` again in **fix-only** mode, with qa.md §7 hand-off block prepended to the dispatch envelope's \`Inputs\` line. builder addresses each \`required\` finding (RED → GREEN cycle for the failed UI behaviour), then the orchestrator re-runs the build verification cycle and re-dispatches qa-runner (iteration 1). |
| \`iterate\` | 1 | stays \`"qa"\` | stop and report (per \`runbooks/always-auto-failure-handling.md\`). The qa iterate loop hit the iteration cap; recovery via \`/cc\` (continue under a follow-up after the user resolves the failed UI behaviour) or \`/cc-cancel\` (discard). |
| \`blocked\` | 0 or 1 | stays \`"qa"\` | stop and report (per \`runbooks/always-auto-failure-handling.md\`). \`blocked\` means qa could not actually run (browser tooling unavailable AND manual steps required); recovery via \`/cc\` (continue under a follow-up after the user installs browser tooling or runs the qa.md §4 manual-steps blocks) or \`/cc-cancel\` (discard). |

**Confidence: low** in the qa-runner's slim summary stops and reports per the always-auto failure matrix. The qa-runner MUST write a non-empty \`notes:\` line when confidence is not \`high\`; the orchestrator surfaces the Notes verbatim in the status block.

## Iteration cap enforcement

- \`qaIteration\` starts at 0 (initial dispatch about to fire) and increments to 1 after the first slim-summary return.
- The orchestrator dispatches qa-runner **at most twice per slug**: once at iteration 0, optionally once at iteration 1 (only on \`iterate\` from iter 0). A third dispatch is structurally not allowed — the orchestrator stops and reports per the always-auto failure matrix instead.
- A flow that goes \`iterate\` (iter 0) → builder fix → \`iterate\` (iter 1) is the canonical "1 iterate loop max" path. After the second \`iterate\`, the orchestrator emits the stop-and-report status block; the user resumes with \`/cc\` (continue after editing) or \`/cc-cancel\` (discard).
- A \`blocked\` verdict at any iteration immediately stops and reports (per \`runbooks/always-auto-failure-handling.md\`); iteration does not advance.
- The iteration cap is independent of \`reviewIterations\` (post-impl review loop), \`criticIteration\` (post-impl critic), and \`planCriticIteration\` (pre-impl plan-critic). All four counters are tracked separately.

## FlowState patches

**Immediately before dispatching qa-runner (iteration 0 OR iteration 1):**

\`\`\`json
{
  "currentStage": "qa",
  "lastSpecialist": "builder"
}
\`\`\`

(\`currentStage\` advances to \`"qa"\` because qa is a real stage in the \`FLOW_STAGES\` enum, sitting between \`"build"\` and \`"review"\`.)

**After qa-runner returns slim summary (orchestrator has read it, BEFORE user-gate decision):**

\`\`\`json
{
  "currentStage": "qa",
  "lastSpecialist": "qa-runner",
  "qaIteration": <0 if first dispatch returning; 1 if second dispatch returning>,
  "qaVerdict": "pass | iterate | blocked",
  "qaEvidenceTier": "playwright | browser-mcp | manual | null",
  "qaDispatchedAt": "<iso timestamp>"
}
\`\`\`

(\`qaEvidenceTier\` is \`null\` only on a \`blocked\` verdict where no tier was actually exercised — e.g. browser tools unavailable and manual steps queued for the user. On \`pass\` and \`iterate\`, the tier is always one of \`playwright\` / \`browser-mcp\` / \`manual\`.)

**After pass verdict (advance to review):** \`currentStage\` advances to \`"review"\`. The qa fields stay; they are immutable for the rest of the flow. The reviewer's \`qa-evidence\` axis reads them.

**After iterate verdict (iter 0, bounce to builder fix-only):** \`currentStage\` stays \`"qa"\`; \`lastSpecialist\` is patched back to \`"builder"\` only after builder's fix-only dispatch returns its slim summary. qa.md stays on disk; builder's next dispatch reads §7 hand-off. After the fix-only builder returns GREEN, the orchestrator re-dispatches qa-runner (iteration 1) — \`qaIteration\` increments at that point.

**After a blocked / iterate-cap stop-and-report:** the user's resume drives the next state transition — \`/cc-cancel\` clears the flow; re-architect (the user edits plan.md, then \`/cc\`) resets the plan stage and re-dispatches the architect with the qa.md findings prepended to its envelope; accept-warnings-and-proceed-to-review (\`/cc\` after editing qa.md to accept the gap) advances \`currentStage\` to \`"review"\` despite the open findings; proceed-without-qa-evidence likewise advances to \`"review"\` with qa.md recording the gap. The qa fields stay verbatim as the audit trail.

## Reviewer cross-check (qa-evidence axis)

After the qa pass completes (or is overridden), the reviewer's \`qa-evidence\` axis cross-checks the artifact against the diff:

1. **For every AC whose \`touchSurface\` includes a UI file**: the reviewer expects a matching \`qa.md > §4 Per-AC evidence\` row.
2. **Missing row** → reviewer fires a \`required\` finding (axis: \`qa-evidence\`, severity: \`required\`).
3. **Row with \`Status: fail\`** (qa returned \`pass\` despite a failed AC — should never happen if qa-runner is correct, but the reviewer cross-checks defensively) → reviewer fires a \`required\` finding citing the contradiction.
4. **Row with \`Status: pending-user\`** (manual tier, blocked verdict overridden) → reviewer fires a \`fyi\` finding flagging the weakest evidence tier.
5. **Silent tier downgrade** (qa.md frontmatter records \`evidence_tier: manual\` but \`package.json\` ships Playwright; OR \`evidence_tier: browser-mcp\` but no MCP was actually exercised) → reviewer fires a \`required\` finding citing the missed tier.

The axis is the 9th explicit axis (10th with the gated \`nfr-compliance\` axis). The reviewer's slim-summary axes counter includes \`qae=N\` for the qa-evidence finding count.

`;

const RESEARCH_DEPTH_AND_SELF_REVIEW = `# On-demand runbook — research depth tiers + synthesis self-review

The orchestrator opens this runbook on every \`/cc research <topic>\` flow — once at the Detect-hop research-mode fork (to parse the depth flag / classify the depth) and once at Phase 3 synthesis (to run the self-review pass before \`research.md\` is written). The body of \`/cc\` carries only the one-paragraph pointer; this runbook is the canonical source.

## §1 — Research depth tiers

Research mode (\`/cc research <topic>\`) supports three depth tiers; the orchestrator picks one at the Detect-hop research-mode fork and stamps it into \`flow-state.json > triage.research_depth\`. The depth is immutable for the flow's lifetime.

| Depth | Lenses dispatched | Extra probes | When to use |
| --- | --- | --- | --- |
| \`light\` | \`research-engineer\` + \`research-skeptic\` (2 lenses) | none | Clarification questions: "which library does X?", "is Y still the best practice?", "does our team already use Z?". Fast / cheap turn-around when the user wants a focused technical signal + adversarial check, NOT a full product / market / history scan. |
| \`standard\` (default) | engineer + product + architecture + history + skeptic (5 lenses) | none | Technical exploration: "evaluate Redis vs in-memory cache for the search endpoint", "should we move auth to JWT?", "what's our story on observability?". Same 4-phase flow, full coverage of the orthogonal lens dimensions. |
| \`deep-product\` | 5 lenses | product lens fires Thesis + Adjacent-product probes; skeptic lens fires Durability probe | Greenfield / pivot / shape questions: "should we build a new product around X?", "what if we replace our planning tool with Y?", "evaluate switching from SaaS A to SaaS B". The deep-product probes (sourced from everyinc-compound \`ce-brainstorm\` Phase 1.2) force the lenses to interrogate the implicit product thesis + near-term durability that surface-level lens prose otherwise glosses. |

### Selection — wording-based auto-classification (sole selection path)

The per-flow depth-override flags are retired; the depth is derived deterministically from the topic wording. The orchestrator's research-mode fork auto-classifies the depth at Detect, before any lens dispatch. The triage sub-agent's \`research_depth\` heuristic — surfaced in the slim summary's \`Research depth:\` line when triage runs — is NOT consulted directly here (research mode bypasses triage); the orchestrator runs the same wording-based heuristic inline.

| Topic wording signal | Default depth |
| --- | --- |
| Pure clarification / single technical question (\`is X still maintained?\`, \`which library?\`, \`what does the team use?\`) | \`light\` |
| Technical exploration with named surface (\`evaluate Redis caching\`, \`add OAuth\`, \`refactor our auth wrapper\`) | \`standard\` |
| Greenfield / pivot / replacement wording (\`should we build...\`, \`what if we replace...\`, \`evaluate switching from...\`, \`we need a new <product-shape>\`) | \`deep-product\` |
| Topic explicitly mentions a competitor / market category / persona without a code surface | \`deep-product\` |

When the wording is ambiguous (e.g. \`add caching\` could be light OR standard), default to \`standard\` — the safer middle. The synthesis self-review pass surfaces under-coverage if the depth was too thin.

### Stamping behaviour

The Detect-hop research-mode fork writes the depth into \`flow-state.json > triage.research_depth\` immediately after stamping the sentinel triage block. Phase 2 dispatch reads this field to decide which lenses to dispatch:

- \`light\` → dispatch \`research-engineer\` + \`research-skeptic\` only (2 envelopes; the other three lenses are not dispatched and not marked failed; the \`lenses\` frontmatter array carries only \`[engineer, skeptic]\`).
- \`standard\` → dispatch all 5 lenses (behaviour).
- \`deep-product\` → dispatch all 5 lenses; the dispatch envelope carries \`Research depth: deep-product\` so product + skeptic lenses fire their extra probes.

## §2 — Synthesis self-review pass (Phase 3)

After authoring the per-lens sections + cross-lens \`## Synthesis\` + \`## Recommended next step\` (Phase 3 steps 1-4 in the start-command body), the orchestrator runs a **self-review pass** against the in-memory draft of \`research.md\` BEFORE writing it to disk. The self-review is one main-context pass (NOT a sub-agent dispatch — the orchestrator owns \`research.md\` end-to-end). Source: obra-superpowers brainstorming \"Spec Self-Review\" section.

The pass walks four scans, in order, and fixes findings inline:

### 2.1 — Placeholder scan

Search the draft for any of:

- literal \`<TBD>\` / \`TBD\` / \`TODO\` / \`tbd\` / \`todo\` / \`???\` / \`...\` (when used as a placeholder, not as ellipsis prose).
- empty per-lens sub-sections (e.g. \`### Implementation paths\` followed immediately by another \`###\`).
- the literal placeholder strings from the template (\`<path-name>\`, \`<one-line description>\`, \`<bullet 1>\`, \`<actor / role>\`, etc.) — these are template scaffolds that should have been filled by the lens; their presence means a lens returned a thin findings block.
- the \`SLUG-PLACEHOLDER\` / \`TOPIC-PLACEHOLDER\` / \`GENERATED-AT-PLACEHOLDER\` strings (these MUST be replaced before finalize).

For each placeholder found, fix inline:

- a missing template scaffold → either drop the bullet or fill with a "(no <noun> identified)" sentinel sentence.
- a \`<TBD>\` in a lens section → re-read the lens's slim summary; if the lens had real content it didn't surface, lift it; otherwise convert to a "Not assessed in this lens" sentinel.
- the SLUG / TOPIC / GENERATED-AT placeholders → fill verbatim from the flow state.

### 2.2 — Internal contradiction scan

Walk the synthesis convergence + divergence paragraphs and check against the per-lens sections they cite:

- a "convergence" claim that two lenses agree → spot-check both lens sections to confirm the agreement is real (not a paraphrase that drifted).
- a "divergence" claim → the cited sections should genuinely disagree.
- a "Recommended next: plan" → no skeptic \`Don't-proceed: yes\` should be in the Skeptic lens section.
- a "Recommended next: don't proceed" → the cited skeptic trigger should appear verbatim in the Skeptic section's \`### Don't-proceed triggers\` subsection.

For each contradiction found, fix inline: re-quote the lens, restate the convergence / divergence accurately, or flip the recommendation.

### 2.3 — Scope drift scan

Compare the cross-lens synthesis against the user's original topic + the discovery dialogue summary:

- does the synthesis stay anchored to the topic the user named? Or has it drifted to an adjacent question?
- does the recommended next step propose a task scope the dialogue summary supports? Or is it a bigger / different scope?

For each drift finding, fix inline: rewrite the synthesis paragraph to anchor back to the topic, or narrow the recommended next-step task to match the dialogue.

### 2.4 — Ambiguity scan

Re-read the recommended next step + each Open product question (when present):

- could the recommendation be interpreted two different ways? If yes, pick one and make it explicit.
- could the suggested kebab-case task description match two unrelated tasks?
- does any "Confidence: low" marker name a SPECIFIC area that needs more research, or is it vague?

For each ambiguity, fix inline: tighten the wording, name the specific area, or add a one-line clarification.

## §3 — Self-review notes capture

After all four scans, the orchestrator captures what got cleaned up in \`research.md\`'s \`## Synthesis > ### Self-review notes\` subsection. The notes are 0-N short bullets; on a clean draft, write \"No self-review issues found.\" One bullet per fix the self-review applied:

\`\`\`markdown
### Self-review notes

- Filled \`<TBD>\` in Engineer > Implementation paths > path 2 con (lifted from lens slim-summary Notes line: "Path 2 trade-off: requires migration").
- Reframed Synthesis paragraph 2 — original drifted toward \"how to migrate\" but topic was \"should we migrate\".
- Tightened Recommended next: kebab-case task was \`add-caching\`; now \`add-redis-cache-to-search-endpoint\` to match dialogue scope.
- Removed contradiction: synthesis claimed engineer + product converged on Redis but product lens listed Redis as a "do nothing" alternative pro; restated as divergence.
\`\`\`

The self-review notes are part of \`research.md\` (visible to the user / follow-up flow); they are NOT separately persisted. The follow-up \`/cc <task>\` flow's architect reads \`research.md\` end-to-end as \`priorResearch\` context — including the Self-review notes block, which signals which areas had to be tightened during synthesis.

## §4 — Pass exits

The pass exits when one of:

- All four scans returned no findings → write \"No self-review issues found.\" in the Self-review notes subsection and proceed to Phase 4 finalize.
- All findings were fixed inline → write the fix bullets into Self-review notes and proceed.
- A finding cannot be fixed inline (e.g. a lens returned a structurally invalid findings block that the orchestrator can't repair from the slim summary alone) → re-dispatch ONLY that lens once with a richer envelope (Phase 2 already permits one re-dispatch per lens, total cap 2). After the re-dispatch returns, restart the self-review pass on the updated draft. If the re-dispatch budget is already exhausted, write the finding into Self-review notes as \"Could not fix inline: <description>; surface to user as coverage gap\" and proceed (the synthesis pass's confidence-and-coverage paragraph picks it up).

## §5 — Worked examples

- **Light depth, clean self-review** — \`/cc research is hono still actively maintained vs fastify\` stamps \`research_depth: light\` (clarification wording), dispatches engineer + skeptic only, synthesis converges; the only self-review fix is an ambiguity tighten (recommended-next \`add-hono-experiment\` → \`add-hono-side-by-side-prototype\`).
- **Deep-product depth, scope drift** — \`/cc research should we build a new internal calendar instead of using google calendar\` stamps \`research_depth: deep-product\` (greenfield wording), fires the Thesis / Adjacent-product / Durability probes; the scope-drift scan catches a synthesis that drifted into "how to build it" and re-anchors it on "should we?".

## §6 — Anti-rationalization

| rationalization | truth |
| --- | --- |
| "Self-review found a placeholder — leave it; the user will fill it in." | NO. Placeholders are structural failures; fix inline or escalate via re-dispatch BEFORE \`research.md\` lands. |
| "Light depth means I can skip the self-review pass." | NO. Fewer lenses still produce a synthesis that can drift, contradict, or carry placeholders. The self-review runs at every depth. |
| "I'll skip Self-review notes when clean — saves a few lines." | NO. \`No self-review issues found.\` verbatim is the canonical empty state; the follow-up architect reads an absent section as a structural failure. |
| "The recommendation contradicts the skeptic — but it's a cool plan, keep it." | NO. The contradiction scan exists to catch exactly this; if the skeptic flagged don't-proceed, fix the recommendation. |
`;

const RESEARCH_REVISION = `# On-demand runbook — research revision loop

The orchestrator opens this runbook whenever a \`/cc research <topic>\` flow lands at \`research.md\` and the user invokes one of \`/cc research revise <area>\` / \`/cc research push-back <claim>\` / \`/cc research accept\`. The runbook is the canonical procedure; the body of \`/cc\` carries only short pointers.

## §1 — Lifecycle gate (between Phase 3 synthesis and Phase 4 finalize)

Research mode runs a four-phase flow (discovery → lens-dispatch → synthesis → finalize) with an explicit **awaiting-user-review** gate between Phase 3 and Phase 4. The gate exists because reference patterns converged on the user-review surface — obra-superpowers' \`brainstorming/SKILL.md\` calls it the "User Review Gate" and runs it after every brainstorming pass; addyosmani's \`idea-refine/SKILL.md\` codifies divergent → converge → user-pick; everyinc-compound's \`ce-brainstorm/SKILL.md\` Phase 2.5 is a confirmation gate before any artifact ships.

The gate is mandatory on every research flow regardless of depth tier (\`light\` / \`standard\` / \`deep-product\`). Phase 3 ends with \`research.md\` on disk + the orchestrator stamping \`flow-state.json > researchState: "awaiting-user-review"\`; the orchestrator then surfaces a one-paragraph prompt in plain prose:

> "research.md is ready at .cclaw/flows/<slug>/research.md. Recommended next: <verbatim Phase 3 recommendation>. Options:
> - \`/cc research revise <area>\` — re-run targeted lens(es) and refresh the synthesis.
> - \`/cc research push-back <claim>\` — challenge a specific claim; re-runs skeptic + the lens that authored the claim.
> - \`/cc research accept\` — finalize and emit the handoff prompt."

The orchestrator then **ends its turn**. The gate is a structural pause, not a stop-and-report — there is no failure here, just an iteration surface. \`/cc-cancel\` works as usual (discards the in-flight research).

## §2 — \`/cc research revise <area>\` — broad re-dispatch

The \`<area>\` argument names which per-lens section the user wants re-run. The orchestrator parses \`<area>\` against the depth-tier lens set and re-dispatches every matching lens:

| \`<area>\` token | lenses re-dispatched (standard / deep-product) |
| --- | --- |
| \`engineer\` / \`technical\` / \`feasibility\` | \`research-engineer\` |
| \`product\` / \`user-value\` / \`market\` | \`research-product\` |
| \`architecture\` / \`coupling\` / \`boundaries\` | \`research-architecture\` |
| \`history\` / \`prior-attempts\` / \`learnings\` | \`research-history\` |
| \`skeptic\` / \`risk\` / \`failure-mode\` / \`abuse\` | \`research-skeptic\` |
| \`synthesis\` / \`recommendation\` / \`recommended-next\` | (re-runs synthesis only; no lens re-dispatch) |
| \`all\` / \`everything\` | every lens in the depth-tier set |

On \`light\` depth (\`research-engineer\` + \`research-skeptic\` only), \`<area>\` tokens that name lenses NOT in the light set (\`product\` / \`architecture\` / \`history\`) are a no-op with a one-line note ("requested area is skipped on light depth; rephrase the topic to invoke standard / deep-product depth (e.g. add an exploration framing) and re-run \`/cc research <topic>\` to widen coverage"). The state stays at \`awaiting-user-review\`.

### Steps

1. Stamp \`flow-state.json > researchState: "revising"\` and append a new entry to \`flow-state.json > revisions[]\` with \`kind: "revise"\`, \`at: <iso-now>\`, \`area: <verbatim user arg>\`, \`lensesRedispatched: <computed from area>\`, \`change\` absent (filled at §2.4 below).
2. Re-dispatch each lens in \`lensesRedispatched\` with the same envelope shape Phase 2 used PLUS a new \`Revision context:\` line carrying the prior lens findings + the user's \`<area>\` argument. The lens MAY return identical findings (no change warranted) OR rewritten findings (incorporating the revision context) — the lens's slim summary's \`Notes:\` line stamps "no change" / "revised" so the orchestrator can compose §2.4's \`change\` field.
3. Re-run the synthesis pass on the post-revision draft (Phase 3 steps 3 + 5 — re-compose \`## Synthesis\`, run the four-scan self-review). Skip Phase 3 step 1 (per-lens findings paste) for lenses that returned "no change"; preserve their prior sections verbatim.
4. Author the \`change\` field on the most-recent \`revisions[]\` entry — one sentence describing what concretely changed (e.g. "Engineer > Implementation paths rewritten to reflect fastify v6 release; Synthesis convergence paragraph 1 re-anchored on hono"). On a "no change" outcome, write "No structural change after re-dispatch (lenses confirmed prior findings)." verbatim.
5. Append the matching row to \`research.md > ## Revision history\`: \`| <iso> | revise | <area> | <comma-sep lensesRedispatched> | <change> |\`.
6. Re-stamp \`flow-state.json > researchState: "awaiting-user-review"\` (state cycles back; the user can iterate again or accept).
7. Surface the §1 prompt again with the **post-revision** \`research.md\` path so the user can re-read.

### Failure handling

- \`<area>\` parses to zero matching lenses AND is not \`synthesis\` / \`all\` → surface "unknown research area: <verbatim>; valid: engineer / product / architecture / history / skeptic / synthesis / all" in plain prose; state stays at \`awaiting-user-review\`; no entry appended.
- a re-dispatched lens returns \`Confidence: low\` AND the \`Notes:\` line names a thin-coverage gap → fall back to Phase 2's lens re-dispatch budget (1 re-dispatch per lens, total cap 2). After the cap, write the lens's findings as-is and stamp the synthesis self-review's "Could not fix inline: <description>" bullet.

## §3 — \`/cc research push-back <claim>\` — targeted challenge

The \`<claim>\` argument names a specific claim the user wants the orchestrator to challenge. The orchestrator parses \`<claim>\` to detect (a) which lens authored the claim (search per-lens sections for the verbatim or fuzzy match) and (b) the claim's polarity. Re-dispatches **two** lenses: the skeptic (always; counter-argument generator) and the authoring lens (re-checks its own claim with the push-back framing).

### Steps

1. Stamp \`flow-state.json > researchState: "revising"\` and append a new entry to \`flow-state.json > revisions[]\` with \`kind: "push-back"\`, \`at: <iso-now>\`, \`area: <verbatim claim>\`, \`lensesRedispatched: ["research-skeptic", <authoring-lens-id>]\` (de-dup if the authoring lens IS skeptic — re-dispatch once).
2. Re-dispatch the skeptic with a \`Push-back context:\` envelope carrying the verbatim claim + a directive: "find counter-arguments, edge cases, or evidence that contradicts the claim". The skeptic's findings block returns under \`### Counter-arguments to <claim>\` (verbatim heading) — the orchestrator inserts this subsection under the existing Skeptic lens body in \`research.md\`.
3. Re-dispatch the authoring lens with a \`Push-back context:\` envelope carrying the verbatim claim + a directive: "re-check the claim under push-back; either reaffirm with stronger evidence OR retract / qualify". The lens's slim summary \`Notes:\` line stamps "reaffirmed" / "qualified" / "retracted" so the orchestrator can author §3.5's \`change\` field.
4. Re-run the synthesis pass focused on the divergence paragraph (Phase 3 step 3); the \`## Synthesis\` divergence section gains an explicit "Push-back outcome on <claim>: <reaffirmed | qualified | retracted>" sentence. Re-run the four-scan self-review on the modified synthesis.
5. Author the \`change\` field on the most-recent \`revisions[]\` entry — one sentence describing the push-back outcome (e.g. "Skeptic surfaced 2 counter-arguments to engineer's 'fastify-is-best' claim; engineer qualified to 'fastify-is-best for plugin-heavy stacks; hono wins on cold-start'").
6. Append the matching row to \`research.md > ## Revision history\`: \`| <iso> | push-back | <claim> | research-skeptic + <authoring-lens-id> | <change> |\`.
7. Re-stamp \`flow-state.json > researchState: "awaiting-user-review"\`. Surface the §1 prompt again.

### Failure handling

- \`<claim>\` does not match any lens section by fuzzy search → surface "could not locate claim: <verbatim>; please cite the lens section + a verbatim phrase" in plain prose; state stays at \`awaiting-user-review\`; no entry appended.
- the skeptic returns "no counter-arguments found" → still append the row (with \`change: "Skeptic confirmed prior position; no counter-arguments surfaced"\`); the user reads this as the audit trail and may accept or push back further.

## §4 — \`/cc research accept\` — finalize

The terminal sub-command. The orchestrator finalises the flow exactly as Phase 4 finalize does:

1. Append a final entry to \`flow-state.json > revisions[]\` with \`kind: "accept"\`, \`at: <iso-now>\`, \`area: ""\` (empty — accept has no argument), \`lensesRedispatched: []\`, \`change: "User accepted research as final."\`. Append the matching row to \`research.md > ## Revision history\`: \`| <iso> | accept | — | — | User accepted research as final. |\`.
2. Stamp \`flow-state.json > researchState: "accepted"\` (terminal).
3. \`git mv\` \`research.md\` (and the assets dir if present) into \`.cclaw/flows/shipped/<slug>/\`.
4. Reset \`flow-state.json > currentSlug\` to \`null\` (and \`researchState\` stays \`"accepted"\` only on the just-shipped slug — the field is part of the slug's research-mode lifecycle, not the orchestrator-wide state).
5. Surface the **handoff prompt** in plain prose:

> "research.md is ready at .cclaw/flows/shipped/<slug>/research.md. Recommended next: <verbatim Phase 3 recommendation>. Ready to plan? Run \`/cc <task>\` and I'll carry the research as \`priorResearch\` context."

The next \`/cc <task>\` invocation reads the most-recent shipped research slug under \`flows/shipped/\` and stamps it into \`flow-state.json > priorResearch: { slug, topic, path }\`; the architect's Bootstrap on that follow-up flow reads \`priorResearch.path\` and includes the research artifact AND its \`## Revision history\` block as Frame / Approaches / Decisions context.

### Sub-cases

- **\`/cc research accept\` invoked without a prior \`revise\` / \`push-back\`** — valid; the user reviewed once and approved on first pass. Append the accept entry; the revision history table contains exactly one row.
- **High iteration count (≥5 revise / push-back entries before accept)** — the orchestrator surfaces a one-line note before finalize ("Accepting after <N> revisions; high-iteration flows tend to indicate the topic needs Phase 1 re-run with a tighter framing.") for self-audit; does not block finalize.

## §5 — State transitions

| from | event | to |
| --- | --- | --- |
| (none) | research-mode fork fires | \`discovery\` |
| \`discovery\` | user signals "ready" | \`lens-dispatch\` |
| \`lens-dispatch\` | all lenses returned (or partial after re-dispatch cap) | \`synthesis\` |
| \`synthesis\` | self-review pass complete + \`research.md\` written to disk | \`awaiting-user-review\` |
| \`awaiting-user-review\` | \`/cc research revise <area>\` | \`revising\` |
| \`awaiting-user-review\` | \`/cc research push-back <claim>\` | \`revising\` |
| \`awaiting-user-review\` | \`/cc research accept\` | \`accepted\` (terminal — finalize fires) |
| \`revising\` | revision lands + synthesis re-run + \`research.md\` rewritten | \`awaiting-user-review\` |

Legacy research-mode flows did not stamp \`researchState\`; resume on such a flow restarts from Phase 1 (no graceful resume — the field is the only way to track lifecycle position, and absence implies the field was never written).

## §6 — Revision history table shape

The \`research.md > ## Revision history\` table mirrors \`flow-state.json > revisions[]\` verbatim. Five columns:

| timestamp (ISO) | kind | area / claim | lenses re-dispatched | change |
| --- | --- | --- | --- | --- |
| \`2026-05-17T14:32:00Z\` | revise | engineer | research-engineer | Engineer > Implementation paths rewritten to reflect fastify v6 release. |
| \`2026-05-17T14:48:12Z\` | push-back | "fastify-is-best" claim | research-skeptic, research-engineer | Engineer qualified to "fastify-is-best for plugin-heavy stacks; hono wins on cold-start". |
| \`2026-05-17T14:55:00Z\` | accept | — | — | User accepted research as final. |

The table is **append-only**: the orchestrator never mutates a prior row (the audit trail is the contract). On a fresh research flow with zero revisions before accept, the table contains exactly one row (the accept entry); the section heading still ships in the template so readers always find it.

## §7 — Anti-rationalization

| rationalization | truth |
| --- | --- |
| "User-review gate slows the user down — let me skip it on light depth where lens count is small." | NO. The gate is depth-tier-agnostic. Light depth still produces a synthesis the user MUST audit before priorResearch flows downstream; skipping the gate is the failure mode this gate was designed to catch. |
| "Push-back claim doesn't fuzzy-match a lens section — I'll just re-dispatch the skeptic alone and call it a push-back." | NO. The contract requires both skeptic AND the authoring lens; without the authoring lens the push-back has no opportunity to qualify / retract. Surface the "could not locate claim" prompt and let the user re-cite. |
| "User invoked revise then accept then revise — the accept was terminal so the second revise is illegal." | The accept IS terminal; once \`researchState == "accepted"\` the slug is shipped. The "second revise" is actually a fresh \`/cc research <topic>\` flow on the now-shipped slug; treat it as a new flow. |
| "Revision count hit 5; let me block accept and force the user to re-run Phase 1." | NO. The high-iteration note is informational, not a block. The user may have legitimate reasons to iterate ≥5 times; surface the note and continue. |
| "I'll skip the Revision history append on a no-change revise — saves a row." | NO. Every revise / push-back / accept appends a row, even on no-change outcomes. The audit trail is the contract; absent rows are structurally undetectable later. |
`;

const DEBUG_BRANCH = `# On-demand runbook — debug-branch routing

The orchestrator opens this runbook on every transition from \`triage\` slim-summary return WHEN \`triage.taskShape == "debug"\`, AND on every transition from \`investigator\` slim-summary return to either architect / builder dispatch OR stop-and-report. The runbook is the canonical procedure; the body of \`/cc\` carries only short pointers (the "Debug-branch routing" section + the stage-table row for investigator + the #### investigator stage details section).

## §1 — Gate (when this runbook fires)

The gate is a single field check: \`flow-state.json > triage.taskShape == "debug"\`. The triage sub-agent emits this field on its slim-summary's \`Task shape:\` line when both conditions fire (see triage prompt's "Task shape detection" section): bug-shape keywords present (\`regression\` / \`error\` / \`broken\` / \`failing\` / \`wrong\` / \`incorrect\` / \`slow\` / \`crash\` / \`bug\` / \`fix\` paired with bug intent) AND repo-anchored evidence present (file:line, commit SHA, log excerpt, stack trace, test name with failure verb).

The gate is **independent of \`ceremonyMode\`** — debug-shape flows run the investigator at every ceremonyMode tier (\`inline\` skips investigator only when the inline path itself fires; on \`debug\` shape \`inline\` is rare because the bug-shape detection requires repo-anchored evidence which usually implies non-trivial scope). \`debug\` + \`inline\` is allowed: the investigator still runs (read-only, cheap) and the verdict is typically \`direct-fix\` (the orchestrator skips architect on inline regardless; the inline path's single-edit + commit IS the fix).

The gate is **orthogonal to \`triage.complexity\`** — a debug task can be any complexity tier; complexity drives \`ceremonyMode\` + \`path\`, while \`taskShape\` only inserts the investigator hop ahead of architect. **Do NOT modify the existing complexity classification machinery** — taskShape is a separate dimension; the two fields combine on dispatch.

## §2 — Dispatch envelope for investigator (iteration 0)

The orchestrator builds the dispatch envelope using the shape in \`dispatch-envelope.md\` PLUS the investigator-specific fields:

\`\`\`text
Stage: plan (investigator hop)
Specialist: investigator
Mode: three-lane-readonly
Iteration: 0

Required ethos read: .cclaw/lib/cclaw-ethos.md
Required first read: .cclaw/lib/agents/investigator.md
Required second read: .cclaw/lib/skills/investigation-discipline.md

Inputs:
- .cclaw/state/flow-state.json (triage block — taskShape MUST be "debug")
- .cclaw/flows/<slug>/investigation.md (skeleton; orchestrator stamps frontmatter)
- CONTEXT.md (when present)
- The bug report from the user's /cc invocation (carried verbatim in this envelope under "Bug report")

Bug report: <verbatim copy of the user's /cc <task> message, including any repo-anchored evidence the triage flagged>

Output contract: .cclaw/flows/<slug>/investigation.md (single-shot; overwrite on iteration 1)

Forbidden actions:
- No code edits (read-only specialist)
- No plan.md authoring (architect's job)
- No commits (builder's job on direct-fix path)
- No file writes outside .cclaw/flows/<slug>/investigation.md
\`\`\`

## §3 — Investigator slim summary shape (return contract)

The investigator returns exactly seven required lines plus an optional Notes line:

\`\`\`text
Stage: plan  (investigator hop)  ✅ complete
Artifact: .cclaw/flows/<slug>/investigation.md
Lanes: cause-code=<0-10>, cause-config=<0-10>, cause-measurement=<0-10>
Root cause: <one short sentence — verbatim from ## Root cause (working hypothesis) lead clause>
Next step: <direct-fix | needs-plan | more-investigation | not-a-bug>
Iteration: <0 | 1>
Confidence: <high | medium | low>
Notes: <one optional line; required when Confidence != high OR Next step in {more-investigation, not-a-bug}>
\`\`\`

The orchestrator parses this slim summary, patches \`flow-state.json\` (\`investigatorVerdict\` / \`investigatorIteration\` / \`investigatorConfidence\` / \`investigatorDispatchedAt\` / \`lastSpecialist: "investigator"\`), and branches on \`Next step:\`.

## §4 — Verdict routing matrix

| \`Next step:\` value | Action | Envelope mutations | flow-state.json patches | Stop? |
| --- | --- | --- | --- | --- |
| \`direct-fix\` | Dispatch \`builder\` directly (skip architect, plan-critic entirely — every rubric mode). Builder reads investigation.md as plan-substitute. | Builder envelope gets \`priorInvestigation: { path: "flows/<slug>/investigation.md", verdict: "direct-fix", confidence: "<high\|medium\|low>" }\`. NO plan.md is authored on this path. | \`investigatorVerdict: "direct-fix"\`, \`currentStage: "build"\` (skip plan-stage sub-steps). | no — continue to builder dispatch in same turn. |
| \`needs-plan\` | Dispatch \`architect\` with \`priorInvestigation\` on envelope. plan-critic gates (generic / design / devex) fire as normal afterwards. | Architect envelope (and every downstream specialist envelope in same flow) gets \`priorInvestigation: { path, verdict: "needs-plan", confidence }\`. | \`investigatorVerdict: "needs-plan"\`, \`currentStage: "plan"\` (architect runs next; plan-stage continues). | no — continue to architect dispatch in same turn. |
| \`more-investigation\` | Re-dispatch investigator with \`Iteration: 1\` (cap at 1; second \`more-investigation\` is a stop-and-report). | Investigator envelope iteration 1 carries the prior probe-recommendations forward in each lane's Hypothesis line. | \`investigatorIteration: 1\`, \`investigatorVerdict: "more-investigation"\`. | no on iter 0 → 1; yes on iter 1 → stop-and-report (see §5). |
| \`not-a-bug\` | Stop-and-report. Surface investigator's \`## Next step recommendation\` paragraph verbatim to the user. | none (turn ends). | \`investigatorVerdict: "not-a-bug"\`, \`currentStage: "stalled-not-a-bug"\` (immutable until \`/cc-cancel\` or user re-invokes \`/cc\`). | yes — end turn with reframe surfaced. |

## §5 — Stop-and-report status blocks

**On \`Next step: not-a-bug\`:**

\`\`\`text
Investigation concluded: not a bug
- Slug: <slug>
- Reframe: <verbatim copy of investigator's ## Next step recommendation paragraph, including the cited spec / docs / test that proves intent>
- Confidence: <high | medium | low>
- Notes: <optional Notes line if present in slim summary>
- Suggested next step: re-invoke /cc with a clarified task if you disagree; /cc-cancel to retire the slug.
\`\`\`

**On second \`Next step: more-investigation\` (iteration cap reached):**

\`\`\`text
Investigator cap reached
- Slug: <slug>
- Iterations: 2 (max)
- Last verdict: more-investigation
- Last confidence: <high | medium | low>
- Notes: <verbatim copy of investigator's last slim-summary Notes line — names the next probe the investigator would have run, surfaced to the user>
- Suggested next step: human-driven debug session needed; the agent's three-lane fan-out exhausted automated probes.
\`\`\`

## §6 — priorInvestigation envelope field (downstream propagation)

When the verdict is \`needs-plan\` OR \`direct-fix\`, the orchestrator carries \`priorInvestigation\` on every downstream dispatch envelope in the same flow so all specialists can cross-check against the cited root cause:

\`\`\`text
priorInvestigation: { path: "flows/<slug>/investigation.md", verdict: "<direct-fix|needs-plan>", confidence: "<high|medium|low>" }
\`\`\`

- **architect** (on \`needs-plan\`) — reads investigation.md at Bootstrap as load-bearing context; copies the root-cause lead clause verbatim into Frame's first clause; cites \`investigation.md\` inline for reviewer cross-check.
- **plan-critic** (on \`needs-plan\` when any rubric mode's gate fires — generic / design / devex) — cross-check plan.md's Frame + Decisions against the investigation's root cause; flag finding if plan diverges silently.
- **builder** (on \`direct-fix\` — no plan.md exists) — reads investigation.md as plan-substitute; RED-before-GREEN against the cited symptom; fix bounded to \`## Fix scope\` file:line refs; commit prefix \`fix(<scope>):\`.
- **builder** (on \`needs-plan\` — plan.md exists) — reads investigation.md as carry-over context; standard slice/AC flow; commit prefix \`<type>(SL-N):\` as normal.
- **reviewer** — cross-checks the diff against the investigation's cited root cause; flags finding if the diff addresses a different mechanism.
- **critic** — §3 skeptic question adds "does the fix actually address the cited root cause, or just paper over the symptom?"; cross-references investigation.md in the gap-analysis pass.

The field is required-when-set, absent-when-default; specialists default to "build shape" behaviour when the field is absent (back-compat with legacy envelopes).

## §7 — Re-dispatch on \`more-investigation\` (iteration 0 → 1)

When the verdict is \`more-investigation\` and \`investigatorIteration\` is 0:

1. Patch \`investigatorIteration: 1\` BEFORE the second dispatch.
2. Build the second dispatch envelope IDENTICAL to the first EXCEPT:
   - \`Iteration: 1\`
   - Add \`Prior probe: <verbatim copy of the iteration-0 slim summary's Notes line, when present, OR each lane's "Recommended next probe:" sentence concatenated>\` to the envelope.
3. The investigator on iteration 1 reads its OWN \`investigation.md\` from iteration 0 (the file is on disk) plus the prior probe field; it carries the prior probe-recommendations forward in each lane's Hypothesis line so the second pass is a sharper probe, not a verbatim re-run.
4. The second dispatch returns a slim summary; if \`Next step\` is again \`more-investigation\`, trigger §5's iteration-cap stop-and-report.

## §8 — Legacy state file migration

Legacy \`flow-state.json\` files lack the \`triage.taskShape\` field. The validator (\`src/flow-state.ts > assertTriageOrNull\`) accepts absent \`taskShape\` and treats it as undefined; the orchestrator's gate check (\`triage.taskShape === "debug"\`) is false on absent values, so the investigator hop does NOT fire on legacy flows — they run the legacy path verbatim (architect → plan-critic (any rubric mode that gates true)? → builder → qa? → reviewer → critic → ship). No migration is required; the investigator wiring is purely additive on the debug branch.

When a legacy flow that was originally a bug-shaped task resumes, the orchestrator does NOT retroactively dispatch the investigator (the architect's plan.md already exists; rerunning the investigator would be a wasted dispatch). The legacy flow continues to ship under the legacy routing; future debug-shaped flows benefit from the investigator hop.

## §9 — Anti-rationalization (read before opening this runbook)

| excuse | reality |
| --- | --- |
| "Bug-shape task with 4+ modules touched — auto-escalate to large-risky just because of the debug shape." | NO. taskShape is ORTHOGONAL to complexity. The complexity heuristic continues to run on its own signals; a bug task can be any complexity tier. The investigator hop inserts BEFORE architect regardless of complexity. |
| "Investigator returned \`direct-fix\` but the root cause is in 5 files — should I dispatch architect anyway?" | NO. The investigator's gate is "≤3 file:line refs in one module" — if it returned \`direct-fix\` on a 5-file root cause, the verdict is wrong. Surface as an investigator finding and re-dispatch (iteration 1 with sharper probe), OR override to \`needs-plan\` and dispatch architect with the (corrected) envelope. Do NOT silently dispatch architect on a \`direct-fix\` verdict — that breaks the contract. |
| "User cancelled mid-investigator — should I run architect to finish the work?" | NO. The investigator is read-only; if the user cancels, the flow is in state \`stalled-pre-investigator\`. \`/cc\` re-invocation continues the investigator dispatch (iteration 0 from scratch); \`/cc-cancel\` retires the slug. Don't smuggle architect work onto a debug-shaped slug. |
| "More-investigation cap was reached — I'll just dispatch architect with a stub investigation.md." | NO. The cap-reached stop-and-report surfaces the iteration-1 Notes line to the user; the user re-invokes \`/cc\` after manually probing OR \`/cc-cancel\` to retire the slug. Don't smuggle architect work after a cap-reached event. |
| "Investigator's verdict was \`not-a-bug\` but the user clearly thinks it IS a bug — let me dispatch architect anyway." | NO. \`not-a-bug\` requires cited spec / docs / test evidence in the investigator's recommendation paragraph. Surface that evidence to the user verbatim; if the user disagrees, they re-invoke \`/cc\` with a clarified task and the new flow's triage re-classifies. Don't ovoverride the investigator's evidence-backed verdict from the orchestrator. |
`;

const DETECT_MATRIX = `# On-demand runbook — Detect \`/cc\` invocation matrix

The orchestrator opens this runbook on every \`/cc\` / \`/cc <task>\` / \`/cc-cancel\` invocation BEFORE deciding to dispatch. The matrix is the canonical contract; the orchestrator body keeps a short summary pointer (see \`Detect — \`/cc\` invocation matrix\` section in start-command). The former \`skills/flow-resume.md\` reference doc is retired; this runbook + the start-command Detect matrix are the sole resume-contract surfaces.

## §1 — Active flow detection

Read \`.cclaw/state/flow-state.json\`. A flow is **active** when \`currentSlug != null\`. The finalize step resets \`currentSlug\` to \`null\` after moving artifacts to \`flows/shipped/<slug>/\`; a project that just shipped is back to no-active-flow. Missing / unparseable state initialises empty (treat as fresh / no active flow). Legacy schema versions hard-stop with the migration prompt (see start-command's \`## Detect\` table).

## §2 — Full dispatch matrix (every invocation × every active-flow shape)

| Invocation | Active flow? | Behaviour |
| --- | --- | --- |
| \`/cc\` (no args) | yes | **Continue silently.** Jump back into the saved \`currentStage\`, dispatch the next specialist (or chain the next auto-step). No picker, no resume summary. The user sees the next cockpit line directly. |
| \`/cc\` (no args) | no | Error in plain prose, in the user's language: \`No active flow. Start with /cc <task>, /cc <slug> <task> (refine a shipped slug), or /cc research <topic>.\` End the turn. |
| \`/cc <task>\` | yes | Error in plain prose, in the user's language: \`Active flow: <slug> (stage: <stage>). Continue with /cc. Cancel with /cc-cancel.\` End the turn. Do NOT auto-cancel or queue the new task. |
| \`/cc <task>\` | no | **Start a new flow.** Run the Detect git-check, refine-mode fork (first token is a shipped slug), research-mode fork in that order; if none fire, dispatch the \`triage\` sub-agent. |
| \`/cc research <topic>\` | yes | Error (same shape as \`/cc <task>\` + active flow). End the turn. |
| \`/cc research <topic>\` | no | Start a research-mode flow (see \`runbooks/research-depth-and-self-review.md\`). |
| \`/cc research go\` | yes (research-mode + \`researchState == "discovery"\`) | Force-exit Phase 1 discovery dialogue (identical to in-prose "ready" signal). Outside that state — error: \`'/cc research go' only fires during research-mode Phase 1 discovery.\` End the turn. |
| \`/cc research revise <area>\` / \`push-back <claim>\` / \`accept\` | yes (research-mode + \`researchState == "awaiting-user-review"\`) | Route to the matching sub-handler per \`runbooks/research-revision.md\` §2 / §3 / §4. Outside that state — error: \`research revision sub-commands only fire on a research flow at the awaiting-user-review gate.\` End the turn. |
| \`/cc <slug> <task>\` (first token is a shipped slug) | yes | Error (same shape as \`/cc <task>\` + active flow). End the turn. |
| \`/cc <slug> <task>\` (first token is a shipped slug) | no | Start a refine-mode flow (see \`runbooks/refine-mode.md\`); \`triage\` picks the ceremony (inline micro-edit vs soft/strict refine). |
| \`/cc-cancel\` | yes | Run the \`/cc-cancel\` runtime (move artifacts to \`cancelled/<slug>/\`, reset state). See \`commands/cc-cancel.md\`. |
| \`/cc-cancel\` | no | Error: \`No active flow to cancel.\` End the turn. |

## §3 — Plain-prose errors

Every error row above is **plain prose, in the user's language**. NOT a structured ask; NO option list; NO \`[y/n]\` picker. The user re-invokes \`/cc\` or \`/cc-cancel\` from their command palette to recover. \`<slug>\`, \`<stage>\`, and command tokens (e.g. \`/cc\`, \`/cc-cancel\`) stay English (wire protocol); the surrounding sentence renders in the user's language. Resume picker prose (\`[r] resume / [s] save / [n] new\`) is gone.

## §4 — The \`/cc\` continue path is silent

When \`/cc\` (no args) lands on an active flow, the orchestrator continues silently — no announcement, no slim-summary regen, no "Resuming \`<slug>\`…" line. The user sees the next cockpit line (or the chained stage's output) directly. If they want context they can read \`.cclaw/flows/<slug>/.continue-here.md\` directly, or read the most recent stage's artifact under \`.cclaw/flows/<slug>/\`.

## §5 — Worked examples (render in user's language; tokens stay English)

**Bare-resume on active flow:**

\`\`\`text
> /cc

[orchestrator silently continues the active flow; next slim summary appears here]
\`\`\`

**Active-flow conflict on a new \`/cc <task>\`:**

\`\`\`text
> /cc add a new feature

Active flow: 20260515-auth-cleanup (stage: review). Continue with /cc. Cancel with /cc-cancel.
\`\`\`

**No-active-flow start prompt:**

\`\`\`text
> /cc

No active flow. Start with /cc <task>, /cc <slug> <task> (refine a shipped slug), or /cc research <topic>.
\`\`\`

## §6 — Resume rules (immutable triage, restored last-specialist context)

1. **Triage is fully immutable.** A resumed flow keeps its \`ceremonyMode\`, \`complexity\`, \`path\`, and \`mode\`. The user does not re-pick. To change any, the answer is \`/cc-cancel\` and start fresh.
2. **Last-specialist context restored** by reading \`flows/<slug>/<stage>.md\`. The orchestrator does not summarise from memory.
3. **Time gate.** If \`flow-state.json > startedAt\` is >7 days ago, surface a one-line warning ("flow is stale — verify scope still applies") on the next chained stage's slim summary; never block resume.
4. **Sub-agent dispatch resumes from the same stage.** A build paused mid-RED for AC-3 resumes by dispatching builder for AC-3, not by restarting AC-1.
5. **Resume after stop-and-report.** \`/cc\` continues from saved \`currentStage\`. For build-failure / reviewer-fix stops, the auto-fix iteration counter is **preserved**.

## §7 — Anti-rationalization

| excuse | reality |
| --- | --- |
| "User typed \`/cc <task>\` mid-flight — auto-cancel the active flow and start fresh." | NO. Matrix Row 3 errors and ends the turn; \`/cc-cancel\` is a separate explicit user-typed command. Never pick for them. |
| "User typed a bare \`/cc\` on a fresh project — surface the start options as a structured picker." | NO. Matrix Row 2 errors in plain prose. The user types \`/cc <task>\` / \`/cc <slug> <task>\` (refine) / \`/cc research <topic>\` from their command palette. |
| "Active flow has a stop-and-report block from the last turn — surface a \`Continue or cancel?\` picker on the next \`/cc\`." | NO. \`/cc\` continues silently per Row 1. The stop-and-report block already named \`/cc\` (continue) and \`/cc-cancel\` (discard) in plain prose; the user typed \`/cc\` because they chose continue. |
| "Schema version is one behind — auto-migrate and continue." | YES if \`schemaVersion >= 2\` (the validator does the migrate on read; matrix Row "\`schemaVersion\` < 3" applies). NO if \`schemaVersion < 2\` — hard-stop with the migration prompt; do not auto-delete state. |
`;

const APPROACHES_GATE = `# On-demand runbook — Approaches Gate (research Phase 1.5)

The orchestrator opens this runbook on every transition from Phase 1 distillation exit to Phase 2 lens dispatch. The Approaches Gate is the canonical procedure; the orchestrator body keeps a short summary pointer (see \`#### Phase 1.5 — approaches gate\` section in start-command).

## §1 — Why the gate exists

Without the gate, lenses dispatch against an implicit single framing — whatever the orchestrator settled on during Phase 1 dialogue distillation — and downstream findings inherit that framing's blind spots. The Approaches Gate forces 2-3 candidate framings up front so the user can pick the framing(s) the lenses should carry in their dispatch envelopes.

Reference patterns:

- **obra-superpowers brainstorming Phase 2-3** ("2-3 approach options before committing").
- **addyosmani \`idea-refine\` Phase 1.3** Cluster + Stress-test discipline.
- **everyinc-compound ce-brainstorm Phase 2.5** confirmation gate.

## §2 — What a framing is

A framing is a DIFFERENT framing of the same research question — NOT 2-3 conclusions, NOT 2-3 implementation candidates (those are scoped to the engineer / product lens output). Each framing changes WHICH dimensions every lens emphasises.

Worked example for the topic **"add caching to the search endpoint"**:

- **framing A — Caching as infra primitive.** The question is which substrate (Redis / in-memory / HTTP cache). Engineer lens leans hardest, architecture lens covers infrastructure coupling, product / skeptic / history lenses are secondary.
- **framing B — Caching as search-quality lever.** The question is what we cache, how invalidation works, when to bust. Product + engineer split the load, skeptic centres on stale-data abuse cases.
- **framing C — Caching as organizational gate.** The question is ownership / on-call / who pages when the cache goes stale. Product + history + skeptic lead, engineer / architecture are secondary.

Each framing routes the lens dispatch differently even though the topic text is identical.

## §3 — Procedure

1. **Distil 2-3 framings** from the dialogue summary. Each framing carries:
   - \`id\` — short stable identifier (single letter \`A\` / \`B\` / \`C\` when no semantic shortname is obvious; otherwise kebab-case slug like \`infra-primitive\` / \`search-quality\` / \`governance\`).
   - \`title\` — 4-8 words.
   - \`summary\` — one paragraph (what question this framing makes load-bearing, what gets de-emphasised, which downstream lens dispatches see the biggest shape change).
2. **Stamp \`flow-state.json > approaches\`** as a \`ResearchApproach[]\` array (type lives in \`src/types.ts\`). Stamp \`flow-state.json > researchState: "approaches-gate"\` (transient sub-state of Phase 1; the canonical \`lens-dispatch\` lifecycle marker fires after the gate clears).
3. **Surface the framings** to the user in plain prose, in the user's language. Render each as a bulleted block with its id, title, and summary. End with the picker prompt:
   \`Pick one (e.g. "A" / "B") or accept "all" (every framing flows to every lens — the default).\`
4. **Wait for the user's pick.** Accept any of:
   - one or more single-letter ids (\`A\`, \`A B\`, \`A,B\`);
   - a slug match against \`title\` (case-insensitive substring);
   - \`all\` / \`every\` / \`every framing\` / \`default\` (selects every index — the canonical "all" surface) — also the default when the user says \`go\` / \`proceed\` without naming framings (the gate is non-coercive; the silent default is "all", not "stop").
5. **Stamp \`flow-state.json > selectedApproaches\`** as the zero-based indices into \`approaches[]\` that the user selected (or every index, for "all").
6. **Dispatch Phase 2** with the selected framings carried in every lens envelope under the new \`Framing:\` field (string array; one entry per selected framing as \`<framing-title> — <framing-summary>\`). Lens prompts are pinned to accept a \`framing: string[]\` envelope field; the lenses grade their findings against the selected framings rather than the implicit "any framing".

## §4 — Sub-cases

- **Only one obvious framing emerges from the dialogue** — surface that framing PLUS one stress-test variant ("framing B: what would be true if we were wrong about framing A?"). The user can pick the variant, accept "all" (both flow), or accept "A" (single). Never fewer than 2 framings; never more than 3.
- **User picks a framing not on the list** — accept verbatim as a new ad-hoc framing (no validation against the surfaced set), append it as the next-index entry in \`approaches[]\`, stamp \`selectedApproaches\` to point at it, proceed.
- **User explicitly cancels** ("stop", "never mind", "/cc-cancel") — run the cancel runtime (move the empty \`research.md\` to \`cancelled/<slug>/\`, reset state) and end the turn.
- **User wants to revise framings mid-research** — use the existing \`/cc research push-back <framing>\` machinery (push-back targets a claim; framings ARE claims about the research question). The push-back path treats the cited framing as the area to re-dispatch lenses against; the original \`approaches\` array is NEVER mutated (immutable for audit).

## §5 — Phase 2 envelope shape

The selected framings flow into Phase 2 as the \`Framing:\` field on every lens envelope:

\`\`\`text
Dispatch <lens-id>
─ Slug: <research-slug>
─ Topic: <stripped task text>
─ Dialogue summary: <5-15 bullets from Phase 1>
─ Framing: ["<title-A> — <summary-A>", "<title-C> — <summary-C>"]  # the selected framings
─ ...
\`\`\`

Lens prompts read \`Framing:\` as authoritative scope guidance. Findings are graded against the selected framings rather than the implicit "any framing".

## §6 — Anti-rationalization

| excuse | reality |
| --- | --- |
| "Topic is narrow — the orchestrator can pick one framing silently and skip the gate." | NO. The gate is non-coercive but mandatory. Narrow topics typically yield 2 framings + a stress-test variant; the variant exists precisely so narrow framings don't blind-spot. |
| "User said 'proceed' without picking — assume framing A (the first one)." | NO. The silent default is "all", not "first". \`go\` / \`proceed\` / \`run\` without a named pick selects every index. |
| "User picked an ad-hoc framing that contradicts the surfaced set — push back and ask for a refined pick." | NO. Accept verbatim and append as the next-index entry. User Sovereignty — the gate is the user's surface, not the orchestrator's. |
| "All three framings look the same — collapse to one and proceed." | NO. If 2-3 framings really collapse to one, the dialogue summary is too thin; loop one more Phase 1 round to surface the implicit dimensions, OR surface 2 framings + a stress-test variant ("framing B: what would be true if framing A were wrong?"). |
`;

const ONE_WAY_DOOR_GATE = `# On-demand runbook — One-way Door Gate

The orchestrator opens this runbook on every architect slim-summary return when \`Recommended next: awaiting-one-way-confirmation\` fires, AND on every \`/cc\` invocation that lands on \`flow-state.json > oneWayDoorConfirmation\` with \`userChoice\` absent. The runbook is the canonical procedure; the orchestrator body keeps a short summary pointer (see \`#### One-way Door Gate\` section in start-command).

## §1 — Why the gate exists

The ethos preamble names **User Sovereignty** as one of the five cross-cutting cclaw principles: irreversible decisions deserve explicit confirmation before build burns context. The architect's \`## Decisions\` table (strict mode) records each D-N's \`Reversibility:\` field — \`two-way\` (reversible, cheaply or with friction) or \`one-way\` (irreversible at production scale). \`one-way\` D-Ns are the only kind that warrant a user-pause; two-way decisions trust the cheap-revert affordance.

## §2 — Gate scan

After the architect's slim summary returns (with \`Recommended next: awaiting-one-way-confirmation\` if the gate fires, or any other value otherwise) AND before plan-critic (any rubric mode) / builder dispatch:

1. Read \`.cclaw/flows/<slug>/plan.md\`.
2. Scan for any \`## Decisions\` D-N row marked \`Reversibility: one-way\` (literal substring match against the rendered plan.md).
3. On ≥1 hit, the gate fires. On 0 hits, the always-auto chain continues to plan-critic (or builder when plan-critic's gate is off) — same shape as a strict plan with only two-way decisions. The gate is non-coercive: 0 hits = silent pass-through.

## §3 — Structural skip on lite-ceremony

On \`triage.ceremonyMode == "inline"\` the gate is structurally skipped — the path is just \`["build"]\`, no plan stage runs, no \`## Decisions\` table to scan. The \`Reversibility\` field machinery itself stays on the type for any future strict-mode flow that resumes from a stopped inline flow; the gate just never fires for lite-ceremony work because there is no irreversible-commit signal to gate on.

Soft ceremony writes \`plan.md\` without a Decisions section by default; the gate's scan returns 0 hits and the always-auto chain continues without pausing (same shape as strict-with-only-two-way-decisions).

## §4 — Flow-state transitions

The gate drives three transitions on \`flow-state.json > oneWayDoorConfirmation\` (\`{ decisionIds: string[]; userChoice?: "confirm" | "edit" | "cancel"; confirmedAt?: string }\`):

1. **\`architect-complete\` → \`awaiting-one-way-confirmation\`.** When the architect's slim summary returns \`Recommended next: awaiting-one-way-confirmation\` (architect's signal that the plan contains ≥1 one-way D-N), the orchestrator stamps \`oneWayDoorConfirmation: { decisionIds: ["D-N", "D-M", ...] }\` (with \`userChoice\` absent — the canonical "awaiting user" signal) and surfaces the structured ask. The orchestrator's turn ends here; control returns to the user.
2. **\`awaiting-one-way-confirmation\` → \`plan-critic\` (or \`builder\` when plan-critic's gate is off).** On \`confirm\`, the orchestrator stamps \`userChoice: "confirm"\` + \`confirmedAt: <iso-now>\`, then proceeds to plan-critic dispatch (or builder, per the existing plan-critic gate). The user-confirmed flag persists for the rest of the flow's lifetime; downstream specialists may read it as "the user explicitly accepted the irreversible commits".
3. **\`awaiting-one-way-confirmation\` → \`architect-revision\` (on \`edit\`) OR \`aborted\` (on \`cancel\`).** On \`edit\`, the orchestrator stamps \`userChoice: "edit"\` and surfaces a stop-and-report status block asking the user to edit \`plan.md\` (typically to soften a one-way classification to two-way or split the decision into two D-Ns) and re-invoke \`/cc\` once done — the next \`/cc\` re-reads plan.md and re-runs the gate scan. On \`cancel\`, the orchestrator stamps \`userChoice: "cancel"\` and routes to \`/cc-cancel\` (move artifacts to \`cancelled/<slug>/\`, reset state).

## §5 — Structured ask payload

Render verbatim (mechanical tokens English; surrounding prose in the user's language):

\`\`\`text
## One-way door detected
The architect committed to <count> irreversible decision(s):
- **D-N: <title>** — Reversibility: one-way
  Rationale: <D-N rationale, one-sentence verbatim copy from plan.md>
- **D-M: <title>** — Reversibility: one-way
  Rationale: <D-M rationale>
... (one bullet per one-way D-N)

User Sovereignty principle: irreversible decisions deserve explicit confirmation before build burns context.

Choose: confirm | edit | cancel
\`\`\`

- \`<count>\` is the integer count of one-way D-Ns the scan found.
- The bullet list iterates over EVERY one-way D-N in plan order (D-1, D-2, ...) — the orchestrator does not deduplicate, summarise, or drop entries; the user sees the full irreversible-commit set.
- The \`Rationale:\` line is a one-sentence verbatim copy of the \`Rationale:\` field from the same D-N in \`plan.md\` (per the D-N template). When the architect wrote a multi-sentence rationale, truncate at the first sentence and append \`...\` so the ask stays compact (the user can read the full rationale in plan.md if they want detail).

The final \`Choose:\` line is the structured ask. Use the harness's \`AskUserQuestion\` surface (Cursor's structured ask / Claude's TUI input) when available; fall back to the prose ask shape when the harness has no structured-ask primitive.

**Three options only — no fourth "accept-warns-and-ship" / "skip-gate" arm.** The cclaw discipline is "every irreversible commit deserves explicit confirmation"; adding a silent-accept escape hatch would defeat the gate's User Sovereignty contract.

## §6 — User pick handling

| User pick | Behaviour |
| --- | --- |
| \`confirm\` (or harness-equivalent click) | Stamp \`userChoice: "confirm"\` + \`confirmedAt: <iso-now>\`. Proceed to plan-critic (or builder when plan-critic's gate is off). |
| \`edit\` | Stamp \`userChoice: "edit"\`. Surface stop-and-report status block: \`Stopped at plan. Reason: User chose to edit plan.md before confirming one-way decisions. To continue: edit plan.md and run /cc. To discard: /cc-cancel.\` End the turn. Next \`/cc\` re-reads plan.md, re-runs the gate scan (typically fewer one-way D-Ns now — or none, if the user softened the classification). |
| \`cancel\` | Stamp \`userChoice: "cancel"\`. Route to \`/cc-cancel\` runtime (move artifacts to \`cancelled/<slug>/\`, reset state). |
| anything else (typo / free-text) | Treat as \`edit\` — stop-and-report with a one-line note ("Did not recognise your pick. Treating as edit; the gate re-fires on the next /cc."). The fallback is intentional User Sovereignty: ambiguous picks default to "user wants to think". |

## §7 — Downstream persistence

The \`oneWayDoorConfirmation\` field persists for the rest of the flow's lifetime once \`userChoice\` is set. Downstream specialists MAY read it:

- **plan-critic** (every rubric mode — generic / design / devex) — no-op; the gate fires BEFORE this specialist dispatches.
- **builder** — may surface a one-line note in \`build.md\` frontmatter (\`oneWayConfirmedAt: <iso>\`) for the critic to cross-reference.
- **reviewer / critic** — cross-check builder's \`build.md\` against the cited one-way D-Ns; flag findings if the build silently deviated from a confirmed irreversible commit.

## §8 — Anti-rationalization

| excuse | reality |
| --- | --- |
| "Soft mode plan has no Decisions section — the gate must fire anyway because the user might have implicit irreversible commits." | NO. Soft mode doesn't write \`## Decisions\`; the scan returns 0 hits; the gate is silently bypassed. Implicit irreversible commits are the architect's job to surface during Frame / Spec, not the orchestrator's to infer. |
| "User explicitly typed \`/cc skip-gate\` — they obviously want to skip the gate." | NO. There is no \`skip-gate\` sub-command. The matrix has three picks (\`confirm\` / \`edit\` / \`cancel\`); any other input falls back to \`edit\`. User Sovereignty does not include a silent-accept hatch. |
| "All one-way D-Ns are clearly the right call — the orchestrator can pre-confirm and skip the ask to save a turn." | NO. The architect's \`Reversibility: one-way\` tag IS the signal that the user must acknowledge before build burns context. Pre-confirming defeats the gate. |
| "Architect's slim summary said \`Recommended next: continue\` but the scan found a one-way D-N — trust the slim summary and skip the gate." | NO. The scan is the source of truth (plan-critic §A guarantees the field is present on every D-N in strict mode). When the slim summary and the scan disagree, the scan wins — and surface the inconsistency as an architect finding for the next iteration. |
`;

const RESEARCH_MODE = `# On-demand runbook — research-mode multi-lens flow

The orchestrator opens this runbook whenever the \`/cc\` argument starts with the literal token \`research \` (case-insensitive, exactly one space). The equivalent flag form is retired; the literal prefix is the sole entry point. The runbook is the canonical procedure; \`start-command.ts\` carries only the one-paragraph fork reference + the on-demand-runbooks trigger row.

## §1 — Fork detection and slug stamping

When the fork fires:

- Strip the trigger from the task text. The topic that flows into the lenses is the argument WITHOUT the leading \`research \`.
- Build a research-mode slug: \`YYYYMMDD-research-<semantic-kebab>\`. The \`-research-\` infix is mandatory; it keeps \`flows/shipped/\` unambiguous and distinguishes research artifacts from task flows.
- **Skip triage dispatch entirely.** Stamp \`flow-state.json > triage\` with sentinel values: \`mode: "research"\` + \`complexity: "large-risky"\` + \`ceremonyMode: "strict"\` + \`path: ["plan"]\` + \`rationale: "research-mode entry point"\` + \`research_depth: <light | standard | deep-product>\` (auto-classified from topic wording — full mapping in \`runbooks/research-depth-and-self-review.md\`. The explicit depth-override flags are retired).
- Stamp \`flow-state.json > currentSlug\` with the new slug, \`currentStage: "plan"\` (used purely as a sentinel — research mode has no plan / build / review / critic / ship stages; the field is the only signal that distinguishes "research in flight" from "task in flight" for the invocation matrix).

The orchestrator then enters the **multi-lens research flow**. The flow is four phases (with two intermediate gates at 1.5 and 3.5).

## §2 — Phase 0 — bootstrap (silent; main-context)

The orchestrator (NOT a sub-agent — research mode's discovery dialogue lives in the main-context flow so the user can iterate openly without round-trip envelopes) does:

1. Read \`.cclaw/state/flow-state.json\` (already initialised at the fork).
2. Read \`CONTEXT.md\` at the project root if it exists.
3. Read \`README.md\` first paragraph + Architecture / Purpose section for high-level project framing.
4. Initialise an empty \`.cclaw/flows/<slug>/research.md\` from the \`research\` template (\`.cclaw/lib/templates/research.md\`); the orchestrator will fill it in Phase 3.

## §3 — Phase 1 — iterative open-ended discovery dialogue with per-dimension scoring (main-context)

The orchestrator opens the dialogue with the user in plain prose, in the user's language:

> "Hi. What are you researching? Tell me what you know and what you don't."

The user replies. The orchestrator then runs the **same iterative per-dimension scoring machinery** as the architect Phase −1 Clarify protocol (see \`.cclaw/lib/agents/architect.md > Phase −1\`), with two adjustments:

- **Round cap is higher: 8 rounds** (vs 5 for architect Clarify). Research discovery has more axes to pin (research is exploratory by definition; the budget allows deeper questioning).
- **Math-gated exit threshold is the same: \`ambiguity < 0.25\`.** Both surfaces share the same exit math; only the round cap differs.

**Per-dimension scoring (same four dimensions as architect Clarify):**

| Dimension | Weight | What it measures in research mode |
| --- | --- | --- |
| \`goal\` | 0.4 | What question is the research answering? Can you state it in one sentence? Is the topic phrased as a question (good) or as a conclusion the user has already reached (bad — surfaces in skeptic lens otherwise)? |
| \`constraints\` | 0.3 | What's out of scope? What technical / organisational / time constraints bound the research? What's the user's risk tolerance? |
| \`criteria\` | 0.3 | What would a satisfying research output look like? "I want to know whether X" (concrete) vs "research X" (open-ended). What decision will the research unblock? |
| \`context\` | 0.0 | Repo / market / prior-art context. **Informational, not gating** — surfaced so the user can volunteer pointers (prior research, internal docs, competitor links), but the math-gated exit does NOT block on it. |

Compute the scalar:

\`\`\`text
ambiguity = 1 - (goal * 0.4 + constraints * 0.3 + criteria * 0.3 + context * 0.0)
\`\`\`

**Targeting + challenge-mode stance rotation (internal stance, no user-visible label):** the next question MUST target the weakest dimension. The same challenge-mode rotation applies (sourced from \`oh-my-claudecode/skills/deep-interview/SKILL.md > "Phase 3: Challenge Agents"\`); the stance is an internal authoring guide for the orchestrator's question composition — the user sees a single question with a single stance behind it, not a labelled round header.

- **Round 4 stance — contrarian.** Ask (silently) "what if the opposite were true?" against the weakest dimension. Tests whether the user's framing is correct or just habitual. (Architect's round 4 is the same stance; for research mode, round 4 may also probe "what if the user is researching the wrong question altogether?").
- **Round 5 stance — simplifier.** Ask (silently) "what's the simplest version of the question that would still be valuable to answer?". Finds the minimal viable research scope.
- **Rounds 6-8 (research only).** Continue with open-ended targeting on the weakest dimension; no specific stance injection. The extra rounds exist because research topics genuinely benefit from deeper questioning more often than task-mode Clarify does — but the math-gated exit usually fires before round 6 on focused topics.

**Do NOT render the per-round score table to the user.** The 4-row \`Dimension / Score / Weight / Why\` block and the trailing \`Next target: <weakest-dimension>\` line are **internal** to the orchestrator — compute them, use them to pick the weakest dimension, persist them to \`flow-state.json > clarifyRounds[]\`, but do NOT emit them in chat. The user sees only the next question. The user-visible render is dropped to keep research-mode discovery focused on the question (rendering the table is a dominant friction signal; the math itself is preserved). The persisted \`clarifyRounds[]\` array carries the full audit trail for compound learnings + later "why did we ask question 3?" inspection.

Stamp every round into \`flow-state.json > clarifyRounds[]\` (append-only) as a \`ClarifyRoundState\` entry (\`{ round, dimensionScores, ambiguity, targetedDimension, question }\`) — the SAME field used by architect Clarify; research-mode flows share the persistence surface.

**Exit conditions (any of):**

- Math-gated exit: \`ambiguity < 0.25\`.
- Round cap: 8 rounds asked.
- User signals readiness (any of "ready" / "I'm ready" / "go ahead" / "let's go" / "go on" / "proceed" / "finalize" / "explore now" / "dispatch the lenses" / "run the research" / "do it" / "ship it" / a clear "I've said what I know — over to you" framing).
- **User runs \`/cc research go\`** to force-exit the dialogue. The \`go\` sub-command is treated identically to the in-prose "ready" signal: stop asking, distil, proceed to Phase 1.5 Approaches Gate. \`go\` is the canonical "I trust the orchestrator to dispatch with what I've already said" force-exit; the orchestrator does NOT push back on the user even if \`ambiguity\` is still > 0.25.

When the dialogue exits, the orchestrator distils the conversation into a **dialogue summary** — 5-15 bullets capturing what the user told the orchestrator (topic refinement, known constraints, prior attempts, stakeholders, scope edges). The summary is the payload passed to each lens; the lenses do not see the raw dialogue.

The orchestrator MAY use any \`AskUserQuestion\` surface the harness provides for follow-up turns (Cursor's structured-ask, Claude's TUI text input, etc.) but the questions are open-ended (no multiple-choice picker, no "[y/n]" gate) — research-mode discovery is the one cclaw surface where free-form dialogue is the contract. The per-round table is NOT rendered in chat (the user sees only the next question); the round-by-round dimension scores persist silently into \`flow-state.json > clarifyRounds[]\` for audit and compound learnings.

If the user explicitly cancels mid-dialogue ("stop", "never mind", "/cc-cancel"), the orchestrator runs the cancel runtime (move the empty research.md to \`cancelled/<slug>/\`, reset state) and ends the turn.

**Reference patterns:** \`oh-my-claudecode/skills/deep-interview/SKILL.md\` (mathematical scoring + challenge-mode rotation); \`everyinc-compound\` brainstorming Phase 1.2 gap lenses (specificity / evidence / counterfactual / attachment — the same lenses backing the four canonical dimensions). The math-gated discipline keeps research mode from bleeding rounds when the user has already pinned the question.

## §4 — Phase 1.5 — approaches gate

Immediately after Phase 1 distillation and BEFORE Phase 2 dispatches any lens, the orchestrator runs the **Approaches Gate**: distil 2-3 candidate FRAMINGS of the research question (a framing is a DIFFERENT framing of the same question — NOT 2-3 conclusions or implementation candidates; each routes the lens dispatch differently) and ask which framing(s) the lenses should carry. Without the gate, lenses inherit an implicit single framing's blind spots. Reference patterns: obra-superpowers brainstorming Phase 2-3 ("2-3 approach options before committing") + addyosmani \`idea-refine\` Phase 1.3 Cluster + Stress-test.

Stamp \`flow-state.json > approaches\` (a \`ResearchApproach[]\`, \`src/types.ts\`) + \`researchState: "approaches-gate"\`; surface the framings + picker prompt \`Pick one (e.g. "A" / "B") or accept "all" (every framing flows to every lens — the default).\`; on the user's pick (single-letter ids, case-insensitive title substring, or \`all\` / \`default\` — the silent default is "all", the gate is non-coercive) stamp \`selectedApproaches\` (zero-based indices into \`approaches[]\`) and dispatch Phase 2 carrying the selected framings under each lens envelope's \`Framing:\` field. Mid-research re-framings route through \`/cc research push-back <framing>\` (\`approaches[]\` is never mutated).

Full procedure — picker grammar, sub-cases, the Phase 2 envelope shape, anti-rationalization — lives in \`runbooks/approaches-gate.md\`. Open it on every transition from Phase 1 distillation exit to Phase 2 lens dispatch.

## §5 — Phase 2 — parallel lens dispatch

When Phase 1.5 (Approaches Gate) clears, the orchestrator **dispatches research lenses in parallel**. The depth tier (\`triage.research_depth\`) controls the base lens set, and a topic's design-signal status conditionally adds the design lens:

- **\`light\` → engineer + skeptic** (2 lenses). Design is NOT added even when the topic touches UI — light-depth dispatches are narrow clarifications ("which library does X?") that don't carry enough framing to ground a design pass. Parenthetical \`*(Skipped on light depth.)*\` marks the absent four below.
- **\`standard\` (default) → engineer + product + architecture + history + skeptic** (5 lenses by default). When the orchestrator's design-signal heuristic fires (see "Design-signal detection" below), add \`research-design\` for a total of **6 lenses**.
- **\`deep-product\` → engineer + product + architecture + history + skeptic + extra probes (durability / thesis / adjacent-product) folded into product + skeptic prompts**. When the design-signal heuristic fires, add \`research-design\` for a total of **6 lenses** + extra probes; the design lens itself folds its own deep-product subsection (Adjacent design surfaces).

The **explicit user-toggle flags** override the heuristic in either direction:

- \`/cc research --lens=design <topic>\` — **force-include** the design lens on \`standard\` / \`deep-product\` depth even when the heuristic missed (the user knows it's a UI topic; the orchestrator stamps the flag verbatim). Ignored on \`light\` depth with a one-line note (\`design lens not dispatched on light depth; downgraded to standard if you want it included\`).
- \`/cc research --lens=-design <topic>\` — **force-exclude** the design lens on \`standard\` / \`deep-product\` depth even when the heuristic fired (the topic happens to mention "interface" but the user doesn't want a design pass; rare but valid).
- Multiple lens-toggle flags are accepted (\`--lens=design --lens=-skeptic\` is a no-op on \`-skeptic\` for now — only \`design\` is force-toggleable; other lenses are gated by depth tier). Future widening (e.g. \`--lens=-product\` to skip the product lens) is deferred.

**Design-signal detection.** The orchestrator's heuristic on \`standard\` / \`deep-product\` depth fires when ANY of:

- the topic text or dialogue summary names a UI / UX / design / frontend / accessibility / interface concept (e.g. \`UI\`, \`UX\`, \`design\`, \`frontend\`, \`accessibility\`, \`a11y\`, \`page\`, \`component\`, \`dialog\`, \`modal\`, \`form\`, \`button\`, \`navigation\`, \`onboarding\`, \`empty state\`, \`dashboard\`, \`landing\`, \`screen\`, \`affordance\`, \`positioning\`);
- the topic names a known design system / UI library (\`shadcn\`, \`Radix\`, \`Material 3\`, \`Polaris\`, \`Tailwind UI\`, \`Linear\`, \`Notion\`);
- the dialogue summary surfaces stakeholders described in user-facing terms (\`end users\`, \`customers\`, \`visitors\`, \`new signups\`) AND the topic is not a pure backend / infra / CLI / library refactor.

The heuristic is **inclusive**: when in doubt, dispatch the design lens. The lens's own scope rules (gate everything against the seven design-quality dimensions; mark \`out-of-scope\` honestly) absorb false positives gracefully — a backend topic accidentally dispatched against design ends up with all seven dimensions graded \`out-of-scope\` and a one-line "Internal-scope topic; no design surface implicated." block. False negatives (UI topics that miss the heuristic and need the user to add \`--lens=design\`) are the costlier failure mode.

**Lens roster (six lenses on standard with design added):**

- \`research-engineer\` — technical feasibility, stack fit, implementation paths, blockers, risks, rough effort.
- \`research-product\` *(Skipped on light depth.)* — user / product value, who benefits, alternatives considered (always including "do nothing"), market / domain context, open product questions.
- \`research-architecture\` *(Skipped on light depth.)* — surface impact, coupling points, boundaries crossed, scalability considerations, reusable in-repo patterns.
- \`research-history\` *(Skipped on light depth.)* — prior attempts via \`.cclaw/knowledge.jsonl\` + git log, lessons learned, outcome signals (reverted / manual-fix / follow-up-bug counts), directional drift.
- \`research-skeptic\` — failure modes, edge cases, abuse cases, hidden costs, explicit don't-proceed triggers.
- \`research-design\` *(Skipped on light depth; conditionally added on standard / deep-product depth via the design-signal heuristic or the \`--lens=design\` / \`--lens=-design\` user-toggle flags.)* — UI / UX / positioning / affordances lens. Walks the seven-dimension design-quality rubric (shared with the plan-critic's \`design\` rubric and the reviewer's design-quality axis) at research framing time — grades each dimension for relevance (\`load-bearing\` / \`relevant\` / \`tangential\` / \`out-of-scope\`), surfaces existing patterns to study (with first-class web search via \`user-exa\` / \`user-context7\`), anti-patterns to avoid (incl. canonical AI-slop signals), and open design questions for the follow-up architect.

Each lens receives the same envelope (build per \`runbooks/dispatch-envelope.md\` but with the lens-specific shape):

- \`Slug:\` — the research slug.
- \`Topic:\` — the stripped task text (no \`research \` prefix, no \`--lens=\` flag).
- \`Dialogue summary:\` — the 5-15 bullets from Phase 1.
- \`Framing:\` — the selected framing(s) from the Phase 1.5 Approaches Gate. A string array; each entry is \`<framing-title> — <framing-summary>\` for the framings the user picked (or every framing when the user accepted "all" / the default). Lenses grade their findings against this set rather than the implicit "any framing".
- \`Project root:\` — absolute path.
- \`Active flow state:\` — the sentinel triage block (lenses do not run heuristics on it).
- \`Research depth:\` — \`triage.research_depth\` (\`light\` / \`standard\` / \`deep-product\`); on \`deep-product\` product + skeptic + design fire extra probes, other lenses run identically.
- \`Required first read:\` — the lens contract at \`.cclaw/lib/research-lenses/<lens-id>.md\`.

Lenses run independently. The engineer + architecture lenses MAY dispatch \`repo-research\` on brownfield projects (the history lens reads \`.cclaw/knowledge.jsonl\` directly — that's the in-research mirror of \`learnings-research\`, and dispatching \`learnings-research\` from the history lens would be redundant; the design lens does NOT dispatch \`repo-research\` — its surface is design patterns external to or layered atop the repo). Lenses MAY use an MCP web-search tool (\`user-exa\`, \`user-context7\`, or comparable) when one is available; web search is **optional** for engineer / product / architecture / skeptic, **first-class** for design (the design lens treats every pattern claim as needing a URL citation or \`(general pattern; training knowledge)\` tag) — lenses fall back to training knowledge if no tool is wired, and stamp the fallback in their slim summary's \`Notes\` field. Research mode does NOT hard-require MCP web search.

Each lens returns a structured findings block (the markdown payload that becomes the \`## <Lens> lens\` section of \`research.md\`) and a slim summary (≤8 lines). The orchestrator collects all dispatched lenses before proceeding (5 default on standard; 6 when design is added; 2 on light; 5+ probes on deep-product without design; 6+ probes on deep-product with design).

If any lens returns \`Confidence: low\` AND the dialogue summary was thin, the orchestrator MAY re-dispatch ONLY that lens once with a richer envelope (extra bullets from the dialogue, the cited framing). Cap: 1 re-dispatch per lens, total cap 2 re-dispatches across the dispatched set. After the cap, proceed with partial findings — the synthesis section will surface the thin-coverage warning.

## §6 — Phase 3 — synthesis (main-context)

The orchestrator authors \`research.md\` by:

1. Pasting each lens's findings block verbatim under the corresponding section (\`## Engineer lens\`, \`## Product lens\`, \`## Architecture lens\`, \`## History lens\`, \`## Skeptic lens\`).
2. Writing the \`## Discovery dialogue summary\` section from the Phase 1 bullets.
3. Composing the \`## Synthesis\` section — a 3-7 paragraph cross-lens distillation. The synthesis surfaces:
   - Convergence: where 2+ lenses point the same way (e.g. "engineer + product both flag X as the blocker").
   - Divergence: where lenses disagree (e.g. "product says high value, skeptic flags an unmitigated abuse case").
   - The big trade-off space the user / follow-up architect must navigate.
3a. **Populating the \`## Key assumptions to validate\` section (KA-N ids).** 2-5 bullets naming **bets** the research rests on — beliefs about user demand, market state, technology behaviour, performance characteristics, or downstream system capability that the lenses absorbed as load-bearing premises rather than as findings. Each bullet leads with a stable \`KA-N\` id (Key Assumption N — \`KA-1\`, \`KA-2\`, ..., monotonically numbered) and pairs the bet with a validation method (benchmark, user research, log query, A/B test, prior-art scan) and a status (\`unvalidated\` on first authoring; \`validated\` / \`invalidated\` once evidence lands). Format: \`- **KA-N** — <assumption>. Validate by: <method>. Status: <unvalidated | validated | invalidated>\`. Distinct from \`## Framings considered\` (those are alternative shapes of the question; this section is the implicit beliefs the framings rely on). The follow-up \`/cc <task>\` flow's architect Bootstrap copies the bullets verbatim — KA-N ids preserved — into \`plan.md > ## Key assumptions to validate\` so the bets carry forward; the builder's optional \`validates: KA-N\` commit payload and the reviewer's \`assumption-coverage\` axis then close the loop on the bets as the build lands.
3b. **Populating the \`## Not Doing (and why)\` section.** 3-5 bullets naming scope explicitly excluded from this research's framing, each paired with a one-sentence rationale. Format: \`- **<scope item>** — <one-sentence reason>\`. Surfaces deliberate non-commitments the lens dispatch and synthesis already implied — adjacent topics deferred to a future research flow, framings dropped at the Approaches Gate, lens findings deliberately not synthesised. The follow-up \`/cc <task>\` flow's architect reads this section as load-bearing scope context — "the research already excluded X for reason Y — do not relitigate it in the plan's \`## Not Doing (and why)\` section". Every research that ships excludes something — name it; every research rests on bets — surface them with validation methods.
3c. **Composing the \`### Confidence summary\` subsection of \`## Synthesis\`.** Each lens now stamps per-finding numeric confidence in its \`### Findings (with confidence)\` block (each \`#### F-N (confidence: 0.0-1.0)\`). The synthesis pass aggregates across lenses in three parts: **weighted averages** per finding-equivalent (weight = 1/lens-count contributing; cite F-N ids inline); **confidence cliffs** (any pair with ≥0.5 spread on the same claim — the highest-signal divergence); **per-lens rollup** (mean confidence per lens, rounded to two decimals). RESEARCH_TEMPLATE pins the full format; emit \`No cross-lens confidence cliffs detected; per-lens means within ±0.15 of each other.\` verbatim when no cliffs exist. Mandatory section — absence is a structural failure for the follow-up \`/cc <task>\` architect Bootstrap, which reads research.md end-to-end as \`priorResearch\` context.
4. Composing the \`## Recommended next step\` section. The recommendation is ONE of:
   - **"plan with \`/cc <task>\`"** — research converges on a workable direction; risks are tracked but proceedable. Suggest a concrete kebab-case task description the user can type.
   - **"more research needed (specific area)"** — one or more lenses returned \`Confidence: low\` AND the user gap is concrete (e.g. "need to talk to the data team about the migration window first").
   - **"don't proceed (skeptic blocked: <reason>)"** — the skeptic lens set \`Don't-proceed: yes\` AND no obvious mitigation exists within the topic's scope. Cite the specific trigger.
5. Stamping frontmatter with \`lenses\` (the depth-determined subset; failed lenses marked \`failed\`), \`research_depth\`, \`generated_at\`.
6. **Synthesis self-review pass** — BEFORE \`research.md\` lands, walk the draft through four scans (placeholder / contradiction / scope drift / ambiguity); fix inline; record fixes in \`## Synthesis > ### Self-review notes\` (\`No self-review issues found.\` when clean). Full procedure in \`runbooks/research-depth-and-self-review.md\`.

## §7 — Phase 3.5 — awaiting user review

After Phase 3 lands \`research.md\` on disk, the orchestrator stamps \`flow-state.json > researchState: "awaiting-user-review"\` and surfaces the review prompt with three options: \`/cc research revise <area>\` (re-dispatch lens(es) covering \`<area>\` → \`engineer\` / \`product\` / \`architecture\` / \`history\` / \`skeptic\` / \`synthesis\` / \`all\`; cycles state back to \`awaiting-user-review\` after the rewrite); \`/cc research push-back <claim>\` (re-dispatch \`research-skeptic\` plus the authoring lens to challenge the cited claim; same cycle-back); \`/cc research accept\` (terminal — appends \`accept\` row to \`## Revision history\`, stamps \`researchState: "accepted"\`, runs Phase 4 finalize). Each revise / push-back appends a \`ResearchRevision\` entry to \`flow-state.json > revisions[]\` AND a row to \`research.md > ## Revision history\` (canonical audit trail; append-only). Lifecycle states: \`discovery\` → \`lens-dispatch\` → \`synthesis\` → \`awaiting-user-review\` ⇄ \`revising\` → \`accepted\`. Full procedure (parsing, lens-set mapping, fuzzy claim search, failure handling, anti-rationalization) lives in \`runbooks/research-revision.md\`. Reference patterns: obra-superpowers brainstorming User Review Gate, addyosmani idea-refine divergent-then-converge, everyinc-compound ce-brainstorm Phase 2.5 confirmation gate.

## §8 — Phase 4 — finalize

The orchestrator finalises the flow only after the user invokes \`/cc research accept\` at the Phase 3.5 gate (flows finalised straight from Phase 3): \`git mv\` the artifact into \`.cclaw/flows/shipped/<slug>/research.md\` (NO build / review / critic / ship stages — research mode has no implementation pipeline). Reset \`flow-state.json > currentSlug\` to \`null\`. After finalize, surface the **handoff prompt** in plain prose (no structured ask):

> "\`research.md\` is ready at \`.cclaw/flows/shipped/<slug>/research.md\`. Recommended next: <verbatim Phase 3 recommendation>. Ready to plan? Run \`/cc <task>\` and I'll carry the research as \`priorResearch\` context."

The next \`/cc <task>\` invocation on the same project reads the most-recent shipped research slug under \`flows/shipped/\` and stamps it into \`flow-state.json > priorResearch: { slug, topic, path }\`; the architect's Bootstrap on that follow-up flow reads \`priorResearch.path\` and includes the research artifact (including the \`## Revision history\` block) as Frame / Approaches / Decisions context.

## §9 — Sub-cases

- **Argument is \`research\` alone (no topic)** — surface \`research mode needs a topic; try '/cc research <topic>'\`, end the turn.
- **Research-mode + \`--lens=design\` flag on \`light\` depth** — design lens is structurally not dispatched on light depth (narrow clarifications). Drop the flag with a one-line note (\`design lens not dispatched on light depth; rephrase the topic to land on standard or deep-product depth to include it\`), then proceed with the light-depth 2-lens set.
- **Research-mode + \`--lens=design\` AND \`--lens=-design\` both present** — last-wins with a one-line note (\`mutually exclusive --lens=design / --lens=-design flags; using <last>\`), then proceed.
- **Research-mode + unknown \`--lens=<name>\` flag** (e.g. \`--lens=experimental\`) — drop the flag with a one-line note (\`unknown --lens=<name> flag; only --lens=design / --lens=-design accepted\`), then proceed with the heuristic-determined lens set.

(The per-flow ceremony override flags, the research-depth override flags, and the back-compat run-mode toggles are retired; research mode no longer has to absorb their precedence sub-cases.)
- **User cancels mid-dialogue** — run the cancel runtime, end the turn.
- **All dispatched lenses return \`Confidence: low\` (catastrophic — topic too abstract)** — synthesis section says so plainly; recommended next is "more research needed (refine the topic first, e.g. <one suggestion>)".

The multi-lens research mode is intentionally separate from the standard \`/cc <task>\` flow — research lenses are NOT in the \`SPECIALISTS\` array; they live in \`RESEARCH_LENSES\` (\`src/types.ts\`) and install to \`.cclaw/lib/research-lenses/\`. The roster is **six** lenses (engineer / product / architecture / history / skeptic / design). The flow roster is **eight** specialists (triage, architect, builder, plan-critic with three rubric scaffolds walked in one dispatch, qa-runner, reviewer, critic, investigator) — plan-critic's single-dispatch rubric set absorbed the former separate plan-design + plan-devex specialists.
`;

const TRIAGE_GATE = `# On-demand runbook — Triage hop (orchestrator-side)

The orchestrator opens this runbook on every fresh \`/cc <task>\` Triage hop (the research-mode fork bypasses this hop; refine-mode — a leading shipped-slug token — DOES dispatch triage, with the resolved \`parentContext\` attached to the envelope). The runbook is the canonical orchestrator-side procedure — persisted shape, audit-log surface, follow-up-bug detection, prior-context consumption, prior-learnings consumption, and the critic-stage insertion rule. The \`triage\` sub-agent's lightweight-router contract still lives in \`.cclaw/lib/agents/triage.md\`; this runbook covers ONLY what the orchestrator does around the dispatch.

## §0 — Repo-signal pre-scan (runs inside the triage sub-agent)

The triage sub-agent grounds its decision in a **bounded, read-only repo pre-scan** before scoring its heuristic (full contract on the triage agent prompt: blast-radius → \`complexity\`, sensitive-path → ceremony escalation, stack-fingerprint → design/devex priors). The orchestrator already passes \`Project root:\` on the envelope (the same root as the Detect git-check), so no extra wiring is needed. The scan only ever **escalates** rigor — never silently lowers it below the task-text baseline (the sole de-escalation stays the no-git → soft downgrade). The repo signals that moved the decision are recorded in \`triage.rationale\` (and the audit-log line); when a scan step was skipped the rationale carries \`repo-scan: skipped (<reason>)\`. The decision stays **immutable** for the flow's lifetime.

## §1 — Persisted triage shape

After the triage sub-agent returns, the orchestrator stamps \`flow-state.json > triage\` with the seven-field decision plus the audit fields. The persisted shape:

\`\`\`json
{
  "triage": {
    "complexity": "small-medium",
    "ceremonyMode": "soft",
    "path": ["plan", "build", "review", "critic", "ship"],
    "mode": "task",
    "rationale": "3 modules, ~150 LOC, no auth touch.",
    "decidedAt": "2026-05-08T12:34:56Z"
  }
}
\`\`\`

Always-auto: every non-inline path chains immediately at plan / review / critic gates; inline (\`triage.path == ["build"]\`) never pauses. \`mode\` is \`"task"\` on the standard \`/cc <task>\` entry point and \`"research"\` on \`/cc research <topic>\` flows; legacy state files lack the field and readers MUST default to \`"task"\`.

## §2 — Migration prose (surfaces, qa, prior-learnings)

**\`triage.surfaces\` is no longer written here.** The surface-detection step that used to live at this Hop moved to the architect (unified flow): the architect writes the surfaces list to \`flow-state.json\` after authoring \`## Frame\` + \`## Spec\` on either the soft or strict path; the inline path does not write the field (no specialist runs). The qa-runner gate continues to read \`triage.surfaces\` literally — only the WRITER moved. Legacy state files that already carry \`triage.surfaces\` from the orchestrator continue to validate unchanged; the value is read as ground truth on resume.

**\`triage.path\` no longer includes \`"qa"\` at triage time.** The qa-stage insertion that used to happen at this Hop moved to the architect's surface-write step: when the architect writes \`triage.surfaces\` and the detected surfaces include \`"ui"\` or \`"web"\` AND \`ceremonyMode != "inline"\`, the same write rewrites \`triage.path\` to insert \`"qa"\` between \`"build"\` and \`"review"\`. The qa-runner gate continues to read the rewritten \`triage.path\` at Hop 4.25; only the writer moved. Legacy state files whose \`triage.path\` already contains \`"qa"\` validate unchanged.

**the orchestrator no longer runs a prior-learnings lookup at this Hop.** The \`findNearKnowledge\` lookup that used to live between triage persistence and the first dispatch moved into the architect, which dispatches \`learnings-research\` (reads \`knowledge.jsonl\` directly) and queries the store on demand during Decisions / Pre-mortem. Legacy state files that carry \`triage.priorLearnings\` continue to be read verbatim by specialists on resume (back-compat); new flows leave the field absent.

## §3 — Audit log

\`.cclaw/state/triage-audit.jsonl\` is write-only telemetry (\`userOverrode\`, \`autoExecuted\`, \`iterationOverride\`); appends to this JSONL log instead of the triage object. Append one line per triage decision immediately after persisting the triage write (best-effort; if the write fails, log and continue). Schema mirrors \`TriageAuditEntry\` in \`src/triage-audit.ts\`:

\`\`\`json
{"decidedAt":"2026-05-08T12:34:56Z","slug":"<slug>","complexity":"small-medium","ceremonyMode":"soft","userOverrode":false,"autoExecuted":true}
\`\`\`

\`autoExecuted: true\` is the default (no user-facing ask at triage). The \`userOverrode: true\` branch is retired — the per-flow ceremony override flags it gated are gone, so the audit log records the heuristic-only decision deterministically.

## §4 — critic-stage insertion rule

\`triage.path\` includes the \`"critic"\` stage between \`"review"\` and \`"ship"\` whenever \`ceremonyMode != "inline"\`. On \`ceremonyMode: "inline"\` the path stays \`["build"]\`. See \`runbooks/critic-steps.md\` for the full contract.

## §5 — Follow-up-bug detection (applyFollowUpBugSignals)

Immediately after triage persistence, call \`applyFollowUpBugSignals(projectRoot, triage.taskSummary, <iso-now>)\` (in \`src/outcome-detection.ts\`). The helper reads \`.cclaw/knowledge.jsonl\`, scans \`taskSummary\` for slug-cased references to prior shipped slugs paired with a bug keyword (\`bug\` / \`fix\` / \`broken\` / \`regression\` / \`crash\` / \`hotfix\` / \`hot-fix\` / \`revert\` / \`rollback\`), and stamps \`outcome_signal: "follow-up-bug"\` on every match. Both signals (slug-cased reference AND bug keyword) are required so refinement / rephrase tasks that mention a prior without bug intent don't false-positive. Missing / empty / unreadable file is a no-op. Sister capture paths (\`reverted\`, \`manual-fix\`) run at compound time — see \`runbooks/compound-refresh.md\` and \`runCompoundAndShip\`. The follow-up-bug helper writes to \`.cclaw/knowledge.jsonl\` (telemetry on shipped entries); it does NOT write to \`flow-state.json > triage.priorLearnings\` (that field is no longer populated by the router; see §7 below).

## §6 — prior-context consumption (refine-mode)

When refine-mode stamped \`flowState.parentContext\`, specialists treat parent artifacts as load-bearing context (lazy \`await exists\` reads; missing = no-op). Per-specialist contracts: \`architect\` Bootstrap reads parent's \`## Spec\` / \`## Decisions\` / \`## Selected Direction\` and surfaces inheritance bullets in soft mode; on strict mode the architect's Plan-tier write authors the mandatory \`## Extends\` section in plan.md. \`reviewer\` adds a parent-contradictions cross-check; \`critic\` §3 adds a skeptic question on parent decisions. The field is orthogonal to \`priorResearch\` and may co-exist on a single flow. (On the inline micro-edit path the builder reads the parent plan directly and no architect/reviewer/critic runs.) Full per-specialist read patterns live in each specialist's contract; orchestrator-side dispatch + triage-inheritance lives in \`runbooks/refine-mode.md\`.

## §7 — prior-learnings consumption (architect owns the lookup; OUTCOME_SIGNAL_MULTIPLIERS)

The \`findNearKnowledge\` lookup that used to run at this hop and stamp \`triage.priorLearnings\` is removed from the orchestrator. The architect now owns the lookup:

- **soft + strict paths** — \`architect\` dispatches \`learnings-research\` as part of its pre-author research order. The research helper reads \`.cclaw/knowledge.jsonl\` directly, runs the Jaccard + outcome-signal weighting (\`OUTCOME_SIGNAL_MULTIPLIERS\` in \`src/knowledge-store.ts\`), and writes a short markdown summary that the architect folds into \`plan.md\`'s \`## Prior lessons\` section. On strict mode, the architect also queries the store on demand during the Decisions phase to weight D-N options against prior outcomes.
- **inline path** — no lookup runs (no specialist, no plan, no learnings to fold in).

Legacy state files that already carry \`triage.priorLearnings\` are read verbatim by specialists on resume (back-compat); the field stays on the \`TriageDecision\` type as optional + deprecated for one release. The router never writes it.

\`OUTCOME_SIGNAL_MULTIPLIERS\` is the sorted weighting table (reverted < follow-up-bug < manual-fix < good=unknown) that \`learnings-research\` uses to down-weight prior entries whose \`outcome_signal\` indicates the prior shipment regressed; the canonical values live in \`src/knowledge-store.ts\` and the outcome-loop tests pin the ordering.

## §8 — No-git auto-downgrade audit trail

The git-check sub-step (Detect hop) runs before this Triage hop dispatches; when \`<projectRoot>/.git/\` is absent the triage sub-agent stamps \`triage.ceremonyMode = "soft"\` regardless of class plus \`triage.downgradeReason = "no-git"\` as the audit trail. The orchestrator surfaces a one-sentence warning to the user after the triage sub-agent returns. The downgrade is one-way for the flow's lifetime; running \`git init\` mid-flight does not re-upgrade. Rationale + downstream consequences (strict requires per-AC commits; parallel-build needs \`git worktree\`; inline's terminal commit is gracefully suppressed) live in the triage sub-agent contract at \`.cclaw/lib/agents/triage.md > "No-git auto-downgrade"\` (the former \`skills/triage-gate.md\` reference doc was retired; the canonical contract now lives on the triage agent prompt).

## §9 — Slug naming

Every flow slug uses the format \`YYYYMMDD-<semantic-kebab>\` (UTC date + kebab-case 2-4 word summary). Examples: \`20260510-file-cli\`, \`20260512-approval-page\`, \`20260613-mute-notifications\`. The date prefix is **mandatory** — it keeps \`flows/shipped/\` unambiguous and makes same-day re-runs visible. The triage sub-agent's slim summary suggests a slug; the orchestrator finalises it (collision handling against \`.cclaw/flows/\` + \`.cclaw/flows/shipped/\` + \`.cclaw/flows/cancelled/\`). On same-day collision (rare), append \`-2\`, \`-3\`, etc. until the slug is unique.

## §10 — Anti-rationalization

| excuse | reality |
| --- | --- |
| "Re-run the orchestrator-side prior-learnings lookup to be safe — the architect might skip it." | NO. The architect's pre-author research order ALWAYS includes \`learnings-research\` on soft + strict; running the lookup at the orchestrator is double-work and risks stamping a stale \`triage.priorLearnings\` value. |
| "Skip the follow-up-bug helper when the task summary is short." | NO. \`applyFollowUpBugSignals\` is cheap (one JSONL read + a regex scan); skipping it loses the outcome-signal capture for the prior shipped slug. Missing / empty / unreadable file is already a no-op. |
| "Stamp \`triage.priorLearnings\` for back-compat — old specialists might still read it." | NO. Specialists do NOT read \`triage.priorLearnings\` from new flows. Legacy state files that already carry the field on disk are read verbatim by specialists on resume (back-compat); the router never writes it for new flows. |
| "Insert \`qa\` into \`triage.path\` here to be safe — the architect might forget." | NO. The qa-stage insertion is the architect's job (post-Frame surface-write step). Pre-empting it at the orchestrator double-writes and risks a stale path when the architect's surface detection lands a different conclusion. |
`;


export const ON_DEMAND_RUNBOOKS: OnDemandRunbook[] = [
  {
    id: "dispatch-envelope",
    fileName: "dispatch-envelope.md",
    title: "Dispatch envelope shape",
    body: DISPATCH_ENVELOPE
  },
  {
    id: "parallel-build",
    fileName: "parallel-build.md",
    title: "Parallel-build fan-out",
    body: PARALLEL_BUILD
  },
  {
    id: "finalize",
    fileName: "finalize.md",
    title: "Finalize step",
    body: FINALIZE
  },
  {
    id: "cap-reached-recovery",
    fileName: "cap-reached-recovery.md",
    title: "Cap-reached recovery",
    body: CAP_REACHED_RECOVERY
  },
  {
    id: "handoff-gates",
    fileName: "handoff-gates.md",
    title: "Handoff gates (self-review + ship)",
    body: HANDOFF_GATES
  },
  {
    id: "handoff-artifacts",
    fileName: "handoff-artifacts.md",
    title: "Handoff artifacts (HANDOFF.json + .continue-here.md)",
    body: HANDOFF_ARTIFACTS
  },
  {
    id: "compound-refresh",
    fileName: "compound-refresh.md",
    title: "Compound refresh + discoverability self-check",
    body: COMPOUND_REFRESH
  },
  {
    id: "pause-resume",
    fileName: "pause-resume.md",
    title: "Pause / resume mechanics (always-auto + Confidence gate)",
    body: PAUSE_RESUME
  },
  {
    id: "always-auto-failure-handling",
    fileName: "always-auto-failure-handling.md",
    title: "Always-auto failure handling",
    body: ALWAYS_AUTO_FAILURE_HANDLING
  },
  {
    id: "critic-steps",
    fileName: "critic-steps.md",
    title: "Critic steps (plan-critic + post-impl critic)",
    body: CRITIC_STEPS
  },
  {
    id: "qa-stage",
    fileName: "qa-stage.md",
    title: "QA step",
    body: QA_STAGE
  },
  {
    id: "refine-mode",
    fileName: "refine-mode.md",
    title: "Refine-mode entry point (refine a shipped slug; triage picks ceremony)",
    body: readRunbook("refine-mode.md")
  },
  {
    id: "research-depth-and-self-review",
    fileName: "research-depth-and-self-review.md",
    title: "Research depth tiers + synthesis self-review",
    body: RESEARCH_DEPTH_AND_SELF_REVIEW
  },
  {
    id: "research-revision",
    fileName: "research-revision.md",
    title: "Research revision loop (revise / push-back / accept)",
    body: RESEARCH_REVISION
  },
  {
    id: "debug-branch",
    fileName: "debug-branch.md",
    title: "Debug-branch routing (investigator hop + verdict matrix)",
    body: DEBUG_BRANCH
  },
  {
    id: "detect-matrix",
    fileName: "detect-matrix.md",
    title: "Detect /cc invocation matrix",
    body: DETECT_MATRIX
  },
  {
    id: "approaches-gate",
    fileName: "approaches-gate.md",
    title: "Approaches Gate (research Phase 1.5)",
    body: APPROACHES_GATE
  },
  {
    id: "one-way-door-gate",
    fileName: "one-way-door-gate.md",
    title: "One-way Door Gate",
    body: ONE_WAY_DOOR_GATE
  },
  {
    id: "dispatch-skills-index",
    fileName: "dispatch-skills-index.md",
    title:
      "Dispatch skills index (Phase C G-2 fix) — per-envelope reviewer skill pointers",
    body: DISPATCH_SKILLS_INDEX
  },
  {
    id: "research-mode",
    fileName: "research-mode.md",
    title: "Research-mode multi-lens flow (Phase 0-4 + Approaches Gate + revision loop)",
    body: RESEARCH_MODE
  },
  {
    id: "triage-gate",
    fileName: "triage-gate.md",
    title: "Triage hop (orchestrator-side; persist-shape + audit + follow-up-bug + prior-context + prior-learnings)",
    body: TRIAGE_GATE
  },
  {
    id: "builder-self-review-gate",
    fileName: "builder-self-review-gate.md",
    title: "Builder self-review gate (JSON summary blocks + 5+3 attestation rules)",
    body: readRunbook("builder-self-review-gate.md")
  },
  {
    id: "builder-tdd-walkthrough",
    fileName: "builder-tdd-walkthrough.md",
    title: "Builder TDD walkthrough (full-cycle bash transcripts + REFACTOR-skipped variants)",
    body: readRunbook("builder-tdd-walkthrough.md")
  },
  {
    id: "parallel-worktree",
    fileName: "parallel-worktree.md",
    title: "Parallel worktree dispatch (topological-layer worked example)",
    body: readRunbook("parallel-worktree.md")
  },
  {
    id: "clarify-protocol",
    fileName: "clarify-protocol.md",
    title: "Clarify protocol (architect Phase −1 4-dim scoring + gap lenses + stance rotation + anti-rationalizations)",
    body: readRunbook("clarify-protocol.md")
  },
  {
    id: "plan-md-templates",
    fileName: "plan-md-templates.md",
    title: "plan.md worked-example templates (soft + strict excerpts)",
    body: readRunbook("plan-md-templates.md")
  }
];

export const ON_DEMAND_RUNBOOKS_INDEX_SECTION = `## On-demand runbooks

These runbooks are opened only when the orchestrator hits a specific trigger (a dispatch, a parallel-build, a cap-reached review, etc.). The full \`/cc\` body keeps short pointers to each; the body lives here so the prompt budget stays under control.

| trigger | runbook |
| --- | --- |
${ON_DEMAND_RUNBOOKS.map((r) => `| ${r.title} | [\`${r.fileName}\`](./${r.fileName}) |`).join("\n")}
`;
