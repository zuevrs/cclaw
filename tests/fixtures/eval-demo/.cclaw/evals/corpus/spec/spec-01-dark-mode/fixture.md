---
stage: spec
author: cclaw-eval
created_at: 2026-04-17
---
# Spec — Dark Mode Toggle

## Acceptance Criteria

- Toggle in `/settings/appearance` offers Light, Dark, System options.
- Selection persists across browsers for a signed-in user.
- Anonymous users get the same behavior via `cclaw_theme` cookie.
- First paint on any route matches the persisted preference with no
  intermediate flash.
- Switching preference does not cause layout shift or re-mount.

## Interfaces

- `GET /api/user/preferences` returns `{ theme: "light" | "dark" | "system" }`.
- `PATCH /api/user/preferences` accepts `{ theme }` and echoes the result.
- Root layout reads `cookies().get("cclaw_theme")` and emits
  `<html data-theme="...">`.

## Non-Goals

- Per-page overrides.
- Animating the transition between themes.
