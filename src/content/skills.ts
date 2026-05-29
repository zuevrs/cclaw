import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Stages a specialist dispatch can target. Used by `AutoTriggerSkill.stages`
 * to declare which hops of the flow a skill is relevant for, and by
 * {@link buildAutoTriggerBlock} to render a stage-scoped subset of skills
 * inside each specialist prompt.
 *
 * - `triage`   — detect + triage steps (gate + persistence)
 * - `plan`     — design + ac-author (preflight / dispatch)
 * - `build`    — slice-builder (dispatch)
 * - `qa`       — qa-runner (on-demand; UI surfaces only)
 * - `review`   — reviewer / security-reviewer (dispatch)
 * - `ship`     — reviewer release + compound-and-ship
 * - `compound` — runCompoundAndShip's knowledge write loop
 * - `always`   — relevant at every step; rendered into every stage block.
 */
export type AutoTriggerStage =
  | "triage"
  | "plan"
  | "build"
  | "qa"
  | "review"
  | "ship"
  | "compound"
  | "always";

/**
 * Gate envelope passed to {@link buildAutoTriggerBlock} so a runtime
 * dispatch site (typically the orchestrator constructing the reviewer
 * dispatch envelope) can filter the per-stage block down to **only the
 * skills whose gates are currently active**. The reviewer's five gated
 * axes (qa-evidence / design-quality / security / nfr-compliance /
 * edit-discipline) are lifted out of `reviewer.ts` into per-axis
 * companion skills — the orchestrator passes the gate envelope
 * alongside the stage so the rendered block
 * lists only the reviewer-axis skills that will actually load.
 *
 * Every field is optional; an absent flag is read as `false` (gate did
 * not fire). Skills without a {@link AutoTriggerSkill.gate} predicate
 * are unaffected and ride every stage block they're tagged for.
 */
export interface GateEnvelope {
  /** Reviewer dispatch envelope flag — design-quality axis active. */
  walkDesignQualityAxis?: boolean;
  /** Reviewer dispatch envelope flag — qa-evidence axis active. */
  walkQaEvidenceAxis?: boolean;
  /**
   * `triage.securityFlag == true` OR `plan.md` frontmatter
   * `security_flag: true`. Surfaced as a gate signal so the
   * `reviewer-axis-security` skill can be conditionally pinned to the
   * dispatch envelope when the slug actually touches a sensitive
   * surface. (The reviewer still walks the lightweight five-item
   * threat-model on every iteration; this flag controls whether the
   * deep skill body is pinned.)
   */
  securityFlag?: boolean;
  /**
   * `plan.md` carries a non-empty `## Non-functional` section. Drives
   * whether the `reviewer-axis-nfr-compliance` skill is pinned to the
   * dispatch envelope.
   */
  planHasNonFunctional?: boolean;
  /**
   * `ceremonyMode != "inline"` AND `triage.downgradeReason != "no-git"`.
   * Drives whether the `reviewer-axis-edit-discipline` skill is pinned
   * (the axis always fires in strict / soft modes, but is structurally
   * skipped on inline / no-git).
   */
  editDisciplineActive?: boolean;
  /**
   * `flows/<slug>/plan.md` carries a non-empty `## Not Doing (and why)`
   * section. Retained as the Not-Doing plan-state signal: the dedicated
   * `scope-drift` reviewer axis is **retired** — its check folds into
   * the `reviewer-axis-edit-discipline` skill (Sub-check 3, the
   * four-signal Not-Doing cross-reference). Always true on non-inline
   * ceremonies (plan-critic §6.5 already gates ship on the section being
   * non-empty), but legacy archived plans and the inline path skip the
   * signal. plan-critic gates the section's presence; the folded
   * edit-discipline sub-check gates the build's compliance with its
   * exclusions.
   */
  walkScopeDriftAxis?: boolean;
  /**
   * `flows/<slug>/plan.md > ## Key assumptions to validate` carries
   * ≥1 bullet with a `KA-N` id (stable assumption-row id). Retained as
   * the assumption-validation plan-state signal: the dedicated
   * `assumption-coverage` reviewer axis is **retired** (it was
   * advisory-only / cap-at-consider and never blocked ship), but the
   * surrounding assumption-validation subsystem survives — the builder's
   * `validates: KA-N` commit payload still flips matching rows via the
   * flow-state validator (`src/assumption-validation.ts`), and
   * unvalidated high-stakes rows still surface in ship.md
   * `## Unvalidated assumptions`. The orchestrator sets the flag when it
   * detects the section at dispatch time; legacy plans with no section,
   * plans whose bullets lack the `KA-N` id, and inline ceremonies skip
   * the signal.
   */
  walkAssumptionCoverageAxis?: boolean;
  /**
   * List of high-stakes `KA-N` ids that crossed the ship line
   * without a closing `validates: KA-N` payload. Stamped by the
   * orchestrator alongside {@link walkAssumptionCoverageAxis} when
   * the assumption-coverage gate fires; computed via
   * {@link unvalidatedHighStakesKaIds} against the post-flip
   * plan.md (the orchestrator runs the flow-state validator
   * BEFORE composing the reviewer dispatch envelope so the field
   * reflects the latest row statuses, including any flips landed by
   * `verify(AC-*): passing` commits in the current build range).
   *
   * The list lets the orchestrator surface each unvalidated high-stakes
   * id directly in ship.md `## Unvalidated assumptions` without
   * re-parsing plan.md — one `KA-N: not validated by any commit despite
   * high-stakes label` row per id. Non-high-stakes unvalidated rows
   * continue to surface in the same section but never escalate beyond
   * user acknowledgement.
   *
   * Optional + back-compat: legacy dispatch envelopes lack the
   * field; readers MUST default to `[]` / absent. An absent field
   * forces a re-parse of plan.md (legacy behaviour; still correct, just
   * slower); a present field is the fast path. Empty array means "the
   * gate fired but no high-stakes row remained unvalidated".
   */
  unvalidatedHighStakesKas?: ReadonlyArray<string>;
  /**
   * Retained for back-compat only — the gated `anti-slop` reviewer axis
   * is **retired** (it was advisory-only / cap-at-consider and never
   * blocked ship, so cutting it changes no ship decision). No skill
   * gates on this flag anymore; the separate always-on `anti-slop` stage
   * skill (id `anti-slop`, the redundant-verification / silent-skip
   * guard) rides every dispatch independently and is unaffected. The
   * field persists because existing reviewer dispatch envelopes and
   * gate-wiring fixtures still set `walkAntiSlopAxis`; readers may
   * ignore it. Historically default-on (`walkAntiSlopAxis !== false`).
   */
  walkAntiSlopAxis?: boolean;
}

