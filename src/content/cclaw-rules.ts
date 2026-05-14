/**
 * v8.55 — single source of truth for the harness-embedded ambient rules
 * surface.
 *
 * Pre-v8.55 cclaw's discipline activated **only** inside `/cc`. Outside
 * `/cc`, agents ran "naked" with default harness behaviour — the Iron
 * Laws, anti-rationalization catalog, and top antipatterns did not
 * apply. The cross-reference content-footprint audit flagged this as
 * the lone gap among 11 references (every other ref ships ambient
 * rules in CLAUDE.md / AGENTS.md / `.cursor/rules/`).
 *
 * v8.55 closes the gap by writing a **compact** ambient rules surface
 * to each enabled harness's native rules location:
 *
 *   - Cursor:      `.cursor/rules/cclaw.mdc`  (MDC + `alwaysApply: true`)
 *   - Claude Code: `.claude/cclaw-rules.md`    (plain markdown)
 *   - Codex:       `.codex/cclaw-rules.md`     (plain markdown)
 *   - OpenCode:    `.opencode/cclaw-rules.md`  (plain markdown)
 *
 * The user explicitly rejected writing to project-root `AGENTS.md` /
 * `CLAUDE.md` / `GEMINI.md`; all cclaw rules live in harness-namespaced
 * directories and the user owns the project-root memory files. For
 * Cursor the file auto-loads on every session via the MDC frontmatter;
 * the other three harnesses require the user to add a one-line
 * `@.harness/cclaw-rules.md` reference from their CLAUDE.md / AGENTS.md.
 * The install summary surfaces the per-harness activation step.
 *
 * Compact-content contract: the ambient surface carries ONLY principles
 * + pointer to `/cc`. The full anti-rationalization catalog, the full
 * antipattern set A-1..A-7, runbooks, specialist prompts, and AC-trace
 * commit-prefix enforcement stay in `.cclaw/lib/` and load **only**
 * when `/cc` is invoked. Heavy content does not duplicate into the
 * ambient rules file — the rules pointer to `/cc` is the activation
 * affordance.
 *
 * Sources of truth (consumed structurally; no prose duplication):
 *   - {@link IRON_LAWS} — 5 Iron Laws (Karpathy)
 *   - {@link SHARED_ANTI_RATIONALIZATIONS} — 5 category keys
 *   - {@link ANTIPATTERN_SUMMARIES} — A-1..A-5 one-liners (this module)
 */

import { IRON_LAWS } from "./iron-laws.js";
import { ANTIPATTERNS } from "./antipatterns.js";

export interface AntipatternSummary {
  id: string;
  title: string;
  oneLine: string;
}

/**
 * One-line summaries of A-1..A-5, the five antipatterns the cross-reference
 * footprint audit flagged as most-cited in slim summaries and review
 * artifacts. A-6 (untagged debug logs) and A-7 (single-run flakiness) stay
 * `/cc`-only — they are real but less common, and the ambient surface
 * targets the high-signal subset.
 *
 * The `title` field MUST stay in sync with the verbatim `## A-N — Title`
 * heading inside {@link ANTIPATTERNS}. Tripwire in
 * `tests/unit/v855-harness-rules.test.ts > antipattern summaries cross-reference`
 * parses ANTIPATTERNS and asserts ID + title agreement so drift surfaces
 * structurally instead of silently.
 */
export const ANTIPATTERN_SUMMARIES: readonly AntipatternSummary[] = [
  {
    id: "A-1",
    title: "TDD phase integrity broken",
    oneLine:
      "`green(AC-N)` lands without a prior `red(AC-N)`; production files slip into RED; or no `refactor(AC-N)` (real or skip-marker) lands. Write RED first, GREEN second, REFACTOR (or explicit skip) third."
  },
  {
    id: "A-2",
    title: "Work outside the AC",
    oneLine:
      "AC-tagged commit also restructures unrelated modules; or `git add -A` was used inside `/cc` (forbidden). Stage explicitly with `git add <path>` per file or `git add -p` per hunk."
  },
  {
    id: "A-3",
    title: "Mocking what should not be mocked",
    oneLine:
      "Mocking dependencies you control couples tests to implementation; bugs hide in those gaps. Prefer Real > Fake > Stub > Mock; assert on outcomes, not on which methods were called."
  },
  {
    id: "A-4",
    title: "Drive-by edits to adjacent comments / formatting / imports",
    oneLine:
      "\"While I'm here, fix this\" corrupts the audit trail. Touch only what the AC requires; list noticed-but-not-touched items under build.md `## Summary → Noticed but didn't touch` and open a follow-up slug."
  },
  {
    id: "A-5",
    title: "Deletion of pre-existing dead code without permission",
    oneLine:
      "Mixing AC implementation with cleanup defeats the audit trail (bisect cannot tell which deletion caused the regression). List dead code with cite-able evidence; remove it in its own follow-up slug."
  }
] as const;

