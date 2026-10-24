import { spawn } from "node:child_process";

// Wrangler's raw stdout/stderr and debug payloads are never publication artifacts
// or console output. Only a bounded buffer, exit code and confirmed Pages URL
// are used; even an upstream error echoing credentials cannot print them.
export function uploadReport(args, options, { spawnImpl = spawn, log = console.log } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawnImpl(process.execPath, args, { ...options, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    const collect = (chunk) => { if (output.length < 1_000_000) output += chunk.toString().slice(0, 1_000_000 - output.length); };
    child.stdout.on("data", collect); child.stderr.on("data", collect);
    child.once("error", () => reject(new Error("report_cloudflare_process_failed")));
    child.once("close", (value) => {
      const code = value ?? 1;
      if (code) log(`report_cloudflare_upload_failed exit=${code}`);
      else {
        const candidate = output.match(/https:\/\/[a-z0-9.-]+\.pages\.dev\b/i)?.[0];
        const forbidden = [options.env?.CLOUDFLARE_API_TOKEN, options.env?.CLOUDFLARE_ACCOUNT_ID].filter(Boolean);
        const url = candidate && !forbidden.some((secret) => candidate.includes(secret)) ? candidate : null;
        log(url ? `report_cloudflare_upload_confirmed url=${url}` : "report_cloudflare_upload_confirmed");
      }
      resolve(code);
    });
  });
}
