import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const sandbox = mkdtempSync(join(tmpdir(), "dgi-quality-demo-"));
const destination = join(root, "reports/quality-gate-demo");
const env = { PATH: process.env.PATH, HOME: sandbox, TMPDIR: sandbox, TZ: "UTC", NODE_ENV: "test" };
const npm = process.env.npm_execpath;
assert.ok(npm && existsSync(npm), "Run through npm run quality:demo");
const entries = [".github", "quality-report", "backend", "frontend", "e2e", "scripts", "package.json", "package-lock.json", "allurerc.mjs", "playwright.config.ts", "eslint.config.mjs"];
const skip = new Set(["node_modules", "dist", "dist-e2e", "coverage", "reports", "artifacts", ".git"]);
const filter = (path) => !skip.has(basename(path)) && !basename(path).startsWith(".env") && !/ \d+\.[^.]+$/.test(basename(path));
const results = [];
const command = "npm run test:backend:unit"; // The same blocking command used by CI.
const target = join(sandbox, "backend/src/observability/routes.ts");
let original;
const run = (args) => {
  const result = spawnSync(process.execPath, args, { cwd: sandbox, env, encoding: "utf8", timeout: 180_000, maxBuffer: 20_000_000 });
  if (result.error || result.signal) throw new Error("Demo subprocess did not finish normally");
  return result;
};
try {
  for (const entry of entries) cpSync(join(root, entry), join(sandbox, entry), { recursive: true, filter });
  for (const entry of ["node_modules", "backend/node_modules", "frontend/node_modules"]) {
    if (existsSync(join(root, entry))) symlinkSync(join(root, entry), join(sandbox, entry), "dir");
  }
  original = readFileSync(target, "utf8");
  const needle = 'evidence: errorCategory ? "failure" : "success"';
  assert.equal(original.split(needle).length, 2, "Expected one guarded health evidence assignment");
  rmSync(destination, { recursive: true, force: true }); mkdirSync(destination, { recursive: true });
  for (const [phase, expectedExit] of [["baseline", 0], ["regression", 1], ["restored", 0]]) {
    writeFileSync(target, phase === "regression" ? original.replace(needle, 'evidence: "success"') : original);
    rmSync(join(sandbox, "artifacts"), { recursive: true, force: true });
    const start = performance.now(), test = run([npm, "run", "test:backend:unit"]);
    const durationSeconds = Math.round((performance.now() - start) / 10) / 100;
    writeFileSync(join(destination, `${phase}-local-only.log`), `${test.stdout}\n${test.stderr}`);
    assert.equal(test.status, expectedExit, `Unexpected ${phase} quality check exit; inspect the isolated demo`);
    // Publish-style projection removes attachments/raw diagnostics. No deployment,
    // source artifact restore, or real history is involved in this local exercise.
    const report = run(["scripts/allure/release.mjs", "local"]);
    assert.equal(report.status, 0, `Failed to generate sanitized ${phase} diagnostics`);
    const summary = JSON.parse(readFileSync(join(sandbox, "artifacts/allure-report/dgi-summary.json")));
    const manifest = JSON.parse(readFileSync(join(sandbox, "artifacts/allure-results/backend/unit/dgi-manifest.json")));
    const failing = (manifest.counts.failed ?? 0) + (manifest.counts.broken ?? 0);
    assert.equal(failing > 0, phase === "regression", "Allure must agree with the actual test exit");
    assert.equal(summary.partial, true, "Demo intentionally runs the backend unit layer only");
    const output = join(destination, phase); mkdirSync(output);
    cpSync(join(sandbox, "artifacts/allure-publish"), join(output, "html"), { recursive: true });
    cpSync(join(sandbox, "artifacts/allure-results/backend/unit"), join(output, "results"), { recursive: true });
    cpSync(join(sandbox, "artifacts/publication-manifest.json"), join(output, "publication-manifest.json"));
    results.push({ phase, command, exitCode: test.status, durationSeconds, counts: manifest.counts, partial: true });
    console.log(`quality_demo ${phase}: exit=${test.status} counts=${JSON.stringify(manifest.counts)} duration=${durationSeconds}s`);
  }
  assert.equal(readFileSync(target, "utf8"), original);
  writeFileSync(join(destination, "summary.json"), JSON.stringify({ runtime: process.version, dataset: "synthetic-only-v1", environment: "disposable-local-copy", sourceUnchanged: true, results }, null, 2));
  console.log("Quality gate demo passed: reports/quality-gate-demo/{baseline,regression,restored}/html/index.html");
} finally {
  if (original !== undefined) writeFileSync(target, original);
  rmSync(sandbox, { recursive: true, force: true });
}
