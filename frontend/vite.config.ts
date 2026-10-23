import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => ({
  // Credential-free verification; ordinary app builds still load their env files.
  envDir: mode === "quality" ? false : undefined,
  plugins: [react()],
  server: {
    port: 5173,
    proxy: { "/api": "http://127.0.0.1:3000" }
  }
}));
