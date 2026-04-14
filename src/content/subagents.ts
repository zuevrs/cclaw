/**
 * Markdown content generators for Cclaw’s subagent orchestration skills and enhanced
 * specialist payloads. Cclaw materializes static instructions — this module does not
 * execute orchestration logic at install time beyond string assembly.
 */

const SUBAGENT_AGENT_NAMES = [
  "planner",
  "spec-reviewer",
  "code-reviewer",
  "security-reviewer",
  "test-author",
  "doc-updater",
] as const;

type SubagentCclawAgentName = (typeof SUBAGENT_AGENT_NAMES)[number];

export function subagentDrivenDevSkill(): string {
  return `---
name: subagent-driven-development
description: "Orchestrate implementation via isolated subagents — one fresh agent per task with two-stage review."
---

# Subagent-Driven Development (SDD)

## Overview

Use a **controller → implementer → reviewer** loop when building multi-step software work.

- **Controller (parent agent):** owns the plan, gating, sequencing, and dispatch decisions; never mixes deep implementation context with review evidence.
- **Implementer (subagent):** receives a **single self-contained task** and edits code within that scope; exits with a structured status contract.
- **Reviewer (subagent):** validates outputs against the specification **by reading code**, then hands findings back to the controller for the next dispatch.

This pattern is intentionally **Superpowers-style**: cheap parallelism where it doesn’t corrupt state, strict serialization where it would.

## Automatic Stage Delegation in Cclaw

For cclaw flow stages, machine-only specialist work should auto-dispatch without waiting for a manual user request:

- **design/plan:** planner
- **tdd:** test-author
- **review:** spec-reviewer + code-reviewer (security-reviewer when trust boundaries moved)
- **ship:** doc-updater

Human input remains mandatory only at explicit approval gates (plan approval, user challenge resolution, release finalization mode).

## Model & Harness Routing Notes

### Harness routing

| Harness | Delegation tool | Structured ask tool | Routing note |
|---|---|---|---|
| Claude | Task/delegate | AskUserQuestion | Preferred for rich multi-step delegation + explicit approvals. |
| Cursor | Task | AskQuestion | Use option-based asks for mode/waiver decisions; keep subagent payloads concise. |
| Codex | Task (if available) | None native | Use numbered choices in chat for approvals; keep prompts fully self-contained. |
| OpenCode | Task (if available) | None native | Log delegation outcomes in artifacts/state explicitly; do not assume built-in ask workflows. |

If delegation tooling is unavailable in the active harness, run the same controller protocol in-thread and record a delegation waiver with reason \`harness_limitation\`.

### Model routing

- **Use a faster model** for bounded, deterministic tasks (single slice implementation, mechanical refactors, straightforward lint/test fixes).
- **Use a more capable model** for high-ambiguity or high-risk analysis (security review, architecture conflicts, spec contradiction resolution).
- During review-heavy stages, prefer **mixed routing**: faster first-pass triage + escalate only high-severity/low-confidence findings.

## HARD-GATE

**Never dispatch a subagent without a concrete, self-contained task description pasted into the prompt. Do not pass file references the subagent must read to understand its task.**

If you catch yourself writing “read PLAN.md Task 3” or “implement the next unchecked item,” stop: expand the work into explicit text in the Task body before dispatching.

## When to Use

- Mid/large plans with multiple discrete tasks, dependencies, or risky overlap.
- Complex features where isolation prevents parent-session context pollution.
- Situations where **fresh tool context** is cheaper than incremental patching in one mega-thread.
- When reviews should be adversarial to claims (“show me the code”), not collegial summaries.

## Full Protocol

1. **Read plan, extract all tasks with full text**
   - Copy each task verbatim into a working queue (checklist is fine).
   - Normalize each task so it includes: goal, acceptance criteria, constraints, and explicit “out of scope.”

2. **For each task sequentially (NEVER parallel implementation subagents — file conflicts):**
   1. **Dispatch implementer subagent** with the **full task text pasted in** (not a file reference).
   2. **Check return status:** \`DONE\` / \`DONE_WITH_CONCERNS\` / \`NEEDS_CONTEXT\` / \`BLOCKED\`
   3. If \`DONE\`: dispatch **spec-reviewer** subagent to verify actual code matches spec.
   4. If spec review **FAIL**: dispatch **fixer subagent** (a **new** agent — not an inline patch from the parent — to avoid context pollution).
   5. Dispatch **code-quality reviewer** (maintainability/PR hygiene).
   6. **Mark task complete** only after concerns are triaged or explicitly accepted with rationale.

3. **After all tasks:** dispatch **final code reviewer** for a full-repo / full-surface pass (what escaped local task boundaries).

4. **Transition to finishing workflow** (ship checklist, changelog, migration notes) once reviewers show no unresolved Criticals.

## Status Contract

| Status | Meaning | Controller action |
|---|---|---|
| DONE | Implementation complete; tests orchestrated per prompt; no known material risks | Proceed to reviewers |
| DONE_WITH_CONCERNS | Shippable but with documented tradeoffs/risks | Proceed with reviewer + explicit notes; do not “hand-wave” concerns |
| NEEDS_CONTEXT | Missing authoritative information only the parent/user can supply | Parent gathers context, then re-dispatch implementer with augmented prompt |
| BLOCKED | Hard stop (permissions, tool failure, conflicting requirements, unsafe state) | Parent escalates to user; do not stack speculative guesses |

## Implementer Prompt Template (paste into Task tool)

\`\`\`
You are implementing a single task from a development plan.

TASK: {paste full task text here}
CONTEXT: {paste relevant file paths, types, patterns}
CONSTRAINTS: {paste from spec — what NOT to do}

After implementation:
1. Run the full test suite
2. Report your status: DONE / DONE_WITH_CONCERNS / NEEDS_CONTEXT / BLOCKED
3. If DONE_WITH_CONCERNS, list each concern
4. If NEEDS_CONTEXT, specify exactly what you need
\`\`\`

## Spec-Reviewer Prompt Template (paste into Task tool)

\`\`\`
Review the implementation against the specification.

SPEC CRITERIA: {paste acceptance criteria}
FILES CHANGED: {list files}

For each criterion: PASS / FAIL / PARTIAL with evidence (file:line).
Do NOT trust the implementer's self-report — read the actual code.
\`\`\`

## Anti-patterns

- Launching **parallel implementation** subagents that may touch the same files or adjacent modules.
- Passing a **plan file path** instead of pasting the **exact task text** for the subagent.
- Accepting implementer “done” claims without **spec review evidence** grounded in code.
- **Patching inline** in the parent when review fails — instead of dispatching a **fresh fixer** subagent.

## Critical Rules

- **Context isolation:** subagent receives crafted instructions only — **not** the parent session’s scratchpad/history.
- **Never trust the implementer:** reviewers verify against **code** and tests, not narrative self-report.
- **One task at a time:** sequential implementations prevent conflicting writes; keep parallelism for analysis/review patterns only (see \`dispatching-parallel-agents\`).
- **Fixer = new agent:** if spec review fails, dispatch a fresh fixer subagent; avoid “repair drift” in the parent context.

## Common Rationalizations

| Rationalization | Reality |
|---|---|
| “They can read the plan file — it’s faster.” | File indirection hides scope and invites partial reads; paste task text. |
| “I'll spin up two implementers — they're independent.” | False independence causes merge conflicts and duplicated edits. |
| “The implementer ran tests and said PASS.” | Re-run or have reviewers demand fresh evidence; narratives lie by omission. |
| “I'll patch quickly myself; same outcome.” | Parent context fills with fix chatter, undermining later reviews. |

## Red Flags

- Task prompts shorter than the acceptance criteria they are supposed to satisfy.
- Implementer returns PASS with **no** commands run or outputs excerpted.
- Multiple agents concurrently editing overlapping directories.
- Review summaries without \`file:line\` anchors for FAIL/PARTIAL.
- “Done” without a spec reviewer pass when requirements were non-trivial.

## Controller Responsibilities (non-delegatable)

- Maintain the **authoritative task queue** and ensure each dispatch uses **verbatim** task text.
- Decide when concerns are **acceptable** vs require rework; record that decision explicitly for auditability.
- Keep parent-session narration **thin**: prefer pointers to artifacts (diffs, logs) over long prose.
- After any fixer pass, **re-run** spec review until PASS or explicit user acceptance of residual gaps.

## Evidence Requirements

- **Tests:** implementer must name the command and show representative output (pass/fail excerpt).
- **Reviews:** every FAIL/PARTIAL cites \`file:line\` and quotes the smallest code span needed.
- **Fixers:** must restate the failing criterion and demonstrate closure with new evidence (not “trust me”).

## Code-Quality Reviewer Prompt Template (paste into Task tool)

\`\`\`
You are a code-quality reviewer (subagent) after a single SDD task.

SCOPE: {files touched by this task}
RISK CONTEXT: {data sensitivity, concurrency, backwards compatibility notes}

Review for maintainability and ship hygiene across:
- correctness edges not covered by spec language
- readability and naming coherence with surrounding code
- architecture fit (layering, boundaries)
- obvious security/perf smells (deep dives belong elsewhere)

Output:
- FINDINGS: severity, file:line, issue, recommendation
- VERDICT: APPROVE | APPROVE_WITH_NITS | REWORK_REQUIRED
\`\`\`

## Fixer Subagent Prompt Template (after spec review FAIL)

\`\`\`
You are a fixer subagent. You are NOT the original implementer.

FAILING CRITERION (verbatim): {paste failed criterion}
EVIDENCE: {reviewer citations: file:line + short quotes}
ALLOWED FILES: {explicit list — do not expand scope silently}
FORBIDDEN CHANGES: {compatibility / API stability constraints}

Process:
1) Reproduce the gap with a test or minimal repro as appropriate.
2) Implement the smallest fix that satisfies the criterion.
3) Run the full test suite.
4) Report STATUS: DONE / DONE_WITH_CONCERNS / NEEDS_CONTEXT / BLOCKED with evidence excerpts.
\`\`\`

## Final Code Reviewer Prompt Template (post-queue sweep)

\`\`\`
You are the final code-quality reviewer after ALL SDD tasks completed.

ENTIRE CHANGESET: {summary + primary entrypoints}
INTEGRATION RISKS: {cross-module assumptions, migrations, rollout}

Goals:
- Find issues that only appear at integration scale (duplicated helpers, drift, inconsistent error handling).
- Confirm global invariants (build, types, lint policy) were not violated opportunistically.

Deliver:
- TOP_FINDINGS (merge blockers first)
- CONSISTENCY_PASS/FAIL with rationale
- SHIP_RECOMMENDATION: SHIP | SHIP_WITH_FOLLOWUPS | NO_SHIP
\`\`\`

## Glossary

- **Controller:** parent agent orchestrating dispatches (this document assumes you).
- **Implementer:** single-task coding subagent.
- **Spec reviewer:** acceptance-criteria auditor over code.
- **Code-quality reviewer:** PR hygiene / maintainability auditor.
- **Fixer:** fresh subagent after failed spec review (never “parent hotfix” by default).
`;
}

