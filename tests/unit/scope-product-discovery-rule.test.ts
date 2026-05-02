import { describe, expect, it } from "vitest";
import { lintArtifact } from "../../src/artifact-linter.js";
import { ensureRunSystem } from "../../src/runs.js";
import { createTempProject, writeProjectFile } from "../helpers/index.js";

const baseScope = (summaryBody: string): string => `# Scope Artifact

## Q&A Log
| Turn | Question | User answer (1-line) | Decision impact |
|---|---|---|---|
| 1 | (stop-signal) | ok | stop-and-draft |

## Scope Mode
- [x] hold

## In Scope / Out of Scope
### In Scope
- Local todo interactions
### Out of Scope
- Backend API

## Completion Dashboard
- Checklist findings: 1/1
- Resolved decisions count: 1
- Unresolved decisions: None

## Scope Summary
${summaryBody}
`;

describe("scope product-discovery delegation rule", () => {
  it("reports Product Discovery Delegation finding for SELECTIVE EXPANSION without completed product-discovery", async () => {
    const root = await createTempProject("scope-pd-selective-missing");
    await ensureRunSystem(root);
    await writeProjectFile(
      root,
      ".cclaw/artifacts/02-scope.md",
      baseScope(
        "- Selected mode: SELECTIVE EXPANSION\n- Accepted scope: build a bigger slice\n- Next-stage handoff: design."
      )
    );
    const result = await lintArtifact(root, "scope");
    const pd = result.findings.find((f) => f.section === "Product Discovery Delegation (Strategist Mode)");
    expect(pd?.required).toBe(true);
    expect(pd?.found).toBe(false);
    expect(pd?.details ?? "").toMatch(/BEFORE stage-complete/iu);
    expect(pd?.details ?? "").toMatch(/product-discovery/iu);
  });

  it("does not require product-discovery row on quick track (demoted)", async () => {
    const root = await createTempProject("scope-pd-quick-skip");
    await ensureRunSystem(root);
    await writeProjectFile(
      root,
      ".cclaw/artifacts/02-scope.md",
      baseScope(
        "- Selected mode: SELECTIVE EXPANSION\n- Accepted scope: build a bigger slice\n- Next-stage handoff: design."
      )
    );
    const result = await lintArtifact(root, "scope", "quick");
    const pd = result.findings.find((f) => f.section === "Product Discovery Delegation (Strategist Mode)");
    expect(pd?.required).toBe(false);
    expect(pd?.found).toBe(true);
  });
});
