import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

process.env.TZ = "UTC";

export default defineConfig({
  envDir: false,
  // Cached node_modules may be symlinked outside the workspace. Allure's
  // injected setup/runner must remain reachable through Vite's filesystem gate.
  server: { fs: { allow: [
    fileURLToPath(new URL("..", import.meta.url)),
    realpathSync(fileURLToPath(new URL("../node_modules", import.meta.url))),
    realpathSync(fileURLToPath(new URL("./node_modules", import.meta.url)))
  ] } },
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
