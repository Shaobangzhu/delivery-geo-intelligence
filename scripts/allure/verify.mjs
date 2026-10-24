// Intentional failing probes validate the reporting infrastructure, not product
// behavior. Their temporary results never enter the application report.
import assert from "node:assert/strict";
import { spawnSync, execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { artifactRoot, root, prepareResults, collectBatch, mergeResults } from "./results.mjs";
import { protectReport } from "./site.mjs";
import { verifyStaticSite } from "./verify-site.mjs";
import { publicInput, stagePublication } from "./publication.mjs";
import { beforeHistory, afterHistory, privacyDiagnostic } from "./history.mjs";

mkdirSync(artifactRoot, { recursive: true });
const base = mkdtempSync(join(artifactRoot, ".allure-verify-"));
const summary = { runtime: process.version, category: "isolated-reporting-probes", layers: {} };
const run = (args, env = {}, cwd = root) => spawnSync(process.execPath, args, {
  cwd, encoding: "utf8", timeout: 90_000, maxBuffer: 5_000_000,
  env: { PATH: process.env.PATH, HOME: process.env.HOME, TZ: "UTC", CI: "true", ALLURE_TESTPLAN_PATH: "", ...env }
});
function inspect(layer, execution, result) {
  assert.equal(result.status, 1, `${layer}: intentional failure must exit 1`);
  const manifest = collectBatch(layer, execution, result.status, base);
  assert.deepEqual(manifest.counts, { failed: 1, passed: 1, skipped: 1 }, `${layer}: actual reporter statuses`);
  const directory = join(base, "allure-results", layer, execution);
  const results = readdirSync(directory).filter((n) => n.endsWith("-result.json")).map((n) => JSON.parse(readFileSync(join(directory, n))));
  assert.ok(results.every((r) => Number.isFinite(r.start) && r.stop >= r.start));
  assert.ok(results.every((r) => r.labels.some((l) => ["parentSuite", "suite", "subSuite"].includes(l.name))));
  const text = JSON.stringify(results);
  assert.ok(!text.includes("SYNTHETIC_SECRET")); assert.ok(!text.includes("/Users/"));
  summary.layers[layer] = { exitCode: result.status, counts: manifest.counts,
    auditedAttachments: manifest.auditedAttachments, omittedAttachments: manifest.omittedAttachments };
}
try {
  const native = join(base, "native.test.mjs");
  writeFileSync(native, `import { describe, it } from "node:test";
import assert from "node:assert/strict";
describe("Reporting probe", () => {
  it("pass", () => assert.equal(1, 1));
  it("failure", () => assert.equal("SYNTHETIC_SECRET_expected", "SYNTHETIC_SECRET_actual"));
  it.skip("skip", () => {});
});`);
  const backendRaw = prepareResults("backend", "unit", base);
  inspect("backend", "unit", run(["--test", "--test-reporter=allure-node-test/reporter", native], {
    ALLURE_NODE_TEST_CONFIG: JSON.stringify({ resultsDir: backendRaw })
  }));

  const frontendRaw = prepareResults("frontend", "unit", base);
  const vitest = join(base, "frontend.test.mjs"), vitestConfig = join(base, "vitest.config.mjs");
  writeFileSync(vitest, `import { describe, test, expect } from "vitest";
describe("Reporting probe", () => {
  test("pass", () => expect(1).toBe(1));
  test("failure", () => expect("SYNTHETIC_SECRET_actual").toBe("SYNTHETIC_SECRET_expected"));
  test("skip", (context) => context.skip());
});`);
  writeFileSync(vitestConfig, `export default ${JSON.stringify({ root: base, envDir: false, test: {
    include: [vitest], environment: "node", maxWorkers: 1, setupFiles: ["allure-vitest/setup"],
    reporters: [["allure-vitest/reporter", { resultsDir: frontendRaw, reportMatchers: false }]]
  } })};`);
  inspect("frontend", "unit", run([join(root, "node_modules/vitest/vitest.mjs"), "run", "--config", vitestConfig]));

  const e2eRaw = prepareResults("e2e", "chromium", base);
  const e2e = join(base, "reporting.spec.mjs"), e2eConfig = join(base, "playwright.config.mjs");
  writeFileSync(e2e, `import { test, expect } from "@playwright/test";
test.describe("Reporting probe", () => {
  test("pass", async ({ page }) => { await page.setContent("<h1>Synthetic fixture</h1>"); await expect(page.getByRole("heading")).toBeVisible(); });
  test("failure", async ({ page }) => { await page.setContent("<h1>Synthetic fixture</h1>"); expect(1).toBe(2); });
  test.skip("skip", async () => {});
});`);
  writeFileSync(e2eConfig, `export default ${JSON.stringify({ testDir: base, testMatch: "reporting.spec.mjs", workers: 1,
    retries: 0, timeout: 15_000, outputDir: join(base, "playwright-output"),
    reporter: [["allure-playwright", { resultsDir: e2eRaw, detail: false }]],
    use: { browserName: "chromium", headless: true, screenshot: "only-on-failure", trace: "retain-on-failure" }
  })};`);
  inspect("e2e", "chromium", run([join(root, "node_modules/@playwright/test/cli.js"), "test", "--config", e2eConfig]));
  assert.ok(summary.layers.e2e.auditedAttachments >= 1, "real synthetic Playwright failure screenshot must survive the audit");
  const merged = mergeResults(base); assert.equal(merged.results, 9); assert.equal(merged.partial, false);
  const config = join(base, "allurerc.mjs"), output = join(base, "allure-report"), history = join(base, "history.jsonl");
  const input = publicInput(base, merged);
  // Real Git metadata caused the CI-only bootstrap privacy regression. Use an
  // isolated repository with a synthetic remote; no remote is ever contacted.
  const gitCwd = join(base, "git-fixture"); mkdirSync(gitCwd);
  const git = process.platform === "darwin" ? "/usr/bin/git" : "git";
  const gitEnv = { PATH: process.env.PATH, HOME: base, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null" };
  for (const args of [["init", "--initial-branch=synthetic-report"], ["-c", "user.name=Synthetic fixture", "-c", "user.email=fixture@example.invalid", "-c", "commit.gpgsign=false", "commit", "--allow-empty", "-m", "Synthetic reporting fixture"],
    ["remote", "add", "origin", "https://github.com/synthetic/report-fixture.git"]]) execFileSync(git, args, { cwd: gitCwd, env: gitEnv, stdio: "ignore" });
  // Real adapter results seed an isolated history round trip. The second name
  // is a fixture for a previous/current run comparison, never product history.
  for (const suffix of ["a", "b", "b"]) {
    const name = `DGI local ${suffix.repeat(16)}`;
    beforeHistory(history, name);
    writeFileSync(config, `export default ${JSON.stringify({ name, historyPath: history, appendHistory: true, historyLimit: 30, plugins: { awesome: { options: { singleFile: false } } } })};`);
    const generated = run([join(root, "node_modules/allure/cli.js"), "generate", input.directory, "--config", config, "--output", output, "--clean"], {
      ...gitEnv, PATH: process.platform === "darwin" ? `/usr/bin:${process.env.PATH}` : process.env.PATH
    }, gitCwd);
    assert.equal(generated.status, 0, "Allure 3 must generate diagnostics for failed tests without rewriting test exits");
    assert.equal(afterHistory(history).length, suffix === "a" ? 1 : 2);
  }
  assert.match(readFileSync(join(output, "index.html"), "utf8"), /<html/i);
  const original = readFileSync(join(output, "index.html"), "utf8");
  assert.ok(original.includes("https://github.com/synthetic/report-fixture"), "real Allure output must exercise Git-derived CI URL");
  assert.ok(JSON.parse(readFileSync(join(output, "summary.json"))).commitHref.startsWith("https://github.com/synthetic/report-fixture"));
  protectReport(output);
  assert.ok(!readFileSync(join(output, "index.html"), "utf8").includes("https://github.com/synthetic/report-fixture"));
  const candidate = stagePublication(base);
  summary.publication = { mode: candidate.mode, publicAttachments: candidate.publicAttachments, replayHistoryEntries: afterHistory(history).length };
  summary.gitMetadataProjection = "verified with a real generated report and isolated synthetic Git remote";
  summary.browser = await verifyStaticSite(output);
  summary.staticGeneration = "passed; 9 real probe executions, including 3 intentional failures";
  writeFileSync(join(artifactRoot, "allure-verification.json"), JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary, null, 2));
} catch (error) {
  console.error(privacyDiagnostic(error)); process.exitCode = 1;
} finally { rmSync(base, { recursive: true, force: true }); }
