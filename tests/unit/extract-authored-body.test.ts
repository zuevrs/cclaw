import { describe, expect, it } from "vitest";
import { extractAuthoredBody } from "../../src/artifact-linter/shared.js";

describe("extractAuthoredBody", () => {
  it("returns the original text when no meta regions are present", () => {
    const raw = "# Heading\n\nsome content\n\n- bullet\n";
    expect(extractAuthoredBody(raw)).toBe(raw);
  });

  it("strips paired <!-- linter-meta --> ... <!-- /linter-meta --> blocks", () => {
    const raw = [
      "# Artifact",
      "",
      "authored prose stays",
      "",
      "<!-- linter-meta -->",
      "TODO: should be invisible to free-text scans",
      "<!-- /linter-meta -->",
      "",
      "more authored prose"
    ].join("\n");
    const cleaned = extractAuthoredBody(raw);
    expect(cleaned.toLowerCase()).not.toContain("todo");
    expect(cleaned).toContain("authored prose stays");
    expect(cleaned).toContain("more authored prose");
  });

  it("leaves unterminated linter-meta openings alone so malformed authoring does not hide content", () => {
    const raw = [
      "# Artifact",
      "<!-- linter-meta -->",
      "TODO: missing closing marker",
      "",
      "still authored"
    ].join("\n");
    const cleaned = extractAuthoredBody(raw);
    expect(cleaned.toLowerCase()).toContain("todo");
  });

  it("strips regular HTML comments too", () => {
    const raw = "keep me\n\n<!-- hidden TBD -->\n\nvisible authored text";
    const cleaned = extractAuthoredBody(raw);
    expect(cleaned).toContain("keep me");
    expect(cleaned).toContain("visible authored text");
    expect(cleaned.toLowerCase()).not.toContain("tbd");
  });

  it("strips fenced code blocks tagged `linter-rule` but preserves other fenced code", () => {
    const raw = [
      "# Artifact",
      "",
      "```ts",
      "const TODO = \"ok\";",
      "```",
      "",
      "```linter-rule",
      "TODO: invisible sample",
      "```",
      "",
      "more content"
    ].join("\n");
    const cleaned = extractAuthoredBody(raw);
    expect(cleaned).toContain("const TODO");
    const lowered = cleaned.toLowerCase();
    expect(lowered).not.toContain("invisible sample");
  });

  it("returns empty string for non-string or empty input", () => {
    expect(extractAuthoredBody("")).toBe("");
    expect(extractAuthoredBody(null as unknown as string)).toBe("");
    expect(extractAuthoredBody(undefined as unknown as string)).toBe("");
  });

  it("preserves line breaks so surviving offsets match for regex-based scanners", () => {
    const raw = "line1\n<!-- linter-meta -->\nTODO\n<!-- /linter-meta -->\nline5";
    const cleaned = extractAuthoredBody(raw);
    const lines = cleaned.split(/\r?\n/u);
    expect(lines).toHaveLength(5);
    expect(lines[0]).toBe("line1");
    expect(lines[4]).toBe("line5");
  });
});
