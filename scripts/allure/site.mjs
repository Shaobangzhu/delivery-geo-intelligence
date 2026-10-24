import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// Post-process generated HTML only; never edit installed vendor bundles. Allure
// 3.22.1 hardcodes Google Analytics in its template without a disable option.
export function protectReport(output) {
  let count = 0;
  function protect(directory) {
    for (const item of readdirSync(directory, { withFileTypes: true })) {
      const file = join(directory, item.name);
      if (item.isDirectory()) protect(file);
      else if (item.name.endsWith(".html")) {
        const hashes = [];
        let html = readFileSync(file, "utf8").replace(/<meta\b[^>]*http-equiv="Content-Security-Policy"[^>]*>/gi, "");
        html = html.replace(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi, (tag, attributes, body) => {
          const source = attributes.match(/\bsrc\s*=\s*["']([^"']+)["']/i)?.[1];
          if (source) return /^(?:https?:|data:|\/\/)/i.test(source) ? "" : tag;
          if (/gtag\(|window\.dataLayer/.test(body)) return "";
          hashes.push(`'sha256-${createHash("sha256").update(body).digest("base64")}'`);
          return tag;
        });
        const csp = `default-src 'self'; script-src 'self' ${hashes.join(" ")}; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; worker-src 'self' blob:; object-src 'none'; base-uri 'self'`;
        html = html.replace(/<head>/i, `<head><meta http-equiv="Content-Security-Policy" content="${csp}">`);
        if (/googletagmanager|gtag\(/i.test(html)) throw new Error("Unexpected report analytics markup");
        writeFileSync(file, html); count++;
        // Awesome 3.22.1 fetches this optional widget even when its generator
        // omits it for zero performance samples. An empty collection preserves
        // "not observed" without inventing measurements or returning a 404.
        const widgets = join(directory, "widgets");
        if (existsSync(widgets) && !existsSync(join(widgets, "metrics.json"))) {
          writeFileSync(join(widgets, "metrics.json"), JSON.stringify({ current: [], history: [] }));
        }
      }
    }
  }
  protect(output);
  if (!count || !existsSync(join(output, "index.html"))) throw new Error("Allure produced no static index.html");
}