export function parallelAgentsSkill(): string {
  return `---
name: dispatching-parallel-agents
description: "Launch multiple investigation or review agents in parallel for independent problem domains."
---

# Dispatching Parallel Agents

## Overview

Parallel agents are a **fan-out / fan-in** tactic: split a problem into **independent lenses**, delegate each lens in **parallel**, then **reconcile** outputs into a single coherent decision record.

This document bridges **Superpowers-style task isolation** with the **gstack “Review Army”** pattern: many cheap specialists, structured outputs, and confidence-scored synthesis.

## HARD-GATE

**Never dispatch parallel IMPLEMENTATION agents that write to the same codebase. Parallel agents are for investigation, analysis, and review ONLY.**

Implementation that touches shared source trees must remain **sequential** unless you have proven disjoint filesystem ownership (rare) and an explicit merge protocol.

## When to Use

- **Independent investigations** (perf vs correctness vs dependency hygiene) with separated code neighborhoods.
- **Multi-specialist review** where reviewers must not contaminate each other’s first impressions.
- **Parallel test/log analysis** across unrelated failures (distinct subsystems).

## Model & Harness Routing Notes

### Harness routing

- Launch all parallel Task calls in a **single message** only on harnesses that support concurrent delegation.
- If the harness cannot safely fan out parallel delegations, run lenses sequentially and preserve the same reconciliation schema.
- For harnesses without structured ask tools, put reconciliation decisions as explicit numbered options in chat and wait for user selection on blockers.

### Model routing

- **Faster model:** broad first-pass scans, duplicate detection, low-risk normalization.
- **More capable model:** conflict reconciliation, architectural contradiction analysis, security-critical tie-breaks.
- Escalation trigger: any finding that is \`Critical\`, contradictory across specialists, or confidence <5 with potential ship impact.

## Dispatch Protocol

1. **Identify independent problem domains** (no file overlap; no shared mutable working assumptions).
2. **Craft one prompt per domain** with **full context pasted** — same HARD-GATE as SDD: no “go read X to learn why.”
3. **Launch ALL agents in a single controller message** (multiple Task tool calls) so they start with comparable timelines.
4. **Wait for all to return** before synthesis (avoid incremental confirmation bias).
5. **Reconcile results:** deduplicate findings, merge overlaps, and **conflict-check** contradictions explicitly.
6. **Run the full test suite after any code changes** — parallel analysis may propose edits; verification stays mandatory.

## Review Army Pattern (gstack)

- **Select specialists based on diff content** (security vs data model vs UX vs API compatibility).
- **Launch in parallel** via multiple Task tool calls (one specialist = one Task payload).
- **Collect findings as structured data** (severity, location, confidence, repro brief).
- **Fingerprint dedup:** if the same finding is reported by **two or more** independent specialists, mark it **MULTI-SPECIALIST CONFIRMED** and **+1** confidence vs a singleton.
- **Confidence bands (presentation):**
  - **7+:** headline in the main report / merge-blocking if severity warrants
  - **5–6:** headline with explicit caveat language (“single-lens evidence”)
  - **3–4:** appendix / “worth tracking” section (not merge-blocking alone)
  - **1–2:** suppress from primary narrative unless paired with stronger evidence

### Review Army Artifact Contract (required in review stage via /cc-next)

Write a structured reconciliation artifact at \`.cclaw/artifacts/07-review-army.json\` using this schema:

\`\`\`json
{
  "version": 1,
  "generatedAt": "ISO timestamp",
  "scope": { "base": "branch", "head": "branch", "files": ["..."] },
  "findings": [
    {
      "id": "stable-id",
      "severity": "Critical|Important|Suggestion",
      "confidence": 1,
      "fingerprint": "hash-or-stable-key",
      "reportedBy": ["spec-reviewer", "code-reviewer"],
      "status": "open|accepted|resolved",
      "location": { "file": "path", "line": 123 },
      "recommendation": "..."
    }
  ],
  "reconciliation": {
    "duplicatesCollapsed": 0,
    "conflicts": [],
    "multiSpecialistConfirmed": [],
    "shipBlockers": []
  }
}
\`\`\`

Contract rules:
- \`id\` and \`fingerprint\` must be stable between reruns if the finding is unchanged.
- \`reportedBy\` must include every specialist that independently flagged the issue.
- \`multiSpecialistConfirmed\` lists finding IDs confirmed by 2+ specialists.
- \`shipBlockers\` must include all unresolved \`Critical\` finding IDs.

## Reconciliation Protocol

1. **Normalize** each agent output into a finding list with stable IDs (hash of filepath + rule + message).
2. **Merge duplicates** by fingerprint; annotate confirmations from multiple specialists.
3. **Resolve conflicts** where agents disagree: prefer **evidence-backed** conclusions; if inconclusive, state **UNKNOWN** and propose a single follow-up measurement (bench, test, threat model detail).
4. **Prioritize** by ship risk (data loss, authz, corruption) then by blast radius.
5. **Emit** a single “Decision Record” the implementer can execute sequentially.

## Anti-patterns

- Treating parallel Task launches as a **race to commit**.
- **Parallel implementation agents** sharing a repo without strict file partitioning.
- **Shared mutable state** between agents (scratchpads in the same artifact without merge rules).

## When NOT to Use

- Any task that **implements** production behavior (use SDD sequential implementers instead).
- Workstreams with **hard file dependencies** (Agent B needs Agent A’s edits to compile).
- Small single-file tweaks where orchestration overhead exceeds benefit.

## Quick Reference Table

| Mode | Parallel allowed? | Typical tooling |
|---|---|---|
| Investigation | Yes (disjoint) | Multiple Task calls |
| Review | Yes (disjoint lenses) | Multiple Task calls |
| Implementation | **No** (same codebase) | Sequential Task calls |

## Controller Checklist (before parallel launch)

- Each prompt contains **all** needed instructions (no “read plan” indirection).
- Domains are **provably non-overlapping** in touched paths.
- You have a reconciliation plan (dedupe + conflict rules + confidence bands).

## Task Payload Hygiene (parallel-safe)

- Start each payload with **ROLE + SCOPE + OUTPUT SCHEMA** (same order every time).
- Include **hard boundaries**: directories allowed/forbidden to read, max depth, and “do not edit.”
- Ask for **structured sections** (\`FINDINGS\`, \`CONFIDENCE\`, \`UNKNOWN\`) to simplify merging.
- Prefer **deterministic prompts** over creative prose — you are building evidence, not vibes.

## Specialist Roster (examples — pick what matches the diff)

| Specialist lens | Looks for… | Typical inputs |
|---|---|---|
| Security | authz, injection, SSRF, secrets, trust boundaries | routes, parsers, middleware |
| Data model | invariants, migrations, idempotency, consistency | schema, repositories, jobs |
| API compatibility | breaking changes, versioning, error contracts | public types, OpenAPI, clients |
| Performance | hot loops, IO, caching mistakes | hotspots, benchmarks, traces |
| UX / a11y | state bugs, focus traps, i18n | components, flows |
| Observability | logs/metrics/traces correctness | instrumentation, alerts |

## Confidence Scoring Rubric (0–10)

- **10:** reproduced locally with deterministic steps + code citation + multi-specialist confirmation.
- **8–9:** strong code citation + plausible exploit/bug class; single specialist but excellent evidence.
- **5–7:** plausible issue worth tracking; needs confirmation test or owner review.
- **3–4:** hypothesis-level; do not merge-block without corroboration.
- **0–2:** intuition / style; suppress unless paired with stronger evidence.

## Merge-Blocking Rules (after reconciliation)

- Any **MULTI-SPECIALIST CONFIRMED** **Critical** is merge-blocking until resolved or explicitly waived by the user.
- Conflicting conclusions at **Critical** severity require a tie-break experiment (test/bench) — never guess.
- If reconciliation yields **UNKNOWN** for ship safety, treat as **BLOCKED** until measured.

## Post-Reconcile Actions (controller)

1. Publish a single **merged report** with headline / caveat / appendix bands applied.
2. Convert findings into **sequential SDD tasks** if code changes are required.
3. If no code changes: still run **sanity checks** appropriate to the repo (typecheck/lint spot).

## Parallel Review Task Template (paste into Task tool)

\`\`\`
You are an independent review/investigation subagent.

LENS: {security|data|perf|api|ux|observability — pick one}
SCOPE: {explicit paths/modules}
QUESTION: {one primary question — falsifiable}
DELIVERABLE: structured findings with confidence 0–10 each

Rules:
- Do not edit files unless explicitly authorized in this prompt.
- Cite evidence as file:line for every finding.
- If uncertain, emit CONFIDENCE <= 4 and label as hypothesis.
\`\`\`

## Worked Example (narrative)

A large refactor touches **auth middleware** and **repository queries**. The controller launches parallel reviewers: **security**, **data model**, **API compatibility**. Security finds a possible IDOR (confidence 6); data model finds a migration hazard (confidence 7); API finds a breaking error shape (confidence 8). Fingerprints show no duplicates. Reconciliation merge-blocks on the API break (single specialist but high confidence + citation). Security’s IDOR is downgraded to appendix until a second specialist confirms — later confirmed by **perf** reviewer noticing an extra query path — now **MULTI-SPECIALIST CONFIRMED**, confidence becomes **8** and moves to headline.

## Relationship to SDD

- Parallel agents produce **evidence and prioritized tasks**.
- SDD **implements** those tasks **one at a time** with sequential implementers.
- Never parallelize **writers** on the same codebase; parallelize **readers/analysts** with disjoint scopes.
`;
}

