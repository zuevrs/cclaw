import { defineConfig } from "vitest/config";

const isWindows = process.platform === "win32";

export default defineConfig({
  test: {
    environment: "node",
    ...(isWindows ? { testTimeout: 30_000 } : {}),
    include: ["tests/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "text-summary", "html", "lcov", "json-summary"],
      reportsDirectory: "coverage",
      clean: true,
      all: true,
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.d.ts", "src/types.ts", "scripts/**"],
      thresholds: {
        lines: 60,
        statements: 60,
        functions: 60,
        branches: 50,
        perFile: false
      }
    }
  }
});
