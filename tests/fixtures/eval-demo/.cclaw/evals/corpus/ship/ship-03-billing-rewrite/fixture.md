---
stage: ship
author: cclaw-eval
created_at: 2026-04-17
---
# Ship — Partial Refunds

## Release Notes

- Support agents can issue partial refunds up to 120 days after a
  charge. Refunds emit `refund.partial.completed` events consumed by
  the revenue reporting pipeline.
- The new refund ledger is authoritative; legacy refund paths are
  read-only during this release cycle.

## Rollout

- Day 0: Enable `refunds.aggregate.enabled` in staging with synthetic
  traffic replay from the last 7 days.
- Day 2: Enable in production for internal agents only.
- Day 7: 25% of support queues; 100% after a clean 48-hour window.
- Rollback: legacy writers remain available behind a dual-write flag
  until the Day-14 checkpoint.

## Validation

- Shadow-compare job exits clean (zero divergence) for 72 hours.
- `refund.partial.completed` landing rate tracked in Kafka consumer
  lag dashboard; target < 5s p95.
- Support dashboard tracks refund dispute rate (no regression).
