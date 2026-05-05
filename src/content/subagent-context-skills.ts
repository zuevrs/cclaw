import type { StageAutoSubagentDispatch } from "./stages/schema-types.js";

type SubagentContextSkillId = NonNullable<StageAutoSubagentDispatch["skill"]>;

function skillFrontmatter(name: SubagentContextSkillId, description: string): string {
  return [
    "---",
    `name: ${name}`,
    `description: ${JSON.stringify(description)}`,
    "---",
    ""
  ].join("\n");
}

function tddCycleEvidenceSkill(): string {
  return `${skillFrontmatter(
    "tdd-cycle-evidence",
    "Evidence contract for the mandatory slice-builder delegation across RED/GREEN/REFACTOR/DOC."
  )}# TDD Cycle Evidence

Use with the \`slice-builder\` delegation in the \`tdd\` stage. One \`slice-builder\` span owns the full cycle for a single vertical slice.

## Required Output

- RED evidence: failing test command, failing assertion/error, and why it fails for the intended reason.
- GREEN evidence: implementation summary plus relevant passing command.
- REFACTOR evidence: changed/unchanged behavior statement plus full-suite or highest available verification command. \`refactor-deferred\` is acceptable when paired with rationale and a tracked follow-up.
- DOC evidence: \`<artifacts-dir>/tdd-slices/S-<id>.md\` populated with the slice summary.
- Trace refs: plan task ID, acceptance criterion ID, and touched test files.

## Guardrails

- No production code before RED evidence exists.
- If a RED test cannot be expressed, stop and route back to design/spec with the blocker.
- Record command output summaries, not just "tests passed".
- Multiple \`slice-builder\` spans run in parallel inside one wave only when their \`claimedPaths\` are disjoint.
`;
}

function reviewSpecPassSkill(): string {
  return `${skillFrontmatter(
    "review-spec-pass",
    "Spec compliance pass for the mandatory reviewer delegation during review."
  )}# Review Spec Pass

Use with the \`reviewer\` delegation in the \`review\` stage before broader code-quality findings.

## Required Output

- For each acceptance criterion: PASS / PARTIAL / FAIL.
- Evidence refs grounded in files, tests, artifacts, or command output.
- Any mismatch between scope/design/spec/plan and implementation.
- Explicit list of Critical/Important blockers before ship.

## Guardrails

- Do not trust implementer summaries; verify by reading artifacts/code.
- Keep spec compliance separate from style suggestions.
`;
}

function securityAuditSkill(): string {
  return `${skillFrontmatter(
    "security-audit",
    "Mandatory security sweep contract for the security-reviewer delegation."
  )}# Security Audit

Use with the \`security-reviewer\` delegation in the \`review\` stage.

## Required Output

- Trust-boundary map: auth/authz, input validation, secrets, filesystem/network/process access, third-party calls.
- Findings with severity, exploitability, affected file/path, and concrete mitigation.
- NO_CHANGE_ATTESTATION when no security-relevant surface moved, with evidence for why.

## Guardrails

- Pattern-scan the diff and touched modules before attesting no change.
- Security is mandatory in review even for small diffs.
`;
}

function adversarialReviewSkill(): string {
  return `${skillFrontmatter(
    "adversarial-review",
    "Second-opinion reviewer lens for high-risk review scenarios."
  )}# Adversarial Review

Use only when the review dispatch trigger says risk justifies a second opinion.

## Required Output

- Attack the implementation assumptions, not the author.
- Look for hidden coupling, rollback gaps, data loss, race conditions, and untested edge cases.
- Mark each finding as confirmed, disproven, or needs-human-decision.

## Guardrails

- Do not duplicate the mandatory reviewer pass.
- If no additional risk is found, say so explicitly and cite what was checked.
`;
}

function receivingCodeReviewSkill(): string {
  return `${skillFrontmatter(
    "receiving-code-review",
    "Workflow for triaging external reviewer, bot, or CI feedback during review."
  )}# Receiving Code Review

Use when external comments, bot findings, or CI annotations appear after the initial review pass.

## Required Output

- Queue every feedback item with source, severity, requested change, and evidence.
- Disposition: accepted, rejected-with-evidence, accepted-risk, duplicate, or needs-user-decision.
- Mirror the queue into the review artifact so unresolved feedback cannot disappear.

## Guardrails

- Do not silently dismiss bot/CI feedback.
- Re-run relevant checks after accepted fixes.
`;
}

