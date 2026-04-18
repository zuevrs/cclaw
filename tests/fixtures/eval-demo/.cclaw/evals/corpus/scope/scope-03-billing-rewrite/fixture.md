---
stage: scope
author: cclaw-eval
created_at: 2026-04-17
---
# Scope — Partial Refunds

## Goals

- Support partial refunds initiated by customer support within 120 days.
- Reflect refunded amounts in usage-based invoices the next billing cycle.
- Emit a `refund.partial.completed` event for downstream reporting.

## Non-Goals

- Self-service refunds from the customer portal.
- Automatic refunds driven by SLA credits (tracked separately).
- Currency conversion on refund (refund in the original currency).

## Decisions

- D-01: Refunds are idempotent via the Stripe `idempotency_key` pattern.
- D-02: Ledger service is the only writer to refund-state tables.
- D-03: Prorations are computed server-side, never trusted from the UI.
