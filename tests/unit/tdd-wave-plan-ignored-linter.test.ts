import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { evaluateWavePlanDispatchIgnored } from "../../src/artifact-linter/tdd.js";
import type { DelegationEvent } from "../../src/delegation.js";
import type { DelegationEntry } from "../../src/delegation.js";
import { createTempProject } from "../helpers/index.js";

function ev(partial: Partial<DelegationEvent> & Pick<DelegationEvent, "agent" | "sliceId">): DelegationEvent {
  return {
    stage: "tdd",
    runId: "run-wave-ignore",
    event: "completed",
    eventTs: new Date().toISOString(),
    schemaVersion: 3,
    status: "completed",
    mode: "mandatory",
    ...partial
  } as DelegationEvent;
}

describe("tdd_wave_plan_ignored (v6.13.1)", () => {
  it("fires when parallel plan shows 2+ ready slices but only one slice-implementer in tail", async () => {
    const root = await createTempProject("tdd-wave-ignored");
    const planMarkdown = `# Plan
## Implementation Units
### Implementation Unit U-1
- **dependsOn:** none
- **claimedPaths:** src/a.ts
- **parallelizable:** true
- **riskTier:** low
### Implementation Unit U-2
- **dependsOn:** none
- **claimedPaths:** src/b.ts
- **parallelizable:** true
- **riskTier:** low

<!-- parallel-exec-managed-start -->
## Parallel Execution Plan
### Wave 01
- **Members:** S-1, S-2
<!-- parallel-exec-managed-end -->
`;
    await fs.mkdir(path.join(root, ".cclaw/artifacts"), { recursive: true });
    await fs.writeFile(path.join(root, ".cclaw/artifacts/05-plan.md"), planMarkdown, "utf8");

    const tail: DelegationEvent[] = [];
    for (let i = 0; i < 19; i += 1) {
      tail.push(
        ev({
          agent: "test-author",
          sliceId: "S-1",
          phase: "red",
          completedTs: new Date(Date.UTC(2026, 0, 1, 12, 0, i)).toISOString()
        })
      );
    }
    tail.push(
      ev({
        agent: "slice-implementer",
        sliceId: "S-1",
        phase: "green",
        completedTs: new Date(Date.UTC(2026, 0, 1, 13, 0, 0)).toISOString()
      })
    );

    const slices = new Map<string, DelegationEntry[]>();
    const finding = await evaluateWavePlanDispatchIgnored({
      artifactsDir: path.join(root, ".cclaw/artifacts"),
      planMarkdown,
      runEvents: tail.map((t) => ({ ...t, runId: "run-wave-ignore" })),
      runId: "run-wave-ignore",
      slices,
      legacyContinuation: false
    });
    expect(finding).toBeDefined();
    expect(finding!.section).toBe("tdd_wave_plan_ignored");
    expect(finding!.details).toContain("S-2");
  });

  it("passes when tail shows multiple slice-implementer slices", async () => {
    const root = await createTempProject("tdd-wave-not-ignored");
    const planMarkdown = `<!-- parallel-exec-managed-start -->
## Parallel Execution Plan
### Wave 01
- **Members:** S-1, S-2
<!-- parallel-exec-managed-end -->

## Implementation Units
### Implementation Unit U-1
- **dependsOn:** none
- **claimedPaths:** a
- **parallelizable:** true
- **riskTier:** low
### Implementation Unit U-2
- **dependsOn:** none
- **claimedPaths:** b
- **parallelizable:** true
- **riskTier:** low
`;
    await fs.mkdir(path.join(root, ".cclaw/artifacts"), { recursive: true });
    await fs.writeFile(path.join(root, ".cclaw/artifacts/05-plan.md"), planMarkdown, "utf8");

    const tail: DelegationEvent[] = [
      ev({ agent: "slice-implementer", sliceId: "S-1", phase: "green" }),
      ev({ agent: "slice-implementer", sliceId: "S-2", phase: "green" })
    ];
    const finding = await evaluateWavePlanDispatchIgnored({
      artifactsDir: path.join(root, ".cclaw/artifacts"),
      planMarkdown,
      runEvents: tail.map((t) => ({ ...t, runId: "run-wave-ignore-2" })),
      runId: "run-wave-ignore-2",
      slices: new Map(),
      legacyContinuation: false
    });
    expect(finding).toBeNull();
  });
});
