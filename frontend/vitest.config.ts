import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

process.env.TZ = "UTC";

export default defineConfig({
  envDir: false,
  plugins: [react()],
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    clearMocks: true,
    maxWorkers: 2,
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
