import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { describe, expect, it } from "vitest";

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  ".."
);

/**
 * v8.94 — generic regex tripwire for axis / lens / specialist count
 * drift across the docs surface (Phase-C audit gap G-6 fix).
 *
 * Background. The v8.83-docs-fix work pinned a specific phrase list
 * ("8 sub-agents", "ten-axis", "5 research-only lens", ...) but did
 * NOT regex-sweep broader stale axis-count strings. v8.84 / v8.85 /
 * v8.86 each added a reviewer axis (scope-drift / assumption-coverage
 * / anti-slop), v8.76 added the design research-lens, and v8.77 added
 * three triage fields (taskShape / designSurface / devexSurface) on
 * top of the core five the triage sub-agent decides — so the user-
 * facing surfaces accumulated stale "eleven-axis" / "5 lenses" /
 * "five-field" claims that the v8.83 fixed-phrase tripwire could not
 * catch.
 *
 * This file is the "v8.83-docs-fix tripwire pattern done right":
 * phrase-blacklist becomes regex. The regex catches stale
 * "<N>-axis <noun>" / "<N> reviewer axes" / "<N> research(-only)?
 * lens(es)" / "<N>-lens (pass|dispatch|set|roster)" / "<N>-specialist
 * roster" / "<N> sub-agents" strings when N (after word→digit
 * canonicalization) doesn't match the current canonical count —
 * historical references (sentences with "v8.X" or "previously" or
 * "pre-v8.X" or "was" or "former" / "formerly" / "bumped from" /
 * etc.) are excluded via a context-window scan so the historical
 * narrative ("v8.85 added the 13th axis, v8.86 bumped to 14") stays
 * intact.
 *
 * Canonical counts (current as of v8.107):
 *   - REVIEWER AXES: 14 (8 base + 6 gated post-v8.86)
 *   - RESEARCH LENSES: 6 (engineer / product / architecture / history
 *     / skeptic / design — design added v8.76)
 *   - SPECIALISTS: 8 (triage / investigator / architect / builder /
 *     plan-critic / qa-runner / reviewer / critic — v8.104 merged
 *     v8.75 plan-design + v8.82 plan-devex into plan-critic as
 *     rubric modes "design" / "devex"; one specialist, three rubric
 *     modes dispatched via envelope fan-out)
 *   - RUNBOOKS: 23 (on-demand runbooks loaded by trigger from
 *     `runbooks-on-demand.ts`; tripwire added v8.107)
 *   - TRIAGE FIELD-COUNT (bimodal):
 *       sub-agent core decision surface: 5 (complexity / ceremonyMode
 *       / path / runMode / mode)
 *       orchestrator-stamped aggregate: 8 (core 5 + taskShape /
 *       designSurface / devexSurface)
 *     The tripwire accepts both labels; mid-numbers (6/7/9/10-field)
 *     are flagged as stale.
 */

const AXES_CANONICAL = 14;
const LENSES_CANONICAL = 6;
const SPECIALISTS_CANONICAL = 8;
const RUNBOOKS_CANONICAL = 23;
const TRIAGE_FIELDS_CORE = 5;
const TRIAGE_FIELDS_AGGREGATE = 8;

const WORD_TO_NUMBER: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
  sixteen: 16,
  seventeen: 17,
  eighteen: 18,
  nineteen: 19,
  twenty: 20
};

const HISTORICAL_MARKERS: RegExp[] = [
  /\bv8\.\d+\b/i,
  /\bpre-v8\.\d+\b/i,
  /\bpre-cclaw\b/i,
  /\bpreviously\b/i,
  /\bwas\b/i,
  /\bformer\b/i,
  /\bformerly\b/i,
  /\bbumped (?:from|to)\b/i,
  /\bgrew (?:from|to)\b/i,
  /\bmoved (?:from|to)\b/i,
  /\bup from\b/i,
  /\bdown from\b/i,
  /\bhistor(?:y|ical)\b/i,
  /\blegacy\b/i,
  /\bdeprecated\b/i,
  /\bretired\b/i,
  /\babsorbed\b/i,
  /\bcollapsed\b/i,
  /\b(?:added|added the|introduced|introduced the|removed|removed the)\b/i
];

const CONTEXT_WINDOW = 220;

interface Match {
  file: string;
  ruleId: string;
  fullMatch: string;
  numberToken: string;
  numericValue: number;
  canonical: number;
  noun: string;
  context: string;
  position: number;
}

interface Rule {
  id: string;
  pattern: RegExp;
  canonical: number;
  noun: string;
}

const NUMBER_TOKEN =
  "(\\d{1,3}|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty)";

