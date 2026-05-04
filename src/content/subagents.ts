import type { FlowStage } from "../types.js";
import { stageDelegationSummary } from "./stage-schema.js";

import { conversationLanguagePolicyBullets, conversationLanguagePolicyMarkdown } from "./language-policy.js";
/**
 * Markdown content generators for Cclaw’s subagent orchestration skills and enhanced
 * specialist payloads. Cclaw materializes static instructions — this module does not
 * execute orchestration logic at install time beyond string assembly.
 */

const MARKDOWN_CODE_FENCE = "```";

function formatAgentList(agents: string[]): string {
  return agents.length > 0 ? agents.join(", ") : "none";
}

function automaticStageDelegationTable(): string {
  const summary = stageDelegationSummary("standard");
  const rows = summary.map((row) => {
    return `| ${row.stage} | ${formatAgentList(row.mandatoryAgents)} | ${formatAgentList(row.proactiveAgents)} |`;
  }).join("\n");

  return `| Stage | Mandatory agents | Proactive agents |
|---|---|---|
${rows}

> **Track-aware skip (Wave 24, v6.0.0):** mandatory agents are skipped entirely when \`track === "quick"\` OR \`taskClass === "software-bugfix"\`. Use \`mandatoryAgentsFor(stage, track, taskClass)\` from \`src/content/stage-schema.ts\` for the authoritative list at runtime. Proactive agents are trigger-driven opportunities, not a blanket completion gate, and lean/lightweight early-stage runs may intentionally record none.`;
}

type StageAgentSummary = ReturnType<typeof stageDelegationSummary>[number];

function stageSummary(stage: FlowStage): StageAgentSummary {
  return stageDelegationSummary("standard").find((row) => row.stage === stage)
    ?? { stage, mandatoryAgents: [], proactiveAgents: [], primaryAgents: [], dispatchRules: [], stackAwareRoutes: [] };
}

