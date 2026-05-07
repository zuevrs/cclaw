export interface ExampleArtifact {
  id: string;
  fileName: string;
  title: string;
  description: string;
  body: string;
}

const PLAN_SMALL = `---
slug: approval-pill
stage: plan
status: active
ac:
  - id: AC-1
    text: "Approval status pill renders pending/approved/rejected on the dashboard tile."
    status: pending
  - id: AC-2
    text: "Pill shows a tooltip with approver name and request age when status != pending."
    status: pending
last_specialist: planner
refines: null
shipped_at: null
ship_commit: null
review_iterations: 0
security_flag: false
---

# approval-pill

Add a status pill on the dashboard's request card so users can spot the approval lifecycle at a glance instead of opening the request modal.

## Context

The dashboard currently lists pending and approved requests in two flat tables. Customer support has been pasting the request id into the modal to read the approver — that workflow is slow. We can keep the existing tables but add a single 56×24 pill that encodes the same information visually.

## Frame

- Already true: \`Request\` model has \`status\`, \`approverId\`, \`requestedAt\`. \`User\` model has \`displayName\`.
- Not sure: whether designers want the pill to animate on status change. We default to no animation.
- Out of scope: the modal itself; approver workflows; mobile layout.

## Scope

- **In scope:** \`src/components/dashboard/RequestCard.tsx\`, \`src/components/dashboard/StatusPill.tsx\` (new), \`src/components/dashboard/StatusPill.test.tsx\` (new), \`src/styles/tokens.css\` (3 colour tokens).
- **Out of scope:** \`src/components/dashboard/RequestModal.tsx\`, mobile breakpoints, dark mode.

## Plan

- Phase 1 — Foundation
  - Add \`StatusPill\` component with three variants (\`pending\`, \`approved\`, \`rejected\`) — \`src/components/dashboard/StatusPill.tsx\`.
  - Add the three colour tokens — \`src/styles/tokens.css:42\`.
- Phase 2 — Wiring
  - Render \`StatusPill\` inside \`RequestCard\` — \`src/components/dashboard/RequestCard.tsx:88\`.
  - Surface the tooltip with approver name + relative time — \`src/components/dashboard/RequestCard.tsx:90\`.

## Acceptance Criteria

| id | text | status | commit |
| --- | --- | --- | --- |
| AC-1 | Approval status pill renders pending/approved/rejected on the dashboard tile. | pending | — |
| AC-2 | Pill shows a tooltip with approver name and request age when status != pending. | pending | — |

## Topology

- topology: inline
- parallel slices: none

## Traceability block

- AC-1 → commit pending
- AC-2 → commit pending
`;

const PLAN_LARGE_REFINEMENT = `---
slug: approval-pill-tooltips
stage: plan
status: active
ac:
  - id: AC-1
    text: "Tooltip shows the approver's email when the user has \`view-email\` permission."
    status: pending
  - id: AC-2
    text: "Tooltip respects the existing 250 ms hover delay tokens."
    status: pending
  - id: AC-3
    text: "Tooltip falls back to display name when permission is missing."
    status: pending
last_specialist: architect
refines: approval-pill
shipped_at: null
ship_commit: null
review_iterations: 0
security_flag: true
---

# approval-pill-tooltips

Refine the previously shipped \`approval-pill\` slug so the tooltip can include the approver's email for users with the \`view-email\` permission. The original slug intentionally stopped at display name.

## Context

\`approval-pill\` shipped on 2026-04-18 with display name only. Compliance now wants email visibility for SOC2 auditors, but we cannot show it to all users. We need a permission-gated path without rewriting the pill.

## Frame

- Already true: \`view-email\` permission exists on the IAM side; \`useCurrentUser\` already hydrates permission claims.
- Not sure: whether permissions should be re-checked on render or read from the cached claim. We default to cached, with a 60 s TTL.
- Out of scope: changing the IAM model; backfilling permissions; admin UI for granting the permission.

## Scope

- **In scope:** tooltip text in \`src/components/dashboard/RequestCard.tsx:90\`, new helper \`src/lib/permissions.ts\` (or extension), test fixture for permission off.
- **Out of scope:** dashboard tables; modal; everything outside the pill.

## Architecture

Selected option B (read-from-cached-claim) per \`decisions/approval-pill-tooltips.md#D-1\`. Cached claim path is consistent with how \`view-billing\` works elsewhere; re-checking on render adds 8 ms p99 to the dashboard render budget.

## Plan

- Phase 1 — Permission check helper
  - \`hasViewEmail(user)\` in \`src/lib/permissions.ts\`.
- Phase 2 — Tooltip wiring
  - Branch on \`hasViewEmail\` in \`src/components/dashboard/RequestCard.tsx:90\`.
- Phase 3 — Tests
  - Add fixtures for permission on and off.
  - Smoke-test that the tooltip text differs.

## Acceptance Criteria

| id | text | status | commit |
| --- | --- | --- | --- |
| AC-1 | Tooltip shows the approver's email when the user has view-email permission. | pending | — |
| AC-2 | Tooltip respects the existing 250 ms hover delay tokens. | pending | — |
| AC-3 | Tooltip falls back to display name when permission is missing. | pending | — |

## Topology

- topology: inline
- parallel slices: none

## Traceability block

- AC-1 → commit pending
- AC-2 → commit pending
- AC-3 → commit pending
`;