const RULES: Rule[] = [
  // Reviewer axes — `<N>-axis review` / `<N>-axis pass` / `<N>-axis
  // check(list)?` / `<N>-axis surface` / `<N>-axis specialist` /
  // `<N>-axis rubric`. The qualifier noun ties the claim to the
  // canonical reviewer axis surface.
  {
    id: "reviewer-axis-qualified",
    pattern: new RegExp(
      `\\b${NUMBER_TOKEN}[ -]axis (?:review|pass|check|checklist|surface|specialist|rubric|reviewer)\\b`,
      "gi"
    ),
    canonical: AXES_CANONICAL,
    noun: "reviewer axis"
  },
  // `<N> reviewer (axis|axes)` and `reviewer's <N>-axis` / `reviewer's
  // <N> axes` — explicit reviewer-axis count claim.
  {
    id: "reviewer-axes-explicit",
    pattern: new RegExp(`\\b${NUMBER_TOKEN} reviewer (?:axis|axes)\\b`, "gi"),
    canonical: AXES_CANONICAL,
    noun: "reviewer axes"
  },
  {
    id: "reviewer-possessive-axes",
    pattern: new RegExp(
      `\\breviewer'?s ${NUMBER_TOKEN}[- ](?:axis|axes)\\b`,
      "gi"
    ),
    canonical: AXES_CANONICAL,
    noun: "reviewer axes"
  },
  // Research lenses — explicit `<N> research(-only )? lens(es)?` claim.
  {
    id: "research-lens-explicit",
    pattern: new RegExp(
      `\\b${NUMBER_TOKEN} research(?:-only)? (?:lens|lenses)\\b`,
      "gi"
    ),
    canonical: LENSES_CANONICAL,
    noun: "research lenses"
  },
  // Specialists — `<N> sub-agents` (the README's canonical phrasing).
  {
    id: "specialists-sub-agents",
    pattern: new RegExp(`\\b${NUMBER_TOKEN} sub-agents\\b`, "gi"),
    canonical: SPECIALISTS_CANONICAL,
    noun: "specialists"
  },
  // Specialists — `<N>-specialist roster` (start-command's phrasing).
  {
    id: "specialists-roster",
    pattern: new RegExp(
      `\\b${NUMBER_TOKEN}[- ]specialist (?:roster|contracts?)\\b`,
      "gi"
    ),
    canonical: SPECIALISTS_CANONICAL,
    noun: "specialists"
  },
  // Runbooks — `<N> runbook(s)` (v8.107 added — currently 23 on-demand
  // runbooks dispatched by `runbooks-on-demand.ts`). Catches stale
  // `13 runbooks` / `16 runbooks` / `18 runbooks` count rows accumulated
  // across `README.md`, specialist prompts, and start-command pointer
  // prose.
  {
    id: "runbooks-count",
    pattern: /\b(\d+)\s+runbooks?\b/gi,
    canonical: RUNBOOKS_CANONICAL,
    noun: "runbooks"
  }
];

function numberFromToken(token: string): number | null {
  const digit = Number.parseInt(token, 10);
  if (!Number.isNaN(digit)) return digit;
  return WORD_TO_NUMBER[token.toLowerCase()] ?? null;
}

function isHistoricalContext(context: string): boolean {
  return HISTORICAL_MARKERS.some((rx) => rx.test(context));
}

function scanFile(absPath: string, repoRelative: string): Match[] {
  const body = readFileSync(absPath, "utf8");
  const matches: Match[] = [];

  for (const rule of RULES) {
    const re = new RegExp(rule.pattern.source, rule.pattern.flags);
    let m: RegExpExecArray | null;
    while ((m = re.exec(body)) !== null) {
      const numericValue = numberFromToken(m[1]);
      if (numericValue === null) continue;
      if (numericValue === rule.canonical) continue;

      const start = Math.max(0, m.index - CONTEXT_WINDOW);
      const end = Math.min(
        body.length,
        m.index + m[0].length + CONTEXT_WINDOW
      );
      const context = body.slice(start, end);

      if (isHistoricalContext(context)) continue;

      matches.push({
        file: repoRelative,
        ruleId: rule.id,
        fullMatch: m[0],
        numberToken: m[1],
        numericValue,
        canonical: rule.canonical,
        noun: rule.noun,
        context,
        position: m.index
      });
    }
  }

  return matches;
}

function listFiles(dir: string, repoRoot: string): string[] {
  const out: string[] = [];
  const entries = readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...listFiles(full, repoRoot));
    } else if (
      entry.isFile() &&
      (entry.name.endsWith(".ts") ||
        entry.name.endsWith(".md") ||
        entry.name.endsWith(".mjs"))
    ) {
      out.push(path.relative(repoRoot, full));
    }
  }
  return out;
}