export function subagentDrivenDevSkill(): string {
  return `---
name: subagent-driven-development
description: "Orchestrate implementation via isolated subagents — one fresh agent per task with two-stage review."
---

# Subagent-Driven Development (SDD)

## Overview

Use a **controller -> coder -> overseer** loop when building multi-step software work.

- **Controller (parent agent):** owns the plan, gating, sequencing, and dispatch decisions; never mixes deep implementation context with review evidence.
- **Coder / slice-implementer (subagent):** receives a **single self-contained task** and edits code only within that scope; exits with a structured status contract.
- **Overseer / reviewer (subagent):** validates outputs against the specification **by reading code** and never edits during the overseer pass.

This pattern is intentionally **Superpowers-style**: cheap parallelism where it doesn’t corrupt state, strict serialization where it would.

## Automatic Stage Delegation in Cclaw

For cclaw flow stages, machine-only specialist work should auto-dispatch without waiting for a manual user request. The table below is generated from the canonical stage dispatch registry:

${automaticStageDelegationTable()}

Human input remains mandatory only at explicit approval gates (plan approval, user challenge resolution, release finalization mode).

### Review dispatch protocol

In review stage, run mandatory specialists \`${formatAgentList(stageSummary("review").mandatoryAgents)}\` by default:

1. \`reviewer\` owns Layer 1 spec compliance plus integrated Layer 2 tags (correctness, performance, architecture, external-safety).
2. \`security-reviewer\` owns the mandatory security sweep or no-change attestation.
3. Add \`adversarial-review\` only when trust boundaries changed, Critical/Important ambiguity remains, or the diff is both large and high-risk.

Reconcile findings into \`.cclaw/artifacts/07-review-army.json\` with explicit source tags per finding.

### TDD evidence protocol

Treat RED, GREEN, and REFACTOR as phase intents inside one mandatory \`test-author\` delegation by default:

- \`tdd-red\`: tests only, no production writes
- \`tdd-green\`: minimal production implementation, no new RED tests
- \`tdd-refactor\`: cleanup only after GREEN is proven

Set \`CCLAW_ACTIVE_AGENT\` to the active phase name when possible so workflow-guard
can enforce phase-appropriate write boundaries. Use separate workers only when the harness and slice boundary make the split genuinely useful; the mandatory gate is the evidence-backed \`test-author\` row, not three default subagents.

## Model & Harness Routing Notes

### Harness routing

| Harness | Fallback | Delegation tool | Structured ask | Capability source |
|---|---|---|---|---|
| Claude | \`native\` | Task (named subagent_type) | AskUserQuestion | \`npx cclaw-cli sync\` |
| Cursor | \`generic-dispatch\` | Task (generic subagent_type: explore/generalPurpose/…) | AskQuestion | \`npx cclaw-cli sync\` |
| OpenCode | \`native\` | generated \`.opencode/agents/<agent>.md\` subagents via Task / \`@agent\` mention | \`question\` (permission-gated; \`permission.question: "allow"\`) | \`npx cclaw-cli sync\` |
| Codex | \`native\` | generated \`.codex/agents/<agent>.toml\` custom agents via native parallel subagent spawning | \`request_user_input\` (experimental; Plan / Collaboration mode) | \`npx cclaw-cli sync\` |

**Dispatch rules driven by \`subagentFallback\`:**

- \`native\` — use the harness's own named subagent primitive; delegation entry uses \`fulfillmentMode: "isolated"\`.
- \`generic-dispatch\` — map each cclaw agent onto the generic dispatcher with a role prompt; delegation entry uses \`fulfillmentMode: "generic-dispatch"\`.
- \`role-switch\` — degraded fallback only when the active runtime cannot expose its declared dispatch surface. Announce the role in-session, perform the work, append a delegation row with \`fulfillmentMode: "role-switch"\` and ≥1 \`evidenceRef\`. Without evidenceRefs the \`delegation:mandatory:current_stage\` check reports \`missingEvidence\` and blocks stage completion.

### Native dispatch contract

Use real harness subagents for OpenCode and Codex:

1. OpenCode: invoke the generated \`.opencode/agents/<agent>.md\` subagent via Task or \`@<agent>\`. Built-in \`general\` / \`explore\` remain fallback subagent types for ad hoc tasks, but cclaw's core roles are generated by name.
2. Codex: ask Codex to spawn the generated \`.codex/agents/<agent>.toml\` custom agent(s) by name; for review-style independent lanes, request parallel spawning and wait for all results before reconciliation.
3. Claude: use the native named Task subagent. Cursor: map the cclaw role onto the generic Task/Subagent surface with a self-contained prompt.
4. Produce stage output in the current artifact, with anchors suitable for \`evidenceRefs\`.
5. Append delegation ledger rows with \`stage\`, \`agent\`, \`mode\`, \`status: "completed"\`, and \`fulfillmentMode\` matching the dispatch mode (\`"isolated"\` for Claude/OpenCode/Codex, \`"generic-dispatch"\` for Cursor).

The only time a \`harness_limitation\` waiver fires automatically is when every installed harness declares \`subagentFallback: "waiver"\`. Do not map Codex or OpenCode onto auto-waiver or default role-switch; they have true subagent surfaces.

### Model routing

- **Use a faster model** for bounded, deterministic tasks (single slice implementation, mechanical refactors, straightforward lint/test fixes).
- **Use a more capable model** for high-ambiguity or high-risk analysis (security review, architecture conflicts, spec contradiction resolution).
- During review-heavy stages, prefer **mixed routing**: faster first-pass triage + escalate only high-severity/low-confidence findings.

### Cost-aware routing (tier table)

| Tier | Use for | Example agents |
|---|---|---|
| \`deep\` | one heavy reasoning pass per stage (planner, final reconciliation) | planner |
| \`balanced\` | spec compliance + code/security review with enough context | reviewer, security-reviewer, test-author |
| \`fast\` | bounded maintenance updates and doc hygiene | doc-updater |

**Routing rules:**
- At most ONE \`deep\` agent per stage (planner OR final reconciliation, not both).
- \`balanced\` agents are default for review-stage specialists.
- \`fast\` agents are the only tier you should fan out in parallel (3-5 at a time is fine).
- Never escalate a \`fast\` agent's output directly to ship decisions — always have a \`balanced\` reviewer consume the evidence first.

### Per-stage routing triggers

Concrete per-stage rules so the controller does not have to guess which tier fits each dispatch. These are defaults; explicit user overrides always win.

| Stage | Deep slot | Balanced slot(s) | Fast fan-out | Trigger to escalate |
|---|---|---|---|---|
| brainstorm | planner (only if ambiguity spans >1 module) | product-discovery / critic when product value or premise is uncertain | run in-thread research playbooks | promote to \`balanced\` critic if the do-nothing path may beat the idea |
| scope | planner (always) | product-discovery / critic when mode changes value, trajectory, or boundaries | run \`research/git-history.md\` in-thread when churn is high | promote to \`balanced\` critic if scope mode is disputed |
| design | planner (always) | critic, security-reviewer, test-author when alternatives/trust/testability apply | run \`research/framework-docs-lookup.md\` + \`research/best-practices-lookup.md\` in-thread | escalate one specialist to \`deep\` only if a failure mode is Critical-severity |
| spec | — | spec-validator / spec-document-reviewer / reviewer (for long or high-risk specs) | — | escalate to \`deep\` only for spec ↔ design contradictions |
| plan | planner (solo, always) | — | — | never fan out at plan stage; one owner for dependency graph |
| tdd | — | ${formatAgentList(stageSummary("tdd").primaryAgents)} (per slice, carrying RED/GREEN/REFACTOR evidence) · reviewer (slice-local only when sliceReview triggers) | doc-updater (API surface changes) | escalate to \`deep\` only when a RED test cannot be expressed (design leak) |
| review | — | ${formatAgentList(stageSummary("review").mandatoryAgents)} (both mandatory) | doc-updater for release-note drift checks | escalate a \`balanced\` reviewer to \`deep\` only when two reviewers disagree on severity |
| ship | — | ${formatAgentList(stageSummary("ship").proactiveAgents)} (if blast radius is high) | doc-updater (changelog/migration notes) | escalate to \`balanced\` reviewer only if preflight finds a regression |

**De-escalation rules (avoid over-spending):**
- If a \`deep\` planner run returns low-uncertainty output (single unambiguous plan), do **not** add a second \`deep\` pass in the same stage.
- If a \`fast\` researcher's evidence is the only input to a decision, the consuming agent must be \`balanced\` or higher.
- Review-stage reviewers should default to \`balanced\`; bump to \`deep\` only when findings cite architectural contradictions.
- Refactor-only TDD slices (state-based, no behavioral change) can drop test-author to \`fast\` if the test pyramid stays green.

## HARD-GATE

${conversationLanguagePolicyMarkdown()}
**Never dispatch a subagent without a concrete, self-contained task description pasted into the prompt. Do not pass file references the subagent must read to understand its task.**

If you catch yourself writing “read PLAN.md Task 3” or “implement the next unchecked item,” stop: expand the work into explicit text in the Task body before dispatching.

## Anti-Drift Team Defaults

Borrow the good part of Team/Ruflo-style orchestration without adding a swarm runtime:

- **One controller owns alignment.** The parent keeps the task list, gate state, and final synthesis.
- **Small fan-out by default.** Run at most 3-5 parallel agents, and only for independent read-only research or non-overlapping files.
- **No parallel writes to adjacent surfaces.** If tasks may touch the same module, serialize them.
- **Checkpoint before synthesis.** Each agent returns status, files inspected/changed, evidence, and blockers before the parent acts.
- **Consensus is for hard calls only.** Use two reviewers when severity or architecture is disputed; otherwise one evidence-backed reviewer is enough.
- **Multi-wave persistence uses the executing-waves skill.** For 2+ wave efforts, maintain \`.cclaw/wave-plans/\` and run carry-forward drift audits in brainstorm.

## Parallelization Decision Gate

Before parallel dispatch, answer yes to all gates: tasks are independent, write sets do not overlap, outputs can be reconciled by evidence, and failure in one lane will not invalidate hidden assumptions in another. If any answer is no, serialize. Coder/overseer work is contract-first: the coder implements only the pasted contract, the overseer reads code and verifies acceptance evidence before the controller marks work complete.

## When to Use

- Mid/large plans with multiple discrete tasks, dependencies, or risky overlap.
- Complex features where isolation prevents parent-session context pollution.
- Situations where **fresh tool context** is cheaper than incremental patching in one mega-thread.
- When reviews should be adversarial to claims (“show me the code”), not collegial summaries.

## Full Protocol

1. **Read plan, extract all tasks with full text**
   - Copy each task verbatim into a working queue (checklist is fine).
   - Normalize each task so it includes: goal, acceptance criteria, constraints, and explicit “out of scope.”

2. **For each task — sequential by default; parallel only with cohesion controls:**
   - Implementation subagents are sequential by default. Parallel implementers
     are allowed only when ALL three conditions hold:
     - (a) the lanes touch non-overlapping files (verify via the plan's task
       file-set list before dispatch),
     - (b) the controller passes \`--allow-parallel\` on each ledger row, and
     - (c) an \`integration-overseer\` is dispatched after the parallel lanes
       complete and writes cohesion-evidence (cross-file integration tests,
       contract checks, or merge-conflict scan) into the artifact before any
       gate is marked passed.
     If any of the three conditions are unmet, serialize.
   1. **Dispatch implementer subagent** with the **full task text pasted in** (not a file reference).
   2. **Check return status:** \`DONE\` / \`DONE_WITH_CONCERNS\` / \`NEEDS_CONTEXT\` / \`BLOCKED\`
   3. If \`DONE\`: dispatch **reviewer** subagent to verify actual code matches spec and quality expectations.
   4. If spec review **FAIL**: dispatch **fixer subagent** (a **new** agent — not an inline patch from the parent — to avoid context pollution).
   5. Dispatch **code-quality reviewer** (maintainability/PR hygiene).
   6. **Mark task complete** only after concerns are triaged or explicitly accepted with rationale.

3. **After all tasks:** dispatch **final code reviewer** for a full-repo / full-surface pass (what escaped local task boundaries).

4. **Transition to finishing workflow** (ship checklist, changelog, migration notes) once reviewers show no unresolved Criticals.

## Status Contract

| Status | Meaning | Controller action |
|---|---|---|
| DONE | Implementation complete; tests orchestrated per prompt; no known material risks | Proceed to reviewers |
| DONE_WITH_CONCERNS | Shippable but with documented tradeoffs/risks | Proceed with reviewer + explicit notes; do not dismiss concerns |
| NEEDS_CONTEXT | Missing authoritative information only the parent/user can supply | Parent gathers context, then re-dispatch implementer with augmented prompt |
| BLOCKED | Hard stop (permissions, tool failure, conflicting requirements, unsafe state) | Parent escalates to user; do not stack speculative guesses |

## Strict Worker Return Schemas

Every delegated worker must return one terminal status and the listed evidence fields. Prefer JSON fenced as \`json\`; prose may follow only after the object.

### Implementer / fixer return

${MARKDOWN_CODE_FENCE}json
{
  "status": "DONE|DONE_WITH_CONCERNS|NEEDS_CONTEXT|BLOCKED",
  "filesChanged": ["path"],
  "testsRun": [{ "command": "string", "result": "PASS|FAIL|NOT_RUN", "evidence": "short excerpt or reason" }],
  "evidenceRefs": [".cclaw/artifacts/<file>#anchor"],
  "concerns": ["string"],
  "needsContext": ["string"],
  "blockers": ["string"]
}
${MARKDOWN_CODE_FENCE}

### Reviewer return

${MARKDOWN_CODE_FENCE}json
{
  "status": "PASS|PASS_WITH_GAPS|FAIL|BLOCKED",
  "findings": [{ "severity": "Critical|Important|Suggestion", "location": "file:line", "problem": "string", "recommendation": "string" }],
  "criteria": [{ "id": "string", "verdict": "PASS|PARTIAL|FAIL", "evidence": "file:line" }],
  "evidenceRefs": [".cclaw/artifacts/<file>#anchor"],
  "blockers": ["string"]
}
${MARKDOWN_CODE_FENCE}

### Lifecycle evidence

Before dispatch, create or reserve a delegation span (\`status: "scheduled"\`, \`spanId\`, \`startTs\`, optional \`taskId\`). On return, append a terminal row for the same \`spanId\` with \`endTs\`, \`status\`, \`fulfillmentMode\`, and non-empty \`evidenceRefs\` whenever the worker was generic-dispatch or role-switch. A scheduled span without a terminal row in the current run is stale and must be resolved before claiming the stage is complete.

## Implementer Prompt Template (paste into Task tool)

${MARKDOWN_CODE_FENCE}
You are implementing a single task from a development plan.

TASK: {paste full task text here}
CONTEXT: {paste relevant file paths, types, patterns}
CONSTRAINTS: {paste from spec — what NOT to do}

After implementation:
0. Write user-facing narrative in the parent/user language; keep status tokens unchanged.
1. Run the relevant test suite or explain why it was not run.
2. Return the strict implementer/fixer JSON schema first.
3. If DONE_WITH_CONCERNS, list each concern in \`concerns\`.
4. If NEEDS_CONTEXT, specify exactly what you need in \`needsContext\`.
${MARKDOWN_CODE_FENCE}

## Spec-Reviewer Prompt Template (paste into Task tool)

${MARKDOWN_CODE_FENCE}
Review the implementation against the specification.

SPEC CRITERIA: {paste acceptance criteria}
FILES CHANGED: {list files}

For each criterion: PASS / FAIL / PARTIAL with evidence (file:line).
Do NOT trust the implementer's self-report — read the actual code.
${MARKDOWN_CODE_FENCE}

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

${MARKDOWN_CODE_FENCE}
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
${MARKDOWN_CODE_FENCE}

## Fixer Subagent Prompt Template (after spec review FAIL)

${MARKDOWN_CODE_FENCE}
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
${MARKDOWN_CODE_FENCE}

## Final Code Reviewer Prompt Template (post-queue sweep)

${MARKDOWN_CODE_FENCE}
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
${MARKDOWN_CODE_FENCE}

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

${conversationLanguagePolicyMarkdown()}
**Never dispatch parallel IMPLEMENTATION agents that write to the same codebase. Parallel agents are for investigation, analysis, and review ONLY.**

Implementation that touches shared source trees must remain **sequential** unless you have proven disjoint filesystem ownership (rare) and an explicit merge protocol.

When explicit bounded TDD fan-out is approved with parallel \`slice-implementer\` lanes, author \`.cclaw/artifacts/cohesion-contract.md\` + \`.json\` before launch and run \`integration-overseer\` after fan-in.

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
2. **Author cohesion contract first** whenever fan-out touches shared interfaces or bounded parallel \`slice-implementer\` lanes.
3. **Craft one prompt per domain** with **full context pasted** — same HARD-GATE as SDD: no “go read X to learn why.”
4. **Launch ALL agents in a single controller message** (multiple Task tool calls) so they start with comparable timelines.
5. **Wait for all to return** before synthesis (avoid incremental confirmation bias).
6. **Run integration-overseer after fan-in** to verify touchpoints, boundary types, invariants, and integration-test outcomes.
7. **Reconcile results:** deduplicate findings, merge overlaps, and **conflict-check** contradictions explicitly.
8. **Run the full test suite after any code changes** — parallel analysis may propose edits; verification stays mandatory.

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

### Review Army Artifact Contract (required in review stage via /cc)

Write a structured reconciliation artifact at \`.cclaw/artifacts/07-review-army.json\` using this schema:

${MARKDOWN_CODE_FENCE}json
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
      "reportedBy": ["reviewer", "security-reviewer"],
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
${MARKDOWN_CODE_FENCE}

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

${MARKDOWN_CODE_FENCE}
You are an independent review/investigation subagent.

LENS: {security|data|perf|api|ux|observability — pick one}
SCOPE: {explicit paths/modules}
QUESTION: {one primary question — falsifiable}
DELIVERABLE: structured findings with confidence 0–10 each

Rules:
- Do not edit files unless explicitly authorized in this prompt.
- Cite evidence as file:line for every finding.
- If uncertain, emit CONFIDENCE <= 4 and label as hypothesis.
${MARKDOWN_CODE_FENCE}

## Worked Example (narrative)

A large refactor touches **auth middleware** and **repository queries**. The controller launches parallel reviewers: **security**, **data model**, **API compatibility**. Security finds a possible IDOR (confidence 6); data model finds a migration hazard (confidence 7); API finds a breaking error shape (confidence 8). Fingerprints show no duplicates. Reconciliation merge-blocks on the API break (single specialist but high confidence + citation). Security’s IDOR is downgraded to appendix until a second specialist confirms — later confirmed by **perf** reviewer noticing an extra query path — now **MULTI-SPECIALIST CONFIRMED**, confidence becomes **8** and moves to headline.

## Relationship to SDD

- Parallel agents produce **evidence and prioritized tasks**.
- SDD **implements** those tasks **one at a time** with sequential implementers.
- Never parallelize **writers** on the same codebase; parallelize **readers/analysts** with disjoint scopes.
`;
}