export interface AutoTriggerSkill {
  id: string;
  fileName: string;
  description: string;
  triggers: string[];
  /**
   * Stages at which this skill is relevant for prompt assembly. Optional
   * for the legacy data shape; an omitted field is treated as `["always"]`
   * (the skill rides every stage's block). Each call-site of
   * {@link buildAutoTriggerBlock} passes the stage it is dispatching for;
   * only skills whose `stages` includes the value (or `"always"`) appear
   * in the rendered block.
   *
   * The disk-layer behaviour is unchanged — `install.ts` still writes
   * every skill in {@link AUTO_TRIGGER_SKILLS} to `.cclaw/lib/skills/*.md`
   * irrespective of stage tags. Stage filtering is **runtime-only** for
   * specialist prompt composition.
   */
  stages?: ReadonlyArray<AutoTriggerStage>;
  /**
   * Optional gate predicate — when present, {@link buildAutoTriggerBlock}
   * only emits the skill's pointer when the caller supplies a
   * {@link GateEnvelope} that the predicate accepts. When the caller
   * omits the gate envelope entirely (legacy / module-import-time
   * call-sites such as the reviewer-prompt template literal), the
   * gate is **bypassed** — the skill rides the stage block as if no
   * predicate had been declared. This keeps legacy callers working
   * verbatim while letting runtime call-sites (orchestrator dispatch
   * envelope construction) opt into gate filtering.
   *
   * Used by the five reviewer-axis
   * companion skills (qa-evidence / design-quality / security /
   * nfr-compliance / edit-discipline). The reviewer's prompt header
   * still pre-renders the unfiltered block at module load (so an agent
   * reading the prompt sees the full reviewer-stage skills index); the
   * orchestrator's dispatch envelope can call
   * `buildAutoTriggerBlock("review", env)` to render a tighter,
   * gate-filtered block at runtime.
   */
  gate?: (env: GateEnvelope) => boolean;
  body: string;
}

/**
 * Load a per-skill markdown body from disk at module-import time.
 *
 * split the 24 inline template literals out of this file into
 * `src/content/skills/<id>.md`, then progressively consolidated
 * near-duplicate clusters into survivor skills (commit-hygiene absorbed
 * ac-discipline + slice-discipline; summary-format absorbed
 * structured-status + completion-discipline + receiving-feedback;
 * debug-and-browser absorbed qa-and-browser; investigation-discipline
 * absorbed pre-edit-investigation; plan-authoring absorbed refinement),
 * leaving 20 skill bodies on disk. Each `.md` is the single editable
 * source of truth; this loader pulls them back in so
 * `AUTO_TRIGGER_SKILLS[i].body` keeps the same string contract for
 * `install.ts` and the test suite.
 *
 * Resolution mirrors the pattern in `src/constants.ts > readCclawVersion`:
 *
 * - dev / test:  `<repo>/src/content/skills.ts` → `<repo>/src/content/skills/<file>`
 * - dist:        `<repo>/dist/content/skills.js` → `<repo>/dist/content/skills/<file>`
 *
 * The build step `scripts/copy-skill-md.mjs` mirrors `src/content/skills/*.md`
 * into `dist/content/skills/` after `tsc` so both layouts work.
 *
 * Hard-fail with a clear error rather than papering over with an empty
 * string — a missing skill body would silently ship a broken install.
 */
function readSkill(fileName: string): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const full = path.resolve(here, "skills", fileName);
  let raw: string;
  try {
    raw = readFileSync(full, "utf8");
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new Error(`cclaw: failed to read skill body ${full} (${reason})`);
  }
  // Normalize CRLF → LF. The .gitattributes file pins skill .md to `eol=lf`,
  // but Windows checkouts predating that rule, or downstream consumers using
  // a custom `core.autocrlf` setting, can still hand us \r\n. The runtime
  // contract requires the body to start with `---\n` and contain LF-only
  // separators (install.ts copies the body byte-for-byte into `.cclaw/lib/
  // skills/*.md`, where downstream tooling expects POSIX newlines).
  return raw.replace(/\r\n/gu, "\n");
}