function stackAwareReviewSkill(): string {
  return `${skillFrontmatter(
    "stack-aware-review",
    "Language/runtime-specific review lens selected from detected repo signals."
  )}# Stack-Aware Review

Use after the default reviewer/security-reviewer passes when repo signals identify a relevant stack.

## Required Output

- Detected stack signal and why this lens applies.
- Stack-specific risks checked: package/build/test config, type/runtime boundaries, framework conventions, and deployment assumptions.
- Findings with evidence and whether they affect ship readiness.

## Guardrails

- Do not run every stack lens unconditionally.
- Keep the default general reviewer pass intact; this is additive context, not a replacement.
`;
}

function criticMultiPerspectiveSkill(): string {
  return `${skillFrontmatter(
    "critic-multi-perspective",
    "Multi-perspective critic protocol with pre-commitment predictions and realist checks."
  )}# Critic Multi-Perspective Pass

Use with the \`critic\` delegation in \`brainstorm\`, \`scope\`, and \`design\`.

## Required Output

- Before investigation, emit \`predictions[]\` with explicit hypotheses.
- Analyze through context-aware angles:
  - plan/spec/scope: executor, stakeholder, skeptic
  - design/code: security, operator, new-hire
- Include a dedicated gap analysis (what is missing, not only what is wrong).
- Move low-confidence concerns (<=4/10) into \`openQuestions[]\`.
- For every critical/major concern, include a \`realistCheckResults[]\` verdict.
- End with \`predictionsValidated[]\` mapping each prediction to confirmed/disproven.

## Guardrails

- Do not block solely on low-confidence concerns.
- Suppress or downgrade implausible critical findings during realist checks.
- Escalate to adversarial mode when reviewers disagree, confidence is low, or trust boundaries are involved.
`;
}

function documentCoherencePassSkill(): string {
  return `${skillFrontmatter(
    "document-coherence-pass",
    "Consistency-focused pass for cross-section coherence in spec/plan/design documents."
  )}# Document Coherence Pass

Use with \`coherence-reviewer\` on spec/plan/design artifacts.

## Required Output

- List contradictions between sections and where they occur.
- Flag terminology drift where one concept is named inconsistently.
- Flag broken internal references, forward references, and dependency narrative mismatches.
- Return calibrated findings with concrete anchors and one-line corrections.

## Guardrails

- Do not score overall quality; focus on consistency and coherence only.
- Do not invent contradictions without citation to concrete sections/lines.
`;
}

function documentScopeGuardSkill(): string {
  return `${skillFrontmatter(
    "document-scope-guard",
    "Complexity and minimum-change guardrail for scope/plan/design documents."
  )}# Document Scope Guard

Use with \`scope-guardian-reviewer\` when expansion pressure or abstraction creep is likely.

## Required Output

- Surface where existing solutions can be reused instead of adding new abstractions.
- Identify minimum-change alternative when current proposal is broader than needed.
- Call out complexity smells (speculative generic utilities, framework-ahead-of-need structures).
- Return calibrated findings with explicit impact on scope boundaries.

## Guardrails

- Challenge unnecessary breadth, but do not silently shrink required user outcomes.
- Tie every scope reduction recommendation to a concrete cost/risk rationale.
`;
}

function documentFeasibilityPassSkill(): string {
  return `${skillFrontmatter(
    "document-feasibility-pass",
    "Feasibility validation for runtime/resource/dependency assumptions in plan/design artifacts."
  )}# Document Feasibility Pass

Use with \`feasibility-reviewer\` on plan/design docs that rely on runtime or operational assumptions.

## Required Output

- Enumerate resource/time/runtime assumptions and whether they are validated.
- Flag external dependency availability or reliability risks.
- Flag rollout assumptions that are not backed by operational evidence.
- Return PASS/PASS_WITH_GAPS/FAIL/BLOCKED rationale grounded in cited assumptions.

## Guardrails

- Focus on practical viability; do not redesign architecture unless feasibility is blocked.
- Distinguish unknowns that need evidence from hard blockers that require rework.
`;
}

