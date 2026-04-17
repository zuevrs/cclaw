import { RUNTIME_ROOT } from "../constants.js";

const FEATURE_SKILL_FOLDER = "feature-workspaces";
const FEATURE_SKILL_NAME = "feature-workspaces";

function activeFeaturePath(): string {
  return `${RUNTIME_ROOT}/state/active-feature.json`;
}

function featuresRoot(): string {
  return `${RUNTIME_ROOT}/features`;
}

function runtimeArtifactsPath(): string {
  return `${RUNTIME_ROOT}/artifacts`;
}

function runtimeStatePath(): string {
  return `${RUNTIME_ROOT}/state`;
}

export function featureCommandContract(): string {
  return `# /cc-ops feature

## Purpose

Manage multi-feature workspaces without flow-state/artifact collisions.

The active runtime remains:
- \`${runtimeArtifactsPath()}\` (active artifacts)
- \`${runtimeStatePath()}\` (active state)

Feature snapshots live under \`${featuresRoot()}/<feature-id>/\`.

## HARD-GATE

- Never overwrite another feature snapshot silently.
- Before switching feature, snapshot the current active runtime first.
- Keep \`${activeFeaturePath()}\` as the single source of "current feature".

## Subcommands

### \`/cc-ops feature status\`
Show active feature id and snapshot location.

### \`/cc-ops feature list\`
List all feature ids in \`${featuresRoot()}/\` (directory names).

### \`/cc-ops feature new <feature-id>\`
Create \`${featuresRoot()}/<feature-id>/artifacts\` and \`${featuresRoot()}/<feature-id>/state\`.

Optional flag:
- \`--clone-active\`: clone current active runtime into the new feature snapshot.

### \`/cc-ops feature switch <feature-id>\`
1. Snapshot current active runtime into \`${featuresRoot()}/<active>/\`.
2. Restore target snapshot from \`${featuresRoot()}/<feature-id>/\` into active runtime:
   - \`${runtimeArtifactsPath()}\`
   - \`${runtimeStatePath()}\` (preserve \`active-feature.json\`)
3. Update \`${activeFeaturePath()}\` with \`activeFeature=<feature-id>\`.

If the target snapshot is empty, initialize runtime as a fresh flow.

## Output

Always print:
- active feature before
- active feature after
- whether snapshot/restore changed files

## Primary skill

**${RUNTIME_ROOT}/skills/${FEATURE_SKILL_FOLDER}/SKILL.md**
`;
}

export function featureCommandSkillMarkdown(): string {
  return `---
name: ${FEATURE_SKILL_NAME}
description: "Manage cclaw multi-feature workspaces (status/list/new/switch) while preserving active flow runtime."
---

# /cc-ops feature — Feature Workspace Manager

## HARD-GATE

Do not switch feature by editing only \`active-feature.json\`. A valid switch must snapshot current runtime and restore target runtime.

## Paths

- Active pointer: \`${activeFeaturePath()}\`
- Feature snapshots: \`${featuresRoot()}/<feature-id>/\`
- Active runtime artifacts: \`${runtimeArtifactsPath()}\`
- Active runtime state: \`${runtimeStatePath()}\`

## Protocol

### status
1. Read \`${activeFeaturePath()}\`.
2. Print active feature id and its snapshot folder.

### list
1. Enumerate directories in \`${featuresRoot()}/\`.
2. Mark the active one.

### new <feature-id> [--clone-active]
1. Validate \`feature-id\` (lowercase slug, letters/numbers/dashes).
2. Create snapshot dirs:
   - \`${featuresRoot()}/<feature-id>/artifacts\`
   - \`${featuresRoot()}/<feature-id>/state\`
3. If \`--clone-active\`: copy active runtime artifacts/state into the new snapshot.
4. Do not change active feature unless the user explicitly requests switch.

### switch <feature-id>
1. Read current active feature id.
2. Snapshot current runtime into current feature snapshot.
3. Restore target snapshot into active runtime.
4. Update \`${activeFeaturePath()}\`.
5. Report stage/run after restore (\`flow-state.json\`).

## Safety checks

- If target feature does not exist: block and suggest \`/cc-ops feature new <id>\`.
- If snapshot copy fails: abort switch, keep current active feature unchanged.
- Preserve global pointer file \`active-feature.json\` when restoring state.
`;
}
