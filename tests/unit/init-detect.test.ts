import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { detectHarnesses } from "../../src/init-detect.js";
import { createTempProject } from "../helpers/index.js";

describe("init harness detection", () => {
  it("returns empty list when no harness hints are present", async () => {
    const root = await createTempProject("detect-none");
    const detected = await detectHarnesses(root);
    expect(detected).toEqual([]);
  });

  it("detects harnesses from existing project hints", async () => {
    const root = await createTempProject("detect-hints");
    await fs.mkdir(path.join(root, ".cursor/rules"), { recursive: true });
    await fs.writeFile(path.join(root, "CLAUDE.md"), "# claude\n", "utf8");
    await fs.writeFile(path.join(root, "opencode.json"), "{\n  \"plugin\": []\n}\n", "utf8");

    const detected = await detectHarnesses(root);
    expect(detected).toEqual(["claude", "cursor", "opencode"]);
  });
});

