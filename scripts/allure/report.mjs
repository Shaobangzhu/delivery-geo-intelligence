import { spawn } from "node:child_process";
import { writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { artifactRoot, root, cleanResults, mergeResults } from "./results.mjs";
import { protectReport } from "./site.mjs";
import { beforeHistory, afterHistory, historyName, writeHistory } from "./history.mjs";
import { publicInput } from "./publication.mjs";

const [command, ...args] = process.argv.slice(2);
const run = (argv, options = {}) => new Promise((resolve, reject) => {
  const child = spawn(process.execPath, argv, { cwd: root, stdio: "inherit", ...options });
  child.once("error", reject); child.once("exit", (code) => resolve(code ?? 1));
});
if (command === "clean") cleanResults();
else if (command === "generate") {
  const summary = mergeResults(artifactRoot, args.includes("--allow-partial"));
  const source = args.includes("--trusted-source") ? JSON.parse(readFileSync(join(artifactRoot, "report-source.json"))) : null;
  const input = args.includes("--public") ? publicInput(artifactRoot, summary, source).directory : join(artifactRoot, "allure-merged");
  const history = join(artifactRoot, "allure-history/history.jsonl"), name = historyName(summary);
  const previous = beforeHistory(history, name);
  try {
    const code = await run([join(root, "node_modules/allure/cli.js"), "generate", input,
      "--config", join(root, "allurerc.mjs"), "--output", join(artifactRoot, "allure-report"), "--clean"], {
      // Reporting needs no cloud/API tokens or raw CI environment. Metadata has
      // already been explicitly projected into environment.properties/manifests.
      env: { PATH: process.env.PATH, TZ: "UTC", HOME: process.env.TMPDIR ?? "/tmp", DGI_ALLURE_RUN_NAME: name }
    });
    if (code) { writeHistory(history, previous); process.exitCode = code; }
    else {
      const output = join(artifactRoot, "allure-report");
      protectReport(output);
      if (args.includes("--public")) {
        const banner = source ? `Source CI ${source.runId}: ${source.conclusion}. Test results remain independent of report publication.` : "Local dry run: publication disabled.";
        const index = join(output, "index.html");
        writeFileSync(index, readFileSync(index, "utf8").replace("<body>", `<body><aside aria-label="Report provenance" style="position:fixed;bottom:0;right:0;z-index:9999;background:#fff;color:#111;padding:4px 8px;border:1px solid #888;font:12px sans-serif">${banner}</aside>`));
      }
      afterHistory(history);
      writeFileSync(join(output, "dgi-summary.json"), JSON.stringify(summary, null, 2));
      console.log(`Allure static report: artifacts/allure-report/index.html (${summary.results} real test executions; partial=${summary.partial})`);
    }
  } catch (error) { writeHistory(history, previous); throw error; }
} else if (command === "test") {
  cleanResults();
  // Run every layer once; collect later layers even if an earlier test fails.
  // Test and reporting errors stay distinct, and the original test exit wins.
  let originalExit = 0;
  for (const argv of [["run", "test", "-w", "backend"], ["run", "test", "-w", "frontend"], ["run", "test:e2e"]]) {
    const code = await new Promise((resolve, reject) => {
      const child = spawn(process.platform === "win32" ? "npm.cmd" : "npm", argv, { cwd: root, stdio: "inherit" });
      child.once("error", reject); child.once("exit", (status) => resolve(status ?? 1));
    });
    if (code && !originalExit) originalExit = code;
  }
  const reporting = await run([join(root, "scripts/allure/report.mjs"), "generate", "--allow-partial"]);
  process.exitCode = originalExit || reporting;
} else throw new Error("Use clean, test or generate");