const PLAN_PARALLEL_BUILD = `---
slug: search-overhaul
stage: plan
status: active
ac:
  - id: AC-1
    text: "Search index includes ticket comments alongside titles."
    status: pending
  - id: AC-2
    text: "Search ranking uses BM25 instead of plain TF."
    status: pending
  - id: AC-3
    text: "Search UI surfaces a \\"comments matched\\" badge."
    status: pending
  - id: AC-4
    text: "Search API returns matched-comments fixture in integration tests."
    status: pending
last_specialist: planner
refines: null
shipped_at: null
ship_commit: null
review_iterations: 0
security_flag: false
---

# search-overhaul

## Topology

- topology: parallel-build
- parallel slices:
  - AC-1, AC-2 → slice-builder #1 (backend) — owners: \`src/server/search/*\`, \`src/server/db/migrations/2026-05-07-bm25.sql\`
  - AC-3 → slice-builder #2 (frontend) — owner: \`src/client/search/Hits.tsx\`
  - AC-4 → slice-builder #3 (integration tests) — owner: \`tests/integration/search.spec.ts\`
- integration reviewer: \`reviewer #integration\` after the wave finishes.

(File set per slice is disjoint; AC-3 does not depend on AC-1/AC-2 because the badge is purely presentational and can use a feature flag for the first review pass.)

## Plan

(See per-slice owner files; do not merge them into one log. The integration reviewer reconstructs the picture from \`builds/search-overhaul.md\` after the wave.)

## Acceptance Criteria

| id | text | status | commit |
| --- | --- | --- | --- |
| AC-1 | Search index includes ticket comments alongside titles. | pending | — |
| AC-2 | Search ranking uses BM25 instead of plain TF. | pending | — |
| AC-3 | Search UI surfaces a "comments matched" badge. | pending | — |
| AC-4 | Search API returns matched-comments fixture in integration tests. | pending | — |

## Traceability block

- AC-1 → commit pending
- AC-2 → commit pending
- AC-3 → commit pending
- AC-4 → commit pending
`;

const BUILD_LOG = `---
slug: approval-pill
stage: build
status: active
build_iterations: 2
last_commit: 9e2c3a4
---

# Build log — approval-pill

## Plan summary

Two AC: pill component + tooltip with approver name. Inline topology, single slice-builder.

## Commits

| AC | commit | files | note |
| --- | --- | --- | --- |
| AC-1 | a1b2c3d | \`src/components/dashboard/StatusPill.tsx:1-58\`, \`src/components/dashboard/StatusPill.test.tsx:1-44\`, \`src/styles/tokens.css:42-44\` | Three variants, snapshot test for each. |
| AC-2 | 9e2c3a4 | \`src/components/dashboard/RequestCard.tsx:88-104\`, \`src/components/dashboard/RequestCard.test.tsx:51-72\` | Wires \`StatusPill\` + tooltip. Uses existing \`<Tooltip>\` from \`src/components/Tooltip.tsx\`. |

## Open work

_(none — both AC are committed.)_

## Hooks invoked

- \`commit-helper.mjs --ac=AC-1 --message="Add StatusPill component with three variants"\` → \`a1b2c3d\`
- \`commit-helper.mjs --ac=AC-2 --message="Wire StatusPill + tooltip into RequestCard"\` → \`9e2c3a4\`

## Notes

- \`<Tooltip>\` component already supports a \`delay\` prop; reused the 250 ms token from \`src/styles/tokens.css\` instead of hardcoding.
- Snapshot tests use \`@testing-library/react\` v15 \`render\` API; same as adjacent tests, no test-config changes needed.
`;