function researcherEnhancedBody(): string {
  return `

## Task Tool Delegation

Use this payload when a stage needs context-readiness or search-before-read evidence:

${MARKDOWN_CODE_FENCE}
You are a researcher subagent.

SCOPE — External plus internal research: search official docs/libraries/prior art and current best practices (use web or package-index tooling whenever it is live; cite URLs or authoritative references). Internally scan the repo for commits, manifests, conventions, migrations, configuration, and latent decisions—even when the workspace is sparse, external benchmarking stays mandatory.

QUESTION: {one falsifiable research question}
SCOPE: {repo paths, docs, references, providers to inspect}
CONTEXT READINESS: {graph/search/provider status if known}

Required output:
- SEARCH_SUMMARY: queries/patterns/providers tried before large reads
- FACTS: evidence-backed findings with refs
- STALE_OR_MISSING_CONTEXT: gaps and recommended recovery
- DECISION_IMPACT: what stage decision this changes
${MARKDOWN_CODE_FENCE}

`;
}

function architectEnhancedBody(): string {
  return `

## Task Tool Delegation

${MARKDOWN_CODE_FENCE}
You are an architect subagent.

DESIGN_DECISION: {architecture decision to validate}
SCOPE_CONTRACT: {approved boundaries}
BLAST_RADIUS: {paths/modules/interfaces}

Required output:
- BOUNDARIES: chosen ownership and interface contracts
- ALTERNATIVES: rejected alternatives and revival signals
- FAILURE_MODES: method/exception/rescue/user-visible impact
- SPEC_HANDOFF: requirements and verification evidence downstream spec must carry
${MARKDOWN_CODE_FENCE}

`;
}

