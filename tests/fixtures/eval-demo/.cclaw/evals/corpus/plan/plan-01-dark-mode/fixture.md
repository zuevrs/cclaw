---
stage: plan
author: cclaw-eval
created_at: 2026-04-17
---
# Plan — Dark Mode Rollout

## Milestones

- M1: Tokens + Tailwind `class` strategy live behind a feature flag.
- M2: Server-side cookie hint + SSR theme attribute emitted.
- M3: Settings page toggle ships to 10% traffic, then 100%.

## Steps

- S1: Extract raw color values into CSS custom properties.
- S2: Author `ThemeProvider` + hook; unit-test SSR branches.
- S3: Audit third-party widgets; wrap those that ignore `data-theme`.
- S4: Instrument preference change counter and theme-flash timing.
- S5: Gate rollout on the `settings.dark_mode.enabled` flag.

## Risks

- Third-party embeds that ignore the attribute (mitigation: S3 wrap).
- Theme flash on reload if cookie is stripped by a CDN (mitigation:
  allowlist `cclaw_theme` in CDN edge config before M2).
- Old Safari versions without `color-scheme` support.