const REVIEW_LOG = `---
slug: approval-pill
stage: review
status: active
review_iterations: 2
modes_run:
  - code
  - text-review
findings_block:
  - F-1
  - F-2
---

# Review — approval-pill

## Run summary

| iteration | mode | reviewer | result |
| --- | --- | --- | --- |
| 1 | code | reviewer | block |
| 2 | code | reviewer | clear |

## Findings

| id | severity | AC | location | finding | fix |
| --- | --- | --- | --- | --- | --- |
| F-1 | block | AC-1 | \`src/components/dashboard/StatusPill.tsx:23\` | The \`rejected\` variant uses the same red token as warning banners; designers want a separate "muted red" token. | Add \`--color-status-rejected\` to \`src/styles/tokens.css\` and reference it. |
| F-2 | warn | AC-2 | \`src/components/dashboard/RequestCard.tsx:97\` | Tooltip text uses absolute timestamps; product asked for relative ("2 hours ago"). | Replace with \`formatRelativeTime\` from \`src/lib/time.ts\`. |

## Five Failure Modes pass

Iteration 1:

- Hallucinated actions: no.
- Scope creep: no.
- Cascading errors: no.
- Context loss: no — all decisions on display name still hold.
- Tool misuse: no.

Iteration 2: same answers, all "no".

## Decision

- Iteration 1: **block** — slice-builder mode=fix-only on F-1 and F-2.
- Iteration 2: **clear** — both findings resolved; ready for ship.
`;

const SHIP_NOTES = `---
slug: approval-pill
stage: ship
status: active
ship_commit: 9e2c3a4
push_approved: true
pr_url: https://github.com/example/web/pull/2317
---

# Ship notes — approval-pill

## Summary

Adds a colour-coded approval status pill to dashboard request cards plus a tooltip exposing the approver's display name and the request age. No backend or schema changes.

## AC ↔ commit map

| AC | commit | description |
| --- | --- | --- |
| AC-1 | \`a1b2c3d\` | StatusPill component with three variants (pending / approved / rejected). |
| AC-2 | \`9e2c3a4\` | RequestCard wires StatusPill and tooltip. |

## Push / PR

- push: approved by user on 2026-04-18T14:21Z.
- PR: https://github.com/example/web/pull/2317.

## Breaking changes / migration

None. Public component API unchanged.

## Release notes

> Dashboard request cards now display a colour-coded approval status pill with a tooltip showing the approver and the request age. No configuration changes required.
`;

const DECISION_RECORD = `---
slug: approval-pill-tooltips
stage: plan
status: active
decision_count: 1
---

# Decisions — approval-pill-tooltips

## D-1 — Permission check is read-from-cached-claim, not re-checked on render

- **Context:** the tooltip needs to gate email visibility on the \`view-email\` permission. We can either (A) re-check the permission on every render via a synchronous IAM call, (B) read from the already-cached user claim with a 60 s TTL, or (C) push permission into a render-time React context.
- **Considered options:**
  - Option A — re-check on render. Pros: always fresh. Cons: adds 8 ms p99 to dashboard render budget; couples the dashboard to IAM uptime.
  - Option B — cached claim, 60 s TTL. Pros: zero extra latency on render; same path used by \`view-billing\`. Cons: stale for up to 60 s after permission revoke.
  - Option C — render-time React context. Pros: makes permission explicit at the call site. Cons: another context provider; redundant with the cached claim path.
- **Selected:** Option B.
- **Rationale:** consistent with \`view-billing\` (\`src/lib/permissions.ts:14\`); 60 s TTL is acceptable per the threat model since permission changes already pin a fresh login on next nav; render budget is non-negotiable for the dashboard.
- **Rejected because:** A — render budget impact unacceptable; C — redundant.
- **Consequences:** any future permission gate on the dashboard is expected to follow the same pattern. \`view-billing\` and \`view-email\` should be tested together to keep the path single-purpose.
- **Refs:** \`src/lib/permissions.ts:14\`, AC-1, AC-3, threat model entry from security-reviewer iteration 1.
`;

