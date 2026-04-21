import { describe, expect, it } from "vitest";
import { loadWorkflowCorpus } from "../../src/eval/workflow-corpus.js";
import { createTempProject, writeProjectFile } from "../helpers/index.js";

describe("eval workflow corpus loader", () => {
  it("returns empty array when workflow corpus directory is missing", async () => {
    const root = await createTempProject("workflow-corpus-empty");
    await expect(loadWorkflowCorpus(root)).resolves.toEqual([]);
  });

  it("loads and sorts valid workflow cases by id", async () => {
    const root = await createTempProject("workflow-corpus-valid");
    await writeProjectFile(
      root,
      ".cclaw/evals/corpus/workflows/b.yaml",
      [
        "id: wf-b",
        "stages:",
        "  - name: brainstorm",
        "    input_prompt: Stage B"
      ].join("\n")
    );
    await writeProjectFile(
      root,
      ".cclaw/evals/corpus/workflows/a.yml",
      [
        "id: wf-a",
        "description: demo",
        "context_files: [README.md]",
        "stages:",
        "  - name: brainstorm",
        "    input_prompt: Stage A"
      ].join("\n")
    );

    const cases = await loadWorkflowCorpus(root);
    expect(cases.map((entry) => entry.id)).toEqual(["wf-a", "wf-b"]);
    expect(cases[0]?.contextFiles).toEqual(["README.md"]);
  });

  it("throws on invalid YAML parse errors", async () => {
    const root = await createTempProject("workflow-corpus-bad-yaml");
    await writeProjectFile(
      root,
      ".cclaw/evals/corpus/workflows/bad.yaml",
      "id: wf-bad\nstages: [\n"
    );
    await expect(loadWorkflowCorpus(root)).rejects.toThrow(/Invalid workflow case/);
  });

  it("throws when stage name is unsupported", async () => {
    const root = await createTempProject("workflow-corpus-bad-stage");
    await writeProjectFile(
      root,
      ".cclaw/evals/corpus/workflows/bad-stage.yaml",
      [
        "id: wf-bad-stage",
        "stages:",
        "  - name: invented",
        "    input_prompt: nope"
      ].join("\n")
    );
    await expect(loadWorkflowCorpus(root)).rejects.toThrow(/must be one of/);
  });

  it("throws for malformed consistency blocks", async () => {
    const root = await createTempProject("workflow-corpus-bad-consistency");
    await writeProjectFile(
      root,
      ".cclaw/evals/corpus/workflows/bad-consistency.yaml",
      [
        "id: wf-bad-consistency",
        "stages:",
        "  - name: brainstorm",
        "    input_prompt: good",
        "consistency:",
        "  ids_flow:",
        "    - from: brainstorm",
        "      to: [brainstorm]"
      ].join("\n")
    );
    await expect(loadWorkflowCorpus(root)).rejects.toThrow(/id_pattern/);
  });
});
