import { createHash } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { forbiddenText } from "./results.mjs";

export const HISTORY_LIMIT = 30;
const statuses = new Set(["passed", "failed", "broken", "skipped", "unknown"]);
const identifier = /^[a-f0-9.-]{16,150}$/;
export function assertPublicText(value) {
  if (typeof value !== "string" || value.length > 4000 || forbiddenText(value) ||
      /[<>]|https?:\/\/|(?:\/Users\/|\/home\/|[A-Z]:\\)|(?:file|mongodb(?:\+srv)?|javascript|data):|\$\{|\{\{|[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(value)) throw new Error("report_privacy_text_rejected");
  return value;
}
export function auditJson(value, depth = 0) {
  if (depth > 30) throw new Error("report_privacy_depth_rejected");
  if (typeof value === "string") assertPublicText(value);
  else if (Array.isArray(value)) value.forEach((item) => auditJson(item, depth + 1));
  else if (value && typeof value === "object") for (const [key, item] of Object.entries(value)) {
    assertPublicText(key);
    if (/^(?:prompt|completion|commands?|authorization|api[_-]?key|accessToken|customerRecords?|deliveryRecords?|residentialAddress|address|latitude|longitude|coordinates)$/i.test(key)) throw new Error("report_privacy_field_rejected");
    if (["parameters", "attachments", "links", "reportLinks"].includes(key) && (!Array.isArray(item) || item.length)) throw new Error("report_privacy_field_rejected");
    auditJson(item, depth + 1);
  }
}
export function readBounded(file, limit = 50_000_000) {
  const stat = lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > limit) throw new Error("report_unsafe_file");
  return readFileSync(file);
}
function canonical(entry) {
  if (!entry || !/^DGI (?:CI \d+|local [a-f0-9]{16})$/.test(entry.name) || !identifier.test(entry.uuid) ||
      !Number.isSafeInteger(entry.timestamp) || entry.timestamp <= 0 || !Array.isArray(entry.knownTestCaseIds) ||
      !entry.knownTestCaseIds.every((id) => identifier.test(id)) || !entry.testResults || typeof entry.testResults !== "object" || Array.isArray(entry.testResults)) throw new Error("report_history_schema_rejected");
  auditJson(entry);
  const testResults = {};
  for (const [key, item] of Object.entries(entry.testResults)) {
    if (!identifier.test(key) || !identifier.test(item.id) || !statuses.has(item.status) ||
        !Array.isArray(item.retries ?? []) || !(item.retries ?? []).every((s) => statuses.has(s))) throw new Error("report_history_test_rejected");
    const result = { id: item.id, name: assertPublicText(item.name), status: item.status, retries: item.retries ?? [], url: "", reportLinks: [] };
    for (const field of ["fullName", "environment", "retryHash", "message", "trace"]) if (item[field] !== undefined) result[field] = assertPublicText(item[field]);
    for (const field of ["start", "stop", "duration"]) if (item[field] !== undefined) {
      if (!Number.isFinite(item[field]) || item[field] < 0) throw new Error("report_history_timing_rejected");
      result[field] = item[field];
    }
    result.labels = (item.labels ?? []).map(({ name, value }) => ({ name: assertPublicText(name), value: assertPublicText(value) }));
    testResults[key] = result;
  }
  // Only actual test outcomes/timings are retained. No environment, URLs,
  // arbitrary metrics, prompts, raw commands or attachment bodies survive.
  return { uuid: entry.uuid, name: entry.name, timestamp: entry.timestamp,
    knownTestCaseIds: [...new Set(entry.knownTestCaseIds)], testResults, metrics: {}, url: "" };
}
export function normalizeHistory(text) {
  if (Buffer.byteLength(text) > 50_000_000) throw new Error("report_history_size_rejected");
  const unique = new Map();
  for (const line of text.split(/\r?\n/).filter((line) => line.trim())) {
    if (Buffer.byteLength(line) > 2_000_000) throw new Error("report_history_line_rejected");
    const item = canonical(JSON.parse(line)); unique.set(item.name, item);
  }
  return [...unique.values()].sort((a, b) => a.timestamp - b.timestamp || a.name.localeCompare(b.name)).slice(-HISTORY_LIMIT);
}
export function writeHistory(file, entries) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(`${file}.tmp`, entries.map((item) => JSON.stringify(item)).join("\n") + (entries.length ? "\n" : ""));
  renameSync(`${file}.tmp`, file);
}
export function historyName(summary) {
  const id = summary.executions[0].ciRun;
  return /^\d+$/.test(id) ? `DGI CI ${id}` : `DGI local ${createHash("sha256").update(JSON.stringify(summary.executions.map((m) => m.files))).digest("hex").slice(0, 16)}`;
}
export function beforeHistory(file, name) {
  const previous = existsSync(file) ? normalizeHistory(readBounded(file).toString()) : [];
  writeHistory(file, previous.filter((entry) => entry.name !== name).slice(-(HISTORY_LIMIT - 1)));
  return previous;
}
export function afterHistory(file) {
  const entries = normalizeHistory(readBounded(file).toString()); writeHistory(file, entries); return entries;
}
