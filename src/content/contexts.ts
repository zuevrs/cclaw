export const DEFAULT_CONTEXT_MODE = "default";

export const CONTEXT_MODES: Record<string, string> = {
  default: `# Context Mode: default

Use for most day-to-day feature work.

## Focus
- Follow the active cclaw stage strictly.
- Keep changes within the current task blast radius.
- Prefer incremental progress with frequent verification.

## Decision posture
- Escalate only meaningful trade-offs.
- Ask for user confirmation only at explicit stage gates.
`,
  execution: `# Context Mode: execution

Use when plan/spec are approved and the goal is high-throughput delivery.

## Focus
- Prioritize deterministic implementation flow (RED -> GREEN -> REFACTOR).
- Minimize conversational overhead; keep updates concise and evidence-first.
- Batch machine-only checks through subagent dispatch where supported.

## Decision posture
- Avoid reopening settled design debates unless a blocker appears.
- Stop immediately on failing quality gates or unresolved critical findings.
`,
  review: `# Context Mode: review

Use for deep validation, risk discovery, and merge readiness.

## Focus
- Bias toward finding concrete defects, regressions, and evidence gaps.
- Cross-check spec, plan, tests, and implementation alignment.
- Treat unsupported claims as unverified until backed by command output.

## Decision posture
- Classify findings by severity and expected blast radius.
- Block ship decisions when critical issues remain unresolved.
`,
  incident: `# Context Mode: incident

Use for production failures, emergency regressions, or urgent stabilization.

## Focus
- Reproduce first, then isolate, then fix.
- Favor smallest safe change with rollback clarity.
- Preserve timeline and evidence for post-incident learning.

## Decision posture
- Prefer containment over optimization.
- Require explicit evidence for declaring recovery complete.
`
};

export function contextModeFiles(): Record<string, string> {
  return { ...CONTEXT_MODES };
}

export interface ContextModeState {
  activeMode: string;
  updatedAt: string;
  availableModes: string[];
}

export function createInitialContextModeState(nowIso = new Date().toISOString()): ContextModeState {
  return {
    activeMode: DEFAULT_CONTEXT_MODE,
    updatedAt: nowIso,
    availableModes: Object.keys(CONTEXT_MODES)
  };
}
