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

## Approach Tier

- **Tier:** Standard
- **Why this tier:** Change spans CI + local release workflow and shared module boundaries, but remains bounded to one subsystem.

## Short-Circuit Decision

- **Status:** bypassed
- **Why:** Core requirements were not concrete enough initially; we still needed options + trade-off conversation.
- **Scope handoff:** Continue full brainstorm flow before scope.

## Approaches

| Approach | Role | Architecture | Trade-offs | Recommendation |
| --- | --- | --- | --- | --- |
| A: Reusable validation module | baseline | Shared TS module with typed validators, imported by CI scripts and local CLI. Existing \`pre-publish.sh\` calls the module. | Medium upfront effort, high reuse. Requires test coverage for the module. | **Recommended** — best balance of reuse and delivery speed. |
| B: Hardened shell scripts | fallback | Keep existing script approach, add stricter checks and error messages. | Lowest effort. Weak reuse, CI/local divergence risk grows over time. | Viable fallback if TS module is blocked. |
| C: Full release framework | challenger: higher-upside | New release orchestrator with plugin system, config files, rollback commands. | Maximum flexibility. High risk, delivery delay, over-engineered for current needs. | Not recommended for v1. |

## Approach Reaction

- **Closest option:** A (reusable validation module).
- **Concerns:** User wanted to avoid framework-level overbuild and keep v1 delivery speed high.
- **What changed after reaction:** Recommendation stayed on A, but added explicit fallback path via existing shell entrypoint to reduce migration risk.

## Selected Direction

- **Approach:** A — Reusable validation module
- **Rationale:** based on user reaction favoring fast delivery and lower complexity, shared TS module gives consistent behavior in CI/local, avoids script duplication, and stays within the no-new-dependency constraint.
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

## Dependency Batches

#### Batch 1 (foundation)
- Task IDs: T-1
- Verification gate: schema tests pass, dedupe key fixtures validated

#### Batch 2 (core logic)
- Task IDs: T-2
- Depends on: Batch 1 (T-1 complete)
- Verification gate: integration test proves publish-to-outbox path

#### Batch 3 (integration)
- Task IDs: T-3
- Depends on: Batch 2 (T-2 complete)
- Verification gate: e2e tests pass for delivery, dedupe, and degraded mode

Execution rule: complete and verify each batch before starting the next batch.

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

| Task/Batch | Risk | Likelihood | Impact | Mitigation |
| --- | --- | --- | --- | --- |
| T-3 (Batch 3) | SSE reconnect logic complex | Medium | High | Spike reconnect in isolation before integrating with feed UI |
| Batch 2 → 3 | Publisher API contract may shift | Low | Medium | Pin contract in T-1 schema; T-2 integration test validates |

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
- Reconciliation summary: 1 duplicate collapsed (R-1 reported by reviewer and security-reviewer), 0 conflicts

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

interface GoodBadSample {
  label: string;
  good: string;
  bad: string;
  lesson: string;
}

const GOOD_BAD_EXAMPLES: Record<FlowStage, GoodBadSample[]> = {
  brainstorm: [
    {
      label: "Problem / success statement",
      good:
        "Problem: release checks are fragile and inconsistent between CI and local runs; invalid metadata sometimes reaches npm publish. Success: invalid release preconditions are caught before publish with explicit operator feedback, in both CI and local workflows. Constraints: no new runtime dependencies.",
      bad:
        "Problem: releases are broken. Success: make them better. Constraints: be careful.",
      lesson:
        "\"Make it better\" is not a success criterion — an agent cannot know when it is done. State the observable condition that proves success."
    },
    {
      label: "Alternative direction (one of 2–3)",
      good:
        "Option B: Pre-publish verifier script invoked from \`release.yml\` and a \`pnpm release:check\` target. Pros: one enforcement surface; fails fast locally. Cons: adds a script to maintain; must stay in sync with \`package.json\`. Rejected alternative: relying on npm lifecycle hooks only — they run too late to block publish.",
      bad:
        "We could also use a script, or hooks, or something in CI. We'll pick whichever is easier later.",
      lesson:
        "Alternatives are only useful if they are concrete and comparable. Name each one, call out pros/cons, and say what was rejected — otherwise \"later\" becomes \"never\" and the choice is made by accident."
    },
    {
      label: "Clarifying question",
      good:
        "Before I lock direction: should a failed release:check block the CI job (hard failure) or only warn and continue? The former is safer but costs a revert cycle when the check itself is wrong; the latter preserves velocity but can let bad metadata through. Recommend A (block). Pick: A) Block  B) Warn-only  C) Block in CI, warn locally.",
      bad:
        "Do you want it to fail or warn? Let me know.",
      lesson:
        "A good question gives the user context, a recommendation, and lettered options they can answer with one keystroke. \"Let me know\" shifts the framing cost back to the user."
    }
  ],
  scope: [
    {
      label: "In / out / deferred boundaries",
      good:
        "In scope: in-app notification feed, SSE delivery path, read/unread state, retry on transient failures. Out of scope: email/SMS/push providers, per-user preferences. Deferred: WebSocket channel, rich media, full-text search.",
      bad:
        "In scope: notifications. Out of scope: stuff we are not doing. Deferred: v2.",
      lesson:
        "Vague boundaries get relitigated in every subsequent stage. Enumerate concrete capabilities on each side — \"stuff we are not doing\" is not a decision."
    },
    {
      label: "Scope change trace",
      good:
        "Scope delta at 2026-04-15: user asked to add per-user mute preferences. Decision: moved from Out-of-scope → In-scope; acknowledged cost (≈1 day, +1 schema migration); risk: touches settings surface. Recorded in \`03-design.md#scope-trace\`. Requires re-running scope review before design lock.",
      bad:
        "Added mute preferences to scope.",
      lesson:
        "Scope changes silently are how projects drift. Every in↔out move needs a timestamp, a cost estimate, and a link to the next review it invalidates."
    }
  ],
  design: [
    {
      label: "Failure mode row",
      good:
        "Failure: SSE connection drop. Trigger: network interruption. Detection: client heartbeat timeout (30s). Mitigation: auto-reconnect with exponential backoff + REST snapshot fallback. User impact: ≤10s delay, no data loss.",
      bad:
        "Failure: network errors. Mitigation: retry and log. User impact: users may see issues sometimes.",
      lesson:
        "A failure row without a detection signal and a bounded user impact is aspirational, not a design. Name the trigger, the detector, and the recovery behavior."
    },
    {
      label: "Rejected design alternative",
      good:
        "Considered WebSocket instead of SSE. Rejected because: (1) our proxy layer strips upgrade headers; (2) one-way push fits the \"notification feed\" semantics; (3) SSE plays nicer with HTTP/2 fan-out. Trade-off accepted: no client→server channel; we will fall back to REST for the tiny set of acks.",
      bad:
        "We chose SSE. WebSocket could also work.",
      lesson:
        "A design without a rejected alternative reads like a requirement, not a decision. The rejection is the part that survives review — it tells future readers what trade-off was taken."
    },
    {
      label: "Diagram caption",
      good:
        "Figure 1 — Notification pipeline (sequence diagram): producer → outbox(durable) → relay → SSE stream → client. Label on relay shows \"at-least-once; dedupe by event_id\"; label on client shows \"merge by dedupe_key before render\".",
      bad:
        "Figure 1: notification flow.",
      lesson:
        "An unlabeled diagram is decoration. Every arrow needs a delivery guarantee, every box needs an action verb — otherwise the diagram contradicts the prose without anyone noticing."
    }
  ],
  spec: [
    {
      label: "Observable acceptance criterion",
      good:
        "AC-1: Given a signed-in user with an active session, when the server publishes a new notification event for that user, the client feed shows the new item within 5 seconds without a full page reload.",
      bad:
        "AC-1: Users should see their notifications quickly and reliably, with a good user experience.",
      lesson:
        "Spec criteria must be observable, measurable, and falsifiable. \"Quickly\" is a feeling; \"within 5 seconds without a full page reload\" is a test."
    },
    {
      label: "Negative / error-path criterion",
      good:
        "AC-4: Given the SSE connection drops mid-session, when the client detects no heartbeat for 30 seconds, the UI shows a \"Reconnecting…\" badge and automatically re-subscribes; missed events delivered since the last ACKed id are replayed exactly once.",
      bad:
        "AC-4: Handle errors gracefully.",
      lesson:
        "Error-path criteria are where most bugs hide. Write them with the same \"given/when/then\" rigor as happy-path — otherwise QA ends up inventing them at release time."
    },
    {
      label: "Non-functional budget",
      good:
        "NFR-2: p95 end-to-end publish-to-visible latency ≤5s under 1k concurrent subscribers on a 2-vCPU pod; CPU headroom ≥30% at steady state. Measurement: \`k6 run tests/load/notifications.js\`, report median + p95 + p99.",
      bad:
        "NFR-2: Performance should be good.",
      lesson:
        "Non-functional goals without numbers + a measurement command are aspirational. Pin the percentile, the load shape, and the script that produces the evidence."
    }
  ],
  plan: [
    {
      label: "Single task row",
      good:
        "T-2: Implement publisher + outbox write path. Acceptance: AC-1. Verification: \`pnpm vitest run tests/integration/publisher.test.ts\`. Depends on: T-1. Effort: M (≈4 min).",
      bad:
        "T-2: Build the backend. Verify: manual testing. Effort: a few days.",
      lesson:
        "A task without a single acceptance criterion and a reproducible verification command is a wish. If you cannot say how you will know it is done, you cannot ship it."
    },
    {
      label: "Dependency graph entry",
      good:
        "T-5 (consume SSE client) depends on T-3 (stream endpoint) and T-4 (auth cookie forwarding). Parallelizable with T-6 (read-state persistence). Blocks T-8 (end-to-end happy-path e2e).",
      bad:
        "T-5 depends on other tasks.",
      lesson:
        "The value of a dependency graph is mechanical scheduling. \"Depends on other tasks\" is a shrug — list the IDs so the execution order is unambiguous."
    }
  ],
  tdd: [
    {
      label: "RED → GREEN → REFACTOR slice",
      good:
        "RED: \`pnpm vitest run tests/unit/dedupe-feed.test.ts\` → \`publishToOutbox is not a function\`. GREEN (after minimal impl): same command, 47/47 pass, full suite. REFACTOR: extracted \`mergeLatestByDedupeKey\`; suite still 47/47.",
      bad:
        "Wrote the publisher code. Tests pass now. Will add unit tests later when I have time.",
      lesson:
        "Code written before a failing test is guessing validated after the fact. The RED failure IS the specification — without it, the GREEN pass proves nothing about the intended behavior."
    },
    {
      label: "Bug-fix reproduction test",
      good:
        "Bug B-17: dedup fails when two events arrive in the same ms. Prove-It RED: added \`tests/unit/dedupe-feed.test.ts > dedupes when timestamps collide\`; run → \`expected 1 item, received 2\`. Fix applied; same test passes; full suite still 47/47.",
      bad:
        "Fixed the duplicate rendering issue.",
      lesson:
        "A bug without a reproducing test is a bug that comes back. Ship the RED test as part of the fix — it is the contract that prevents regression."
    },
    {
      label: "Refactor-only slice (state-based)",
      good:
        "Refactor: moved heartbeat logic into \`useHeartbeat()\` hook. No behavior change intended. Evidence: no new tests; existing state-based tests \`feed-state.test.ts\` (42 assertions) still pass; coverage unchanged at 94%.",
      bad:
        "Refactored the component. Added some interaction mocks to check the new hook is called.",
      lesson:
        "A refactor should assert on state, not on call shape. If you had to rewrite your mocks, it was not a refactor — it was a redesign dressed as one."
    }
  ],
  review: [
    {
      label: "Critical finding",
      good:
        "R-1 Critical: snapshot endpoint returns newest N rows but does not guarantee consistency with stream cursor — users can miss items between snapshot and subscribe. Evidence: integration test \`notification-consistency.test.ts:22-58\`. Status: open.",
      bad:
        "Looks good overall. A few small things could be polished, maybe refactor the merge logic. LGTM.",
      lesson:
        "\"LGTM\" is not a review — it is a signature on whatever the author shipped. Every finding needs a severity, a falsifiable description, evidence, and a status."
    },
    {
      label: "Security review row",
      good:
        "R-4 High (sec): SSE endpoint accepts any user_id in the query string; a logged-in attacker can subscribe to another user's stream. Evidence: \`curl\` repro in \`docs/notes/sec-r4.md\`. Fix: require auth cookie, filter events by session.user.id server-side. Status: fix in T-11; verified in \`notifications-auth.test.ts\`.",
      bad:
        "Might want to double-check auth on the SSE endpoint.",
      lesson:
        "Security findings without a reproduction step and a tied fix-task are suggestions, not reviews. Attach the curl (or equivalent), the fix task ID, and the verification test."
    }
  ],
  ship: [
    {
      label: "Rollback contract",
      good:
        "Rollback trigger: error rate on \`/notifications/stream\` >5% for 5 minutes, or p95 publish-to-visible lag >10s. Steps: \`git revert <merge-sha> && git push origin main\` then redeploy; run \`2026_04_12_notifications_cursor_down.sql\` before traffic. Verification: error rate returns to baseline within 10 minutes.",
      bad:
        "Rollback plan: revert the commit if anything goes wrong.",
      lesson:
        "\"Revert if anything goes wrong\" leaves the on-call engineer to invent the plan at 2 a.m. The rollback trigger is an operational contract: state the signal, the command, and the verification."
    },
    {
      label: "Preflight check",
      good:
        "Preflight: \`pnpm release:check\` ✅ (package metadata ok, changeset captured), \`pnpm test\` ✅ 195/195, \`pnpm build\` ✅, CI green on feat/notifications @ \`abc1234\`, rollback plan captured, migration reviewed. Finalization mode: Merge via squash.",
      bad:
        "All good, shipping it.",
      lesson:
        "A preflight is a checklist that names each gate and the command that proved it. \"All good\" is a vibe — it cannot be audited after the fact when the deploy misbehaves."
    }
  ]
};

export function stageGoodBadExamples(stage: FlowStage): string {
  const samples = GOOD_BAD_EXAMPLES[stage];
  if (!samples || samples.length === 0) return "";
  const blocks: string[] = [
    "## Good vs Bad (at-a-glance)",
    "",
    "Contrasting samples to calibrate the quality bar for this stage. Read before writing the artifact — mirror the **Good** shape, avoid the **Bad** shape. Each block targets a different axis of the stage so you can spot-check more than one dimension of your draft.",
    ""
  ];
  samples.forEach((sample, index) => {
    blocks.push(`### ${index + 1}. ${sample.label}`);
    blocks.push("");
    blocks.push("**Good**");
    blocks.push("");
    blocks.push("> " + sample.good);
    blocks.push("");
    blocks.push("**Bad**");
    blocks.push("");
    blocks.push("> " + sample.bad);
    blocks.push("");
    blocks.push("**Why it matters:** " + sample.lesson);
    blocks.push("");
  });
  return blocks.join("\n");
}

