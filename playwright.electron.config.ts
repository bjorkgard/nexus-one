import { defineConfig } from "@playwright/test";

// Runs against the packaged app (`vp run pack` first); no dev server starts.
export default defineConfig({
  testDir: "e2e",
  testMatch: /packaged\.spec\.ts/,
  fullyParallel: false,
  forbidOnly: true,
  retries: 0,
  reporter: [["list"]],
  timeout: 60_000,
});