function plannerEnhancedBody(): string {
  return `

## Task Tool Delegation

When a planning problem is too broad for one message, delegate **planning subtasks** via the Task tool — still without parallelizing conflicting file reads if your harness shares caches.

Paste the template below verbatim and fill \`{placeholders}\` in the parent before dispatching.

\`\`\`
You are a planning subagent for a larger Cclaw / engineering workflow.

PLANNING GOAL: {one sentence outcome — e.g., sequencing, risk register, dependency graph}
KNOWN CONSTRAINTS: {deadlines, compatibility, performance, compliance}
CONTEXT ARTIFACTS (read-only list, not instructions): {paths already agreed authoritative}
DELIVERABLES: {explicit outputs — e.g., ordered task list, risk table, decision questions}

Rules:
- Do NOT implement production code.
- Every task must include acceptance criteria copy-paste ready for SDD implementers.
- Flag UNKNOWN explicitly instead of guessing.
- Close with: OPEN_QUESTIONS: ... and NEXT_TASK_TEXT: ... (verbatim extractable queue item)
\`\`\`

`;
}

function specReviewerEnhancedBody(): string {
  return `

## Task Tool Delegation

For spec-compliance audits, use the Task tool with the following **spec-reviewer** payload (fill placeholders in the parent session).

\`\`\`
You are a specification compliance reviewer (subagent).

SPEC CRITERIA (verbatim): {acceptance criteria / invariants / non-goals}
CHANGE SURFACE: {files/commits/PR scope description}
CONTEXT: {domain notes — auth, idempotency, UX states, data contracts}

Instructions:
- For EACH criterion emit PASS / PARTIAL / FAIL with evidence as file:line.
- Read the code; ignore implementer claims unless backed by code citations.
- Close with SPEC_VERDICT: PASS | PASS_WITH_GAPS | FAIL plus GAPS/FAIL list.
\`\`\`

`;
}

