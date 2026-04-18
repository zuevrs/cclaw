---
stage: spec
author: cclaw-eval
created_at: 2026-04-17
---
# Spec — Passkey Enrollment Endpoints

## Acceptance Criteria

- `POST /api/auth/passkey/register/begin` returns a 200 with an options
  object compatible with `navigator.credentials.create()`.
- `POST /api/auth/passkey/register/finish` stores the credential when
  the attestation verifies and returns `{ credentialId }`.
- `POST /api/auth/passkey/assert/begin` issues a 5-minute challenge.
- `POST /api/auth/passkey/assert/finish` exchanges a valid assertion
  for a session cookie and emits `auth_method=passkey`.
- All endpoints are rate-limited to 10 req/min per IP.

## Interfaces

- OpenAPI schemas live in `openapi/auth/passkey.yaml`.
- Redis keyspace: `passkey:challenge:<user_id>:<nonce>`.
- Feature flag: `auth.passkey.enabled` (boolean, per-environment).

## Non-Goals

- Passkey deletion UI (covered in a follow-up spec).
