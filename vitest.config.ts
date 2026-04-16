import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "text-summary", "html", "lcov", "json-summary"],
      reportsDirectory: "coverage",
      clean: true,
      all: true,
      include: ["src/**/*.ts"],
      exclude: [
        "src/**/*.d.ts",
        "src/types.ts",
        "src/cli.ts",
        "src/content/**",
        "scripts/**"
      ],
      thresholds: {
        lines: 78,
        statements: 78,
        functions: 82,
        branches: 72,
        perFile: false,
        "src/artifact-linter.ts": {
          lines: 75,
          statements: 75,
          functions: 85,
          branches: 75
        },
        "src/flow-state.ts": {
          lines: 94,
          statements: 94,
          functions: 95,
          branches: 80
        },
        "src/runs.ts": {
          lines: 80,
          statements: 80,
          functions: 90,
          branches: 72
        },
        "src/gate-evidence.ts": {
          lines: 85,
          statements: 85,
          functions: 95,
          branches: 70
        },
        "src/policy.ts": {
          lines: 92,
          statements: 92,
          functions: 95,
          branches: 80
        }
      }
    }
  }
});
