import { CCLAW_VERSION } from "../constants.js";

export interface ArtifactTemplate {
  id:
    | "plan"
    | "build"
    | "review"
    | "ship"
    | "decisions"
    | "learnings"
    | "manifest"
    | "ideas"
    | "agents-block";
  fileName: string;
  description: string;
  body: string;
}

const PLAN_TEMPLATE = `---
slug: SLUG-PLACEHOLDER
stage: plan
status: active
ac:
  - id: AC-1
    text: "Replace with the first observable outcome (something a user or test can verify)."
    status: pending
  - id: AC-2
    text: "Replace with the second observable outcome, or delete this entry if one AC is enough."
    status: pending
last_specialist: null
refines: null
shipped_at: null
ship_commit: null
review_iterations: 0
security_flag: false
---

# SLUG-PLACEHOLDER

> One paragraph: what we are doing and why. This is the elevator pitch. Avoid jargon. If you cannot fit the goal in 4 lines, the request is probably too large — split it before continuing.

## Context

_(Brainstormer fills this when invoked: current state, user intent, constraints. If the orchestrator runs inline without brainstormer, leave a one-line summary here.)_

## Frame

_(Brainstormer / orchestrator: what we believe is true, what we are not sure of, what is intentionally out of scope.)_

## Scope

- **In scope:**
  - _Listed items the change must produce._
- **Out of scope:**
  - _Listed items the change must not touch in this slug._

## Alternatives considered

_(Optional. Brainstormer alternatives mode or architect feasibility mode. Drop this section if there is no real choice.)_

## Architecture

_(Architect, when invoked. Link to .cclaw/decisions/SLUG-PLACEHOLDER.md. Keep this section short — full rationale lives in decisions.md.)_

## Plan

- **Phase 1 — Foundation.**
  - Concrete change with file:path:line reference.
  - Concrete change with file:path:line reference.
- **Phase 2 — Wiring.**
  - …

## Acceptance Criteria

| id | text | status | commit |
| --- | --- | --- | --- |
| AC-1 | _Replace with the first observable outcome._ | pending | — |
| AC-2 | _Replace or delete._ | pending | — |

The AC block is the source of truth. Every commit produced by \`commit-helper.mjs\` must reference exactly one AC id.

## Topology

_(Planner topology mode, when invoked. Default: \`inline\`. For \`parallel-build\` declare slice owners and the integration reviewer.)_

- topology: inline
- parallel slices: _none_

## Traceability block

- AC-1 → commit pending
- AC-2 → commit pending

This block is rebuilt by \`commit-helper.mjs\` after every AC commit. Do not edit by hand once a commit is recorded.
`;