export const STAGE_EXAMPLES_REFERENCE_DIR = "references/stages";

export function stageExamplesReferencePath(stage: FlowStage): string {
  return `.cclaw/${STAGE_EXAMPLES_REFERENCE_DIR}/${stage}-examples.md`;
}

/**
 * Returns the full example artifact body as a standalone reference markdown
 * file. Materialized under .cclaw/references/stages/<stage>-examples.md so
 * the always-rendered skill body can link instead of inlining.
 */
export function stageExamplesReferenceMarkdown(stage: FlowStage): string | null {
  const examples = STAGE_EXAMPLES[stage];
  if (!examples) return null;
  return [
    `---`,
    `stage: ${stage}`,
    `name: ${stage}-stage-examples`,
    `description: "Full sample artifact for the ${stage} stage. Loaded only when an agent explicitly needs a complete example; the stage skill links here rather than inlining."`,
    `---`,
    "",
    `# ${stage} stage — full artifact sample`,
    "",
    `This file is linked from \`.cclaw/skills/<${stage}-stage>/SKILL.md\` under **Examples → See also**. The sample uses H2 headings that mirror the artifact a cclaw session must produce, so the markdown is wrapped in a fence to avoid collapsing into the outline.`,
    "",
    "```markdown",
    examples,
    "```",
    ""
  ].join("\n");
}

