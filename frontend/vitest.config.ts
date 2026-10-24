import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

process.env.TZ = "UTC";

export default defineConfig({
  envDir: false,
  plugins: [react()],
  test: {
    environment: "jsdom",
    setupFiles: ["allure-vitest/setup", "./src/test/setup.ts"],
    clearMocks: true,
    maxWorkers: 2,
    reporters: ["default", ["junit", { outputFile: "../reports/frontend.xml" }], ["allure-vitest/reporter", {
      resultsDir: fileURLToPath(new URL(`../artifacts/.allure-raw/frontend/${process.env.DGI_ALLURE_SCOPE === "coverage" ? "coverage" : "unit"}`, import.meta.url)),
      reportMatchers: false
    }]],
    coverage: {
      provider: "v8",
      include: ["src/**/*.{ts,tsx}"],
      exclude: ["src/**/*.test.{ts,tsx}", "src/test/**"],
      reporter: ["text", "json", "json-summary", "lcov", "html"],
      reportsDirectory: "coverage",
      clean: true
    }
  }
});
