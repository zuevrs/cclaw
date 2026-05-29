import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { renderStartCommand } from "../../src/content/start-command.js";
import { ON_DEMAND_RUNBOOKS } from "../../src/content/runbooks-on-demand.js";
import { TRIAGE_PROMPT } from "../../src/content/specialist-prompts/triage.js";
import { AUTO_TRIGGER_SKILLS } from "../../src/content/skills.js";
import { CRITIC_PROMPT } from "../../src/content/specialist-prompts/critic.js";

/**
 * v8.112 — Flag / command-shape cleanup tripwire.
 *
 * Asserts that the 10 retired flags and 5 retired namespace shapes do NOT
 * appear in the canonical surfaces (orchestrator body, on-demand runbook
 * bodies, triage prompt, README, cli.ts --help text). Also asserts that the
 * structural source-of-truth contract (the triage heuristic-only ceremony
 * decision) is intact.
 *
 * Retired flags (10):
 *   --inline, --soft, --strict, --research, --light, --standard,
 *   --deep-product, --capture-learnings, --mode=auto, --mode=step
 *
 * Retired namespace shapes (5):
 *   /cc-plan, /cc-build, /cc-review, /cc-ship, /cc-compound-refresh,
 *   plus the --enter= dispatch helper.
 */

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const SRC_ROOT = path.resolve(REPO_ROOT, "src");
const CONTENT_ROOT = path.resolve(SRC_ROOT, "content");
const START_COMMAND_PATH = path.resolve(CONTENT_ROOT, "start-command.ts");
const RUNBOOKS_ON_DEMAND_PATH = path.resolve(CONTENT_ROOT, "runbooks-on-demand.ts");
const CLI_PATH = path.resolve(SRC_ROOT, "cli.ts");
const README_PATH = path.resolve(REPO_ROOT, "README.md");

const RETIRED_FLAGS = [
  "--inline",
  "--soft",
  "--strict",
  "--research",
  "--light",
  "--standard",
  "--deep-product",
  "--capture-learnings",
  "--mode=auto",
  "--mode=step"
] as const;

const RETIRED_SHAPES = [
  "/cc-plan",
  "/cc-build",
  "/cc-review",
  "/cc-ship",
  "/cc-compound-refresh"
] as const;

const RETIRED_ENTER_HELPER = "--enter=";

async function readFile(p: string): Promise<string> {
  return await fs.readFile(p, "utf8");
}

describe("v8.112 — 10 retired flags are absent from canonical surfaces", () => {
  it("start-command.ts source carries none of the 10 retired flag literals", async () => {
    const body = await readFile(START_COMMAND_PATH);
    for (const flag of RETIRED_FLAGS) {
      expect(body, `start-command.ts must not mention retired flag ${flag}`).not.toContain(flag);
    }
  });

  it("rendered orchestrator body carries none of the 10 retired flag literals", () => {
    const body = renderStartCommand();
    for (const flag of RETIRED_FLAGS) {
      expect(body, `renderStartCommand() must not mention retired flag ${flag}`).not.toContain(flag);
    }
  });

  it("runbooks-on-demand.ts source carries none of the 10 retired flag literals", async () => {
    const body = await readFile(RUNBOOKS_ON_DEMAND_PATH);
    for (const flag of RETIRED_FLAGS) {
      expect(body, `runbooks-on-demand.ts must not mention retired flag ${flag}`).not.toContain(flag);
    }
  });

  it("every on-demand runbook body is clean of the 10 retired flag literals", () => {
    for (const runbook of ON_DEMAND_RUNBOOKS) {
      for (const flag of RETIRED_FLAGS) {
        expect(
          runbook.body,
          `runbook '${runbook.id}' must not mention retired flag ${flag}`
        ).not.toContain(flag);
      }
    }
  });

  it("triage specialist prompt carries no retired ceremony / run-mode flag literals", () => {
    for (const flag of RETIRED_FLAGS) {
      expect(
        TRIAGE_PROMPT,
        `TRIAGE_PROMPT must not mention retired flag ${flag}`
      ).not.toContain(flag);
    }
  });
});

describe("v8.112 — 5 retired namespace shapes are absent from start-command + runbooks", () => {
  it("start-command.ts source carries none of the 5 retired namespace shapes", async () => {
    const body = await readFile(START_COMMAND_PATH);
    for (const shape of RETIRED_SHAPES) {
      expect(body, `start-command.ts must not mention retired shape ${shape}`).not.toContain(shape);
    }
    expect(body, `start-command.ts must not mention the --enter= dispatch helper`).not.toContain(
      RETIRED_ENTER_HELPER
    );
  });

  it("rendered orchestrator body carries none of the 5 retired namespace shapes", () => {
    const body = renderStartCommand();
    for (const shape of RETIRED_SHAPES) {
      expect(body, `renderStartCommand() must not mention retired shape ${shape}`).not.toContain(
        shape
      );
    }
    expect(body, `rendered body must not mention the --enter= dispatch helper`).not.toContain(
      RETIRED_ENTER_HELPER
    );
  });

  it("runbooks-on-demand.ts source carries none of the 5 retired namespace shapes", async () => {
    const body = await readFile(RUNBOOKS_ON_DEMAND_PATH);
    for (const shape of RETIRED_SHAPES) {
      expect(body, `runbooks-on-demand.ts must not mention retired shape ${shape}`).not.toContain(
        shape
      );
    }
    expect(body, `runbooks-on-demand.ts must not mention the --enter= dispatch helper`).not.toContain(
      RETIRED_ENTER_HELPER
    );
  });
});

