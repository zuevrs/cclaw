---
stage: scope
author: cclaw-eval
created_at: 2026-04-17
---
# Scope — Passkey Migration

## Goals

- Enable passkey enrollment for all users in the /settings/security page.
- Accept passkey sign-in on the primary login page alongside password.
- Preserve existing password flow unchanged for 90 days post-launch.

## Non-Goals

- Step-up authentication for high-risk actions.
- Passkey recovery via physical security keys.
- SSO integration beyond the existing OIDC surface.

## Decisions

- D-01: Use WebAuthn level 3 with conditional UI (autofill-first).
- D-02: Store credential IDs in Postgres with per-user salt index.
- D-03: Fall back to password only when no credential is presented.