function codeReviewerEnhancedBody(): string {
  return `

## Task Tool Delegation

Launch deep **code-quality** reviews using this five-axis template in the Task tool body:

\`\`\`
You are a code-quality reviewer (subagent). Review along ALL axes:

1) Correctness — logic, data flow, error handling, boundary conditions
2) Readability — naming, structure, comments worth keeping vs noise
3) Architecture — boundaries, coupling, extensibility, layering
4) Security (light touch) — trust boundaries, dangerous APIs; defer deep vulns to security specialist if needed
5) Performance — hot paths, accidental complexity, IO pitfalls

SCOPE: {diff summary or file list}
BASELINE CONTEXT: {tests, deployment constraints, compatibility promises}

Output format (mandatory):
- FINDING: [Critical|Important|Suggestion] file:line — problem — recommendation
- Close with RISK_SUMMARY and SHIP_BLOCKERS (explicit list, possibly empty).
\`\`\`

`;
}

function securityReviewerEnhancedBody(): string {
  return `

## Task Tool Delegation

Use a dedicated Task tool invocation for CWE-focused review with reproducible narratives:

\`\`\`
You are a security reviewer (subagent). Perform a CWE-oriented review of the scoped change.

SCOPE: {files/commits/services touched}
THREAT CONTEXT: {exposure, persona, sensitive data classes, trust boundaries crossed}

Requirements:
- Map each finding to CWE-### when possible (else UNKNOWN).
- Provide severity (Critical|Important|Suggestion) tied to exploitability/impact.
- Include a short proof-of-concept attack vector (conceptual, no weaponization).
- Recommend concrete controls (validation, sandboxing, authz checks, safer APIs).
- Close with SECURITY_VERDICT: SHIP | SHIP_WITH_HOTFIXES | NO_SHIP and cite top 3 drivers.
\`\`\`

`;
}

