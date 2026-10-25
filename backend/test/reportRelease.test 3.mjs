import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, readdirSync, rmSync, symlinkSync, renameSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import AdmZip from "adm-zip";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { spawnSync } from "node:child_process";
import test from "./support/scoped-test.mjs";
import { normalizeHistory, writeHistory, beforeHistory, afterHistory, auditJson } from "../../scripts/allure/history.mjs";
import { apiClient, sourceRun, trustedRun, repository, releaseWorkflow, restoreHistory, sha256 } from "../../scripts/allure/github.mjs";
import { publicInput, stagePublication, verifyPublication, deployAllowed } from "../../scripts/allure/publication.mjs";
import { prepareResults, collectBatch, mergeResults } from "../../scripts/allure/results.mjs";
import { protectReport } from "../../scripts/allure/site.mjs";
import { uploadReport } from "../../scripts/allure/upload.mjs";

const source = { runId: "300", sha: "a".repeat(40), branch: "main", event: "push", conclusion: "failure", repository };
function run(value = {}) {
  return { id: 300, head_sha: source.sha, head_branch: "main", path: ".github/workflows/ci.yml", status: "completed", conclusion: "failure",
    event: "push", repository: { full_name: repository }, head_repository: { full_name: repository }, ...value };
}
function history(id = 1, status = "passed") {
  return { uuid: id.toString(16).padStart(32, "0"), name: `DGI CI ${id}`, timestamp: id,
    knownTestCaseIds: ["a".repeat(32)], testResults: { ["a".repeat(32)]: { id: "b".repeat(32), name: "Synthetic quality operation", status, start: 1, stop: 11, duration: 10, url: "", labels: [], retries: [] } }, metrics: {}, url: "" };
}
function temp(t) {
  const directory = mkdtempSync(join(tmpdir(), "dgi-release-")); t.after(() => rmSync(directory, { recursive: true, force: true })); return directory;
}
function historyZip(text, extra = false) {
  const zip = new AdmZip(); zip.addFile("history.jsonl", Buffer.from(text));
  zip.addFile("manifest.json", Buffer.from(JSON.stringify({ schemaVersion: 1, source: { ...source, runId: "100" }, sha256: sha256(text) })));
  if (extra) zip.addFile("../unsafe", Buffer.from("SYNTHETIC_SECRET"));
  return zip.toBuffer();
}
function historyApi(bytes, { expired = false, missing = false, historicalEvent = "workflow_run", sourceEvent = "push" } = {}) {
  const calls = [];
  const api = async (path) => {
    calls.push(path);
    if (path.includes("actions/workflows/quality-report.yml/runs?")) return { workflow_runs: [run({ id: 200, path: releaseWorkflow, event: historicalEvent })] };
    if (path.includes("runs/200/artifacts?")) return { artifacts: [{ id: 2, name: "quality-report-history-main", expired }] };
    if (path.endsWith("runs/100")) return run({ id: 100, event: sourceEvent });
    if (path.endsWith("/zip")) return missing ? null : bytes;
    throw new Error("Unexpected fake API operation");
  };
  return { api, calls };
}

test("Allure JSONL history is bounded to 30 real run records and deduplicates reruns", (t) => {
  const entries = Array.from({ length: 35 }, (_, i) => history(i + 1));
  const normalized = normalizeHistory(entries.map(JSON.stringify).join("\n"));
  assert.equal(normalized.length, 30); assert.equal(normalized[0].name, "DGI CI 6");
  const replacement = history(35, "failed"); replacement.timestamp = 100;
  const updated = normalizeHistory([...entries, replacement].map(JSON.stringify).join("\n"));
  assert.equal(updated.length, 30); assert.equal(updated.at(-1).testResults["a".repeat(32)].status, "failed");
  const file = join(temp(t), "history.jsonl");
  assert.deepEqual(beforeHistory(file, "DGI CI 1"), []);
  writeHistory(file, updated); beforeHistory(file, "DGI CI 35");
  assert.equal(normalizeHistory(readFileSync(file, "utf8")).length, 29);
  assert.deepEqual(afterHistory(file), normalizeHistory(readFileSync(file, "utf8")));
});

