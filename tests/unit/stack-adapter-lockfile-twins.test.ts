import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadStackAdapter } from "../../src/stack-detection.js";
import { createTempProject } from "../helpers/index.js";

async function touch(root: string, rel: string, body = ""): Promise<void> {
  const target = path.join(root, rel);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, body, "utf8");
}

describe("stack-adapter lockfile twins (7.6.0)", () => {
  it("rust: detects Cargo.toml → Cargo.lock", async () => {
    const root = await createTempProject("adapter-rust");
    await touch(root, "Cargo.toml", "[package]\nname = \"x\"\n");
    const adapter = await loadStackAdapter(root);
    expect(adapter.id).toBe("rust");
    expect(adapter.lockfileTwins).toEqual([
      { manifestGlob: "Cargo.toml", lockfileGlob: "Cargo.lock" }
    ]);
    expect(adapter.testCommandHints[0]).toContain("cargo test");
  });

  it("node: detects package-lock.json when present", async () => {
    const root = await createTempProject("adapter-node-npm");
    await touch(root, "package.json", "{}");
    await touch(root, "package-lock.json", "{}");
    const adapter = await loadStackAdapter(root);
    expect(adapter.id).toBe("node");
    expect(adapter.lockfileTwins).toEqual([
      { manifestGlob: "package.json", lockfileGlob: "package-lock.json" }
    ]);
  });

  it("node: detects yarn.lock when present", async () => {
    const root = await createTempProject("adapter-node-yarn");
    await touch(root, "package.json", "{}");
    await touch(root, "yarn.lock", "");
    const adapter = await loadStackAdapter(root);
    expect(adapter.id).toBe("node");
    expect(adapter.lockfileTwins).toEqual([
      { manifestGlob: "package.json", lockfileGlob: "yarn.lock" }
    ]);
  });

  it("node: detects pnpm-lock.yaml when present", async () => {
    const root = await createTempProject("adapter-node-pnpm");
    await touch(root, "package.json", "{}");
    await touch(root, "pnpm-lock.yaml", "");
    const adapter = await loadStackAdapter(root);
    expect(adapter.id).toBe("node");
    expect(adapter.lockfileTwins).toEqual([
      { manifestGlob: "package.json", lockfileGlob: "pnpm-lock.yaml" }
    ]);
  });

  it("node: defaults to package-lock.json when no lockfile is on disk", async () => {
    const root = await createTempProject("adapter-node-default");
    await touch(root, "package.json", "{}");
    const adapter = await loadStackAdapter(root);
    expect(adapter.id).toBe("node");
    expect(adapter.lockfileTwins).toEqual([
      { manifestGlob: "package.json", lockfileGlob: "package-lock.json" }
    ]);
  });

  it("python: detects poetry.lock when pyproject.toml + poetry.lock present", async () => {
    const root = await createTempProject("adapter-python-poetry");
    await touch(root, "pyproject.toml", "[tool.poetry]\n");
    await touch(root, "poetry.lock", "");
    const adapter = await loadStackAdapter(root);
    expect(adapter.id).toBe("python");
    expect(adapter.lockfileTwins).toEqual([
      { manifestGlob: "pyproject.toml", lockfileGlob: "poetry.lock" }
    ]);
  });

  it("python: detects uv.lock", async () => {
    const root = await createTempProject("adapter-python-uv");
    await touch(root, "pyproject.toml", "[project]\n");
    await touch(root, "uv.lock", "");
    const adapter = await loadStackAdapter(root);
    expect(adapter.id).toBe("python");
    expect(adapter.lockfileTwins).toEqual([
      { manifestGlob: "pyproject.toml", lockfileGlob: "uv.lock" }
    ]);
  });

  it("python: detects Pipfile alongside pyproject", async () => {
    const root = await createTempProject("adapter-python-pipfile");
    await touch(root, "Pipfile", "");
    const adapter = await loadStackAdapter(root);
    expect(adapter.id).toBe("python");
    expect(adapter.lockfileTwins).toContainEqual({
      manifestGlob: "Pipfile",
      lockfileGlob: "Pipfile.lock"
    });
  });

  it("go: detects go.mod → go.sum", async () => {
    const root = await createTempProject("adapter-go");
    await touch(root, "go.mod", "module x\n");
    const adapter = await loadStackAdapter(root);
    expect(adapter.id).toBe("go");
    expect(adapter.lockfileTwins).toEqual([
      { manifestGlob: "go.mod", lockfileGlob: "go.sum" }
    ]);
  });

  it("ruby: detects Gemfile → Gemfile.lock", async () => {
    const root = await createTempProject("adapter-ruby");
    await touch(root, "Gemfile", "source 'https://rubygems.org'\n");
    const adapter = await loadStackAdapter(root);
    expect(adapter.id).toBe("ruby");
    expect(adapter.lockfileTwins).toEqual([
      { manifestGlob: "Gemfile", lockfileGlob: "Gemfile.lock" }
    ]);
  });

  it("php: detects composer.json → composer.lock", async () => {
    const root = await createTempProject("adapter-php");
    await touch(root, "composer.json", "{}");
    const adapter = await loadStackAdapter(root);
    expect(adapter.id).toBe("php");
    expect(adapter.lockfileTwins).toEqual([
      { manifestGlob: "composer.json", lockfileGlob: "composer.lock" }
    ]);
  });

  it("swift: detects Package.swift → Package.resolved", async () => {
    const root = await createTempProject("adapter-swift");
    await touch(root, "Package.swift", "// swift-tools-version:5.9\n");
    const adapter = await loadStackAdapter(root);
    expect(adapter.id).toBe("swift");
    expect(adapter.lockfileTwins).toEqual([
      { manifestGlob: "Package.swift", lockfileGlob: "Package.resolved" }
    ]);
  });

  it("dotnet: detects global.json → packages.lock.json glob", async () => {
    const root = await createTempProject("adapter-dotnet");
    await touch(root, "global.json", "{}");
    const adapter = await loadStackAdapter(root);
    expect(adapter.id).toBe("dotnet");
    expect(adapter.lockfileTwins).toEqual([
      { manifestGlob: "**/*.csproj", lockfileGlob: "**/packages.lock.json" }
    ]);
  });

  it("elixir: detects mix.exs → mix.lock", async () => {
    const root = await createTempProject("adapter-elixir");
    await touch(root, "mix.exs", "");
    const adapter = await loadStackAdapter(root);
    expect(adapter.id).toBe("elixir");
    expect(adapter.lockfileTwins).toEqual([
      { manifestGlob: "mix.exs", lockfileGlob: "mix.lock" }
    ]);
  });

  it("java: detects pom.xml with empty lockfileTwins (no canonical lockfile)", async () => {
    const root = await createTempProject("adapter-java");
    await touch(root, "pom.xml", "<project/>");
    const adapter = await loadStackAdapter(root);
    expect(adapter.id).toBe("java");
    expect(adapter.lockfileTwins).toEqual([]);
  });

  it("unknown: empty adapter degrades gracefully", async () => {
    const root = await createTempProject("adapter-unknown");
    const adapter = await loadStackAdapter(root);
    expect(adapter.id).toBe("unknown");
    expect(adapter.lockfileTwins).toEqual([]);
    expect(adapter.manifestGlobs).toEqual([]);
    expect(adapter.testCommandHints).toEqual([]);
    expect(adapter.wiringAggregator).toBeUndefined();
  });
});
