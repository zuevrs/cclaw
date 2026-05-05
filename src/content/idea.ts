import { RUNTIME_ROOT } from "../constants.js";
import { ideaStructuredAskToolsWithFallback } from "./decision-protocol.js";
import { conversationLanguagePolicyMarkdown } from "./language-policy.js";

export type IdeaFrameId =
  | "pain-friction"
  | "assumption-break"
  | "cross-domain-analogy";

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
  "assumption-break": {
    id: "assumption-break",
    label: "assumption-break",
    prompt:
      "List the top assumptions behind the current approach and break one: what if that assumption is wrong, incomplete, or expensive to maintain?",
    examplePatterns: [
      "An approval gate currently assumed to be always manual can be automated safely",
      "A broad required section can be optional with measurable trigger conditions",
      "A long checklist step can be replaced by a deterministic verifier"
    ]
  },
  "cross-domain-analogy": {
    id: "cross-domain-analogy",
    label: "cross-domain-analogy",
    prompt:
      "Borrow one proven pattern from an adjacent domain and map it to this repository's constraints.",
    examplePatterns: [
      "Treat post-ship closeout like incident-response runbooks with explicit ownership",
      "Apply API compatibility techniques to artifact schema evolution",
      "Use observability SLO-style thresholds for process-quality gates"
    ]
  }
};