export const AUTO_TRIGGER_SKILLS: AutoTriggerSkill[] = [
  {
    id: "plan-authoring",
    fileName: "plan-authoring.md",
    description: "Auto-applies whenever the agent edits .cclaw/flows/<slug>/plan.md. Absorbs the refinement decision tree (amend / rewrite / refine-shipped / new) — fires at the Detect matrix when /cc detects an existing plan match (active or shipped).",
    triggers: ["edit:.cclaw/flows/*/plan.md", "create:.cclaw/flows/*/plan.md", "existing-plan-detected"],
    stages: ["triage", "plan"],
    body: readSkill("plan-authoring.md")
  },
  {
    id: "parallel-build",
    fileName: "parallel-build.md",
    description: "Rules and execution playbook for the parallel-build topology.",
    triggers: ["topology:parallel-build"],
    stages: ["build"],
    body: readSkill("parallel-build.md")
  },
  {
    id: "review-discipline",
    fileName: "review-discipline.md",
    description: "merge of review-loop + security-review. The unified flow absorbs the former `security-reviewer` specialist into reviewer's `security` axis — the skill now wraps every reviewer invocation with the shared Findings table, nine-axis pass (incl. the absorbed full threat-model coverage on the security axis), Five Failure Modes, and (for sensitive diffs) the five-item threat-model checklist.",
    triggers: ["specialist:reviewer", "security-flag:true", "diff:auth|secrets|supply-chain|pii"],
    stages: ["review"],
    body: readSkill("review-discipline.md")
  },
  {
    id: "tdd-and-verification",
    fileName: "tdd-and-verification.md",
    description: "merge of tdd-cycle + verification-loop + refactor-safety. Always-on whenever stage=build. Granularity scales with ceremony_mode (inline = optional, soft = one cycle per feature, strict = full RED → GREEN → REFACTOR per criterion). The verification gate (build → typecheck → lint → test → security → diff) wraps every handoff; refactor-safety governs behaviour-preserving slugs and the REFACTOR step.",
    triggers: [
      "stage:build",
      "specialist:builder",
      "specialist:reviewer",
      "stage:review",
      "stage:ship",
      "task:refactor",
      "pattern:refactor"
    ],
    stages: ["build", "review", "ship"],
    body: readSkill("tdd-and-verification.md")
  },
  {
    id: "commit-hygiene",
    fileName: "commit-hygiene.md",
    description: "merge of commit-message-quality + surgical-edit-hygiene + ac-discipline (ac-quality + ac-traceability) + slice-discipline (slice-quality + slice-traceability) — the single commit-contract skill. Enforces commit-message conventions AND the always-on rules for builder commits: posture-driven subject-line prefix in strict mode — slice work `red(SL-N):` / `green(SL-N):` / `refactor(SL-N):` / `test(SL-N):` / `docs(SL-N):`, AC verification `verify(AC-N): passing`; no drive-by edits to adjacent comments / formatting / imports; remove only orphans your changes created; mention pre-existing dead code under Summary. Carries the slice 3-check (atomic / surface-bounded / dependency-honest) + AC 3-check (observable / independently committable / verifiable) authoring rubrics, the SL↔AC mapping, parallel-by-default topology, and reviewer finding templates for A-4 (drive-by) and A-5 (deleted pre-existing dead code).",
    triggers: ["always-on", "specialist:builder", "before:git-commit", "edit:.cclaw/flows/*/plan.md", "specialist:architect", "specialist:reviewer:text-review", "before:git-push", "ceremony_mode:strict"],
    stages: ["plan", "build", "review", "ship"],
    body: readSkill("commit-hygiene.md")
  },
  {
    id: "conversation-language",
    fileName: "conversation-language.md",
    description: "Always-on policy: reply in the user's language; never translate paths, AC ids, slugs, hook output, or frontmatter keys.",
    triggers: ["always-on"],
    stages: ["always"],
    body: readSkill("conversation-language.md")
  },
  {
    id: "anti-slop",
    fileName: "anti-slop.md",
    description: "Always-on guard against redundant verification, env-specific shims, and silent skip-and-pass fixes.",
    triggers: ["always-on", "task:build", "task:fix-only", "task:recovery"],
    stages: ["always"],
    body: readSkill("anti-slop.md")
  },
  {
    id: "source-driven",
    fileName: "source-driven.md",
    description: "Detect stack + versions from manifest, fetch official documentation deep-links, implement against documented patterns, cite URLs in plan/decisions/code. Default in strict mode for framework-specific work.",
    triggers: ["ceremony_mode:strict", "specialist:architect", "framework-specific-code-detected"],
    stages: ["plan", "build"],
    body: readSkill("source-driven.md")
  },
  {
    id: "summary-format",
    fileName: "summary-format.md",
    description: "cclaw's single status & completion authority. Standard three-section ## Summary block (Changes made / Things I noticed but didn't touch / Potential concerns) appended to every authored artifact + the canonical Confidence ladder; PLUS the builder status enum DONE / DONE_WITH_CONCERNS / NEEDS_CONTEXT / BLOCKED with monotone aggregation (absorbed structured-status); the completion-discipline evidence gate + forbidden-phrase list — no done/ready/looks-good without fresh evidence (absorbed completion-discipline); and the receiving-feedback four-step response pattern (restate / classify / plan / evidence) + forbidden-phrase list (absorbed receiving-feedback). Forces specialists to surface scope-creep candidates, emit a machine-readable status, verify before claiming done, and respond to findings with structure instead of sycophancy.",
    triggers: [
      "always-on",
      "edit:.cclaw/flows/*/plan.md",
      "edit:.cclaw/flows/*/build.md",
      "edit:.cclaw/flows/*/review.md",
      "edit:.cclaw/flows/*/ship.md",
      "edit:.cclaw/flows/*/learnings.md",
      "stage:build",
      "specialist:builder",
      "before:slim-summary",
      "before:Recommended-next-continue",
      "before:findings-row-close",
      "before:ship-stamp",
      "stage-exit:any",
      "ceremony_mode:strict",
      "ceremony_mode:soft",
      "input:review.md",
      "input:critic.md",
      "input:reviewer-security-axis-findings",
      "input:user-feedback",
      "mode:fix-only",
      "ship-gate:findings"
    ],
    stages: ["always"],
    body: readSkill("summary-format.md")
  },
  {
    id: "documentation-and-adrs",
    fileName: "documentation-and-adrs.md",
    description: "Repo-wide ADR catalogue at docs/decisions/ADR-NNNN-<slug>.md. The architect (Compose phase, strict posture) proposes (PROPOSED); orchestrator promotes to ACCEPTED at the finalize step after ship; supersession is in-place. Triggers when a Decisions-phase D-N introduces a public interface, persistence shape, security boundary, or new dependency.",
    triggers: [
      "specialist:architect",
      "tier:product-grade",
      "tier:ideal",
      "stage:ship",
      "decision:public-interface",
      "decision:persistence-shape",
      "decision:security-boundary",
      "decision:new-dependency"
    ],
    stages: ["plan", "ship"],
    body: readSkill("documentation-and-adrs.md")
  },
  {
    id: "debug-and-browser",
    fileName: "debug-and-browser.md",
    description: "merge of debug-loop + browser-verification + qa-and-browser. Diagnostic loops on a running system sharing the 'hypothesis before probe' protocol (3-5 ranked hypotheses, ten-rung loop ladder cheapest first, tagged debug logs, multi-run protocol, 'no seam' is itself a finding) + the DevTools five-check pass (console hygiene / network / a11y / layout / perf) with browser content treated as untrusted data + the qa-runner's acceptance discipline: browser tool hierarchy (Playwright > browser-MCP > manual), one-evidence-per-UI-AC rubric, 3-5 pre-commitment predictions before verification, manual-step fallback, verdict semantics (pass / iterate (max 1) / blocked). The browser-MCP detection ladder + untrusted-data rule are authored once; the reviewer cross-checks the qa artifact via the qa-evidence axis.",
    triggers: [
      "stop-the-line",
      "specialist:builder:fix-only",
      "task:bug-fix",
      "test-failed-unclear-reason",
      "ceremony_mode:strict",
      "ceremony_mode:soft",
      "touch-surface:ui",
      "diff:tsx|jsx|vue|svelte|html|css",
      "specialist:builder",
      "specialist:reviewer",
      "stage:qa",
      "specialist:qa-runner",
      "triage.surfaces:ui",
      "triage.surfaces:web"
    ],
    stages: ["build", "qa", "review"],
    body: readSkill("debug-and-browser.md")
  },
  {
    id: "api-evolution",
    fileName: "api-evolution.md",
    description: "merge of api-and-interface-design + breaking-changes. The architect's Decisions-phase checklist for public interfaces (Hyrum's Law: pin shape / order / silence / timing; one-version rule; untrusted third-party validation; two-adapter rule; consistent error model) AND the breaking-change discipline that manages an existing interface's deprecation (Churn Rule, Strangler Pattern, Zombie Code lifecycle, coexistence rules, CHANGELOG template).",
    triggers: [
      "specialist:architect",
      "decision:public-interface",
      "decision:rpc-schema",
      "decision:persistence-shape",
      "decision:new-dependency",
      "touch-surface:public-api",
      "diff:public-api",
      "frontmatter:breaking_change=true"
    ],
    stages: ["plan", "review"],
    body: readSkill("api-evolution.md")
  },
  {
    id: "pre-commitment-predictions",
    fileName: "pre-commitment-predictions.md",
    description:
      "The 3-5 pre-commitment predictions discipline shared by post-impl critic (§1), plan-critic (§1 of each rubric mode), and qa-runner (§3): write 3-5 falsifiable predictions of what is most likely wrong / missing BEFORE reading the rest of the artifact set in detail, then run the §2-§N walks and verify each prediction against the evidence. Codifies the 3-5 cap rationale, the 'before reading the rest' ordering, the outcome enum (`confirmed` / `refuted` / `partial`), the 'refuted is information' rule, the 'more than 5 is fishing' guidance, and the per-specialist mode-flavoured prediction shape (adversarial expands to 5-7). Replaces three near-identical inline blocks in plan-critic.ts / critic.ts / qa-runner.ts with a one-line anchor each. Sourced from oh-my-claudecode/agents/critic.md:58-60 (deliberate-search-vs-passive-evaluation framing).",
    triggers: [
      "specialist:plan-critic",
      "specialist:critic",
      "specialist:qa-runner",
      "before:section-1",
      "stage:plan",
      "stage:review",
      "stage:qa"
    ],
    stages: ["plan", "review", "qa"],
    body: readSkill("pre-commitment-predictions.md")
  },
  {
    id: "investigation-discipline",
    fileName: "investigation-discipline.md",
    description:
      "Debug-branch discipline + builder pre-edit gate. Auto-triggers on every investigator dispatch (taskShape:debug) AND before the builder's FIRST Write/Edit/MultiEdit on any file. Codifies the three-lane fan-out (cause-code / cause-config / cause-measurement — MECE; all three always run), the five canonical evidence shapes (file:line citation / command output excerpt / log excerpt / commit SHA / config snippet), the 0-10 lane confidence ladder (and how the synthesis derives the artifact-level high|medium|low from it), the anti-shotgun-debugging rules (no fix proposals inline; one root cause per synthesis; hypothesis before probe), and the next-step-recommendation rubric (direct-fix | needs-plan | more-investigation | not-a-bug — each with a hard gate). Also absorbs the builder pre-edit investigation gate (pre-edit-investigation): the fact-forcing three-probe gate (git log / rg / full-file read) before the first edit, enforced ex-post by the reviewer's edit-discipline axis. The three canonical probe shapes are authored once and shared by the cause-code lane and the builder edit gate.",
    triggers: [
      "specialist:investigator",
      "stage:plan",
      "taskShape:debug",
      "task_shape:debug",
      "before:Write",
      "before:Edit",
      "before:MultiEdit",
      "specialist:builder",
      "stage:build",
      "first-edit-of-file"
    ],
    stages: ["triage", "plan", "build"],
    body: readSkill("investigation-discipline.md")
  },
  {
    id: "ambiguity-discipline",
    fileName: "ambiguity-discipline.md",
    description: "Pre-plan clarify mode + assumption surface. Triage computes `ambiguity_score` (0-100) from four signals (vague-verbs / missing-AC / multiple-interpretations / no-concrete-names); when the score crosses the configurable threshold (`config.clarify.ambiguity_threshold`, default 60) AND `ceremonyMode != \"inline\"`, the architect runs a one-question-at-a-time Clarify phase (max 5, early-exit on user 'go'/'ready'/'proceed') BEFORE Bootstrap, then surfaces every assumption — both Clarify answers and architect-silent inferences (labelled) — in plan.md's mandatory `## Assumptions (correct me now)` section. Sourced from obra-superpowers brainstorming (HARD-GATE + one-q-at-a-time), Karpathy Think Before Coding, addyosmani SPECIFY (ASSUMPTIONS I'M MAKING block), everyinc-compound ce-brainstorm Phase 1.2 (evidence/specificity/counterfactual/attachment lenses).",
    triggers: [
      "specialist:triage",
      "specialist:architect",
      "stage:triage",
      "stage:plan",
      "ambiguity_score>=threshold"
    ],
    stages: ["triage", "plan"],
    body: readSkill("ambiguity-discipline.md")
  },
  {
    id: "reviewer-axis-edit-discipline",
    fileName: "reviewer-axis-edit-discipline.md",
    description:
      "Gated reviewer axis — full rubric, evidence-collection guidance, and severity matrix for the reviewer's `edit-discipline` axis (split slice work + AC verification; parallel-by-default safety net). Lifted out of `reviewer.ts` so the heavy prose loads only when the axis actually fires (every reviewer iteration in `strict` / `soft`; skipped on `inline` and on `triage.downgradeReason == \"no-git\"`). reviewer.ts retains a 5-line stub pointing here.",
    triggers: [
      "specialist:reviewer",
      "stage:review",
      "axis:edit-discipline",
      "ceremony_mode:strict",
      "ceremony_mode:soft"
    ],
    stages: ["review"],
    gate: (env) => env.editDisciplineActive === true,
    body: readSkill("reviewer-axis-edit-discipline.md")
  },
  {
    id: "reviewer-axis-qa-evidence",
    fileName: "reviewer-axis-qa-evidence.md",
    description:
      "Gated reviewer axis. Full per-UI-AC evidence rubric, `Status: pass` verb-match cross-check, evidence-tier escalation rules, skip rules, and anti-rationalizations for the `qa-evidence` axis (keyed off slice `Surface` for UI gating + AC for evidence rows). Lifted out of `reviewer.ts` so the heavy prose loads only when the qa gate actually fires (`triage.surfaces` ∩ {`ui`, `web`} ≠ ∅ AND `ceremonyMode != \"inline\"`, OR `walkQaEvidenceAxis: true` on the dispatch envelope). reviewer.ts retains a 5-line stub pointing here.",
    triggers: [
      "specialist:reviewer",
      "stage:review",
      "axis:qa-evidence",
      "walkQaEvidenceAxis:true",
      "triage.surfaces:ui",
      "triage.surfaces:web"
    ],
    stages: ["review"],
    gate: (env) => env.walkQaEvidenceAxis === true,
    body: readSkill("reviewer-axis-qa-evidence.md")
  },
  {
    id: "reviewer-axis-security",
    fileName: "reviewer-axis-security.md",
    description:
      "Gated reviewer axis. Full five-item threat-model checklist (authentication / authorization / secrets / supply chain / data exposure), per-surface sensitive-change protocol (OAuth flows, external integrations, migrations on user data, runtime deps, logging / analytics), hard rules, edge cases, and common pitfalls for the `security` axis (absorbed from the retired `security-reviewer` specialist). Lifted out of `reviewer.ts` so the heavy prose loads only when `triage.securityFlag == true` (or `plan.md` frontmatter `security_flag: true`). reviewer.ts retains a 5-line stub pointing here.",
    triggers: [
      "specialist:reviewer",
      "stage:review",
      "axis:security",
      "security-flag:true",
      "diff:auth|secrets|supply-chain|pii"
    ],
    stages: ["review"],
    gate: (env) => env.securityFlag === true,
    body: readSkill("reviewer-axis-security.md")
  },
  {
    id: "reviewer-axis-nfr-compliance",
    fileName: "reviewer-axis-nfr-compliance.md",
    description:
      "Gated reviewer axis. Full gating rule + per-NFR-row cross-check protocol (performance ↔ benchmark commits, compatibility ↔ runtime pins, accessibility ↔ a11y test invocations, security ↔ posture rows) and finding shape for the `nfr-compliance` axis. Lifted out of `reviewer.ts` so the heavy prose loads only when `flows/<slug>/plan.md` carries a non-empty `## Non-functional` section (architect-authored budgets). reviewer.ts retains a 5-line stub pointing here.",
    triggers: [
      "specialist:reviewer",
      "stage:review",
      "axis:nfr-compliance",
      "plan.nonFunctional:non-empty"
    ],
    stages: ["review"],
    gate: (env) => env.planHasNonFunctional === true,
    body: readSkill("reviewer-axis-nfr-compliance.md")
  },
  {
    id: "reviewer-axis-design-quality",
    fileName: "reviewer-axis-design-quality.md",
    description:
      "Gated reviewer axis. Full per-dimension 0-10 grading protocol, AI-slop umbrella check, severity ladder (5/10 → consider; ≤3/10 → required; accessibility one-tier escalation; ≤2/10 accessibility → critical), and anti-rationalizations for the `design-quality` axis. Lifted out of `reviewer.ts` so the heavy prose loads only when the gate fires (`walkDesignQualityAxis: true` on the dispatch envelope, OR `triage.surfaces` ∩ {`ui`, `design`, `frontend`, `ux`} ≠ ∅, OR diff contains UI files). reviewer.ts retains a 5-line stub pointing here.",
    triggers: [
      "specialist:reviewer",
      "stage:review",
      "axis:design-quality",
      "walkDesignQualityAxis:true",
      "design-surface:true",
      "diff:tsx|jsx|vue|svelte|astro|html|css|scss"
    ],
    stages: ["review"],
    gate: (env) => env.walkDesignQualityAxis === true,
    body: readSkill("reviewer-axis-design-quality.md")
  }
];

