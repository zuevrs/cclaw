import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { resolveArtifactPath } from "../../src/artifact-paths.js";
import { lintArtifact } from "../../src/artifact-linter.js";
import { createInitialFlowState } from "../../src/flow-state.js";
import { ensureRunSystem, readFlowState, writeFlowState } from "../../src/runs.js";
import { createTempProject } from "../helpers/index.js";

const MINIMAL_BRAINSTORM = `---
stage: brainstorm
schema_version: "1"
version: test
run: fixture
locked_decisions: fixture
inputs_hash: sha256:pending
---

# Brainstorm Fixture

## Q&A Log
| Turn | Question | User answer | Decision impact |
|---|---|---|---|

## Learnings
- None this stage.
`;

describe("stage_artifact_post_closure_mutation advisory", () => {
  it("flags post-completion mtime drift without nonempty Amendments", async () => {
    const root = await createTempProject("post-closure-mutation-flag");
    await ensureRunSystem(root);
    await writeFlowState(
      root,
      createInitialFlowState({ track: "standard", discoveryMode: "guided" }),
      { allowReset: true }
    );
    const initial = await readFlowState(root);
    const resolved = await resolveArtifactPath("brainstorm", {
      projectRoot: root,
      track: initial.track,
      intent: "read"
    });
    await fs.mkdir(path.dirname(resolved.absPath), { recursive: true });
    await fs.writeFile(resolved.absPath, MINIMAL_BRAINSTORM, "utf8");
    await fs.utimes(
      resolved.absPath,
      new Date("2026-03-02T12:00:00.000Z"),
      new Date("2026-03-02T12:00:00.000Z")
    );

    await writeFlowState(
      root,
      {
        ...initial,
        currentStage: "brainstorm",
        completedStages: ["brainstorm"],
        completedStageMeta: {
          brainstorm: { completedAt: "2026-03-01T00:00:00.000Z" }
        }
      },
      { allowReset: true }
    );

    const result = await lintArtifact(root, "brainstorm", initial.track);
    const hit = result.findings.find((f) => f.section === "stage_artifact_post_closure_mutation");
    expect(hit).toBeDefined();
    expect(hit?.required).toBe(false);
  });

  it("suppresses advisory when nonempty Amendments exists", async () => {
    const root = await createTempProject("post-closure-mutation-ok-amend");
    await ensureRunSystem(root);
    await writeFlowState(
      root,
      createInitialFlowState({ track: "standard", discoveryMode: "guided" }),
      { allowReset: true }
    );
    const initial = await readFlowState(root);
    const resolved = await resolveArtifactPath("brainstorm", {
      projectRoot: root,
      track: initial.track,
      intent: "read"
    });
    await fs.mkdir(path.dirname(resolved.absPath), { recursive: true });
    const withAmendments = `${MINIMAL_BRAINSTORM}\n\n## Amendments\n- 2026-03-02 post-shipment note: clarified MVP scope.\n`;
    await fs.writeFile(resolved.absPath, withAmendments, "utf8");

    await writeFlowState(
      root,
      {
        ...initial,
        completedStages: ["brainstorm"],
        completedStageMeta: {
          brainstorm: { completedAt: "2026-03-01T00:00:00.000Z" }
        }
      },
      { allowReset: true }
    );

    const result = await lintArtifact(root, "brainstorm", initial.track);
    expect(result.findings.some((f) => f.section === "stage_artifact_post_closure_mutation")).toBe(
      false
    );
  });
});
