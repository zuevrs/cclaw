---
stage: tdd
author: cclaw-eval
created_at: 2026-04-17
---
# TDD — Theme Resolver

## Red

- `resolveTheme(cookieValue, systemPrefersDark)` should return `dark`
  for `cookieValue === "system"` + `systemPrefersDark === true`.
- Should return `light` for `cookieValue === "light"` regardless of
  system preference.
- Should return `system` default when cookie is `null`.

Initial test run: 3 red tests (module not yet exported).

## Green

Minimal implementation: a pure function that branches on cookie value
and falls back to the system preference only for the `system` case.

Run output: all 3 tests green in 12 ms. No production code outside
`resolveTheme` touched.

## Refactor

- Extract literal theme values into a `THEME_MODES` const tuple.
- Drop duplicated fallback branch by short-circuiting on the cookie.

Run output: all 3 tests still green, module LOC went from 24 → 18.

## Decision Traceability

- D-01: cookie-driven preference exercised by the null-cookie test.
- D-02: Tailwind `class` strategy asserted indirectly by the literal
  theme values in `THEME_MODES`.
- D-03: SSR hint test will live alongside the server component and is
  stubbed by this resolver contract.