export const DEFAULT_IDEA_FRAME_IDS: readonly IdeaFrameId[] = Object.freeze([
  "pain-friction",
  "assumption-break",
  "cross-domain-analogy"
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

export type IdeaImpact = "high" | "medium" | "low";
export type IdeaEffort = "s" | "m" | "l";
export type IdeaConfidence = "high" | "medium" | "low";

export interface IdeaCandidateEvaluationInput {
  id: string;
  title: string;
  impact: IdeaImpact;
  effort: IdeaEffort;
  confidence: IdeaConfidence;
}

export interface IdeaCandidateEvaluation extends IdeaCandidateEvaluationInput {
  disposition: "survivor" | "rejected";
  rankingScore: number;
}

export interface IdeaRankingResult {
  survivors: IdeaCandidateEvaluation[];
  rejected: IdeaCandidateEvaluation[];
  recommendationId: string | null;
}

const IMPACT_PRIORITY: Record<IdeaImpact, number> = {
  high: 3,
  medium: 2,
  low: 1
};

const EFFORT_PRIORITY: Record<IdeaEffort, number> = {
  s: 0,
  m: 1,
  l: 2
};

const CONFIDENCE_PRIORITY: Record<IdeaConfidence, number> = {
  high: 2,
  medium: 1,
  low: 0
};

function isRejectedIdea(input: IdeaCandidateEvaluationInput): boolean {
  if (input.confidence === "low") return true;
  if (input.impact === "low" && input.effort === "l") return true;
  return false;
}

export function scoreIdeaCandidate(
  impact: IdeaImpact,
  effort: IdeaEffort,
  confidence: IdeaConfidence
): number {
  // Keep the scoring intentionally simple and monotonic.
  return IMPACT_PRIORITY[impact] + CONFIDENCE_PRIORITY[confidence] - EFFORT_PRIORITY[effort];
}

export function evaluateIdeaCandidate(
  input: IdeaCandidateEvaluationInput
): IdeaCandidateEvaluation {
  const disposition = isRejectedIdea(input) ? "rejected" : "survivor";
  return {
    ...input,
    disposition,
    rankingScore: scoreIdeaCandidate(input.impact, input.effort, input.confidence)
  };
}

export function rankIdeaCandidates(
  inputs: readonly IdeaCandidateEvaluationInput[],
  maxSurvivors = 10
): IdeaRankingResult {
  const evaluated = inputs.map(evaluateIdeaCandidate);
  const survivors = evaluated
    .filter((candidate) => candidate.disposition === "survivor")
    .sort((left, right) => {
      // Deterministic ordering: impact > effort > confidence > id.
      const impactDelta = IMPACT_PRIORITY[right.impact] - IMPACT_PRIORITY[left.impact];
      if (impactDelta !== 0) return impactDelta;
      const effortDelta = EFFORT_PRIORITY[left.effort] - EFFORT_PRIORITY[right.effort];
      if (effortDelta !== 0) return effortDelta;
      const confidenceDelta = CONFIDENCE_PRIORITY[right.confidence] - CONFIDENCE_PRIORITY[left.confidence];
      if (confidenceDelta !== 0) return confidenceDelta;
      return left.id.localeCompare(right.id);
    })
    .slice(0, Math.max(0, maxSurvivors));
  const survivorIds = new Set(survivors.map((candidate) => candidate.id));
  const rejected = evaluated
    .filter((candidate) => candidate.disposition === "rejected" || !survivorIds.has(candidate.id))
    .sort((left, right) => left.id.localeCompare(right.id));
  return {
    survivors,
    rejected,
    recommendationId: survivors[0]?.id ?? null
  };
}

const IDEA_SKILL_FOLDER = "flow-idea";
const IDEA_SKILL_NAME = "flow-idea";
const IDEA_ARTIFACT_GLOB = ".cclaw/artifacts/idea-*.md";
const IDEA_ARTIFACT_PATTERN = ".cclaw/artifacts/idea-<YYYY-MM-DD-slug>.md";
const IDEA_RESUME_WINDOW_DAYS = 30;
const STRUCTURED_ASK_TOOLS = ideaStructuredAskToolsWithFallback();

export interface IdeaCommandOptions {
  frameIds?: readonly IdeaFrameId[];
  mode?: "repo-grounded" | "elsewhere-software" | "elsewhere-non-software" | "narrow";
}

export function minimumDistinctIdeaFrames(
  frameCount: number,
  mode: IdeaCommandOptions["mode"] = "repo-grounded"
): number {
  if (frameCount <= 0) return 0;
  const cap = mode === "repo-grounded" ? 3 : 2;
  return Math.min(cap, frameCount);
}

function renderFrameBullets(frameIds?: readonly IdeaFrameId[]): string {
  return resolveIdeaFrames(frameIds)
    .map((frame) => `   - ${frame.label} (\`${frame.id}\`)`)
    .join("\n");
}

function renderFrameNames(frameIds?: readonly IdeaFrameId[]): string {
  return resolveIdeaFrames(frameIds)
    .map((frame) => frame.label)
    .join(", ");
}

export function ideaCommandContract(options: IdeaCommandOptions = {}): string {
  const frames = resolveIdeaFrames(options.frameIds);
  const frameBullets = renderFrameBullets(options.frameIds);
  const minimumDistinctFrames = minimumDistinctIdeaFrames(frames.length, options.mode);
  return `# /cc-idea

## Purpose

Repository-improvement idea mode. Generate a ranked backlog of
high-value improvements, persist it as an artifact on disk, and end with
an explicit handoff - either launch \`/cc\` on a chosen candidate in the
same session, or save/discard the backlog.

## HARD-GATE

${conversationLanguagePolicyMarkdown()}
- Idea mode only. Never mutate \`.cclaw/state/flow-state.json\`.
- Every recommendation cites evidence from the current repository
  (file path, command output, or knowledge-store entry id).
- Whenever you produce ideation output, persist it to
  \`${IDEA_ARTIFACT_PATTERN}\`. Chat-only output is not acceptable.
  The only exception is an explicit user-cancel from the resume prompt -
  in that case, write nothing and exit silently.
- Always end with a structured handoff prompt, not an open question
  (skipped on explicit cancel).

## Algorithm

1. **Resume check.** Glob \`${IDEA_ARTIFACT_GLOB}\`. If any artifact
   has been modified within the last ${IDEA_RESUME_WINDOW_DAYS} days,
   offer the user: continue that backlog, start fresh, or cancel.
2. **Mode classification.** Explicitly classify subject:
   \`repo-grounded\` / \`elsewhere-software\` / \`elsewhere-non-software\` / \`narrow\`.
3. **Mode-aware grounding (parallel).**
   - Repo-grounded: repo signal scan + \`${RUNTIME_ROOT}/knowledge.jsonl\`
     repetition scan.
   - Elsewhere-software: docs-first grounding (Context7 and official docs).
   - Elsewhere-non-software: constraints and objective grounding.
4. **Divergent ideation frames (parallel).** Generate candidates with
   configured frames (${frames.length} total):
${frameBullets}
   Keep at least ${minimumDistinctFrames} distinct frame outputs in this rendered mode.
   Deterministic minimum: repo-grounded = 3, narrow/non-repo = 2, always capped
   by configured frame count.
5. **Adversarial critique pass.** For each candidate, write the strongest
   counter-argument, kill weak ideas, and keep survivors only.
6. **Produce 5-10 survivors** with impact (High/Medium/Low),
   effort (S/M/L), confidence (High/Medium/Low), **why now**, expected user impact, risk, and one evidence path per
   survivor.
7. **Rank by simple triage order**: impact first, then effort, then confidence.
   Reject low-confidence ideas and obvious low-impact/high-effort outliers.
   Recommend the top survivor.
8. **Write the artifact** at
   \`${IDEA_ARTIFACT_PATTERN}\` using the schema in the skill.
9. **Present the handoff prompt** with four concrete options - not A/B/C
   letters. Default = "Start /cc on the top recommendation". When the user
   picks the start option, plumb the chosen candidate forward via
   \`start-flow --from-idea-artifact=<path> --from-idea-candidate=I-<n>\`
   so brainstorm reuses the idea's divergent + critique +
   rank work via \`interactionHints.brainstorm.fromIdeaArtifact\`; do NOT
   ask brainstorm to regenerate it.

## Headless mode (CI/automation only)

Headless envelopes are a machine-mode exception for CI/automation orchestration.
In normal interactive ideation, respond with natural language plus the artifact path.
For skill-to-skill invocation, emit exactly one JSON envelope:

\`\`\`json
{"version":"1","kind":"stage-output","stage":"non-flow","payload":{"command":"/cc-idea","artifact":".cclaw/artifacts/idea-<date>-<slug>.md","recommendation":"I-1"},"emittedAt":"<ISO-8601>"}
\`\`\`

Validate envelopes with:
\`npx cclaw-cli internal envelope-validate --stdin\`

## Primary skill

   **${RUNTIME_ROOT}/skills/${IDEA_SKILL_FOLDER}/SKILL.md**
`;
}

export function ideaCommandSkillMarkdown(options: IdeaCommandOptions = {}): string {
  const frames = resolveIdeaFrames(options.frameIds);
  const frameBullets = renderFrameBullets(options.frameIds);
  const minimumDistinctFrames = minimumDistinctIdeaFrames(frames.length, options.mode);
  const frameNames = renderFrameNames(options.frameIds);
  return `---
name: ${IDEA_SKILL_NAME}
description: "Repository idea mode: detect and rank high-leverage improvements, persist a backlog artifact, and hand off to /cc or save/discard."
---

# /cc-idea

## Announce at start

"Using flow-idea to identify highest-leverage improvements in this
repository. Will persist a ranked backlog to
\`${IDEA_ARTIFACT_PATTERN}\` and end with an explicit handoff."

## HARD-GATE

${conversationLanguagePolicyMarkdown()}
- Do not start coding in idea mode.
- Do not mutate \`.cclaw/state/flow-state.json\` - idea mode sits outside
  the critical-path flow.
- Whenever ideation output is produced, persist the artifact file on disk
  before presenting the handoff. The only exception is an explicit user-cancel
  from the resume prompt - in that case, write nothing and exit silently.
- Always end with a structured handoff that names the concrete follow-up
  command for each option (skipped on explicit cancel). No A/B/C letters
  without command context.

## Protocol

### Phase 0 - Resume and classify

1. Use the harness's file-glob tool (\`Glob\` pattern
   \`${IDEA_ARTIFACT_GLOB}\` or equivalent \`ls\`).
2. Filter to files modified within the last ${IDEA_RESUME_WINDOW_DAYS} days.
3. If one or more match, present **one** structured ask using the
   harness's native tool (${STRUCTURED_ASK_TOOLS}) with options:
   - **Continue the existing backlog**.
   - **Start a fresh scan**.
   - **Cancel**.
4. If no recent artifact exists, proceed to Phase 1 silently.
5. Classify the ideation mode before grounding:
   - \`repo-grounded\`
   - \`elsewhere-software\`
   - \`elsewhere-non-software\`
   - \`narrow\`
6. Record the chosen mode in the artifact.

### Phase 1 - Mode-aware grounding

Run grounding in parallel where available:

- For \`repo-grounded\`:
  - \`rg -n 'TODO|FIXME|XXX|HACK|TBD'\` grouped by file.
  - Test-runner output (\`npm test\`, \`pytest\`, \`go test ./...\`) - note
    failures, timeouts, deprecation warnings.
  - Module size outliers with weak direct test coverage.
  - Docs drift checks for stale references.
  - \`${RUNTIME_ROOT}/knowledge.jsonl\` entries where \`type\` is
    \`rule | pattern | lesson | compound\`, with repeated \`trigger/action\`
    pairs and stable high-confidence patterns.
- For \`elsewhere-software\`:
  - Gather current framework/library docs first.
  - Add one comparison scan for established solutions.
- For \`elsewhere-non-software\`:
  - Capture objective, constraints, and measured friction before proposing fixes.

Record each finding with exact evidence (path, command, or doc source).

### Phase 2 - Divergent ideation

Generate candidate ideas by frame, in parallel when possible:

${frameBullets}

Require at least ${minimumDistinctFrames} distinct frames in this rendered mode. The
runtime rule is deterministic: repo-grounded scans require 3 distinct frames;
narrow, elsewhere-software, and elsewhere-non-software runs require 2; all modes
are capped by the configured frame count.

### Phase 3 - Critique all, keep survivors

For each raw candidate:
- Write strongest argument **against** this idea.
- Identify disqualifiers (duplicate, weak evidence, poor ROI, wrong timing).
- Mark as \`survivor\` or \`rejected\`.

Only survivors advance to ranking.

### Phase 4 - Rank and write the artifact

1. Keep 5-10 survivors.
2. For each survivor, include:
   - **ID** - \`I-1\`, \`I-2\`, ...
   - **Title**
   - **Impact** - High / Medium / Low
   - **Effort** - S / M / L
   - **Confidence** - High / Medium / Low
   - **Evidence**
   - **Why now**
   - **Expected impact**
   - **Risk**
   - **Counter-argument**
   - **Next /cc prompt**
3. Sort survivors by impact, then effort, then confidence.
4. Write \`.cclaw/artifacts/idea-<date>-<slug>.md\`.
5. Confirm in chat: "Wrote <path>".

### Phase 5 - Handoff prompt

Present one structured ask with exactly these options (no bare A/B/C):
Required options, in this order:
1. **Start /cc on the top recommendation** (default)
2. **Pick a different candidate**
3. **Save and close**
4. **Discard**

### Phase 6 - Execute the choice

- Start /cc: load \`${RUNTIME_ROOT}/skills/using-cclaw/SKILL.md\` and run
  \`/cc <phrase>\`. **Handoff carry-forward (mandatory when starting from /cc-idea):**
  the harness shim that turns \`/cc <phrase>\` into a \`start-flow\` invocation
  MUST forward the originating idea artifact and chosen candidate so brainstorm
  reuses divergent + critique + rank work instead of redoing it. Equivalent CLI
  call (used by automation; harness handles this transparently in interactive mode):
  \`npx cclaw-cli internal start-flow --track=<track> --prompt='<phrase>' --from-idea-artifact=${IDEA_ARTIFACT_PATTERN} --from-idea-candidate=I-<n>\`.
  The hint lands in \`flow-state.interactionHints.brainstorm\` and brainstorm's
  \`Idea-evidence carry-forward\` checklist row picks it up.
- Save and close: reply with artifact path and stop.
- Discard: delete the artifact and stop.

## Do not

- Do not write into \`.cclaw/artifacts/0X-*.md\` (stage artifacts).
- Do not mutate \`.cclaw/state/flow-state.json\`.
- Do not collapse all ideas into one frame; distribute across:
  ${frameNames}.
`;
}
