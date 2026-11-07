import { defineConfig } from "@playwright/test";
export default defineConfig({
  // Execution reports must not collect source patches or commit author data.
  captureGitInfo: { commit: false, diff: false },
  testDir: "tests/e2e",
  timeout: 60000,
  workers: 1,
  fullyParallel: false,
  reporter: "list",
});
