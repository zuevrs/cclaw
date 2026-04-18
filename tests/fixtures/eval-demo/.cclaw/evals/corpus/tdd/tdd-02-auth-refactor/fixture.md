---
stage: tdd
author: cclaw-eval
created_at: 2026-04-17
---
# TDD — Passkey Challenge Verifier

## Red

- `verifyAssertion(challenge, response)` rejects when the signature
  does not match the stored public key.
- Rejects when the challenge has expired (Redis TTL exceeded).
- Rejects when the origin in `clientDataJSON` does not match config.
- Accepts a valid signature, fresh challenge, and matching origin.

Initial run: 4 red tests; verifier throws `NotImplementedError`.

## Green

Implementation calls `@simplewebauthn/server` verifyAssertion, wires
origin/clientDataJSON check, and reads challenge from Redis. Fails
closed on any adapter error.

Run output: 4 tests green in 45 ms. No production code changes beyond
`passkey/verifier.ts` + dependency wiring.

## Refactor

- Extract Redis challenge lookup into `ChallengeStore.consume(userId, nonce)`.
- Replace ad-hoc error strings with typed `AssertionError` variants.

Run output: 4 tests still green, plus 2 new unit tests for
`ChallengeStore` making the store a tested unit.
