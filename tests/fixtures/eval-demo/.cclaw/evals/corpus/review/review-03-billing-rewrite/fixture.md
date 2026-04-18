---
stage: review
author: cclaw-eval
created_at: 2026-04-17
---
# Review — Partial Refund PR

## Findings

- Refund aggregate writes are now gated by the idempotency key and a
  unique index on `(charge_id, idempotency_key)`. Race prevented.
- Shadow comparison ran for 7 days with zero divergences after the
  floating-point fix landed (commit 9ae40b2). Ready to flip.
- Kafka schema `refund.partial.completed v1` registered and backfilled
  into staging consumers.

## Risk

- Legacy refund writers are still present but behind a read-only flag.
  A follow-up PR removes them after one release cycle.
- Ledger service SLA: 99.9% target with an auto-failover runbook. An
  operator dry-run is scheduled before GA.

## Signoff

- @billing-owner approved after the shadow-compare evidence.
- @sre-owner approved the failover runbook and dashboards.
- @support-owner confirmed the refund-UI demo and training slides.

Cleared for controlled rollout behind `refunds.aggregate.enabled`.