const LEARNING_RECORD = `---
slug: approval-pill-tooltips
stage: ship
status: active
captured_by: orchestrator
quality_gate: passed
signals:
  hasArchitectDecision: true
  reviewIterations: 2
  securityFlag: true
  userRequestedCapture: false
---

# Learnings — approval-pill-tooltips

## What we believed at the start

The simple thing is to call IAM on render whenever the dashboard wants to know whether to show email. That assumption was the original brainstormer frame.

## What turned out to be true

- \`useCurrentUser\` already caches permission claims. We did not need a new mechanism.
- Designers' "muted red" complaint from the original \`approval-pill\` slug was still relevant for new pill variants; we should add it to the design tokens skill.

## What turned out to be wrong

- The render budget is much tighter than expected — 8 ms is not free in this code path. The architect's feasibility check caught this.

## Decisions worth remembering

- D-1 (cached claim with 60 s TTL).

## Patterns we should keep

- Permission gates at render should reuse \`useCurrentUser\` claim caching unless the threat model says otherwise.
- Refinement slugs that touch sensitive data should set \`security_flag: true\` even when the diff feels small.

## Anti-patterns we should avoid

- Re-checking permissions on render in a tight UI path without measuring the budget first.

## Follow-ups

- Document the 60 s TTL contract on \`useCurrentUser\` in \`src/lib/auth.ts\` (one-line JSDoc).
- Consider an \`assertPermission\` helper for non-render paths so the rules are obvious.
`;

const KNOWLEDGE_LINE = `\`\`\`json
{"slug":"approval-pill-tooltips","ship_commit":"deadbee","shipped_at":"2026-04-22T11:14:00Z","signals":{"hasArchitectDecision":true,"reviewIterations":2,"securityFlag":true,"userRequestedCapture":false},"refines":"approval-pill","notes":"Cached claim path reused for permission gates."}
\`\`\``;

const COMMIT_HELPER_SESSION = `\`\`\`bash
$ git status --short
 M src/components/dashboard/StatusPill.tsx
 M src/components/dashboard/StatusPill.test.tsx
 M src/styles/tokens.css

$ git add src/components/dashboard/StatusPill.tsx \\
          src/components/dashboard/StatusPill.test.tsx \\
          src/styles/tokens.css

$ node .cclaw/hooks/commit-helper.mjs --ac=AC-1 \\
       --message="Add StatusPill component with three variants"

[commit-helper] AC-1 committed as a1b2c3d
\`\`\``;

const REFINEMENT_DETECTION_PROMPT = `\`\`\`
/cc Add an email-aware tooltip on the approval pill for compliance auditors.

[orchestrator] Existing-plan detection found:
  - shipped: approval-pill (last_specialist=planner, ac 2/2 committed,
    security_flag=false). https://.cclaw/shipped/approval-pill/manifest.md
  - active:  none

  Pick one:
    (1) refine shipped approval-pill (creates a new slug with
        refines: approval-pill);
    (2) start a new unrelated plan;
    (3) cancel and rephrase.

> 1
\`\`\``;

const PARALLEL_BUILD_DISPATCH = `\`\`\`
[orchestrator] planner topology=parallel-build with 4 AC across 3 slices.
  Pre-conditions: 4 AC, disjoint files, no AC depends on another in this wave.

  Slice #1: backend (AC-1, AC-2)  — slice-builder
  Slice #2: frontend (AC-3)       — slice-builder
  Slice #3: tests (AC-4)          — slice-builder

  After all slices finish: reviewer mode=integration.

  Confirm? (y / change topology / stop)

> y
\`\`\``;

