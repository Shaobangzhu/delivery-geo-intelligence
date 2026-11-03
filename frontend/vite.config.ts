import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, searchForWorkspaceRoot } from "vite";
import react from "@vitejs/plugin-react";

const require = createRequire(import.meta.url);
// CSS url() assets are not JS imports. Allow only the SDK's theme fonts when
// node_modules resolves through a dependency cache outside the workspace.
const arcgisThemeFonts = resolve(dirname(require.resolve("@arcgis/core/assets/esri/themes/light/main.css")), "../base/fonts/fonts");
// Cached SDK JS can skip a new server's import analysis, but its CSS is
// revalidated. Resolve ArcGIS's Calcite copy and allow this one stylesheet up front.
const arcgisRequire = createRequire(require.resolve("@arcgis/core/package.json"));
const calciteStylesheet = arcgisRequire.resolve("@esri/calcite-components/main.css");

export default defineConfig(({ mode }) => ({
  // Credential-free verification; ordinary app builds still load their env files.
  envDir: mode === "quality" ? false : undefined,
  plugins: [react()],
  server: {
    port: 5173,
    fs: { allow: [searchForWorkspaceRoot(fileURLToPath(new URL(".", import.meta.url))), arcgisThemeFonts, calciteStylesheet] },
    proxy: { "/api": "http://127.0.0.1:3000" }
  }
}));
