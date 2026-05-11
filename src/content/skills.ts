import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export interface AutoTriggerSkill {
  id: string;
  fileName: string;
  description: string;
  triggers: string[];
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
    body: readSkill("triage-gate.md")
  },
  {
    id: "flow-resume",
    fileName: "flow-resume.md",
    description: "When /cc is invoked with no task or with an active flow, render a resume summary and let the user continue / show / cancel / start fresh.",
    triggers: ["start:/cc", "active-flow-detected"],
    body: readSkill("flow-resume.md")
  },
  {
    id: "pre-flight-assumptions",
    fileName: "pre-flight-assumptions.md",
    description: "Surface 3-7 default assumptions (stack, conventions, architecture defaults, out-of-scope) for the user to confirm before any specialist runs. Skipped on the inline path.",
    triggers: ["after:triage-gate", "before:first-dispatch"],
    body: readSkill("pre-flight-assumptions.md")
  },
  {
    id: "plan-authoring",
    fileName: "plan-authoring.md",
    description: "Auto-applies whenever the agent edits .cclaw/flows/<slug>/plan.md.",
    triggers: ["edit:.cclaw/flows/*/plan.md", "create:.cclaw/flows/*/plan.md"],
    body: readSkill("plan-authoring.md")
  },
  {
    id: "ac-discipline",
    fileName: "ac-discipline.md",
    description: "v8.16 merge of ac-quality + ac-traceability. Three-check rubric for every AC entry (observable / independently committable / verifiable) AND the commit-helper invocation + AC↔commit chain contract. AC-quality always-on for AC authoring; AC-traceability active only when ac_mode=strict, advisory in soft / inline modes.",
    triggers: ["edit:.cclaw/flows/*/plan.md", "specialist:planner", "specialist:reviewer:text-review", "before:git-commit", "before:git-push", "ac_mode:strict"],
    body: readSkill("ac-discipline.md")
  },
  {
    id: "refinement",
    fileName: "refinement.md",
    description: "Activates when /cc detects an existing plan match.",
    triggers: ["existing-plan-detected"],
    body: readSkill("refinement.md")
  },
  {
    id: "parallel-build",
    fileName: "parallel-build.md",
    description: "Rules and execution playbook for the parallel-build topology.",
    triggers: ["topology:parallel-build"],
    body: readSkill("parallel-build.md")
  },
  {
    id: "review-discipline",
    fileName: "review-discipline.md",
    description: "v8.16 merge of review-loop + security-review. Wraps every reviewer / security-reviewer invocation with the shared Concern Ledger, Five-axis pass, Five Failure Modes, and (for sensitive diffs) the five-item threat-model checklist.",
    triggers: ["specialist:reviewer", "specialist:security-reviewer", "security-flag:true", "diff:auth|secrets|supply-chain|pii"],
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
    body: readSkill("tdd-and-verification.md")
  },
  {
    id: "commit-hygiene",
    fileName: "commit-hygiene.md",
    description: "v8.16 merge of commit-message-quality + surgical-edit-hygiene. Enforces commit-message conventions for commit-helper.mjs AND the always-on rules for slice-builder commits: no drive-by edits to adjacent comments / formatting / imports; remove only orphans your changes created; mention pre-existing dead code under Summary. Reviewer finding templates for A-4 (drive-by) and A-5 (deleted pre-existing dead code).",
    triggers: ["before:commit-helper", "always-on", "specialist:slice-builder", "before:git-commit"],
    body: readSkill("commit-hygiene.md")
  },
  {
    id: "conversation-language",
    fileName: "conversation-language.md",
    description: "Always-on policy: reply in the user's language; never translate paths, AC ids, slugs, hook output, or frontmatter keys.",
    triggers: ["always-on"],
    body: readSkill("conversation-language.md")
  },
  {
    id: "anti-slop",
    fileName: "anti-slop.md",
    description: "Always-on guard against redundant verification, env-specific shims, and silent skip-and-pass fixes.",
    triggers: ["always-on", "task:build", "task:fix-only", "task:recovery"],
    body: readSkill("anti-slop.md")
  },
  {
    id: "source-driven",
    fileName: "source-driven.md",
    description: "Detect stack + versions from manifest, fetch official documentation deep-links, implement against documented patterns, cite URLs in plan/decisions/code. Default in strict mode for framework-specific work.",
    triggers: ["ac_mode:strict", "specialist:planner", "specialist:design", "framework-specific-code-detected"],
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
    body: readSkill("api-evolution.md")
  }
];
