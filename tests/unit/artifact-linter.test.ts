import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { lintArtifact, validateReviewArmy } from "../../src/artifact-linter.js";

async function writeRuntimeArtifact(root: string, fileName: string, content: string): Promise<void> {
  await fs.mkdir(path.join(root, ".cclaw/state"), { recursive: true });
  await fs.mkdir(path.join(root, ".cclaw/artifacts"), { recursive: true });
  await fs.writeFile(path.join(root, ".cclaw/state/flow-state.json"), JSON.stringify({
    currentStage: "brainstorm",
    activeRunId: "run-lint",
    completedStages: []
  }, null, 2), "utf8");
  await fs.writeFile(path.join(root, ".cclaw/artifacts", fileName), content, "utf8");
}

describe("artifact linter heuristics", () => {
  it("fails rules that require at least N list/table items", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "cclaw-artifact-lint-"));
    await writeRuntimeArtifact(root, "01-brainstorm.md", `# Brainstorm Artifact

## Problem Statement
- User problem: add robust automation

## Alternatives Table
| Option | Summary | Trade-offs | Recommendation |
|---|---|---|---|
| A |  |  |  |

## Approved Direction
- Selected option: A
- Approval marker: approved

## Open Questions
- None
`);

    const result = await lintArtifact(root, "brainstorm");
    const alternatives = result.findings.find((f) => f.section === "Alternatives Table");
    expect(result.passed).toBe(false);
    expect(alternatives?.found).toBe(false);
    expect(alternatives?.details).toContain("at least 2");
  });

  it("passes when required section depth is satisfied", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "cclaw-artifact-lint-pass-"));
    await writeRuntimeArtifact(root, "01-brainstorm.md", `# Brainstorm Artifact

## Problem Statement
- User problem: add robust automation
- Who benefits: platform team
- Why now: reliability incidents increasing

## Known Context
- Explored files: src/release.ts, CI workflow
- Existing behavior: manual release steps

## Clarification Log
| Category | Question asked | User answer | Evidence note |
|---|---|---|---|
| PURPOSE | Why now? | release quality | user message 1 |
| SCOPE | What is out-of-scope? | no CI rewrite | user message 2 |
| BOUNDARIES | What to do on failure? | stop + surface error | user message 3 |
| ENVIRONMENT | Where runs? | GitHub Actions + npm | user message 4 |
| CONSTRAINTS | Dependency limits? | no extra runtime deps | user message 5 |

## Purpose & Beneficiaries
- Why this exists: reduce release incidents
- Primary users: release engineers
- Value outcome: predictable cutover

## Scope Boundaries
### In Scope
- automate publish checks
- enforce release metadata

### Out of Scope
- no migration of deployment platform

## Failure Boundaries
- Edge case: metadata missing should block release
- Error visibility: failed checks must be explicit in logs
- Fallback: release stays draft until issues fixed

## Runtime Environment
- Runtime/platform: Node.js 20 in GitHub Actions
- Install/distribution model: npm publish public package
- Execution context: CI gate and manual release flow

## Constraints
- Performance constraints: keep release validation under 2 minutes
- Compatibility constraints: support current GitHub Actions setup
- Dependency constraints: avoid adding new runtime dependencies

## Alternatives Table
| Option | Summary | Trade-offs | Recommendation |
|---|---|---|---|
| A | conservative | low risk |  |
| B | broader | higher blast radius | recommended |

## Approved Direction
- Selected option: B
- What was approved: broader refactor approach
- Approval marker: approved by user

## Assumptions & Risks
- Assumes CI pipeline is stable

## Open Questions
- None
`);

    const result = await lintArtifact(root, "brainstorm");
    expect(result.passed).toBe(true);
  });

  it("fails brainstorm clarification log when evidence note column is missing", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "cclaw-artifact-lint-clarification-columns-"));
    await writeRuntimeArtifact(root, "01-brainstorm.md", `# Brainstorm Artifact

## Problem Statement
- User problem: add robust automation
- Who benefits: platform team
- Why now: reliability incidents increasing

## Known Context
- Explored files: src/release.ts, CI workflow
- Existing behavior: manual release steps

## Clarification Log
| Category | Question asked | User answer |
|---|---|---|
| PURPOSE | Why now? | release quality |
| SCOPE | What is out-of-scope? | no CI rewrite |
| BOUNDARIES | What to do on failure? | stop + surface error |
| ENVIRONMENT | Where runs? | GitHub Actions + npm |
| CONSTRAINTS | Dependency limits? | no extra runtime deps |

## Purpose & Beneficiaries
- Why this exists: reduce release incidents
- Primary users: release engineers
- Value outcome: predictable cutover

## Scope Boundaries
### In Scope
- automate publish checks
- enforce release metadata

### Out of Scope
- no migration of deployment platform

## Failure Boundaries
- Edge case: metadata missing should block release
- Error visibility: failed checks must be explicit in logs

## Runtime Environment
- Runtime/platform: Node.js 20 in GitHub Actions
- Install/distribution model: npm publish public package

## Constraints
- Performance constraints: keep release validation under 2 minutes
- Compatibility constraints: support current GitHub Actions setup

## Alternatives Table
| Option | Summary | Trade-offs | Recommendation |
|---|---|---|---|
| A | conservative | low risk |  |
| B | broader | higher blast radius | recommended |

## Approved Direction
- Selected option: B
- What was approved: broader refactor approach
- Approval marker: approved by user

## Assumptions & Risks
- Assumes CI pipeline is stable

## Open Questions
- None
`);

    const result = await lintArtifact(root, "brainstorm");
    const clarification = result.findings.find((finding) => finding.section === "Clarification Log");
    expect(result.passed).toBe(false);
    expect(clarification?.found).toBe(false);
    expect(clarification?.details).toContain("Clarification Log header");
  });

  it("enforces exactly one selected enum token in finalization", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "cclaw-artifact-lint-enum-"));
    await writeRuntimeArtifact(root, "08-ship.md", `# Ship Artifact

## Preflight Results
- Build: pass

## Release Notes
- Updated rollout logic

## Rollback Plan
- Verification steps: run smoke tests

## Monitoring
- Metrics/logs to watch: request latency

## Finalization
- FINALIZE_MERGE_LOCAL
- FINALIZE_OPEN_PR
- FINALIZE_KEEP_BRANCH
- FINALIZE_DISCARD_BRANCH
`);

    const result = await lintArtifact(root, "ship");
    const finalization = result.findings.find((f) => f.section === "Finalization");
    expect(finalization?.found).toBe(false);
    expect(finalization?.details).toContain("exactly one selected token");
  });

  it("requires review readiness dashboard section for review artifacts", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "cclaw-artifact-lint-review-readiness-"));
    await writeRuntimeArtifact(root, "07-review.md", `# Review Artifact

## Layer 1 Verdict
| Criterion | Verdict | Evidence |
|---|---|---|
| AC-1 | PASS | src/a.ts |

## Layer 2 Findings
| ID | Severity | Category | Description | Status |
|---|---|---|---|---|
| R-1 | Suggestion | correctness | tighten naming | open |

## Review Army Contract
- See \`07-review-army.json\`
- Reconciliation summary: none

## Severity Summary
- Critical: 0
- Important: 0
- Suggestion: 1

## Final Verdict
- APPROVED
`);

    const result = await lintArtifact(root, "review");
    const readiness = result.findings.find((finding) => finding.section === "Review Readiness Dashboard");
    expect(result.passed).toBe(false);
    expect(readiness?.found).toBe(false);
  });
});

