import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test, expect } from "./fixtures";

for (const width of [1280, 390]) test(`CLU Dashboard and Settings preserve controls and map lifecycle at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 844 });
  await page.goto("/dashboard");
  const deliveries = page.getByTestId("summary-deliveries");
  await expect(deliveries).toHaveText("2");
  await expect(deliveries).toHaveJSProperty("tagName", "STRONG");
  await expect(page.locator('.dashboard-page[data-clu-theme="light"] .clu-card').filter({ has: deliveries })).toHaveCount(1);
  await expect(page.getByTestId("summary-earnings")).toHaveJSProperty("tagName", "STRONG");
  await expect(page.locator("html[data-clu-theme], body[data-clu-theme]")).toHaveCount(0);
  const map = await page.locator(".dashboard-map-canvas").elementHandle();
  for (const name of ["Time period", "Map metric", "Category"]) {
    const group = page.getByRole("group", { name, exact: true });
    await expect(group.getByRole("radio")).toHaveCount(0);
    expect(await group.getByRole("button").evaluateAll((buttons) => buttons.every((button) => button.hasAttribute("aria-pressed")))).toBe(true);
  }
  await page.getByRole("button", { name: "Restaurant", exact: true }).click();
  await expect(deliveries).toHaveText("1");
  await page.getByRole("button", { name: "Month", exact: true }).click();
  await expect(deliveries).toHaveText("2");
  await page.getByRole("button", { name: "Merchant Diversity", exact: true }).click();
  expect(await map!.evaluate((node) => node === document.querySelector(".dashboard-map-canvas"))).toBe(true);
  const toggle = page.getByRole("button", { name: "Open analyst", exact: true });
  await toggle.focus();
  await expect(toggle).toBeFocused();
  await expect(toggle).toHaveCSS("outline-width", "3px");
  await expect(toggle).toHaveCSS("box-shadow", "none");
  const contrast = await toggle.evaluate((button) => {
    const css = getComputedStyle(button);
    const luminance = (color: string) => {
      const rgb = color.match(/[\d.]+/g)!.slice(0, 3).map(Number).map((n) => n / 255).map((n) => n <= .04045 ? n / 12.92 : ((n + .055) / 1.055) ** 2.4);
      return rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722;
    };
    const a = luminance(css.color), b = luminance(css.backgroundColor);
    return (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
  });
  expect(contrast).toBeGreaterThanOrEqual(4.5);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(await page.evaluate(() => (window as unknown as { __mapEvents: { name: string }[] }).__mapEvents.filter(e => e.name === "view_created").length)).toBe(1);
  await page.getByRole("link", { name: "Data & Settings", exact: true }).click();
  await expect(page.getByRole("button", { name: "Refresh status", exact: true })).toHaveClass(/clu-button/);
  await expect(page.getByRole("button", { name: "Refresh status", exact: true })).toBeEnabled();
  await expect(page.getByRole("article")).toHaveCount(8);
  const browser = page.getByRole("article").filter({ has: page.getByRole("heading", { name: "ArcGIS Maps SDK (Browser)", exact: true }) });
  await expect(browser.locator(".clu-badge")).toHaveText("Operational");
  const windowSelect = page.getByRole("combobox", { name: "Observation window" });
  await expect(windowSelect).toHaveClass(/clu-control/);
  await windowSelect.focus();
  await windowSelect.selectOption("24h");
  await expect(windowSelect).toBeFocused();
  const region = page.getByRole("region", { name: "Provider request metrics", exact: true });
  await expect(region.getByRole("table")).toHaveClass(/clu-table/);
  await expect(region.getByRole("caption")).toHaveText("Retained backend observations · 24h");
  await region.focus(); await expect(region).toBeFocused();
  if (width === 390) {
    await region.press("ArrowRight");
    await expect.poll(() => region.evaluate((node) => node.scrollLeft)).toBeGreaterThan(0);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("CLU badges retain stale evidence and safe partial errors after refresh", async ({ page }) => {
  await page.goto("/settings");
  const refresh = page.getByRole("button", { name: "Refresh status", exact: true });
  await expect(refresh).toBeEnabled();
  await expect(page.getByText("Not Yet Verified", { exact: true })).toHaveCount(2);
  await page.route("**/api/system/**", (route) => route.fulfill({ status: 503, json: { error: "SYNTHETIC_UNAVAILABLE" } }));
  await refresh.click();
  await expect(page.getByRole("alert")).toContainText("retained status is stale");
  await expect(page.locator('.clu-badge[data-tone="unknown"]').filter({ hasText: "Stale · Operational" })).toHaveCount(1);
  await expect(page.getByRole("table")).toHaveCount(0);
  await expect(page.getByText("Unavailable · stale snapshot", { exact: true })).toBeVisible();
  await expect(page.getByText("SYNTHETIC_UNAVAILABLE", { exact: true })).toHaveCount(0);
});

test("packaged merchant table retains ten-row pages, ranks and noun-aware navigation", async ({ page }) => {
  let requests = 0;
  await page.route("**/api/dashboard?*", async (route) => {
    requests++;
    const response = await route.fetch();
    const data = await response.json();
    data.topMerchants = Array.from({ length: 21 }, (_, index) => ({ ...data.topMerchants[0], id: `synthetic-rank-${index}`, name: `Synthetic ranked merchant ${index + 1}` }));
    await route.fulfill({ response, json: data });
  });
  await page.goto("/dashboard");
  const table = page.getByRole("table", { name: "Top Merchants by Deliveries", exact: true });
  await expect(table.getByRole("row")).toHaveCount(11);
  await expect(page.getByText("Showing 1–10 of 21 merchants", { exact: true })).toBeVisible();
  const count = requests, nav = page.getByRole("navigation", { name: "Top merchant pages" });
  await nav.getByRole("button", { name: "Next page", exact: true }).click();
  await expect(table.getByRole("row").nth(1).getByRole("cell").first()).toHaveText("11");
  await expect(page.getByText("Showing 11–20 of 21 merchants", { exact: true })).toBeVisible();
  await nav.getByRole("button", { name: "Page 3", exact: true }).click();
  await expect(table.getByRole("row")).toHaveCount(2);
  await expect(page.getByText("Showing 21–21 of 21 merchants", { exact: true })).toBeVisible();
  expect(requests).toBe(count);
  await page.getByRole("button", { name: "Month", exact: true }).click();
  await expect(page.getByText("Showing 1–10 of 21 merchants", { exact: true })).toBeVisible();
  await expect(nav.getByRole("button", { name: "Page 1", exact: true })).toHaveAttribute("aria-current", "page");
});

test("CLU analyst buttons preserve submit, pending, abort, draft and safe errors", async ({ page }) => {
  let calls = 0, release!: () => void;
  const pending = new Promise<void>((resolve) => { release = resolve; });
  await page.route("**/api/ai/ask", async (route) => {
    calls++;
    if (calls === 1) await pending;
    await route.fulfill({ status: 503, json: { error: "SYNTHETIC_UNAVAILABLE" } });
  });
  await page.goto("/dashboard");
  await expect(page.getByTestId("summary-deliveries")).toHaveText("2");
  expect(calls).toBe(0);
  await page.getByRole("button", { name: "Open analyst", exact: true }).click();
  const question = page.getByRole("textbox", { name: "Your question", exact: true });
  await expect(question).toBeFocused();
  await expect(question).toHaveAttribute("maxlength", "1000");
  await question.fill("Explain synthetic recorded data");
  await page.getByRole("button", { name: "Ask", exact: true }).click();
  await expect(page.locator(".ask-dgi form")).toHaveAttribute("aria-busy", "true");
  await expect(page.getByRole("button", { name: "Analyzing…", exact: true })).toBeDisabled();
  await expect.poll(() => calls).toBe(1);
  await page.getByRole("button", { name: "Close analyst", exact: true }).click();
  await expect(page.getByRole("button", { name: "Open analyst", exact: true })).toBeFocused();
  release();
  await page.getByRole("button", { name: "Open analyst", exact: true }).click();
  await expect(question).toHaveValue("Explain synthetic recorded data");
  await expect(page.locator(".ask-dgi").getByRole("alert")).toHaveCount(0);
  await page.getByRole("button", { name: "Ask", exact: true }).click();
  await expect(page.locator(".ask-dgi").getByRole("alert")).toContainText("DGI analysis is unavailable");
  await expect(page.getByRole("button", { name: "Retry analysis", exact: true })).toBeEnabled();
  expect(calls).toBe(2);
  await expect(page.getByText("SYNTHETIC_UNAVAILABLE", { exact: true })).toHaveCount(0);
});

test("published CSS preserves native and ArcGIS/Calcite host sentinel styles inside and outside theme roots", async ({ page }) => {
  const css = readFileSync(createRequire(resolve("package.json")).resolve("@shaobangzhu/clu-ui/styles.css"), "utf8");
  await page.goto("/dashboard");
  const result = await page.evaluate(async (publishedCss) => {
    const frames: HTMLIFrameElement[] = [];
    const snapshots = [];
    const hostCss = 'button,input{font:17px/1.7 monospace;padding:7px;border:2px solid rgb(12,34,56);border-radius:3px;background:rgb(230,231,232);color:rgb(20,21,22)}.card,.table,.esri-widget,.calcite-button{font:15px/1.4 serif;background:rgb(240,241,242);border:3px solid rgb(30,40,50);padding:9px}';
    try {
      for (const withClu of [false, true]) {
        const frame = document.createElement("iframe");
        frame.style.cssText = "position:fixed;left:-10000px;width:400px;height:400px";
        const loaded = new Promise<void>((resolve) => { frame.onload = () => resolve(); });
        const probes = '<button>Host button</button><input value="Synthetic"><div class="card">Host card</div><table class="table"><tbody><tr><td>Host table</td></tr></tbody></table><button class="esri-widget">ArcGIS sentinel</button><button class="calcite-button">Calcite sentinel</button>';
        frame.srcdoc = `<style>${hostCss}${withClu ? publishedCss : ""}</style><div>${probes}</div><div data-clu-theme="light">${probes}</div>`;
        document.body.append(frame); frames.push(frame); await loaded;
        snapshots.push(Array.from(frame.contentDocument!.querySelectorAll("button,input,.card,.table")).map((element) => {
          const style = frame.contentWindow!.getComputedStyle(element);
          return Object.fromEntries(["fontFamily", "fontSize", "lineHeight", "padding", "border", "borderRadius", "backgroundColor", "color", "boxSizing"].map((key) => [key, style[key as keyof CSSStyleDeclaration]]));
        }));
      }
    } finally { frames.forEach((frame) => frame.remove()); }
    return snapshots;
  }, css);
  expect(result[1]).toEqual(result[0]);
});