const BUILD_TEMPLATE = `---
slug: SLUG-PLACEHOLDER
stage: build
status: active
build_iterations: 0
last_commit: null
tdd_cycle: enforced
---

# Build log — SLUG-PLACEHOLDER

This is the TDD implementation journal. Every AC goes through RED → GREEN → REFACTOR; every phase is a separate commit recorded by \`commit-helper.mjs --phase=…\`.

> **Iron Law:** NO PRODUCTION CODE WITHOUT A FAILING TEST FIRST. The RED failure is the spec.

## Plan summary

_(One paragraph mirroring \`plans/SLUG-PLACEHOLDER.md\` Plan section.)_

## TDD cycle log

For every AC, append one row with **all six columns filled** before the AC is considered done.

| AC | Discovery | RED proof | GREEN evidence | REFACTOR notes | commits |
| --- | --- | --- | --- | --- | --- |
| AC-1 | _file:path:line refs from discovery_ | _failing test name + 1-3 line failure excerpt_ | _full-suite command + PASS summary_ | _shape change or "skipped: reason"_ | _red SHA, green SHA, refactor SHA (or "skipped")_ |

## Watched-RED proofs

\`\`\`text
_(Per AC: command run, test name, 1-3 line failure excerpt that proves RED failed for the right reason.)_
_AC-1: npm test src/lib/permissions.ts -- -t "renders email"_
_         AssertionError: expected 'anna@example.com' got undefined_
\`\`\`

## GREEN suite evidence

\`\`\`text
_(Per AC: command run, PASS/FAIL summary of the FULL relevant suite — not the single test.)_
_AC-1: npm test src/lib/__       47 passed, 0 failed (in 1.8s)_
\`\`\`

## REFACTOR notes

_(Per AC: one-line shape change applied, or explicit "skipped: <reason>". Silence is not acceptable; the gate forces the question.)_

- AC-1: extracted \`hasViewEmail\` helper from inline check.

## Fix iterations (after a review block)

_(Append one fix-iteration block per review iteration that returned \`block\`. Same TDD cycle applies; same AC id is reused; finding F-N is cited in the message.)_

### Fix iteration 1 — review block 1

| F-N | AC | phase | commit | files | note |
| --- | --- | --- | --- | --- | --- |
| F-2 | AC-1 | red | _SHA_ | _tests/...:line_ | _what the new RED encodes_ |
| F-2 | AC-1 | green | _SHA_ | _src/...:line_ | _minimal fix_ |
| F-2 | AC-1 | refactor (skipped) | — | — | _reason_ |

## Hooks invoked

- \`commit-helper.mjs --ac=AC-1 --phase=red --message="red(AC-1): …"\` → _SHA_
- \`commit-helper.mjs --ac=AC-1 --phase=green --message="green(AC-1): …"\` → _SHA_
- \`commit-helper.mjs --ac=AC-1 --phase=refactor --message="refactor(AC-1): …"\` → _SHA_ or _skipped_

## Notes

_(Surprises, deviations from the plan, tests added, refactors that came up, paths considered and discarded, etc.)_
`;

const REVIEW_TEMPLATE = `---
slug: SLUG-PLACEHOLDER
stage: review
status: active
review_iterations: 0
modes_run:
  - code
findings_block: []
---

# Review — SLUG-PLACEHOLDER

This is the review log. \`reviewer\` (and \`security-reviewer\`, when relevant) append findings here.

## Run summary

| iteration | mode | reviewer | result |
| --- | --- | --- | --- |
| 1 | code | reviewer | _pending_ |

Hard cap: 5 iterations. After the 5th, stop and surface what remains.

## Findings

_(Each finding has: id F-N, severity \`block\` / \`warn\` / \`info\`, AC ref, file:path:line, short description, proposed fix.)_

| id | severity | AC | location | finding | fix |
| --- | --- | --- | --- | --- | --- |
| F-1 | _info_ | AC-1 | _path:line_ | _description_ | _proposed change_ |

## Five Failure Modes pass

For every iteration the reviewer must explicitly answer yes/no:

- **Hallucinated actions** — any invented files, ids, env vars, function names? _no / yes (cite)_
- **Scope creep** — changes outside declared AC? _no / yes (cite)_
- **Cascading errors** — does any fix introduce new failures? _no / yes (cite)_
- **Context loss** — earlier decisions / AC text forgotten? _no / yes (cite)_
- **Tool misuse** — destructive or wrong-mode tool calls? _no / yes (cite)_

## Decision

- **block** _\u2192 slice-builder mode=fix-only addresses listed block findings, then re-review._
- **warn** _\u2192 record warnings, but ship proceeds._
- **clear** _\u2192 ready for ship._
`;