/**
 * Known stages that {@link buildAutoTriggerBlock} accepts. Exported so the
 * test suite can iterate the set without hardcoding the strings twice.
 *
 * The list mirrors the {@link AutoTriggerStage} union minus `always`
 * (the meta-stage that is never a *dispatch* stage — it only modifies
 * which skills are considered relevant across every stage).
 */
export const AUTO_TRIGGER_DISPATCH_STAGES: ReadonlyArray<Exclude<AutoTriggerStage, "always">> = [
  "triage",
  "plan",
  "build",
  "qa",
  "review",
  "ship",
  "compound"
];

/**
 * compact one-line bullet for embedding in a specialist prompt.
 *
 * The shape emitted three lines per skill (id + ~200-char
 * description + comma-separated trigger list). With 20 skills and 6
 * specialist dispatch surfaces, each per-dispatch prompt carried 4-6 KB
 * of duplicated description prose. collapses each bullet to a
 * single line: id + on-disk path. Full descriptions and trigger lists
 * are written once at install time to `.cclaw/lib/skills-index.md`
 * (see {@link SKILLS_INDEX_BODY}); the per-dispatch block is now a
 * pointer-index, not an inlined catalogue.
 *
 * The `**<id>**` bold-token format is preserved verbatim — the
 * windowing tripwire suite (`tests/unit/v819-skill-windowing.test.ts`)
 * keys off it and continues to assert per-stage inclusion / exclusion.
 */
