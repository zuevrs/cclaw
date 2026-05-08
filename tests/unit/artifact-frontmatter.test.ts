import path from "node:path";
import fs from "node:fs/promises";
import { afterEach, describe, expect, it } from "vitest";
import {
  FrontmatterError,
  extractAcceptanceCriteriaFromBody,
  isFrontmatterShipped,
  mergeAcceptanceCriteria,
  parseArtifact,
  readArtifact,
  renderArtifact,
  syncFrontmatter,
  writeArtifact
} from "../../src/artifact-frontmatter.js";
import { activeArtifactPath } from "../../src/artifact-paths.js";
import { ensureRuntimeRoot } from "../../src/install.js";
import { createTempProject, removeProject } from "../helpers/temp-project.js";

describe("artifact-frontmatter", () => {
  it("parses YAML frontmatter and exposes the body", () => {
    const raw = "---\nslug: alpha\nstage: plan\nstatus: active\n---\n\n# alpha\n\nhello\n";
    const parsed = parseArtifact(raw);
    expect(parsed.frontmatter.slug).toBe("alpha");
    expect(parsed.frontmatter.stage).toBe("plan");
    expect(parsed.body.startsWith("\n# alpha")).toBe(true);
  });

  it("rejects artifacts without frontmatter", () => {
    expect(() => parseArtifact("# no frontmatter")).toThrow(FrontmatterError);
  });

  it("rejects frontmatter without a slug", () => {
    const raw = "---\nstage: plan\nstatus: active\n---\nbody";
    expect(() => parseArtifact(raw)).toThrow(/non-empty `slug`/u);
  });

  it("rejects frontmatter where ac is not an array", () => {
    const raw = "---\nslug: a\nstage: plan\nstatus: active\nac: nope\n---\nbody";
    expect(() => parseArtifact(raw)).toThrow(/`ac` must be an array/u);
  });

  it("renders frontmatter back to a deterministic string with trailing newline", () => {
    const raw = "---\nslug: alpha\nstage: plan\nstatus: active\n---\n\nbody";
    const rendered = renderArtifact(parseArtifact(raw));
    expect(rendered.startsWith("---\n")).toBe(true);
    expect(rendered.endsWith("\n")).toBe(true);
    expect(rendered).toContain("slug: alpha");
  });

  it("extracts AC from body lines including pending and committed markers", () => {
    const body = `## Acceptance Criteria\n\n- AC-1: render the pill (commit pending)\n- AC-2: handle empty list (commit: a1b2c3d4)\n- not an ac line\n- AC-3 — tooltip uses approver email (sha=deadbeefcafe1234)`;
    const acs = extractAcceptanceCriteriaFromBody(body);
    expect(acs).toHaveLength(3);
    expect(acs[0]).toMatchObject({ id: "AC-1", status: "pending" });
    expect(acs[1].commit).toBe("a1b2c3d4");
    expect(acs[2].commit).toBe("deadbeefcafe1234");
  });

  it("merges body-derived AC with frontmatter AC, preserving committed status when present", () => {
    const fromBody = [
      { id: "AC-1", text: "render the pill", status: "pending" as const },
      { id: "AC-2", text: "handle empty list", status: "committed" as const, commit: "abc1234" }
    ];
    const fromFm = [
      { id: "AC-1", text: "render the pill", status: "committed" as const, commit: "9999999" },
      { id: "AC-3", text: "tooltip from frontmatter only", status: "pending" as const }
    ];
    const merged = mergeAcceptanceCriteria(fromBody, fromFm);
    expect(merged.find((x) => x.id === "AC-1")?.commit).toBe("9999999");
    expect(merged.find((x) => x.id === "AC-2")?.commit).toBe("abc1234");
    expect(merged.find((x) => x.id === "AC-3")?.status).toBe("pending");
  });

  it("isFrontmatterShipped returns true for shipped status", () => {
    expect(isFrontmatterShipped({ slug: "x", stage: "shipped", status: "shipped" })).toBe(true);
    expect(isFrontmatterShipped({ slug: "x", stage: "plan", status: "active" })).toBe(false);
  });

  describe("syncFrontmatter", () => {
    let project: string;
    afterEach(async () => {
      if (project) await removeProject(project);
    });

    it("rewrites only the fields supplied in the patch and preserves the body", async () => {
      project = await createTempProject();
      await ensureRuntimeRoot(project);
      const planPath = activeArtifactPath(project, "plan", "alpha");
      const original = "---\nslug: alpha\nstage: plan\nstatus: active\nlast_specialist: null\n---\n\n# alpha\n\nbody preserved\n";
      await fs.mkdir(path.dirname(planPath), { recursive: true });
      await fs.writeFile(planPath, original, "utf8");

      const updated = await syncFrontmatter(project, "alpha", "plan", { last_specialist: "architect" });
      expect(updated.frontmatter.last_specialist).toBe("architect");
      expect(updated.frontmatter.slug).toBe("alpha");

      const onDisk = await readArtifact(planPath);
      expect(onDisk.frontmatter.last_specialist).toBe("architect");
      expect(onDisk.body).toContain("body preserved");
    });

    it("supports writeArtifact round-trip", async () => {
      project = await createTempProject();
      await ensureRuntimeRoot(project);
      const planPath = activeArtifactPath(project, "plan", "round-trip");
      await fs.mkdir(path.dirname(planPath), { recursive: true });
      await writeArtifact(planPath, {
        frontmatter: { slug: "round-trip", stage: "plan", status: "active" },
        body: "# round-trip\n\nhello\n",
        raw: ""
      });
      const reloaded = await readArtifact(planPath);
      expect(reloaded.frontmatter.slug).toBe("round-trip");
      expect(reloaded.body).toContain("hello");
    });
  });
});
