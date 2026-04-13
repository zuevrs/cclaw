import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { initCclaw } from "../../src/install.js";
import { policyChecks } from "../../src/policy.js";

describe("policy checks", () => {
  it("passes cross-cutting policy rules on generated contracts", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "cclaw-policy-"));
    await initCclaw({ projectRoot: root });

    const checks = await policyChecks(root);
    expect(checks.every((check) => check.ok)).toBe(true);
  });
});