test("History rejects malformed JSON/schema, private URLs, secrets and unsafe timing", () => {
  for (const text of ["{", "{}", JSON.stringify({ ...history(), url: "https://private.invalid" }),
    JSON.stringify({ ...history(), timestamp: -1 }), JSON.stringify({ ...history(), name: "SYNTHETIC_SECRET" })]) {
    assert.throws(() => normalizeHistory(text));
  }
  const invalid = history(); invalid.testResults["a".repeat(32)].duration = -1;
  assert.throws(() => normalizeHistory(JSON.stringify(invalid)), /timing_rejected/);
  for (const value of ["Bearer synthetic_token", "123 Synthetic Street", "-122.123456, 47.654321", "<script>", "javascript:example", "/Users/synthetic/private"]) {
    assert.throws(() => auditJson({ diagnostic: value }), /privacy_text_rejected/);
  }
});

test("Source trust rejects PR/fork/other branch/workflow/cancelled runs while retaining failed main diagnostics", async () => {
  assert.equal(trustedRun(run()), true);
  for (const value of [{ event: "pull_request" }, { head_branch: "feature" }, { conclusion: "cancelled" }, { status: "in_progress" },
    { path: ".github/workflows/other.yml" }, { head_repository: { full_name: "synthetic/fork" } }, { repository: { full_name: "synthetic/fork" } }]) assert.equal(trustedRun(run(value)), false);
  const api = async (path) => path.includes("/git/ref/") ? { object: { sha: source.sha } } : path.includes("workflow") ? { workflow_runs: [run()] } : run();
  assert.deepEqual(await sourceRun(api, "300"), source);
  await assert.rejects(sourceRun(async (path) => path.includes("/git/ref/") ? { object: { sha: "b".repeat(40) } } : run(), "300"), /superseded/);
  await assert.rejects(sourceRun(api, "../300"), /source_id_rejected/);
  await assert.rejects(sourceRun(async (path) => path.includes("/git/ref/") ? { object: { sha: source.sha } } : path.includes("workflow") ? { workflow_runs: [run({ id: 301 })] } : run(), "300"), /superseded/);
});

test("History restore uses a trusted completed release/source pair and checksum-checked ZIP", async (t) => {
  const f = historyApi(historyZip(JSON.stringify(history(100)))); const logs = [];
  const dir = temp(t);
  assert.deepEqual(await restoreHistory(f.api, dir, source, { log: (s) => logs.push(s) }), { reason: "restored", entries: 1 });
  assert.equal(normalizeHistory(readFileSync(join(dir, "history.jsonl"), "utf8"))[0].name, "DGI CI 100");
  assert.ok(f.calls.some((p) => p.endsWith("runs/100")));
  assert.deepEqual(logs, ["allure_history_restore=restored entries=1"]);
});

test("Missing/expired/untrusted history gives explicit safe first-run behavior", async (t) => {
  for (const options of [{ expired: true }, { missing: true }, { historicalEvent: "pull_request" }]) {
    const f = historyApi(historyZip(JSON.stringify(history())), options), dir = temp(t);
    const result = await restoreHistory(f.api, dir, source, { log() {} });
    assert.equal(result.reason, "first_run_or_expired"); assert.equal(readFileSync(join(dir, "history.jsonl"), "utf8"), "");
  }
});

test("Malformed/unsafe history is discarded without raw diagnostics; API outages remain failures", async (t) => {
  for (const bytes of [historyZip("{"), historyZip(JSON.stringify({ ...history(), name: "SYNTHETIC_SECRET" })), historyZip(JSON.stringify(history()), true)]) {
    const f = historyApi(bytes), logs = [], dir = temp(t);
    const result = await restoreHistory(f.api, dir, source, { log: (s) => logs.push(s) });
    assert.equal(result.reason, "malformed_artifact_discarded"); assert.equal(result.entries, 0);
    assert.ok(!logs.join().includes("SYNTHETIC_SECRET"));
  }
  await assert.rejects(restoreHistory(async () => { throw new Error("report_github_http_500"); }, temp(t), source, { log() {} }), /http_500/);
});

test("GitHub signed artifact redirects never receive the API authorization header", async () => {
  const requests = [];
  const api = apiClient("SYNTHETIC_SECRET_github", async (url, options) => {
    requests.push({ url: String(url), options });
    return requests.length === 1 ? new Response(null, { status: 302, headers: { location: "https://storage.invalid/synthetic" } }) : new Response("synthetic bytes");
  });
  assert.equal((await api(`/repos/${repository}/actions/artifacts/1/zip`, true)).toString(), "synthetic bytes");
  assert.equal(requests[1].options.headers, undefined);
  await assert.rejects(api("/repos/synthetic/fork/actions/artifacts"), /path_rejected/);
});