/**
 * One-line summary of each of the five shared anti-rationalization
 * categories. Keys match {@link SHARED_ANTI_RATIONALIZATIONS}; the
 * `summary` is the canonical excuse-pattern, not a verbatim quote. The
 * full row catalog (rationalization + rebuttal per row) lives in
 * `.cclaw/lib/anti-rationalizations.md`, loaded only when `/cc` is
 * invoked.
 */
export const ANTI_RAT_CATEGORY_SUMMARIES: readonly {
  key: string;
  summary: string;
}[] = [
  {
    key: "completion",
    summary:
      "Completion — claim vs evidence. \"Should pass\" / \"looks good\" / \"I'll claim complete now, reviewer catches gaps\" — evidence is for the next reader, not for you."
  },
  {
    key: "verification",
    summary:
      "Verification — gates + suites. \"Single-AC test is enough\" / \"CI will catch the build\" / \"probably flaky, one re-run is fine\" — run the project suite, not the single AC test; multi-run protocol on observed flakes."
  },
  {
    key: "edit-discipline",
    summary:
      "Edit discipline — investigate before edit. \"I read it last week\" / \"AC names the line, no need to read\" / \"while I'm here\" — Probe 1/2/3 before every edit; the AC's `touchSurface` is a permission list, not an investigation report."
  },
  {
    key: "commit-discipline",
    summary:
      "Commit discipline — prefixes, hygiene, no drive-bys. \"Skip the `(AC-N):` prefix this once\" / \"`git add -A` is fine\" / \"WIP for now\" — every commit gets the posture-driven prefix; stage explicitly; never amend a pushed commit."
  },
  {
    key: "posture-bypass",
    summary:
      "Posture bypass — TDD skipping + REFACTOR silence. \"5-line change, RED not worth it\" / \"tested manually\" / \"REFACTOR unnecessary\" — the Iron Law is discipline, not a hook; write `Refactor: skipped — <reason>` if there's nothing to refactor."
  }
] as const;

/**
 * Header / orientation paragraph rendered above the iron-law block.
 * Names both the `/cc` invocation (full multi-stage workflow) and the
 * fallback mode (ambient rules guide behaviour outside `/cc`).
 */
const ORIENTATION = `When the user invokes \`/cc\`, cclaw's full multi-stage workflow activates (triage → plan → build → qa → review → critic → ship). Outside \`/cc\`, these ambient rules guide behaviour. To run a full disciplined flow on a task, type \`/cc <task description>\`.`;

/**
 * Footer paragraph that names the `/cc`-only artefacts and the
 * activation affordance. The `\`/cc\`` mention is the canonical
 * pointer agents read when they decide whether to escalate from
 * ambient mode into the full workflow.
 */
const FOOTER = `### How to activate the full flow

Type \`/cc <task description>\` to run cclaw's multi-stage workflow with adversarial critics, AC traceability, posture-driven commit prefixes, and per-stage artifacts written to \`.cclaw/flows/<slug>/\`. The full anti-rationalization catalog (rebuttals per row), antipatterns A-1..A-7 with full corrections, specialist prompts, and stage runbooks live in \`.cclaw/lib/\` and load only when \`/cc\` is invoked.

Outside \`/cc\`, the rules above are advisory ambient discipline. If a task crosses the trivial threshold (multi-step plan, behaviour change, or unclear AC), invoke \`/cc\` instead of running naked.`;

/**
 * Render the Iron Laws block. Reads {@link IRON_LAWS} so adding /
 * removing / renaming a law in `src/content/iron-laws.ts` ripples
 * through the ambient rules without a second edit.
 */
function renderIronLawsBlock(): string {
  const sections = IRON_LAWS.map(
    (law, index) => `${index + 1}. **${law.title}** — ${law.description}`
  ).join("\n");
  return `## Iron Laws (Karpathy)\n\n${sections}`;
}

