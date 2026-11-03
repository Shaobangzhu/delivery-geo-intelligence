import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, searchForWorkspaceRoot } from "vite";
import react from "@vitejs/plugin-react";

const require = createRequire(import.meta.url);
// CSS url() assets are not JS imports. Allow only the SDK's theme fonts when
// node_modules resolves through a dependency cache outside the workspace.
const arcgisThemeFonts = resolve(dirname(require.resolve("@arcgis/core/assets/esri/themes/light/main.css")), "../base/fonts/fonts");

export default defineConfig(({ mode }) => ({
  // Credential-free verification; ordinary app builds still load their env files.
  envDir: mode === "quality" ? false : undefined,
  plugins: [react()],
  server: {
    port: 5173,
    fs: { allow: [searchForWorkspaceRoot(fileURLToPath(new URL(".", import.meta.url))), arcgisThemeFonts] },
    proxy: { "/api": "http://127.0.0.1:3000" }
  }
}));