function specValidatorEnhancedBody(): string {
  return `

## Task Tool Delegation

${MARKDOWN_CODE_FENCE}
You are a spec-validator subagent.

ACCEPTANCE_CRITERIA: {criteria to validate}
UPSTREAM_DECISIONS: {design/scope refs}

Required output:
- CRITERIA_AUDIT: PASS/PARTIAL/FAIL per AC with reason
- EDGE_CASE_GAPS: boundary/error cases missing
- ASSUMPTION_GAPS: assumptions requiring approval or rewrite
- TESTABILITY_MAP: concrete test level and command/manual evidence per AC
${MARKDOWN_CODE_FENCE}

`;
}

function specDocumentReviewerEnhancedBody(): string {
  return `

## Task Tool Delegation

Use this payload for final spec-document quality checks before plan handoff:

${MARKDOWN_CODE_FENCE}
You are a spec-document-reviewer subagent.

SPEC_ARTIFACT: {04-spec excerpt or full body}
UPSTREAM_CONTEXT: {scope/design refs used by the spec}

Required output:
- DOCUMENT_VERDICT: PASS | PASS_WITH_GAPS | FAIL | BLOCKED
- COMPLETENESS_CHECK: missing required sections or weakly populated rows
- CONSISTENCY_CHECK: contradictions across ACs, assumptions, mapping, and approval
- CLARITY_CHECK: ambiguity/placeholders/two-way wording to rewrite
- SCOPE_FIT_CHECK: whether the artifact still maps to one coherent subsystem/plan slice
- PATCH_RECOMMENDATIONS: minimal edits to make the spec plan-ready
${MARKDOWN_CODE_FENCE}

`;
}

