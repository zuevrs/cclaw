---
stage: design
author: cclaw-eval
created_at: 2026-04-17
---
# Design — Dark Mode Theming Layer

## Context

The app renders with Next.js App Router and SSR. Current CSS relies on
plain Tailwind with no `dark:` variants. Most colors live in the
Tailwind config and a few one-off custom properties in `globals.css`.

## Decision

Introduce a single `ThemeProvider` mounted at the root layout. It reads
the `cclaw_theme` cookie on the server, emits `<html data-theme="...">`,
and hydrates a client toggle. Tailwind runs in `darkMode: "class"` mode
so `dark:` variants are compiled once and selected by the attribute.

## Consequences

- `globals.css` must expose both light and dark CSS custom properties.
- Image assets get a 3-tier fallback: per-theme variant, generic, alt.
- Third-party widgets that ignore `data-theme` need wrapper styling.