const SHIP_TEMPLATE = `---
slug: SLUG-PLACEHOLDER
stage: ship
status: active
ship_commit: null
push_approved: false
pr_url: null
---

# Ship notes — SLUG-PLACEHOLDER

This artifact is written just before \`runCompoundAndShip()\` archives the run. It must contain enough information for downstream operators to understand what shipped without opening every other artifact.

## Summary

_(2-4 lines: what changed, who needs to know.)_

## AC ↔ commit map

| AC | commit | description |
| --- | --- | --- |
| AC-1 | _sha_ | _short description_ |

This table mirrors \`plans/SLUG-PLACEHOLDER.md\` Acceptance Criteria with the final SHAs. The orchestrator refuses to run \`runCompoundAndShip()\` if any AC still shows \`status: pending\`.

## Push / PR

- push: _pending — orchestrator must explicitly ask the user before running \`git push\`._
- PR: _pending — only created if the user explicitly says "open a PR"._

When push is approved, record the upstream branch + PR URL above.

## Breaking changes / migration

_(If none, write "none". If any, link to migration notes — typically docs/migration-… or a release-notes file.)_

## Release notes (one paragraph)

_(Suitable for CHANGELOG.md. Avoid TODOs and references that won't make sense to readers without internal context.)_
`;

const DECISIONS_TEMPLATE = `---
slug: SLUG-PLACEHOLDER
stage: plan
status: active
decision_count: 0
---

# Decisions — SLUG-PLACEHOLDER

\`architect\` (and any reviewer in \`text-review\` mode) records decisions here. Each decision is independently citable.

## D-1 — _decision title_

- **Context:** _what makes this a real decision instead of a default._
- **Considered options:**
  - Option A — _summary_
  - Option B — _summary_
  - Option C — _summary_
- **Selected:** Option _X_
- **Rationale:** _why X beats A / B / C right now._
- **Rejected because:** _short reason per rejected option._
- **Consequences:** _what becomes easier; what becomes harder; what we will revisit._
- **Refs:** _file:path:line, AC-N, related external link._

> If the decision is small enough that all of the above can be written in one paragraph, do that — but still keep the D-N id, otherwise refinement and compound cannot reference it.
`;

const LEARNINGS_TEMPLATE = `---
slug: SLUG-PLACEHOLDER
stage: ship
status: active
captured_by: orchestrator
quality_gate: passed
signals:
  hasArchitectDecision: false
  reviewIterations: 0
  securityFlag: false
  userRequestedCapture: false
---

# Learnings — SLUG-PLACEHOLDER

The compound phase writes this only when at least one quality signal is present. If you are reading this in an active run, the orchestrator decided this run is worth remembering.

## What we believed at the start

_(What was the going-in assumption when \`/cc\` was invoked?)_

## What turned out to be true

_(Confirmed beliefs.)_

## What turned out to be wrong

_(Discoveries that contradicted the assumption.)_

## Decisions worth remembering

- D-N (link to decisions.md)

## Patterns we should keep

_(Reusable patterns we saw work.)_

## Anti-patterns we should avoid

_(Reusable patterns we saw fail.)_

## Follow-ups

- _(Items intentionally deferred. Each one becomes a separate \`/cc <task>\` later.)_
`;

const MANIFEST_TEMPLATE = `---
slug: SLUG-PLACEHOLDER
stage: shipped
status: shipped
ship_commit: SHIP-COMMIT-PLACEHOLDER
shipped_at: SHIPPED-AT-PLACEHOLDER
artifacts:
  - plan.md
---

# SLUG-PLACEHOLDER — shipped manifest

This file is the entry point for any future agent that wants to understand what shipped under this slug.

## Acceptance Criteria

- AC-1: _description_ (commit \`SHIP-COMMIT-PLACEHOLDER\`)

## Artifacts

- plan.md — original plan
- build.md — implementation log
- review.md — review findings
- ship.md — release notes
- decisions.md — architectural decisions (if architect was invoked)
- learnings.md — lessons captured by compound (if quality gate passed)

## Refines

_(If this run refined a previous slug, link to its shipped manifest here.)_

## Knowledge index

This slug is referenced from \`.cclaw/knowledge.jsonl\` whenever the compound quality gate captured a learning.
`;

const IDEAS_TEMPLATE = `# .cclaw/ideas.md

This file is a free-form idea backlog. Entries are appended by \`/cc-idea\` and never auto-promoted to plans. To act on an idea, invoke \`/cc <task>\` describing it.

Each entry begins with an ISO timestamp, then a single-line summary, then the body.
`;

