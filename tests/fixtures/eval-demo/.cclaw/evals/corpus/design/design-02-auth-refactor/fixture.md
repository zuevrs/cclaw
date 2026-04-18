---
stage: design
author: cclaw-eval
created_at: 2026-04-17
---
# Design — Passkey Provider Adapter

## Context

The auth service currently validates passwords via a bcrypt comparator
and issues JWTs. WebAuthn introduces a challenge/response ceremony with
server-generated challenges that must be single-use and time-bounded.

## Decision

Introduce a `PasskeyProviderAdapter` interface with two methods:
`beginRegistration(user)` and `finishAssertion(credentialResponse)`.
The adapter is implemented by `SimpleWebAuthnProvider`. Challenges are
stored in Redis keyed by `user_id:nonce` with a 5-minute TTL.

## Consequences

- Session cookies gain a `auth_method` claim (`password` or `passkey`).
- Observability sees two new counters: ceremonies issued and completed.
- Rollback plan: flip feature flag `auth.passkey.enabled` off; existing
  password path stays unchanged.
