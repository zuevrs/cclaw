import { describe, expect, it } from "vitest";
import {
  LOGO_LINES,
  colorize,
  renderBanner,
  renderHelpSections,
  renderProgress,
  renderSummary,
  renderWelcome,
  shouldUseColor,
  type SummaryCounts
} from "../../src/ui.js";

const STREAM_TTY = { write() {}, isTTY: true } as const;
const STREAM_NO_TTY = { write() {} } as const;

describe("ui.shouldUseColor", () => {
  it("returns true when stream is TTY and no color env vars set", () => {
    expect(shouldUseColor(STREAM_TTY, {})).toBe(true);
  });

  it("returns false when stream is not a TTY (e.g. piped, CI logs)", () => {
    expect(shouldUseColor(STREAM_NO_TTY, {})).toBe(false);
  });

  it("NO_COLOR=1 disables color even on a TTY", () => {
    expect(shouldUseColor(STREAM_TTY, { NO_COLOR: "1" })).toBe(false);
  });

  it("FORCE_COLOR=1 forces color on a non-TTY stream", () => {
    expect(shouldUseColor(STREAM_NO_TTY, { FORCE_COLOR: "1" })).toBe(true);
  });

  it("FORCE_COLOR=0 is treated as off (does not force)", () => {
    expect(shouldUseColor(STREAM_NO_TTY, { FORCE_COLOR: "0" })).toBe(false);
  });

  it("NO_COLOR wins over FORCE_COLOR (NO_COLOR is the standard precedence)", () => {
    expect(shouldUseColor(STREAM_TTY, { NO_COLOR: "1", FORCE_COLOR: "1" })).toBe(false);
  });

  it("empty NO_COLOR string is ignored (per the no-color.org spec)", () => {
    expect(shouldUseColor(STREAM_TTY, { NO_COLOR: "" })).toBe(true);
  });
});

describe("ui.colorize", () => {
  it("returns plain text when useColor=false (no ANSI escapes)", () => {
    expect(colorize("cyan", "hi", false)).toBe("hi");
  });

  it("wraps in ANSI cyan + reset when useColor=true", () => {
    const out = colorize("cyan", "hi", true);
    expect(out).toBe("\u001b[36mhi\u001b[0m");
  });
});

describe("ui.renderBanner", () => {
  it("contains the logo, version tag, and tagline; ends with newline", () => {
    const out = renderBanner({ version: "1.2.3", tagline: "tagline goes here", useColor: false });
    expect(out).toContain(LOGO_LINES[0]!);
    expect(out).toContain("cclaw v1.2.3 — tagline goes here");
    expect(out.endsWith("\n")).toBe(true);
  });

  it("plain ASCII (no ANSI escapes) when useColor=false", () => {
    const out = renderBanner({ version: "1.2.3", tagline: "x", useColor: false });
    expect(out).not.toMatch(/\u001b\[/);
  });

  it("emits ANSI escapes around logo + version when useColor=true", () => {
    const out = renderBanner({ version: "1.2.3", tagline: "x", useColor: true });
    expect(out).toMatch(/\u001b\[/);
  });
});

describe("ui.renderProgress", () => {
  it("emits `  ✓ step` line and trailing newline", () => {
    const out = renderProgress({ step: "Wrote skills" }, false);
    expect(out).toBe("  ✓ Wrote skills\n");
  });

  it("appends `— detail` when detail is provided", () => {
    const out = renderProgress({ step: "Wrote skills", detail: "17 skills" }, false);
    expect(out).toContain("Wrote skills");
    expect(out).toContain("— 17 skills");
  });

  it("colored when useColor=true (✓ wrapped in green; detail in dim)", () => {
    const out = renderProgress({ step: "x", detail: "y" }, true);
    expect(out).toContain("\u001b[32m✓\u001b[0m");
    expect(out).toContain("\u001b[2m");
  });
});

describe("ui.renderSummary", () => {
  const counts: SummaryCounts = {
    harnesses: ["claude", "cursor"],
    agents: 6,
    skills: 17,
    templates: 8,
    runbooks: 4,
    patterns: 8,
    research: 3,
    recovery: 5,
    examples: 8,
    hooks: 3,
    commands: 2
  };

  it("contains header, harnesses line, and one row per family", () => {
    const out = renderSummary(counts, false);
    expect(out).toContain("Installed");
    expect(out).toContain("Harnesses: claude, cursor");
    expect(out).toContain("Agents");
    expect(out).toContain("Skills");
    expect(out).toContain("Templates");
    expect(out).toContain("Runbooks");
    expect(out).toContain("Patterns");
    expect(out).toContain("Research");
    expect(out).toContain("Recovery");
    expect(out).toContain("Examples");
    expect(out).toContain("Hooks");
    expect(out).toContain("Commands");
    expect(out).toContain("17");
  });

  it("plain ASCII when useColor=false (no ANSI escapes)", () => {
    expect(renderSummary(counts, false)).not.toMatch(/\u001b\[/);
  });

  it("contains ANSI escapes when useColor=true", () => {
    expect(renderSummary(counts, true)).toMatch(/\u001b\[/);
  });
});

describe("ui.renderWelcome", () => {
  it("includes welcome heading and intro line", () => {
    const out = renderWelcome({ detected: [], useColor: false });
    expect(out).toContain("Welcome to cclaw — first-time setup");
    expect(out).toContain("`.cclaw/`");
  });

  it("mentions detected harnesses (plural form) when more than one detected", () => {
    const out = renderWelcome({ detected: ["claude", "cursor"], useColor: false });
    expect(out).toContain("Detected harnesses: claude, cursor");
  });

  it("uses singular form when exactly one harness detected", () => {
    const out = renderWelcome({ detected: ["cursor"], useColor: false });
    expect(out).toContain("Detected harness: cursor");
  });

  it("falls back to a 'no harness detected' line when detected is empty", () => {
    const out = renderWelcome({ detected: [], useColor: false });
    expect(out).toContain("No harness detected");
  });
});

describe("ui.renderHelpSections", () => {
  it("renders each section heading and its rows", () => {
    const out = renderHelpSections(
      [
        {
          heading: "Commands",
          rows: [
            ["init", "Install cclaw"],
            ["sync", "Reapply"]
          ]
        },
        { heading: "Options", rows: [["--harness=<id>", "Pick harness"]] }
      ],
      false
    );
    expect(out).toContain("Commands:");
    expect(out).toContain("Options:");
    expect(out).toContain("init");
    expect(out).toContain("Install cclaw");
    expect(out).toContain("--harness=<id>");
    expect(out).toContain("Pick harness");
  });

  it("pads flag column so descriptions align (within a section)", () => {
    const out = renderHelpSections(
      [
        {
          heading: "Commands",
          rows: [
            ["init", "Install"],
            ["uninstall", "Remove"]
          ]
        }
      ],
      false
    );
    const lines = out.split("\n").filter((line) => line.includes("Install") || line.includes("Remove"));
    expect(lines).toHaveLength(2);
    const initLine = lines.find((line) => line.includes("Install"))!;
    const uninstallLine = lines.find((line) => line.includes("Remove"))!;
    const initColumn = initLine.indexOf("Install");
    const uninstallColumn = uninstallLine.indexOf("Remove");
    expect(initColumn).toBe(uninstallColumn);
  });
});