function sliceImplementerEnhancedBody(): string {
  return `

## Task Tool Delegation

${MARKDOWN_CODE_FENCE}
You are a slice-implementer subagent.

SLICE: {single vertical slice — controller MUST dispatch you with --slice S-<id> --phase green --paths <comma-separated>}
RED_EVIDENCE: {failing test and expected failure}
ALLOWED_FILES: {explicit file boundaries — surfaced to scheduler as Files: <paths>}
FORBIDDEN_CHANGES: {scope/compatibility limits}
VERIFICATION: {commands expected}

Rules:
- Implement only the minimal GREEN change for the existing RED evidence.
- Keep REFACTOR behavior-preserving.
- Return the strict worker JSON schema first.

Slice phase-event contract (v6.11.0):
- Do NOT hand-edit \`## Watched-RED Proof\`, \`## Vertical Slice Cycle\`, \`## RED Evidence\`, or \`## GREEN Evidence\` markdown tables in 06-tdd.md. The linter auto-renders them between \`<!-- auto-start: tdd-slice-summary -->\` markers from \`delegation-events.jsonl\` slice phase rows.
- Your dispatch row IS the evidence: the harness-generated delegation-record hook stamps \`sliceId=S-<id>\`, \`phase=green\`, and \`completedTs\` automatically. Attach evidenceRefs (test path, span ref, or pasted-output pointer) so the linter validates the row.
- After REFACTOR, ask the controller to re-dispatch you with \`--phase refactor\` (or \`--phase refactor-deferred --refactor-rationale "<why>"\`); each call appends a new ledger row.
- Per-slice prose summary lives in \`<artifacts-dir>/tdd-slices/S-<id>.md\` and is owned by the parallel \`slice-documenter\` (or the controller). You do NOT touch that file.
${MARKDOWN_CODE_FENCE}

`;
}

