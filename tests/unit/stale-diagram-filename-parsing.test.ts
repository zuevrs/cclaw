import { describe, expect, it } from "vitest";
import {
  collectCodebaseInvestigationFiles,
  normalizeCodebaseInvestigationFileRef
} from "../../src/artifact-linter/design.js";

/**
 * Wave 25 (v6.1.0) — Stale Diagram Audit filename parsing.
 *
 * The user's quick-tier 3-file landing page test made the audit
 * call `fs.stat("index.html (new)")` (with the literal " (new)"
 * suffix) and fail with
 * `Stale Diagram Audit could not read blast-radius file(s): index.html (new)`.
 * The agent had to `touch` placeholder files just to silence the
 * audit. Wave 25 rewrites the parser so:
 *
 *   - parenthetical suffixes are stripped before stat
 *   - `(new)` / `(new file)` flags the row as "no stale diagram"
 *   - `(skip)` / `(deleted)` / `(stub)` / `(removed)` / `(placeholder)`
 *     / `(tbd)` / `(n/a)` flags the row as skipped
 *   - a leading `#` on the filename column also marks the row skipped
 *   - a `skip:` token anywhere in the Notes column also marks it
 */

describe("Wave 25 — normalizeCodebaseInvestigationFileRef", () => {
  it("strips a `(new)` suffix and marks the row as a new file", () => {
    const ref = normalizeCodebaseInvestigationFileRef("index.html (new)", "");
    expect(ref).not.toBeNull();
    expect(ref?.filename).toBe("index.html");
    expect(ref?.newFile).toBe(true);
    expect(ref?.skip).toBe(false);
  });

  it("strips `(new file)` (with space) and marks the row as new", () => {
    const ref = normalizeCodebaseInvestigationFileRef("styles.css (new file)", "");
    expect(ref?.filename).toBe("styles.css");
    expect(ref?.newFile).toBe(true);
  });

  it("strips `(deleted)` and marks the row as skipped", () => {
    const ref = normalizeCodebaseInvestigationFileRef("legacy/old.ts (deleted)", "");
    expect(ref?.filename).toBe("legacy/old.ts");
    expect(ref?.skip).toBe(true);
    expect(ref?.newFile).toBe(false);
  });

  it("strips `(stub)`, `(placeholder)`, `(tbd)`, `(n/a)` as skip markers", () => {
    for (const suffix of ["stub", "placeholder", "tbd", "n/a", "removed", "skipped", "skip"]) {
      const ref = normalizeCodebaseInvestigationFileRef(`pkg/file.ts (${suffix})`, "");
      expect(ref?.filename).toBe("pkg/file.ts");
      expect(ref?.skip).toBe(true);
    }
  });

  it("strips stacked suffixes and applies all markers (e.g. `(new) (stub)`)", () => {
    const ref = normalizeCodebaseInvestigationFileRef("scripts/migrate.ts (new) (stub)", "");
    expect(ref?.filename).toBe("scripts/migrate.ts");
    expect(ref?.newFile).toBe(true);
    expect(ref?.skip).toBe(true);
  });

  it("treats a leading `#` on the filename as a skip marker", () => {
    const ref = normalizeCodebaseInvestigationFileRef("# legacy/file.ts", "");
    expect(ref?.filename).toBe("legacy/file.ts");
    expect(ref?.skip).toBe(true);
  });

  it("treats a `skip:` token in the Notes column as a skip marker", () => {
    const ref = normalizeCodebaseInvestigationFileRef("src/api.ts", "skip: legacy module pending removal");
    expect(ref?.filename).toBe("src/api.ts");
    expect(ref?.skip).toBe(true);
  });

  it("returns null for clearly empty / placeholder cells", () => {
    expect(normalizeCodebaseInvestigationFileRef("", "")).toBeNull();
    expect(normalizeCodebaseInvestigationFileRef("file", "")).toBeNull();
    expect(normalizeCodebaseInvestigationFileRef("n/a", "")).toBeNull();
    expect(normalizeCodebaseInvestigationFileRef("none", "")).toBeNull();
    expect(normalizeCodebaseInvestigationFileRef("(none)", "")).toBeNull();
    expect(normalizeCodebaseInvestigationFileRef("tbd", "")).toBeNull();
    expect(normalizeCodebaseInvestigationFileRef("?", "")).toBeNull();
  });

  it("strips backticks and leading list markers", () => {
    const ref = normalizeCodebaseInvestigationFileRef("- `src/api.ts` (new)", "");
    expect(ref?.filename).toBe("src/api.ts");
    expect(ref?.newFile).toBe(true);
  });

  it("preserves filenames with no parenthetical suffix as plain refs", () => {
    const ref = normalizeCodebaseInvestigationFileRef("src/api.ts", "");
    expect(ref?.filename).toBe("src/api.ts");
    expect(ref?.newFile).toBe(false);
    expect(ref?.skip).toBe(false);
  });
});

describe("Wave 25 — collectCodebaseInvestigationFiles deduplicates and respects markers", () => {
  it("collects and deduplicates rows from a Codebase Investigation table", () => {
    const body = [
      "| File | Current responsibility | Patterns discovered |",
      "|---|---|---|",
      "| index.html (new) | landing page | static HTML |",
      "| styles.css (new file) | global stylesheet | CSS variables |",
      "| theme.js (new) | toggle theme | DOM querySelector |",
      "| # legacy/old.ts | legacy module | not in current scope |",
      "| docs/notes.md | meta notes | markdown skip: archive |"
    ].join("\n");
    const refs = collectCodebaseInvestigationFiles(body);
    const names = refs.map((r) => r.filename);
    expect(names).toEqual(
      expect.arrayContaining(["index.html", "styles.css", "theme.js", "legacy/old.ts", "docs/notes.md"])
    );
    const indexHtml = refs.find((r) => r.filename === "index.html");
    expect(indexHtml?.newFile).toBe(true);
    const themeJs = refs.find((r) => r.filename === "theme.js");
    expect(themeJs?.newFile).toBe(true);
    const legacy = refs.find((r) => r.filename === "legacy/old.ts");
    expect(legacy?.skip).toBe(true);
    const notes = refs.find((r) => r.filename === "docs/notes.md");
    expect(notes?.skip).toBe(true);
  });

  it("returns an empty array for an empty body", () => {
    expect(collectCodebaseInvestigationFiles("")).toEqual([]);
  });
});