function testAuthorEnhancedBody(): string {
  return `

## Task Tool Delegation

Delegate TDD loops carefully — one behavioral slice per subagent to avoid clobbering tests.
This agent runs in two explicit stage modes to respect cclaw hard-gates:
- \`TEST_RED_ONLY\` (only failing tests + evidence; no production edits)
- \`BUILD_GREEN_REFACTOR\` (implementation + full-suite green + refactor notes)

\`\`\`
You are a TDD implementer subagent.

STAGE_MODE: {TEST_RED_ONLY | BUILD_GREEN_REFACTOR}
FEATURE SLICE: {single behavior expressed as a user-observable outcome}
CURRENT TEST COMMANDS: {exact command names + cwd assumptions}
FIXTURES / PATTERNS: {links to helper modules by path + naming conventions}

Process (mandatory):
1) If STAGE_MODE=TEST_RED_ONLY:
   - RED only — add failing tests proving the gap (show failing output excerpt).
   - Do NOT edit production code.
   - Report: TESTS_ADDED, RED_COMMAND_RUN, RED_EVIDENCE, STATUS: DONE|BLOCKED.
2) If STAGE_MODE=BUILD_GREEN_REFACTOR:
   - GREEN — minimal production code to satisfy existing RED tests, rerun full suite.
   - REFACTOR — only after full suite is green; preserve behavior.
   - Report: FILES_EDITED, GREEN_COMMAND_RUN, REFACTOR_NOTES, STATUS: DONE|BLOCKED.
\`\`\`

`;
}

