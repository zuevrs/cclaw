---
stage: ship
author: cclaw-eval
created_at: 2026-04-17
---
# Ship — Dark Mode

## Release Notes

- Dark mode is now available under Settings → Appearance. Choose
  Light, Dark, or System to follow your OS preference.
- Third-party embeds render with explicit light-mode backgrounds
  until vendors publish dark-mode variants.

## Rollout

- Day 0: enable `settings.dark_mode.enabled` for 10% of signed-in
  users and all internal teams.
- Day 2: expand to 50% pending zero critical issues.
- Day 5: enable for 100% and update the marketing page.
- Rollback: flip the flag off; theme provider falls back to light.

## Validation

- Synthetic probe measures first-paint theme match on every deploy.
- Support dashboard tracks refund/complaint tickets tagged `theme`.
- Product analytics dashboard tracks preference distribution.
