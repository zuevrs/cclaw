---
stage: tdd
author: cclaw-eval
created_at: 2026-04-17
---
# TDD — Refund Calculator

## Red

- `computeRefundableAmount(charge, priorRefunds)` returns the remaining
  refundable cents.
- Rejects when the requested amount exceeds the remainder.
- Supports zero prior refunds (returns the full charge amount).
- Treats canceled prior refunds as non-consuming.

Initial run: 4 red tests; function not yet defined.

## Green

Implementation sums non-canceled prior refund amounts and subtracts
from `charge.amount_captured`. Throws `RefundExceedsRemainderError`
when requested > remainder. Uses BigInt-safe cents arithmetic.

Run output: 4 tests green in 8 ms. No production code outside the
calculator module touched.

## Refactor

- Extract remainder math into `RefundLedger.remainderFor(chargeId)`.
- Replace the constructor error with a typed `RefundError` discriminator.

Run output: 4 tests remain green, plus 3 regression tests for the
ledger. Module count unchanged; cohesion improved.
