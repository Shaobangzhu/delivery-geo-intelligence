import { execFileSync } from "node:child_process";
import { lstatSync, mkdirSync, readdirSync, rmSync, writeFileSync, copyFileSync } from "node:fs";
import { join, relative, basename } from "node:path";
import { root, artifactRoot } from "./results.mjs";
import { forbiddenText } from "./results.mjs";
import { auditJson, assertPublicText, readBounded } from "./history.mjs";
import { sha256, repository, assertSource } from "./github.mjs";
import { createHash } from "node:crypto";
import { contentSecurityPolicy } from "./site.mjs";

const states = new Set(["passed", "failed", "broken", "skipped", "unknown"]);
function keys(value, allowed) {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some((key) => !allowed.includes(key))) throw new Error("report_public_schema_rejected");
}
function item(value, audit, result = false) {
  keys(value, ["name", "status", "statusDetails", "steps", "attachments", "start", "stop", ...(result ? ["uuid", "fullName", "historyId", "labels", "stage"] : [])]);
  // Child steps are recursively projected below; audit only this step's
  // non-attachment fields before walking them, never the original child tree.
  auditJson({ ...value, attachments: [], steps: [] });
  if (!states.has(value.status) || !Array.isArray(value.steps) || !Array.isArray(value.attachments)) throw new Error("report_public_status_rejected");
  if (result) {
    if (!/^[a-f0-9]{64}$/.test(value.uuid) || !/^[a-f0-9]{64}$/.test(value.historyId) || value.stage !== "finished" || !Array.isArray(value.labels)) throw new Error("report_public_identity_rejected");
    for (const label of value.labels) {
      keys(label, ["name", "value"]);
      if (!["parentSuite", "suite", "subSuite", "framework", "language", "package", "layer", "execution"].includes(label.name)) throw new Error("report_public_label_rejected");
    }
  }
  if (value.statusDetails) {
    keys(value.statusDetails, ["message", "trace"]);
    if (!/^(?:assertion_failure|timeout|test_or_setup_failure): expected\/actual values and raw diagnostics withheld by publishing policy$/.test(value.statusDetails.message)) throw new Error("report_public_raw_error_rejected");
    if (value.statusDetails.trace && !value.statusDetails.trace.split("\n").every((line) => /^(?:backend\/test|frontend\/src|e2e|scripts)\/[a-zA-Z0-9_./-]+\.(?:mjs|tsx?|js):\d+(?::\d+)?$/.test(line))) throw new Error("report_public_raw_trace_rejected");
  }
  for (const attachment of value.attachments) {
    keys(attachment, ["name", "source", "type"]);
    if (!/^[a-f0-9]{64}-attachment\.(?:png|zip)$/.test(attachment.source)) throw new Error("report_public_attachment_rejected");
  }
  audit.omittedAttachments += value.attachments.length;
  return { ...value, attachments: [], steps: value.steps.map((step) => item(step, audit)) };
}
export function publicInput(base, summary, source = null) {
  if (source) assertSource(source);
  const from = join(base, "allure-merged"), output = join(base, "allure-public-input");
  rmSync(output, { recursive: true, force: true }); mkdirSync(output, { recursive: true });
  const audit = { omittedAttachments: 0 };
  for (const m of summary.executions) {
    keys(m, ["schemaVersion", "commit", "branch", "ciRun", "runtime", "environment", "layer", "execution", "dataset", "testExitCode", "counts", "auditedAttachments", "omittedAttachments", "files"]);
    auditJson(m);
    if (m.dataset !== "synthetic-only-v1" || (source && (m.commit !== source.sha || m.ciRun !== source.runId || m.branch !== "main" || m.environment !== "github-actions"))) throw new Error("report_public_provenance_rejected");
    if (m.testExitCode === 0 && ((m.counts.failed ?? 0) + (m.counts.broken ?? 0) > 0)) throw new Error("report_public_exit_mismatch");
  }
  for (const name of readdirSync(from).sort()) {
    if (name === "environment.properties") { copyFileSync(join(from, name), join(output, name)); continue; }
    if (/^[a-f0-9]{64}-attachment\.(?:png|zip)$/.test(name)) continue;
    if (!/^[a-f0-9]{64}-(?:result|container)\.json$/.test(name)) throw new Error("report_public_file_rejected");
    const input = JSON.parse(readBounded(join(from, name)).toString());
    let projected;
    if (name.endsWith("-result.json")) projected = item(input, audit, true);
    else {
      keys(input, ["uuid", "name", "children", "befores", "afters"]); assertPublicText(input.name);
      projected = { ...input, befores: input.befores.map((step) => item(step, audit)), afters: input.afters.map((step) => item(step, audit)) };
      auditJson({ ...projected, befores: [], afters: [] });
    }
    writeFileSync(join(output, name), JSON.stringify(projected));
  }
  return { directory: output, ...audit };
}
export function vendorAssets() {
  const tar = ["darwin", "linux"].includes(process.platform) ? "/usr/bin/tar" : "tar";
  const archive = join(root, "node_modules/@allurereport/plugin-awesome/dist/static/report.tar");
  const names = execFileSync(tar, ["-tf", archive], { encoding: "utf8", maxBuffer: 1_000_000 }).trim().split("\n");
  const assets = {};
  for (const name of names) {
    if (name.endsWith("/") || name === "index.html" || name === "manifest.json") continue;
    if (name !== basename(name) || name.startsWith("-") || !/^[a-zA-Z0-9_.-]+$/.test(name)) throw new Error("report_vendor_archive_rejected");
    assets[name] = sha256(execFileSync(tar, ["-xOf", archive, name], { maxBuffer: 30_000_000 }));
  }
  return assets;
}
function filesAt(directory) {
  const rootStat = lstatSync(directory);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) throw new Error("report_public_symlink_rejected");
  const files = [];
  function walk(path) {
    for (const name of readdirSync(path).sort()) {
      const file = join(path, name), stat = lstatSync(file);
      if (stat.isSymbolicLink()) throw new Error("report_public_symlink_rejected");
      if (stat.isDirectory()) walk(file);
      else if (stat.isFile()) files.push(relative(directory, file).split("\\").join("/"));
      else throw new Error("report_public_special_file_rejected");
    }
  }
  walk(directory); return files;
}
export const headers = "/*\n  X-Content-Type-Options: nosniff\n  X-Frame-Options: DENY\n  Referrer-Policy: no-referrer\n  X-Robots-Tag: noindex, nofollow\n  Cache-Control: no-store\n";
function auditSiteFile(name, bytes, assets) {
  if (assets[name]) { if (assets[name] !== sha256(bytes)) throw new Error("report_vendor_asset_modified"); return; }
  if (name === "_headers") { if (bytes.toString() !== headers) throw new Error("report_public_headers_rejected"); return; }
  if (name === "index.html") {
    const html = bytes.toString();
    if (forbiddenText(html) || /\/Users\/|\/home\/|googletagmanager|gtag\(/i.test(html)) throw new Error("report_public_html_rejected");
    const hashes = [];
    for (const script of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
      const [, attributes, body] = script, src = attributes.match(/^\s*src="([a-zA-Z0-9_.-]+)"\s*$/)?.[1];
      if (src) { if (!assets[src]) throw new Error("report_public_script_rejected"); continue; }
      if (attributes.trim() && attributes.trim() !== "async") throw new Error("report_public_script_rejected");
      const normalized = body.trim().replace(/\s+/g, " ");
      if (!/^window\.allureReportOptions = \{[^\n]+\}$/.test(normalized) && ![
        'const { origin, pathname } = window.location; const url = new URL(pathname, origin); const baseEl = document.createElement("base"); baseEl.href = url.toString(); window.document.head.appendChild(baseEl);',
        "window.allure = window.allure || {};", "window.allureReportDataReady = true;"
      ].includes(normalized)) throw new Error("report_public_script_rejected");
      hashes.push(`'sha256-${createHash("sha256").update(body).digest("base64")}'`);
    }
    const policy = html.match(/<meta http-equiv="Content-Security-Policy" content="([^"]+)">/);
    if (policy?.[1] !== contentSecurityPolicy(hashes)) throw new Error("report_public_csp_rejected");
    const options = html.match(/window\.allureReportOptions\s*=\s*(\{[^\n]+\})/);
    if (!options) throw new Error("report_public_bootstrap_rejected"); auditJson(JSON.parse(options[1]));
  } else if (/^(?:(?:data\/(?:test-results|test-env-groups|history)|widgets(?:\/[a-zA-Z0-9_-]+)?)\/[a-zA-Z0-9_.-]+|summary|test-results|dgi-summary)\.json$/.test(name)) auditJson(JSON.parse(bytes.toString()));
  else throw new Error("report_public_unexpected_file");
}
export function stagePublication(base = artifactRoot, source = null, assets = vendorAssets()) {
  if (source) assertSource(source);
  const from = join(base, "allure-report"), target = join(base, "allure-publish");
  rmSync(target, { recursive: true, force: true }); mkdirSync(target, { recursive: true });
  const inventory = {}, dataFiles = [];
  for (const name of filesAt(from)) {
    const bytes = readBounded(join(from, name), 25_000_000), digest = sha256(bytes);
    auditSiteFile(name, bytes, assets); if (name.endsWith(".json")) dataFiles.push(name);
    mkdirSync(join(target, name, ".."), { recursive: true }); copyFileSync(join(from, name), join(target, name)); inventory[name] = digest;
  }
  if (!inventory["index.html"] || !dataFiles.length) throw new Error("report_public_empty");
  // Only immutable vendor assets enter the review fingerprint. A data-only run
  // need not request a new bundle review; any dependency/UI change does.
  const usedAssets = Object.fromEntries(Object.entries(inventory).filter(([name]) => assets[name]));
  writeFileSync(join(target, "_headers"), headers); inventory._headers = sha256(headers);
  const manifest = { schemaVersion: 1, mode: source ? "trusted-main" : "local-dry-run", dataset: "synthetic-only-v1",
    source, bundleDigest: sha256(JSON.stringify(usedAssets)), publicAttachments: 0, files: inventory };
  writeFileSync(join(base, "publication-manifest.json"), JSON.stringify(manifest, null, 2));
  verifyPublication(target, manifest, assets);
  return manifest;
}
export function verifyPublication(directory, manifest, assets = vendorAssets()) {
  keys(manifest, ["schemaVersion", "mode", "dataset", "source", "bundleDigest", "publicAttachments", "files"]);
  if (!["trusted-main", "local-dry-run"].includes(manifest.mode)) throw new Error("report_public_mode_rejected");
  auditJson(manifest);
  if (manifest.mode === "trusted-main") assertSource(manifest.source);
  if (manifest.schemaVersion !== 1 || manifest.dataset !== "synthetic-only-v1" || manifest.publicAttachments !== 0 ||
      JSON.stringify(filesAt(directory).sort()) !== JSON.stringify(Object.keys(manifest.files).sort())) throw new Error("report_public_inventory_rejected");
  for (const [name, expected] of Object.entries(manifest.files)) {
    const bytes = readBounded(join(directory, name), 25_000_000);
    if (sha256(bytes) !== expected || (assets[name] && expected !== assets[name])) throw new Error("report_public_digest_rejected");
    auditSiteFile(name, bytes, assets);
  }
  const usedAssets = Object.fromEntries(Object.entries(manifest.files).filter(([name]) => assets[name]));
  if (sha256(JSON.stringify(usedAssets)) !== manifest.bundleDigest) throw new Error("report_public_bundle_rejected");
  return true;
}
export function deployAllowed(env, manifest, now = Date.now()) {
  const expires = /^\d{4}-\d{2}-\d{2}$/.test(env.QUALITY_REPORT_BUNDLE_REVIEW_EXPIRES ?? "")
    ? Date.parse(`${env.QUALITY_REPORT_BUNDLE_REVIEW_EXPIRES}T23:59:59.999Z`) : NaN;
  return env.GITHUB_ACTIONS === "true" && env.GITHUB_REPOSITORY === repository && env.GITHUB_REF === "refs/heads/main" &&
    ["workflow_run", "workflow_dispatch"].includes(env.GITHUB_EVENT_NAME) &&
    env.QUALITY_REPORT_DEPLOY_ENABLED === "true" && manifest.mode === "trusted-main" && manifest.source?.repository === repository &&
    manifest.source.branch === "main" && env.QUALITY_REPORT_BUNDLE_SHA256 === manifest.bundleDigest &&
    Number.isFinite(expires) && new Date(expires).toISOString().slice(0, 10) === env.QUALITY_REPORT_BUNDLE_REVIEW_EXPIRES && expires >= now && expires - now <= 31 * 86_400_000;
}
