/**
 * Tiny terminal UI helpers for the cclaw installer.
 *
 * - Pure render functions take an explicit `useColor: boolean` so tests can
 *   mock either path without touching `process.env` or `process.stdout.isTTY`.
 * - Honours the [`NO_COLOR`](https://no-color.org) and `FORCE_COLOR`
 *   conventions so users with colour-stripped terminals or `NO_COLOR=1` set
 *   in their shell get plain output.
 * - Emits no spinners, no ANSI cursor moves, no clear screen — every
 *   render is a string of newline-terminated lines safe to pipe to a
 *   non-TTY (file, CI logs).
 *
 * Module-level state is intentionally minimal: just an ANSI table. The
 * banner, progress, summary, and welcome renderers are pure.
 */

export interface WriteStreamLike {
  write(chunk: string): unknown;
  isTTY?: boolean;
}

export interface UiEnv {
  NO_COLOR?: string;
  FORCE_COLOR?: string;
}

/**
 * Decide whether ANSI colour should be emitted for `stream`.
 *
 * Rules (in priority order):
 *  1. `NO_COLOR` set to any non-empty value → never colour.
 *  2. `FORCE_COLOR` set to a non-empty value other than `"0"` → always colour.
 *  3. Otherwise: respect `stream.isTTY`.
 */
export function shouldUseColor(
  stream: WriteStreamLike,
  env: UiEnv = process.env as UiEnv
): boolean {
  if (env.NO_COLOR && env.NO_COLOR.length > 0) return false;
  if (env.FORCE_COLOR && env.FORCE_COLOR.length > 0 && env.FORCE_COLOR !== "0") return true;
  return Boolean(stream.isTTY);
}

const ANSI = {
  reset: "\u001b[0m",
  bold: "\u001b[1m",
  dim: "\u001b[2m",
  cyan: "\u001b[36m",
  green: "\u001b[32m",
  yellow: "\u001b[33m",
  red: "\u001b[31m",
  magenta: "\u001b[35m"
} as const;

export type ColorName = keyof Omit<typeof ANSI, "reset">;

/** Wrap `text` in the ANSI colour code for `name` when `useColor` is true. */
export function colorize(name: ColorName, text: string, useColor: boolean): string {
  if (!useColor) return text;
  return `${ANSI[name]}${text}${ANSI.reset}`;
}

/** Block-letter "CCLAW" rendered in Unicode box-drawing characters. */
export const LOGO_LINES: readonly string[] = Object.freeze([
  " ██████╗ ██████╗██╗      █████╗ ██╗    ██╗",
  "██╔════╝██╔════╝██║     ██╔══██╗██║    ██║",
  "██║     ██║     ██║     ███████║██║ █╗ ██║",
  "██║     ██║     ██║     ██╔══██║██║███╗██║",
  "╚██████╗╚██████╗███████╗██║  ██║╚███╔███╔╝",
  " ╚═════╝ ╚═════╝╚══════╝╚═╝  ╚═╝ ╚══╝╚══╝ "
]);

export interface BannerOptions {
  version: string;
  tagline: string;
  useColor: boolean;
}

/**
 * Render the install-time banner: ASCII logo + one-line `cclaw vX.Y.Z` header.
 *
 * Output is plain ASCII when `useColor` is false (logo characters are still
 * Unicode box-drawing — they look fine in any modern terminal).
 */
export function renderBanner(options: BannerOptions): string {
  const { version, tagline, useColor } = options;
  const logo = LOGO_LINES.map((line) => colorize("cyan", line, useColor)).join("\n");
  const versionTag = colorize("dim", `v${version}`, useColor);
  const header = `cclaw ${versionTag} — ${tagline}`;
  return `\n${logo}\n\n  ${header}\n`;
}

export interface ProgressEvent {
  step: string;
  detail?: string;
}

/** Render a single `  ✓ step — detail` progress line. */
export function renderProgress(event: ProgressEvent, useColor: boolean): string {
  const check = colorize("green", "✓", useColor);
  const detail = event.detail ? ` ${colorize("dim", `— ${event.detail}`, useColor)}` : "";
  return `  ${check} ${event.step}${detail}\n`;
}

export interface SummaryCounts {
  harnesses: readonly string[];
  agents: number;
  skills: number;
  templates: number;
  runbooks: number;
  patterns: number;
  research: number;
  recovery: number;
  examples: number;
  hooks: number;
  commands: number;
}

/**
 * Render the post-install summary block:
 *
 *   Installed
 *     Harnesses: claude, cursor
 *     Agents       6
 *     Skills      17
 *     ...
 */
export function renderSummary(counts: SummaryCounts, useColor: boolean): string {
  const heading = colorize("bold", "Installed", useColor);
  const harnessesLabel = colorize("cyan", "Harnesses:", useColor);
  const harnessLine = `  ${harnessesLabel} ${counts.harnesses.join(", ")}`;
  const rows: ReadonlyArray<readonly [string, number]> = [
    ["Agents", counts.agents],
    ["Skills", counts.skills],
    ["Templates", counts.templates],
    ["Runbooks", counts.runbooks],
    ["Patterns", counts.patterns],
    ["Research", counts.research],
    ["Recovery", counts.recovery],
    ["Examples", counts.examples],
    ["Hooks", counts.hooks],
    ["Commands", counts.commands]
  ];
  const longest = rows.reduce((max, [label]) => Math.max(max, label.length), 0);
  const body = rows
    .map(([label, count]) => {
      const padded = label.padEnd(longest);
      return `    ${colorize("dim", padded, useColor)}  ${count}`;
    })
    .join("\n");
  return `\n  ${heading}\n${harnessLine}\n${body}\n`;
}

export interface WelcomeOptions {
  detected: readonly string[];
  useColor: boolean;
}

/**
 * Render the first-run welcome block. Shown only on `cclaw init` when no
 * `.cclaw/config.yaml` exists yet — never on `sync` / `upgrade` / re-init.
 */
export function renderWelcome(options: WelcomeOptions): string {
  const { useColor, detected } = options;
  const heading = colorize("cyan", "Welcome to cclaw", useColor);
  const intro = colorize(
    "dim",
    "We'll set up `.cclaw/` (state · hooks · flows · lib) and wire your harness's commands · agents · skills · hooks.",
    useColor
  );
  const next = colorize(
    "dim",
    detected.length > 0
      ? `Detected harness${detected.length === 1 ? "" : "es"}: ${detected.join(", ")} (pre-selected).`
      : "No harness detected — you'll be prompted to choose next.",
    useColor
  );
  const lines = [`  ${heading} — first-time setup`, `  ${intro}`, `  ${next}`];
  return `\n${lines.join("\n")}\n`;
}

/**
 * Render a coloured help block with `Commands:` / `Options:` headings,
 * cyan flag names, and dim descriptions. The first line (banner header
 * with version) is supplied by the caller because it's the same string
 * that `renderBanner` renders below the logo.
 */
export interface HelpSection {
  heading: string;
  rows: ReadonlyArray<readonly [string, string]>;
}

export function renderHelpSections(
  sections: readonly HelpSection[],
  useColor: boolean
): string {
  return sections
    .map((section) => {
      const heading = colorize("yellow", `${section.heading}:`, useColor);
      const longest = section.rows.reduce(
        (max, [label]) => Math.max(max, label.length),
        0
      );
      const rows = section.rows
        .map(([label, description]) => {
          const flag = colorize("cyan", label.padEnd(longest), useColor);
          const desc = colorize("dim", description, useColor);
          return `    ${flag}  ${desc}`;
        })
        .join("\n");
      return `\n  ${heading}\n${rows}`;
    })
    .join("\n");
}
