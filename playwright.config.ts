import { defineConfig, devices } from "@playwright/test";

/**
 * Stage 3C authenticated Playwright configuration.
 *
 * Two viewport projects (390 mobile, 1280 desktop) share the same specs;
 * both must run to pass Stage 3C runtime verification. Base URL comes
 * from PLAYWRIGHT_BASE_URL (set by the GitHub Actions workflow after
 * the app is up on the runner). Auth fixtures are provisioned per-test
 * against the disposable local Supabase started by the workflow.
 */
export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 60_000,
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"], ["html", { open: "never" }], ["json", { outputFile: "reports/playwright.json" }]],
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
  },
  projects: [
    {
      name: "mobile-390",
      use: { ...devices["Pixel 5"], viewport: { width: 390, height: 844 } },
    },
    {
      name: "desktop-1280",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 900 } },
    },
  ],
});
