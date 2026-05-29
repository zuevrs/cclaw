import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { ARTIFACT_TEMPLATES } from "../../src/content/artifact-templates.js";
import { CRITIC_PROMPT } from "../../src/content/specialist-prompts/critic.js";
import {
  START_COMMAND_BODY,
  renderStartCommand
} from "../../src/content/start-command.js";
import { type CclawConfig, type CriticConfig } from "../../src/config.js";

/**
 * v8.72 — Cross-model second opinion in critic. Slimmed in v8.99
 * test-slim-down A2 to one WIRING + one BEHAVIOR + one SECTION CONTRACT.
 */

const REPO_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "../..");
const CRITIC_TEMPLATE_BODY = ARTIFACT_TEMPLATES.find((t) => t.id === "critic")!.body;

describe("v8.72 — cross-model critic wiring (config knob + CLI flag + version)", () => {
  it("WIRING — CriticConfig accepts cross_model: boolean; CclawConfig admits a critic block; CLI src/cli.ts HELP_NOTES documents --critic-cross-model + 'Cross-model unavailable: skipped' + 'critic.cross_model'; package.json ≥8.72 + CHANGELOG carries v8.72+ entry with cross-model + --critic-cross-model + MCP citations", async () => {
    // Config knob
    const a: CriticConfig = { cross_model: false };
    const b: CriticConfig = { cross_model: true };
    const c: CriticConfig = {};
    expect(a.cross_model).toBe(false);
    expect(b.cross_model).toBe(true);
    expect(c.cross_model).toBeUndefined();
    const cfgFull: CclawConfig = {
      version: "8.72.0",
      flowVersion: "8",
      harnesses: ["cursor"],
      critic: { cross_model: true }
    };
    expect(cfgFull.critic?.cross_model).toBe(true);

    // CLI HELP_NOTES
    const cliBody = await fs.readFile(path.join(REPO_ROOT, "src/cli.ts"), "utf8");
    expect(cliBody).toMatch(/--critic-cross-model/);
    expect(cliBody).toMatch(/Cross-model unavailable: skipped/);
    expect(cliBody).toMatch(/critic\.cross_model/);

    // version + CHANGELOG
    const pkg = JSON.parse(
      await fs.readFile(path.join(REPO_ROOT, "package.json"), "utf8")
    ) as { version: string };
    const m = pkg.version.match(/^(\d+)\.(\d+)\./);
    expect(m).not.toBeNull();
    const [major, minor] = m!.slice(1).map((n) => Number.parseInt(n, 10));
    expect(major === 8 && minor >= 72).toBe(true);
    const changelog = await fs.readFile(path.join(REPO_ROOT, "CHANGELOG.md"), "utf8");
    expect(changelog).toMatch(/##\s*8\.(7[2-9]|[8-9]\d|\d{3,})\.0/);
    expect(changelog).toMatch(/Cross-model|cross-model/);
    expect(changelog).toMatch(/critic/);
    expect(changelog).toMatch(/--critic-cross-model/);
    expect(changelog).toMatch(/MCP/);
  });
});

describe("v8.72 — cross-model critic behavior (start-command body wires the envelope stamp + flag)", () => {
  it("BEHAVIOR — renderStartCommand stays identical to START_COMMAND_BODY (no drift); body declares `crossModelCritic: true` envelope key, `--critic-cross-model` user flag, high-stakes triggers (securityFlag + irreversible/data-migration/public-API/payment), cites gstack `/codex` reference pattern, declares graceful fallback `Cross-model unavailable: skipped`, and places the cross-model pointer under the `#### critic` step (not buried elsewhere)", () => {
    expect(renderStartCommand()).toBe(START_COMMAND_BODY);
    expect(START_COMMAND_BODY).toMatch(/crossModelCritic\s*:\s*true/);
    expect(START_COMMAND_BODY).toMatch(/--critic-cross-model/);
    expect(START_COMMAND_BODY).toMatch(/securityFlag|security_flag/);
    expect(START_COMMAND_BODY).toMatch(
      /irreversible|data loss|data migration|public-API|public API/i
    );
    expect(START_COMMAND_BODY).toMatch(/gstack|\/codex|Codex/);
    expect(START_COMMAND_BODY).toMatch(/Cross-model unavailable: skipped/);
    const criticIdx = START_COMMAND_BODY.indexOf("#### critic");
    const crossModelIdx = START_COMMAND_BODY.indexOf("crossModelCritic");
    expect(criticIdx).toBeGreaterThan(0);
    expect(crossModelIdx).toBeGreaterThan(criticIdx);
  });
});

describe("v8.72 — cross-model critic section contract (critic prompt + critic.md template)", () => {
  it("SECTION CONTRACT — critic prompt declares §3.5 Cross-model second opinion with full trigger set (securityFlag / irreversible D-N blast radius / --critic-cross-model), names envelope key `crossModelCritic: true`, X-F-N numbering for cross-model findings (distinct from §3 F-N), second-model independence rule (cold / independent / no shared context), graceful fallback `Cross-model unavailable: skipped` verbatim, gstack /codex / Codex / Gemini reference, MCP dispatch surface (not hardcoded provider), config knob `critic.cross_model` + override semantics (--critic-cross-model bypasses); CRITIC_TEMPLATE carries `## Cross-model second opinion` AFTER §3 Adversarial findings AND BEFORE §4 Criterion check, declares X-F-N row shape (Technique / Trigger / Failure consequence / Severity), names crossModelCritic envelope flag, documents the graceful-fallback one-liner, and mentions --critic-cross-model override path", () => {
    // critic prompt
    expect(CRITIC_PROMPT).toMatch(/§3\.5[\s\S]{0,80}Cross-model second opinion/i);
    expect(CRITIC_PROMPT).toMatch(/securityFlag|security_flag/);
    expect(CRITIC_PROMPT).toMatch(/irreversible|data loss|data migration/i);
    expect(CRITIC_PROMPT).toMatch(/--critic-cross-model/);
    expect(CRITIC_PROMPT).toMatch(/crossModelCritic\s*:\s*true/);
    expect(CRITIC_PROMPT).toMatch(/X-F-N|X-F-\d/);
    expect(CRITIC_PROMPT).toMatch(/(never sees|independent|cold|without (the )?first model)/i);
    expect(CRITIC_PROMPT).toMatch(/Cross-model unavailable: skipped/);
    expect(CRITIC_PROMPT).toMatch(/gstack|\/codex|Codex|Gemini/);
    expect(CRITIC_PROMPT).toMatch(/MCP/);
    expect(CRITIC_PROMPT).toMatch(/config\.critic\.cross_model|critic\.cross_model/);
    expect(CRITIC_PROMPT).toMatch(/(bypass|override|user override wins|wins)/i);

    // CRITIC_TEMPLATE
    expect(CRITIC_TEMPLATE_BODY).toMatch(/^## Cross-model second opinion\b/mu);
    const advIdx = CRITIC_TEMPLATE_BODY.indexOf("## 3. Adversarial findings");
    const crossIdx = CRITIC_TEMPLATE_BODY.indexOf("## Cross-model second opinion");
    const criterionIdx = CRITIC_TEMPLATE_BODY.indexOf("## 4. Criterion check");
    expect(advIdx).toBeGreaterThan(0);
    expect(crossIdx).toBeGreaterThan(advIdx);
    expect(criterionIdx).toBeGreaterThan(crossIdx);
    const slice = CRITIC_TEMPLATE_BODY.slice(crossIdx);
    expect(slice).toMatch(/\| X-F-N \| Technique \| Trigger \| Failure consequence \| Severity \|/);
    expect(slice).toMatch(/crossModelCritic/);
    expect(slice).toMatch(/Cross-model unavailable: skipped/);
    expect(slice).toMatch(/--critic-cross-model/);
  });
});
