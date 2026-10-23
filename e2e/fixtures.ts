import { test as base, expect } from "@playwright/test";

export { expect };
export const backend = "http://127.0.0.1:4310";
export const test = base.extend<{ isolatedApp: void }>({
  isolatedApp: [async ({ page, context, request, browser }, use, testInfo) => {
    const reset = await request.post(`${backend}/__e2e/reset`);
    expect(reset.ok()).toBeTruthy();
    expect(await reset.json()).toEqual({ synthetic: true, fixtureTime: "2026-03-08T20:00:00.000Z" });
    await page.clock.setFixedTime(new Date("2026-03-08T20:00:00.000Z"));
    const externalRequests: string[] = [], pageErrors: string[] = [];
    await context.route("**/*", async (route) => {
      const url = new URL(route.request().url());
      if (url.origin === "http://127.0.0.1:4311") await route.continue();
      else { externalRequests.push(url.protocol); await route.abort("blockedbyclient"); }
    });
    page.on("pageerror", () => pageErrors.push("uncaught_browser_error"));
    await page.addInitScript(() => {
      Object.assign(window, { __mapEvents: [] });
      window.addEventListener("dgi:e2e:map", (event) => {
        (window as unknown as { __mapEvents: unknown[] }).__mapEvents.push((event as CustomEvent).detail);
      });
    });
    await testInfo.attach("execution-metadata", {
      body: JSON.stringify({ node: process.version, browser: browser.version(), dataset: "synthetic-only-v1", retry: testInfo.retry, project: testInfo.project.name }),
      contentType: "application/json"
    });
    await use();
    expect(externalRequests, "No browser request may leave the synthetic app origin").toEqual([]);
    expect(pageErrors, "No uncaught browser errors").toEqual([]);
  }, { auto: true }]
});