function renderSkillBullet(skill: AutoTriggerSkill): string {
  return `- **${skill.id}** — \`.cclaw/lib/skills/${skill.fileName}\``;
}

/**
 * Render the stage-scoped block of auto-trigger skills suitable for
 * interpolation into a specialist prompt. introduces the `stage`
 * parameter; collapses each bullet to a one-line pointer (id +
 * on-disk path) and moves the full descriptions / trigger lists to
 * `.cclaw/lib/skills-index.md` (written by install).
 *
 * - When `stage` is omitted, the legacy "all skills" block is returned
 *   (every entry in {@link AUTO_TRIGGER_SKILLS}). This keeps callers that
 *   pre-date the stage tagging working.
 * - When `stage` is provided, only skills whose `stages` array includes
 *   the value **or** `"always"` are rendered. A skill with no `stages`
 *   field at all is treated as `["always"]` (legacy data shape) and rides
 *   every stage's block. An unknown stage value falls back to the full
 *   set — same as omitting the parameter — so a typo never silently
 *   strips every skill out of a dispatch.
 * - When `gateEnvelope` is provided, skills carrying a
 *   {@link AutoTriggerSkill.gate} predicate are additionally filtered:
 *   the predicate is invoked with the envelope; only skills whose
 *   predicate returns `true` are rendered. When the envelope is omitted
 *   (legacy / module-import-time call-sites such as the reviewer-prompt
 *   template literal), gated skills bypass the predicate and ride the
 *   stage block as if no predicate had been declared. This keeps every
 *   legacy caller working verbatim while letting runtime call-sites
 *   (orchestrator dispatch envelope construction) opt into gate
 *   filtering.
 *
 * Three token-budget wins composed:
 *
 *  1. stage filtering — out-of-scope skills are not emitted.
 *  2. gate filtering — gated skills only emit when their gate fires.
 *  3. compact bullet — emitted skills carry id + path only.
 *
 * The v819-skill-windowing suite asserts a 20%+ stage-vs-full ratio
 * reduction; the v849 overcomplexity-sweep suite asserts the
 * description prose no longer appears inline.
 */