function performanceReviewerEnhancedBody(): string {
  return `${codeReviewerEnhancedBody()}

## Performance Lens

Focus on hot paths, IO/network calls, repeated work, caching, data volume, rendering, and algorithmic complexity. Include measurement evidence or a concrete measurement plan for every non-trivial finding.
`;
}

function compatibilityReviewerEnhancedBody(): string {
  return `${codeReviewerEnhancedBody()}

## Compatibility Lens

Focus on public APIs, CLI/config shape, persisted data, migrations, generated clients, dependency/runtime versions, and backwards-compatibility obligations. Distinguish shipped behavior from in-branch churn.
`;
}

function observabilityReviewerEnhancedBody(): string {
  return `${codeReviewerEnhancedBody()}

## Observability Lens

Focus on logs, metrics, traces, alerts, debug paths, rollout visibility, and support handoff. Block only when missing visibility affects diagnosis, rollback, or user/data safety.
`;
}

function releaseReviewerEnhancedBody(): string {
  return `

## Task Tool Delegation

${MARKDOWN_CODE_FENCE}
You are a release-reviewer subagent.

SHIP_ARTIFACT: {ship/preflight evidence}
REVIEW_VERDICT: {review status and blockers}
FINALIZATION_MODE: {selected enum}

Required output:
- PREFLIGHT: commands and PASS/FAIL evidence freshness
- VICTORY_DETECTOR: feature coverage, evaluator evidence, clean state, learnings, handoff
- ROLLBACK: trigger, steps, owner, and no-VCS handoff if applicable
- SHIP_VERDICT: SHIP | SHIP_WITH_CONCERNS | BLOCKED
${MARKDOWN_CODE_FENCE}

`;
}

function plannerEnhancedBody(): string {
  return `

## Task Tool Delegation

When a planning problem is too broad for one message, delegate **planning subtasks** via the Task tool — still without parallelizing conflicting file reads if your harness shares caches.

Paste the template below verbatim and fill \`{placeholders}\` in the parent before dispatching.

${MARKDOWN_CODE_FENCE}
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
${MARKDOWN_CODE_FENCE}

`;
}