describe("review army schema validation", () => {
  it("accepts structured review-army payload with consistent blockers", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "cclaw-review-army-valid-"));
    await fs.mkdir(path.join(root, ".cclaw/state"), { recursive: true });
    await fs.mkdir(path.join(root, ".cclaw/artifacts"), { recursive: true });
    await fs.writeFile(path.join(root, ".cclaw/state/flow-state.json"), JSON.stringify({
      currentStage: "review",
      activeRunId: "run-review",
      completedStages: []
    }, null, 2), "utf8");
    await fs.writeFile(path.join(root, ".cclaw/artifacts/07-review-army.json"), JSON.stringify({
      version: 1,
      generatedAt: "2026-01-01T00:00:00Z",
      scope: { base: "main", head: "feature", files: ["src/a.ts"] },
      findings: [{
        id: "F-1",
        severity: "Critical",
        confidence: 8,
        fingerprint: "fp-1",
        reportedBy: ["spec-reviewer", "code-reviewer"],
        status: "open",
        location: { file: "src/a.ts", line: 10 },
        recommendation: "Add guard"
      }],
      reconciliation: {
        duplicatesCollapsed: 0,
        conflicts: [],
        multiSpecialistConfirmed: ["F-1"],
        shipBlockers: ["F-1"]
      }
    }, null, 2), "utf8");

    const result = await validateReviewArmy(root);
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("rejects open critical findings that are not listed as ship blockers", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "cclaw-review-army-invalid-"));
    await fs.mkdir(path.join(root, ".cclaw/state"), { recursive: true });
    await fs.mkdir(path.join(root, ".cclaw/artifacts"), { recursive: true });
    await fs.writeFile(path.join(root, ".cclaw/state/flow-state.json"), JSON.stringify({
      currentStage: "review",
      activeRunId: "run-review",
      completedStages: []
    }, null, 2), "utf8");
    await fs.writeFile(path.join(root, ".cclaw/artifacts/07-review-army.json"), JSON.stringify({
      version: 1,
      generatedAt: "2026-01-01T00:00:00Z",
      scope: { base: "main", head: "feature", files: ["src/a.ts"] },
      findings: [{
        id: "F-1",
        severity: "Critical",
        confidence: 9,
        fingerprint: "fp-1",
        reportedBy: ["security-reviewer"],
        status: "open",
        recommendation: "Patch before merge"
      }],
      reconciliation: {
        duplicatesCollapsed: 0,
        conflicts: [],
        multiSpecialistConfirmed: [],
        shipBlockers: []
      }
    }, null, 2), "utf8");

    const result = await validateReviewArmy(root);
    expect(result.valid).toBe(false);
    expect(result.errors.join("\n")).toContain("shipBlockers must include open Critical finding");
  });
});
