#!/usr/bin/env node
import fs from "node:fs";

const report = JSON.parse(
  fs.readFileSync(
    process.argv[2] ?? "reports/mutation/mutation.json",
    "utf8"
  )
);

const tests = report.testFiles ?? {};
const files = report.files ?? {};
const scopedFiles = new Set(Object.keys(files));

const testIdToInfo = new Map();
for (const [filePath, fileTests] of Object.entries(tests)) {
  for (const t of fileTests.tests ?? []) {
    testIdToInfo.set(t.id, {
      id: t.id,
      name: t.name,
      file: filePath,
      covered: 0,
      killed: 0,
      coverByFile: {}
    });
  }
}

for (const [srcFile, file] of Object.entries(files)) {
  for (const m of file.mutants ?? []) {
    for (const tid of m.coveredBy ?? []) {
      const info = testIdToInfo.get(tid);
      if (info) {
        info.covered += 1;
        info.coverByFile[srcFile] = (info.coverByFile[srcFile] ?? 0) + 1;
      }
    }
    for (const tid of m.killedBy ?? []) {
      const info = testIdToInfo.get(tid);
      if (info) info.killed += 1;
    }
  }
}

// Show useless tests grouped by their PRIMARY scoped target.
// "Primary target" = scoped file with the most coverage from this test.
const useless = [...testIdToInfo.values()].filter(
  (t) => t.covered > 0 && t.killed === 0
);

// Compute primary scope per test
for (const t of useless) {
  const entries = Object.entries(t.coverByFile);
  entries.sort((a, b) => b[1] - a[1]);
  t.primary = entries[0]?.[0] ?? "?";
  t.primaryCount = entries[0]?.[1] ?? 0;
}

// Per primary-source-file: list useless tests by test file
const byPrimary = new Map();
for (const t of useless) {
  if (!byPrimary.has(t.primary)) byPrimary.set(t.primary, []);
  byPrimary.get(t.primary).push(t);
}

for (const [src, ts] of byPrimary) {
  console.log(`\n## Primary target: ${src}  (${ts.length} useless tests)`);
  ts.sort((a, b) => b.primaryCount - a.primaryCount);
  for (const t of ts) {
    console.log(
      `  primary=${t.primaryCount}  total=${t.covered}  ${t.file}::${t.name.substring(0, 90)}`
    );
  }
}
