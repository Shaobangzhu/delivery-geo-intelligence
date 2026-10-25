import { createHash } from "node:crypto";
import { writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import AdmZip from "adm-zip";
import { normalizeHistory, writeHistory } from "./history.mjs";

export const repository = "Shaobangzhu/delivery-geo-intelligence";
export const historyArtifact = "quality-report-history-main";
export const releaseWorkflow = ".github/workflows/quality-report.yml";
export const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const digits = (value) => /^\d+$/.test(String(value));
const sha = (value) => /^[a-f0-9]{40}$/.test(value ?? "");
export function assertSource(source) {
  if (!source || Object.keys(source).some((key) => !["runId", "sha", "conclusion", "branch", "event", "repository"].includes(key)) ||
      !digits(source.runId) || !sha(source.sha) || !["success", "failure"].includes(source.conclusion) || source.branch !== "main" ||
      !["push", "workflow_dispatch"].includes(source.event) || source.repository !== repository) throw new Error("report_source_metadata_rejected");
  return source;
}
export function trustedRun(run, path = ".github/workflows/ci.yml") {
  return run?.repository?.full_name === repository && run?.head_repository?.full_name === repository &&
    run.head_branch === "main" && run.path === path && run.status === "completed" &&
    ["success", "failure"].includes(run.conclusion) && sha(run.head_sha) && digits(run.id) &&
    (path === releaseWorkflow ? ["workflow_run", "workflow_dispatch"] : ["push", "workflow_dispatch"]).includes(run.event);
}
export function apiClient(token, fetchImpl = fetch) {
  if (!token) throw new Error("report_github_token_missing");
  return async (path, binary = false) => {
    try {
      if (!path.startsWith(`/repos/${repository}/`)) throw new Error("report_github_path_rejected");
      let response = await fetchImpl(`https://api.github.com${path}`, {
        headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" },
        redirect: "manual", signal: AbortSignal.timeout(30_000)
      });
      if (binary && response.status === 302) {
        const url = new URL(response.headers.get("location"));
        if (url.protocol !== "https:" || url.username || url.password) throw new Error("report_artifact_redirect_rejected");
        // Signed storage URL receives no GitHub or Cloudflare authorization.
        response = await fetchImpl(url, { signal: AbortSignal.timeout(30_000), redirect: "error" });
      }
      if (response.status === 404 || response.status === 410) return null;
      if (!response.ok) throw new Error(`report_github_http_${response.status}`);
      if (!binary) return await response.json();
      const chunks = []; let size = 0;
      for await (const chunk of response.body) { size += chunk.length; if (size > 60_000_000) throw new Error("report_artifact_size_rejected"); chunks.push(chunk); }
      return Buffer.concat(chunks);
    } catch (error) {
      if (/^report_[a-z0-9_]+$/.test(error.message)) throw error;
      throw new Error("report_github_transport_failed");
    }
  };
}
export async function sourceRun(api, runId, { current = true } = {}) {
  if (!digits(runId)) throw new Error("report_source_id_rejected");
  const run = await api(`/repos/${repository}/actions/runs/${runId}`);
  if (!trustedRun(run)) throw new Error("report_source_untrusted");
  if (current) {
    const ref = await api(`/repos/${repository}/git/ref/heads/main`);
    if (ref?.object?.sha !== run.head_sha) throw new Error("report_source_superseded");
    const recent = await api(`/repos/${repository}/actions/workflows/ci.yml/runs?branch=main&status=completed&per_page=30`);
    const latest = recent?.workflow_runs?.find((candidate) => trustedRun(candidate));
    if (!latest || String(latest.id) !== String(run.id)) throw new Error("report_source_superseded");
  }
  return { runId: String(run.id), sha: run.head_sha, conclusion: run.conclusion, branch: "main", event: run.event, repository };
}
export async function restoreHistory(api, target, source, { log = console.log } = {}) {
  const file = join(target, "history.jsonl"); mkdirSync(target, { recursive: true });
  const reset = (reason) => { writeHistory(file, []); log(`allure_history_restore=${reason}`); return { reason, entries: 0 }; };
  let checked = 0;
  for (let page = 1; page <= 3; page++) {
    const result = await api(`/repos/${repository}/actions/workflows/quality-report.yml/runs?branch=main&status=completed&per_page=100&page=${page}`);
    if (!result) throw new Error("report_artifact_listing_missing");
    for (const run of result.workflow_runs ?? []) {
      if (!trustedRun(run, releaseWorkflow)) continue;
      if (++checked > 20) return reset("lookup_limit_no_usable_artifact");
      const artifacts = await api(`/repos/${repository}/actions/runs/${run.id}/artifacts?per_page=100`);
      const artifact = artifacts?.artifacts?.find((a) => a.name === historyArtifact && !a.expired);
      if (!artifact) continue;
      const bytes = await api(`/repos/${repository}/actions/artifacts/${artifact.id}/zip`, true);
      if (!bytes) continue; // Expired/deleted between listing and downloading.
      try {
        const zip = new AdmZip(bytes), entries = zip.getEntries();
        if (entries.length !== 2 || entries.some((e) => !["history.jsonl", "manifest.json"].includes(e.entryName) || e.header.size > 50_000_000)) throw new Error("invalid");
        const history = zip.readFile("history.jsonl"), manifest = JSON.parse(zip.readAsText("manifest.json"));
        assertSource(manifest.source);
        if (manifest.schemaVersion !== 1 || manifest.sha256 !== sha256(history) || !digits(manifest.source?.runId) || !sha(manifest.source?.sha)) throw new Error("invalid");
        if (BigInt(manifest.source.runId) > BigInt(source.runId)) continue;
        const original = await sourceRun(api, manifest.source.runId, { current: false });
        if (Object.keys(original).some((key) => original[key] !== manifest.source[key])) throw new Error("invalid");
        const normalized = normalizeHistory(history.toString());
        if (!normalized.some((entry) => entry.name === `DGI CI ${manifest.source.runId}`) ||
            normalized.some((entry) => !/^DGI CI \d+$/.test(entry.name) || BigInt(entry.name.slice(7)) > BigInt(manifest.source.runId))) throw new Error("invalid");
        writeHistory(file, normalized); log(`allure_history_restore=restored entries=${normalized.length}`);
        return { reason: "restored", entries: normalized.length };
      } catch (error) {
        // API availability/authorization is an infrastructure failure, not a
        // corrupt-history reset. Never log a raw provider response or token.
        if (/^report_github_/.test(error.message)) throw error;
        return reset("malformed_artifact_discarded");
      }
    }
    if ((result.workflow_runs ?? []).length < 100) return reset("first_run_or_expired");
  }
  return reset("lookup_limit_no_usable_artifact");
}
export function historyManifest(target, source) {
  const file = join(target, "history.jsonl");
  return { schemaVersion: 1, source, sha256: sha256(readFileSync(file)) };
}
export function saveHistoryManifest(target, source) {
  writeFileSync(join(target, "manifest.json"), JSON.stringify(historyManifest(target, source), null, 2));
}
