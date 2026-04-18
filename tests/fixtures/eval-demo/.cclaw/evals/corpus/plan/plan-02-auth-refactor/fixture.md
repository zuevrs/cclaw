---
stage: plan
author: cclaw-eval
created_at: 2026-04-17
---
# Plan — Passkey Migration

## Milestones

- M1: WebAuthn library integrated, feature flag off.
- M2: Internal dogfood: engineering + support can enroll.
- M3: 10% of signed-in users offered enrollment on login.
- M4: GA announcement and documentation update.

## Steps

- S1: Import `@simplewebauthn/server` and author the adapter.
- S2: Wire Redis challenge storage with 5-minute TTL.
- S3: Add `/settings/security` enrollment page.
- S4: Add conditional UI autofill on the login page.
- S5: Cut-over runbook: rollback flag + forced password fallback.

## Risks

- Attestation variance across authenticators (mitigation: broad
  testing with YubiKey, iCloud Keychain, Android, Windows Hello).
- Cross-device ceremonies on legacy browsers.
- Support load spike during M3; staff training completed before M3.
