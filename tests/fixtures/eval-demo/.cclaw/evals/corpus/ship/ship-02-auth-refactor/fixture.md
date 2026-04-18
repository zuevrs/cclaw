---
stage: ship
author: cclaw-eval
created_at: 2026-04-17
---
# Ship — Passkeys

## Release Notes

- You can now sign in with a passkey. Manage passkeys under
  Settings → Security. Passwords continue to work during a 90-day
  transition window.
- Authenticators tested: iCloud Keychain, Windows Hello, Android, and
  YubiKey. Cross-device sign-in is supported on Chromium browsers.

## Rollout

- Day 0: `auth.passkey.enabled` on for employees only.
- Day 7: 10% of signed-in users see the passkey enrollment prompt.
- Day 21: 100% enrollment; passwords remain the fallback.
- Rollback: flip the flag; login reverts to password-only without
  a redeploy.

## Validation

- Enrollment funnel dashboard (start → WebAuthn ceremony → stored).
- Ceremony success rate target: >98% across tested authenticators.
- Incident runbook: `runbooks/auth-passkey.md`.