describe("v8.112 — README + cli.ts --help text are clean of removed items", () => {
  it("README.md mentions none of the 10 retired flag literals or 5 retired namespace shapes", async () => {
    const body = await readFile(README_PATH);
    for (const flag of RETIRED_FLAGS) {
      expect(body, `README.md must not mention retired flag ${flag}`).not.toContain(flag);
    }
    for (const shape of RETIRED_SHAPES) {
      expect(body, `README.md must not mention retired shape ${shape}`).not.toContain(shape);
    }
    expect(body, `README.md must not mention the --enter= dispatch helper`).not.toContain(
      RETIRED_ENTER_HELPER
    );
  });

  it("cli.ts --help text mentions none of the 10 retired flag literals or 5 retired namespace shapes", async () => {
    const body = await readFile(CLI_PATH);
    for (const flag of RETIRED_FLAGS) {
      expect(body, `cli.ts must not mention retired flag ${flag}`).not.toContain(flag);
    }
    for (const shape of RETIRED_SHAPES) {
      expect(body, `cli.ts must not mention retired shape ${shape}`).not.toContain(shape);
    }
    expect(body, `cli.ts must not mention the --enter= dispatch helper`).not.toContain(
      RETIRED_ENTER_HELPER
    );
  });
});

describe("v8.112 — triage heuristic IS the source of truth for ceremonyMode", () => {
  it("triage prompt stamps ceremonyMode deterministically from complexity (heuristic-only contract)", () => {
    expect(TRIAGE_PROMPT).toMatch(
      /heuristic is the sole source of truth|sole source of truth at this hop/iu
    );
    // The complexity→ceremonyMode mapping is the only ceremony path.
    expect(TRIAGE_PROMPT).toMatch(/trivial\s*→\s*inline/iu);
    expect(TRIAGE_PROMPT).toMatch(/small-medium\s*→\s*soft/iu);
    expect(TRIAGE_PROMPT).toMatch(/large-risky\s*→\s*strict/iu);
    // Zero-question rule is preserved.
    expect(TRIAGE_PROMPT).toMatch(/zero[- ]question rule/iu);
    // ceremonyMode is immutable for the lifetime of the flow (no mid-flow override).
    expect(TRIAGE_PROMPT).toMatch(/immutable/iu);
  });

  it("orchestrator body anchors the triage decision as immutable; only /cc-cancel restarts", () => {
    const body = renderStartCommand();
    expect(body).toMatch(/triage decision is \*\*immutable\*\*/u);
    expect(body).toContain("/cc-cancel");
  });
});

describe("writing-skills meta-skill is demoted (maintainer doc, not an end-user skill)", () => {
  it("`writing-skills` is no longer registered in AUTO_TRIGGER_SKILLS", () => {
    const skill = AUTO_TRIGGER_SKILLS.find((s) => s.id === "writing-skills");
    expect(
      skill,
      "writing-skills must NOT be registered — it only fires for cclaw maintainers and was demoted in the consolidation pass"
    ).toBeUndefined();
  });

  it("writing-skills.md is deleted from src/content/skills/", async () => {
    await expect(
      readFile(path.resolve(SRC_ROOT, "content", "skills", "writing-skills.md")),
      "writing-skills.md should be deleted (demoted to a maintainer doc, not an installed end-user skill)"
    ).rejects.toThrow();
  });
});

describe("critic §3.5 cross-model is a one-shot two-critic gate (no fix-and-rerun loop)", () => {
  it("critic prompt's cross-model section documents the one-shot second-opinion contract", () => {
    // One-shot contract: both critics walk the artifacts once; both must PASS; divergence => block-ship.
    expect(CRITIC_PROMPT).toMatch(/one-shot[\s\S]{0,40}second opinion/iu);
    expect(CRITIC_PROMPT).toMatch(/(both|each) critic[s]? must (PASS|pass|emit pass)/iu);
    expect(CRITIC_PROMPT).toMatch(/(divergence|diverged)[\s\S]{0,60}block-ship/iu);
    // No automatic fix-and-rerun loop: the prompt explicitly forbids it.
    expect(CRITIC_PROMPT).toMatch(/no automatic fix-and-rerun loop|does NOT auto-iterate|no fix-only re-run/iu);
    expect(CRITIC_PROMPT).toMatch(/cross-model second opinion diverged/iu);
    // The graceful fallback for missing MCP tool stays intact.
    expect(CRITIC_PROMPT).toMatch(/Cross-model unavailable: skipped/u);
  });
});
