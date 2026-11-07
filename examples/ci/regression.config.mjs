import { defineConfig } from "@playwright/test";
import { resolve } from "node:path";
export default defineConfig({
  // Execution reports must not collect source patches or commit author data.
  captureGitInfo: { commit: false, diff: false },
  testDir: resolve(process.env.JP_DEMO_WORKSPACE, "tests/generated"),
  testMatch: process.env.JP_SPEC_NAME,
  workers: 1,
  retries: 0,
  timeout: 60000,
  reporter: "json",
  outputDir: resolve(process.env.JP_DEMO_WORKSPACE, ".journeyproof/playwright"),
});
