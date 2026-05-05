import fs from "node:fs/promises";
import path from "node:path";
import { Writable } from "node:stream";
import { describe, expect, it } from "vitest";
import { runInternalCommand } from "../../src/internal/advance-stage.js";
import { ensureRunSystem, readFlowState, writeFlowState } from "../../src/runs.js";
import { stageSchema } from "../../src/content/stage-schema.js";
import { lintArtifact } from "../../src/artifact-linter.js";
import { createTempProject } from "../helpers/index.js";

/**
 * : `/cc-ideate` -> brainstorm evidence forwarding.
 *
 * Coverage:
 *   - `start-flow --from-idea-artifact=<path> --from-idea-candidate=I-#`
 *     persists `interactionHints.brainstorm.{fromIdeaArtifact,fromIdeaCandidateId}`.
 *   - The brainstorm stage exposes a checklist row that mentions the
 *     idea-evidence carry-forward (so the agent knows to honor the hint).
 *   - The brainstorm artifact validation accepts an optional
 *     `## Idea Evidence Carry-forward` section.
 *   - When the hint is set, the brainstorm linter blocks if the section is
 *     missing or fails to cite the artifact path / candidate id.
 *   - When the hint is absent, the section is purely optional.
 *   - sanitizeInteractionHints round-trips the new fields.
 */

interface CapturedIo {
  io: { stdout: Writable; stderr: Writable };
  stderr: () => string;
}

function captureIo(): CapturedIo {
  const stderrChunks: string[] = [];
  const stdout = new Writable({
    write(_chunk, _encoding, callback) {
      callback();
    }
  });
  const stderr = new Writable({
    write(chunk, _encoding, callback) {
      stderrChunks.push(chunk.toString());
      callback();
    }
  });
  return {
    io: { stdout, stderr },
    stderr: () => stderrChunks.join("")
  };
}

