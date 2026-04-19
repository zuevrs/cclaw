import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Regression guard for v0.39.0: tsc emits `dist/cli.js` with mode 0644
// which produced `Permission denied` under npx. The build step now runs
// `scripts/chmod-bin.mjs` to stamp 0755 on every `bin` target, and this
// test verifies the post-build state before the tarball is ever packed.

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../..");

describe("bin targets", () => {
  it("have the executable bit set after build", async () => {
    const pkgRaw = await fs.readFile(
      path.join(repoRoot, "package.json"),
      "utf8"
    );
    const pkg = JSON.parse(pkgRaw) as { bin?: Record<string, string> | string };
    const binField = pkg.bin ?? {};
    const binPaths =
      typeof binField === "string" ? [binField] : Object.values(binField);

    expect(binPaths.length).toBeGreaterThan(0);

    for (const rel of binPaths) {
      const abs = path.resolve(repoRoot, rel);
      const info = await fs.stat(abs);
      const head = (await fs.readFile(abs, "utf8")).slice(0, 2);
      expect(
        (info.mode & 0o111) !== 0,
        `${rel} is missing exec bit (mode=${info.mode.toString(8)}); run \`npm run build\` which invokes scripts/chmod-bin.mjs`
      ).toBe(true);
      expect(head, `${rel} is missing #! shebang`).toBe("#!");
    }
  });
});
