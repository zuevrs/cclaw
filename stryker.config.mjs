const config = {
  testRunner: "vitest",
  coverageAnalysis: "perTest",
  mutate: [
    "src/flow-state.ts",
    "src/delegation.ts",
    "src/tdd-cycle.ts",
    "src/retro-gate.ts"
  ],
  testFiles: [
    "tests/unit/flow-state.test.ts",
    "tests/unit/flow-tracks.test.ts",
    "tests/unit/delegation.test.ts",
    "tests/unit/tdd-cycle.test.ts",
    "tests/unit/runs.test.ts"
  ],
  ignorePatterns: ["docs/references/**"],
  reporters: ["clear-text", "progress", "html"],
  thresholds: {
    high: 95,
    low: 85,
    break: 0
  },
  vitest: {
    related: true
  }
};

export default config;