function reviewPerfLensSkill(): string {
  return `${skillFrontmatter(
    "review-perf-lens",
    "Optional deep performance lens for large or high-risk review surfaces."
  )}# Review Performance Lens

Use as an optional follow-up lens when the default reviewer pass flags non-trivial performance risk.

## Required Output

- Hot-path or algorithmic-risk summary with touched files.
- Potential regressions and estimated blast radius.
- Clear NO_IMPACT or FOUND_<n> result with evidence.

## Guardrails

- Run only when justified by diff scope or explicit trigger.
- Do not replace the mandatory reviewer pass; this lens is additive.
`;
}

function reviewCompatLensSkill(): string {
  return `${skillFrontmatter(
    "review-compat-lens",
    "Optional compatibility lens for high-risk API/config/schema changes."
  )}# Review Compatibility Lens

Use as an optional follow-up lens when contracts, config, persistence schema, or generated clients might break consumers.

## Required Output

- Surface inventory: APIs/config/schema/CLI/client contracts touched.
- Compatibility risk assessment (backward, forward, migration path).
- Clear NO_IMPACT or FOUND_<n> result with evidence.

## Guardrails

- Focus on externally observable contracts and migration safety.
- Do not duplicate baseline reviewer findings verbatim.
`;
}

function reviewObservabilityLensSkill(): string {
  return `${skillFrontmatter(
    "review-observability-lens",
    "Optional observability lens for diagnosability and rollback safety."
  )}# Review Observability Lens

Use as an optional follow-up lens when failure diagnosis, telemetry, or operational rollback confidence is at risk.

## Required Output

- Signals checked: logs, metrics, traces, alerts, debug handles.
- Gaps that could block diagnosis or rollback during incidents.
- Clear NO_IMPACT or FOUND_<n> result with evidence.

## Guardrails

- Escalate only diagnosis-impacting gaps; avoid style-only telemetry suggestions.
- Keep scope tied to touched code paths and rollout-critical behavior.
`;
}

function architectCrossStageVerificationSkill(): string {
  return `${skillFrontmatter(
    "architect-cross-stage-verification",
    "Cross-stage cohesion verification before ship finalization."
  )}# Architect Cross-Stage Verification

Use with the \`architect\` delegation in the \`ship\` stage.

## Required Output

- Read scope/design/spec/plan/review artifacts plus shipped diff/code surfaces.
- Validate that locked decisions and acceptance mappings still match shipped behavior.
- Flag drift between intended architecture and implemented boundaries.
- Return exactly one status token: \`CROSS_STAGE_VERIFIED\`, \`DRIFT_DETECTED\`, or \`BLOCKED\`.
- Provide evidence refs for every drift claim and identify the smallest corrective route.

## Guardrails

- Do not defer unresolved drift to post-ship follow-up without explicit waiver.
- If evidence is insufficient to verify cohesion, return \`BLOCKED\` with missing inputs.
`;
}

export const SUBAGENT_CONTEXT_SKILLS: Record<SubagentContextSkillId, string> = {
  "tdd-cycle-evidence": tddCycleEvidenceSkill(),
  "review-spec-pass": reviewSpecPassSkill(),
  "security-audit": securityAuditSkill(),
  "adversarial-review": adversarialReviewSkill(),
  "receiving-code-review": receivingCodeReviewSkill(),
  "stack-aware-review": stackAwareReviewSkill(),
  "critic-multi-perspective": criticMultiPerspectiveSkill(),
  "document-coherence-pass": documentCoherencePassSkill(),
  "document-scope-guard": documentScopeGuardSkill(),
  "document-feasibility-pass": documentFeasibilityPassSkill(),
  "review-perf-lens": reviewPerfLensSkill(),
  "review-compat-lens": reviewCompatLensSkill(),
  "review-observability-lens": reviewObservabilityLensSkill(),
  "architect-cross-stage-verification": architectCrossStageVerificationSkill()
};
