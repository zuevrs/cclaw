import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { initCclaw } from "../../src/install.js";
import { policyChecks } from "../../src/policy.js";
import { createTempProject } from "../helpers/index.js";

describe("policy checks", () => {
  it("passes cross-cutting policy rules on generated contracts", async () => {
    const root = await createTempProject("policy");
    await initCclaw({ projectRoot: root });

    const checks = await policyChecks(root);
    expect(checks.every((check) => check.ok)).toBe(true);
  });
});
