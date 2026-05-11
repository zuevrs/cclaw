---
name: security-review
trigger: when the diff touches authn / authz / secrets / supply chain / data exposure
---

# Skill: security-review

The orchestrator dispatches `security-reviewer` automatically when the active task or diff touches sensitive surfaces. You can also invoke it explicitly with `/cc <task> --security-review`.

## Rules

1. `security-reviewer` is a separate specialist from `reviewer`. They can run in parallel against the same diff.
2. `security-reviewer` decisions of severity `security` are block-level: ship is blocked until they are resolved by slice-builder mode=fix-only and the security review reruns clear.
3. `security_flag: true` in plan frontmatter triggers the compound learning gate even if no other quality signal is present.

## Threat-model checklist (mandatory)

For every `threat-model` invocation, write `ok` / `flag` / `n/a` for each:

1. Authentication
2. Authorization
3. Secrets (committed credentials, env, signing keys)
4. Supply chain (new third-party deps, version pinning, provenance)
5. Data exposure (logging, transmission, storage of user data)

## Pure UI / docs diffs

State explicitly that all five items are `n/a` and write a one-line justification per item. Do not skip the checklist.
