---
stage: brainstorm
author: cclaw-eval
created_at: 2026-04-17
---
# Brainstorm — Passkeys

## Directions

- Adopt WebAuthn passkeys via a hosted provider (Auth0, Clerk, Descope).
- Roll a thin in-house WebAuthn wrapper over `@simplewebauthn/server`.
- Dual-run passwords + passkeys for 90 days, then deprecate passwords.

## Rationalizations

A hosted provider shortens time-to-value but locks us into their DX.
An in-house wrapper stays light today yet inherits WebAuthn edge-case
complexity (attestation, conditional UI, cross-device flow).

## Recommendation

Start with the in-house wrapper behind a feature flag. Reassess after we
exceed 100k monthly passkey ceremonies.
