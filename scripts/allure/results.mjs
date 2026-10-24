import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync, lstatSync } from "node:fs";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import AdmZip from "adm-zip";

export const root = fileURLToPath(new URL("../../", import.meta.url));
export const artifactRoot = join(root, "artifacts");
export const batches = { backend: ["all", "unit", "integration"], frontend: ["unit", "coverage"], e2e: ["chromium"] };
const statuses = new Set(["passed", "failed", "broken", "skipped", "unknown"]);
const hash = (value) => createHash("sha256").update(value).digest("hex");
function batch(layer, execution) {
  if (!batches[layer]?.includes(execution)) throw new Error("Invalid Allure test batch");
  return `${layer}/${execution}`;
}
export function rawDirectory(layer, execution, base = artifactRoot) {
  return join(base, ".allure-raw", batch(layer, execution));
}
function metadata(layer, execution) {
  const git = (args, pattern) => {
    // An Intel-only PATH git can be unusable from native ARM Node on macOS.
    // Prefer PATH normally, then Apple's universal executable; no shell/env dump.
    for (const executable of process.platform === "darwin" ? ["git", "/usr/bin/git"] : ["git"]) {
      try { const value = execFileSync(executable, args, { cwd: root, encoding: "utf8", timeout: 5000, stdio: ["ignore", "pipe", "ignore"] }).trim(); if (pattern.test(value)) return value; }
      catch { /* Try the platform fallback; missing Git remains explicitly unknown. */ }
    }
    return "unknown";
  };
  return {
    commit: git(["rev-parse", "HEAD"], /^[a-f0-9]{40,64}$/),
    branch: /^[a-zA-Z0-9_./-]{1,120}$/.test(process.env.GITHUB_HEAD_REF ?? process.env.GITHUB_REF_NAME ?? "")
      ? process.env.GITHUB_HEAD_REF ?? process.env.GITHUB_REF_NAME : git(["branch", "--show-current"], /^[a-zA-Z0-9_./-]{1,120}$/),
    ciRun: /^\d+$/.test(process.env.GITHUB_RUN_ID ?? "") ? process.env.GITHUB_RUN_ID : "local",
    runtime: process.version, environment: process.env.GITHUB_ACTIONS === "true" ? "github-actions" : "local",
    layer, execution, dataset: "synthetic-only-v1"
  };
}
export function prepareResults(layer, execution, base = artifactRoot) {
  const raw = rawDirectory(layer, execution, base);
  const output = join(base, "allure-results", batch(layer, execution));
  rmSync(raw, { recursive: true, force: true }); rmSync(output, { recursive: true, force: true });
  mkdirSync(raw, { recursive: true });
  writeFileSync(join(raw, "dgi-run.json"), JSON.stringify(metadata(layer, execution)));
  return raw;
}