const SWEPT_DIRS = [
  "src/content/specialist-prompts",
  "src/content/skills",
  "src/content/research-lenses"
];

const SWEPT_INDIVIDUAL_FILES = [
  "src/content/start-command.ts",
  "src/content/stage-playbooks.ts",
  "src/content/runbooks-on-demand.ts",
  "src/content/artifact-templates.ts",
  "src/content/skills.ts",
  "src/content/core-agents.ts",
  "README.md"
];

function buildTargetFileList(): string[] {
  const seen = new Set<string>();
  for (const rel of SWEPT_DIRS) {
    const abs = path.join(REPO_ROOT, rel);
    for (const file of listFiles(abs, REPO_ROOT)) {
      seen.add(file);
    }
  }
  for (const file of SWEPT_INDIVIDUAL_FILES) seen.add(file);
  return [...seen].sort();
}

describe("v8.94 — docs-drift regex tripwire (sweep 2; Phase C G-6 fix)", () => {
  const targetFiles = buildTargetFileList();

  describe("regex sweep — stale axis/lens/specialist count claims outside historical context", () => {
    it("no stale current-reality count strings across docs surface", () => {
      const allMatches: Match[] = [];
      for (const rel of targetFiles) {
        const abs = path.join(REPO_ROOT, rel);
        allMatches.push(...scanFile(abs, rel));
      }

      if (allMatches.length > 0) {
        const report = allMatches
          .map(
            (m) =>
              `\n  ${m.file} @${m.position} [rule=${m.ruleId}]: "${m.fullMatch}" — wanted ${m.canonical} ${m.noun} (got ${m.numericValue} from "${m.numberToken}").` +
              `\n    Context: …${m.context.replace(/\n/g, " ⏎ ").trim()}…`
          )
          .join("\n");
        throw new Error(
          `Found ${allMatches.length} stale axis/lens/specialist count claim(s):` +
            report +
            `\n\nIf the match describes CURRENT reality, update the number to the canonical value (axes=${AXES_CANONICAL}, lenses=${LENSES_CANONICAL}, specialists=${SPECIALISTS_CANONICAL}).` +
            `\nIf the match is intentionally historical (e.g. "v8.83 introduced the 13th axis"), add a historical marker phrase (v8.X / pre-v8.X / previously / was / former / formerly / bumped from / etc.) within ~220 chars so the tripwire excludes it.`
        );
      }
    });
  });

  describe("explicit canonical-count pinning (current-reality count rows)", () => {
    const README = readFileSync(path.join(REPO_ROOT, "README.md"), "utf8");
    const REVIEWER_PROMPT = readFileSync(
      path.join(REPO_ROOT, "src/content/specialist-prompts/reviewer.ts"),
      "utf8"
    );
    const INVESTIGATOR_PROMPT = readFileSync(
      path.join(REPO_ROOT, "src/content/specialist-prompts/investigator.ts"),
      "utf8"
    );

    it(`README declares "${AXES_CANONICAL} axes" in the reviewer phrasing`, () => {
      expect(README).toMatch(/14 axes/);
    });

    it(`README declares "${SPECIALISTS_CANONICAL} specialist contracts" (post-v8.107 rewrite phrasing)`, () => {
      // v8.107 rewrote README from inventory-table prose ("8 sub-agents")
      // to deeper-docs link prose ("8 specialist contracts"). Either
      // canonical phrasing pins the specialists count.
      expect(README).toMatch(/8 (?:sub-agents|specialist contracts)/);
    });

    it(`README declares the runbook count (${RUNBOOKS_CANONICAL} on-demand runbooks)`, () => {
      expect(README).toMatch(/23 on-demand runbooks/);
    });

    it("README mentions the research-lens count (six / 6)", () => {
      // v8.107 rewrote the lens count phrasing from `6 research-only
      // lens contracts` to `6 research lenses`. Either canonical
      // phrasing pins the lens count.
      const hasSix =
        README.includes("six lenses") ||
        README.includes("6 research-only") ||
        README.includes("6 research lenses");
      expect(hasSix).toBe(true);
    });

    it(`reviewer.ts opens with "Fourteen-axis review"`, () => {
      expect(REVIEWER_PROMPT).toMatch(/Fourteen-axis review/);
    });

    it("reviewer.ts does NOT regress its canonical opening to a lower count", () => {
      expect(REVIEWER_PROMPT).not.toMatch(/Eleven-axis review/);
      expect(REVIEWER_PROMPT).not.toMatch(/Twelve-axis review/);
      expect(REVIEWER_PROMPT).not.toMatch(/Thirteen-axis review/);
    });

    it("investigator.ts post-mortem section cites the 14-axis reviewer surface", () => {
      expect(INVESTIGATOR_PROMPT).toMatch(/14-axis/);
      expect(INVESTIGATOR_PROMPT).not.toMatch(
        /specific 11-axis finding|specific 12-axis finding|specific 13-axis finding/
      );
    });
  });

  describe("triage field-count contract — both narratives (sub-agent core 5 vs orchestrator-stamped 8) stay coherent", () => {
    const TRIAGE_PROMPT = readFileSync(
      path.join(REPO_ROOT, "src/content/specialist-prompts/triage.ts"),
      "utf8"
    );
    const START_COMMAND = readFileSync(
      path.join(REPO_ROOT, "src/content/start-command.ts"),
      "utf8"
    );

    it(`triage sub-agent contract pins "exactly five fields" as the core decision surface (count = ${TRIAGE_FIELDS_CORE})`, () => {
      expect(TRIAGE_PROMPT).toMatch(/exactly five fields/i);
    });

    it(`orchestrator stamps the aggregated "eight-field" decision (count = ${TRIAGE_FIELDS_AGGREGATE})`, () => {
      expect(START_COMMAND).toMatch(/eight-field/);
    });

    it("no stale mid-band field-count claim (6/7/9/10-field) outside historical context in start-command.ts", () => {
      const STALE_FIELD_LABELS = [
        "six-field decision",
        "6-field decision",
        "seven-field decision",
        "7-field decision",
        "nine-field decision",
        "9-field decision",
        "ten-field decision",
        "10-field decision"
      ];
      for (const stale of STALE_FIELD_LABELS) {
        const idx = START_COMMAND.toLowerCase().indexOf(stale.toLowerCase());
        if (idx >= 0) {
          const context = START_COMMAND.slice(
            Math.max(0, idx - CONTEXT_WINDOW),
            idx + stale.length + CONTEXT_WINDOW
          );
          if (!isHistoricalContext(context)) {
            throw new Error(
              `start-command.ts contains stale "${stale}" outside historical context. ` +
                `Context: …${context.replace(/\n/g, " ⏎ ").trim()}…`
            );
          }
        }
      }
    });
  });

  describe("meta — the regex tripwire is robust to historical narrative", () => {
    function scanSynthetic(synth: string): string[] {
      const hits: string[] = [];
      for (const rule of RULES) {
        const re = new RegExp(rule.pattern.source, rule.pattern.flags);
        let m: RegExpExecArray | null;
        while ((m = re.exec(synth)) !== null) {
          const num = numberFromToken(m[1]);
          if (num === null) continue;
          if (num === rule.canonical) continue;
          const ctx = synth.slice(
            Math.max(0, m.index - CONTEXT_WINDOW),
            m.index + m[0].length + CONTEXT_WINDOW
          );
          if (!isHistoricalContext(ctx)) hits.push(m[0]);
        }
      }
      return hits;
    }

    it("does NOT flag `v8.85 bumped to 13 axes; v8.86 lifted to 14`", () => {
      expect(
        scanSynthetic("v8.85 bumped to 13 axes; v8.86 lifted to 14.")
      ).toEqual([]);
    });

    it("does NOT flag `previously eleven-axis pass`", () => {
      expect(scanSynthetic("previously eleven-axis pass.")).toEqual([]);
    });

    it("does NOT flag the legit ambiguity-signals phrase `four axes triage's ambiguity score signals named`", () => {
      // "four axes" by itself is too generic to be a reviewer-axis
      // claim; the tightened tripwire only matches when followed by
      // a reviewer-axis qualifier (review/pass/check/etc.).
      expect(
        scanSynthetic(
          "the four axes triage's ambiguity-score signals named when they applied"
        )
      ).toEqual([]);
    });

    it("DOES flag `the reviewer applies the eleven-axis check`", () => {
      const hits = scanSynthetic(
        "The reviewer applies the eleven-axis check on every diff."
      );
      expect(hits.length).toBeGreaterThan(0);
    });

    it("DOES flag `the reviewer's twelve-axis pass`", () => {
      const hits = scanSynthetic(
        "Concretely, the reviewer's twelve-axis pass would have caught it."
      );
      expect(hits.length).toBeGreaterThan(0);
    });

    it("DOES flag `5 research-only lens contracts`", () => {
      const hits = scanSynthetic("Ships 5 research-only lens contracts.");
      expect(hits.length).toBeGreaterThan(0);
    });

    it("DOES flag `9 sub-agents`", () => {
      const hits = scanSynthetic("The roster has 9 sub-agents.");
      expect(hits.length).toBeGreaterThan(0);
    });
  });
});