function specReviewerEnhancedBody(): string {
  return `

## Task Tool Delegation

For review audits, use the Task tool with the following **reviewer** payload (fill placeholders in the parent session).

${MARKDOWN_CODE_FENCE}
You are a specification compliance reviewer (subagent).

SPEC CRITERIA (verbatim): {acceptance criteria / invariants / non-goals}
CHANGE SURFACE: {files/commits/PR scope description}
CONTEXT: {domain notes — auth, idempotency, UX states, data contracts}

Instructions:
- For EACH criterion emit PASS / PARTIAL / FAIL with evidence as file:line.
- Read the code; ignore implementer claims unless backed by code citations.
- Close with SPEC_VERDICT: PASS | PASS_WITH_GAPS | FAIL plus GAPS/FAIL list.
${MARKDOWN_CODE_FENCE}

`;
}

function codeReviewerEnhancedBody(): string {
  return `

## Task Tool Delegation

Launch deep **code-quality** reviews using this five-axis template in the Task tool body:

${MARKDOWN_CODE_FENCE}
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
${MARKDOWN_CODE_FENCE}

`;
}


function productManagerEnhancedBody(): string {
  return `

## Task Tool Delegation

Use this payload when product discovery needs an isolated lens:

${MARKDOWN_CODE_FENCE}
You are a product-manager subagent.

DISCOVERY GOAL: {problem/value decision to clarify}
CONTEXT: {existing artifact excerpts, user segment, constraints}
DEPTH: {lite|standard|deep}

Required output:
- PERSONA_JTBD: persona, job, pain/trigger
- VALUE_HYPOTHESIS: expected value and success metric
- EVIDENCE_SIGNAL: strongest evidence, weakest assumption
- WHY_NOW_AND_DO_NOTHING: why now plus consequence of no action
- NON_GOALS: explicit exclusions
- SCOPE_HANDOFF: one recommendation for hold/selective/expand/reduce
${MARKDOWN_CODE_FENCE}

`;
}

function productStrategistEnhancedBody(): string {
  return `

## Task Tool Delegation

Use this payload for expansion-mode scope strategy checks:

${MARKDOWN_CODE_FENCE}
You are a product-strategist subagent.

SCOPE_MODE: {SCOPE EXPANSION|SELECTIVE EXPANSION}
DECISION_CONTEXT: {scope contract excerpt + constraints + approved brainstorm direction}
DEPTH: {standard|deep}

Required output:
- VISION_DELTA: 10x trajectory vs hold-scope baseline
- EXPANSION_PROPOSALS: 2-3 concrete proposals with add/defer/skip recommendation
- UPSIDE_AND_RISK: strategic upside, reversibility, and principal downside per proposal
- TRAJECTORY_FIT: whether current architecture trajectory can absorb accepted expansions
- FINAL_RECOMMENDATION: smallest high-leverage expansion set to lock now
${MARKDOWN_CODE_FENCE}

`;
}

function criticEnhancedBody(): string {
  return `

## Task Tool Delegation

Use this payload when a premise, scope mode, or engineering path needs adversarial pressure:

${MARKDOWN_CODE_FENCE}
You are a critic subagent.

DECISION_UNDER_REVIEW: {direction/scope/design choice}
CONTEXT: {artifact excerpts, constraints, known risks}
DEPTH: {lite|standard|deep}

Required output:
- PREMISE_ATTACK: what could make this decision wrong
- CHEAPER_ALTERNATIVE: smaller or more reversible option
- SHADOW_ALTERNATIVE: viable competing path
- SWITCH_TRIGGER: signal that should change the decision
- FAILURE_RESCUE: likely failure and rescue/degraded behavior
- VERIFICATION_EVIDENCE: evidence needed before locking
${MARKDOWN_CODE_FENCE}

`;
}

function reviewerEnhancedBody(): string {
  return `${specReviewerEnhancedBody()}${codeReviewerEnhancedBody()}`;
}

function securityReviewerEnhancedBody(): string {
  return `

## Task Tool Delegation

Use a dedicated Task tool invocation for CWE-focused review with reproducible narratives:

${MARKDOWN_CODE_FENCE}
You are a security reviewer (subagent). Perform a CWE-oriented review of the scoped change.

SCOPE: {files/commits/services touched}
THREAT CONTEXT: {exposure, persona, sensitive data classes, trust boundaries crossed}

Requirements:
- Map each finding to CWE-### when possible (else UNKNOWN).
- Provide severity (Critical|Important|Suggestion) tied to exploitability/impact.
- Include a short proof-of-concept attack vector (conceptual, no weaponization).
- Recommend concrete controls (validation, sandboxing, authz checks, safer APIs).
- Close with SECURITY_VERDICT: SHIP | SHIP_WITH_HOTFIXES | NO_SHIP and cite top 3 drivers.
${MARKDOWN_CODE_FENCE}

`;
}

