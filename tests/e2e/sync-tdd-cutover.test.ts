import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { syncCclaw } from "../../src/install.js";
import { createInitialFlowState } from "../../src/flow-state.js";
import { createTempProject } from "../helpers/index.js";

/**
 * v6.12.0 Phase A (e2e) — `cclaw-cli sync` auto-detects legacy `06-tdd.md`
 * artifacts that lack auto-render markers, inserts the v6.11.0 marker
 * skeleton + a one-line cutover banner, mkdir's `tdd-slices/`, and stamps
 * the highest legacy slice id into `flow-state.json::tddCutoverSliceId`.
 * Idempotent: re-running sync is byte-stable once markers are present.
 */

const LEGACY_TDD_BODY = `---
stage: tdd
artifact_version: 1
---

# TDD Artifact

## Upstream Handoff
- Source artifacts: \`05-plan.md\`, \`04-spec.md\`.
- Decisions carried forward: legacy slices used markdown tables.

## System-Wide Impact Check
| Slice | Callbacks/state/interfaces/contracts affected | Coverage decision |
|---|---|---|
| S-1  | linter slice cycle | covered |
| S-5  | linter slice cycle | covered |
| S-10 | linter slice cycle | covered |

## Watched-RED Proof
| Slice | Test name | Observed at (ISO ts) | Failure reason snippet | Source command/log |
|---|---|---|---|---|
| S-1  | t1  | 2026-01-01T09:00:00Z | FAIL Assertion | npm test |
| S-3  | t3  | 2026-01-01T09:01:00Z | FAIL Assertion | npm test |
| S-5  | t5  | 2026-01-01T09:02:00Z | FAIL Assertion | npm test |
| S-7  | t7  | 2026-01-01T09:03:00Z | FAIL Assertion | npm test |
| S-10 | t10 | 2026-01-01T09:04:00Z | FAIL Assertion | npm test |

## Vertical Slice Cycle
| Slice | RED ts | GREEN ts | REFACTOR ts |
|---|---|---|---|
| S-1  | 2026-01-01T09:00:00Z | 2026-01-01T09:01:00Z | 2026-01-01T09:02:00Z |
| S-3  | 2026-01-01T09:03:00Z | 2026-01-01T09:04:00Z | 2026-01-01T09:05:00Z |
| S-5  | 2026-01-01T09:06:00Z | 2026-01-01T09:07:00Z | 2026-01-01T09:08:00Z |
| S-7  | 2026-01-01T09:09:00Z | 2026-01-01T09:10:00Z | 2026-01-01T09:11:00Z |
| S-10 | 2026-01-01T09:12:00Z | 2026-01-01T09:13:00Z | 2026-01-01T09:14:00Z |

## Iron Law Acknowledgement
- Iron Law: NO PRODUCTION CODE WITHOUT A FAILING TEST FIRST.
- Acknowledged: yes.
- Exceptions invoked (or \`- None.\`):
  - None.
`;

async function seedLegacyState(root: string): Promise<void> {
  const stateDir = path.join(root, ".cclaw/state");
  await fs.mkdir(stateDir, { recursive: true });
  const state = createInitialFlowState({
    activeRunId: "run-cutover-sync",
    track: "standard",
    discoveryMode: "guided"
  });
  state.currentStage = "tdd";
  state.completedStages = ["brainstorm", "scope", "design", "spec", "plan"];
  await fs.writeFile(
    path.join(stateDir, "flow-state.json"),
    `${JSON.stringify(state, null, 2)}\n`,
    "utf8"
  );
}

async function seedLegacyTddArtifact(root: string): Promise<void> {
  const artifactsDir = path.join(root, ".cclaw/artifacts");
  await fs.mkdir(artifactsDir, { recursive: true });
  await fs.writeFile(path.join(artifactsDir, "06-tdd.md"), LEGACY_TDD_BODY, "utf8");
}

describe("e2e: cclaw-cli sync — auto-cutover for legacy 06-tdd.md (v6.12.0 Phase A)", () => {
  it("inserts the cutover banner + auto-render markers + tdd-slices/ + flow-state.tddCutoverSliceId", async () => {
    const root = await createTempProject("sync-tdd-cutover-fresh");
    await seedLegacyState(root);
    await seedLegacyTddArtifact(root);

    await syncCclaw(root);

    const tddRaw = await fs.readFile(
      path.join(root, ".cclaw/artifacts/06-tdd.md"),
      "utf8"
    );
    expect(tddRaw).toContain("<!-- v6.12.0 cutover: slices S-1..S-10 use legacy per-slice tables.");
    expect(tddRaw).toContain("<!-- auto-start: slices-index -->");
    expect(tddRaw).toContain("<!-- auto-end: slices-index -->");
    expect(tddRaw).toContain("<!-- auto-start: tdd-slice-summary -->");
    expect(tddRaw).toContain("<!-- auto-end: tdd-slice-summary -->");
    expect(tddRaw).toContain("# TDD Artifact");
    expect(tddRaw).toContain("## Watched-RED Proof");

    const slicesStat = await fs.stat(path.join(root, ".cclaw/artifacts/tdd-slices"));
    expect(slicesStat.isDirectory()).toBe(true);

    const flowState = JSON.parse(
      await fs.readFile(path.join(root, ".cclaw/state/flow-state.json"), "utf8")
    ) as Record<string, unknown>;
    expect(flowState.tddCutoverSliceId).toBe("S-10");
  });

  it("is byte-stable on the second sync run (no banner duplication)", async () => {
    const root = await createTempProject("sync-tdd-cutover-idempotent");
    await seedLegacyState(root);
    await seedLegacyTddArtifact(root);

    await syncCclaw(root);
    const firstRaw = await fs.readFile(
      path.join(root, ".cclaw/artifacts/06-tdd.md"),
      "utf8"
    );

    await syncCclaw(root);
    const secondRaw = await fs.readFile(
      path.join(root, ".cclaw/artifacts/06-tdd.md"),
      "utf8"
    );
    expect(secondRaw).toBe(firstRaw);

    const occurrences = secondRaw.match(/v6\.12\.0 cutover/gu) ?? [];
    expect(occurrences.length).toBe(1);
  });

  it("skips when no slice activity exists in 06-tdd.md (no false-positive cutover)", async () => {
    const root = await createTempProject("sync-tdd-cutover-no-activity");
    await seedLegacyState(root);
    const artifactsDir = path.join(root, ".cclaw/artifacts");
    await fs.mkdir(artifactsDir, { recursive: true });
    const minimal = `# TDD Artifact

## Iron Law Acknowledgement
- Acknowledged: yes.
`;
    await fs.writeFile(path.join(artifactsDir, "06-tdd.md"), minimal, "utf8");

    await syncCclaw(root);

    const tddRaw = await fs.readFile(
      path.join(root, ".cclaw/artifacts/06-tdd.md"),
      "utf8"
    );
    expect(tddRaw).not.toContain("v6.12.0 cutover");
    const flowState = JSON.parse(
      await fs.readFile(path.join(root, ".cclaw/state/flow-state.json"), "utf8")
    ) as Record<string, unknown>;
    expect(flowState.tddCutoverSliceId).toBeUndefined();
  });
});