describe("idea-evidence forward (start-flow + brainstorm linter)", () => {
  it("start-flow persists fromIdeaArtifact + fromIdeaCandidateId into interactionHints.brainstorm", async () => {
    const root = await createTempProject("idea-evidence-forward-startflow");
    const captured = captureIo();
    const ideaPath = ".cclaw/ideas/idea-2026-04-29-improve-onboarding.md";

    const code = await runInternalCommand(
      root,
      [
        "start-flow",
        "--track=standard",
        "--prompt=improve onboarding",
        `--from-idea-artifact=${ideaPath}`,
        "--from-idea-candidate=I-3",
        "--quiet"
      ],
      captured.io
    );
    expect(code, captured.stderr()).toBe(0);

    const state = await readFlowState(root);
    expect(state.interactionHints?.brainstorm?.fromIdeaArtifact).toBe(ideaPath);
    expect(state.interactionHints?.brainstorm?.fromIdeaCandidateId).toBe("I-3");
    expect(state.interactionHints?.brainstorm?.recordedAt).toMatch(
      /\d{4}-\d{2}-\d{2}T/u
    );
  });

  it("rejects --from-idea-candidate without --from-idea-artifact", async () => {
    const root = await createTempProject("idea-evidence-forward-startflow-error");
    const captured = captureIo();
    const code = await runInternalCommand(
      root,
      [
        "start-flow",
        "--track=standard",
        "--prompt=anything",
        "--from-idea-candidate=I-1",
        "--quiet"
      ],
      captured.io
    );
    expect(code).toBe(1);
    expect(captured.stderr()).toContain("--from-idea-artifact");
  });

  it("brainstorm checklist exposes the idea-evidence carry-forward row", () => {
    const brainstorm = stageSchema("brainstorm");
    const carryRow = brainstorm.executionModel.checklist.find((row) =>
      row.includes("Idea-evidence carry-forward")
    );
    expect(carryRow).toBeDefined();
    expect(carryRow).toContain("fromIdeaArtifact");
    expect(carryRow).toContain("Idea Evidence Carry-forward");
  });

  it("brainstorm artifact validation accepts the Idea Evidence Carry-forward section as optional", () => {
    const brainstorm = stageSchema("brainstorm");
    const rule = brainstorm.artifactValidation.find(
      (row) => row.section === "Idea Evidence Carry-forward"
    );
    expect(rule).toBeDefined();
    expect(rule?.required).toBe(false);
    expect(rule?.validationRule).toMatch(/cc-ideate|fromIdeaArtifact/iu);
  });

  it("brainstorm linter BLOCKS when fromIdeaArtifact is set but Idea Evidence Carry-forward is missing", async () => {
    const root = await createTempProject("idea-evidence-forward-block-missing");
    await ensureRunSystem(root);

    const initial = await readFlowState(root);
    await writeFlowState(root, {
      ...initial,
      interactionHints: {
        ...(initial.interactionHints ?? {}),
        brainstorm: {
          fromIdeaArtifact: ".cclaw/ideas/idea-2026-04-29-thing.md",
          fromIdeaCandidateId: "I-2",
          recordedAt: new Date().toISOString()
        }
      }
    });

    await fs.mkdir(path.join(root, ".cclaw/artifacts"), { recursive: true });
    await fs.writeFile(
      path.join(root, ".cclaw/artifacts/01-brainstorm.md"),
      `# Brainstorm Artifact

## Q&A Log
| Turn | Question | User answer (1-line) | Decision impact |
|---|---|---|---|
| 1 | (stop-signal) | "достаточно, давай драфт" | stop-and-draft |

## Context
- Project state: monorepo
- Relevant existing code/patterns: idea backlog scan

## Approach Tier
- Tier: Standard
- Why this tier: bounded refactor with one shared module
`,
      "utf8"
    );

    const result = await lintArtifact(root, "brainstorm");
    const finding = result.findings.find(
      (f) => f.section === "brainstorm.idea_evidence_carry_forward"
    );
    expect(finding).toBeDefined();
    expect(finding?.required).toBe(true);
    expect(finding?.found).toBe(false);
    expect(finding?.details).toMatch(/Idea Evidence Carry-forward/iu);
  });

  it("brainstorm linter ACCEPTS when fromIdeaArtifact is set and the section cites the path + candidate", async () => {
    const root = await createTempProject("idea-evidence-forward-pass-cited");
    await ensureRunSystem(root);

    const ideaPath = ".cclaw/ideas/idea-2026-04-29-thing.md";
    const initial = await readFlowState(root);
    await writeFlowState(root, {
      ...initial,
      interactionHints: {
        ...(initial.interactionHints ?? {}),
        brainstorm: {
          fromIdeaArtifact: ideaPath,
          fromIdeaCandidateId: "I-2",
          recordedAt: new Date().toISOString()
        }
      }
    });

    await fs.mkdir(path.join(root, ".cclaw/artifacts"), { recursive: true });
    await fs.writeFile(
      path.join(root, ".cclaw/artifacts/01-brainstorm.md"),
      `# Brainstorm Artifact

## Q&A Log
| Turn | Question | User answer (1-line) | Decision impact |
|---|---|---|---|
| 1 | (stop-signal) | "достаточно, давай драфт" | stop-and-draft |

## Idea Evidence Carry-forward
- Source: \`${ideaPath}\`
- Candidate: I-2
- Reused fields: Title, Why-now, Expected impact, Risk, Counter-argument
- Newly generated: challenger row(s) only
`,
      "utf8"
    );

    const result = await lintArtifact(root, "brainstorm");
    const finding = result.findings.find(
      (f) => f.section === "brainstorm.idea_evidence_carry_forward"
    );
    expect(finding).toBeDefined();
    expect(finding?.found).toBe(true);
    expect(finding?.details).toMatch(/idea-2026-04-29-thing\.md/u);
  });

  it("brainstorm linter does NOT emit the carry-forward finding when no fromIdeaArtifact hint is set", async () => {
    const root = await createTempProject("idea-evidence-forward-skip-when-absent");
    await ensureRunSystem(root);

    await fs.mkdir(path.join(root, ".cclaw/artifacts"), { recursive: true });
    await fs.writeFile(
      path.join(root, ".cclaw/artifacts/01-brainstorm.md"),
      `# Brainstorm Artifact

## Q&A Log
| Turn | Question | User answer (1-line) | Decision impact |
|---|---|---|---|
| 1 | (stop-signal) | "достаточно, давай драфт" | stop-and-draft |
`,
      "utf8"
    );

    const result = await lintArtifact(root, "brainstorm");
    const finding = result.findings.find(
      (f) => f.section === "brainstorm.idea_evidence_carry_forward"
    );
    expect(finding).toBeUndefined();
  });

  it("brainstorm template includes the optional Idea Evidence Carry-forward section", async () => {
    const { ARTIFACT_TEMPLATES } = await import("../../src/content/templates.js");
    const template = ARTIFACT_TEMPLATES["01-brainstorm.md"] ?? "";
    expect(template).toContain("## Idea Evidence Carry-forward");
    expect(template).toContain("fromIdeaArtifact");
  });
});