function testAuthorEnhancedBody(): string {
  return `

## Task Tool Delegation

Delegate TDD loops carefully — one behavioral slice per subagent to avoid clobbering tests.
This agent runs in two explicit stage modes to respect cclaw hard-gates:
- \`TEST_RED_ONLY\` (only failing tests + evidence; no production edits)
- \`BUILD_GREEN_REFACTOR\` (implementation + full-suite green + refactor notes)

${MARKDOWN_CODE_FENCE}
You are a TDD implementer subagent.

STAGE_MODE: {TEST_RED_ONLY | BUILD_GREEN_REFACTOR}
FEATURE SLICE: {single behavior expressed as a user-observable outcome}
CURRENT TEST COMMANDS: {exact command names + cwd assumptions}
FIXTURES / PATTERNS: {links to helper modules by path + naming conventions}

Process (mandatory):
1) If STAGE_MODE=TEST_RED_ONLY:
   - Controller dispatched you with \`--slice S-<id> --phase red\`. Add failing tests proving the gap (show failing output excerpt).
   - Do NOT edit production code.
   - Do NOT hand-edit \`## Watched-RED Proof\` / \`## RED Evidence\` markdown tables in 06-tdd.md — the linter auto-renders them from your dispatch row in \`delegation-events.jsonl\`. Just ensure your worker return includes evidenceRefs (test path, span ref, or pasted-output pointer) so the harness can stamp them on the ledger row.
   - Report: TESTS_ADDED, RED_COMMAND_RUN, RED_EVIDENCE, STATUS: DONE|BLOCKED.
2) If STAGE_MODE=BUILD_GREEN_REFACTOR:
   - Controller dispatched you with \`--slice S-<id> --phase green\` (and later \`--phase refactor\` or \`--phase refactor-deferred --refactor-rationale "<why>"\`).
   - GREEN — minimal production code to satisfy existing RED tests, rerun full suite.
   - REFACTOR — only after full suite is green; preserve behavior.
   - Do NOT hand-edit \`## Vertical Slice Cycle\` / \`## GREEN Evidence\` markdown tables — auto-rendered from your dispatch row.
   - Report: FILES_EDITED, GREEN_COMMAND_RUN, REFACTOR_NOTES, STATUS: DONE|BLOCKED.
${MARKDOWN_CODE_FENCE}

`;
}

function implementerEnhancedBody(): string {
  return `

## Task Tool Delegation

You are the default sequential implementation worker for one scoped task. Do not expand scope silently.

\`\`\`
You are an implementer subagent.

TASK: {single task with acceptance criteria pasted in full}
ALLOWED FILES / MODULES: {explicit boundaries}
FORBIDDEN CHANGES: {out-of-scope behavior, compatibility constraints}
VERIFICATION: {commands expected, or explain if unavailable}

Rules:
- Implement the smallest code change that satisfies the task.
- Do not spawn subagents.
- Return the strict implementer JSON schema first.
\`\`\`

`;
}

function fixerEnhancedBody(): string {
  return `

## Task Tool Delegation

Fixers are fresh workers dispatched only after a reviewer identifies a concrete failing criterion.

\`\`\`
You are a fixer subagent. You are NOT the original implementer.

FAILING CRITERION: {verbatim criterion}
REVIEW EVIDENCE: {file:line citations and short quotes}
ALLOWED FILES: {explicit list}
FORBIDDEN CHANGES: {scope and compatibility constraints}

Rules:
- Reproduce or reason from the cited failure before editing.
- Apply the smallest fix that closes the cited gap.
- Return the strict fixer JSON schema first.
\`\`\`

`;
}

function docUpdaterEnhancedBody(): string {
  return `

## Task Tool Delegation

For documentation parallelism, still avoid conflicting writes — partition by artifact:

${MARKDOWN_CODE_FENCE}
You are a documentation updater subagent.

DOCS SCOPE: {README|API ref|runbook|changelog section}
SOURCE OF TRUTH: {code paths / flags / env vars that changed}

Tasks:
- Diff mental model vs reality; update only stale sections.
- Preserve tone/structure; no doc rewrite for its own sake.
- List FILES_UPDATED + SUMMARY + OPEN_DOC_QUESTIONS (if user input needed).
${MARKDOWN_CODE_FENCE}

`;
}

export function subagentsAgentsMdBlock(): string {
  return `### Subagent Orchestration

Two patterns (skills under \`.cclaw/skills/\`):

- **SDD** (subagent-driven-development): sequential implementer→reviewer loops. Paste self-contained task text; never point subagents at plan files.
- **Parallel Agents** (dispatching-parallel-agents): parallel review/analysis lenses. Never parallelize implementers on same codebase.

Status contract: ACK first, then DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED. Worker returns must use the strict JSON schemas in \`subagent-driven-development\` and include matching spanId+dispatchId proof.

- Controller sequentially dispatches **implementer → reviewer** loops per task and records lifecycle events in \`.cclaw/state/delegation-events.jsonl\`.
- HARD-GATE: paste **self-contained task text**; never point subagents at plan files to “discover” scope.
- **Review fixers** are **fresh agents** after failed review passes — avoids parent-context pollution.
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
