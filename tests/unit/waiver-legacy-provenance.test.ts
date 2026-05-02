import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { lintArtifact } from "../../src/artifact-linter.js";
import { appendDelegation } from "../../src/delegation.js";
import { ensureRunSystem } from "../../src/runs.js";
import { createTempProject } from "../helpers/index.js";

async function writeBrainstormArtifact(root: string): Promise<void> {
  const artifactsDir = path.join(root, ".cclaw/artifacts");
  await fs.mkdir(artifactsDir, { recursive: true });
  await fs.writeFile(
    path.join(artifactsDir, "01-brainstorm.md"),
    "# Brainstorm Artifact\n\n## Problem Decision Record\n- placeholder\n\n## Learnings\n- None this stage.\n",
    "utf8"
  );
}

describe("waiver_legacy_provenance advisory finding", () => {
  it("emits an advisory finding when a proactive waiver has no approvalToken", async () => {
    const root = await createTempProject("waiver-legacy-advisory");
    await ensureRunSystem(root);
    await writeBrainstormArtifact(root);
    await appendDelegation(root, {
      stage: "brainstorm",
      agent: "researcher",
      mode: "proactive",
      status: "waived",
      spanId: "span-legacy-1",
      runId: "run-test",
      waiverReason: "legacy_no_token",
      acceptedBy: "user-flag",
      schemaVersion: 3
    });

    const result = await lintArtifact(root, "brainstorm");
    const finding = result.findings.find((f) => f.section === "waiver_legacy_provenance");
    expect(finding).toBeDefined();
    expect(finding?.required).toBe(false);
    expect(finding?.found).toBe(false);
    expect(finding?.rule).toContain("waiver_legacy_provenance");
    expect(finding?.details).toContain("brainstorm");
    expect(finding?.details).toContain("researcher@span-legacy-1");
  });

  it("does NOT emit the advisory when the proactive waiver carries an approvalToken", async () => {
    const root = await createTempProject("waiver-legacy-ok");
    await ensureRunSystem(root);
    await writeBrainstormArtifact(root);
    await appendDelegation(root, {
      stage: "brainstorm",
      agent: "researcher",
      mode: "proactive",
      status: "waived",
      spanId: "span-fresh-1",
      runId: "run-test",
      waiverReason: "fresh_provenance",
      acceptedBy: "user-flag",
      approvalToken: "WV-brainstorm-abcdef12-20260502T220500Z",
      approvalReason: "fresh_provenance",
      approvalIssuedAt: "2026-05-02T21:35:00.000Z",
      schemaVersion: 3
    });

    const result = await lintArtifact(root, "brainstorm");
    const finding = result.findings.find((f) => f.section === "waiver_legacy_provenance");
    expect(finding).toBeUndefined();
  });

  it("never hard-blocks: an artifact with legacy waiver is still allowed to pass once content checks pass", async () => {
    const root = await createTempProject("waiver-legacy-no-block");
    await ensureRunSystem(root);
    await writeBrainstormArtifact(root);
    await appendDelegation(root, {
      stage: "brainstorm",
      agent: "researcher",
      mode: "proactive",
      status: "waived",
      spanId: "span-legacy-2",
      runId: "run-test",
      waiverReason: "legacy_no_token",
      acceptedBy: "user-flag",
      schemaVersion: 3
    });
    const result = await lintArtifact(root, "brainstorm");
    const blocker = result.findings.find(
      (f) => f.section === "waiver_legacy_provenance" && f.required === true
    );
    expect(blocker).toBeUndefined();
  });
});
