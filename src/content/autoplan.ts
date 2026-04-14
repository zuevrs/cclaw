/**
 * Autoplan orchestrator content for cclaw.
 * Generates markdown instructions that AI agents follow; cclaw does not execute the pipeline.
 */

export function autoplanSkillMarkdown(): string {
  return `---
name: autoplan
description: "One command, rough idea in, fully reviewed plan out. Runs brainstorm through plan stages in sequence with auto-decisions."
---

# Cclaw Autoplan — Auto-Orchestration

## Overview

Autoplan is a **one-shot planning pipeline** that accepts a rough idea (plus whatever context already exists in the repo) and produces a **fully reviewed plan** as markdown artifacts under \`.cclaw/artifacts/\`.

It runs the **first five cclaw flow stages in strict order**:

\`brainstorm → scope → design → spec → plan\`

Mechanical questions are **auto-answered** using the Six Decision Principles and logged to a running **Decision Audit Trail**. **Taste** decisions are also auto-answered but must be **surfaced with rationale** at the single **Final Approval Gate**. **User challenges** (cases where the agent believes the user’s stated direction should change) are **never** auto-decided.

Autoplan ends with **one structured HARD STOP** for human approval before any downstream work (test/build/review/ship) should proceed.

This skill describes **what the agent must do when invoked as \`/cc-autoplan\`**. Cclaw installs the markdown; **the agent performs the protocol**.

## HARD-GATE

- **Do NOT write implementation code** (no feature code, refactors, migrations, or "quick fixes" in application sources). Autoplan output is **planning artifacts only**.
- **Do NOT skip any phase** (Phases 0–6). If something seems redundant, still execute it and record "no material change" with evidence.
- **Do NOT auto-answer user challenges.** Present them explicitly and wait.
- **Do NOT "shortcut"** to individual stage commands mid-pipeline unless the user explicitly aborts autoplan and chooses a different path.

## Phase Sequence

### Phase 0 — Intake (always runs)

1. **Create restore point (mandatory, first filesystem write of autoplan):**
   - Path: \`.cclaw/state/autoplan-restore-{ISO-8601-timestamp}.md\`
   - Ensure parent directories exist.
   - File must include:
     - **Timestamp** (same as filename)
     - **Current git branch** (or explicit note if not a git repo)
     - **Original idea/plan text** (verbatim capture of what the user provided for this autoplan run)
     - **Re-run instructions** (how to resume; see **Restore Points**)
2. **Load context:**
   - Read existing \`.cclaw/artifacts/\` (if present) to avoid contradicting prior locked decisions without calling it out.
   - Read **recent git log** (bounded, e.g., last ~30 commits) and **current branch**.
   - Read \`AGENTS.md\` and/or \`CLAUDE.md\` if present (repo agent guidance).
3. **Scope detection flags (heuristic, non-blocking):**
   - **UI scope active** if the request matches **2+** UI/UX terms (examples: "layout", "responsive", "animation", "accessibility", "Figma", "design system", "component", "CSS", "dark mode", "modal", "form validation UX", "empty state", "loading skeleton", "pixel", "spacing", "typography", "contrast", "WCAG", "screen reader", "keyboard navigation").
   - **DX scope active** if the request matches **2+** dev-tooling terms (examples: "CLI", "flag", "subcommand", "SDK", "API client", "OpenAPI", "schema", "codegen", "plugin", "hook", "watcher", "dev server", "logging format", "telemetry", "error codes", "CI", "lint rule", "formatter", "LSP", "extension", "REPL").
   - If both activate, **record both** and prefer **explicit user priority** if stated; otherwise treat as **multi-surface** and keep UX + DX constraints visible in later phases.
4. **Load stage skills (read fully, treat as authoritative for stage depth):**
   - \`.cclaw/skills/brainstorming/SKILL.md\`
   - \`.cclaw/skills/scope-shaping/SKILL.md\`
   - \`.cclaw/skills/engineering-design-lock/SKILL.md\`
   - \`.cclaw/skills/specification-authoring/SKILL.md\`
   - \`.cclaw/skills/planning-and-task-breakdown/SKILL.md\`

### Phase 1 — Brainstorm (always runs)

- Follow \`.cclaw/skills/brainstorming/SKILL.md\` at **full depth** (all sections, all required evaluations).
- **Auto-answer mechanical questions** using the Six Decision Principles + phase tie-breakers.
- **Premise / USER CHALLENGE rule:** If the agent believes a core user premise is wrong, risky, or incompatible with repo reality, classify it as **User Challenge** and **stop auto-progression** on that item until the user confirms or revises.
- **Artifact:** write/update \`.cclaw/artifacts/01-brainstorm.md\` (single source of truth for brainstorm outputs).

### Phase 2 — Scope (always runs)

- Follow \`.cclaw/skills/scope-shaping/SKILL.md\` at **full depth**.
- **Run scope-mode heuristics** (see dedicated section below), then select exactly one:
  - **SCOPE_EXPANSION** (dream big)
  - **SELECTIVE_EXPANSION** (hold core scope, cherry-pick high-value expansions)
  - **HOLD** (maximum rigor on requested scope)
  - **SCOPE_REDUCTION** (strip to essentials)
- **Default recommendation (before scoring):**
  - Greenfield/product-bet starts at **SELECTIVE_EXPANSION**.
  - Enhancement/bugfix starts at **HOLD**.
  - If predicted blast radius is **>15 files** or introduces new infra under tight constraints, bias toward **SCOPE_REDUCTION**.
- **Auto-answer** scope boundary questions when they are **mechanical** or **taste** (never user challenges).
- **Surface requirement:** write a **Scope Mode Heuristics** table and final selected mode rationale in \`02-scope.md\`.
- **Artifact:** \`.cclaw/artifacts/02-scope.md\`

### Phase 3 — Design (always runs)

- Follow \`.cclaw/skills/engineering-design-lock/SKILL.md\` at **full depth**.
- **All review sections** must be evaluated; **none skipped**. If a section has no findings, write **"No issues found"** with a brief evidence note (what you checked).
- **Artifact:** \`.cclaw/artifacts/03-design.md\`

### Phase 4 — Spec (always runs)

- Follow \`.cclaw/skills/specification-authoring/SKILL.md\` at **full depth**.
- **Artifact:** \`.cclaw/artifacts/04-spec.md\`

### Phase 5 — Plan (always runs)

- Follow \`.cclaw/skills/planning-and-task-breakdown/SKILL.md\` at **full depth**.
- Maintain the **Decision Audit Trail** as a running markdown table inside \`05-plan.md\` (append rows after each auto-decision).
- **Artifact:** \`.cclaw/artifacts/05-plan.md\`

### Phase 6 — Final Approval Gate (HARD STOP)

Present a **structured summary** to the user and **do not proceed** to implementation stages until the user selects an option.

**Must include:**

- **Plan summary** (goal, scope cut-line, key design decisions, spec highlights, plan outline).
- **Total auto-decisions count** (mechanical + taste).
- **Taste decisions** with **one-line impact of the rejected alternative** each.
- **User challenges** (if any) — explicitly list: what user said, agent recommendation, why, cost if agent is wrong.
- **Decision audit trail pointer** (where the full table lives — typically \`.cclaw/artifacts/05-plan.md\`).
- **Cross-phase themes** (recurring constraints, risks, or invariants spanning brainstorm→plan).

**Options:**

- **(A) Approve as-is** — treat artifacts as locked enough to start downstream cclaw stages.
- **(B) Approve with overrides** — user states explicit overrides; update artifacts to reflect overrides **without** inventing new scope; re-present diff summary.
- **(C) Interrogate a specific decision** — answer questions; only mutate artifacts if corrections are agreed.
- **(D) Revise plan** — re-run **affected phases only**, preserving intact artifacts where unchanged; **max 3 revision cycles** total (count across the whole autoplan session).
- **(E) Reject / start over** — stop; optionally create a fresh restore point on the next run.

## Six Decision Principles (for auto-answering)

1. **Completeness (P1):** Ship the whole thing. Prefer covering edge cases and failure modes over leaving silent gaps.
2. **Boil Lakes (P2):** Fix everything in the blast radius (touched files + direct importers). Auto-approve lake-boiling when **< 5 files** and **no new infra** (no new services, queues, clusters, deployables).
3. **Pragmatic (P3):** If two options solve the same problem, pick the cleaner/faster-to-validate one. **5 seconds, not 5 minutes** — but do not disguise uncertainty as speed.
4. **DRY (P4):** Reject duplicating existing functionality; prefer extension points and shared modules already present in-repo.
5. **Explicit over Clever (P5):** Prefer obvious, short solutions with clear boundaries over clever abstractions.
6. **Bias toward Action (P6):** Prefer merging decisions and moving forward; **flag** residual risks rather than **blocking** unless a true stop condition exists (security, correctness, ethics, user challenge).

### Phase tie-breakers

- **Brainstorm + Scope:** **P1 + P2 dominate** (completeness + blast-radius integrity).
- **Design + Spec:** **P5 + P1 dominate** (explicitness + completeness of specification).
- **Plan:** **P3 + P5 dominate** (pragmatic sequencing + explicit tasks).

## Decision Taxonomy

### Mechanical

- **Definition:** Exactly one clearly correct answer given repo conventions and constraints.
- **Behavior:** Auto-decide **silently** (no chat clutter), but **still log** to the audit trail.
- **Examples:** use the repo's existing test framework; follow established lint/format patterns; reuse established error handling utilities.

### Taste

- **Definition:** Reasonable engineers could disagree; tradeoffs are real but not safety-critical.
- **Behavior:** Auto-decide with a **stated recommendation** + rationale; **must surface** at Final Approval Gate with **one-line impact of rejected alternative**.
- **Examples:** borderline scope inclusion; close architectural approaches; naming that affects ergonomics but not correctness.

### User Challenge

- **Definition:** The agent believes the user's direction should change (premise risk, wrong problem framing, incompatible constraints, ethical/safety concern).
- **Behavior:** **NEVER auto-decided.** Present:
  - what the user said (quoted, concise)
  - what the agent recommends instead
  - why (repo evidence + reasoning)
  - cost if the agent is wrong
- **Gate:** Wait for explicit user resolution before treating that thread as decided.

## Scope Mode Heuristics (Phase 2)

Score each signal as **+1** (expansion bias), **0** (neutral), or **-1** (contraction bias), then total.
Record the scoring table in \`.cclaw/artifacts/02-scope.md\`.

| Signal | +1 Expansion Bias | 0 Neutral | -1 Contraction Bias |
|---|---|---|---|
| Product novelty | Net-new workflow/subsystem | Moderate feature extension | Bugfix or narrow patch |
| User value upside | Material step-function in UX/DX/business value | Incremental improvement | Marginal gain only |
| Blast radius | Limited, coherent module set | Mixed | Wide cross-cutting changes |
| Delivery risk | Low dependency and integration risk | Moderate | High regression or unknown coupling |
| Time/constraint pressure | Flexible timeline | Manageable | Tight deadline or strict compliance window |
| Operability burden | Existing observability/release path supports growth | Partial readiness | Missing guardrails; expansion would outpace controls |

**Mode recommendation by score:**
- **+3 or higher:** recommend **SCOPE_EXPANSION**
- **+1 to +2:** recommend **SELECTIVE_EXPANSION**
- **0 to -2:** recommend **HOLD**
- **-3 or lower:** recommend **SCOPE_REDUCTION**

**Override heuristics (higher priority):**
- If user asks for immediate bugfix/hotfix with reliability urgency, floor mode at **HOLD**.
- If expansion requires new infra/service boundaries without prior operational readiness, prefer **SCOPE_REDUCTION** or **HOLD**.
- If user explicitly requests an ambitious bet and constraints are flexible, allow **SCOPE_EXPANSION** even when score is borderline (must log risk assumptions).

**Surfacing rule:**
- Final Approval Gate must include: selected mode, score summary, and top 2 signals that drove the choice.

## Decision Audit Trail (running table)

After **each** auto-decision (mechanical or taste), append a row to the running table stored in \`.cclaw/artifacts/05-plan.md\` (create the table if missing):

| # | Phase | Decision | Classification | Principle | Rationale | Rejected Alternative |
|---:|---|---|---|---|---|---|
| 1 | brainstorm | … | Mechanical | P4 | … | … |

**Rules:**

- **Monotonic numbering** across the entire autoplan run (do not reset per phase).
- **No blank classifications.** If unsure between mechanical vs taste, default to **taste** (safer) and surface at the gate.
- The table is part of the **evidence bundle** for the Final Approval Gate.

## Restore Points

- **When:** Phase 0, **before any substantive work** begins (before mutating artifacts beyond creating dirs).
- **Path:** \`.cclaw/state/autoplan-restore-{ISO-timestamp}.md\`
- **Contents must include:**
  - timestamp
  - branch
  - original idea/plan text
  - re-run instructions
- **Resume procedure:** copy the captured **original idea/plan text** back into the working plan input the user provides, then run \`/cc-autoplan\` again (optionally after reverting artifact edits manually if needed).

## Completion Status

Report exactly one terminal status for the autoplan session:

- **APPROVED** — user chose (A) or accepted post-(B) state without further revision cycles.
- **APPROVED_WITH_OVERRIDES** — user chose (B) and artifacts reflect explicit overrides.
- **REJECTED** — user chose (E) or explicitly abandoned the plan.
- **BLOCKED** — cannot proceed due to unresolved **User Challenge(s)** or hard external dependency; list what unblocks.

## Anti-Patterns

- **Skipping a phase** because "it's obvious."
- **Auto-deciding user challenges** "to save time."
- **Failing to log** auto-decisions in the audit trail.
- **Aborting mid-pipeline** and redirecting to individual stage commands without an explicit user abort decision.
- **Exceeding 3 revision cycles** for option (D); if still unresolved, stop with **BLOCKED** and a crisp list of remaining forks.
- **Silent artifact drift** (changing earlier artifacts without marking what changed and why).

## Common Rationalizations (reject these)

| Rationalization | Reality |
|---|---|
| "We can skip scope because brainstorm was thorough." | Thorough brainstorm does not replace scope shaping; different obligations, different failure modes. |
| "Design lock is redundant if the spec is going to rewrite it anyway." | Spec authorizes details; design lock prevents architectural drift and hidden coupling before authorization. |
| "I'll batch auto-decisions mentally and log them at the end." | End-only logging guarantees omissions; the audit trail is a **running** compliance artifact. |
| "The user's premise is probably wrong, but I'll implement around it." | That is a **User Challenge**; autoplan must surface it, not sneak around it. |

## Red Flags (stop and reassess)

- **Missing restore file** after claiming Phase 0 complete.
- **05-plan.md** has fewer audit rows than claimed auto-decisions.
- **Any implementation patch** appears during autoplan (source edits outside \`.cclaw/\` planning artifacts).
- **Contradictions across artifacts** without an explicit "revision delta" section explaining the change.
- **Skipped review sections** in design (missing "No issues found" where applicable).
- **Revision cycle count** is unclear or exceeds three.

## Agent Execution Notes (non-normative but helpful)

- Prefer **small, explicit commits** of artifacts only if the repo workflow expects it; otherwise keep changes grouped logically — but never hide planning edits.
- Treat **UI scope** / **DX scope** flags as persistent headers in artifacts **02–05** so downstream agents inherit the context quickly.
`;
}

