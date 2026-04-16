import type { FlowStage } from "../types.js";

const STAGE_EXAMPLES: Record<FlowStage, string> = {
  brainstorm: `## Context

- **Project state:** Monorepo with CI pipeline using custom release scripts. Release checks are scattered across shell scripts with no shared validation logic.
- **Relevant existing code/patterns:** \`scripts/pre-publish.sh\` does metadata checks. \`src/release/\` has partial validation helpers.

## Problem

- **What we're solving:** release checks are fragile and inconsistent between CI and local runs. Invalid metadata sometimes reaches npm publish.
- **Success criteria:** invalid release preconditions are caught before publish with explicit operator feedback, in both CI and local workflows.
- **Constraints:** no new runtime dependencies; must work within existing CI pipeline structure.

## Clarifying Questions

| # | Question | Answer | Decision impact |
| --- | --- | --- | --- |
| 1 | If release metadata is invalid, should we block publishing hard or only warn? | Block hard. | Validation becomes a mandatory gate — no warning-only fallback. |
| 2 | Should the validation logic live in a reusable module or stay as shell scripts? | Reusable module. | Architecture: shared TypeScript module imported by CI and local tooling, not duplicated shell scripts. |
| 3 | For v1, prioritize rapid delivery or maximum configurability? | Rapid delivery. | Minimal deterministic validation surface; defer plugin/config system to v2. |

## Approaches

| Approach | Architecture | Trade-offs | Recommendation |
| --- | --- | --- | --- |
| A: Reusable validation module | Shared TS module with typed validators, imported by CI scripts and local CLI. Existing \`pre-publish.sh\` calls the module. | Medium upfront effort, high reuse. Requires test coverage for the module. | **Recommended** — best balance of reuse and delivery speed. |
| B: Hardened shell scripts | Keep existing script approach, add stricter checks and error messages. | Lowest effort. Weak reuse, CI/local divergence risk grows over time. | Viable fallback if TS module is blocked. |
| C: Full release framework | New release orchestrator with plugin system, config files, rollback commands. | Maximum flexibility. High risk, delivery delay, over-engineered for current needs. | Not recommended for v1. |

## Selected Direction

- **Approach:** A — Reusable validation module
- **Rationale:** shared TS module gives consistent behavior in CI and local, avoids script duplication, and stays within the no-new-dependency constraint.
- **Approval:** approved

## Design

- **Architecture:** single \`release-validator\` module in \`src/release/\` exporting typed check functions. CI script and local CLI both import and run the same checks.
- **Key components:** \`validateMetadata()\`, \`validateChangelog()\`, \`validateVersion()\` — each returns a typed result with error details. A \`runAll()\` orchestrator runs checks and exits non-zero on any failure.
- **Data flow:** package.json + CHANGELOG.md → validator module → structured result → CI/CLI renders human-readable report.

## Assumptions and Open Questions

- **Assumptions:** CI remains the primary execution path; existing release metadata files remain the source of truth; v1 prioritizes determinism over customization.
- **Open questions:** What exact rollback sequence for failed publish? Should status output include machine-readable JSON alongside markdown?

## Notes for the next stage

Carry the no-new-dependency constraint and hard-block behavior directly into scope in/out boundaries.`,

  scope: `## Scope contract

**Mode selected:** SELECTIVE EXPANSION
**Default heuristic used:** feature enhancement -> selective
**Mode-specific analysis result:** hold-scope baseline accepted first; one expansion accepted (degraded-state UX), one deferred (real-time channel upgrade).

## Prime Directives (applied)

- Zero silent failures: every delivery failure maps to a visible degraded state.
- Named error surfaces: stream disconnect, auth drift, and publisher timeout are explicit.
- Four-path data flow mapped: happy, nil payload, empty payload, upstream publish error.
- Interaction edge cases in scope: double-open panel, reconnect after sleep, stale tab state.
- Observability in scope: stream error counter, publish-to-visible lag metric, and alert threshold.

## Premise challenge result

The original premise (“add notifications”) was reframed to **“ensure users know when an action requires follow-up”**, which expands the solution space beyond toast spam to include durable inbox items, empty states, and recovery paths when delivery fails.

## Dream State Mapping

| Stage | Statement |
| --- | --- |
| **CURRENT STATE** | Users miss time-sensitive follow-ups because alerts are ephemeral and not recoverable. |
| **THIS PLAN** | Introduce durable in-app feed + live updates + explicit degraded mode fallback. |
| **12-MONTH IDEAL** | Unified notification center with reliable multi-channel fan-out and user-level routing preferences. |
| **Alignment verdict** | Aligned: this scope builds the durability foundation without prematurely committing to channel expansion. |

## Mode-Specific Analysis

**Selected mode:** SELECTIVE EXPANSION

- **Hold-scope baseline:** SSE live updates + REST fallback is the minimum that meets the "know when action is needed" reframe. Accepted as baseline.
- **Expansion evaluated — degraded-state UX (accepted):** Adding an explicit "live updates paused" banner and polling fallback turns a reliability gap into a visible, recoverable state. Low incremental effort (S), high user trust payoff.
- **Expansion evaluated — real-time channel upgrade (deferred):** WebSocket channel provides lower latency but requires new infra (connection pool, auth handshake). Not justified for current load; deferred to post-v1 validation.

## Implementation Alternatives

| Option | Summary | Effort (S/M/L/XL) | Risk | Pros | Cons | Reuses |
| --- | --- | --- | --- | --- | --- | --- |
| **A (minimum viable)** | Polling-only feed with no live stream | S | Low | Fastest ship, low infra risk | Weaker UX, delayed visibility | Existing REST snapshot endpoint |
| **B (recommended)** | SSE live updates + REST fallback snapshot | M | Med | Better timeliness, graceful degradation | Requires reconnect handling | Existing event publisher + REST path |
| **C (ideal architecture)** | Event bus + WebSocket channel + feed projection | XL | High | Strong long-term scalability | Overbuilt for current demand | Partial reuse of publisher only |

## Temporal Interrogation

| Time slice | Likely decision pressure | Lock now or defer? | Reason |
| --- | --- | --- | --- |
| **HOUR 1 (foundations)** | Canonical event schema and dedupe key policy | **Lock now** | Prevent downstream rework in storage and UI merge behavior |
| **HOUR 2-3 (core logic)** | Retry/backoff semantics for stream loss | **Lock now** | Impacts both backend signaling and client state machine |
| **HOUR 4-5 (integration)** | Handling gaps between snapshot and stream cursor | **Lock now** | Prevent silent data loss during reconnect windows |
| **HOUR 6+ (polish/tests)** | Banner copy tone and polling cadence tuning | **Defer** | Safe to iterate after baseline reliability is proven |

## In scope / out of scope / deferred

| Category | Items |
| --- | --- |
| **In scope** | In-app notification feed; SSE delivery path; read/unread state; basic retry on transient failures |
| **Out of scope** | Email/SMS/push providers; marketing campaigns; per-user notification preferences beyond on/off |
| **Deferred** | WebSocket channel; rich media attachments in notifications; full-text search across historical events |

## Discretion Areas

- Client-side badge rendering strategy (optimistic vs server-confirmed) is implementation discretion.
- Polling fallback backoff curve is implementation discretion if degraded-state UX remains explicit.

## Error & Rescue Registry (sample entry)

| Capability | Failure mode | Detection | Fallback |
| --- | --- | --- | --- |
| Event delivery | SSE connection drops mid-session | Client \`EventSource\` error event + heartbeat timeout | Fall back to REST polling every 30s until SSE reconnect succeeds; show subtle “live updates paused” banner |

## Completion Dashboard

- Checklist findings: 9/9 complete (complex path)
- Resolved decisions count: 7
- Unresolved decisions: None

## Scope Summary

- Accepted scope: durable feed + SSE + explicit degraded UX.
- Deferred: WebSocket channel and rich-media/search enhancements.
- Explicitly excluded: outbound channels and marketing workflows for v1.`,

  design: `## Codebase Investigation (blast-radius files)

| File | Current responsibility | Patterns discovered |
| --- | --- | --- |
| \`src/api/routes/user.ts\` | User CRUD endpoints | Express router, Zod validation, throws \`AppError\` |
| \`src/services/event-bus.ts\` | In-process pub/sub | EventEmitter wrapper, typed channels, no persistence |
| \`src/middleware/auth.ts\` | JWT verification | Extracts user from token, attaches to \`req.context\` |
| \`tests/integration/user.test.ts\` | User route tests | Supertest, factory helpers, \`beforeEach\` DB reset |

Discovery: existing EventEmitter-based bus has no durability — notifications must add persistence layer on top, not replace the bus.

## Search Before Building (sample result)

| Layer | Label | What to reuse first |
| --- | --- | --- |
| Layer 1 | stdlib | Built-in timers, structured logging patterns, standard error types |
| Layer 2 | existing codebase | Existing auth middleware, existing API client wrapper, existing feature flags helper |
| Layer 3 | npm | A small, well-maintained SSE helper (only if Layer 1–2 cannot cover framing/reconnect ergonomics) |

## Architecture Diagram (mandatory)

\`\`\`
┌─────────────┐      ┌──────────────┐      ┌────────────────┐
│ API Gateway │─────▶│ Notification │─────▶│ Event Publisher│
└─────────────┘      │ Service      │      └────────┬───────┘
                     └──────┬───────┘               │
                            │                       ▼
                     ┌──────▼───────┐      ┌────────────────┐
                     │ Read Model   │◀─────│ Outbox / Queue │
                     │ (Feed Store) │      └────────────────┘
                     └──────────────┘
\`\`\`

Data flow: Gateway → Service (validate + enrich) → Publisher (fan-out) → Queue (persist) → Read Model (project).

## What Already Exists

| Sub-problem | Existing code/library | Layer | Reuse decision |
| --- | --- | --- | --- |
| Auth context extraction | \`src/middleware/auth.ts\` | Layer 1 | Reuse as-is |
| Event fan-out | \`src/services/event-bus.ts\` | Layer 2 | Wrap with persistence adapter |
| SSE framing | None | Layer 3 | Evaluate \`better-sse\` npm package |
| Notification schema | None | — | New: define in \`src/schemas/notification.ts\` |

## Failure Mode Table

| Failure | Trigger | Detection | Mitigation | User impact |
| --- | --- | --- | --- | --- |
| SSE connection drop | Network interruption | Client heartbeat timeout (30s) | Auto-reconnect with exponential backoff + snapshot fallback | Brief delay (≤10s), no data loss |
| Duplicate publish | Retry after timeout | Dedupe key check in outbox | Upsert with idempotency key | None (transparent) |
| Queue backpressure | Spike >1000 events/s | Queue depth metric alarm | Back-pressure signal to publisher, shed non-critical events | Delayed delivery of low-priority notifications |

## Test Strategy

- **Unit:** validator functions, dedupe-key logic, event schema factories — target 90%+ line coverage.
- **Integration:** publisher → outbox → read-model pipeline via in-memory DB; SSE reconnect with simulated drops.
- **E2E:** one happy-path browser test (publish → feed visible) and one degraded-path test (SSE down → REST fallback + banner).

## Performance Budget

| Critical path | Metric | Target | Measurement method |
| --- | --- | --- | --- |
| Publish → visible in feed | p95 latency | ≤ 5 s | Integration test with deterministic clock + production Datadog SLO |
| Feed snapshot load | p99 response time | ≤ 200 ms | Load test with 1 000 items per user |
| SSE reconnect | Time to first event after drop | ≤ 3 s | Simulated disconnect in integration suite |

## NOT in scope

- Outbound channels (email, push, SMS) — deferred to v2.
- Admin notification management UI — separate workstream.
- Notification preferences / mute rules — requires user settings redesign.

## Parallelization Strategy

| Module | Depends on | Parallel lane | Conflict risk |
| --- | --- | --- | --- |
| Notification schema (T1) | — | Lane A | None |
| Publisher + outbox (T2) | T1 | Lane A | None |
| Client feed + SSE (T3) | T1, T2 | Lane B (after T1) | Shared event type definitions |

## Unresolved Decisions

| Decision | Status | Options | Missing info | Default if unanswered |
| --- | --- | --- | --- | --- |
| Feed storage model | OPEN | (A) append-only event log, (B) mutable rows, (C) hybrid | Load testing results on read patterns | (A) append-only — safest for audit trail |

## Interface sketch (non-binding)

- **Client → server:** \`GET /api/me/notifications/snapshot?limit=50\` plus optional cursor parameters (if adopted).
- **Server → client:** \`GET /api/me/notifications/stream\` as SSE with periodic heartbeats.

## Completion Dashboard

| Review Section | Status | Issues |
| --- | --- | --- |
| Architecture Review | issues-found-resolved | Decided on outbox pattern over direct pub/sub |
| Code Quality Review | clear | — |
| Test Review | issues-found-resolved | Added integration test gap for SSE reconnect |
| Performance Review | clear | — |
| Distribution & Delivery Review | clear | — |

**Decisions made:** 4 | **Unresolved:** 1 (feed storage model)

## Quality bar for this stage

Design output should be **reviewable by someone who did not attend brainstorming**: they can trace from constraints → components → open decisions without reading code.`,

    spec: `## Acceptance Criteria

| ID | Criterion (observable/measurable/falsifiable) | Design Decision Ref |
| --- | --- | --- |
| AC-1 | Given a signed-in user with an active session, when the server publishes a new notification event for that user, the client feed shows the new item within 5 seconds without a full page reload. | Architecture: SSE delivery path |
| AC-2 | Given the same logical notification is published twice with the same dedupe key, when the client processes the stream, the feed contains exactly one visible item for that key. | Architecture: dedupe-key in event schema |
| AC-3 | Given the live connection is unavailable, when the user opens the notifications panel, the UI shows a non-blocking "live updates paused" banner and loads the latest snapshot via REST within 2 seconds. | Architecture: REST fallback + degraded UX |

## Edge Cases

| Criterion ID | Boundary case | Error case |
| --- | --- | --- |
| AC-1 | Notification published during client reconnect window (boundary: \u2264 5 s delivery still holds after reconnect). | Server publish fails mid-write — client never receives event; REST snapshot fills gap. |
| AC-2 | Two events with identical dedupe key arrive within same SSE frame (boundary: only one row rendered). | Dedupe-key field missing — reject event at publisher and log error. |
| AC-3 | SSE disconnects after exactly 30 s heartbeat timeout (boundary: banner appears within 1 s of timeout). | REST snapshot endpoint returns 500 — panel shows "unable to load" with retry button. |

## Constraints and Assumptions

- **Constraints:** Max feed size 1 000 items per user. SSE heartbeat interval 30 s (server-side). REST snapshot p99 \u2264 200 ms. No new runtime dependencies.
- **Assumptions:** Users have a single active session at a time for v1. Existing auth middleware provides user context. Event publisher is single-writer per user.

## Testability Map

| Criterion ID | Verification approach | Command/manual steps |
| --- | --- | --- |
| AC-1 | Integration test: publish event \u2192 assert feed contains item within 5 s (deterministic clock). | \`pnpm vitest run tests/integration/notification-delivery.test.ts\` |
| AC-2 | Unit test: publish same dedupe key twice \u2192 assert single row in feed store. | \`pnpm vitest run tests/unit/dedupe-feed.test.ts\` |
| AC-3 | E2E test: kill SSE transport \u2192 assert banner visible + REST snapshot loads. | \`pnpm playwright test tests/e2e/degraded-mode.spec.ts\` |

## Approval

- Approved by: user
- Date: 2026-04-14`,

  plan: `## Dependency Graph

\`\`\`
T-1 ──▶ T-2 ──▶ T-3
 │               ▲
 └───────────────┘
\`\`\`

Parallel opportunity: T-1 is a prerequisite for both T-2 and T-3 (T-3 also needs T-2).

## Dependency Waves

#### Wave 1 (foundation)
- Task IDs: T-1
- Verification gate: schema tests pass, dedupe key fixtures validated

#### Wave 2 (core logic)
- Task IDs: T-2
- Depends on: Wave 1 (T-1 complete)
- Verification gate: integration test proves publish-to-outbox path

#### Wave 3 (integration)
- Task IDs: T-3
- Depends on: Wave 2 (T-2 complete)
- Verification gate: e2e tests pass for delivery, dedupe, and degraded mode

Execution rule: complete and verify each wave before starting the next wave.

## Task List

| Task ID | Description | Acceptance criterion | Verification command | Effort |
| --- | --- | --- | --- | --- |
| T-1 | Define notification event schema + dedupe key rules | AC-1, AC-2: schema contract + fixtures | \`\`\`pnpm vitest run tests/unit/notification-schema.test.ts\`\`\` |
| T-2 | Implement publisher + outbox write path | AC-1: integration test (happy path publish) | \`\`\`pnpm vitest run tests/integration/publisher.test.ts\`\`\` |
| T-3 | Implement client feed + SSE subscribe + REST fallback | AC-1, AC-2, AC-3: e2e tests including degraded mode | \`\`\`pnpm playwright test tests/e2e/notification-feed.spec.ts\`\`\` |

## Acceptance Mapping

| Criterion ID | Task IDs |
| --- | --- |
| AC-1 (delivery within 5s) | T-2, T-3 |
| AC-2 (idempotency) | T-1, T-2 |
| AC-3 (failure visibility) | T-3 |

## Risk Assessment

| Task/Wave | Risk | Likelihood | Impact | Mitigation |
| --- | --- | --- | --- | --- |
| T-3 (Wave 3) | SSE reconnect logic complex | Medium | High | Spike reconnect in isolation before integrating with feed UI |
| Wave 2 → 3 | Publisher API contract may shift | Low | Medium | Pin contract in T-1 schema; T-2 integration test validates |

## WAIT_FOR_CONFIRM
- Status: pending
- Confirmed by:`,

  tdd: `## RED Evidence

| Slice | Test name | Command | Failure output summary |
| --- | --- | --- | --- |
| S-1 (event schema + dedupe) | counts unique keys and unread items | \`\`\`pnpm vitest run tests/unit/dedupe-feed.test.ts\`\`\` | Cannot find module '../notificationFeed' |
| S-2 (publisher outbox) | publishes event to outbox with dedupe key | \`\`\`pnpm vitest run tests/integration/publisher.test.ts\`\`\` | publishToOutbox is not a function |
| S-3 (client feed + fallback) | shows notification within 5s via SSE | \`\`\`pnpm playwright test tests/e2e/notification-feed.spec.ts\`\`\` | Element [data-testid="feed-item"] not found |

## Acceptance Mapping

| Slice | Plan task ID | Spec criterion ID |
| --- | --- | --- |
| S-1 | T-1 | AC-1, AC-2 |
| S-2 | T-2 | AC-1 |
| S-3 | T-3 | AC-1, AC-2, AC-3 |

## Failure Analysis

| Slice | Expected missing behavior | Actual failure reason |
| --- | --- | --- |
| S-1 | notificationFeed module does not exist yet | Module import fails — correct: implementation missing |
| S-2 | publishToOutbox function not implemented | Function not found — correct: write path missing |
| S-3 | Feed UI not rendered, SSE not connected | DOM element missing — correct: client component not built |

## GREEN Evidence

- Full suite command: \`\`\`pnpm vitest run && pnpm playwright test\`\`\`
- Full suite result: 47 tests passed (3 new + 44 existing), 0 failed, 0 skipped

## REFACTOR Notes

- What changed: Extracted \`\`\`mergeLatestByDedupeKey\`\`\` helper from inline loop in \`\`\`summarizeDedupedFeed\`\`\`; moved SSE reconnect logic into \`\`\`useSSEConnection\`\`\` hook.
- Why: Dedupe merge logic is reused by both publisher and client; reconnect logic was duplicated across components.
- Behavior preserved: Full suite re-run confirms 47/47 pass after refactor.

## Traceability

- Plan task IDs: T-1, T-2, T-3
- Spec criterion IDs: AC-1, AC-2, AC-3`,

  review: `## Layer 1 Verdict

| Criterion | Verdict | Evidence |
| --- | --- | --- |
| AC-1: Delivery within 5s without reload | PASS | \`notification-feed.e2e.ts:44-88\` asserts SSE-to-UI timing under mock clock |
| AC-2: Dedupe — one visible item per key | PARTIAL | Unit tests cover publisher dedupe; UI merge path lacks test for race reordering (\`feedStore.test.ts\` missing case) |
| AC-3: Degraded mode + REST snapshot | PASS | \`NotificationsPanel.tsx:112-140\` renders banner + calls snapshot endpoint |

## Layer 2 Findings

| ID | Severity | Category | Description | Status |
| --- | --- | --- | --- | --- |
| R-1 | Critical | correctness | Snapshot endpoint returns newest N rows but does not guarantee consistency with stream cursor — users can miss items between snapshot and subscribe. | open |
| R-2 | Important | performance | \`feedStore.merge()\` does full-array scan on every SSE event; O(n) per event where n is feed length. | open |
| R-3 | Suggestion | architecture | SSE reconnect logic duplicated across \`useNotifications\` and \`usePresence\`; extract shared hook. | open |

## Review Army Contract

- See \`07-review-army.json\`
- Reconciliation summary: 1 duplicate collapsed (R-1 reported by spec-reviewer and code-reviewer), 0 conflicts

## Review Readiness Dashboard

- Layer 1 complete: yes (3/3 criteria)
- Layer 2 complete: yes (5 sections reviewed)
- Review army schema valid: yes
- Open critical blockers: 1 (R-1)
- Ship recommendation: BLOCKED until R-1 resolved

## Severity Summary

- Critical: 1
- Important: 1
- Suggestion: 1

## Final Verdict

- BLOCKED`,

  ship: `## Preflight Results

- Review verdict: APPROVED_WITH_CONCERNS (R-1 resolved, R-2 accepted as known debt)
- Build: pass (\`pnpm build\` succeeds)
- Tests: pass (\`pnpm vitest run && pnpm playwright test\` — 47 passed, 0 failed)
- Lint: pass (\`pnpm lint\` clean)
- Type-check: pass (\`pnpm typecheck\` clean)
- Working tree clean: yes (\`git status\` shows no uncommitted changes)

## Release Notes

- **Added:** In-app notification feed with SSE updates and REST fallback snapshotting (AC-1, AC-3).
- **Changed:** Notification payloads now include a stable dedupe key for idempotent rendering (AC-2).
- **Fixed:** Panel no longer drops the newest item when reconnecting after sleep/resume.
- **Breaking changes:** None.

## Rollback Plan

- Trigger conditions: error rate on \`/notifications/stream\` exceeds 5% for >5 minutes, or p95 publish-to-visible lag exceeds 10s.
- Rollback steps: \`git revert <merge-sha> && git push origin main\` then redeploy; if DB migrations shipped, run \`2026_04_12_notifications_cursor_down.sql\` before traffic.
- Verification steps: confirm error rate returns to pre-release baseline within 10 minutes; smoke-test feed panel manually.

## Monitoring

- Metrics/logs to watch: error rate on \`/notifications/stream\` and snapshot endpoint for 24h; p95 publish-to-visible lag via metrics dashboard.
- Risk note (if no monitoring): N/A — monitoring is in place.

## Finalization

- Selected enum: FINALIZE_OPEN_PR
- Selected label: B
- Execution result: PR #42 created via \`gh pr create\`; CI passed; squash-merged to main.
- PR URL: https://github.com/example/repo/pull/42`,
};

