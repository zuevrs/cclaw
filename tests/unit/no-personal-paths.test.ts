import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { harnessIntegrationDocMarkdown } from "../../src/content/harness-doc.js";
import { usingCclawSkillMarkdown } from "../../src/content/meta-skill.js";
import { stageSkillMarkdown } from "../../src/content/skills.js";
import { FLOW_STAGES } from "../../src/types.js";

const PERSONAL_PATH_MARKER = "/Users/";
const PERSONAL_PATH_REGEX = /\/Users\/[A-Za-z][A-Za-z0-9_-]+/u;
const REPO_ROOT = path.resolve(fileURLToPath(new URL("../../", import.meta.url)));

describe("generated markdown is path-neutral", () => {
  it("keeps scope and design skills free of personal absolute paths", () => {
    expect(stageSkillMarkdown("scope")).not.toContain(PERSONAL_PATH_MARKER);
    expect(stageSkillMarkdown("design")).not.toContain(PERSONAL_PATH_MARKER);
  });

  it("keeps every stage skill free of personal absolute paths", () => {
    for (const stage of FLOW_STAGES) {
      expect(
        stageSkillMarkdown(stage),
        `stage "${stage}" leaked a personal absolute path`
      ).not.toContain(PERSONAL_PATH_MARKER);
    }
  });

  it("keeps the meta skill and harness integration doc path-neutral", () => {
    expect(usingCclawSkillMarkdown()).not.toContain(PERSONAL_PATH_MARKER);
    expect(harnessIntegrationDocMarkdown()).not.toContain(PERSONAL_PATH_MARKER);
  });

  it("keeps every tracked file in the repo path-neutral", () => {
    // Sweep across git-tracked files so that even committed generated
    // outputs (e.g. docs/harnesses.md) are caught when they drift from a
    // path-neutral source. Excludes the lock and this test itself, which
    // legitimately documents the marker.
    const raw = execFileSync("git", ["ls-files", "-z"], {
      cwd: REPO_ROOT,
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024
    });
    const allowlist = new Set([
      "tests/unit/no-personal-paths.test.ts",
      "package-lock.json"
    ]);
    const offenders: Array<{ file: string; line: number; sample: string }> = [];
    for (const rel of raw.split("\0")) {
      if (!rel || allowlist.has(rel)) continue;
      const abs = path.join(REPO_ROOT, rel);
      let buf: Buffer;
      try {
        buf = fs.readFileSync(abs);
      } catch {
        continue;
      }
      // Skip likely binaries (heuristic: contains a NUL byte in the first 4KB).
      const sniff = buf.subarray(0, 4096);
      if (sniff.includes(0)) continue;
      const text = buf.toString("utf8");
      if (!PERSONAL_PATH_REGEX.test(text)) continue;
      const lines = text.split(/\r?\n/u);
      for (let i = 0; i < lines.length; i++) {
        if (PERSONAL_PATH_REGEX.test(lines[i])) {
          offenders.push({ file: rel, line: i + 1, sample: lines[i].slice(0, 200) });
          break;
        }
      }
    }
    expect(
      offenders,
      `tracked files leaked personal absolute paths:\n${offenders
        .map((o) => `  ${o.file}:${o.line} -> ${o.sample}`)
        .join("\n")}`
    ).toEqual([]);
  });
});
