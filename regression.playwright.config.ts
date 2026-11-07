import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "tests/generated",
  testMatch: process.env.JP_SPEC_NAME ?? "admissions-*.spec.ts",
  workers: 1,
  retries: 0,
  timeout: 60000,
  reporter: "json",
  outputDir: ".journeyproof/regression-demo/playwright",
});
