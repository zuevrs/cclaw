---
title: "cclaw v8 configuration"
status: locked
---

# `.cclaw/config.yaml`

`cclaw init` and `cclaw sync` write `.cclaw/config.yaml`. This is the only configuration cclaw reads.

```yaml
version: 8.0.0
flowVersion: "8"
harnesses:
  - cursor
hooks:
  profile: minimal
```

## Fields

| Field | Type | Notes |
| --- | --- | --- |
| `version` | string | npm version of the cclaw-cli that wrote the file |
| `flowVersion` | `"8"` | Locked. v7 configs are not migrated automatically |
| `harnesses` | array | Subset of `claude`, `cursor`, `opencode`, `codex` |
| `hooks.profile` | `"minimal"` \| `"strict"` | `minimal` is the default; `strict` is reserved for teams that want stricter local enforcement and is currently behaviour-equivalent to `minimal`. |

The config has **no** flags for stage skipping, track selection, discovery mode, parallel-builder counts, or specialist enablement. Those concerns are removed in v8 — orchestration is decided per `/cc` invocation, not per project.

## Changing harnesses

```bash
cclaw sync --harness=claude,cursor
```

Re-running `sync` rewrites the config and adds/removes harness-specific assets (`.claude/commands/cc.md`, `.cursor/commands/cc.md`, etc.).

## Changing hook profile

For the current release, only `minimal` is functionally distinct; `strict` is accepted for forward-compatibility. To set a profile manually, edit `.cclaw/config.yaml` and re-run `cclaw sync`.
