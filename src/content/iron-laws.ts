import { RUNTIME_ROOT } from "../constants.js";
import type { FlowStage } from "../types.js";

export type IronLawEnforcementPoint =
  | "PreToolUse"
  | "PostToolUse"
  | "SessionStart"
  | "Stop"
  | "advisory";

export type IronLawSeverity = "hard-gate" | "soft-gate";

export interface IronLawDefinition {
  id: string;
  title: string;
  rule: string;
  rationale: string;
  enforcement: IronLawEnforcementPoint;
  severity: IronLawSeverity;
  appliesTo: "all" | FlowStage[];
  hookMatcher?: {
    toolPattern?: string;
    payloadPattern?: string;
  };
}

export interface IronLawRuntimeRecord {
  id: string;
  title: string;
  rule: string;
  enforcement: IronLawEnforcementPoint;
  severity: IronLawSeverity;
  appliesTo: "all" | FlowStage[];
  strict: boolean;
  hookMatcher?: {
    toolPattern?: string;
    payloadPattern?: string;
  };
}

export interface IronLawRuntimeDocument {
  version: 1;
  generatedAt: string;
  mode: "advisory" | "strict";
  strictLaws: string[];
  laws: IronLawRuntimeRecord[];
}

export const IRON_LAWS = [
  {
    id: "tdd-red-before-write",
    title: "RED before production write",
    rule: "Do not edit production code in tdd stage before a failing RED test exists for the slice.",
    rationale: "Prevents implementation-first behavior and keeps RED as executable specification.",
    enforcement: "PreToolUse",
    severity: "hard-gate",
    appliesTo: ["tdd"],
    hookMatcher: {
      toolPattern: "write|edit|multiedit|applypatch|shell|bash",
      payloadPattern: "\\.(ts|tsx|js|jsx|py|go|java|rs|rb|php|c|cc|cpp|h|hpp)"
    }
  },
  {
    id: "plan-requires-approval",
    title: "No implementation before plan approval",
    rule: "Do not perform write-like actions while plan stage is pending WAIT_FOR_CONFIRM approval.",
    rationale: "Locks intent before execution and reduces expensive rework from unapproved paths.",
    enforcement: "PreToolUse",
    severity: "hard-gate",
    appliesTo: ["plan"]
  },
  {
    id: "runtime-writes-managed-only",
    title: "Runtime writes are managed",
    rule: `Do not mutate ${RUNTIME_ROOT}/state, ${RUNTIME_ROOT}/hooks, or ${RUNTIME_ROOT}/skills by ad-hoc edits unless using cclaw-managed commands.`,
    rationale: "Protects generated runtime integrity and avoids drift that silently breaks hooks or skills.",
    enforcement: "PreToolUse",
    severity: "hard-gate",
    appliesTo: "all",
    hookMatcher: {
      toolPattern: "write|edit|multiedit|delete|applypatch|shell|bash",
      payloadPattern: "\\.cclaw/(state|hooks|skills)"
    }
  },
  {
    id: "flow-state-read-fresh",
    title: "Fresh flow-state read required",
    rule: `Before mutating actions, a fresh read of ${RUNTIME_ROOT}/state/flow-state.json must exist within guard freshness window.`,
    rationale: "Prevents stale-stage mutations after context shifts or multi-agent divergence.",
    enforcement: "PreToolUse",
    severity: "hard-gate",
    appliesTo: "all"
  },
  {
    id: "review-layer-order",
    title: "Review layers are sequential",
    rule: "Review stage must complete Layer 1 spec compliance before Layer 2 quality/security passes.",
    rationale: "Stops premature quality discussion when acceptance criteria are not yet satisfied.",
    enforcement: "PreToolUse",
    severity: "hard-gate",
    appliesTo: ["review"]
  },
  {
    id: "review-criticals-close-before-ship",
    title: "No ship with open criticals",
    rule: "Ship decisions are blocked when review-army contains open Critical findings or ship blockers.",
    rationale: "Enforces explicit risk closure before release finalization.",
    enforcement: "PreToolUse",
    severity: "hard-gate",
    appliesTo: ["ship"]
  },
  {
    id: "ship-preflight-required",
    title: "Preflight required before finalization",
    rule: "Do not execute release finalization actions until ship preflight gate is passed.",
    rationale: "Catches regressions before irreversible release steps.",
    enforcement: "PreToolUse",
    severity: "hard-gate",
    appliesTo: ["ship"]
  },
  {
    id: "review-coverage-complete-before-ship",
    title: "Review layer coverage before ship",
    rule: "Block ship finalization when review-army does not confirm full Layer 1/2 coverage map.",
    rationale: "Prevents finalization when multi-pass review evidence is incomplete or partially missing.",
    enforcement: "PreToolUse",
    severity: "hard-gate",
    appliesTo: ["ship"]
  },
  {
    id: "subagent-task-self-contained",
    title: "Subagent tasks are self-contained",
    rule: "Delegated tasks must include explicit objective, constraints, and expected output, not just references.",
    rationale: "Avoids context loss and low-quality delegation in isolated worker contexts.",
    enforcement: "advisory",
    severity: "soft-gate",
    appliesTo: "all"
  },
  {
    id: "no-secrets-in-artifacts",
    title: "Never log secrets in artifacts",
    rule: "Secrets/tokens/passwords must not be written to review, ship, or runtime state artifacts.",
    rationale: "Prevents accidental credential leakage through generated workflow artifacts.",
    enforcement: "PostToolUse",
    severity: "hard-gate",
    appliesTo: "all"
  },
  {
    id: "stop-clean-or-handoff",
    title: "Stop only from clean handoff",
    rule: "Do not end a session with dirty state unless the current artifact records unresolved work and blockers.",
    rationale: "Protects continuity and prevents silent half-finished sessions.",
    enforcement: "Stop",
    severity: "hard-gate",
    appliesTo: "all"
  }
] as const satisfies readonly IronLawDefinition[];

