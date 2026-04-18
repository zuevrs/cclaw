import { describe, expect, it } from "vitest";
import { loadCorpus } from "../../src/eval/corpus.js";
import { createTempProject, writeProjectFile } from "../helpers/index.js";

describe("eval corpus loader", () => {
  it("returns empty array when corpus directory is missing", async () => {
    const root = await createTempProject("corpus-empty");
    const cases = await loadCorpus(root);
    expect(cases).toEqual([]);
  });

  it("loads a valid case with snake_case keys", async () => {
    const root = await createTempProject("corpus-valid");
    await writeProjectFile(
      root,
      ".cclaw/evals/corpus/brainstorm/01.yaml",
      `id: brainstorm-01\nstage: brainstorm\ninput_prompt: |\n  Add email notifications.\n`
    );
    const cases = await loadCorpus(root);
    expect(cases).toHaveLength(1);
    expect(cases[0]).toMatchObject({
      id: "brainstorm-01",
      stage: "brainstorm",
      inputPrompt: "Add email notifications."
    });
  });

  it("also accepts camelCase inputPrompt/contextFiles aliases", async () => {
    const root = await createTempProject("corpus-camel");
    await writeProjectFile(
      root,
      ".cclaw/evals/corpus/scope/01.yaml",
      `id: scope-01\nstage: scope\ninputPrompt: Test prompt\ncontextFiles:\n  - src/foo.ts\n`
    );
    const cases = await loadCorpus(root);
    expect(cases).toHaveLength(1);
    expect(cases[0]?.contextFiles).toEqual(["src/foo.ts"]);
  });

  it("filters to one stage", async () => {
    const root = await createTempProject("corpus-filter");
    await writeProjectFile(
      root,
      ".cclaw/evals/corpus/brainstorm/01.yaml",
      `id: b-01\nstage: brainstorm\ninput_prompt: x\n`
    );
    await writeProjectFile(
      root,
      ".cclaw/evals/corpus/scope/01.yaml",
      `id: s-01\nstage: scope\ninput_prompt: y\n`
    );
    const cases = await loadCorpus(root, "scope");
    expect(cases).toHaveLength(1);
    expect(cases[0]?.stage).toBe("scope");
  });

  it("throws on unknown stage", async () => {
    const root = await createTempProject("corpus-bad-stage");
    await writeProjectFile(
      root,
      ".cclaw/evals/corpus/scope/01.yaml",
      `id: x\nstage: invented\ninput_prompt: y\n`
    );
    await expect(loadCorpus(root)).rejects.toThrow(/stage/);
  });

  it("throws on missing id", async () => {
    const root = await createTempProject("corpus-no-id");
    await writeProjectFile(
      root,
      ".cclaw/evals/corpus/scope/01.yaml",
      `stage: scope\ninput_prompt: y\n`
    );
    await expect(loadCorpus(root)).rejects.toThrow(/"id"/);
  });

  it("throws on missing input_prompt", async () => {
    const root = await createTempProject("corpus-no-prompt");
    await writeProjectFile(
      root,
      ".cclaw/evals/corpus/scope/01.yaml",
      `id: x\nstage: scope\n`
    );
    await expect(loadCorpus(root)).rejects.toThrow(/"input_prompt"/);
  });

  it("parses expected.rules with snake_case keys", async () => {
    const root = await createTempProject("corpus-rules");
    await writeProjectFile(
      root,
      ".cclaw/evals/corpus/plan/01.yaml",
      [
        "id: plan-01",
        "stage: plan",
        "input_prompt: p",
        "expected:",
        "  rules:",
        "    must_contain:",
        "      - Milestones",
        "    regex_required:",
        "      - pattern: 'M\\d+'",
        "        description: Milestone ids",
        "    min_occurrences:",
        "      D-0: 1",
        "    unique_bullets_in_section:",
        "      - Steps",
        ""
      ].join("\n")
    );
    const cases = await loadCorpus(root);
    expect(cases).toHaveLength(1);
    expect(cases[0]?.expected?.rules).toMatchObject({
      mustContain: ["Milestones"],
      regexRequired: [{ pattern: "M\\d+", description: "Milestone ids" }],
      minOccurrences: { "D-0": 1 },
      uniqueBulletsInSection: ["Steps"]
    });
    expect(cases[0]?.expected?.rules?.regexRequired?.[0]?.pattern).toBe("M\\d+");
  });

  it("parses expected.traceability and extra_fixtures", async () => {
    const root = await createTempProject("corpus-trace");
    await writeProjectFile(
      root,
      ".cclaw/evals/corpus/plan/01.yaml",
      [
        "id: plan-trace-01",
        "stage: plan",
        "input_prompt: p",
        "fixture: ./plan-01/fixture.md",
        "extra_fixtures:",
        "  scope: ../scope/scope-01/fixture.md",
        "  tdd: ../tdd/tdd-01/fixture.md",
        "expected:",
        "  traceability:",
        "    id_pattern: 'D-\\d+'",
        "    source: scope",
        "    require_in:",
        "      - self",
        "      - tdd",
        ""
      ].join("\n")
    );
    const cases = await loadCorpus(root);
    expect(cases[0]?.extraFixtures).toEqual({
      scope: "../scope/scope-01/fixture.md",
      tdd: "../tdd/tdd-01/fixture.md"
    });
    expect(cases[0]?.expected?.traceability).toEqual({
      idPattern: "D-\\d+",
      source: "scope",
      requireIn: ["self", "tdd"]
    });
  });

  it("throws when expected.rules.regex_required entry lacks a pattern", async () => {
    const root = await createTempProject("corpus-rules-bad");
    await writeProjectFile(
      root,
      ".cclaw/evals/corpus/plan/01.yaml",
      [
        "id: bad",
        "stage: plan",
        "input_prompt: p",
        "expected:",
        "  rules:",
        "    regex_required:",
        "      - description: missing pattern"
      ].join("\n")
    );
    await expect(loadCorpus(root)).rejects.toThrow(/pattern/);
  });

  it("throws when extra_fixtures value is empty", async () => {
    const root = await createTempProject("corpus-extra-bad");
    await writeProjectFile(
      root,
      ".cclaw/evals/corpus/plan/01.yaml",
      [
        "id: bad",
        "stage: plan",
        "input_prompt: p",
        "extra_fixtures:",
        "  scope: ''"
      ].join("\n")
    );
    await expect(loadCorpus(root)).rejects.toThrow(/extra_fixtures/);
  });

  it("throws when traceability require_in is empty", async () => {
    const root = await createTempProject("corpus-trace-bad");
    await writeProjectFile(
      root,
      ".cclaw/evals/corpus/plan/01.yaml",
      [
        "id: bad",
        "stage: plan",
        "input_prompt: p",
        "expected:",
        "  traceability:",
        "    id_pattern: 'D-\\d+'",
        "    source: self",
        "    require_in: []"
      ].join("\n")
    );
    await expect(loadCorpus(root)).rejects.toThrow(/require_in/);
  });

  it("ignores non-yaml files and directories that do not match a stage name", async () => {
    const root = await createTempProject("corpus-mixed");
    await writeProjectFile(root, ".cclaw/evals/corpus/README.md", "# notes\n");
    await writeProjectFile(
      root,
      ".cclaw/evals/corpus/misc/01.yaml",
      `id: x\nstage: scope\ninput_prompt: y\n`
    );
    await writeProjectFile(
      root,
      ".cclaw/evals/corpus/brainstorm/01.yaml",
      `id: b\nstage: brainstorm\ninput_prompt: y\n`
    );
    const cases = await loadCorpus(root);
    expect(cases.map((c) => c.id)).toEqual(["b"]);
  });
});
