import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createReadStream, statSync } from "node:fs";
import { resolve, sep, extname } from "node:path";
import { chromium } from "@playwright/test";

export async function verifyStaticSite(directory) {
  const root = resolve(directory);
  const mime = { ".html": "text/html", ".js": "application/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".woff2": "font/woff2" };
  const server = createServer((req, res) => {
    try {
      const pathname = decodeURIComponent(new URL(req.url, "http://127.0.0.1").pathname);
      const file = resolve(root, `.${pathname.endsWith("/") ? `${pathname}index.html` : pathname}`);
      if (!file.startsWith(`${root}${sep}`) || !statSync(file).isFile()) { res.writeHead(404).end(); return; }
      res.writeHead(200, { "Content-Type": mime[extname(file)] ?? "application/octet-stream" });
      createReadStream(file).pipe(res);
    } catch { res.writeHead(404).end(); }
  });
  await new Promise((ok, fail) => { server.once("error", fail); server.listen(0, "127.0.0.1", ok); });
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ serviceWorkers: "block" });
    const origin = `http://127.0.0.1:${server.address().port}`;
    let externalRequests = 0;
    await context.route("**/*", (route) => {
      if (new URL(route.request().url()).origin === origin) return route.continue();
      externalRequests++; return route.abort();
    });
    const page = await context.newPage(), errors = [];
    page.on("response", (response) => { if (response.status() >= 400) errors.push(`HTTP ${response.status()}: ${new URL(response.url()).pathname}`); });
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
    const response = await page.goto(origin, { waitUntil: "load" });
    assert.equal(response.status(), 200);
    await page.waitForFunction(() => (globalThis.document.querySelector("#app")?.textContent?.trim().length ?? 0) > 30, null, { timeout: 15_000 });
    assert.equal(externalRequests, 0, "static report must not request external analytics/resources");
    assert.deepEqual(errors, [], "static report must render under its CSP without browser errors");
    return { rendered: true, externalRequests, browserErrors: errors.length };
  } finally {
    await browser?.close();
    server.closeAllConnections(); await new Promise((ok) => server.close(ok));
  }
}
