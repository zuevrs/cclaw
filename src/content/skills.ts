import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Stages a specialist dispatch can target. Used by `AutoTriggerSkill.stages`
 * to declare which hops of the flow a skill is relevant for, and by
 * {@link buildAutoTriggerBlock} to render a stage-scoped subset of skills
 * inside each specialist prompt.
 *
 * - `triage`   — Hop 1-2 (gate + persistence)
 * - `plan`     — design + planner (Hop 2.5 / 3)
 * - `build`    — slice-builder (Hop 4)
 * - `review`   — reviewer / security-reviewer (Hop 5)
 * - `ship`     — commit-helper + compound-and-ship (Hop 6+)
 * - `compound` — runCompoundAndShip's knowledge write loop
 * - `always`   — relevant at every hop; rendered into every stage block.
 */
export type AutoTriggerStage =
  | "triage"
  | "plan"
  | "build"
  | "review"
  | "ship"
  | "compound"
  | "always";

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
  body: string;
}

/**
 * Load a per-skill markdown body from disk at module-import time.
 *
 * v8.15 split the 24 inline template literals out of this file into
 * `src/content/skills/<id>.md`. v8.16 merged 13 of those source files
 * into 6 thematic groups (ac-discipline, commit-hygiene,
 * tdd-and-verification, api-evolution, review-discipline,
 * debug-and-browser), leaving 17 skill bodies on disk. Each `.md` is
 * the single editable source of truth; this loader pulls them back in
 * so `AUTO_TRIGGER_SKILLS[i].body` keeps the same string contract for
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
    id: "triage-gate",
    fileName: "triage-gate.md",
    description: "Mandatory first step of every new /cc flow: classify complexity, propose acMode/path, ask user to confirm, persist the decision.",
    triggers: ["start:/cc"],
    stages: ["triage"],
    body: readSkill("triage-gate.md")
  },
  {
    id: "flow-resume",
    fileName: "flow-resume.md",
    description: "When /cc is invoked with no task or with an active flow, render a resume summary and let the user continue / show / cancel / start fresh.",
    triggers: ["start:/cc", "active-flow-detected"],
    stages: ["always"],
    body: readSkill("flow-resume.md")
  },
  {
    id: "pre-flight-assumptions",
    fileName: "pre-flight-assumptions.md",
    description: "Surface 3-7 default assumptions (stack, conventions, architecture defaults, out-of-scope) for the user to confirm before any specialist runs. Skipped on the inline path.",
    triggers: ["after:triage-gate", "before:first-dispatch"],
    stages: ["triage", "plan"],
    body: readSkill("pre-flight-assumptions.md")
  },
  {
    id: "plan-authoring",
    fileName: "plan-authoring.md",
    description: "Auto-applies whenever the agent edits .cclaw/flows/<slug>/plan.md.",
    triggers: ["edit:.cclaw/flows/*/plan.md", "create:.cclaw/flows/*/plan.md"],
    stages: ["plan"],
    body: readSkill("plan-authoring.md")
  },
  {
    id: "ac-discipline",
    fileName: "ac-discipline.md",
    description: "v8.16 merge of ac-quality + ac-traceability. Three-check rubric for every AC entry (observable / independently committable / verifiable) AND the commit-helper invocation + AC↔commit chain contract. AC-quality always-on for AC authoring; AC-traceability active only when ac_mode=strict, advisory in soft / inline modes.",
    triggers: ["edit:.cclaw/flows/*/plan.md", "specialist:planner", "specialist:reviewer:text-review", "before:git-commit", "before:git-push", "ac_mode:strict"],
    stages: ["plan", "build", "review"],
    body: readSkill("ac-discipline.md")
  },
  {
    id: "refinement",
    fileName: "refinement.md",
    description: "Activates when /cc detects an existing plan match.",
    triggers: ["existing-plan-detected"],
    stages: ["triage", "plan"],
    body: readSkill("refinement.md")
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
    description: "v8.16 merge of review-loop + security-review. Wraps every reviewer / security-reviewer invocation with the shared Concern Ledger, Five-axis pass, Five Failure Modes, and (for sensitive diffs) the five-item threat-model checklist.",
    triggers: ["specialist:reviewer", "specialist:security-reviewer", "security-flag:true", "diff:auth|secrets|supply-chain|pii"],
    stages: ["review"],
    body: readSkill("review-discipline.md")
  },
  {
    id: "tdd-and-verification",
    fileName: "tdd-and-verification.md",
    description: "v8.16 merge of tdd-cycle + verification-loop + refactor-safety. Always-on whenever stage=build. Granularity scales with ac_mode (inline = optional, soft = one cycle per feature, strict = full RED → GREEN → REFACTOR per AC). The verification gate (build → typecheck → lint → test → security → diff) wraps every handoff; refactor-safety governs behaviour-preserving slugs and the REFACTOR step.",
    triggers: [
      "stage:build",
      "specialist:slice-builder",
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
    description: "v8.16 merge of commit-message-quality + surgical-edit-hygiene. Enforces commit-message conventions for commit-helper.mjs AND the always-on rules for slice-builder commits: no drive-by edits to adjacent comments / formatting / imports; remove only orphans your changes created; mention pre-existing dead code under Summary. Reviewer finding templates for A-4 (drive-by) and A-5 (deleted pre-existing dead code).",
    triggers: ["before:commit-helper", "always-on", "specialist:slice-builder", "before:git-commit"],
    stages: ["build", "ship"],
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
    triggers: ["ac_mode:strict", "specialist:planner", "specialist:design", "framework-specific-code-detected"],
    stages: ["plan", "build"],
    body: readSkill("source-driven.md")
  },
  {
    id: "summary-format",
    fileName: "summary-format.md",
    description: "Standard three-section ## Summary block (Changes made / Things I noticed but didn't touch / Potential concerns) appended to every authored artifact. Forces specialists to surface scope-creep candidates and forward-looking risks instead of silently fixing-while-nearby.",
    triggers: [
      "always-on",
      "edit:.cclaw/flows/*/plan.md",
      "edit:.cclaw/flows/*/build.md",
      "edit:.cclaw/flows/*/review.md",
      "edit:.cclaw/flows/*/ship.md",
      "edit:.cclaw/flows/*/learnings.md"
    ],
    stages: ["always"],
    body: readSkill("summary-format.md")
  },
  {
    id: "documentation-and-adrs",
    fileName: "documentation-and-adrs.md",
    description: "Repo-wide ADR catalogue at docs/decisions/ADR-NNNN-<slug>.md. Design (Phase 6.5, deep posture) proposes (PROPOSED); orchestrator promotes to ACCEPTED at Hop 6 after ship; supersession is in-place. Triggers when a Phase 4 D-N introduces a public interface, persistence shape, security boundary, or new dependency.",
    triggers: [
      "specialist:design",
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
    description: "v8.16 merge of debug-loop + browser-verification. Two diagnostic loops on a running system, sharing the 'hypothesis before probe' protocol. debug-loop: 3-5 ranked hypotheses, ten-rung loop ladder cheapest first, tagged debug logs, multi-run protocol, 'no seam' is itself a finding. browser-verification: DevTools-driven five-check pass (console hygiene / network / a11y / layout / perf) with browser content treated as untrusted data.",
    triggers: [
      "stop-the-line",
      "specialist:slice-builder:fix-only",
      "task:bug-fix",
      "test-failed-unclear-reason",
      "ac_mode:strict",
      "touch-surface:ui",
      "diff:tsx|jsx|vue|svelte|html|css",
      "specialist:slice-builder",
      "specialist:reviewer"
    ],
    stages: ["build", "review"],
    body: readSkill("debug-and-browser.md")
  },
  {
    id: "api-evolution",
    fileName: "api-evolution.md",
    description: "v8.16 merge of api-and-interface-design + breaking-changes. Design phase's checklist (Phase 4) for public interfaces (Hyrum's Law: pin shape / order / silence / timing; one-version rule; untrusted third-party validation; two-adapter rule; consistent error model) AND the breaking-change discipline that manages an existing interface's deprecation (Churn Rule, Strangler Pattern, Zombie Code lifecycle, coexistence rules, CHANGELOG template).",
    triggers: [
      "specialist:design",
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
    id: "code-simplification",
    fileName: "code-simplification.md",
    description: "v8.27 adaptation of addy osmani's `code-simplification` skill. Canonical rubric for the simplification slot that pre-v8.27 was split between the REFACTOR step of `tdd-and-verification` and the reviewer's `complexity-budget` / `readability` axes. Five principles (preserve behaviour / follow conventions / clarity over cleverness / maintain balance / scope to touchSurfaces) + four-step process (Chesterton's Fence → identify patterns → apply incrementally → verify). Stage-windowed on build (REFACTOR step + fix-only) and review (citation for complexity-budget findings).",
    triggers: [
      "stage:build",
      "specialist:slice-builder",
      "specialist:reviewer",
      "phase:refactor",
      "finding:complexity-budget",
      "finding:readability",
      "task:simplification"
    ],
    stages: ["build", "review"],
    body: readSkill("code-simplification.md")
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
  "review",
  "ship",
  "compound"
];

/**
 * Format a skill into a compact bullet for embedding in a specialist prompt.
 * One line of `id` + `description`, one sub-line listing the skill's
 * triggers verbatim. The full skill body is NOT inlined — it lives in
 * `.cclaw/lib/skills/<id>.md` and is loaded by the harness's own skill
 * machinery; the block here is a stage-scoped *index* so the specialist
 * knows which skills apply to its current dispatch.
 */
function renderSkillBullet(skill: AutoTriggerSkill): string {
  return `- **${skill.id}** — ${skill.description}\n  - triggers: ${skill.triggers.join(", ")}`;
}

/**
 * Render the stage-scoped block of auto-trigger skills suitable for
 * interpolation into a specialist prompt. v8.19 introduces the `stage`
 * parameter as the primary call shape.
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
 *
 * The token-budget win is real: a stage block is always strictly shorter
 * than the full block on this codebase (each dispatch stage drops at
 * least four out-of-scope skills). The v819-skill-windowing suite locks
 * a minimum 20% reduction at the test level so a future un-tag (every
 * skill regressing to `["always"]`) is caught.
 */
export function buildAutoTriggerBlock(stage?: AutoTriggerStage): string {
  const known = new Set<AutoTriggerStage>([
    "triage",
    "plan",
    "build",
    "review",
    "ship",
    "compound",
    "always"
  ]);
  const useStage = stage !== undefined && known.has(stage) ? stage : undefined;

  const skills = useStage
    ? AUTO_TRIGGER_SKILLS.filter((skill) => {
        const declared = skill.stages ?? (["always"] as const);
        return declared.includes(useStage) || declared.includes("always");
      })
    : AUTO_TRIGGER_SKILLS;

  const heading = useStage
    ? `## Active skills (stage: \`${useStage}\`)`
    : "## Active skills (all stages)";

  const bullets = skills.map(renderSkillBullet);

  const summary = useStage
    ? `_${skills.length} of ${AUTO_TRIGGER_SKILLS.length} skills active for stage \`${useStage}\`. The full body of each skill lives in \`.cclaw/lib/skills/<id>.md\` — read on demand, do not inline._`
    : `_${AUTO_TRIGGER_SKILLS.length} skills total. The full body of each skill lives in \`.cclaw/lib/skills/<id>.md\` — read on demand, do not inline._`;

  return [heading, "", ...bullets, "", summary].join("\n");
}

/**
 * Strict-stage variant of {@link buildAutoTriggerBlock} for call-sites
 * that always know their dispatch stage at compile time. Equivalent to
 * `buildAutoTriggerBlock(stage)` but the type signature forbids passing
 * `undefined` — useful inside specialist prompt template literals where
 * the stage is hardcoded per file.
 */
export function buildAutoTriggerBlockForStage(stage: AutoTriggerStage): string {
  return buildAutoTriggerBlock(stage);
}
