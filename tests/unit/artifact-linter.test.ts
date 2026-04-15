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
    activeRunId: "active",
    completedStages: []
  }, null, 2), "utf8");
  await fs.writeFile(path.join(root, ".cclaw/artifacts", fileName), content, "utf8");
}

describe("artifact linter heuristics", () => {
  it("fails when required brainstorm sections are missing", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "cclaw-artifact-lint-missing-"));
    await writeRuntimeArtifact(root, "01-brainstorm.md", `# Brainstorm Artifact

## Context
- Project state: monorepo with CI
- Relevant existing code/patterns: pre-publish.sh

## Problem
- What we're solving: reduce release regressions
- Success criteria: invalid metadata blocked before publish
- Constraints: no new runtime dependencies

## Clarifying Questions
| # | Question | Answer | Decision impact |
|---|---|---|---|
| 1 | Block or warn? | Block | enforce hard gate |

## Selected Direction
- Approach: B
- Rationale: reusable module
- Approval: approved

## Design
- Architecture: shared validation module
- Key components: validator
- Data flow: metadata -> checks -> result

## Assumptions and Open Questions
- Assumptions: CI remains source of truth
- Open questions (or "None"): None
`);

    const result = await lintArtifact(root, "brainstorm");
    const approaches = result.findings.find((finding) => finding.section === "Approaches");
    expect(result.passed).toBe(false);
    expect(approaches?.found).toBe(false);
  });

  it("passes brainstorm artifact when required sections are present", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "cclaw-artifact-lint-pass-"));
    await writeRuntimeArtifact(root, "01-brainstorm.md", `# Brainstorm Artifact

## Context
- Project state: monorepo with CI pipeline and custom release scripts
- Relevant existing code/patterns: scripts/pre-publish.sh does metadata checks

## Problem
- What we're solving: reduce release regressions
- Success criteria: invalid metadata blocked before publish
- Constraints: no new runtime dependencies

## Clarifying Questions
| # | Question | Answer | Decision impact |
|---|---|---|---|
| 1 | Block invalid metadata or warn? | Block | hard gate required |
| 2 | Add runtime dependencies? | No | stay on existing runtime stack |

## Approaches
| Approach | Architecture | Trade-offs | Recommendation |
|---|---|---|---|
| A | script-only checks | faster but weaker reuse |  |
| B | reusable validation module | slightly more effort, better long-term reuse | recommended |

## Selected Direction
- Approach: B — reusable validation module
- Rationale: best balance of reuse and delivery speed
- Approval: approved by user

## Design
- Architecture: shared TS module with typed validators imported by CI and local CLI
- Key components: validateMetadata, validateChangelog, validateVersion, runAll
- Data flow: package.json + CHANGELOG.md -> validator module -> structured result

## Assumptions and Open Questions
- Assumptions: CI remains primary release path
- Open questions (or "None"): None
`);

    const result = await lintArtifact(root, "brainstorm");
    expect(result.passed).toBe(true);
  });

  it("fails brainstorm clarifying questions section when empty", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "cclaw-artifact-lint-empty-questions-"));
    await writeRuntimeArtifact(root, "01-brainstorm.md", `# Brainstorm Artifact

## Context
- Project state: monorepo
- Relevant existing code/patterns: pre-publish.sh

## Problem
- What we're solving: reduce release regressions
- Success criteria: invalid metadata blocked before publish
- Constraints: none

## Clarifying Questions

## Approaches
| Approach | Architecture | Trade-offs | Recommendation |
|---|---|---|---|
| A | script-only checks | quick but weaker reuse |  |
| B | reusable validation module | more effort, better reuse | recommended |

## Selected Direction
- Approach: B
- Rationale: reusable module
- Approval: approved

## Design
- Architecture: shared module
- Key components: validator
- Data flow: metadata -> checks -> result

## Assumptions and Open Questions
- Assumptions: CI remains source of truth
- Open questions (or "None"): None
`);

    const result = await lintArtifact(root, "brainstorm");
    const questions = result.findings.find((finding) => finding.section === "Clarifying Questions");
    expect(result.passed).toBe(false);
    expect(questions?.found).toBe(false);
    expect(questions?.details).toContain("no meaningful content");
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
      activeRunId: "active",
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
      activeRunId: "active",
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