export function isIronLawId(value: string): boolean {
  return IRON_LAWS.some((law) => law.id === value);
}

export function normalizeStrictLawIds(ids: string[] | undefined): string[] {
  if (!Array.isArray(ids)) return [];
  const unique = new Set<string>();
  for (const id of ids) {
    if (typeof id !== "string") continue;
    const trimmed = id.trim();
    if (!trimmed || !isIronLawId(trimmed)) continue;
    unique.add(trimmed);
  }
  return [...unique];
}

export function ironLawRuntimeDocument(options: {
  mode?: "advisory" | "strict";
  strictLaws?: string[];
  nowIso?: string;
} = {}): IronLawRuntimeDocument {
  const mode = options.mode === "strict" ? "strict" : "advisory";
  const strictLawSet = new Set(normalizeStrictLawIds(options.strictLaws));
  const laws: IronLawRuntimeRecord[] = IRON_LAWS.map((law) => ({
    id: law.id,
    title: law.title,
    rule: law.rule,
    enforcement: law.enforcement,
    severity: law.severity,
    appliesTo: law.appliesTo === "all" ? "all" : [...law.appliesTo],
    strict: mode === "strict" || strictLawSet.has(law.id),
    hookMatcher: "hookMatcher" in law ? law.hookMatcher : undefined
  }));
  return {
    version: 1,
    generatedAt: options.nowIso ?? new Date().toISOString(),
    mode,
    strictLaws: [...strictLawSet],
    laws
  };
}

function appliesToLabel(law: IronLawDefinition): string {
  return law.appliesTo === "all" ? "all stages" : law.appliesTo.join(", ");
}

function hardGateReference(law: IronLawDefinition): string {
  if (law.appliesTo === "all") {
    return "the active stage `HARD-GATE` block in `.cclaw/skills/<stage>/SKILL.md`";
  }
  return law.appliesTo
    .map((stage) => `\`${RUNTIME_ROOT}/skills/${stage}/SKILL.md\` (${stage} HARD-GATE)`)
    .join(", ");
}

export function ironLawsSkillMarkdown(): string {
  const enforcedLawIds = new Set([
    "stop-clean-or-handoff",
    "review-coverage-complete-before-ship"
  ]);
  const enforced = IRON_LAWS.filter((law) => enforcedLawIds.has(law.id));
  const advisory = IRON_LAWS.filter((law) => !enforcedLawIds.has(law.id));

  const enforcedSections = enforced.map((law, index) => {
    return `### ${index + 1}. ${law.title}

- **ID:** \`${law.id}\`
- **Rule:** ${law.rule}
- **Why:** ${law.rationale}
- **Applies to:** ${appliesToLabel(law)}
- **Enforced by:** ${law.enforcement} (${law.severity})
`;
  }).join("\n");
  const advisoryList = advisory
    .map((law) => `- \`${law.id}\` — applies to ${appliesToLabel(law)}; see ${hardGateReference(law)}.`)
    .join("\n");

  return `---
name: iron-laws
description: "Non-negotiable workflow constraints enforced by cclaw hooks and routing."
---

# Iron Laws

These are cclaw's non-negotiable constraints for harness sessions.  
Use them as the final arbitration layer when local instructions conflict.

## Hook-Enforced Runtime Laws

${enforcedSections}

## Advisory Laws (Stage-Owned)

The following laws remain active guidance, but their canonical enforcement surface
is each stage's \`HARD-GATE\` contract:

${advisoryList}

## Practical rule

If a law says stop, stop and surface the blocking reason with the smallest safe
next step.
`;
}
