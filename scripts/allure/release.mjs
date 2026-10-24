import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync, appendFileSync, cpSync, rmSync, readdirSync, lstatSync } from "node:fs";
import { join } from "node:path";
import { artifactRoot, root } from "./results.mjs";
import { apiClient, sourceRun, restoreHistory, saveHistoryManifest, repository, assertSource } from "./github.mjs";
import { stagePublication, verifyPublication, deployAllowed } from "./publication.mjs";
import { uploadReport } from "./upload.mjs";

const [command] = process.argv.slice(2);
const sourceFile = join(artifactRoot, "report-source.json");
const readSource = () => assertSource(JSON.parse(readFileSync(sourceFile)));
function context() {
  if (process.env.GITHUB_ACTIONS !== "true" || process.env.GITHUB_REPOSITORY !== repository || process.env.GITHUB_REF !== "refs/heads/main" ||
      !["workflow_run", "workflow_dispatch"].includes(process.env.GITHUB_EVENT_NAME)) throw new Error("report_release_context_rejected");
  return apiClient(process.env.GITHUB_TOKEN);
}
const run = (args, options = {}) => new Promise((ok, fail) => {
  const child = spawn(process.execPath, args, { cwd: root, stdio: "inherit", ...options });
  child.once("error", fail); child.once("exit", (code) => ok(code ?? 1));
});
function rejectLinks(directory) {
  if (lstatSync(directory).isSymbolicLink()) throw new Error("report_source_symlink_rejected");
  for (const item of readdirSync(directory, { withFileTypes: true })) {
    const file = join(directory, item.name);
    if (item.isSymbolicLink()) throw new Error("report_source_symlink_rejected");
    if (item.isDirectory()) rejectLinks(file);
    else if (!item.isFile()) throw new Error("report_source_special_file_rejected");
  }
}
try {
  mkdirSync(artifactRoot, { recursive: true });
  if (command === "source") {
    const source = await sourceRun(context(), process.env.SOURCE_CI_RUN_ID);
    if (source.sha !== process.env.GITHUB_SHA) throw new Error("report_publisher_superseded");
    writeFileSync(sourceFile, JSON.stringify(source, null, 2));
    if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `run_id=${source.runId}\nsha=${source.sha}\n`);
    console.log(`report_source_verified run=${source.runId} conclusion=${source.conclusion}`);
  } else if (command === "restore") {
    await restoreHistory(context(), join(artifactRoot, "allure-history"), readSource());
  } else if (command === "build" || command === "local") {
    const trusted = command === "build", source = trusted ? readSource() : null;
    if (trusted) {
      context();
      if (source.sha !== process.env.GITHUB_SHA) throw new Error("report_publisher_superseded");
      const from = join(artifactRoot, "ci-source/allure-results"); rejectLinks(from);
      const to = join(artifactRoot, "allure-results"); rmSync(to, { recursive: true, force: true }); cpSync(from, to, { recursive: true, dereference: false });
    }
    const code = await run([join(root, "scripts/allure/report.mjs"), "generate", "--allow-partial", "--public", ...(trusted ? ["--trusted-source"] : [])]);
    if (code) process.exitCode = code;
    else {
      if (trusted) saveHistoryManifest(join(artifactRoot, "allure-history"), source);
      const manifest = stagePublication(artifactRoot, source);
      console.log(`report_publication_audit=passed mode=${manifest.mode} bundleDigest=${manifest.bundleDigest}`);
    }
  } else if (command === "check" || command === "deploy") {
    const manifest = JSON.parse(readFileSync(join(artifactRoot, "publication-manifest.json")));
    verifyPublication(join(artifactRoot, "allure-publish"), manifest);
    if (command === "deploy") {
      if (!deployAllowed(process.env, manifest)) throw new Error("report_deployment_disabled_or_bundle_unreviewed");
      const latest = await sourceRun(context(), manifest.source.runId);
      if (latest.sha !== manifest.source.sha || latest.sha !== process.env.GITHUB_SHA) throw new Error("report_source_changed");
      if (!process.env.CLOUDFLARE_API_TOKEN || !/^[a-f0-9]{32}$/.test(process.env.CLOUDFLARE_ACCOUNT_ID ?? "")) throw new Error("report_cloudflare_configuration_missing");
      // A dedicated cwd/config prevents Wrangler from reading application .env
      // files or mistaking frontend/dist/backend/functions for deploy assets.
      process.exitCode = await uploadReport([join(root, "node_modules/wrangler/bin/wrangler.js"), "pages", "deploy",
        join(artifactRoot, "allure-publish"), "--project-name=dgi-quality-report", "--branch=main", `--commit-hash=${latest.sha}`, "--commit-dirty=false", "--commit-message=Sanitized quality report"], {
        cwd: join(root, "quality-report"), env: { PATH: process.env.PATH, HOME: process.env.HOME, CI: "true", WRANGLER_SEND_METRICS: "false",
          CLOUDFLARE_API_TOKEN: process.env.CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID: process.env.CLOUDFLARE_ACCOUNT_ID }
      });
    } else console.log(`report_publication_audit=passed mode=${manifest.mode} bundleDigest=${manifest.bundleDigest}`);
  } else throw new Error("report_release_command_rejected");
} catch (error) {
  // Do not print raw GitHub/Cloudflare payloads, signed artifact URLs, headers,
  // environment values or stack paths on any preparation/publication failure.
  console.error(/^report_[a-z0-9_]+$/.test(error.message) ? error.message : "report_release_failed"); process.exitCode = 1;
}
