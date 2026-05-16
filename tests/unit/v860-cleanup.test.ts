import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ARTIFACT_TEMPLATES } from "../../src/content/artifact-templates.js";
import {
  RETIRED_COMMAND_FILES,
  RETIRED_TEMPLATE_FILES,
  syncCclaw
} from "../../src/install.js";
import { createTempProject, removeProject } from "../helpers/temp-project.js";

const SRC_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "../../src");

/** Non-functional inline version attribution (CHANGELOG is the source of truth). */
const NON_FUNCTIONAL_VERSION_ANNOTATION =
  /^\s*\/\/\s*v8\.\d+(?:\.\d+)?\s*[—–-]\s+|^\s*>\s*\*\*v8\.\d|^\s*\*\s*v8\.\d+(?:\.\d+)?\s*[—–-]\s+(?!.*@deprecated)|description:\s*"v8\.\d+(?:\.\d+)?\s*[—–-]\s+/m;

function isFunctionalVersionMention(line: string): boolean {
  const l = line.toLowerCase();
  if (l.includes("@deprecated")) return true;
  if (/pre-v8\.\d/i.test(line)) return true;
  if (/back-?compat/i.test(l)) return true;
  if (/backward-?compat/i.test(l)) return true;
  if (/legacy v8\./i.test(l)) return true;
  if (/retired in v8\.\d/i.test(l)) return true;
  if (/pre-v8\.\d/i.test(line)) return true;
  if (/migration/i.test(l) && /v8\.\d/i.test(line)) return true;
  if (/renamed in v8\.\d/i.test(l)) return true;
  if (/predates v8\./i.test(l)) return true;
  if (/through v8\.\d.*renamed in v8\./i.test(line)) return true;
  return false;
}

async function listSourceFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await listSourceFiles(full)));
    else if (/\.(ts|md)$/.test(entry.name)) out.push(full);
  }
  return out;
}

describe("v8.60 — command retirement", () => {
  it("RETIRED_COMMAND_FILES lists the three removed harness commands", () => {
    expect([...RETIRED_COMMAND_FILES].sort()).toEqual([
      "cc-idea.md",
      "cclaw-critic.md",
      "cclaw-review.md"
    ]);
  });

  it("RETIRED_TEMPLATE_FILES includes ideas.md", () => {
    expect(RETIRED_TEMPLATE_FILES).toContain("ideas.md");
  });

  it("utility-commands.ts and idea-command.ts are gone from src/content/", async () => {
    await expect(fs.access(path.join(SRC_ROOT, "content/utility-commands.ts"))).rejects.toBeTruthy();
    await expect(fs.access(path.join(SRC_ROOT, "content/idea-command.ts"))).rejects.toBeTruthy();
  });

  it("ARTIFACT_TEMPLATES does not include ideas.md", () => {
    expect(ARTIFACT_TEMPLATES.map((t) => t.fileName)).not.toContain("ideas.md");
  });

  it("install writes only cc.md and cc-cancel.md (retired commands swept)", async () => {
    const project = await createTempProject();
    try {
      const staleDir = path.join(project, ".cursor", "commands");
      await fs.mkdir(staleDir, { recursive: true });
      for (const file of RETIRED_COMMAND_FILES) {
        await fs.writeFile(path.join(staleDir, file), "# stale\n", "utf8");
      }

      await syncCclaw({ cwd: project, harnesses: ["cursor"] });

      const dir = path.join(project, ".cursor", "commands");
      const installed = (await fs.readdir(dir)).sort();
      expect(installed).toEqual(["cc-cancel.md", "cc.md"]);
      for (const retired of RETIRED_COMMAND_FILES) {
        await expect(fs.access(path.join(dir, retired))).rejects.toBeTruthy();
      }

      await expect(fs.access(path.join(project, ".cclaw", "lib", "templates", "ideas.md"))).rejects.toBeTruthy();
    } finally {
      await removeProject(project);
    }
  });

  it("SyncResult.counts.commands is 2", async () => {
    const project = await createTempProject();
    try {
      const result = await syncCclaw({ cwd: project, harnesses: ["cursor"] });
      expect(result.counts.commands).toBe(2);
    } finally {
      await removeProject(project);
    }
  });
});

describe("v8.60 — version annotation scrub (src/)", () => {
  it("src/ has no non-functional v8.X — style annotations in source files", async () => {
    const offenders: string[] = [];
    for (const file of await listSourceFiles(SRC_ROOT)) {
      const rel = path.relative(SRC_ROOT, file);
      const lines = (await fs.readFile(file, "utf8")).split("\n");
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]!;
        if (isFunctionalVersionMention(line)) continue;
        if (NON_FUNCTIONAL_VERSION_ANNOTATION.test(line)) {
          offenders.push(`${rel}:${i + 1}: ${line.trim().slice(0, 120)}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe("v8.60 — README command boundary", () => {
  it('README contains "When to use which command" with the four-row surface', async () => {
    const readme = await fs.readFile(path.join(SRC_ROOT, "../README.md"), "utf8");
    expect(readme).toMatch(/## When to use which command/);
    expect(readme).toMatch(/\| Execute a task end-to-end.*\| `\/cc <task>` \|/s);
    expect(readme).toMatch(/\| `\/cc research <topic>` \|/);
    expect(readme).toMatch(/\| `\/cc extend <slug> <task>` \|/);
    expect(readme).toMatch(/\| `\/cc-cancel` \|/);
    expect(readme).not.toMatch(/\/cclaw-review/);
    expect(readme).not.toMatch(/\/cclaw-critic/);
    expect(readme).not.toMatch(/\/cc-idea/);
  });
});
