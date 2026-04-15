import type { FlowStage } from "../types.js";

const STAGE_EXAMPLES: Record<FlowStage, string> = {
  brainstorm: `### Context

- **Project state:** Monorepo with CI pipeline using custom release scripts. Release checks are scattered across shell scripts with no shared validation logic.
- **Relevant existing code/patterns:** \`scripts/pre-publish.sh\` does metadata checks. \`src/release/\` has partial validation helpers.

### Problem

- **What we're solving:** release checks are fragile and inconsistent between CI and local runs. Invalid metadata sometimes reaches npm publish.
- **Success criteria:** invalid release preconditions are caught before publish with explicit operator feedback, in both CI and local workflows.
- **Constraints:** no new runtime dependencies; must work within existing CI pipeline structure.

### Clarifying Questions

| # | Question | Answer | Decision impact |
| --- | --- | --- | --- |
| 1 | If release metadata is invalid, should we block publishing hard or only warn? | Block hard. | Validation becomes a mandatory gate — no warning-only fallback. |
| 2 | Should the validation logic live in a reusable module or stay as shell scripts? | Reusable module. | Architecture: shared TypeScript module imported by CI and local tooling, not duplicated shell scripts. |
| 3 | For v1, prioritize rapid delivery or maximum configurability? | Rapid delivery. | Minimal deterministic validation surface; defer plugin/config system to v2. |

### Approaches

| Approach | Architecture | Trade-offs | Recommendation |
| --- | --- | --- | --- |
| A: Reusable validation module | Shared TS module with typed validators, imported by CI scripts and local CLI. Existing \`pre-publish.sh\` calls the module. | Medium upfront effort, high reuse. Requires test coverage for the module. | **Recommended** — best balance of reuse and delivery speed. |
| B: Hardened shell scripts | Keep existing script approach, add stricter checks and error messages. | Lowest effort. Weak reuse, CI/local divergence risk grows over time. | Viable fallback if TS module is blocked. |
| C: Full release framework | New release orchestrator with plugin system, config files, rollback commands. | Maximum flexibility. High risk, delivery delay, over-engineered for current needs. | Not recommended for v1. |

### Selected Direction

- **Approach:** A — Reusable validation module
- **Rationale:** shared TS module gives consistent behavior in CI and local, avoids script duplication, and stays within the no-new-dependency constraint.
- **Approval:** approved

### Design

- **Architecture:** single \`release-validator\` module in \`src/release/\` exporting typed check functions. CI script and local CLI both import and run the same checks.
- **Key components:** \`validateMetadata()\`, \`validateChangelog()\`, \`validateVersion()\` — each returns a typed result with error details. A \`runAll()\` orchestrator runs checks and exits non-zero on any failure.
- **Data flow:** package.json + CHANGELOG.md → validator module → structured result → CI/CLI renders human-readable report.

### Assumptions and Open Questions

- **Assumptions:** CI remains the primary execution path; existing release metadata files remain the source of truth; v1 prioritizes determinism over customization.
- **Open questions:** What exact rollback sequence for failed publish? Should status output include machine-readable JSON alongside markdown?

### Notes for the next stage

Carry the no-new-dependency constraint and hard-block behavior directly into scope in/out boundaries.`,

  scope: `### Scope contract

**Mode selected:** SELECTIVE EXPANSION
**Default heuristic used:** feature enhancement -> selective
**Mode-specific analysis result:** hold-scope baseline accepted first; one expansion accepted (degraded-state UX), one deferred (real-time channel upgrade).

### Prime Directives (applied)

- Zero silent failures: every delivery failure maps to a visible degraded state.
- Named error surfaces: stream disconnect, auth drift, and publisher timeout are explicit.
- Four-path data flow mapped: happy, nil payload, empty payload, upstream publish error.
- Interaction edge cases in scope: double-open panel, reconnect after sleep, stale tab state.
- Observability in scope: stream error counter, publish-to-visible lag metric, and alert threshold.

### Premise challenge result

The original premise (“add notifications”) was reframed to **“ensure users know when an action requires follow-up”**, which expands the solution space beyond toast spam to include durable inbox items, empty states, and recovery paths when delivery fails.

### Dream State Mapping

| Stage | Statement |
| --- | --- |
| **CURRENT STATE** | Users miss time-sensitive follow-ups because alerts are ephemeral and not recoverable. |
| **THIS PLAN** | Introduce durable in-app feed + live updates + explicit degraded mode fallback. |
| **12-MONTH IDEAL** | Unified notification center with reliable multi-channel fan-out and user-level routing preferences. |
| **Alignment verdict** | Aligned: this scope builds the durability foundation without prematurely committing to channel expansion. |

### Implementation Alternatives

| Option | Summary | Effort (S/M/L/XL) | Risk | Pros | Cons | Reuses |
| --- | --- | --- | --- | --- | --- | --- |
| **A (minimum viable)** | Polling-only feed with no live stream | S | Low | Fastest ship, low infra risk | Weaker UX, delayed visibility | Existing REST snapshot endpoint |
| **B (recommended)** | SSE live updates + REST fallback snapshot | M | Med | Better timeliness, graceful degradation | Requires reconnect handling | Existing event publisher + REST path |
| **C (ideal architecture)** | Event bus + WebSocket channel + feed projection | XL | High | Strong long-term scalability | Overbuilt for current demand | Partial reuse of publisher only |

### Temporal Interrogation

| Time slice | Likely decision pressure | Lock now or defer? | Reason |
| --- | --- | --- | --- |
| **HOUR 1 (foundations)** | Canonical event schema and dedupe key policy | **Lock now** | Prevent downstream rework in storage and UI merge behavior |
| **HOUR 2-3 (core logic)** | Retry/backoff semantics for stream loss | **Lock now** | Impacts both backend signaling and client state machine |
| **HOUR 4-5 (integration)** | Handling gaps between snapshot and stream cursor | **Lock now** | Prevent silent data loss during reconnect windows |
| **HOUR 6+ (polish/tests)** | Banner copy tone and polling cadence tuning | **Defer** | Safe to iterate after baseline reliability is proven |

### In scope / out of scope / deferred

| Category | Items |
| --- | --- |
| **In scope** | In-app notification feed; SSE delivery path; read/unread state; basic retry on transient failures |
| **Out of scope** | Email/SMS/push providers; marketing campaigns; per-user notification preferences beyond on/off |
| **Deferred** | WebSocket channel; rich media attachments in notifications; full-text search across historical events |

### Discretion Areas

- Client-side badge rendering strategy (optimistic vs server-confirmed) is implementation discretion.
- Polling fallback backoff curve is implementation discretion if degraded-state UX remains explicit.

### Error & Rescue Registry (sample entry)

| Capability | Failure mode | Detection | Fallback |
| --- | --- | --- | --- |
| Event delivery | SSE connection drops mid-session | Client \`EventSource\` error event + heartbeat timeout | Fall back to REST polling every 30s until SSE reconnect succeeds; show subtle “live updates paused” banner |

### Completion Dashboard

- Checklist findings: 9/9 complete (complex path)
- Resolved decisions count: 7
- Unresolved decisions: None

### Scope Summary

- Accepted scope: durable feed + SSE + explicit degraded UX.
- Deferred: WebSocket channel and rich-media/search enhancements.
- Explicitly excluded: outbound channels and marketing workflows for v1.`,

  design: `### Codebase Investigation (blast-radius files)

| File | Current responsibility | Patterns discovered |
| --- | --- | --- |
| \`src/api/routes/user.ts\` | User CRUD endpoints | Express router, Zod validation, throws \`AppError\` |
| \`src/services/event-bus.ts\` | In-process pub/sub | EventEmitter wrapper, typed channels, no persistence |
| \`src/middleware/auth.ts\` | JWT verification | Extracts user from token, attaches to \`req.context\` |
| \`tests/integration/user.test.ts\` | User route tests | Supertest, factory helpers, \`beforeEach\` DB reset |

Discovery: existing EventEmitter-based bus has no durability — notifications must add persistence layer on top, not replace the bus.

### Search Before Building (sample result)

| Layer | Label | What to reuse first |
| --- | --- | --- |
| Layer 1 | stdlib | Built-in timers, structured logging patterns, standard error types |
| Layer 2 | existing codebase | Existing auth middleware, existing API client wrapper, existing feature flags helper |
| Layer 3 | npm | A small, well-maintained SSE helper (only if Layer 1–2 cannot cover framing/reconnect ergonomics) |

### Architecture Diagram (mandatory)

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

### What Already Exists

| Sub-problem | Existing code/library | Layer | Reuse decision |
| --- | --- | --- | --- |
| Auth context extraction | \`src/middleware/auth.ts\` | Layer 1 | Reuse as-is |
| Event fan-out | \`src/services/event-bus.ts\` | Layer 2 | Wrap with persistence adapter |
| SSE framing | None | Layer 3 | Evaluate \`better-sse\` npm package |
| Notification schema | None | — | New: define in \`src/schemas/notification.ts\` |

### Failure Mode Table

| Failure | Trigger | Detection | Mitigation | User impact |
| --- | --- | --- | --- | --- |
| SSE connection drop | Network interruption | Client heartbeat timeout (30s) | Auto-reconnect with exponential backoff + snapshot fallback | Brief delay (≤10s), no data loss |
| Duplicate publish | Retry after timeout | Dedupe key check in outbox | Upsert with idempotency key | None (transparent) |
| Queue backpressure | Spike >1000 events/s | Queue depth metric alarm | Back-pressure signal to publisher, shed non-critical events | Delayed delivery of low-priority notifications |

### NOT in scope

- Outbound channels (email, push, SMS) — deferred to v2.
- Admin notification management UI — separate workstream.
- Notification preferences / mute rules — requires user settings redesign.

### Unresolved Decisions

| Decision | Status | Options | Missing info | Default if unanswered |
| --- | --- | --- | --- | --- |
| Feed storage model | OPEN | (A) append-only event log, (B) mutable rows, (C) hybrid | Load testing results on read patterns | (A) append-only — safest for audit trail |

### Interface sketch (non-binding)

- **Client → server:** \`GET /api/me/notifications/snapshot?limit=50\` plus optional cursor parameters (if adopted).
- **Server → client:** \`GET /api/me/notifications/stream\` as SSE with periodic heartbeats.

### Completion Dashboard

| Review Section | Status | Issues |
| --- | --- | --- |
| Architecture Review | issues-found-resolved | Decided on outbox pattern over direct pub/sub |
| Code Quality Review | clear | — |
| Test Review | issues-found-resolved | Added integration test gap for SSE reconnect |
| Performance Review | clear | — |
| Distribution & Delivery Review | clear | — |

**Decisions made:** 4 | **Unresolved:** 1 (feed storage model)

### Quality bar for this stage

Design output should be **reviewable by someone who did not attend brainstorming**: they can trace from constraints → components → open decisions without reading code.`,

    spec: `### Acceptance criteria (Given / When / Then)

**Criterion 1 — delivery**

- **Given** a signed-in user with an active session
- **When** the server publishes a new notification event for that user
- **Then** the client feed shows the new item within 5 seconds without a full page reload

**Criterion 2 — idempotency**

- **Given** the same logical notification is published twice with the same dedupe key
- **When** the client processes the stream
- **Then** the feed contains exactly one visible item for that key

**Criterion 3 — failure visibility**

- **Given** the live connection is unavailable
- **When** the user opens the notifications panel
- **Then** the UI shows a non-blocking degraded state and still loads the latest snapshot via REST

### Non-testable → fixed (comparison)

| Vague (non-testable) | Fixed (observable + testable) |
| --- | --- |
| “Notifications should be fast.” | “p95 time from publish to visible feed update ≤ 5s under steady load.” |
| “The system should handle errors gracefully.” | “If SSE is down, panel renders REST snapshot within 2s and shows ‘live updates paused’.” |
| “Users should not see duplicates.” | “For dedupe key K, repeated publishes produce exactly one row with key K.” |

### Test doubles / fixtures (planning notes)

- Use a deterministic clock for the “within 5 seconds” criterion in automated tests.
- Use a fake transport for SSE in unit tests; reserve browser-level tests for one happy path + one degraded path.

### Traceability reminder

Every criterion should map to **at least one automated check** (unit/integration/e2e) before the work is considered “specified enough” to start TDD in earnest.`,

  plan: `### Task breakdown (sample)

| ID | Title | depends_on | acceptance_criteria | estimated_effort |
| --- | --- | --- | --- | --- |
| T1 | Define notification event schema + dedupe key rules | — | Spec criteria 2 satisfied in a written contract + fixtures | S |
| T2 | Implement publisher + outbox write path | T1 | Spec criterion 1 satisfied in integration test (happy path) | M |
| T3 | Implement client feed + SSE subscribe + REST fallback | T1, T2 | Spec criteria 1–3 satisfied in e2e-style tests (including degraded mode) | L |

### Dependency graph (ASCII)

\`\`\`
T1 ──▶ T2 ──▶ T3
 │            ▲
 └────────────┘
\`\`\`

### Acceptance mapping (sample)

| Spec criterion | Tasks that cover it | Notes |
| --- | --- | --- |
| Criterion 1 (delivery) | T2, T3 | T2 proves publish path; T3 proves UI subscription path |
| Criterion 2 (idempotency) | T1, T2 | Schema + publisher tests must include dedupe cases |
| Criterion 3 (failure visibility) | T3 | Explicit degraded-mode test case |

### Sequencing rationale (sample)

- **T1 first** prevents rework when event keys change mid-build.
- **T2 before T3** ensures the UI is not built on a mocked publisher that will not match production semantics.
- **T3 last** integrates transport concerns once contracts are stable.

### Risk note

If T3 grows too large, split “transport” vs “UI state machine” into two tasks while keeping the dependency graph acyclic.`,

  tdd: `### RED test (Vitest) — written before production code

\`\`\`typescript
import { describe, it, expect } from "vitest";
import { summarizeDedupedFeed } from "../notificationFeed";

describe("summarizeDedupedFeed", () => {
  it("counts unique keys and unread items", () => {
    const summary = summarizeDedupedFeed([
      { dedupeKey: "a", read: false },
      { dedupeKey: "a", read: true },
      { dedupeKey: "b", read: false },
    ]);

    expect(summary).toEqual({ uniqueKeys: 2, unread: 1 });
  });
});
\`\`\`

### Expected output (FAIL)

\`\`\`bash
 FAIL  src/notificationFeed.test.ts
Error: Cannot find module '../notificationFeed' imported from src/notificationFeed.test.ts
\`\`\`

> **Annotation:** This test MUST fail before any production code is written.

### Iron Law verification

1. **Run** the test command (for example: \`pnpm vitest run src/notificationFeed.test.ts\`).
2. **Read output** and confirm the failure is due to the module/function not existing (or the function throwing “not implemented”), not due to a typo in assertions.
3. **Confirm** the failure reason matches the intentional gap: **missing implementation**, not a flaky environment or misconfigured test runner.

### Common mistakes to avoid

- “GREEN” that secretly imports a helper that already implements the behavior (that is skipping RED).
- Assertions that pass because the function returns \`undefined\` and the matcher is too loose.

### GREEN (minimal implementation to pass RED)

\`\`\`typescript
export type FeedItem = { dedupeKey: string; read: boolean };

export function summarizeDedupedFeed(items: FeedItem[]) {
  // Last write wins per dedupeKey (stable ordering: later items override earlier ones).
  const latestReadByKey = new Map<string, boolean>();

  for (const item of items) {
    latestReadByKey.set(item.dedupeKey, item.read);
  }

  let unread = 0;
  for (const read of latestReadByKey.values()) {
    if (!read) unread += 1;
  }

  return { uniqueKeys: latestReadByKey.size, unread };
}
\`\`\`

### REFACTOR (keep tests green)

Keep semantics identical, but make the merge step explicit and easier to unit test in isolation:

\`\`\`typescript
export type FeedItem = { dedupeKey: string; read: boolean };

function mergeLatestByDedupeKey(items: FeedItem[]) {
  const latestReadByKey = new Map<string, boolean>();
  for (const item of items) latestReadByKey.set(item.dedupeKey, item.read);
  return latestReadByKey;
}

export function summarizeDedupedFeed(items: FeedItem[]) {
  const latestReadByKey = mergeLatestByDedupeKey(items);

  let unread = 0;
  for (const read of latestReadByKey.values()) {
    if (!read) unread += 1;
  }

  return { uniqueKeys: latestReadByKey.size, unread };
}
\`\`\`

### Sample terminal output (GREEN)

\`\`\`bash
 RUN  v2.1.0 /Users/dev/app

 ✓ src/notificationFeed.test.ts (1 test) 12ms

 Test Files  1 passed (1)
      Tests  1 passed (1)
 Tests: 1 passed.
\`\`\``,

  review: `### Layer 1 — Spec compliance (per-criterion)

| Criterion | Status | Evidence |
| --- | --- | --- |
| Delivery within 5s without reload | PASS | \`notification-feed.e2e.ts:44-88\` asserts SSE-to-UI timing under mock clock |
| Dedupe: one visible item per key | PARTIAL | Unit tests cover publisher dedupe; UI merge path lacks test for race reordering (\`feedStore.test.ts\` missing case) |
| Degraded mode + REST snapshot | PASS | \`NotificationsPanel.tsx:112-140\` renders banner + calls snapshot endpoint |

### Layer 2 — Engineering finding (sample)

- **Severity:** Major
- **Description:** Snapshot endpoint returns newest N rows but does not guarantee consistency with stream cursor, so users can miss items that arrived between snapshot and subscribe.
- **File:line:** \`server/routes/notifications.ts:208\`
- **Recommendation:** Return a monotonic cursor with snapshot and initialize SSE from that cursor; add contract tests for gapless delivery.
- **Resolution options:**
  1. Add cursor field + server-side reconciliation on subscribe (preferred).
  2. Client-side “fetch since last seen id” merge pass (more complex, easier to get wrong).
  3. Temporary mitigation: widen polling window when SSE is unhealthy (acceptable only as a short-term bridge).

### Layer 0 — hygiene checks (sample)

- **Dependency freshness:** no critical CVEs in direct server dependencies (scanner report linked in PR).
- **Secrets:** no new env vars committed; rotation playbook unchanged.

### Exit criteria (sample)

- All **Major** findings resolved or explicitly accepted with a time-bounded follow-up ticket.
- **PARTIAL** spec compliance items have a named owner and a test plan before ship.`,

  ship: `### Preflight checklist (sample)

- tests ✅ (\`pnpm test\` green on main)
- build ✅ (\`pnpm build\` succeeds)
- lint ✅ (\`pnpm lint\` clean)
- type-check ✅ (\`pnpm typecheck\` clean)

### Release notes (sample)

- **Added:** In-app notification feed with SSE updates and REST fallback snapshotting.
- **Changed:** Notification payloads now include a stable dedupe key for idempotent rendering.
- **Fixed:** Panel no longer drops the newest item when reconnecting after sleep/resume.

### Rollback plan (sample)

1. Revert release tag \`v1.14.0\` to \`v1.13.2\` and redeploy the previous container image from the registry.
2. If database migrations shipped, run the documented down migration \`2026_04_12_notifications_cursor_down.sql\` before serving traffic again.

### Post-release monitoring (sample)

- Watch error rate on \`/notifications/stream\` and snapshot endpoint separately for 24 hours.
- Track p95 “publish → visible” lag via existing metrics dashboard; alert if SLO regresses.

### Communications (sample)

- Post a short internal changelog entry linking to release notes and rollback doc location.
- If user-visible behavior changes, prepare a one-paragraph support macro explaining the new feed + fallback behavior.`,
};

export function stageExamples(stage: FlowStage): string {
  const examples = STAGE_EXAMPLES[stage];
  if (!examples) return "";
  return `## Examples\n\nConcrete samples of what good output looks like for this stage.\n\n${examples}\n`;
}
