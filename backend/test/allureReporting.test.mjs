import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, writeFileSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import AdmZip from "adm-zip";
import test from "./support/scoped-test.mjs";
import { prepareResults, collectBatch, mergeResults, cleanResults, forbiddenText } from "../../scripts/allure/results.mjs";
import { protectReport } from "../../scripts/allure/site.mjs";

function fixture(t, layer = "backend", execution = "unit") {
  const base = mkdtempSync(join(tmpdir(), "dgi-allure-"));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const raw = prepareResults(layer, execution, base), output = join(base, "allure-results", layer, execution);
  const add = (value = {}) => writeFileSync(join(raw, `${value.uuid ?? "case"}-result.json`), JSON.stringify({
    uuid: "case", name: "Synthetic operation", status: "passed", start: 10, stop: 35,
    labels: [{ name: "suite", value: "Quality infrastructure" }], ...value
  }));
  return { base, raw, output, add, collect: (code = 0) => collectBatch(layer, execution, code, base),
    results: () => readdirSync(output).filter((n) => n.endsWith("-result.json")).map((n) => JSON.parse(readFileSync(join(output, n)))) };
}

test("Allure preserves real statuses, hierarchy, duration and failed test exit metadata", (t) => {
  const f = fixture(t);
  for (const status of ["passed", "failed", "broken", "skipped", "unknown"]) f.add({ uuid: status, status });
  const manifest = f.collect(7);
  assert.deepEqual(manifest.counts, { broken: 1, failed: 1, passed: 1, skipped: 1, unknown: 1 });
  assert.equal(manifest.testExitCode, 7);
  for (const r of f.results()) {
    assert.equal(r.stop - r.start, 25);
    assert.ok(r.labels.some((l) => l.name === "suite" && l.value === "Quality infrastructure"));
    assert.ok(r.labels.some((l) => l.name === "layer" && l.value === "backend"));
  }
});

test("Allure withholds secrets, addresses, coordinates, prompts and arbitrary exception payloads", (t) => {
  const f = fixture(t);
  const secrets = ["SYNTHETIC_SECRET_token", "sk-syntheticKey12345", "Bearer synthetic-authorization",
    "123 Synthetic Street", "-122.123456, 47.654321", "synthetic prompt private contents", "synthetic completion private contents"];
  f.add({ name: `Failure ${secrets[0]}`, fullName: "https://private.invalid/record", descriptionHtml: secrets.join(" "),
    status: "failed", statusDetails: { message: `AssertionError ${secrets.join(" ")}`, trace: "at /Users/synthetic/project/backend/test/example.test.mjs:12:3" },
    parameters: [{ name: "Authorization", value: secrets[2] }], labels: [{ name: "secret", value: secrets[0] }],
    attachments: [{ name: "stdout", source: "personal.txt", type: "text/plain" }] });
  writeFileSync(join(f.raw, "personal.txt"), secrets.join(" "));
  f.collect(1);
  const text = readdirSync(f.output).map((n) => readFileSync(join(f.output, n), "utf8")).join("\n");
  for (const secret of secrets) assert.ok(!text.includes(secret));
  assert.ok(!text.includes("/Users/")); assert.ok(!text.includes("private.invalid"));
  assert.equal(f.results()[0].statusDetails.trace, "backend/test/example.test.mjs:12:3");
  assert.match(f.results()[0].statusDetails.message, /assertion_failure/);
  assert.equal(f.results()[0].attachments.length, 0);
});

test("Allure does not copy raw environment, URLs or unknown metadata fields", (t) => {
  const f = fixture(t); f.add();
  const meta = JSON.parse(readFileSync(join(f.raw, "dgi-run.json")));
  writeFileSync(join(f.raw, "dgi-run.json"), JSON.stringify({ ...meta, OPENAI_API_KEY: "SYNTHETIC_SECRET", privateUrl: "https://private.invalid" }));
  const m = f.collect();
  assert.equal(m.OPENAI_API_KEY, undefined); assert.equal(m.privateUrl, undefined);
  assert.equal(m.dataset, "synthetic-only-v1"); assert.match(m.runtime, /^v\d+\.\d+\.\d+$/);
});

test("Allure attachment audit allows only synthetic failure PNGs and inspected traces", (t) => {
  const f = fixture(t, "e2e", "chromium");
  // A real 1x1 transparent synthetic PNG; no application/customer data.
  const image = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jL1sAAAAASUVORK5CYII=", "base64");
  writeFileSync(join(f.raw, "synthetic.png"), image);
  const safe = new AdmZip(); safe.addFile("test.trace", Buffer.from('{"url":"http://127.0.0.1:4311/settings","type":"synthetic"}'));
  writeFileSync(join(f.raw, "safe.zip"), safe.toBuffer());
  const unsafe = new AdmZip(); unsafe.addFile("test.network", Buffer.from('{"name":"Authorization","value":"synthetic"}'));
  writeFileSync(join(f.raw, "unsafe.zip"), unsafe.toBuffer());
  f.add({ attachments: [{ name: "test-failed-1", source: "synthetic.png", type: "image/png" },
    { name: "trace", source: "safe.zip", type: "application/zip" }, { name: "trace", source: "unsafe.zip", type: "application/zip" },
    { name: "stdout", source: "missing.txt", type: "text/plain" }] });
  // An unrecognized attachment must not even be opened.
  writeFileSync(join(f.raw, "missing.txt"), "SYNTHETIC_SECRET");
  const m = f.collect(); assert.equal(m.auditedAttachments, 2); assert.equal(m.omittedAttachments, 2);
  assert.equal(f.results()[0].attachments.length, 2);
});

