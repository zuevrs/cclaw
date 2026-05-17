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
import {
  DEFAULT_CRITIC_CROSS_MODEL,
  criticCrossModelOf,
  type CclawConfig,
  type CriticConfig
} from "../../src/config.js";

/**
 * v8.72 — Cross-model second opinion in critic.
 *
 * The critic specialist gains an optional SECOND adversarial pass that
 * runs via a different model through an available MCP cross-model tool
 * (Codex / Gemini / comparable). The pass fires when the orchestrator
 * stamps `crossModelCritic: true` in the dispatch envelope, which it
 * does when ANY of: `triage.securityFlag == true`; a `D-N` carries an
 * irreversible Blast-radius (data loss / migration / public API /
 * payment / auth / cryptography); OR the user invoked
 * `/cc --critic-cross-model`. Findings land in
 * `critic.md > ## Cross-model second opinion` with `X-F-N` numbering.
 * Harnesses without an MCP cross-model tool wired see the graceful
 * fallback `Cross-model unavailable: skipped.` one-liner.
 *
 * Tripwires:
 *   1. Critic prompt documents the cross-model dispatch contract:
 *      trigger set (security_flag / critical-path / irreversible /
 *      `--critic-cross-model`), second-model independence
 *      (no shared context with first pass), `X-F-N` numbering,
 *      graceful fallback line, config knob respect.
 *   2. Critic template (CRITIC_TEMPLATE) carries the
 *      `## Cross-model second opinion` section header, the X-F-N
 *      row shape, and the graceful-fallback one-liner.
 *   3. Start-command body documents the envelope stamp + triggers +
 *      the `--critic-cross-model` flag.
 *   4. CLI help (`HELP_NOTES`) documents the `--critic-cross-model`
 *      flag so operators can discover it via `cclaw --help`.
 *   5. Config carries the typed `CriticConfig.cross_model` knob with
 *      `false` as the documented default; reader returns default on
 *      missing / non-boolean inputs.
 *   6. package.json ≥ 8.72.0 + CHANGELOG carries the v8.72 entry.
 *   7. Reference cited (gstack `/codex` second-opinion pattern).
 */

const REPO_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "../..");

const CRITIC_TEMPLATE_BODY = ARTIFACT_TEMPLATES.find((t) => t.id === "critic")!.body;

describe("v8.72 — critic prompt mentions cross-model dispatch on high-stakes", () => {
  it("critic prompt declares the §3.5 Cross-model second opinion section", () => {
    expect(
      CRITIC_PROMPT,
      "critic prompt must declare the §3.5 cross-model section so the surface is discoverable in-prompt"
    ).toMatch(/§3\.5[\s\S]{0,80}Cross-model second opinion/i);
  });

  it("critic prompt names the trigger set: security_flag OR critical-path / irreversible OR --critic-cross-model", () => {
    expect(CRITIC_PROMPT, "trigger: security_flag").toMatch(/securityFlag|security_flag/);
    expect(CRITIC_PROMPT, "trigger: irreversible D-N blast radius").toMatch(
      /irreversible|data loss|data migration/i
    );
    expect(CRITIC_PROMPT, "trigger: --critic-cross-model user flag").toMatch(
      /--critic-cross-model/
    );
  });

  it("critic prompt declares the orchestrator-stamped envelope key `crossModelCritic: true`", () => {
    expect(
      CRITIC_PROMPT,
      "the envelope field is the wire-format signal the orchestrator stamps; critic prompt must name it verbatim"
    ).toMatch(/crossModelCritic\s*:\s*true/);
  });

  it("critic prompt declares X-F-N numbering for cross-model findings (distinguishes them from §3 F-N rows)", () => {
    expect(
      CRITIC_PROMPT,
      "cross-model findings ride a separate prefix so the audit trail is unambiguous"
    ).toMatch(/X-F-N|X-F-\d/);
  });

  it("critic prompt declares the second-model independence rule (no shared context with first pass)", () => {
    expect(CRITIC_PROMPT).toMatch(
      /(never sees|independent|cold|without (the )?first model)/i
    );
  });

  it("critic prompt names the graceful fallback verbatim: `Cross-model unavailable: skipped`", () => {
    expect(
      CRITIC_PROMPT,
      "harnesses without an MCP cross-model tool wired must see the canonical fallback line"
    ).toMatch(/Cross-model unavailable: skipped/);
  });

  it("critic prompt cites the gstack /codex reference pattern (second opinion via MCP)", () => {
    expect(
      CRITIC_PROMPT,
      "gstack's /codex skill is the canonical reference pattern; critic prompt must cite it"
    ).toMatch(/gstack|\/codex|Codex|Gemini/);
  });

  it("critic prompt names `MCP` as the dispatch surface (not a hardcoded provider)", () => {
    expect(
      CRITIC_PROMPT,
      "the second-opinion surface is intentionally MCP-mediated so any cross-model tool the harness wires can satisfy the contract"
    ).toMatch(/MCP/);
  });

  it("critic prompt documents the config knob `config.critic.cross_model` and the override semantics (--critic-cross-model bypasses the knob)", () => {
    expect(CRITIC_PROMPT).toMatch(/config\.critic\.cross_model|critic\.cross_model/);
    expect(
      CRITIC_PROMPT,
      "the explicit user flag must win over the config knob so a one-off forced pass is always available"
    ).toMatch(/(bypass|override|user override wins|wins)/i);
  });
});

