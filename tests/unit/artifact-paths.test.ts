import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  legacyArtifactFileName,
  resolveArtifactPath,
  slugifyArtifactTopic
} from "../../src/artifact-paths.js";
import { createTempProject } from "../helpers/index.js";

async function ensureArtifactsDir(root: string): Promise<string> {
  const artifactsDir = path.join(root, ".cclaw/artifacts");
  await fs.mkdir(artifactsDir, { recursive: true });
  return artifactsDir;
}

describe("artifact path resolver", () => {
  it("slugifies topics into stable artifact-safe names", () => {
    expect(slugifyArtifactTopic("  Billing Sync: Retry + Backoff!  ")).toBe("billing-sync-retry-backoff");
    expect(slugifyArtifactTopic("!!!")).toBe("topic");
  });

  it("derives legacy file name from slug pattern", () => {
    expect(legacyArtifactFileName("01-brainstorm-<slug>.md")).toBe("01-brainstorm.md");
    expect(legacyArtifactFileName("04-spec.md")).toBe("04-spec.md");
  });

  it("resolves latest slugged artifact when legacy and new files coexist", async () => {
    const root = await createTempProject("artifact-paths-read-prefers-slug");
    const artifactsDir = await ensureArtifactsDir(root);
    await fs.writeFile(path.join(artifactsDir, "02-scope.md"), "# legacy\n", "utf8");
    await fs.writeFile(path.join(artifactsDir, "02-scope-billing-sync.md"), "# slugged\n", "utf8");

    const resolved = await resolveArtifactPath("scope", {
      projectRoot: root,
      intent: "read"
    });
    expect(resolved.fileName).toBe("02-scope-billing-sync.md");
    expect(resolved.source).toBe("existing");
    expect(resolved.legacy).toBe(false);
  });

  it("falls back to legacy artifact during slug migration grace period", async () => {
    const root = await createTempProject("artifact-paths-read-legacy");
    const artifactsDir = await ensureArtifactsDir(root);
    await fs.writeFile(path.join(artifactsDir, "01-brainstorm.md"), "# legacy brainstorm\n", "utf8");

    const resolved = await resolveArtifactPath("brainstorm", {
      projectRoot: root,
      intent: "read"
    });
    expect(resolved.fileName).toBe("01-brainstorm.md");
    expect(resolved.source).toBe("existing");
    expect(resolved.legacy).toBe(true);
  });

  it("adds numeric suffix when two topics collide on the same slug", async () => {
    const root = await createTempProject("artifact-paths-collision");
    const artifactsDir = await ensureArtifactsDir(root);
    await fs.writeFile(path.join(artifactsDir, "01-brainstorm-release-flow.md"), "# first\n", "utf8");
    await fs.writeFile(path.join(artifactsDir, "01-brainstorm-release-flow-2.md"), "# second\n", "utf8");

    const resolved = await resolveArtifactPath("brainstorm", {
      projectRoot: root,
      topic: "Release flow",
      intent: "write"
    });
    expect(resolved.fileName).toBe("01-brainstorm-release-flow-3.md");
    expect(resolved.source).toBe("generated");
    expect(resolved.legacy).toBe(false);
  });
});
