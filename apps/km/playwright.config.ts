import path from "path";
import { defineConfig } from "@playwright/test";

// The suite runs against a deployed preview only. There is no local default
// and no webServer: the app is never started from here.
const baseURL = process.env.E2E_BASE_URL;
if (!baseURL) {
  throw new Error("E2E_BASE_URL is not set. Point it at a preview deployment of the branch under test.");
}

// Both locations are gitignored. Screenshots live outside outputDir, which
// Playwright empties at the start of every run.
export const AUTH_STATE = path.join(__dirname, "test-results/notes-panel-auth.json");
export const SCREENSHOT_DIR = path.join(__dirname, "playwright-report/notes-panel");

export default defineConfig({
  testDir: "e2e/notes-panel",
  outputDir: "test-results/notes-panel",
  timeout: 180_000,
  expect: { timeout: 10_000 },
  workers: 4,
  reporter: [["list"]],
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "setup", testMatch: /auth\.setup\.ts/ },
    {
      name: "notes-panel",
      testMatch: /\.spec\.ts/,
      dependencies: ["setup"],
      use: { storageState: AUTH_STATE },
    },
  ],
});
