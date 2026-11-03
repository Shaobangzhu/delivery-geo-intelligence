// @vitest-environment node
import { afterEach, expect, it } from "vitest";
import { createServer, searchForWorkspaceRoot, type ViteDevServer } from "vite";
import { createRequire } from "node:module";
import { get } from "node:http";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import config from "../../vite.config";

let server: ViteDevServer | undefined;
const directories: string[] = [];
afterEach(async () => {
  await server?.close();
  server = undefined;
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

function request(url: string): Promise<{ status: number; type: string | undefined }> {
  return new Promise((resolve, reject) => {
    get(url, (response) => {
      response.resume();
      response.on("end", () => resolve({ status: response.statusCode!, type: response.headers["content-type"] }));
    }).on("error", reject);
  });
}

it.each([
  { scope: "normal workspace access", assetsOnly: false },
  { scope: "SDK asset exceptions only", assetsOnly: true }
])("serves SDK assets before importer analysis with $scope", async ({ assetsOnly }) => {
  const frontend = fileURLToPath(new URL("../../", import.meta.url));
  const outside = await mkdtemp(join(tmpdir(), "dgi-font-boundary-"));
  const inside = await mkdtemp(join(frontend, "../reports/font-boundary-"));
  directories.push(outside, inside);
  await writeFile(join(outside, "private.txt"), "synthetic private content");
  await writeFile(join(inside, ".env.synthetic"), "SYNTHETIC_SECRET=private");
  const workspaceRuntime = join(inside, "runtime.js");
  await writeFile(workspaceRuntime, "export const synthetic = true;");
  const options = typeof config === "function" ? await config({ command: "serve", mode: "quality" }) : config;
  const workspace = searchForWorkspaceRoot(frontend);
  const allow = options.server?.fs?.allow;
  if (!allow?.includes(workspace)) throw new Error("Expected explicit workspace and SDK filesystem allowances");
  // CI installs dependencies inside the workspace; local caches can be outside.
  // Remove the workspace grant in the SDK-only case to test its exceptions alone,
  // independently of where npm installed the actual package files.
  const fs = assetsOnly ? { ...options.server?.fs,
    allow: allow.filter((allowed) => allowed !== workspace) } : options.server?.fs;
  server = await createServer({ ...options, configFile: false, root: frontend,
    cacheDir: join(outside, "optimizer"), optimizeDeps: { noDiscovery: true, include: [] }, logLevel: "silent",
    server: { ...options.server, fs, host: "127.0.0.1", port: 0 } });
  await server.listen();
  const address = server.httpServer!.address();
  if (!address || typeof address === "string") throw new Error("Expected local HTTP server");
  const base = `http://127.0.0.1:${address.port}/@fs`;
  const require = createRequire(import.meta.url);
  const arcgisRequire = createRequire(require.resolve("@arcgis/core/package.json"));
  const calciteCss = arcgisRequire.resolve("@esri/calcite-components/main.css");
  // A warm browser can reuse immutable SDK JavaScript after Vite restarts.
  // CSS must load before import analysis has registered its external path.
  expect((await request(base + calciteCss)).status).toBe(200);
  if (assetsOnly) {
    const calciteRuntime = join(dirname(calciteCss), "../chunks/runtime.js");
    expect((await request(base + calciteRuntime)).status).toBe(403);
  }
  expect((await request(base + workspaceRuntime)).status).toBe(assetsOnly ? 403 : 200);
  for (const font of ["09ab0626-bb45-4650-acc8-0182d693df02", "b8b15cdf-85d1-4120-8daa-48863d803939"]) {
    const path = require.resolve(`@arcgis/core/assets/esri/themes/base/fonts/fonts/${font}.woff2`);
    expect(await request(base + path)).toMatchObject({ status: 200, type: "font/woff2" });
  }
  expect(server.config.server.fs.strict).toBe(true);
  expect((await request(base + join(outside, "private.txt"))).status).toBe(403);
  expect((await request(base + join(inside, ".env.synthetic"))).status).toBe(403);
});