test("Allure rejects traversal, symlinks, malformed results and invalid run attestations", (t) => {
  const f = fixture(t, "e2e", "chromium");
  f.add({ attachments: [{ source: "../outside", name: "test-failed-1", type: "image/png" }] });
  assert.throws(() => f.collect(), /Unsafe Allure attachment/);
  f.add({ attachments: [{ source: "linked.png", name: "test-failed-1", type: "image/png" }] });
  writeFileSync(join(f.base, "outside"), "SYNTHETIC_SECRET"); symlinkSync(join(f.base, "outside"), join(f.raw, "linked.png"));
  assert.throws(() => f.collect(), /Unsafe Allure result file/);
  rmSync(join(f.raw, "linked.png"));
  writeFileSync(join(f.raw, "case-result.json"), "{");
  assert.throws(() => f.collect(), SyntaxError);
  writeFileSync(join(f.raw, "dgi-run.json"), "{}");
  assert.throws(() => f.collect(), /Invalid Allure run attestation/);
});

test("Allure merges all layers deterministically, rejects missing/modified files, and records partial reports", (t) => {
  const f = fixture(t); f.add(); f.collect();
  assert.throws(() => mergeResults(f.base), /Missing Allure test layers/);
  assert.equal(mergeResults(f.base, true).partial, true);
  for (const [layer, execution] of [["frontend", "unit"], ["e2e", "chromium"]]) {
    const raw = prepareResults(layer, execution, f.base);
    writeFileSync(join(raw, "other-result.json"), JSON.stringify({ uuid: layer, name: "Synthetic", status: "passed" }));
    collectBatch(layer, execution, 0, f.base);
  }
  const first = mergeResults(f.base); const second = mergeResults(f.base);
  assert.deepEqual(first, second); assert.equal(first.results, 3); assert.equal(first.partial, false);
  assert.deepEqual(first.layers, ["backend", "e2e", "frontend"]);
  const file = join(f.output, readdirSync(f.output).find((n) => n.endsWith("-result.json")));
  writeFileSync(file, "{}"); assert.throws(() => mergeResults(f.base), /Unaudited or modified/);
  rmSync(file); assert.throws(() => mergeResults(f.base), /Missing or unexpected/);
});

test("Allure rejects duplicate identities and mixed commits instead of silently overwriting", (t) => {
  const f = fixture(t); f.add(); f.collect();
  const raw = prepareResults("frontend", "unit", f.base);
  writeFileSync(join(raw, "other-result.json"), JSON.stringify({ uuid: "case", name: "Duplicate", status: "passed" }));
  collectBatch("frontend", "unit", 0, f.base);
  assert.throws(() => mergeResults(f.base, true), /UUID collision/);
  writeFileSync(join(raw, "other-result.json"), JSON.stringify({ uuid: "distinct", name: "Other commit", status: "passed" }));
  const meta = JSON.parse(readFileSync(join(raw, "dgi-run.json"))); meta.commit = "a".repeat(40);
  writeFileSync(join(raw, "dgi-run.json"), JSON.stringify(meta)); collectBatch("frontend", "unit", 0, f.base);
  assert.throws(() => mergeResults(f.base, true), /Mixed Allure commits/);
});

test("Allure clean is bounded to generated report paths and unknown status stays unknown", (t) => {
  const f = fixture(t); f.add({ status: "made-up" });
  assert.deepEqual(f.collect().counts, { unknown: 1 });
  writeFileSync(join(f.base, "unrelated.txt"), "keep"); cleanResults(f.base);
  assert.deepEqual(readdirSync(f.base), ["unrelated.txt"]);
  assert.throws(() => prepareResults("production", "unit", f.base), /Invalid Allure test batch/);
  assert.ok(forbiddenText("Authorization: Bearer synthetic"));
});

test("CI's actual aggregate gate rejects failed, skipped and cancelled stages including reporting", () => {
  const workflow = readFileSync(new URL("../../.github/workflows/ci.yml", import.meta.url), "utf8");
  const expression = workflow.split("\n").find((line) => line.trim().startsWith('[[ "$CHECKS"'))?.trim();
  assert.ok(expression);
  const variables = [...expression.matchAll(/\$([A-Z][A-Z0-9_]*)/g)].map((m) => m[1]);
  assert.ok(variables.includes("REPORTING"));
  const success = Object.fromEntries(variables.map((v) => [v, "success"]));
  const evaluate = (env) => spawnSync("bash", ["-c", expression], { env, timeout: 1000 }).status;
  assert.equal(evaluate(success), 0);
  for (const variable of variables) for (const status of ["failure", "skipped", "cancelled"]) {
    assert.notEqual(evaluate({ ...success, [variable]: status }), 0);
  }
});

test("Static report protection removes analytics and permits only hashed inline bootstrap scripts", (t) => {
  const f = fixture(t);
  const file = join(f.base, "index.html");
  writeFileSync(file, `<html><head><script>window.allureReportOptions = {};</script></head><body>
<script src="app.js"></script><script src="https://www.googletagmanager.com/gtag/js?id=synthetic"></script>
<script>window.dataLayer = []; gtag('config', 'synthetic');</script>
<script>document.createElement("base");</script></body></html>`);
  protectReport(f.base);
  const html = readFileSync(file, "utf8");
  assert.ok(!html.includes("googletagmanager")); assert.ok(!html.includes("dataLayer"));
  assert.ok(html.includes('createElement("base")')); assert.match(html, /base-uri 'self'/); assert.match(html, /script-src 'self' 'sha256-/);
  assert.match(html, /connect-src 'self'/); assert.match(html, /window\.allureReportOptions/); assert.match(html, /src="app.js"/);
  protectReport(f.base); assert.equal(readFileSync(file, "utf8"), html);
});
