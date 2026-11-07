import { defineConfig } from "vitest/config";
import { playwright } from "@vitest/browser-playwright";
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "node",
          include: [
            "tests/unit/**/*.test.ts",
            "tests/beta/**/*.test.ts",
            "tests/regression/**/*.test.ts",
            "tests/integration/**/*.test.ts",
            "tests/mcp/**/*.test.ts",
            "tests/skill/**/*.test.ts",
            "tests/map/**/*.test.ts",
          ],
          testTimeout: 30000,
        },
      },
      {
        test: {
          name: "viewer",
          include: ["tests/viewer/**/*.browser.test.ts"],
          browser: {
            enabled: true,
            provider: playwright(),
            headless: true,
            instances: [{ browser: "chromium" }],
          },
        },
      },
    ],
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: ["src/cli/bin.ts", "src/index.ts"],
      reporter: ["text", "json-summary", "html"],
      thresholds: { statements: 85, branches: 80, functions: 85, lines: 85 },
    },
  },
});
