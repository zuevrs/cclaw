import { RUNTIME_ROOT } from "../constants.js";

const FEATURE_SKILL_FOLDER = "using-git-worktrees";
const FEATURE_SKILL_NAME = "using-git-worktrees";

function activeFeaturePath(): string {
  return `${RUNTIME_ROOT}/state/active-feature.json`;
}

function worktreeRegistryPath(): string {
  return `${RUNTIME_ROOT}/state/worktrees.json`;
}

function managedWorktreesRoot(): string {
  return `${RUNTIME_ROOT}/worktrees`;
}

function legacyFeaturesRoot(): string {
  return `${RUNTIME_ROOT}/features`;
}

export function featureCommandContract(): string {
  return `# /cc-ops feature

## Purpose

Manage parallel feature execution using git worktrees (git-native isolation).

Runtime state/artifacts are **never** copied between features anymore. Isolation is branch/worktree-level.

## HARD-GATE

- Do not mutate feature context by copying \`${RUNTIME_ROOT}/artifacts\` or \`${RUNTIME_ROOT}/state\` between feature IDs.
- Use \`git worktree add\` for new feature execution paths.
- Keep \`${activeFeaturePath()}\` + \`${worktreeRegistryPath()}\` as the feature routing source of truth.
- Treat \`${legacyFeaturesRoot()}/\` as read-only migration data.

## Subcommands

### \`/cc-ops feature status\`
Show:
- active feature id from \`${activeFeaturePath()}\`
- resolved worktree entry from \`${worktreeRegistryPath()}\`
- active workspace path

### \`/cc-ops feature list\`
List registered feature worktrees from \`${worktreeRegistryPath()}\` and mark active entry.

### \`/cc-ops feature new <feature-id>\`
1. Validate \`feature-id\` (lowercase slug, letters/numbers/dashes).
2. Create worktree under \`${managedWorktreesRoot()}/<feature-id>\`.
3. Create/switch branch using \`git worktree add\` (prefer \`feature/<feature-id>\` naming).
4. Register entry in \`${worktreeRegistryPath()}\`.

Optional flags:
- \`--clone-active\`: seed from active branch HEAD (default behavior).
- \`--switch\`: mark new feature as active after registration.

### \`/cc-ops feature switch <feature-id>\`
1. Validate that \`<feature-id>\` exists in \`${worktreeRegistryPath()}\`.
2. Update \`${activeFeaturePath()}\`.
3. Print target worktree path and instruct the operator/agent to continue from that workspace root.

## Migration note

Legacy snapshot folders under \`${legacyFeaturesRoot()}/\` are supported as read-only references during migration and should not be used for new execution.

## Output

Always print:
- active feature before
- active feature after
- target workspace path
- workspace source (\`git-worktree\` | \`workspace\` | \`legacy-snapshot\`)

## Primary skill

**${RUNTIME_ROOT}/skills/${FEATURE_SKILL_FOLDER}/SKILL.md**
`;
}

export function featureCommandSkillMarkdown(): string {
  return `---
name: ${FEATURE_SKILL_NAME}
description: "Manage cclaw feature isolation using git worktrees (status/list/new/switch)."
---

# /cc-ops feature — Git Worktree Manager

## HARD-GATE

Do not implement feature switching by copying runtime files between feature IDs. Use git worktrees and registry updates only.

## Paths

- Active pointer: \`${activeFeaturePath()}\`
- Worktree registry: \`${worktreeRegistryPath()}\`
- Managed worktree root: \`${managedWorktreesRoot()}\`
- Legacy snapshots (read-only): \`${legacyFeaturesRoot()}\`

## Protocol

### status
1. Read \`${activeFeaturePath()}\`.
2. Resolve active entry in \`${worktreeRegistryPath()}\`.
3. Print active id + workspace path + source.

### list
1. Enumerate entries in \`${worktreeRegistryPath()}\`.
2. Mark the active one.
3. Highlight any \`legacy-snapshot\` entries as migration-only.

### new <feature-id> [--clone-active] [--switch]
1. Validate \`feature-id\` and ensure not already registered.
2. Run \`git worktree add\` to create \`${managedWorktreesRoot()}/<feature-id>\`.
3. Register entry in \`${worktreeRegistryPath()}\` with branch + path + source.
4. If \`--switch\`, update \`${activeFeaturePath()}\`.

### switch <feature-id>
1. Validate target exists in \`${worktreeRegistryPath()}\`.
2. Update \`${activeFeaturePath()}\`.
3. Report target path and require continuation from that workspace root.

## Safety checks

- If target feature does not exist: block and suggest \`/cc-ops feature new <id>\`.
- If \`git worktree add\` fails: do not write partial registry updates.
- If active feature maps to \`legacy-snapshot\`, report read-only migration warning.
`;
}
