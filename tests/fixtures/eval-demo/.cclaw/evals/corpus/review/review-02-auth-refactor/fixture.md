---
stage: review
author: cclaw-eval
created_at: 2026-04-17
---
# Review — Passkey PR

## Findings

- `PasskeyProviderAdapter` correctly enforces challenge TTL and origin
  binding. Unit tests cover the four documented failure modes.
- Redis challenge store uses `SET NX EX 300`; adequate for the expected
  ceremony rate. A dashboard panel already tracks key eviction.
- `auth_method` claim is added to the session token without changing
  the cookie name, preserving downstream consumers.

## Risk

- Conditional UI autofill is Chrome/Safari only today; Firefox users
  fall back to explicit click-to-enroll. Documented in the UX spec.
- Rollback path verified: flipping `auth.passkey.enabled` off returns
  the login page to the password-only state without redeploy.

## Signoff

- @security-owner approved after confirming attestation handling.
- @eng-owner approved after the typed `AssertionError` refactor.
- @support-owner confirmed the runbook update.

Ready for internal dogfood (M2 milestone).
