import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Separate artifact: never replace the SDK in a normal production build.
export default defineConfig({
  envDir: false,
  plugins: [react()],
  define: {
    "import.meta.env.VITE_ARCGIS_API_KEY": JSON.stringify("synthetic-e2e-only"),
    "import.meta.env.VITE_DGI_HOME_LONGITUDE": JSON.stringify(""),
    "import.meta.env.VITE_DGI_HOME_LATITUDE": JSON.stringify("")
  },
  resolve: { alias: { "./arcgisRuntime": fileURLToPath(new URL("../e2e/arcgis-runtime.mjs", import.meta.url)) } },
  build: { outDir: "dist-e2e" },
  preview: { host: "127.0.0.1", port: 4311, strictPort: true, proxy: { "/api": "http://127.0.0.1:4310" } }
});