describe("v8.72 — critic template (CRITIC_TEMPLATE) carries the Cross-model second opinion section", () => {
  it("CRITIC_TEMPLATE has the `## Cross-model second opinion` section heading", () => {
    expect(CRITIC_TEMPLATE_BODY).toMatch(/^## Cross-model second opinion\b/mu);
  });

  it("CRITIC_TEMPLATE Cross-model section appears AFTER `## 3. Adversarial findings` and BEFORE `## 4. Criterion check`", () => {
    const advIdx = CRITIC_TEMPLATE_BODY.indexOf("## 3. Adversarial findings");
    const crossIdx = CRITIC_TEMPLATE_BODY.indexOf("## Cross-model second opinion");
    const criterionIdx = CRITIC_TEMPLATE_BODY.indexOf("## 4. Criterion check");
    expect(advIdx).toBeGreaterThan(0);
    expect(crossIdx).toBeGreaterThan(advIdx);
    expect(criterionIdx).toBeGreaterThan(crossIdx);
  });

  it("CRITIC_TEMPLATE Cross-model section declares the X-F-N row shape (Technique / Trigger / Failure consequence / Severity)", () => {
    const slice = CRITIC_TEMPLATE_BODY.slice(
      CRITIC_TEMPLATE_BODY.indexOf("## Cross-model second opinion")
    );
    expect(slice).toMatch(/\| X-F-N \| Technique \| Trigger \| Failure consequence \| Severity \|/);
  });

  it("CRITIC_TEMPLATE Cross-model section names the envelope flag `crossModelCritic`", () => {
    const slice = CRITIC_TEMPLATE_BODY.slice(
      CRITIC_TEMPLATE_BODY.indexOf("## Cross-model second opinion")
    );
    expect(slice).toMatch(/crossModelCritic/);
  });

  it("CRITIC_TEMPLATE Cross-model section documents the graceful-fallback one-liner verbatim", () => {
    const slice = CRITIC_TEMPLATE_BODY.slice(
      CRITIC_TEMPLATE_BODY.indexOf("## Cross-model second opinion")
    );
    expect(slice).toMatch(/Cross-model unavailable: skipped/);
  });

  it("CRITIC_TEMPLATE Cross-model section mentions the user-flag override path (`--critic-cross-model`)", () => {
    const slice = CRITIC_TEMPLATE_BODY.slice(
      CRITIC_TEMPLATE_BODY.indexOf("## Cross-model second opinion")
    );
    expect(slice).toMatch(/--critic-cross-model/);
  });
});

describe("v8.72 — start-command body declares the envelope stamp + flag", () => {
  it("renderStartCommand() output is identical to START_COMMAND_BODY (no drift)", () => {
    expect(renderStartCommand()).toBe(START_COMMAND_BODY);
  });

  it("body documents the `crossModelCritic` envelope key the orchestrator stamps on dispatch", () => {
    expect(START_COMMAND_BODY).toMatch(/crossModelCritic\s*:\s*true/);
  });

  it("body documents the `--critic-cross-model` user flag", () => {
    expect(START_COMMAND_BODY).toMatch(/--critic-cross-model/);
  });

  it("body names the high-stakes trigger set (security flag + irreversible D-N)", () => {
    expect(START_COMMAND_BODY).toMatch(/securityFlag|security_flag/);
    expect(START_COMMAND_BODY).toMatch(
      /irreversible|data loss|data migration|public-API|public API/i
    );
  });

  it("body cites the gstack `/codex` reference pattern (second opinion via MCP)", () => {
    expect(START_COMMAND_BODY).toMatch(/gstack|\/codex|Codex/);
  });

  it("body declares the graceful fallback path (Cross-model unavailable: skipped)", () => {
    expect(START_COMMAND_BODY).toMatch(/Cross-model unavailable: skipped/);
  });

  it("body declares the cross-model pointer under the #### critic step section (not buried elsewhere)", () => {
    const criticIdx = START_COMMAND_BODY.indexOf("#### critic");
    const crossModelIdx = START_COMMAND_BODY.indexOf("crossModelCritic");
    expect(criticIdx).toBeGreaterThan(0);
    expect(crossModelIdx).toBeGreaterThan(criticIdx);
  });
});

describe("v8.72 — CLI help documents the --critic-cross-model flag", () => {
  it("CLI source documents the `--critic-cross-model` flag in HELP_NOTES", async () => {
    const body = await fs.readFile(path.join(REPO_ROOT, "src/cli.ts"), "utf8");
    expect(
      body,
      "the /cc orchestrator flag surface must be discoverable from `cclaw --help` so operators can find it"
    ).toMatch(/--critic-cross-model/);
  });

  it("CLI HELP_NOTES names the cross-model fallback semantics (so operators understand the opt-in is safe)", async () => {
    const body = await fs.readFile(path.join(REPO_ROOT, "src/cli.ts"), "utf8");
    expect(body).toMatch(/Cross-model unavailable: skipped/);
  });

  it("CLI HELP_NOTES names the config knob `critic.cross_model` as the project-level opt-in", async () => {
    const body = await fs.readFile(path.join(REPO_ROOT, "src/cli.ts"), "utf8");
    expect(body).toMatch(/critic\.cross_model/);
  });
});

describe("v8.72 — config knob (critic.cross_model) typed + defaulted", () => {
  it("CriticConfig interface accepts `cross_model: boolean` (compile-time round-trip)", () => {
    const a: CriticConfig = { cross_model: false };
    const b: CriticConfig = { cross_model: true };
    const c: CriticConfig = {};
    expect(a.cross_model).toBe(false);
    expect(b.cross_model).toBe(true);
    expect(c.cross_model).toBeUndefined();
  });

  it("CclawConfig admits a `critic` block (writes round-trip through the type)", () => {
    const config: CclawConfig = {
      version: "8.72.0",
      flowVersion: "8",
      harnesses: ["cursor"],
      critic: { cross_model: true }
    };
    expect(config.critic?.cross_model).toBe(true);
  });

  it("DEFAULT_CRITIC_CROSS_MODEL is `false` (v8.72 ships the knob OFF — opt-in by design)", () => {
    expect(DEFAULT_CRITIC_CROSS_MODEL).toBe(false);
  });

  it("criticCrossModelOf returns DEFAULT_CRITIC_CROSS_MODEL when config is null / undefined", () => {
    expect(criticCrossModelOf(null)).toBe(DEFAULT_CRITIC_CROSS_MODEL);
    expect(criticCrossModelOf(undefined)).toBe(DEFAULT_CRITIC_CROSS_MODEL);
  });

  it("criticCrossModelOf returns DEFAULT_CRITIC_CROSS_MODEL when critic block is absent", () => {
    const config: CclawConfig = {
      version: "8.72.0",
      flowVersion: "8",
      harnesses: ["cursor"]
    };
    expect(criticCrossModelOf(config)).toBe(DEFAULT_CRITIC_CROSS_MODEL);
  });

  it("criticCrossModelOf returns DEFAULT_CRITIC_CROSS_MODEL when cross_model field is absent", () => {
    const config: CclawConfig = {
      version: "8.72.0",
      flowVersion: "8",
      harnesses: ["cursor"],
      critic: {}
    };
    expect(criticCrossModelOf(config)).toBe(DEFAULT_CRITIC_CROSS_MODEL);
  });

  it("criticCrossModelOf returns the configured value when set explicitly", () => {
    const on: CclawConfig = {
      version: "8.72.0",
      flowVersion: "8",
      harnesses: ["cursor"],
      critic: { cross_model: true }
    };
    const off: CclawConfig = {
      version: "8.72.0",
      flowVersion: "8",
      harnesses: ["cursor"],
      critic: { cross_model: false }
    };
    expect(criticCrossModelOf(on)).toBe(true);
    expect(criticCrossModelOf(off)).toBe(false);
  });

  it("criticCrossModelOf returns DEFAULT_CRITIC_CROSS_MODEL on non-boolean input (graceful fallback)", () => {
    const bad: CclawConfig = {
      version: "8.72.0",
      flowVersion: "8",
      harnesses: ["cursor"],
      // @ts-expect-error — intentional bad input to verify graceful fallback
      critic: { cross_model: "true" }
    };
    expect(criticCrossModelOf(bad)).toBe(DEFAULT_CRITIC_CROSS_MODEL);
  });
});

describe("v8.72 — version bump + CHANGELOG", () => {
  it("package.json version is 8.72.0 (or later)", async () => {
    const body = await fs.readFile(path.join(REPO_ROOT, "package.json"), "utf8");
    const parsed = JSON.parse(body) as { version: string };
    const match = parsed.version.match(/^(\d+)\.(\d+)\./);
    expect(match, `package.json version '${parsed.version}' must follow major.minor.patch`).not.toBeNull();
    const [major, minor] = match!.slice(1).map((n) => Number.parseInt(n, 10));
    expect(
      major === 8 && minor >= 72,
      `package.json must be bumped to v8.72.0 or later (got ${parsed.version})`
    ).toBe(true);
  });

  it("CHANGELOG.md contains a v8.72 (or later) entry with the cross-model-critic framing", async () => {
    const body = await fs.readFile(path.join(REPO_ROOT, "CHANGELOG.md"), "utf8");
    expect(
      body,
      "CHANGELOG must record the v8.72 cross-model-critic entry"
    ).toMatch(/##\s*8\.(7[2-9]|[8-9]\d|\d{3,})\.0/);
    expect(body).toMatch(/Cross-model|cross-model/);
    expect(body).toMatch(/critic/);
    expect(body).toMatch(/--critic-cross-model/);
    expect(body).toMatch(/MCP/);
  });
});
