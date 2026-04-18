import { describe, expect, it } from "vitest";
import {
  splitFrontmatter,
  verifyStructural
} from "../../src/eval/verifiers/structural.js";

describe("splitFrontmatter", () => {
  it("detects YAML frontmatter between --- delimiters", () => {
    const artifact = "---\nstage: brainstorm\nauthor: cclaw\n---\n# Body\nhello\n";
    const split = splitFrontmatter(artifact);
    expect(split.hasFrontmatter).toBe(true);
    expect(split.frontmatterParsed).toEqual({ stage: "brainstorm", author: "cclaw" });
    expect(split.body.startsWith("# Body")).toBe(true);
  });

  it("returns hasFrontmatter=false when no leading --- is present", () => {
    const split = splitFrontmatter("# Just a heading\ntext");
    expect(split.hasFrontmatter).toBe(false);
    expect(split.body).toBe("# Just a heading\ntext");
  });

  it("returns hasFrontmatter=false when the closing --- is missing", () => {
    const split = splitFrontmatter("---\nstage: scope\nmissing close marker");
    expect(split.hasFrontmatter).toBe(false);
  });

  it("handles non-mapping YAML frontmatter by leaving frontmatterParsed undefined", () => {
    const split = splitFrontmatter("---\n- just\n- a\n- list\n---\nBody\n");
    expect(split.hasFrontmatter).toBe(true);
    expect(split.frontmatterParsed).toBeUndefined();
  });
});

describe("verifyStructural - no expectations", () => {
  it("returns [] when expected is undefined", () => {
    expect(verifyStructural("whatever", undefined)).toEqual([]);
  });

  it("returns [] when expected is empty object", () => {
    expect(verifyStructural("whatever", {})).toEqual([]);
  });
});

describe("verifyStructural - required sections", () => {
  const artifact = "# Title\n## Directions\nfoo\n### Recommendation\nbar\n";

  it("passes when every required section appears in a heading", () => {
    const results = verifyStructural(artifact, {
      requiredSections: ["Directions", "Recommendation"]
    });
    expect(results).toHaveLength(2);
    expect(results.every((r) => r.ok)).toBe(true);
    expect(results[0]?.id).toBe("structural:section:directions");
  });

  it("is case-insensitive", () => {
    const results = verifyStructural(artifact, {
      requiredSections: ["directions"]
    });
    expect(results[0]?.ok).toBe(true);
  });

  it("fails for a missing section with a specific message", () => {
    const results = verifyStructural(artifact, {
      requiredSections: ["Rationalizations"]
    });
    expect(results[0]?.ok).toBe(false);
    expect(results[0]?.message).toContain("Rationalizations");
    expect(results[0]?.score).toBe(0);
  });

  it("does not match section names that appear only in body text", () => {
    const bodyOnly = "# Title\nDirections are mentioned in prose only.\n";
    const results = verifyStructural(bodyOnly, { requiredSections: ["Directions"] });
    expect(results[0]?.ok).toBe(false);
  });
});

describe("verifyStructural - forbidden patterns", () => {
  it("passes when none of the forbidden patterns occur", () => {
    const results = verifyStructural("# Title\nclean body\n", {
      forbiddenPatterns: ["TBD", "TODO"]
    });
    expect(results.every((r) => r.ok)).toBe(true);
  });

  it("fails and counts occurrences", () => {
    const body = "# Title\nSection A TODO\n## Next TODO\n";
    const results = verifyStructural(body, { forbiddenPatterns: ["TODO"] });
    expect(results[0]?.ok).toBe(false);
    expect(results[0]?.details?.occurrences).toBe(2);
  });

  it("matches case-insensitively", () => {
    const results = verifyStructural("# Title\nthis is Todo-left\n", {
      forbiddenPatterns: ["todo"]
    });
    expect(results[0]?.ok).toBe(false);
  });
});

describe("verifyStructural - length bounds", () => {
  it("passes when line count is within [min, max]", () => {
    const body = "line1\nline2\nline3\n";
    const results = verifyStructural(body, { minLines: 2, maxLines: 5 });
    expect(results.find((r) => r.id === "structural:length:lines")?.ok).toBe(true);
  });

  it("fails under min lines", () => {
    const results = verifyStructural("only-one\n", { minLines: 5 });
    expect(results[0]?.ok).toBe(false);
    expect(results[0]?.message).toContain("5");
  });

  it("fails over max chars", () => {
    const body = "a".repeat(500);
    const results = verifyStructural(body, { maxChars: 100 });
    expect(results[0]?.ok).toBe(false);
    expect(results[0]?.details?.charCount).toBe(500);
  });

  it("excludes frontmatter from length counts", () => {
    const artifact = "---\nstage: scope\n---\nhello\n";
    const results = verifyStructural(artifact, { minChars: 1, maxChars: 20 });
    expect(results[0]?.ok).toBe(true);
  });
});

describe("verifyStructural - required frontmatter keys", () => {
  it("passes when every key is present", () => {
    const artifact = "---\nstage: brainstorm\nauthor: cclaw\n---\n# Body\n";
    const results = verifyStructural(artifact, {
      requiredFrontmatterKeys: ["stage", "author"]
    });
    expect(results.every((r) => r.ok)).toBe(true);
  });

  it("fails when frontmatter is missing entirely", () => {
    const artifact = "# Body without frontmatter\n";
    const results = verifyStructural(artifact, {
      requiredFrontmatterKeys: ["stage"]
    });
    expect(results[0]?.ok).toBe(false);
    expect(results[0]?.details?.frontmatterPresent).toBe(false);
  });

  it("fails when a specific key is missing", () => {
    const artifact = "---\nstage: scope\n---\nbody\n";
    const results = verifyStructural(artifact, {
      requiredFrontmatterKeys: ["stage", "author"]
    });
    expect(results).toHaveLength(2);
    expect(results.find((r) => r.id.endsWith(":author"))?.ok).toBe(false);
    expect(results.find((r) => r.id.endsWith(":stage"))?.ok).toBe(true);
  });
});

describe("verifyStructural - verifier identity", () => {
  it("every result has kind='structural' and slugified id", () => {
    const artifact = "# Title\n## Well-Known Directions\ndone\n";
    const results = verifyStructural(artifact, {
      requiredSections: ["Well-Known Directions"],
      forbiddenPatterns: ["TBD"]
    });
    expect(results.every((r) => r.kind === "structural")).toBe(true);
    expect(results.find((r) => r.id === "structural:section:well-known-directions")).toBeDefined();
    expect(results.find((r) => r.id === "structural:forbidden:tbd")).toBeDefined();
  });
});
