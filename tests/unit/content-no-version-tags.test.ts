import { promises as fs } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Guard: agent-facing prompt content under `src/content/` must not carry
 * cclaw release-version tags (e.g. `v8.62`, `pre-v8.80`, `v8.105`).
 *
 * Rationale: version archaeology baked into prompts/runbooks/skills/templates
 * wastes the sub-agent's token budget and confuses it with historical churn
 * that has no bearing on current behavior. Version history belongs in
 * CHANGELOG.md, not in the text we ship to the model on every dispatch.
 *
 * The pattern intentionally targets the `v8.<n>` shape (the documented
 * pollution). Bare major-version references like "predates cclaw v8" or
 * example task text like "bump the postgres driver to v8" do NOT match and
 * remain allowed.
 */
const CONTENT_DIR = path.join(path.resolve(process.cwd()), "src/content");
const VERSION_TAG = /v8\.\d+/;

async function walk(dir: string): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) return walk(full);
      if (entry.isFile() && /\.(ts|md)$/.test(entry.name)) return [full];
      return [];
    })
  );
  return files.flat();
}

describe("content guard — no cclaw version tags in src/content", () => {
  it("no `v8.<n>` version tag appears in any prompt / runbook / skill / template", async () => {
    const files = await walk(CONTENT_DIR);
    expect(files.length).toBeGreaterThan(0);

    const offenders: string[] = [];
    for (const file of files) {
      const body = await fs.readFile(file, "utf8");
      const lines = body.split("\n");
      lines.forEach((line, idx) => {
        if (VERSION_TAG.test(line)) {
          const rel = path.relative(process.cwd(), file);
          offenders.push(`${rel}:${idx + 1}: ${line.trim().slice(0, 120)}`);
        }
      });
    }

    expect(
      offenders,
      `Found cclaw version tags in src/content (move version history to CHANGELOG.md):\n${offenders.join("\n")}`
    ).toEqual([]);
  });
});