const REVIEW_CAP_REACHED = `\`\`\`
[orchestrator] reviewer mode=code reached iteration 5 with 2 outstanding
  block-level findings:
    - F-3 (AC-2): tooltip text leaks email into the analytics event.
    - F-7 (AC-3): fallback path throws when displayName is null.

  cap-reached. Recommendation: /cc-cancel and re-plan F-3 + F-7 as a
  fresh slug with stricter scope, OR fold F-3 into a security-flagged
  amendment of the current slug.

> /cc-cancel reason="re-plan with tighter scope"
\`\`\``;

export const EXAMPLES: ExampleArtifact[] = [
  { id: "plan-small", fileName: "plan-small.md", title: "Plan — small slug", description: "Two AC, inline topology, no specialists invoked.", body: PLAN_SMALL },
  { id: "plan-refinement", fileName: "plan-refinement.md", title: "Plan — refinement of a shipped slug", description: "refines pointer + security_flag + architect decision link.", body: PLAN_LARGE_REFINEMENT },
  { id: "plan-parallel-build", fileName: "plan-parallel-build.md", title: "Plan — parallel-build topology", description: "Four AC across three slice owners + integration reviewer.", body: PLAN_PARALLEL_BUILD },
  { id: "build-log", fileName: "build-log.md", title: "Build log — two AC committed", description: "Commit table with file:line refs and hook invocations.", body: BUILD_LOG },
  { id: "review-log", fileName: "review-log.md", title: "Review — two iterations to clear", description: "Iteration table, findings, Five Failure Modes pass.", body: REVIEW_LOG },
  { id: "ship-notes", fileName: "ship-notes.md", title: "Ship notes — approved push + PR", description: "Summary, AC↔commit map, push/PR, release notes.", body: SHIP_NOTES },
  { id: "decision-record", fileName: "decision-record.md", title: "Decision — D-1 record", description: "Considered options, selection, rationale, consequences, refs.", body: DECISION_RECORD },
  { id: "learning-record", fileName: "learning-record.md", title: "Learnings — gated capture", description: "Belief / outcomes / patterns / antipatterns / follow-ups.", body: LEARNING_RECORD },
  { id: "knowledge-line", fileName: "knowledge-line.md", title: "knowledge.jsonl — single line", description: "Shape of one ndjson entry with refines pointer.", body: `# knowledge.jsonl entry\n\n${KNOWLEDGE_LINE}\n` },
  { id: "commit-helper-session", fileName: "commit-helper-session.md", title: "Commit-helper session", description: "Shell transcript for one AC commit via the hook.", body: `# commit-helper.mjs session\n\n${COMMIT_HELPER_SESSION}\n` },
  { id: "refinement-detection", fileName: "refinement-detection.md", title: "Existing-plan detection prompt", description: "Sample orchestrator prompt with shipped match and user choice.", body: `# /cc existing-plan detection\n\n${REFINEMENT_DETECTION_PROMPT}\n` },
  { id: "parallel-build-dispatch", fileName: "parallel-build-dispatch.md", title: "Parallel-build dispatch prompt", description: "Sample orchestrator prompt before dispatching slices.", body: `# /cc parallel-build dispatch\n\n${PARALLEL_BUILD_DISPATCH}\n` },
  { id: "review-cap-reached", fileName: "review-cap-reached.md", title: "Review hard-cap example", description: "Iteration 5 cap-reached with /cc-cancel recommendation.", body: `# review-loop cap-reached\n\n${REVIEW_CAP_REACHED}\n` }
];

export const EXAMPLES_INDEX = `# .cclaw/examples/

Worked artifacts the orchestrator and specialists can study before producing their own. Each file is a real-looking plan / build / review / ship / decision / learning artifact, plus a few orchestrator-prompt transcripts.

| file | what it shows |
| --- | --- |
${EXAMPLES.map((e) => `| \`${e.fileName}\` | ${e.description} |`).join("\n")}
`;