function docUpdaterEnhancedBody(): string {
  return `

## Task Tool Delegation

For documentation parallelism, still avoid conflicting writes — partition by artifact:

\`\`\`
You are a documentation updater subagent.

DOCS SCOPE: {README|API ref|runbook|changelog section}
SOURCE OF TRUTH: {code paths / flags / env vars that changed}

Tasks:
- Diff mental model vs reality; update only stale sections.
- Preserve tone/structure; no doc rewrite for its own sake.
- List FILES_UPDATED + SUMMARY + OPEN_DOC_QUESTIONS (if user input needed).
\`\`\`

`;
}

/**
 * Returns markdown fragments augmenting each specialist persona with Task tool
 * delegation guidance. Combine with the existing `body` field from `agents.ts`.
 */
export function enhancedAgentBody(agentName: string): string {
  switch (agentName as SubagentCclawAgentName) {
    case "planner":
      return plannerEnhancedBody();
    case "spec-reviewer":
      return specReviewerEnhancedBody();
    case "code-reviewer":
      return codeReviewerEnhancedBody();
    case "security-reviewer":
      return securityReviewerEnhancedBody();
    case "test-author":
      return testAuthorEnhancedBody();
    case "doc-updater":
      return docUpdaterEnhancedBody();
    default:
      return `

## Task Tool Delegation

_No enhanced Task template is defined for agent \`${agentName}\`._

`;
  }
}