export function autoplanCommandContract(): string {
  return `# /cc-autoplan

## Purpose

Run **brainstorm → scope → design → spec → plan** as a single orchestrated pass: load repo context, create a restore point, execute each stage skill at full depth, auto-answer mechanical questions, auto-resolve taste questions with explicit rationale, never auto-resolve user challenges, and finish with **one Final Approval Gate** before any implementation work.

## HARD-GATE

- **No implementation code** during autoplan (planning artifacts only).
- **No skipped phases** (Phases 0–6).
- **No auto-answers for user challenges** (explicit user resolution required).

## Phase Sequence (numbered, one-line each)

1. **Phase 0 — Intake:** restore point + context scan + UI/DX scope flags + read all five stage skills.
2. **Phase 1 — Brainstorm:** full \`brainstorming\` skill depth → \`.cclaw/artifacts/01-brainstorm.md\`.
3. **Phase 2 — Scope:** full \`scope-shaping\` skill depth + scope-mode heuristic scoring (EXPANSION / SELECTIVE / HOLD / REDUCTION) → \`02-scope.md\`.
4. **Phase 3 — Design:** full \`engineering-design-lock\` skill depth; all review sections evaluated → \`03-design.md\`.
5. **Phase 4 — Spec:** full \`specification-authoring\` skill depth → \`04-spec.md\`.
6. **Phase 5 — Plan:** full \`planning-and-task-breakdown\` skill depth; maintain audit trail table → \`05-plan.md\`.
7. **Phase 6 — Final Approval Gate:** HARD STOP summary + options **A–E** (max **3** revision cycles for **D**).

## Decision Principles (numbered list)

1. **Completeness (P1):** ship the whole thing; favor edge-case and failure-mode coverage.
2. **Boil Lakes (P2):** clean the full blast radius; auto-approve when **< 5 files** and **no new infra**.
3. **Pragmatic (P3):** pick the cleaner equal fix quickly (**5 seconds not 5 minutes**).
4. **DRY (P4):** do not duplicate existing functionality; extend what exists.
5. **Explicit over Clever (P5):** obvious, short solutions win.
6. **Bias toward Action (P6):** merge over endless review; flag residual risks instead of stalling.

**Phase tie-breakers:** brainstorm/scope → **P1+P2**; design/spec → **P5+P1**; plan → **P3+P5**.

## Decision Taxonomy (Mechanical / Taste / User Challenge)

- **Mechanical:** one clearly right answer → auto-decide silently + **audit log row**.
- **Taste:** reasonable disagreement → auto-decide with recommendation + **audit log row** + **surface at gate** with **one-line rejected-alternative impact**.
- **User Challenge:** agent recommends changing user direction → **never** auto-decide; present evidence + costs; await user.

## Scope Mode Heuristics (Phase 2)

- Score six scope signals (+1 / 0 / -1): novelty, value upside, blast radius, delivery risk, time pressure, operability burden.
- Map total score to recommendation:
  - **+3+** → **SCOPE_EXPANSION**
  - **+1..+2** → **SELECTIVE_EXPANSION**
  - **0..-2** → **HOLD**
  - **-3-** → **SCOPE_REDUCTION**
- Apply overrides: urgent bugfixes floor at **HOLD**; high-risk infra expansion biases **HOLD/REDUCTION**.
- Persist scoring + selected mode in \`02-scope.md\`, then surface it again in the Final Approval Gate summary.

## Final Approval Gate (options A-E)

- **(A) Approve as-is**
- **(B) Approve with overrides** (explicit user deltas reflected in artifacts)
- **(C) Interrogate a specific decision** (Q/A; only change artifacts if corrections are agreed)
- **(D) Revise plan** (re-run affected phases only; **≤ 3** cycles)
- **(E) Reject / start over**

## Restore Points

Created in **Phase 0** at \`.cclaw/state/autoplan-restore-{ISO-timestamp}.md\` containing timestamp, branch, original idea text, and resume instructions (**copy original idea/plan text → rerun \`/cc-autoplan\`**).

## Completion Status

**APPROVED**, **APPROVED_WITH_OVERRIDES**, **REJECTED**, **BLOCKED**.

## Anti-Patterns

Skipping phases; auto-deciding user challenges; missing audit trail rows; mid-run redirects to other cclaw commands without explicit user abort; >3 revision cycles; silent cross-artifact contradictions.

## Primary Skill (.cclaw/skills/autoplan/SKILL.md)

The executable protocol and tables live in the installed autoplan skill markdown at \`.cclaw/skills/autoplan/SKILL.md\` (generated from cclaw's orchestrator content module).
`;
}

export function autoplanAgentsMdBlock(): string {
  return `### Autoplan Orchestrator

Use \`/cc-autoplan\` to run brainstorm→scope→design→spec→plan in one shot with auto-decisions.
- Mechanical questions are auto-answered using 6 principles
- Scope mode (EXPANSION / SELECTIVE / HOLD / REDUCTION) is selected via explicit heuristic scoring in Phase 2
- Taste decisions are auto-answered but surfaced at a single final approval gate
- User challenges are NEVER auto-answered
- Restore point is created before any work begins

Use this when you want a complete planning pass without interactive per-stage approval.
`;
}
