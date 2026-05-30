/** @type {import('@stryker-mutator/api/core').PartialStrykerOptions} */
const config = {
  testRunner: "vitest",
  reporters: ["html", "clear-text", "progress", "json"],
  coverageAnalysis: "perTest",
  // v8.101 — mutation testing scope. Stryker is wired as a dev tool to
  // canary specific src modules; default scope is the highest-leverage
  // wiring/parser modules. Override on CLI with `--mutate '<glob>'` to
  // expand scope on demand.
  mutate: [
    "src/flow-state.ts",
    "src/cli.ts",
    "src/install.ts",
    "src/harness-prompt.ts"
  ],
  vitest: {
    configFile: "vitest.config.ts"
  },
  thresholds: { high: 80, low: 60, break: null },
  timeoutMS: 60000,
  concurrency: 4
};

export default config;
