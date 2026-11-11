// @vitest-environment node
import { expect, it } from "vitest";
import { createRequire } from "node:module";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

it("pins the registry artifact and imports its explicit CSS only at the entry boundary", () => {
  const root = fileURLToPath(new URL("../../../", import.meta.url));
  const manifest = JSON.parse(readFileSync(join(root, "frontend/package.json"), "utf8"));
  const lock = JSON.parse(readFileSync(join(root, "package-lock.json"), "utf8"));
  expect(manifest.dependencies["@shaobangzhu/clu-ui"]).toBe("0.1.0-rc.2");
  expect(lock.packages["node_modules/@shaobangzhu/clu-ui"]).toMatchObject({
    version: "0.1.0-rc.2",
    resolved: "https://registry.npmjs.org/@shaobangzhu/clu-ui/-/clu-ui-0.1.0-rc.2.tgz",
    integrity: "sha512-hUiMBqXdzu6OUtRZoLN8PqV3ekp2yAz3y5QCtgo4KzYmKYJSWCI+cjuZf0ciyhzcWEpF2I3uhvq+VtigDX7doA=="
  });
  const imports: string[] = [];
  function inspect(directory: string) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) inspect(path);
      else if (/\.(?:tsx?|css)$/.test(entry.name) && !entry.name.includes(".test.")) {
        const matches = readFileSync(path, "utf8").match(/(?:import\s*["']|@import\s*["'])@shaobangzhu\/clu-ui\/styles\.css["']/g) ?? [];
        imports.push(...matches.map(() => path));
      }
    }
  }
  inspect(join(root, "frontend/src"));
  expect(imports).toEqual([join(root, "frontend/src/main.tsx")]);
  const require = createRequire(import.meta.url);
  expect(require.resolve("@shaobangzhu/clu-ui/styles.css")).toMatch(/dist\/styles\.css$/);
});
