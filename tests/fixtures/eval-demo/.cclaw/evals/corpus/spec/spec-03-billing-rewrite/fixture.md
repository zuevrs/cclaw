---
stage: spec
author: cclaw-eval
created_at: 2026-04-17
---
# Spec — Partial Refund API

## Acceptance Criteria

- `POST /api/refunds` accepts `{ charge_id, amount_cents, reason }`.
- Idempotent via the `Idempotency-Key` header; repeats within 24h
  return the original response with `status: "idempotent"`.
- Rejects amounts above the original charge minus prior refunds.
- Emits `refund.partial.completed` to Kafka upon Stripe confirmation.
- Returns the refund aggregate including `ledger_entry_id`.

## Interfaces

- OpenAPI schemas live in `openapi/billing/refunds.yaml`.
- Event schema: `com.cclaw.billing.refund.partial.completed` v1 in the
  schema registry.
- DB: `refund_aggregates` (append-only), `refund_events` (event log).

## Non-Goals

- Multi-currency refunds.
- Offline refunds without a captured charge.
