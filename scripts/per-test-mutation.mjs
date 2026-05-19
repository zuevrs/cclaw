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

const testIdToInfo = new Map();
for (const [filePath, fileTests] of Object.entries(tests)) {
  for (const t of fileTests.tests ?? []) {
    testIdToInfo.set(t.id, {
      id: t.id,
      name: t.name,
      file: filePath,
      covered: 0,
      killed: 0,
      coveredFiles: new Set(),
      killedFiles: new Set()
    });
  }
}

for (const [srcFile, file] of Object.entries(files)) {
  for (const m of file.mutants ?? []) {
    for (const tid of m.coveredBy ?? []) {
      const info = testIdToInfo.get(tid);
      if (info) {
        info.covered += 1;
        info.coveredFiles.add(srcFile);
      }
    }
    for (const tid of m.killedBy ?? []) {
      const info = testIdToInfo.get(tid);
      if (info) {
        info.killed += 1;
        info.killedFiles.add(srcFile);
      }
    }
  }
}

const focusFile = process.argv[3];
if (focusFile) {
  console.log(`=== Per-test breakdown for ${focusFile} ===`);
  const rows = [...testIdToInfo.values()]
    .filter((t) => t.file === focusFile)
    .sort((a, b) => a.killed - b.killed || b.covered - a.covered);
  for (const r of rows) {
    console.log(
      `  cov=${r.covered}\tkill=${r.killed}\t${r.name.substring(0, 120)}`
    );
  }
  process.exit(0);
}

// Dump every USELESS test (covers but doesn't kill)
console.log("=== USELESS TESTS (cover scoped mutants, kill nothing) ===");
const useless = [...testIdToInfo.values()].filter(
  (t) => t.covered > 0 && t.killed === 0
);
useless.sort((a, b) => a.file.localeCompare(b.file) || b.covered - a.covered);
for (const t of useless) {
  console.log(`${t.file}\tcov=${t.covered}\t${t.name.substring(0, 110)}`);
}
console.log(`Total useless: ${useless.length}`);
