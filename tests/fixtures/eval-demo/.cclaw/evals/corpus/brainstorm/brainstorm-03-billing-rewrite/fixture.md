---
stage: brainstorm
author: cclaw-eval
created_at: 2026-04-17
---
# Brainstorm — Partial Refunds

## Directions

- Extend the existing Stripe webhook handler to emit refund events.
- Move the refund pipeline behind a dedicated ledger service.
- Contract a third-party refund orchestrator (Recurly, Maxio).

## Rationalizations

Extending the current handler is fastest but compounds our legacy ledger
debt. A dedicated ledger service is slower but unblocks future features
(revenue recognition, dunning, tax splits).

## Recommendation

Carve out a refund ledger service behind a capability flag. Keep Stripe
as the source of truth for capture events; the ledger is the authority
for refund state.
