import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { initCclaw } from "../../src/install.js";
import { createTempProject } from "../helpers/index.js";

/**
 * Wave 22 (Phase C2): cclaw materializes a zero-install Cursor baseline
 * rule at `.cursor/rules/cclaw-guidelines.mdc` whenever the Cursor harness
 * is enabled. The rule pins three behaviours that survive even if no stage
 * skill is loaded:
 *
 *   1. Q&A floor before drafting (brainstorm/scope/design).
 *   2. Mandatory subagents run after Q&A approval.
 *   3. Never echo cclaw command lines to chat.
 */

const GUIDELINES_REL = ".cursor/rules/cclaw-guidelines.mdc";
const WORKFLOW_REL = ".cursor/rules/cclaw-workflow.mdc";

async function exists(p: string): Promise<boolean> {
  try {
    await fs.stat(p);
    return true;
  } catch {
    return false;
  }
}

describe("cclaw-guidelines.mdc baseline rule", () => {
  it("is materialized when cursor harness is enabled (default)", async () => {
    const root = await createTempProject("cursor-baseline-default");
    await initCclaw({ projectRoot: root });

    const guidelinesPath = path.join(root, GUIDELINES_REL);
    expect(await exists(guidelinesPath)).toBe(true);
    const content = await fs.readFile(guidelinesPath, "utf8");

    expect(content).toMatch(/^---/u);
    expect(content).toContain("alwaysApply: true");
    expect(content).toContain("# Cclaw Baseline Guidelines");

    expect(content).toContain("## 1. Q&A floor before drafting");
    expect(content).toContain("brainstorm / scope / design");
    // Wave 23 (v5.0.0): linter rule renamed `qa_log_below_min` ->
    // `qa_log_unconverged` (count floor replaced with Ralph-Loop convergence).
    expect(content).toContain("qa_log_unconverged");

    expect(content).toContain("## 2. Mandatory subagents run after Q&A approval");
    expect(content).toContain("post-elicitation");

    expect(content).toContain("## 3. Never echo cclaw command lines");
    expect(content).toMatch(/--evidence-json/u);
    expect(content).toMatch(/shasum|sha256sum|Get-FileHash|certutil/u);
  });

  it("removes the baseline rule when cursor harness is disabled", async () => {
    const root = await createTempProject("cursor-baseline-disabled");
    await initCclaw({ projectRoot: root, harnesses: ["claude"] });

    expect(await exists(path.join(root, GUIDELINES_REL))).toBe(false);
    expect(await exists(path.join(root, WORKFLOW_REL))).toBe(false);
  });

  it("re-materializes baseline rule on a second init when cursor is re-enabled", async () => {
    const root = await createTempProject("cursor-baseline-toggle");
    await initCclaw({ projectRoot: root, harnesses: ["claude"] });
    expect(await exists(path.join(root, GUIDELINES_REL))).toBe(false);

    await initCclaw({ projectRoot: root, harnesses: ["cursor", "claude"] });
    expect(await exists(path.join(root, GUIDELINES_REL))).toBe(true);
    const content = await fs.readFile(path.join(root, GUIDELINES_REL), "utf8");
    expect(content).toContain("# Cclaw Baseline Guidelines");
  });
});