function renderAntiRatCategoriesBlock(): string {
  const lines = ANTI_RAT_CATEGORY_SUMMARIES.map(
    (entry) => `- \`${entry.key}\` — ${entry.summary}`
  ).join("\n");
  return [
    "## Top anti-rationalization categories",
    "",
    "The cclaw `/cc` workflow ships a catalog of cross-cutting rationalizations agents commonly use to skip discipline. The five categories below summarize the canonical excuses; the full rebuttal catalog (per-row) lives at `.cclaw/lib/anti-rationalizations.md`, loaded only when `/cc` is invoked.",
    "",
    lines
  ].join("\n");
}

function renderAntipatternsBlock(): string {
  const lines = ANTIPATTERN_SUMMARIES.map(
    (ap) => `- **${ap.id} — ${ap.title}.** ${ap.oneLine}`
  ).join("\n");
  return [
    "## Top antipatterns (A-1..A-5)",
    "",
    "The full antipattern catalog (A-1..A-7) lives at `.cclaw/lib/antipatterns.md`, loaded only when `/cc` is invoked. The five most-cited are summarized below.",
    "",
    lines
  ].join("\n");
}

/**
 * Plain-markdown ambient rules body shipped to Claude Code, Codex, and
 * OpenCode (`.harness/cclaw-rules.md`). No frontmatter — those harnesses
 * load instructions by `@`-reference from their root memory file
 * (CLAUDE.md / AGENTS.md), not by frontmatter activation.
 *
 * The body is identical across the three harnesses on purpose: same
 * principles, same compact surface, same `/cc` pointer. Per-harness
 * activation guidance is rendered by the install summary, not by the
 * rules file itself.
 */
export const CCLAW_RULES_MARKDOWN: string = [
  "# cclaw ambient rules",
  "",
  ORIENTATION,
  "",
  renderIronLawsBlock(),
  "",
  renderAntiRatCategoriesBlock(),
  "",
  renderAntipatternsBlock(),
  "",
  FOOTER,
  ""
].join("\n");

/**
 * Cursor MDC frontmatter for `.cursor/rules/cclaw.mdc`. The
 * `alwaysApply: true` field is the activation contract — Cursor reads
 * the file on every session start when this is set, no `@`-reference
 * required. `description` is included for human readability (it would
 * be ignored when `alwaysApply: true`, but Cursor keeps it on display
 * in the rules UI for clarity); `globs` is omitted because the rules
 * apply repository-wide, not per-glob.
 *
 * The frontmatter shape mirrors the Cursor 2026 MDC convention
 * documented at `docs.cursor.com/context/rules`: a YAML block at the
 * top of an `.mdc` file with `description` (string), `globs` (array of
 * file patterns, optional), and `alwaysApply` (boolean).
 */
const CURSOR_MDC_FRONTMATTER = `---
description: cclaw ambient rules — Iron Laws, anti-rationalization categories, top antipatterns, /cc activation pointer
alwaysApply: true
---`;

/**
 * MDC variant for `.cursor/rules/cclaw.mdc`. Identical body to
 * {@link CCLAW_RULES_MARKDOWN} with the Cursor frontmatter prepended.
 */
export const CCLAW_RULES_MDC: string = [
  CURSOR_MDC_FRONTMATTER,
  "",
  CCLAW_RULES_MARKDOWN
].join("\n");

/**
 * v8.55 audit hook for the cross-reference tripwire — exposes the
 * structural list of antipattern IDs/titles + anti-rat category keys
 * the ambient surface advertises. `tests/unit/v855-harness-rules.test.ts`
 * uses these alongside {@link ANTIPATTERNS} and
 * {@link SHARED_ANTI_RATIONALIZATIONS} to assert no drift between the
 * compact summaries and the full `/cc` catalogs.
 */
export function listAntipatternIds(): string[] {
  return ANTIPATTERN_SUMMARIES.map((ap) => ap.id);
}

/**
 * Parse `ANTIPATTERNS` markdown for `## A-N — Title` headings. Used by
 * v8.55 tests to assert {@link ANTIPATTERN_SUMMARIES} titles agree with
 * the full antipattern catalog.
 */
export function extractAntipatternHeadings(): { id: string; title: string }[] {
  const headingRe = /^## (A-\d+) — (.+)$/gm;
  const out: { id: string; title: string }[] = [];
  let match: RegExpExecArray | null;
  while ((match = headingRe.exec(ANTIPATTERNS))) {
    out.push({ id: match[1]!, title: match[2]!.trim() });
  }
  return out;
}
