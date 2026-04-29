export type IdeaFrameId =
  | "pain-friction"
  | "inversion"
  | "assumption-break"
  | "leverage"
  | "cross-domain-analogy"
  | "constraint-flip";

export interface IdeaFrame {
  id: IdeaFrameId;
  label: string;
  prompt: string;
  examplePatterns: string[];
}

export interface IdeaFrameDispatchInput {
  focus: string;
  mode: "repo-grounded" | "elsewhere-software" | "elsewhere-non-software";
  signalSummary: string[];
}

export interface IdeaFrameDispatchPlanEntry {
  frameId: IdeaFrameId;
  label: string;
  prompt: string;
}

export interface IdeaCandidateDraft {
  title: string;
  evidencePath: string;
  summary: string;
  frameId: IdeaFrameId;
}

export interface IdeaCandidateMerged extends Omit<IdeaCandidateDraft, "frameId"> {
  frameIds: IdeaFrameId[];
}

const FRAME_REGISTRY: Readonly<Record<IdeaFrameId, IdeaFrame>> = {
  "pain-friction": {
    id: "pain-friction",
    label: "pain/friction",
    prompt:
      "Find repeated friction in the repo workflow. Prioritize changes that eliminate recurring toil, fragile handoffs, or repeated manual recovery.",
    examplePatterns: [
      "Repeated TODO/FIXME hotspots in one subsystem",
      "Flows that require manual retries or ad-hoc scripts",
      "Developer loops slowed by avoidable boilerplate"
    ]
  },
  inversion: {
    id: "inversion",
    label: "inversion",
    prompt:
      "Invert a dominant assumption in the current implementation (e.g., push vs pull, synchronous vs queued, implicit vs explicit) and evaluate upside.",
    examplePatterns: [
      "Replace optimistic assumptions with fail-closed defaults",
      "Switch from post-facto checks to pre-flight validation",
      "Move from global policy to module-local contracts"
    ]
  },
  "assumption-break": {
    id: "assumption-break",
    label: "assumption-break",
    prompt:
      "List assumptions that might be false in production. Generate ideas that remain correct even when those assumptions fail.",
    examplePatterns: [
      "Edge paths currently treated as impossible",
      "Implicit coupling between modules with no explicit contract",
      "Latency, scale, or environment assumptions baked into logic"
    ]
  },
  leverage: {
    id: "leverage",
    label: "leverage",
    prompt:
      "Target interventions with asymmetric payoff: one change that improves multiple stages, teams, or failure classes at once.",
    examplePatterns: [
      "A shared helper replacing duplicated logic in many files",
      "One lint/gate that blocks an entire class of regressions",
      "A protocol update that improves multiple stage outputs"
    ]
  },
  "cross-domain-analogy": {
    id: "cross-domain-analogy",
    label: "cross-domain analogy",
    prompt:
      "Borrow a proven pattern from another domain and adapt it to this repo. Keep it concrete and grounded in local constraints.",
    examplePatterns: [
      "Apply SRE-style error budgets to planning artifacts",
      "Use security threat-model thinking for reliability design",
      "Import CI release-train discipline into stage completion gates"
    ]
  },
  "constraint-flip": {
    id: "constraint-flip",
    label: "constraint-flip",
    prompt:
      "Flip one assumed constraint (time, team size, risk tolerance, compatibility) and derive better options under the new boundary.",
    examplePatterns: [
      "Assume near-zero migration window and redesign rollout",
      "Assume one maintainer and optimize for low operational burden",
      "Assume strict auditability and remove ambiguous behaviors"
    ]
  }
};

export const DEFAULT_IDEA_FRAME_IDS: readonly IdeaFrameId[] = Object.freeze([
  "pain-friction",
  "inversion",
  "assumption-break",
  "leverage",
  "cross-domain-analogy",
  "constraint-flip"
]);

export const IDEA_FRAMES: readonly IdeaFrame[] = Object.freeze(
  DEFAULT_IDEA_FRAME_IDS.map((id) => FRAME_REGISTRY[id])
);

export function resolveIdeaFrames(frameIds?: readonly IdeaFrameId[]): IdeaFrame[] {
  if (!frameIds || frameIds.length === 0) {
    return [...IDEA_FRAMES];
  }
  const seen = new Set<IdeaFrameId>();
  const resolved: IdeaFrame[] = [];
  for (const rawId of frameIds) {
    if (!DEFAULT_IDEA_FRAME_IDS.includes(rawId)) {
      throw new Error(`Unknown idea frame id: ${rawId}`);
    }
    if (seen.has(rawId)) continue;
    seen.add(rawId);
    resolved.push(FRAME_REGISTRY[rawId]);
  }
  return resolved;
}

export function buildIdeaFrameDispatchPlan(
  input: IdeaFrameDispatchInput,
  frameIds?: readonly IdeaFrameId[]
): IdeaFrameDispatchPlanEntry[] {
  const signalBlock = input.signalSummary.length > 0
    ? input.signalSummary.map((line) => `- ${line}`).join("\n")
    : "- no pre-scan signals captured yet";
  return resolveIdeaFrames(frameIds).map((frame) => ({
    frameId: frame.id,
    label: frame.label,
    prompt: [
      `Frame: ${frame.label} (${frame.id})`,
      `Mode: ${input.mode}`,
      `Focus: ${input.focus || "open-ended scan"}`,
      "",
      "Signal summary:",
      signalBlock,
      "",
      `Frame prompt: ${frame.prompt}`,
      "",
      "Generate 3-5 concrete candidates with repo-grounded evidence."
    ].join("\n")
  }));
}

function normalizeCandidateKey(title: string, evidencePath: string): string {
  const normalizedTitle = title.trim().toLowerCase().replace(/[^a-z0-9]+/gu, " ").trim();
  const normalizedEvidence = evidencePath
    .trim()
    .toLowerCase()
    .replace(/\\/gu, "/");
  return `${normalizedTitle}::${normalizedEvidence}`;
}

export function dedupeIdeaCandidates(
  drafts: readonly IdeaCandidateDraft[]
): IdeaCandidateMerged[] {
  const merged = new Map<string, IdeaCandidateMerged>();
  for (const draft of drafts) {
    const key = normalizeCandidateKey(draft.title, draft.evidencePath);
    const existing = merged.get(key);
    if (!existing) {
      merged.set(key, {
        title: draft.title,
        evidencePath: draft.evidencePath,
        summary: draft.summary,
        frameIds: [draft.frameId]
      });
      continue;
    }
    if (!existing.frameIds.includes(draft.frameId)) {
      existing.frameIds.push(draft.frameId);
    }
    if (draft.summary.length > existing.summary.length) {
      existing.summary = draft.summary;
    }
  }
  return [...merged.values()];
}
