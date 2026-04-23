import { RUNTIME_ROOT } from "../constants.js";

export const DOCTOR_REFERENCE_DIR = `${RUNTIME_ROOT}/references/doctor`;

export const DOCTOR_REFERENCE_MARKDOWN: Record<string, string> = {
  "README.md": `# Doctor Reference Index

Reference docs for \`cclaw doctor\` checks.

## Categories

- \`runtime-layout.md\` - runtime directories, generated commands, and skill files
- \`hooks-and-lifecycle.md\` - hook wiring and harness lifecycle integration
- \`harness-and-routing.md\` - harness shims, AGENTS/CLAUDE routing blocks, cursor rule
- \`state-and-gates.md\` - flow-state integrity and gate evidence contracts
- \`delegation-and-preamble.md\` - mandatory delegations and lightweight announce discipline
- \`traceability.md\` - spec/plan/tdd trace matrix expectations
- \`tooling-capabilities.md\` - local runtime prerequisites (node only)
- \`config-and-policy.md\` - config schema, rules policy, and validation references
`,
  "runtime-layout.md": `# Runtime Layout

## Expected surfaces

- \`.cclaw/\` root and generated subdirectories
- stage command contracts under \`.cclaw/commands/\`
- stage skills under \`.cclaw/skills/\`
- utility command contracts (\`start\`, \`next\`, \`learn\`, \`status\`)
- state files under \`.cclaw/state/\`

## Typical fixes

1. Run \`cclaw sync\` to re-materialize generated assets.
2. If runtime is severely drifted, run \`cclaw upgrade\`.
3. Avoid manual edits under generated runtime paths unless explicitly supported.
`,
  "hooks-and-lifecycle.md": `# Hooks And Lifecycle

## Expected behavior

- session start rehydrates flow + knowledge digest
- pre-tool hooks run prompt/workflow guards
- post-tool hooks run context monitor
- stop hooks checkpoint progress
- OpenCode uses plugin-based lifecycle integration

## Typical fixes

1. Re-run \`cclaw sync\` after harness config changes.
2. Ensure harness is enabled in \`.cclaw/config.yaml\`.
3. Validate hook JSON shape and remove malformed manual edits.
`,
  "harness-and-routing.md": `# Harness And Routing

## Expected behavior

- command shims exist for every enabled harness
- managed routing block is present in \`AGENTS.md\` (and \`CLAUDE.md\` when applicable)
- cursor rule mirrors workflow activation guidance
- opencode plugin path is registered in opencode config

## Typical fixes

1. Confirm \`harnesses\` list in \`.cclaw/config.yaml\`.
2. Run \`cclaw sync\` to re-generate shims/routing files.
3. Remove stale harness artifacts for disabled harnesses via \`cclaw sync\`.
`,
  "state-and-gates.md": `# State And Gates

## Expected behavior

- \`flow-state.json\` has activeRunId, current stage, and consistent track/skippedStages
- current-stage gate evidence is internally consistent
- completed stages only include passed required gates

## Typical fixes

1. Run \`cclaw doctor --reconcile-gates\` to refresh current-stage gate catalog.
2. Repair inconsistent stage artifacts, then re-run doctor.
3. Do not manually mutate gate arrays without matching artifact evidence.
`,
  "delegation-and-preamble.md": `# Delegation And Preamble

## Delegation contract

- mandatory delegations for the current stage must be completed or waived
- waivers should include an explicit reason
- stale entries from previous runs are ignored by current-run checks
- delegation entries use span-compatible fields (\`spanId\`, \`startTs\`, \`endTs\`, \`retryCount\`, \`evidenceRefs\`)

## Announce discipline contract

- no dedicated preamble runtime log is required
- substantial turns should still start with a concise announce (stage + goal + next action)
- do not spam repeated announces when intent did not change

## Typical fixes

1. Append missing delegation records with \`completed\` or \`waived\` status.
2. Record harness-limitation waivers when native delegation is unavailable.
3. Keep announces concise and only refresh when plan/risk materially changes.
`,
  "traceability.md": `# Traceability

## Expected behavior

- spec criteria map to plan tasks
- plan tasks map to tdd slices/tests
- no orphaned criteria/tasks/tests when downstream artifacts exist

## Typical fixes

1. Add stable IDs to spec/plan/tdd sections.
2. Ensure mapping tables include every active criterion/task/slice.
3. Re-run \`cclaw doctor\` after artifact updates.
`,
  "tooling-capabilities.md": `# Tooling Capabilities

## Required

- \`node\` (>=20) — the only runtime dependency. All hooks, git-hook relays, and the
  \`cclaw\` CLI itself run on Node.js. No \`bash\`, \`python3\`, or \`jq\` required.
- \`git\` — needed for worktree and pre-commit/pre-push relays.

## Not required (removed)

Earlier releases relied on \`bash\` to execute generated shell hooks and on
\`python3\`/\`jq\` as JSON fallback parsers. Node-only mode removes both: hooks
dispatch through \`.cclaw/hooks/run-hook.cmd <hook-name>\` (which forwards to
Node), so these tools
are no longer part of the supported runtime contract.

## Typical fixes

1. Install Node.js 20 or newer (matches \`package.json\` \`engines\`) and ensure \`node\` is on \`PATH\`.
2. Re-run \`cclaw sync\` to regenerate hook configs after upgrading Node.
`,
  "config-and-policy.md": `# Config And Policy

## Expected behavior

- \`.cclaw/config.yaml\` parses and uses supported keys/values
- \`.cclaw/rules/rules.json\` matches generated policy schema
- policy needles and required sections remain present in generated contracts

## Typical fixes

1. Repair invalid config values and run \`cclaw sync\`.
2. Re-generate policy files via \`cclaw sync\` if drift is detected.
3. Keep generated contracts aligned with stage schemas and policy needles.
`
};

