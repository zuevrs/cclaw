#!/usr/bin/env node
/**
 * Token-cost telemetry (T2-6, obra pattern; v8.13).
 *
 * Post-flow analyser that reports approximate token cost per stage / artifact
 * for a given slug (or the full active set). Useful for catching slugs that
 * silently became expensive (e.g., a 60K-token plan.md that grew over many
 * fix-only iterations) without having to crawl the files manually.
 *
 * Usage:
 *
 *   node scripts/analyze-token-usage.mjs                        # all active flows
 *   node scripts/analyze-token-usage.mjs --slug=<slug>          # one active slug
 *   node scripts/analyze-token-usage.mjs --shipped=<slug>       # one shipped slug
 *   node scripts/analyze-token-usage.mjs --all-shipped          # every shipped slug
 *   node scripts/analyze-token-usage.mjs --json                 # machine-readable output
 *
 * Token estimate: chars / 4 (the canonical anthropic / openai approximation
 * for English-heavy text). Markdown overhead is small enough that this
 * heuristic is within ±10% of an actual tokeniser pass for cclaw artifacts.
 */
import fs from "node:fs/promises";
import path from "node:path";

const REPO_ROOT = process.cwd();
const FLOWS_ACTIVE = path.join(REPO_ROOT, ".cclaw", "flows");
const FLOWS_SHIPPED = path.join(REPO_ROOT, ".cclaw", "flows", "shipped");

const args = process.argv.slice(2);
const flags = Object.fromEntries(
  args
    .filter((a) => a.startsWith("--"))
    .map((a) => {
      const [k, v] = a.replace(/^--/, "").split("=");
      return [k, v ?? true];
    })
);
const wantJson = Boolean(flags.json);

function approxTokens(text) {
  return Math.round(text.length / 4);
}

async function listSlugs(rootDir) {
  try {
    const entries = await fs.readdir(rootDir, { withFileTypes: true });
    return entries
      .filter((e) => e.isDirectory() && e.name !== "shipped" && e.name !== "cancelled")
      .map((e) => e.name);
  } catch {
    return [];
  }
}

async function readSlug(slugDir) {
  const result = { dir: slugDir, files: [], total_chars: 0, total_tokens: 0 };
  try {
    const entries = await fs.readdir(slugDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      const filePath = path.join(slugDir, entry.name);
      const body = await fs.readFile(filePath, "utf8");
      const chars = body.length;
      const tokens = approxTokens(body);
      result.files.push({
        name: entry.name,
        chars,
        tokens
      });
      result.total_chars += chars;
      result.total_tokens += tokens;
    }
    result.files.sort((a, b) => b.tokens - a.tokens);
  } catch (err) {
    result.error = err.message;
  }
  return result;
}

function fmt(n) {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

function renderTable(reports) {
  const grandTotalTokens = reports.reduce((sum, r) => sum + r.total_tokens, 0);
  const lines = [];
  lines.push("");
  lines.push("Token-cost report — cclaw");
  lines.push("=".repeat(60));
  for (const report of reports) {
    const slug = path.basename(report.dir);
    const status = path.relative(REPO_ROOT, path.dirname(report.dir));
    lines.push("");
    lines.push(`${slug}  (${status}) — total ${fmt(report.total_tokens)} tokens`);
    lines.push("-".repeat(60));
    if (report.error) {
      lines.push(`  ERROR: ${report.error}`);
      continue;
    }
    if (report.files.length === 0) {
      lines.push("  (empty)");
      continue;
    }
    for (const file of report.files) {
      const bar = "#".repeat(Math.min(40, Math.round((file.tokens / report.total_tokens) * 40)));
      lines.push(
        `  ${file.name.padEnd(30)} ${fmt(file.tokens).padStart(8)} tok  ${bar}`
      );
    }
  }
  lines.push("");
  lines.push("=".repeat(60));
  lines.push(`grand total: ${fmt(grandTotalTokens)} tokens across ${reports.length} slugs`);
  lines.push("");
  return lines.join("\n");
}

async function main() {
  const reports = [];

  if (flags.slug) {
    const dir = path.join(FLOWS_ACTIVE, flags.slug);
    reports.push(await readSlug(dir));
  } else if (flags.shipped) {
    const dir = path.join(FLOWS_SHIPPED, flags.shipped);
    reports.push(await readSlug(dir));
  } else if (flags["all-shipped"]) {
    const slugs = await listSlugs(FLOWS_SHIPPED);
    for (const slug of slugs) {
      reports.push(await readSlug(path.join(FLOWS_SHIPPED, slug)));
    }
  } else {
    const slugs = await listSlugs(FLOWS_ACTIVE);
    for (const slug of slugs) {
      reports.push(await readSlug(path.join(FLOWS_ACTIVE, slug)));
    }
  }

  if (reports.length === 0) {
    if (wantJson) {
      console.log(JSON.stringify({ reports: [], message: "No slugs found." }));
    } else {
      console.error("No slugs found in .cclaw/flows/. Pass --shipped=<slug> or --all-shipped to scan shipped/.");
      process.exit(0);
    }
    return;
  }

  if (wantJson) {
    console.log(
      JSON.stringify(
        {
          reports: reports.map((r) => ({
            slug: path.basename(r.dir),
            location: path.relative(REPO_ROOT, path.dirname(r.dir)),
            total_chars: r.total_chars,
            total_tokens: r.total_tokens,
            files: r.files
          })),
          grand_total_tokens: reports.reduce((s, r) => s + r.total_tokens, 0)
        },
        null,
        2
      )
    );
  } else {
    console.log(renderTable(reports));
  }
}

main().catch((err) => {
  console.error("analyze-token-usage failed:", err);
  process.exit(1);
});