/**
 * Returns short inline shape cues rendered directly inside the stage skill.
 */
export function stageExamples(stage: FlowStage): string {
  const examples = STAGE_EXAMPLES[stage];
  if (!examples) return "";
  return [
    "## Examples",
    "",
    "Shape cues to follow; do not paste these headings verbatim unless they match the work:",
    ...exampleSummaryBullets(stage),
    ""
  ].join("\n");
}

function exampleSummaryBullets(stage: FlowStage): string[] {
  const headings = STAGE_EXAMPLE_SECTION_HEADINGS[stage] ?? [];
  if (headings.length === 0) return ["- Full artifact structure."];
  return headings.map((heading) => `- ${heading}`);
}

// Kept in sync with STAGE_EXAMPLES above so the inline summary matches the
// reference file without duplicating the heavy text. Update whenever the
// sample in STAGE_EXAMPLES gains or loses a top-level section.
const STAGE_EXAMPLE_SECTION_HEADINGS: Record<FlowStage, string[]> = {
  brainstorm: [
    "Problem framing (problem, success, constraints)",
    "Candidate approaches with trade-offs",
    "Recommended direction + open questions",
    "Clarification log and decision record"
  ],
  scope: [
    "In-scope / out-of-scope / deferred lists with concrete capabilities",
    "Requirements table with stable R# IDs",
    "Boundary stress-tests and non-negotiables",
    "Decision record for premise challenges"
  ],
  design: [
    "Blast-radius file list",
    "Mandatory architecture diagram (Mermaid)",
    "Failure-mode table with detection + mitigation",
    "Test strategy + performance budget",
    "Completion dashboard + unresolved decisions"
  ],
  spec: [
    "Acceptance-criteria table (observable, measurable, falsifiable)",
    "Requirement-ref column tying each AC back to an R# from scope",
    "Verification-approach column",
    "Approval block"
  ],
  plan: [
    "Dependency graph + dependency batches",
    "Task list with effort + minutes estimate per task",
    "Acceptance mapping (every AC → task IDs)",
    "No-Placeholder scan row + WAIT_FOR_CONFIRM marker"
  ],
  tdd: [
    "RED evidence per slice (failing test output)",
    "Acceptance mapping per slice",
    "GREEN evidence (full-suite pass)",
    "REFACTOR notes with behavior-preservation confirmation",
    "Test-pyramid shape + prove-it reproduction when applicable"
  ],
  review: [
    "Spec-compliance findings (Layer 1)",
    "Code-quality findings (Layer 2)",
    "Severity, evidence, and status per finding",
    "Go / no-go verdict"
  ],
  ship: [
    "Release checklist (version, changelog, tag, artifacts)",
    "Rollback plan with trigger, steps, verification",
    "Runbook (how to verify the release post-deploy)",
    "Sign-off block"
  ]
};