const AGENTS_BLOCK_TEMPLATE = `<!-- cclaw-routing:start v${CCLAW_VERSION} -->

# cclaw routing

cclaw is installed in this project. This block tells your harness how to route requests.

## Slash commands

- \`/cc <task>\` — entry point. Routes the task and runs plan/build/review/ship.
- \`/cc-cancel\` — cancel the active run; artifacts move to \`.cclaw/cancelled/<slug>/\`.
- \`/cc-idea\` — append an idea to \`.cclaw/ideas.md\`. No flow is started.

## Active artifacts

- \`.cclaw/plans/<slug>.md\` — current plan with AC.
- \`.cclaw/builds/<slug>.md\` — implementation log.
- \`.cclaw/reviews/<slug>.md\` — review findings.
- \`.cclaw/ships/<slug>.md\` — release notes.
- \`.cclaw/decisions/<slug>.md\` — architectural decisions (optional).
- \`.cclaw/learnings/<slug>.md\` — captured learnings (only when quality gate passes).

## Mandatory rules

1. AC traceability is mandatory. Every commit produced inside \`/cc\` must reference exactly one \`AC-N\` id and use \`.cclaw/hooks/commit-helper.mjs\`.
2. \`git push\` and PR creation always require explicit user approval in the current turn.
3. Refuse to resume \`flow-state.json\` with \`schemaVersion: 1\` (cclaw 7.x). Surface operator choices instead.

<!-- cclaw-routing:end -->
`;

export const ARTIFACT_TEMPLATES: ArtifactTemplate[] = [
  { id: "plan", fileName: "plan.md", description: "Plan template with frontmatter, AC table, and traceability block.", body: PLAN_TEMPLATE },
  { id: "build", fileName: "build.md", description: "Build log template with commit table and hook invocation log.", body: BUILD_TEMPLATE },
  { id: "review", fileName: "review.md", description: "Review template with iteration table, findings table, and Five Failure Modes pass.", body: REVIEW_TEMPLATE },
  { id: "ship", fileName: "ship.md", description: "Ship notes template with AC↔commit map, push/PR section, release notes paragraph.", body: SHIP_TEMPLATE },
  { id: "decisions", fileName: "decisions.md", description: "Architect-style decision record template (D-N entries).", body: DECISIONS_TEMPLATE },
  { id: "learnings", fileName: "learnings.md", description: "Compound learning capture template with belief/outcome/follow-up sections.", body: LEARNINGS_TEMPLATE },
  { id: "manifest", fileName: "manifest.md", description: "Shipped manifest template; lists AC, artifacts, refines link.", body: MANIFEST_TEMPLATE },
  { id: "ideas", fileName: "ideas.md", description: "Append-only idea backlog seed.", body: IDEAS_TEMPLATE },
  { id: "agents-block", fileName: "agents-block.md", description: "AGENTS.md routing block written into harness root.", body: AGENTS_BLOCK_TEMPLATE }
];

export function templateBody(id: ArtifactTemplate["id"], replacements: Record<string, string> = {}): string {
  const template = ARTIFACT_TEMPLATES.find((entry) => entry.id === id);
  if (!template) throw new Error(`Unknown artifact template: ${id}`);
  let body = template.body;
  for (const [key, value] of Object.entries(replacements)) {
    body = body.split(key).join(value);
  }
  return body;
}

export function planTemplateForSlug(slug: string): string {
  return templateBody("plan", { "SLUG-PLACEHOLDER": slug });
}

export function manifestTemplate(slug: string, shipCommit: string, shippedAt: string): string {
  return templateBody("manifest", {
    "SLUG-PLACEHOLDER": slug,
    "SHIP-COMMIT-PLACEHOLDER": shipCommit,
    "SHIPPED-AT-PLACEHOLDER": shippedAt
  });
}
