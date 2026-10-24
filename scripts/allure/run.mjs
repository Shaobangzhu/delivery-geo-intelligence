import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { root, prepareResults, collectBatch } from "./results.mjs";

const [layer, execution, ...args] = process.argv.slice(2);
const config = layer === "frontend" ? { cwd: join(root, "frontend"), pkg: "vitest/package.json", cli: "vitest.mjs" }
  : layer === "e2e" ? { cwd: root, pkg: "@playwright/test/package.json", cli: "cli.js" } : null;
if (!config) throw new Error("Unsupported Allure test command");
prepareResults(layer, execution);
let code = 1;
try {
  const require = createRequire(join(config.cwd, "package.json"));
  const child = spawn(process.execPath, [join(dirname(require.resolve(config.pkg)), config.cli), ...args], {
    cwd: config.cwd, stdio: "inherit", env: { ...process.env, DGI_ALLURE_SCOPE: execution, ALLURE_TESTPLAN_PATH: "" }
  });
  const interrupt = () => child.kill("SIGINT"), terminate = () => child.kill("SIGTERM");
  process.on("SIGINT", interrupt); process.on("SIGTERM", terminate);
  try { code = await new Promise((resolve, reject) => { child.once("error", reject); child.once("exit", (status) => resolve(status ?? 1)); }); }
  finally { process.off("SIGINT", interrupt); process.off("SIGTERM", terminate); }
} finally {
  try { const m = collectBatch(layer, execution, code); console.log(`Allure audited ${layer}/${execution}: ${JSON.stringify(m.counts)}`); }
  catch { console.error(`Allure reporting failed: ${layer}/${execution}`); if (code === 0) code = 1; }
  process.exitCode = code;
}
