---
stage: design
author: cclaw-eval
created_at: 2026-04-17
---
# Design — Refund State Machine

## Context

Refunds currently branch through three different services (checkout,
ledger, notifications) with implicit coordination. Races cause duplicate
refund attempts in ~0.3% of operations, visible in support tickets.

## Decision

Introduce a single refund aggregate with explicit states: `requested`,
`approved`, `submitted`, `completed`, `failed`. Transitions are driven
by domain events persisted in an append-only log. Stripe is the only
external actor; all other services subscribe to events.

## Consequences

- Checkout and notifications lose write access to refund tables.
- Replaying the event log reconstructs any aggregate deterministically.
- Backfill script required for in-flight refunds at cutover; feature
  flag `refunds.aggregate.enabled` gates reads during migration.