test("Publication input preserves failures/counts and excludes every test binary attachment", (t) => {
  const base = temp(t), raw = prepareResults("backend", "unit", base);
  writeFileSync(join(raw, "case-result.json"), JSON.stringify({ uuid: "case", name: "Synthetic quality operation", status: "failed", start: 1, stop: 11,
    statusDetails: { message: "AssertionError: SYNTHETIC_SECRET" }, steps: [], attachments: [] }));
  collectBatch("backend", "unit", 1, base);
  const browser = prepareResults("e2e", "chromium", base);
  const image = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jL1sAAAAASUVORK5CYII=", "base64");
  writeFileSync(join(browser, "synthetic.png"), image);
  const trace = new AdmZip(); trace.addFile("test.trace", Buffer.from('{"type":"synthetic"}'));
  writeFileSync(join(browser, "synthetic.zip"), trace.toBuffer());
  writeFileSync(join(browser, "browser-result.json"), JSON.stringify({ uuid: "browser", name: "Synthetic browser operation", status: "passed",
    steps: [{ name: "Nested synthetic diagnostic", status: "passed", steps: [], attachments: [{ name: "test-failed-1", source: "synthetic.png", type: "image/png" }] }],
    attachments: [{ name: "test-failed-1", source: "synthetic.png", type: "image/png" }, { name: "trace", source: "synthetic.zip", type: "application/zip" }] }));
  collectBatch("e2e", "chromium", 0, base);
  const summary = mergeResults(base, true), input = publicInput(base, summary);
  const output = readdirSync(input.directory).filter((n) => n.endsWith("-result.json")).map((n) => JSON.parse(readFileSync(join(input.directory, n)))).find((value) => value.status === "failed");
  assert.equal(input.omittedAttachments, 3); assert.ok(!readdirSync(input.directory).some((n) => /\.(?:png|zip)$/.test(n)));
  assert.equal(output.status, "failed"); assert.deepEqual(output.attachments, []); assert.equal(summary.executions[0].testExitCode, 1);
  output.parameters = [{ name: "prompt", value: "synthetic private prompt" }];
  writeFileSync(join(base, "allure-merged", `${output.uuid}-result.json`), JSON.stringify(output));
  assert.throws(() => publicInput(base, summary), /schema_rejected/);
});

function site(t) {
  const base = temp(t), output = join(base, "allure-report"); mkdirSync(join(output, "widgets"), { recursive: true });
  const app = "/* synthetic immutable vendor asset */";
  writeFileSync(join(output, "app.js"), app);
  writeFileSync(join(output, "index.html"), '<html><head><script>window.allureReportOptions = {"reportName":"Synthetic quality report"}</script></head><body><script src="app.js"></script></body></html>');
  writeFileSync(join(output, "widgets/statistic.json"), '{"passed":1,"failed":0}'); protectReport(output);
  return { base, output, assets: { "app.js": sha256(app) } };
}
test("Public site is an allowlisted exact inventory with CSP, reviewed vendor bytes and safe headers", (t) => {
  const f = site(t), manifest = stagePublication(f.base, source, f.assets), directory = join(f.base, "allure-publish");
  assert.equal(manifest.publicAttachments, 0); assert.equal(verifyPublication(directory, manifest, f.assets), true);
  writeFileSync(join(directory, "unexpected.log"), "SYNTHETIC_SECRET");
  assert.throws(() => verifyPublication(directory, manifest, f.assets), /inventory_rejected/);
  rmSync(join(directory, "unexpected.log")); writeFileSync(join(directory, "app.js"), "modified");
  assert.throws(() => verifyPublication(directory, manifest, f.assets), /digest_rejected/);
});

test("Public audit rejects personal payloads, unknown files, modified UI code and symlinks", (t) => {
  for (const kind of ["secret", "unknown", "vendor", "link", "root-link"]) {
    const f = site(t);
    if (kind === "secret") writeFileSync(join(f.output, "widgets/statistic.json"), '{"address":"123 Synthetic Street"}');
    if (kind === "unknown") writeFileSync(join(f.output, "personal.env"), "SYNTHETIC_SECRET");
    if (kind === "vendor") writeFileSync(join(f.output, "app.js"), "unreviewed code");
    if (kind === "link") symlinkSync(join(f.output, "app.js"), join(f.output, "linked.js"));
    if (kind === "root-link") { const original = join(f.base, "original"); renameSync(f.output, original); symlinkSync(original, f.output); }
    assert.throws(() => stagePublication(f.base, source, f.assets), /report_/);
  }
});

