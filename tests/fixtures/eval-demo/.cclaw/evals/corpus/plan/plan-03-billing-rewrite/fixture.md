---
stage: plan
author: cclaw-eval
created_at: 2026-04-17
---
# Plan — Refund Rewrite

## Milestones

- M1: Refund aggregate schema + event log live, writes dual-gated.
- M2: Ledger service is the sole writer; legacy paths are read-only.
- M3: Partial-refund UI enabled for support agents.
- M4: Legacy refund code removed; observability snapshot archived.

## Steps

- S1: Stand up `refund_aggregates` + `refund_events` tables.
- S2: Implement the aggregate service with idempotency keys.
- S3: Backfill script for in-flight refunds; replay-safe.
- S4: Route Stripe webhooks through the aggregate; shadow compare.
- S5: Flip `refunds.aggregate.enabled`; legacy path reads only.

## Risks

- Shadow-comparison false positives from floating-point math.
- Partial rollbacks if step S4 reveals event ordering bugs.
- Ledger service becomes a new hot-path SPOF (mitigation: multi-AZ
  deployment + circuit breaker on webhook ingress).

## Decision Traceability

- D-01 (idempotency keys) is implemented by S2 and shadow-tested in S4.
- D-02 (ledger-only writer) is the defining constraint for M2 cut-over.
- D-03 (server-side prorations) guards the S2 aggregate boundary.