// Reject sensitive attachment content; result messages are projected rather than
// trying to redact arbitrary expected/actual values, DOM dumps, headers or prompts.
export function forbiddenText(value) {
  return /(?:sk-[a-zA-Z0-9_-]{8,}|Bearer\s+\S+|SYNTHETIC_(?:SECRET|API_KEY|PRIVATE)|["']?(?:api[_-]?key|authorization)["']?\s*[=:]\s*["']?[^\s"',}]{4,}|"name"\s*:\s*"authorization"|\b\d{1,6}\s+(?:[A-Za-z]+\s+){1,5}(?:Street|St|Avenue|Ave|Road|Rd|Lane|Ln|Drive|Dr)\b|[-+]?\d{1,3}\.\d{5,}\s*,\s*[-+]?\d{1,3}\.\d{5,})/i.test(value);
}
function safeText(value) {
  if (typeof value !== "string") return "Unnamed";
  if (forbiddenText(value)) return "[sensitive text withheld]";
  return value.replace(/https?:\/\/[^\s"'<>]+/g, "[URL withheld]")
    .replace(/(?:file:\/\/)?(?:\/Users\/|\/home\/|[A-Z]:\\)[^\s)]+/g, "[local path]")
    .replace(/[<>]/g, "").split("").filter((char) => char.charCodeAt(0) >= 32 || "\t\r\n".includes(char)).join("").slice(0, 1000);
}
function failure(details) {
  if (!details || (!details.message && !details.trace)) return undefined;
  const text = `${details.message ?? ""}\n${details.trace ?? ""}`;
  const kind = /AssertionError|expect\(|assert\./i.test(text) ? "assertion_failure" : /timeout|timed out/i.test(text) ? "timeout" : "test_or_setup_failure";
  const locations = [...text.matchAll(/(?:backend\/test|frontend\/src|e2e|scripts)\/[a-zA-Z0-9_./-]+\.(?:mjs|tsx?|js):\d+(?::\d+)?/g)].map((m) => m[0]);
  return { message: `${kind}: expected/actual values and raw diagnostics withheld by publishing policy`, trace: [...new Set(locations)].slice(0, 12).join("\n") };
}
function boundedFile(path, max = 20_000_000) {
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > max) throw new Error("Unsafe Allure result file");
  return readFileSync(path);
}
function png(buffer) { return buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])); }
function auditedTrace(buffer) {
  const zip = new AdmZip(buffer), entries = zip.getEntries();
  if (entries.length > 2000 || entries.reduce((n, e) => n + e.header.size, 0) > 50_000_000) return false;
  for (const entry of entries) {
    if (entry.header.size > 5_000_000 || entry.entryName.includes("..") || entry.entryName.startsWith("/") || /(?:^|\/)\.env(?:\.|$)/.test(entry.entryName)) return false;
    if (entry.isDirectory) continue;
    const bytes = entry.getData();
    if (png(bytes) || bytes.subarray(0, 3).equals(Buffer.from([255, 216, 255]))) continue;
    const text = bytes.toString("utf8");
    if (forbiddenText(text) || /https?:\/\/(?!127\.0\.0\.1(?::\d+)?(?:\/|\b)|www\.w3\.org\/2000\/svg)/i.test(text)) return false;
  }
  return true;
}
function attachments(items, raw, output, meta, audit) {
  return (Array.isArray(items) ? items : []).flatMap((item) => {
    if (typeof item.source !== "string" || basename(item.source) !== item.source) throw new Error("Unsafe Allure attachment reference");
    // Only this isolated E2E harness can authorize binary diagnostics. Never copy
    // stdout/stderr, arbitrary JSON/HTML, request bodies or environment attachments.
    if (meta.layer !== "e2e" || meta.dataset !== "synthetic-only-v1") { audit.omittedAttachments++; return []; }
    const isImage = item.type === "image/png" && /^test-failed-\d+$/.test(item.name);
    const isTrace = /^(?:application\/zip|application\/vnd\.allure\.playwright-trace)$/.test(item.type) && item.name === "trace";
    if (!isImage && !isTrace) { audit.omittedAttachments++; return []; }
    const bytes = boundedFile(join(raw, item.source));
    const image = isImage && png(bytes);
    const trace = isTrace && auditedTrace(bytes);
    if (!image && !trace) { audit.omittedAttachments++; return []; }
    const source = `${hash(bytes)}-attachment.${image ? "png" : "zip"}`;
    writeFileSync(join(output, source), bytes); audit.auditedAttachments++;
    return [{ name: image ? "Synthetic failure screenshot" : "Audited synthetic Playwright trace", source, type: item.type }];
  });
}
function project(item, raw, output, meta, audit) {
  const result = { name: safeText(item.name), status: statuses.has(item.status) ? item.status : "unknown",
    statusDetails: failure(item.statusDetails), steps: (item.steps ?? []).map((s) => project(s, raw, output, meta, audit)),
    attachments: attachments(item.attachments, raw, output, meta, audit) };
  for (const field of ["start", "stop"]) if (Number.isFinite(item[field]) && item[field] >= 0) result[field] = item[field];
  return result;
}
export function collectBatch(layer, execution, exitCode = null, base = artifactRoot) {
  const raw = rawDirectory(layer, execution, base), output = join(base, "allure-results", batch(layer, execution));
  const inputMeta = JSON.parse(boundedFile(join(raw, "dgi-run.json")).toString());
  if (inputMeta.layer !== layer || inputMeta.execution !== execution || inputMeta.dataset !== "synthetic-only-v1" ||
      !/^(?:[a-f0-9]{40,64}|unknown)$/.test(inputMeta.commit) || !/^[a-zA-Z0-9_./-]{1,120}$/.test(inputMeta.branch) ||
      !/^(?:\d+|local)$/.test(inputMeta.ciRun) || !/^v\d+\.\d+\.\d+$/.test(inputMeta.runtime) ||
      !["github-actions", "local"].includes(inputMeta.environment)) throw new Error("Invalid Allure run attestation");
  const meta = Object.fromEntries(["commit", "branch", "ciRun", "runtime", "environment", "layer", "execution", "dataset"].map((k) => [k, inputMeta[k]]));
  rmSync(output, { recursive: true, force: true }); mkdirSync(output, { recursive: true });
  const audit = { auditedAttachments: 0, omittedAttachments: 0 }, counts = {};
  for (const name of readdirSync(raw).sort()) {
    if (!name.endsWith("-result.json") && !name.endsWith("-container.json")) continue;
    const input = JSON.parse(boundedFile(join(raw, name)).toString());
    if (!/^[a-zA-Z0-9_-]{1,100}$/.test(input.uuid ?? "")) throw new Error("Invalid Allure result identity");
    let result;
    if (name.endsWith("-result.json")) {
      result = { ...project(input, raw, output, meta, audit), uuid: hash(input.uuid),
        fullName: safeText(input.fullName ?? input.name), historyId: hash(`${layer}/${execution}/${input.historyId ?? input.fullName ?? input.name}`),
        labels: (input.labels ?? []).filter((l) => ["parentSuite", "suite", "subSuite", "framework", "language", "package"].includes(l.name)).map((l) => ({ name: l.name, value: safeText(l.value) })),
        stage: "finished" };
      result.labels.push({ name: "layer", value: layer }, { name: "execution", value: execution });
      counts[result.status] = (counts[result.status] ?? 0) + 1;
    } else result = { uuid: hash(input.uuid), name: safeText(input.name), children: (input.children ?? []).filter((c) => /^[a-zA-Z0-9_-]{1,100}$/.test(c)).map(hash),
      befores: (input.befores ?? []).map((s) => project(s, raw, output, meta, audit)), afters: (input.afters ?? []).map((s) => project(s, raw, output, meta, audit)) };
    writeFileSync(join(output, `${result.uuid}-${name.endsWith("-result.json") ? "result" : "container"}.json`), JSON.stringify(result));
  }
  if (exitCode === 0 && !Object.keys(counts).length) throw new Error("No Allure test results were produced");
  const files = Object.fromEntries(readdirSync(output).sort().map((name) => [name, hash(readFileSync(join(output, name)))]));
  const manifest = { schemaVersion: 1, ...meta, testExitCode: exitCode, counts, ...audit, files };
  writeFileSync(join(output, "dgi-manifest.json"), JSON.stringify(manifest, null, 2));
  return manifest;
}
export function mergeResults(base = artifactRoot, allowPartial = false) {
  const directory = join(base, "allure-merged"); rmSync(directory, { recursive: true, force: true }); mkdirSync(directory, { recursive: true });
  const manifests = [], layers = new Set(), identities = new Set();
  for (const [layer, executions] of Object.entries(batches)) for (const execution of executions) {
    const from = join(base, "allure-results", layer, execution);
    if (!existsSync(from)) continue;
    const manifest = JSON.parse(boundedFile(join(from, "dgi-manifest.json")).toString());
    if (manifest.layer !== layer || manifest.execution !== execution) throw new Error("Allure manifest mismatch");
    const names = readdirSync(from).filter((n) => n !== "dgi-manifest.json").sort();
    if (JSON.stringify(names) !== JSON.stringify(Object.keys(manifest.files ?? {}).sort())) throw new Error("Missing or unexpected Allure files");
    manifests.push(manifest);
    for (const name of names) {
      const bytes = boundedFile(join(from, name));
      if (manifest.files?.[name] !== hash(bytes)) throw new Error("Unaudited or modified Allure file");
      if (name.endsWith("-result.json")) { const r = JSON.parse(bytes); if (identities.has(r.uuid)) throw new Error("Allure result UUID collision"); identities.add(r.uuid); layers.add(layer); }
      const destination = join(directory, name);
      if (existsSync(destination) && !readFileSync(destination).equals(bytes)) throw new Error("Allure file collision");
      writeFileSync(destination, bytes);
    }
  }
  if (!identities.size || (!allowPartial && layers.size !== 3)) throw new Error("Missing Allure test layers/results");
  if (new Set(manifests.map((m) => `${m.commit}/${m.ciRun}`)).size !== 1) throw new Error("Mixed Allure commits or CI runs; clean results first");
  const env = manifests[0];
  writeFileSync(join(directory, "environment.properties"), ["commit", "branch", "ciRun", "runtime", "environment", "dataset"].map((k) => `${k}=${env[k]}`).join("\n"));
  const summary = { schemaVersion: 1, results: identities.size, layers: [...layers].sort(), partial: layers.size !== 3, executions: manifests };
  writeFileSync(join(base, "allure-summary.json"), JSON.stringify(summary, null, 2));
  return summary;
}
export function cleanResults(base = artifactRoot) {
  for (const name of [".allure-raw", "allure-results", "allure-merged", "allure-report"]) rmSync(join(base, name), { recursive: true, force: true });
  rmSync(join(base, "allure-summary.json"), { force: true });
  rmSync(join(base, "allure-verification.json"), { force: true });
}