test("Git-derived CI links are projected out while other bootstrap fields stay strictly audited", (t) => {
  const f = site(t), index = join(f.output, "index.html");
  const git = { commit: "a".repeat(40), branch: "synthetic-report" };
  const html = (options) => `<html><head><script>window.allureReportOptions = ${JSON.stringify(options)}</script></head><body><script src="app.js"></script></body></html>`;
  writeFileSync(index, html({ reportName: "Synthetic quality report", git, ci: { repository: { url: "https://github.com/synthetic/report-fixture" } } }));
  protectReport(f.output);
  const protectedHtml = readFileSync(index, "utf8");
  assert.ok(!protectedHtml.includes("https://github.com/"));
  const options = JSON.parse(protectedHtml.match(/window\.allureReportOptions = (\{[^\n]+\})/)[1]);
  assert.equal(options.ci, undefined); assert.deepEqual(options.git, git);
  assert.doesNotThrow(() => stagePublication(f.base, source, f.assets));
  writeFileSync(join(f.output, "summary.json"), JSON.stringify({ status: "failed", stats: { failed: 1 }, commitHref: "https://github.com/synthetic/report-fixture/commit/example", diagnostic: "Safe summary" }));
  protectReport(f.output);
  assert.deepEqual(JSON.parse(readFileSync(join(f.output, "summary.json"))), { status: "failed", stats: { failed: 1 }, diagnostic: "Safe summary" });
  assert.doesNotThrow(() => stagePublication(f.base, source, f.assets));
  for (const unsafe of ["https://private.invalid/record", "Bearer synthetic_token", "123 Synthetic Street", "-122.123456, 47.654321", "/home/synthetic/private"]) {
    writeFileSync(index, html({ reportName: "Synthetic quality report", git, diagnostic: unsafe })); protectReport(f.output);
    assert.throws(() => stagePublication(f.base, source, f.assets), /report_privacy_text_rejected|report_public_html_rejected/);
  }
});

test("Privacy diagnostics reveal schema locations without rejected values or arbitrary keys", () => {
  assert.throws(() => auditJson({ ci: { repository: { url: "https://private.invalid/record" } } }), (error) => {
    assert.equal(error.auditPath, "$.ci.repository.url");
    assert.ok(!JSON.stringify(error).includes("private.invalid")); return true;
  });
  assert.throws(() => auditJson({ arbitraryPersonalName: "Bearer synthetic_token" }), (error) => {
    assert.equal(error.auditPath, "$.[key]"); return true;
  });
});

test("History checksum corruption and PR source history cannot be restored", async (t) => {
  const zip = new AdmZip(historyZip(JSON.stringify(history(100))));
  zip.updateFile("history.jsonl", Buffer.from(JSON.stringify(history(101))));
  for (const f of [historyApi(zip.toBuffer()), historyApi(historyZip(JSON.stringify(history(100))), { sourceEvent: "pull_request" })]) {
    const result = await restoreHistory(f.api, temp(t), source, { log() {} });
    assert.equal(result.reason, "malformed_artifact_discarded"); assert.equal(result.entries, 0);
  }
});

test("Missing current report and mismatched provenance fail closed", (t) => {
  assert.throws(() => mergeResults(temp(t), true), /Missing Allure test layers/);
  const base = temp(t), raw = prepareResults("backend", "unit", base);
  writeFileSync(join(raw, "case-result.json"), JSON.stringify({ uuid: "case", name: "Synthetic operation", status: "passed" }));
  collectBatch("backend", "unit", 0, base);
  const summary = mergeResults(base, true);
  assert.throws(() => publicInput(base, summary, source), /provenance_rejected/);
});

test("The actual CI gate rejects any failed or skipped required stage even when reporting succeeds", () => {
  const ci = readFileSync(new URL("../../.github/workflows/ci.yml", import.meta.url), "utf8");
  const gate = ci.match(/\[\[ "\$CHECKS" == success[^\n]+\]\]/)[0];
  const stages = ["CHECKS", "INTEGRATION", "COVERAGE", "SECURITY", "E2E", "REPORTING"];
  const success = Object.fromEntries(stages.map((key) => [key, "success"]));
  // Node can add NODE_V8_COVERAGE to a supplied spawn env under c8. Keep the
  // stage denominator explicit and give each child a fresh environment object.
  assert.equal(spawnSync("bash", ["-c", gate], { env: { ...success } }).status, 0);
  for (const key of stages) for (const value of ["failure", "skipped", "cancelled"]) {
    assert.equal(spawnSync("bash", ["-c", gate], { env: { ...success, [key]: value } }).status, 1, `${key}=${value}`);
  }
});