export function buildAutoTriggerBlock(
  stage?: AutoTriggerStage,
  gateEnvelope?: GateEnvelope
): string {
  const known = new Set<AutoTriggerStage>([
    "triage",
    "plan",
    "build",
    "qa",
    "review",
    "ship",
    "compound",
    "always"
  ]);
  const useStage = stage !== undefined && known.has(stage) ? stage : undefined;

  const stageFiltered = useStage
    ? AUTO_TRIGGER_SKILLS.filter((skill) => {
        const declared = skill.stages ?? (["always"] as const);
        return declared.includes(useStage) || declared.includes("always");
      })
    : AUTO_TRIGGER_SKILLS;

  const skills = gateEnvelope
    ? stageFiltered.filter((skill) => {
        if (typeof skill.gate !== "function") return true;
        return skill.gate(gateEnvelope) === true;
      })
    : stageFiltered;

  const heading = useStage
    ? `## Active skills (stage: \`${useStage}\`)`
    : "## Active skills (all stages)";

  const bullets = skills.map(renderSkillBullet);

  const summary = useStage
    ? `_${skills.length} of ${AUTO_TRIGGER_SKILLS.length} skills active for stage \`${useStage}\`. Full descriptions + triggers: \`.cclaw/lib/skills-index.md\`. Each skill's body: \`.cclaw/lib/skills/<id>.md\` — read on demand, do not inline._`
    : `_${AUTO_TRIGGER_SKILLS.length} skills total. Full descriptions + triggers: \`.cclaw/lib/skills-index.md\`. Each skill's body: \`.cclaw/lib/skills/<id>.md\` — read on demand, do not inline._`;

  return [heading, "", ...bullets, "", summary].join("\n");
}