const GOOD_BAD_EXAMPLES: Record<FlowStage, { good: string; bad: string; lesson: string }> = {
  brainstorm: {
    good:
      "Problem: release checks are fragile and inconsistent between CI and local runs; invalid metadata sometimes reaches npm publish. Success: invalid release preconditions are caught before publish with explicit operator feedback, in both CI and local workflows. Constraints: no new runtime dependencies.",
    bad:
      "Problem: releases are broken. Success: make them better. Constraints: be careful.",
    lesson:
      "\"Make it better\" is not a success criterion — an agent cannot know when it is done. State the observable condition that proves success."
  },
  scope: {
    good:
      "In scope: in-app notification feed, SSE delivery path, read/unread state, retry on transient failures. Out of scope: email/SMS/push providers, per-user preferences. Deferred: WebSocket channel, rich media, full-text search.",
    bad:
      "In scope: notifications. Out of scope: stuff we are not doing. Deferred: v2.",
    lesson:
      "Vague boundaries get relitigated in every subsequent stage. Enumerate concrete capabilities on each side — \"stuff we are not doing\" is not a decision."
  },
  design: {
    good:
      "Failure: SSE connection drop. Trigger: network interruption. Detection: client heartbeat timeout (30s). Mitigation: auto-reconnect with exponential backoff + REST snapshot fallback. User impact: ≤10s delay, no data loss.",
    bad:
      "Failure: network errors. Mitigation: retry and log. User impact: users may see issues sometimes.",
    lesson:
      "A failure row without a detection signal and a bounded user impact is aspirational, not a design. Name the trigger, the detector, and the recovery behavior."
  },
  spec: {
    good:
      "AC-1: Given a signed-in user with an active session, when the server publishes a new notification event for that user, the client feed shows the new item within 5 seconds without a full page reload.",
    bad:
      "AC-1: Users should see their notifications quickly and reliably, with a good user experience.",
    lesson:
      "Spec criteria must be observable, measurable, and falsifiable. \"Quickly\" is a feeling; \"within 5 seconds without a full page reload\" is a test."
  },
  plan: {
    good:
      "T-2: Implement publisher + outbox write path. Acceptance: AC-1. Verification: `pnpm vitest run tests/integration/publisher.test.ts`. Depends on: T-1. Effort: M.",
    bad:
      "T-2: Build the backend. Verify: manual testing. Effort: a few days.",
    lesson:
      "A task without a single acceptance criterion and a reproducible verification command is a wish. If you cannot say how you will know it is done, you cannot ship it."
  },
  tdd: {
    good:
      "RED: `pnpm vitest run tests/unit/dedupe-feed.test.ts` → `publishToOutbox is not a function`. GREEN (after minimal impl): same command, 47/47 pass, full suite. REFACTOR: extracted `mergeLatestByDedupeKey`; suite still 47/47.",
    bad:
      "Wrote the publisher code. Tests pass now. Will add unit tests later when I have time.",
    lesson:
      "Code written before a failing test is guessing validated after the fact. The RED failure IS the specification — without it, the GREEN pass proves nothing about the intended behavior."
  },
  review: {
    good:
      "R-1 Critical: snapshot endpoint returns newest N rows but does not guarantee consistency with stream cursor — users can miss items between snapshot and subscribe. Evidence: integration test `notification-consistency.test.ts:22-58`. Status: open.",
    bad:
      "Looks good overall. A few small things could be polished, maybe refactor the merge logic. LGTM.",
    lesson:
      "\"LGTM\" is not a review — it is a signature on whatever the author shipped. Every finding needs a severity, a falsifiable description, evidence, and a status."
  },
  ship: {
    good:
      "Rollback trigger: error rate on `/notifications/stream` >5% for 5 minutes, or p95 publish-to-visible lag >10s. Steps: `git revert <merge-sha> && git push origin main` then redeploy; run `2026_04_12_notifications_cursor_down.sql` before traffic. Verification: error rate returns to baseline within 10 minutes.",
    bad:
      "Rollback plan: revert the commit if anything goes wrong.",
    lesson:
      "\"Revert if anything goes wrong\" leaves the on-call engineer to invent the plan at 2 a.m. The rollback trigger is an operational contract: state the signal, the command, and the verification."
  }
};

export function stageGoodBadExamples(stage: FlowStage): string {
  const sample = GOOD_BAD_EXAMPLES[stage];
  if (!sample) return "";
  return [
    "## Good vs Bad (at-a-glance)",
    "",
    "Contrasting samples to calibrate the quality bar for this stage. Read before writing the artifact — mirror the **Good** shape, avoid the **Bad** shape.",
    "",
    "**Good**",
    "",
    "> " + sample.good,
    "",
    "**Bad**",
    "",
    "> " + sample.bad,
    "",
    "**Why it matters:** " + sample.lesson,
    ""
  ].join("\n");
}

export function stageExamples(stage: FlowStage): string {
  const examples = STAGE_EXAMPLES[stage];
  if (!examples) return "";
  return [
    "## Examples",
    "",
    "Concrete artifact samples. These mirror the exact heading levels agents must use when authoring the stage artifact (all H2 `##` sections), so they are presented inside a markdown fence to avoid collapsing into the SKILL outline.",
    "",
    "```markdown",
    examples,
    "```",
    ""
  ].join("\n");
}
