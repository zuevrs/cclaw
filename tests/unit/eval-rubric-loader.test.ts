import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadAllRubrics, loadRubric } from "../../src/eval/rubric-loader.js";
import { createTempProject } from "../helpers/index.js";

async function writeRubric(root: string, stage: string, body: string): Promise<string> {
  const file = path.join(root, ".cclaw/evals/rubrics", `${stage}.yaml`);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, body, "utf8");
  return file;
}

describe("rubric-loader", () => {
  it("returns undefined when the rubric file is missing", async () => {
    const root = await createTempProject("rubric-missing");
    const doc = await loadRubric(root, "brainstorm");
    expect(doc).toBeUndefined();
  });

  it("parses a minimal rubric and defaults id to stage", async () => {
    const root = await createTempProject("rubric-min");
    await writeRubric(
      root,
      "brainstorm",
      `stage: brainstorm\nchecks:\n  - id: distinctness\n    prompt: "Are directions distinct?"\n`
    );
    const doc = await loadRubric(root, "brainstorm");
    expect(doc?.stage).toBe("brainstorm");
    expect(doc?.id).toBe("brainstorm");
    expect(doc?.checks).toHaveLength(1);
    expect(doc?.checks[0]?.id).toBe("distinctness");
  });

  it("supports weight, scale, and critical on checks", async () => {
    const root = await createTempProject("rubric-full");
    await writeRubric(
      root,
      "plan",
      `stage: plan\nid: strict\nchecks:\n  - id: task-granularity\n    prompt: "?"\n    scale: "1-5"\n    weight: 1.5\n    critical: true\n`
    );
    const doc = await loadRubric(root, "plan");
    expect(doc?.id).toBe("strict");
    expect(doc?.checks[0]).toEqual({
      id: "task-granularity",
      prompt: "?",
      scale: "1-5",
      weight: 1.5,
      critical: true
    });
  });

  it("rejects unknown top-level keys", async () => {
    const root = await createTempProject("rubric-unknown");
    await writeRubric(
      root,
      "scope",
      `stage: scope\nchecks:\n  - id: x\n    prompt: y\nmystery: true\n`
    );
    await expect(loadRubric(root, "scope")).rejects.toThrow(/unknown top-level key\(s\): mystery/);
  });

  it("rejects unknown keys inside a check", async () => {
    const root = await createTempProject("rubric-check-unknown");
    await writeRubric(
      root,
      "design",
      `stage: design\nchecks:\n  - id: x\n    prompt: y\n    weigth: 1\n`
    );
    await expect(loadRubric(root, "design")).rejects.toThrow(/unknown key\(s\): weigth/);
  });

  it("rejects non-kebab-case check ids", async () => {
    const root = await createTempProject("rubric-bad-id");
    await writeRubric(
      root,
      "ship",
      `stage: ship\nchecks:\n  - id: BadCaseId\n    prompt: y\n`
    );
    await expect(loadRubric(root, "ship")).rejects.toThrow(/kebab-case/);
  });

  it("rejects empty checks arrays", async () => {
    const root = await createTempProject("rubric-empty");
    await writeRubric(root, "review", `stage: review\nchecks: []\n`);
    await expect(loadRubric(root, "review")).rejects.toThrow(/non-empty array/);
  });

  it("rejects duplicate check ids", async () => {
    const root = await createTempProject("rubric-dup");
    await writeRubric(
      root,
      "tdd",
      `stage: tdd\nchecks:\n  - id: x\n    prompt: a\n  - id: x\n    prompt: b\n`
    );
    await expect(loadRubric(root, "tdd")).rejects.toThrow(/duplicate check id: "x"/);
  });

  it("rejects a non-numeric or negative weight", async () => {
    const root = await createTempProject("rubric-weight");
    await writeRubric(
      root,
      "spec",
      `stage: spec\nchecks:\n  - id: x\n    prompt: y\n    weight: -0.5\n`
    );
    await expect(loadRubric(root, "spec")).rejects.toThrow(/non-negative number/);
  });

  it("loadAllRubrics returns every stage that has a rubric", async () => {
    const root = await createTempProject("rubric-all");
    await writeRubric(
      root,
      "brainstorm",
      `stage: brainstorm\nchecks:\n  - id: x\n    prompt: y\n`
    );
    await writeRubric(root, "scope", `stage: scope\nchecks:\n  - id: x\n    prompt: y\n`);
    const all = await loadAllRubrics(root);
    expect([...all.keys()].sort()).toEqual(["brainstorm", "scope"]);
  });
});