/**
 * render the full auto-trigger skills index. Written once at
 * install time to `.cclaw/lib/skills-index.md` so specialists can
 * reference it on demand instead of the per-dispatch prompt carrying
 * every skill's description verbatim.
 *
 * The body groups skills by their dispatch stage (so a specialist
 * dispatched at `build` can read the build section directly) AND
 * carries one alphabetical entry per skill with the full description
 * and trigger list. The alphabetical section is what gets cited when
 * a skill's body needs context outside its stage.
 *
 * The format is markdown so it lives next to `.cclaw/lib/skills/*.md`
 * and is grep-able by the same agent tooling that already reads those
 * files.
 */
export function renderSkillsIndex(): string {
  const heading = `# cclaw auto-trigger skills index`;
  const preface = [
    "Auto-generated by `cclaw install` from `src/content/skills.ts > AUTO_TRIGGER_SKILLS`. moved the per-skill description + trigger prose out of every specialist prompt and into this single index — specialist prompts now embed a compact `id → file` pointer block (rendered via `buildAutoTriggerBlock(stage)`), and read this file when they need the full description / triggers / stage tags for a skill.",
    "",
    "Every skill's full body lives at `.cclaw/lib/skills/<id>.md`; this file is the index over those bodies, not a substitute for them."
  ].join("\n");
  const stageHeading = `## Stage map`;
  const stageRows: string[] = [];
  stageRows.push("| stage | skill ids |");
  stageRows.push("| --- | --- |");
  for (const stage of [
    ...AUTO_TRIGGER_DISPATCH_STAGES,
    "always" as const
  ]) {
    const ids = AUTO_TRIGGER_SKILLS.filter((skill) => {
      const declared = skill.stages ?? (["always"] as const);
      return declared.includes(stage);
    }).map((skill) => `\`${skill.id}\``);
    if (ids.length === 0) {
      stageRows.push(`| \`${stage}\` | _(none)_ |`);
    } else {
      stageRows.push(`| \`${stage}\` | ${ids.join(", ")} |`);
    }
  }
  const alphaHeading = `## All skills (alphabetical)`;
  const sorted = [...AUTO_TRIGGER_SKILLS].sort((a, b) => a.id.localeCompare(b.id));
  const entries = sorted.map((skill) => {
    const stages = (skill.stages ?? (["always"] as const)).map((s) => `\`${s}\``).join(", ");
    return [
      `### \`${skill.id}\``,
      "",
      `- file: \`.cclaw/lib/skills/${skill.fileName}\``,
      `- stages: ${stages}`,
      `- triggers: ${skill.triggers.map((t) => `\`${t}\``).join(", ")}`,
      `- description: ${skill.description}`
    ].join("\n");
  });
  return [
    heading,
    "",
    preface,
    "",
    stageHeading,
    "",
    stageRows.join("\n"),
    "",
    alphaHeading,
    "",
    entries.join("\n\n"),
    ""
  ].join("\n");
}

/**
 * the rendered skills-index body. Written by `install.ts` to
 * `.cclaw/lib/skills-index.md`. Computed once at module-import time
 * since `AUTO_TRIGGER_SKILLS` is itself static after import.
 */
export const SKILLS_INDEX_BODY: string = renderSkillsIndex();

/**
 * Strict-stage variant of {@link buildAutoTriggerBlock} for call-sites
 * that always know their dispatch stage at compile time. Equivalent to
 * `buildAutoTriggerBlock(stage)` but the type signature forbids passing
 * `undefined` — useful inside specialist prompt template literals where
 * the stage is hardcoded per file.
 */
export function buildAutoTriggerBlockForStage(
  stage: AutoTriggerStage,
  gateEnvelope?: GateEnvelope
): string {
  return buildAutoTriggerBlock(stage, gateEnvelope);
}

/**
 * Wires the {@link buildAutoTriggerBlock} `gateEnvelope` runtime
 * path into production (Phase C audit G-2 fix).
 *
 * The specialist-prompt template literals (reviewer.ts / qa-runner.ts /
 * plan-critic.ts / etc.) all call `buildAutoTriggerBlock(stage)` at
 * module-import time with NO gate envelope — that renders the static
 * SUPERSET of every gate-tagged skill for the stage. The
 * `gateEnvelope` parameter on {@link buildAutoTriggerBlock} was
 * tested but never reached from any production caller; the resulting on-disk
 * `.cclaw/lib/agents/reviewer.md` always lists every gated axis pointer
 * regardless of the per-dispatch envelope flags.
 *
 * This helper is the production-path caller. The install pipeline
 * (`src/install.ts`) iterates a fixed table of canonical envelope
 * shapes (no flags / scope-drift only / qa-evidence only / all flags /
 * anti-slop opt-out / …) and renders the gate-resolved skills slice
 * for each one. The output is concatenated into the
 * `dispatch-skills-index.md` on-demand runbook the orchestrator opens
 * before authoring any reviewer dispatch envelope (see
 * `runbooks/dispatch-envelope.md`). The runbook is the SOURCE OF TRUTH
 * for the actual per-dispatch skills list; the embedded
 * `buildAutoTriggerBlock("review")` block in `reviewer.md` is a
 * SUPERSET hint the sub-agent reads on dispatch, then refines down to
 * the runbook's resolved slice using the envelope's `walkXAxis` flags.
 *
 * Returns a structured payload (stage, envelope, rendered block,
 * active-skill ids) so the runbook composer can render whichever
 * surface shape it needs (markdown table, prose paragraph, JSON
 * fixture) without re-deriving the gate filtering itself.
 */
export interface DispatchSkillsIndexEntry {
  /** Dispatch stage this entry was rendered for. */
  stage: Exclude<AutoTriggerStage, "always">;
  /** Gate envelope flags applied during the render. */
  envelope: GateEnvelope;
  /** Rendered {@link buildAutoTriggerBlock} block, gate-filtered. */
  block: string;
  /**
   * Skill ids that survived the gate filter, in render order. Useful
   * for the tripwire suite ("envelope X must omit skill Y") and for
   * the runbook's per-envelope summary line.
   */
  activeSkillIds: string[];
  /**
   * Short human-readable label for the envelope ("no flags" /
   * "scope-drift only" / "anti-slop disabled" / …). The runbook uses
   * the label as the per-section heading.
   */
  label: string;
}

export function renderDispatchSkillsIndex(
  stage: Exclude<AutoTriggerStage, "always">,
  envelope: GateEnvelope,
  label: string
): DispatchSkillsIndexEntry {
  const block = buildAutoTriggerBlock(stage, envelope);
  const stageFiltered = AUTO_TRIGGER_SKILLS.filter((skill) => {
    const declared = skill.stages ?? (["always"] as const);
    return declared.includes(stage) || declared.includes("always");
  });
  const activeSkillIds = stageFiltered
    .filter((skill) => {
      if (typeof skill.gate !== "function") return true;
      return skill.gate(envelope) === true;
    })
    .map((skill) => skill.id);
  return { stage, envelope, block, activeSkillIds, label };
}
