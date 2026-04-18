---
stage: review
author: cclaw-eval
created_at: 2026-04-17
---
# Review — Dark Mode PR

## Findings

- ThemeProvider correctly reads the cookie on the server and hydrates
  a client toggle without a re-mount.
- Tailwind config now uses `darkMode: "class"`; generated CSS size
  grew 3.2KB gzipped (acceptable).
- One third-party widget (`<StripeCheckoutButton>`) ignores the
  attribute; a wrapper div was added with explicit light-mode styles.

## Risk

- Theme flash risk on the sign-in page was mitigated by the cookie
  hint, but the Vercel edge CDN must allowlist `cclaw_theme` before
  this PR ships. Owner confirmed the edge config change merged.
- Screen reader announcements unchanged; a11y spot-check passed.

## Signoff

- @eng-owner approved after addressing contrast feedback.
- @design-owner approved the token values.
- @qa-owner verified across Chrome, Safari, Firefox, and Edge.

Ready to ship under flag `settings.dark_mode.enabled`.