export function subagentsAgentsMdBlock(): string {
  return `### Subagent Orchestration

Two patterns (skills under \`.cclaw/skills/\`):

- **SDD** (subagent-driven-development): sequential implementer→reviewer loops. Paste self-contained task text; never point subagents at plan files.
- **Parallel Agents** (dispatching-parallel-agents): parallel review/analysis lenses. Never parallelize implementers on same codebase.

Status contract: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED.

- Controller sequentially dispatches **implementer → reviewer** loops per task.
- HARD-GATE: paste **self-contained task text**; never point subagents at plan files to “discover” scope.
- **Spec fixers** are **fresh agents** after failed spec reviews — avoids parent-context pollution.
- **Machine-only flow checks auto-dispatch** by stage (design/plan/tdd/review/ship) without asking the user to trigger each specialist manually.

### Parallel Agents (\`dispatching-parallel-agents\` skill)

- Parallelize **analysis and review lenses** with multiple Task tool calls in one controller turn.
- HARD-GATE: never run parallel **implementers** on the same codebase; reconcile structured findings afterward.

### Status Contract (SDD)

| Status | Meaning |
|---|---|
| DONE | Complete; proceed to reviewers |
| DONE_WITH_CONCERNS | Proceed, but surface notes prominently |
| NEEDS_CONTEXT | Parent must gather missing info |
| BLOCKED | Escalate to user; do not improvise |

### Choosing a mode

| Scenario | Preferred mode |
|---|---|
| Multi-task implementation plan | SDD sequential implementers |
| Cross-cutting audit with disjoint evidence | Parallel review / investigation agents |
| Code changes touching same module tree | SDD (single writer at a time) |

Use the exported helpers in \`src/content/subagents.ts\` to materialize SKILL bodies and AGENTS.md fragments during install.
`;
}
