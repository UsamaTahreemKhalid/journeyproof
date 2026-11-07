import { defineConfig } from "@playwright/test";
export default defineConfig({
  // Execution reports must not collect source patches or commit author data.
  captureGitInfo: { commit: false, diff: false },
  testDir: "tests/generated",
  testMatch: process.env.JP_SPEC_NAME ?? "admissions-*.spec.ts",
  workers: 1,
  retries: 0,
  timeout: 60000,
  reporter: "json",
  outputDir: ".journeyproof/regression-demo/playwright",
});
