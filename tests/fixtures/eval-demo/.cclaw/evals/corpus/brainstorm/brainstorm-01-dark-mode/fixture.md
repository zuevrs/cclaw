---
stage: brainstorm
author: cclaw-eval
created_at: 2026-04-17
---
# Brainstorm — Dark Mode

## Directions

- Pure CSS-variable theming driven by a `data-theme` attribute on `<html>`.
- Runtime theme provider using React context with system-preference fallback.
- Tailwind variants with `dark:` class strategy, server-hydrated via cookie.

## Rationalizations

Users asked for persistent preference across reloads. A cookie-backed
preference avoids a theme flash on first paint, unlike localStorage.

## Recommendation

Ship Tailwind `dark:` variants plus a cookie-based server hint. It covers
SSR, avoids a flash, and leaves room to layer per-theme overrides later.
