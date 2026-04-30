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
    "Evidence contract for the mandatory test-author delegation during RED/GREEN/REFACTOR."
  )}# TDD Cycle Evidence

Use with the \`test-author\` delegation in the \`tdd\` stage.

## Required Output

- RED evidence: failing test command, failing assertion/error, and why it fails for the intended reason.
- GREEN evidence: implementation summary plus relevant passing command.
- REFACTOR evidence: changed/unchanged behavior statement plus full-suite or highest available verification command.
- Trace refs: plan task ID, acceptance criterion ID, and touched test files.

## Guardrails

- No production code before RED evidence exists.
- If a RED test cannot be expressed, stop and route back to design/spec with the blocker.
- Record command output summaries, not just "tests passed".
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

export const SUBAGENT_CONTEXT_SKILLS: Record<SubagentContextSkillId, string> = {
  "tdd-cycle-evidence": tddCycleEvidenceSkill(),
  "review-spec-pass": reviewSpecPassSkill(),
  "security-audit": securityAuditSkill(),
  "adversarial-review": adversarialReviewSkill(),
  "receiving-code-review": receivingCodeReviewSkill(),
  "stack-aware-review": stackAwareReviewSkill(),
  "critic-multi-perspective": criticMultiPerspectiveSkill()
};
