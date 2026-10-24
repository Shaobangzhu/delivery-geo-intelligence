import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  testMatch: "**/*.spec.ts",
  fullyParallel: false,
  workers: 1, // One fixture database; each attempt resets it before using the UI.
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  failOnFlakyTests: true, // A passing retry provides diagnostics, never a green gate.
  timeout: 30_000,
  globalTimeout: 300_000,
  expect: { timeout: 8_000 },
  outputDir: "reports/e2e/results",
  reporter: [
    ["list"], ["html", { outputFolder: "reports/e2e/html", open: "never" }],
    ["json", { outputFile: "reports/e2e/results.json" }],
    ["junit", { outputFile: "reports/e2e/junit.xml" }],
    ["allure-playwright", { resultsDir: "artifacts/.allure-raw/e2e/chromium", detail: false, suiteTitle: true }]
  ],
  metadata: { dataset: "synthetic-only-v1", providers: "offline", map: "SDK contract adapter", fixtureTime: "2026-03-08T20:00:00.000Z" },
  use: {
    baseURL: "http://127.0.0.1:4311", headless: true,
    locale: "en-US", timezoneId: "America/Los_Angeles",
    serviceWorkers: "block", trace: "retain-on-failure", screenshot: "only-on-failure", video: "off",
    actionTimeout: 8_000, navigationTimeout: 15_000
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    { command: "npm run e2e:backend", url: "http://127.0.0.1:4310/__e2e/ready", reuseExistingServer: false, timeout: 120_000,
      env: { OPENAI_API_KEY: "", ARCGIS_GEOCODING_API_KEY: "", MONGODB_URI: "", NODE_ENV: "test" },
      gracefulShutdown: { signal: "SIGTERM", timeout: 10_000 } },
    { command: "npm run e2e:frontend", url: "http://127.0.0.1:4311", reuseExistingServer: false, timeout: 120_000,
      env: { VITE_ARCGIS_API_KEY: "", VITE_DGI_HOME_LONGITUDE: "", VITE_DGI_HOME_LATITUDE: "" },
      gracefulShutdown: { signal: "SIGTERM", timeout: 5_000 } }
  ]
});