// ---------------------------------------------------------------------------
// Domain-specific living examples (A.2#30).
//
// The generic examples above use a "notification feed" narrative, which is
// fine for calibration but leaves agents guessing when the project is a CLI,
// a library, or a data pipeline. The map below attaches 3-4 domain-specific
// living examples to the stages where domain shape matters most
// (spec, plan, tdd, ship). Keep each example to 1-2 sentences — they are
// calibration samples, not full artifacts.
// ---------------------------------------------------------------------------

export type ExampleDomain = "web" | "cli" | "library" | "data-pipeline";

interface DomainSample {
  domain: ExampleDomain;
  label: string;
  body: string;
}

const DOMAIN_LABELS: Record<ExampleDomain, string> = {
  web: "Web app (full-stack)",
  cli: "CLI tool",
  library: "Library / SDK",
  "data-pipeline": "Data pipeline / ETL"
};

export const RESEARCH_FLEET_USAGE_EXAMPLE = [
  "Before drafting `03-design.md`, run `research/research-fleet.md` once and",
  "capture all four lenses in `.cclaw/artifacts/02a-research.md`.",
  "Dispatch semantics by harness: Claude/Cursor = parallel subagents in one turn;",
  "OpenCode/Codex = sequential role-switch with explicit announcements.",
  "Design must include a `Research Fleet Synthesis` section that maps each",
  "lens to concrete architecture decisions and risks."
].join(" ");