test("Deployment is denied for local/PR/fork/disabled/unreviewed candidates", (t) => {
  const f = site(t), manifest = stagePublication(f.base, source, f.assets);
  const now = Date.UTC(2026, 9, 23);
  const env = { GITHUB_ACTIONS: "true", GITHUB_EVENT_NAME: "workflow_run", GITHUB_REPOSITORY: repository, GITHUB_REF: "refs/heads/main", QUALITY_REPORT_DEPLOY_ENABLED: "true", QUALITY_REPORT_BUNDLE_SHA256: manifest.bundleDigest, QUALITY_REPORT_BUNDLE_REVIEW_EXPIRES: "2026-11-01" };
  assert.equal(deployAllowed(env, manifest, now), true);
  for (const change of [{ GITHUB_ACTIONS: "false" }, { GITHUB_REPOSITORY: "synthetic/fork" }, { GITHUB_REF: "refs/pull/1/merge" },
    { GITHUB_EVENT_NAME: "pull_request" }, { GITHUB_EVENT_NAME: "pull_request_target" }, { GITHUB_EVENT_NAME: "push" },
    { QUALITY_REPORT_DEPLOY_ENABLED: "false" }, { QUALITY_REPORT_BUNDLE_SHA256: "unreviewed" }, { QUALITY_REPORT_BUNDLE_REVIEW_EXPIRES: "2026-10-01" },
    { QUALITY_REPORT_BUNDLE_REVIEW_EXPIRES: "2099-01-01" }, { QUALITY_REPORT_BUNDLE_REVIEW_EXPIRES: "invalid" }]) assert.equal(deployAllowed({ ...env, ...change }, manifest, now), false);
  assert.equal(deployAllowed(env, { ...manifest, mode: "local-dry-run" }, now), false);
});

test("Only the isolated main deployment step references Cloudflare secrets; CI gate is independent", () => {
  const ci = readFileSync(new URL("../../.github/workflows/ci.yml", import.meta.url), "utf8");
  const release = readFileSync(new URL("../../.github/workflows/quality-report.yml", import.meta.url), "utf8");
  assert.ok(!ci.includes("CLOUDFLARE_")); assert.ok(!ci.includes("quality-report.yml"));
  const [prepare, deploy] = release.split("  deploy:\n");
  assert.ok(!prepare.includes("secrets.CLOUDFLARE_")); assert.ok(!release.includes("pull_request:"));
  assert.match(deploy, /environment: quality-report-production/); assert.match(deploy, /github.ref == 'refs\/heads\/main'/);
  assert.equal((release.match(/secrets\.CLOUDFLARE_/g) ?? []).length, 2);
  assert.ok(!release.includes("continue-on-error"));
});

test("Cloudflare upload preserves failures and never prints raw Wrangler credential diagnostics", async () => {
  for (const code of [0, 7]) {
    const logs = [], secret = "SYNTHETIC_SECRET_cloudflare";
    const result = await uploadReport([], { env: { CLOUDFLARE_API_TOKEN: secret } }, {
      log: (line) => logs.push(line), spawnImpl: () => {
        const child = new EventEmitter(); child.stdout = new PassThrough(); child.stderr = new PassThrough();
        queueMicrotask(() => {
          child.stdout.write(`Deployment https://synthetic-report.pages.dev ${secret}`);
          child.stderr.write(`Authorization: Bearer ${secret}`); child.emit("close", code);
        });
        return child;
      }
    });
    assert.equal(result, code); assert.ok(!logs.join().includes(secret)); assert.ok(!logs.join().includes("Authorization"));
    assert.match(logs.join(), code ? /upload_failed exit=7/ : /upload_confirmed url=https:\/\/synthetic-report.pages.dev/);
  }
});

test("Main push metadata uses the ref name when GitHub provides an empty PR head ref", (t) => {
  const base = temp(t), module = new URL("../../scripts/allure/results.mjs", import.meta.url).href;
  const child = spawnSync(process.execPath, ["--input-type=module", "-e", `import { prepareResults } from ${JSON.stringify(module)}; prepareResults("backend", "unit", process.argv[1]);`, base], {
    encoding: "utf8", timeout: 10_000,
    env: { PATH: process.env.PATH, GITHUB_HEAD_REF: "", GITHUB_REF_NAME: "main", GITHUB_RUN_ID: "300", GITHUB_ACTIONS: "true" }
  });
  assert.equal(child.status, 0);
  const metadata = JSON.parse(readFileSync(join(base, ".allure-raw/backend/unit/dgi-run.json")));
  assert.equal(metadata.branch, "main"); assert.equal(metadata.ciRun, "300");
});
