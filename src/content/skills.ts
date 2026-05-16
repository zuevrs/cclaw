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
 * - `qa`       — qa-runner (v8.52, on-demand; UI surfaces only)
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
 * split the 24 inline template literals out of this file into
 * `src/content/skills/<id>.md`. merged 13 of those source files
 * into 6 thematic groups (ac-discipline, commit-hygiene,
 * tdd-and-verification, api-evolution, review-discipline,
 * debug-and-browser), leaving 17 skill bodies on disk. v8.27-v8.33
 * added five frontier-aesthetic skills (code-simplification,
 * context-engineering, performance-optimization, frontend-ui-engineering,
 * ci-cd-and-automation); retired all five — none of the specialist
 * prompts referenced them, so the on-disk count is back to 17. Each
 * `.md` is the single editable source of truth; this loader pulls them
 * back in so `AUTO_TRIGGER_SKILLS[i].body` keeps the same string
 * contract for `install.ts` and the test suite.
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
    description: "Mandatory first step of every new /cc flow: classify complexity, propose ceremonyMode/path, ask user to confirm, persist the decision.",
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
    description: "merge of ac-quality + ac-traceability (revised — hook removed). Three-check rubric for every AC entry (observable / independently committable / verifiable) AND the posture-driven commit-prefix contract (red(AC-N): / green(AC-N): / refactor(AC-N): / test(AC-N): / docs(AC-N):) the reviewer verifies ex-post via git log --grep. AC-quality always-on for AC authoring; AC-traceability active only when ceremony_mode=strict, no chain enforced in soft / inline modes.",
    triggers: ["edit:.cclaw/flows/*/plan.md", "specialist:architect", "specialist:reviewer:text-review", "before:git-commit", "before:git-push", "ceremony_mode:strict"],
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
    description: "merge of review-loop + security-review. v8.62 unified flow absorbed the former `security-reviewer` specialist into reviewer's `security` axis — the skill now wraps every reviewer invocation with the shared Findings table, ten-axis pass (incl. the absorbed full threat-model coverage on the security axis), Five Failure Modes, and (for sensitive diffs) the five-item threat-model checklist.",
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
    description: "merge of commit-message-quality + surgical-edit-hygiene (revised — hook removed). v8.62: `specialist:slice-builder` trigger renamed to `specialist:builder` (rename only; AC-as-unit semantics unchanged). Enforces commit-message conventions AND the always-on rules for builder commits: posture-driven subject-line prefix in strict mode (red(AC-N): / green(AC-N): / refactor(AC-N): / test(AC-N): / docs(AC-N):); no drive-by edits to adjacent comments / formatting / imports; remove only orphans your changes created; mention pre-existing dead code under Summary. Reviewer finding templates for A-4 (drive-by) and A-5 (deleted pre-existing dead code).",
    triggers: ["always-on", "specialist:builder", "before:git-commit"],
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
    triggers: ["ceremony_mode:strict", "specialist:architect", "framework-specific-code-detected"],
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
    description: "Repo-wide ADR catalogue at docs/decisions/ADR-NNNN-<slug>.md. v8.62: the architect (Compose phase, strict posture) proposes (PROPOSED); orchestrator promotes to ACCEPTED at the finalize step after ship; supersession is in-place. Triggers when a Decisions-phase D-N introduces a public interface, persistence shape, security boundary, or new dependency.",
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
    description: "merge of debug-loop + browser-verification. Two diagnostic loops on a running system, sharing the 'hypothesis before probe' protocol. debug-loop: 3-5 ranked hypotheses, ten-rung loop ladder cheapest first, tagged debug logs, multi-run protocol, 'no seam' is itself a finding. browser-verification: DevTools-driven five-check pass (console hygiene / network / a11y / layout / perf) with browser content treated as untrusted data.",
    triggers: [
      "stop-the-line",
      "specialist:builder:fix-only",
      "task:bug-fix",
      "test-failed-unclear-reason",
      "ceremony_mode:strict",
      "touch-surface:ui",
      "diff:tsx|jsx|vue|svelte|html|css",
      "specialist:builder",
      "specialist:reviewer"
    ],
    stages: ["build", "review"],
    body: readSkill("debug-and-browser.md")
  },
  {
    id: "qa-and-browser",
    fileName: "qa-and-browser.md",
    description: "acceptance-discipline sibling of debug-and-browser. Drives the qa-runner specialist's per-UI-AC verification on the qa stage. Browser tool hierarchy (Playwright > browser-MCP > manual), one-evidence-per-UI-AC rubric, 3-5 pre-commitment predictions before verification, manual-step fallback when no browser tools available. Verdict semantics: pass / iterate (max 1) / blocked (browser tools unavailable AND manual user step required). Reviewer cross-checks the artifact via the qa-evidence axis.",
    triggers: [
      "stage:qa",
      "specialist:qa-runner",
      "triage.surfaces:ui",
      "triage.surfaces:web",
      "ceremony_mode:strict",
      "ceremony_mode:soft",
      "touch-surface:ui",
      "diff:tsx|jsx|vue|svelte|html|css",
      "specialist:builder",
      "specialist:reviewer"
    ],
    stages: ["build", "qa", "review"],
    body: readSkill("qa-and-browser.md")
  },
  {
    id: "api-evolution",
    fileName: "api-evolution.md",
    description: "merge of api-and-interface-design + breaking-changes. v8.62: the architect's Decisions-phase checklist for public interfaces (Hyrum's Law: pin shape / order / silence / timing; one-version rule; untrusted third-party validation; two-adapter rule; consistent error model) AND the breaking-change discipline that manages an existing interface's deprecation (Churn Rule, Strangler Pattern, Zombie Code lifecycle, coexistence rules, CHANGELOG template).",
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
    id: "completion-discipline",
    fileName: "completion-discipline.md",
    description: "Iron Law concentrating verification-before-completion. No `✅ complete` slim summary, no `Recommended next: continue`, no Findings row close, no `ship.md > status: shipped` without paired fresh evidence (command + exit code + log lines, OR test output, OR git-log proof, OR file:line citation). Bans the sycophantic completion vocabulary (`should work`, `looks good`, `probably works`, `I think this is done`). Always-on across every specialist and every stage; the reviewer's Verification story table, slice-builder's self_review[], and orchestrator's per-criterion verified flag are all enforcement surfaces deferring to this skill.",
    triggers: [
      "always-on",
      "before:slim-summary",
      "before:Recommended-next-continue",
      "before:findings-row-close",
      "before:ship-stamp",
      "stage-exit:any"
    ],
    stages: ["always"],
    body: readSkill("completion-discipline.md")
  },
  {
    id: "receiving-feedback",
    fileName: "receiving-feedback.md",
    description: "anti-sycophancy guard for receiving review.md findings, critic.md gaps, reviewer security-axis findings (v8.62 absorbed the former `security-reviewer` specialist into reviewer's security axis), and user-named defects. Bans the bare-acknowledgement vocabulary (`good point`, `you're right`, `let me address that`, `I see your concern`, `great catch`). Installs the four-step response pattern: restate the finding in own words → classify against the ship gate (block-ship / iterate / fyi) → declare a plan (fix / push-back-with-evidence / accept-warning) → cite evidence. Fires on build (fix-only), review (re-iteration), and ship (pre-merge sweep).",
    triggers: [
      "input:review.md",
      "input:critic.md",
      "input:reviewer-security-axis-findings",
      "input:user-feedback",
      "mode:fix-only",
      "ship-gate:findings"
    ],
    stages: ["build", "review", "ship"],
    body: readSkill("receiving-feedback.md")
  },
  {
    id: "pre-edit-investigation",
    fileName: "pre-edit-investigation.md",
    description: "GateGuard-style fact-forcing gate that triggers before the builder's FIRST Write/Edit/MultiEdit operation on a file. Mandatory three probes before editing: (1) `git log --oneline -10 -- <path>` for recent edits, (2) `rg \"<symbol>\" --type <lang>` for usage sites, (3) full file read (not just the edit window). Investigation evidence lands in build.md's Discovery column; the reviewer's `edit-discipline` axis (v8.48+, axis #8) flags missing or partial Discovery as severity=required. Exceptions: fresh files with no history, RED-phase test file edits, post-format passes.",
    triggers: [
      "before:Write",
      "before:Edit",
      "before:MultiEdit",
      "specialist:builder",
      "stage:build",
      "first-edit-of-file"
    ],
    stages: ["build"],
    body: readSkill("pre-edit-investigation.md")
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
 * The v8.19 `**<id>**` bold-token format is preserved verbatim — the
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
 *
 * Two token-budget wins composed:
 *
 *  1. stage filtering — out-of-scope skills are not emitted.
 *  2. compact bullet — emitted skills carry id + path only.
 *
 * The v819-skill-windowing suite asserts a 20%+ stage-vs-full ratio
 * reduction; the v849 overcomplexity-sweep suite asserts the v8.18
 * description prose no longer appears inline.
 */
export function buildAutoTriggerBlock(stage?: AutoTriggerStage): string {
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
export function buildAutoTriggerBlockForStage(stage: AutoTriggerStage): string {
  return buildAutoTriggerBlock(stage);
}