const STAGE_DOMAIN_SAMPLES: Partial<Record<FlowStage, DomainSample[]>> = {
  brainstorm: [
    {
      domain: "web",
      label: "Direction",
      body: "Problem: admin dashboard orders table requires manual refresh to see new orders. Success: admins see new rows within 2s of server-side status change, no full navigation. Anti-success: WebSocket rewrite of the whole table stack when only one view needs live updates."
    },
    {
      domain: "cli",
      label: "Direction",
      body: "Problem: `cclaw archive` silently deletes 30+ day runs with no preview. Success: a `--dry-run` flag prints would-be-archived run IDs to stdout and exits 0; current behavior is unchanged without the flag. Anti-success: adding an interactive confirmation prompt that breaks CI scripts."
    },
    {
      domain: "library",
      label: "Direction",
      body: "Problem: consumers cannot validate hook JSON without importing internal modules. Success: `validateHookDocument(obj)` exported from the package root with typed result `{ ok, errors? }`. Anti-success: exposing the full Zod schema and forcing consumers to depend on Zod."
    },
    {
      domain: "data-pipeline",
      label: "Direction",
      body: "Problem: reruns of the orders job create duplicate `fact_orders` rows. Success: running the job twice on the same input leaves row count unchanged and `dbt test --select fact_orders` green. Anti-success: introducing a nightly dedup job that hides the underlying non-idempotency."
    }
  ],
  scope: [
    {
      domain: "web",
      label: "Scope line",
      body: "In: live-update `/dashboard/orders` table via SSE; out: notification drawer, mobile PWA, dashboards other than `orders`. Discretion: choice of SSE vs long-polling for legacy Safari. NOT in scope: rewriting the auth layer or the existing REST endpoints."
    },
    {
      domain: "cli",
      label: "Scope line",
      body: "In: add `--dry-run` to `cclaw archive`; out: redesigning archive formats, adding retention flags, or changing the default. Discretion: exact wording of stdout lines. NOT in scope: touching `init` / `sync` / `doctor` subcommands."
    },
    {
      domain: "library",
      label: "Scope line",
      body: "In: expose `validateHookDocument` + types from package root; out: rewriting hook schema, adding new hook kinds, dropping old ones. Discretion: whether to re-export `HookDocument` as type-only. NOT in scope: migrating consumers."
    },
    {
      domain: "data-pipeline",
      label: "Scope line",
      body: "In: dedup step between `raw.orders` and `fact_orders` keyed on `(order_id, event_ts)`; out: redesigning ingestion, adding new partitions, or touching downstream marts. Discretion: `row_number()` vs `qualify`-style dedup. NOT in scope: backfilling historical partitions."
    }
  ],
  design: [
    {
      domain: "web",
      label: "Parallel research fleet handoff",
      body: RESEARCH_FLEET_USAGE_EXAMPLE
    },
    {
      domain: "web",
      label: "Architecture note",
      body: "Data flow: server-side order update → publish to `orders-updates` channel → SSE endpoint `/api/orders/stream` → `useOrderFeed` hook merges into React state → row rerenders. Failure mode: SSE connection drop → exponential-backoff reconnect + on-reconnect REST snapshot fallback. Trade-off accepted: no client→server channel (SSE one-way); existing REST mutations cover it."
    },
    {
      domain: "cli",
      label: "Architecture note",
      body: "Flag is parsed by the existing Zod CLI parser; `--dry-run` short-circuits before any filesystem mutation, shares formatter `src/cli/format.ts` with `status`. Failure mode: formatter output differs between `status` and `archive --dry-run` → centralize format. Trade-off: we print run IDs unsorted to keep the code path identical to the real archive path."
    },
    {
      domain: "library",
      label: "Architecture note",
      body: "Re-export `validateHookDocument` from package root; rename internal `__validate` to match the exported name so callsites and the export converge. Failure mode: consumers importing from `/dist/internal` break on the rename → add a deprecation re-export shim for one minor. Trade-off: slightly wider public surface today buys us a smaller public surface tomorrow."
    },
    {
      domain: "data-pipeline",
      label: "Architecture note",
      body: "Insert `int_orders_deduped` CTE between staging and fact, keyed on `(order_id, event_ts)` with `row_number() = 1` per key; `fact_orders` reads from the deduped model only. Failure mode: late-arriving events with an earlier `event_ts` would flap the chosen row → tiebreak on `ingest_ts DESC`. Trade-off: the job now does one extra pass; measured +8% runtime, within budget."
    }
  ],
  spec: [
    {
      domain: "web",
      label: "AC",
      body: "AC-W1: Given a signed-in admin viewing `/dashboard/orders`, when an order's status changes server-side, the row updates within 2s without a full navigation (assert via `pnpm playwright test orders-live.spec.ts`)."
    },
    {
      domain: "cli",
      label: "AC",
      body: "AC-C1: Given `cclaw init --claude` run in an empty directory, exit code is `0`, `.cclaw/config.yaml` is created with `harnesses: [claude]`, and stderr contains no warnings (asserted by `tests/integration/init-sync-doctor.test.ts`)."
    },
    {
      domain: "library",
      label: "AC",
      body: "AC-L1: `validateHookDocument(obj)` returns `{ ok: true }` for every fixture under `tests/fixtures/valid-hooks/` and `{ ok: false, errors: [...] }` with at least one message for every fixture under `tests/fixtures/invalid-hooks/`."
    },
    {
      domain: "data-pipeline",
      label: "AC",
      body: "AC-D1: For any `orders.csv` input, the pipeline emits exactly one row per `(order_id, event_ts)` pair to `warehouse.fact_orders`; running the job twice on the same input is idempotent (row count unchanged, verified by `dbt test --select fact_orders`)."
    }
  ],
  plan: [
    {
      domain: "web",
      label: "Task",
      body: "T-W-3 `[~4m]`: Wire SSE endpoint `/api/orders/stream` into `useOrderFeed` hook. AC-W1. Verify: `pnpm playwright test orders-live.spec.ts`. Depends on: T-W-2."
    },
    {
      domain: "cli",
      label: "Task",
      body: "T-C-2 `[~3m]`: Add `--dry-run` flag to `cclaw archive` that prints the would-be-archived run IDs to stdout and exits 0. AC-C3. Verify: `node dist/cli.js archive --dry-run` + `tests/unit/cli-parse.test.ts`."
    },
    {
      domain: "library",
      label: "Task",
      body: "T-L-1 `[~5m]`: Expose `validateHookDocument` from the package root and re-export its types. AC-L1. Verify: `pnpm build && node -e \"console.log(require('./dist').validateHookDocument)\"`."
    },
    {
      domain: "data-pipeline",
      label: "Task",
      body: "T-D-2 `[~5m]`: Add dedup step keyed on `(order_id, event_ts)` between `raw.orders` and `fact_orders`. AC-D1. Verify: `dbt run --select fact_orders+ && dbt test --select fact_orders`."
    }
  ],
  tdd: [
    {
      domain: "web",
      label: "RED→GREEN→REFACTOR",
      body: "RED: `pnpm playwright test orders-live.spec.ts` → timeout waiting for row update. GREEN: wired SSE event → row rerenders via `useOrderFeed`. REFACTOR: extracted `applyOrderEvent(row, event)` pure helper; 87/87 tests still pass."
    },
    {
      domain: "cli",
      label: "RED→GREEN→REFACTOR",
      body: "RED: `tests/unit/cli-parse.test.ts` expects `--dry-run` flag → `unknown option` error. GREEN: added to the Zod parser; 19/19 pass. REFACTOR: hoisted the dry-run formatter into `src/cli/format.ts` shared with `status`."
    },
    {
      domain: "library",
      label: "RED→GREEN→REFACTOR",
      body: "RED: `tests/unit/hook-schema.test.ts` imports `validateHookDocument` from package root → `export not found`. GREEN: added re-export + types. REFACTOR: renamed internal `__validate` to `validateHookDocument` so the export name matches the source."
    },
    {
      domain: "data-pipeline",
      label: "RED→GREEN→REFACTOR",
      body: "RED: `dbt test --select fact_orders` → `unique test on (order_id, event_ts)` fails on re-run. GREEN: added `row_number()` dedup in the staging model. REFACTOR: extracted the dedup CTE into `int_orders_deduped` for reuse by `fact_returns`."
    }
  ],
  review: [
    {
      domain: "web",
      label: "Finding",
      body: "R-W-1 (Critical, correctness): `useOrderFeed` does not unsubscribe from the SSE channel on unmount — two mounts on the same page double-count rows. Evidence: `tests/unit/order-feed-hook.test.ts > unmount` fails. Fix owner: frontend; blocks ship."
    },
    {
      domain: "cli",
      label: "Finding",
      body: "R-C-2 (Suggestion, UX): `cclaw archive --dry-run` prints run IDs without a trailing newline, breaking downstream `xargs` pipelines. Evidence: `echo '' | xargs -I{} printf '%s\\n' {}` contrast. Fix owner: CLI; non-blocking."
    },
    {
      domain: "library",
      label: "Finding",
      body: "R-L-1 (Important, surface-area): the new `validateHookDocument` export is documented in README but missing from `src/index.ts` — `import { validateHookDocument } from 'cclaw'` fails despite the docs. Evidence: `pnpm build && node -e \"require('./dist').validateHookDocument\"` prints `undefined`. Fix owner: library; blocks ship."
    },
    {
      domain: "data-pipeline",
      label: "Finding",
      body: "R-D-1 (Critical, correctness): dedup CTE orders by `event_ts ASC` instead of `event_ts DESC` — on duplicate events we keep the older row. Evidence: `dbt test --select fact_orders` green but fixture `tests/fixtures/orders-dupes.csv` shows wrong survivor. Fix owner: analytics-eng; blocks ship."
    }
  ],
  ship: [
    {
      domain: "web",
      label: "Rollback",
      body: "Trigger: error rate on `/api/orders/stream` > 2% for 5 minutes, or p95 latency > 1.5s for 10 minutes. Steps: `vercel rollback <deployment>`; run `2026_04_14_revert_orders_stream.sql` before traffic returns. Verify: error rate returns to baseline within 10 minutes on the `orders-live` dashboard."
    },
    {
      domain: "cli",
      label: "Rollback",
      body: "Trigger: `cclaw init --claude` exits non-zero on a fresh tmp dir, OR `cclaw doctor` regresses (FAIL count increases) on the smoke matrix. Steps: `npm unpublish cclaw-cli@<version>` (within the 72h window) or `npm deprecate cclaw-cli@<version> '<reason>'`; publish the previous patch. Verify: `npx cclaw-cli@latest --version` prints the previous version."
    },
    {
      domain: "library",
      label: "Rollback",
      body: "Trigger: any consumer reports `validateHookDocument` no longer exported, OR the CI `dual-package-check` job fails. Steps: `npm deprecate cclaw-cli@<version> 'broken package export — use <prev>'`; publish the previous minor with a patch bump; emit changelog `## Rollback` entry. Verify: a smoke consumer project `pnpm add cclaw-cli@latest` imports cleanly."
    },
    {
      domain: "data-pipeline",
      label: "Rollback",
      body: "Trigger: `dbt test --select fact_orders` fails on production run, OR downstream dashboard MAU count drops >10% week-over-week. Steps: disable the new model via `dbt_project.yml` + `dbt run --select state:modified` with the previous git SHA; rerun backfill `dagster asset materialize fact_orders --partition <yesterday>`. Verify: `fact_orders` row count within ±1% of the previous week's baseline."
    }
  ]
};

export function stageDomainExamples(stage: FlowStage): string {
  const samples = STAGE_DOMAIN_SAMPLES[stage];
  if (!samples || samples.length === 0) return "";
  const lines: string[] = [
    "## Living Examples by Domain",
    "",
    "Use the row matching your project shape to calibrate voice, specificity, and command choice. The rows are deliberately terse — copy the **shape**, not the text.",
    ""
  ];
  for (const sample of samples) {
    lines.push(`**${DOMAIN_LABELS[sample.domain]} — ${sample.label}:** ${sample.body}`);
    lines.push("");
  }
  return lines.join("\n");
}
