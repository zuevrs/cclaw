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

// Map of testId -> { name, file, coveredMutants, killedMutants }
const testIdToInfo = new Map();
for (const [filePath, fileTests] of Object.entries(tests)) {
  for (const t of fileTests.tests ?? []) {
    testIdToInfo.set(t.id, {
      id: t.id,
      name: t.name,
      file: filePath,
      covered: 0,
      killed: 0
    });
  }
}

// Walk mutants, attributing coveredBy and killedBy
for (const file of Object.values(files)) {
  for (const m of file.mutants ?? []) {
    for (const tid of m.coveredBy ?? []) {
      const info = testIdToInfo.get(tid);
      if (info) info.covered += 1;
    }
    for (const tid of m.killedBy ?? []) {
      const info = testIdToInfo.get(tid);
      if (info) info.killed += 1;
    }
  }
}

// Aggregate by file
const byFile = new Map();
for (const info of testIdToInfo.values()) {
  if (!byFile.has(info.file)) {
    byFile.set(info.file, {
      file: info.file,
      tests: 0,
      coveredTotal: 0,
      killedTotal: 0,
      uselessTests: 0,
      coveringTests: 0,
      coveringUselessTests: 0,
      examples: []
    });
  }
  const agg = byFile.get(info.file);
  agg.tests += 1;
  agg.coveredTotal += info.covered;
  agg.killedTotal += info.killed;
  if (info.covered > 0) {
    agg.coveringTests += 1;
    if (info.killed === 0) {
      agg.uselessTests += 1;
      agg.coveringUselessTests += 1;
      if (agg.examples.length < 5) agg.examples.push(info.name);
    }
  } else if (info.killed === 0) {
    // Test that doesn't even cover any mutant in scope — irrelevant noise
  }
}

const files_sorted = [...byFile.values()].sort(
  (a, b) =>
    b.coveringUselessTests - a.coveringUselessTests || b.tests - a.tests
);

console.log("FILE  TESTS  COVERING  USELESS-OF-COVERING  COVERED-MUT  KILLED-MUT");
for (const agg of files_sorted) {
  const pct =
    agg.coveringTests === 0
      ? "—"
      : ((100 * agg.coveringUselessTests) / agg.coveringTests).toFixed(0) + "%";
  console.log(
    `${agg.file}\t${agg.tests}\t${agg.coveringTests}\t${agg.coveringUselessTests} (${pct})\t${agg.coveredTotal}\t${agg.killedTotal}`
  );
}

// Now list test files where ALL covering tests are useless (100% useless)
console.log("\n=== FILES WITH 100% USELESS COVERING TESTS ===");
for (const agg of files_sorted) {
  if (agg.coveringTests > 0 && agg.coveringUselessTests === agg.coveringTests) {
    console.log(`${agg.file}  (${agg.tests} tests, ${agg.coveringTests} cover but ZERO kill)`);
  }
}

console.log("\n=== FILES WHERE >75% OF COVERING TESTS ARE USELESS ===");
for (const agg of files_sorted) {
  if (
    agg.coveringTests >= 3 &&
    agg.coveringUselessTests / agg.coveringTests >= 0.75
  ) {
    console.log(
      `${agg.file}\t${agg.coveringUselessTests}/${agg.coveringTests} useless`
    );
  }
}

console.log("\n=== TEST-FILE-LEVEL KILL EFFICIENCY (covering tests) ===");
for (const agg of files_sorted) {
  if (agg.coveringTests === 0) continue;
  const eff = ((agg.killedTotal / Math.max(1, agg.coveredTotal)) * 100).toFixed(0);
  console.log(
    `${agg.file}\tcovers=${agg.coveredTotal}\tkilled=${agg.killedTotal}\teff=${eff}%`
  );
}
