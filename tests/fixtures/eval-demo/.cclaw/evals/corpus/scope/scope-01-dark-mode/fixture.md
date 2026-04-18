---
stage: scope
author: cclaw-eval
created_at: 2026-04-17
---
# Scope — Dark Mode

## Goals

- Ship a user-controlled light/dark/system toggle across the web app.
- Persist preference server-side for signed-in users, cookie-side for guests.
- Zero theme flash on first paint, including SSR.

## Non-Goals

- Per-component custom themes.
- Automatic time-of-day switching.
- Accessibility high-contrast mode (tracked separately).

## Decisions

- D-01: Preference stored in an HttpOnly cookie named `cclaw_theme`.
- D-02: Tailwind `class` dark mode strategy, toggled on `<html>`.
- D-03: SSR hint resolved in the root layout via a server component.
