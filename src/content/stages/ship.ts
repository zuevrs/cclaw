import type { StageSchemaInput } from "./schema-types.js";
import { SHIP_FINALIZATION_MODES } from "../../constants.js";
import { closeoutSubstateInline } from "../closeout-guidance.js";
import { decisionProtocolInstruction } from "../decision-protocol.js";

// ---------------------------------------------------------------------------
// SHIP — reference: superpowers finishing-a-development-branch + gstack /ship
// ---------------------------------------------------------------------------

export const SHIP: StageSchemaInput = {
  schemaShape: "v2",
  stage: "ship",
  complexityTier: "standard",
  skillFolder: "shipping-and-handoff",
  skillName: "shipping-and-handoff",
  skillDescription: "Release handoff stage with preflight checks, rollback readiness, and explicit finalization mode for both git and non-git workflows.",
  philosophy: {
    hardGate: "Do NOT merge, push, or finalize without a passed preflight check, written rollback plan, and exactly one explicit finalization mode selected. No exceptions for urgency. If no VCS is available, use FINALIZE_NO_VCS explicitly instead of inventing git steps.",
    ironLaw: "NO MERGE WITHOUT GREEN CI, A WRITTEN ROLLBACK, AND EXACTLY ONE SELECTED FINALIZATION MODE.",
    purpose: "Prepare a safe release handoff with clear rollback and branch finalization decision.",
    whenToUse: [
      "After review passes with APPROVED or APPROVED_WITH_CONCERNS verdict",
      "Before creating PR/merge/final branch action",
      "When release notes and rollback plan are required",
      "When shipping from non-git environments (docs bundles, script drops, detached artifacts)"
    ],
    whenNotToUse: [
      "Review verdict is BLOCKED or unresolved critical findings remain",
      "Preflight checks cannot run and no approved exception exists",
      "The request is still design/spec/implementation work, not release handoff"
    ],
    commonRationalizations: [
      "Shipping without rollback strategy",
      "Implicit finalization decision",
      "Bypassing preflight due to urgency",
      "Selecting multiple finalization modes",
      "Shipping with BLOCKED review verdict",
      "No rollback trigger/steps",
      "More than one finalization mode implied",
      "No explicit preflight result",
      "Review verdict not referenced",
      "Finalization not executed, only planned",
      "Selecting git-dependent finalization mode when `.git` is unavailable"
    ]
  },
  executionModel: {
    checklist: [
      "Validate upstream gates — verify review verdict is APPROVED or APPROVED_WITH_CONCERNS. If BLOCKED, stop immediately.",
      "Run preflight checks — tests pass, build succeeds, linter clean, type-check clean, no uncommitted changes. Every check must produce fresh output in this message.",
      "Merge-base detection (git only) — identify the correct base branch. Run `git merge-base HEAD <base>`. If the base has diverged significantly, flag for rebase-first.",
      "Re-run tests on merged result — if merging locally, run the full test suite AFTER the merge, not just before. Post-merge failures are common.",
      "Generate release notes — summarize what changed, why, and what it affects. Reference spec criteria. Include: breaking changes, new dependencies, migration steps if any.",
      "Write rollback plan — trigger conditions (what tells you it is broken), rollback steps (exact commands/git operations), and verification (how to confirm rollback worked).",
      "Load utility skills — `verification-before-completion` for fresh evidence and `finishing-a-development-branch` for finalization workflow.",
      "Monitoring checklist — what should be watched after deploy? Error rates, latency, key business metrics. If no monitoring exists, flag it as a risk.",
      "Detect repository mode — if `.git/` is absent or inaccessible, lock finalization choices to FINALIZE_NO_VCS only and document manual handoff + rollback.",
      "Victory Detector — valid review verdict, fresh preflight, rollback trigger/steps, exactly one finalization enum, and execution target are present; if any field is stale or missing, keep status BLOCKED and iterate.",
      "Select finalization mode — exactly ONE enum: (A) FINALIZE_MERGE_LOCAL, (B) FINALIZE_OPEN_PR, (C) FINALIZE_KEEP_BRANCH, (D) FINALIZE_DISCARD_BRANCH, (E) FINALIZE_NO_VCS. For discard: list what will be deleted, require typed confirmation.",
      "Execute finalization — perform the selected action. For merge: verify clean merge. For PR: include structured body (summary, test plan, rollback). For discard: verify deletion. For NO_VCS: record handoff target, artifact bundle path, and manual rollback owner.",
      "Branch cleanup — after merge/discard, remove only branches or temporary files the user explicitly approved. Skip for FINALIZE_NO_VCS."
    ],
    interactionProtocol: [
      "Run preflight checks before any release action.",
      "Document release notes and rollback plan explicitly.",
      decisionProtocolInstruction(
        "finalization mode",
        "present modes as labeled options (A/B/C/D/E) with consequences, and mark one as (recommended)",
        "recommend the mode that best addresses release blast-radius, rollback readiness, observability, and stakeholder communication — ties go to the most reversible option"
      ),
      "Do not proceed if critical blockers remain from review.",
      "**STOP.** Present finalization options and wait for user selection before executing any finalization action."
    ],
    process: [
      "Validate review and test gates.",
      "Run preflight: build, test, lint, uncommitted-changes check.",
      "Generate release notes and rollback procedure.",
      "Choose one finalization enum: FINALIZE_MERGE_LOCAL, FINALIZE_OPEN_PR, FINALIZE_KEEP_BRANCH, FINALIZE_DISCARD_BRANCH, or FINALIZE_NO_VCS.",
      "Execute finalization action.",
      "Write ship artifact with decision, rationale, and execution result."
    ],
    requiredGates: [
      { id: "ship_review_verdict_valid", description: "Review verdict is APPROVED or APPROVED_WITH_CONCERNS." },
      { id: "ship_preflight_passed", description: "Preflight checks passed or exceptions documented and approved." },
      { id: "ship_rollback_plan_ready", description: "Rollback trigger, steps, and verification are documented." },
      { id: "ship_finalization_executed", description: "Selected finalization action was executed and verified." }
    ],
    requiredEvidence: [
      "Artifact written to `.cclaw/artifacts/08-ship.md`.",
      "Release notes section is complete.",
      "Rollback section includes trigger conditions, steps, and verification.",
      "Finalization section shows exactly one selected enum token.",
      "Victory Detector result documented: review verdict valid, preflight fresh, rollback ready, finalization enum selected, and execution result present."
    ],
    inputs: ["review verdict", "test/build outputs", "release context"],
    requiredContext: ["review artifact", "changelog scope", "deployment constraints"],
    blockers: [
      "review verdict is BLOCKED",
      "critical review blockers remain",
      "rollback plan missing",
      "finalization mode not selected"
    ],
    exitCriteria: [
      "preflight completed",
      "rollback and release notes complete",
      "finalization action explicitly chosen and executed"
    ],
    platformNotes: [
      "Release commands (`npm publish`, `git tag -s`, `gh release create`, `cargo publish`, `goreleaser`) behave the same across OSes, but signing keys differ: macOS Keychain, Windows credential store, Linux GPG agent. Verify the signing flow on the actual release machine before running the real publish.",
      "Version tags must be pure ASCII and lowercase after an optional `v` prefix (`v1.2.3`, `v1.2.3-rc.1`). Avoid Unicode dashes and non-breaking spaces that sneak in via copy-paste from docs.",
      "When the rollback plan references timestamps (CI run windows, DB snapshot IDs), pin them to UTC ISO-8601 so the plan reads identically across CI runners in different regions.",
      "`gh release create` requires a repo-level `GH_TOKEN`/`GITHUB_TOKEN`; document whether it is sourced from the shell env, `.env`, or the OS keychain so another operator on a different OS can reproduce the release."
    ]
  },
  artifactRules: {
    artifactFile: "08-ship.md",
    completionStatus: ["SHIPPED", "SHIPPED_WITH_EXCEPTIONS", "BLOCKED"],
    crossStageTrace: {
      readsFrom: [".cclaw/artifacts/07-review.md", ".cclaw/artifacts/06-tdd.md", ".cclaw/artifacts/05-plan.md", ".cclaw/artifacts/04-spec.md"],
      writesTo: [".cclaw/artifacts/08-ship.md"],
      traceabilityRule: "Ship artifact must reference review verdict and resolution status. Release notes must reference spec criteria. Rollback plan must reference specific changes that could fail."
    },
    artifactValidation: [
      { section: "Upstream Handoff", required: false, validationRule: "Summarizes review/tdd decisions, constraints, open questions, and explicit drift before finalization." },
      { section: "Preflight Results", required: true, validationRule: "Build, test, lint, type-check results captured with fresh output. Exceptions documented if any." },
      { section: "Release Notes", required: true, validationRule: "What changed, why, impact. References spec criteria. Breaking changes flagged." },
      { section: "Rollback Plan", required: true, validationRule: "Trigger conditions, rollback steps (exact commands), verification steps." },
      { section: "Monitoring", required: false, validationRule: "If applicable: what metrics/logs to watch post-deploy. Risk note if no monitoring." },
      { section: "Finalization", required: true, validationRule: "Exactly one finalization enum token selected (FINALIZE_MERGE_LOCAL | FINALIZE_OPEN_PR | FINALIZE_KEEP_BRANCH | FINALIZE_DISCARD_BRANCH | FINALIZE_NO_VCS). Execution result documented. Worktree cleaned if applicable." },
      { section: "Completion Status", required: false, validationRule: "If present: exactly one of SHIPPED, SHIPPED_WITH_EXCEPTIONS, BLOCKED. Exceptions documented when applicable. BLOCKED is required when the Victory Detector has stale or missing evidence." },
      { section: "Compound Step", required: false, validationRule: "Optional retrospective: include overlap assessment before appending duplicate knowledge; distinguish bug-track fixes/tests from knowledge-track process/project guidance; use supersedes/superseded_by only for clear refreshes; or include an explicit 'No compound insight this run.' line." }
    ]
  },
  reviewLens: {
    outputs: ["release package handoff", "rollback plan", "final branch decision"],
    reviewSections: [
      {
        title: "Preflight Verification",
        evaluationPoints: [
          "Test suite: full run, all pass, output captured",
          "Build: clean build, exit code 0",
          "Lint/format: no violations",
          "Type-check: no errors",
          "Working tree: no uncommitted changes"
        ],
        stopGate: true
      },
      {
        title: "Release Readiness",
        evaluationPoints: [
          "Release notes are accurate and reference spec criteria",
          "Breaking changes are documented with migration steps",
          "Rollback plan has trigger, steps, and verification",
          "If applicable: monitoring/alerting is in place for the change"
        ],
        stopGate: true
      }
    ]
  },
  // `done` exits the stage pipeline. Archive semantics are handled by the
  // closeout substate machine (`idle` -> ... -> `archived`) in flow-state under
  // ${closeoutSubstateInline()}.
  next: "done",
};
