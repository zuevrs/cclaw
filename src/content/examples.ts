import type { FlowStage } from "../types.js";

const STAGE_EXAMPLES: Record<FlowStage, string> = {
  brainstorm: `### Alternatives comparison

| Approach | Pros | Cons | Effort | Recommendation |
| --- | --- | --- | --- | --- |
| REST + polling | Simple to deploy; works through strict proxies; easy to cache | Higher latency; wasted requests; battery use on mobile | Low | Good default when real-time is not required |
| WebSocket | Lowest latency; bidirectional; efficient for bursts | More ops complexity; reconnect/state sync; harder through some gateways | Medium | Prefer when server must push frequently or conversationally |
| SSE | One-way server push over HTTP; simpler than WebSockets for “notify only” | Unidirectional; browser connection limits; proxy buffering quirks | Low–Medium | Prefer for live dashboards and one-way event streams |

### Approved Direction

We will ship **SSE for server-originated notifications** to the web client first, because the UX requires timely delivery without bidirectional chat. We will keep a **REST fallback** for environments where SSE is unreliable, and we will defer WebSockets until we have a concrete bidirectional requirement (collaborative editing).

### Open Questions

- Do we need guaranteed delivery semantics (at-least-once vs best-effort) for in-app banners?
- What is the maximum event rate we must support per user session without degrading the UI thread?
- Should mobile clients reuse the same event channel contract or expose a separate polling endpoint?

### Assumptions (explicit)

- Users are authenticated; anonymous traffic does not receive personalized streams.
- “Notification” means **account-scoped operational messages**, not third-party ads.
- The first release optimizes for **web**; native clients can lag by one sprint.

### Constraints

- No new infrastructure class (managed broker) unless latency goals are missed in a spike.
- Compliance requires auditability: who saw what, when — at least at coarse granularity.

### Notes for the next stage

Capture the chosen direction as a **single paragraph decision** (above) and ensure open questions are either answered in scope or explicitly deferred with an owner + date.`,

  scope: `### Scope contract

**Mode selected:** SELECTIVE EXPANSION

**Premise challenge result:** The original premise (“add notifications”) was reframed to **“ensure users know when an action requires follow-up”**, which expands the solution space beyond toast spam to include durable inbox items, empty states, and recovery paths when delivery fails.

### In scope / out of scope / deferred

| Category | Items |
| --- | --- |
| **In scope** | In-app notification feed; SSE delivery path; read/unread state; basic retry on transient failures |
| **Out of scope** | Email/SMS/push providers; marketing campaigns; per-user notification preferences beyond on/off |
| **Deferred** | WebSocket channel; rich media attachments in notifications; full-text search across historical events |

### Error & Rescue Registry (sample entry)

| Capability | Failure mode | Detection | Fallback |
| --- | --- | --- | --- |
| Event delivery | SSE connection drops mid-session | Client \`EventSource\` error event + heartbeat timeout | Fall back to REST polling every 30s until SSE reconnect succeeds; show subtle “live updates paused” banner |

### Non-goals (guardrails)

- No “infinite history” guarantee in v1; retention policy can be time-bounded.
- No cross-tenant fan-out optimizations until multi-tenant load tests exist.

### Owners & checkpoints

- **Product:** confirms reframed premise and acceptance of deferred items.
- **Engineering:** confirms SSE + REST snapshot split is feasible behind current gateway.
- **Checkpoint:** scope sign-off happens before detailed component design changes land in the repo.`,

  design: `### Search Before Building (sample result)

| Layer | Label | What to reuse first |
| --- | --- | --- |
| Layer 1 | stdlib | Built-in timers, structured logging patterns, standard error types |
| Layer 2 | existing codebase | Existing auth middleware, existing API client wrapper, existing feature flags helper |
| Layer 3 | npm | A small, well-maintained SSE helper (only if Layer 1–2 cannot cover framing/reconnect ergonomics) |

### Minimal component diagram (ASCII)

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

### Unresolved Decision (sample entry)

- **Decision:** Should the feed be modeled as append-only events or as CRUD “notification rows”?
- **Status:** OPEN
- **Options:** (A) append-only event log + projection, (B) mutable rows with status fields, (C) hybrid with compaction job
- **Deadline:** Decide before implementation of persistence migrations (end of week)

### Interface sketch (non-binding)

- **Client → server:** \`GET /api/me/notifications/snapshot?limit=50\` plus optional cursor parameters (if adopted).
- **Server → client:** \`GET /api/me/notifications/stream\` as SSE with periodic heartbeats.

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
