import { test, expect, backend } from "./fixtures";
import type { Page } from "@playwright/test";

const provider = (page: Page, name: string) => page.getByRole("article").filter({ has: page.getByRole("heading", { name, exact: true }) });
async function mapEvents(page: Page) {
  return page.evaluate(() => (window as unknown as { __mapEvents: { name: string; layer?: string; count?: number }[] }).__mapEvents);
}
const summary = (page: Page, name: string) => page.getByTestId(`summary-${name}`);

test("Dashboard: real analytics, filters and offline SDK lifecycle survive navigation", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByRole("heading", { name: "Observed Delivery Activity", exact: true })).toBeVisible();
  await expect(summary(page, "deliveries")).toHaveText("2");
  await expect(summary(page, "earnings")).toHaveText("$25.00");
  await expect(page.getByRole("region", { name: "Efficiency Analytics", exact: true })).toContainText("$40.00");
  await expect.poll(async () => (await mapEvents(page)).filter((e) => e.name === "features_updated" && e.layer === "Observed merchant pickups").at(-1)?.count).toBe(2);

  await page.getByRole("group", { name: "Category", exact: true }).getByRole("button", { name: "Restaurant", exact: true }).click();
  await expect(summary(page, "deliveries")).toHaveText("1");
  await expect(summary(page, "earnings")).toHaveText("$12.50");
  await expect.poll(async () => (await mapEvents(page)).filter((e) => e.name === "features_updated" && e.layer === "Observed merchant pickups").at(-1)?.count).toBe(1);
  await page.getByRole("button", { name: "Month", exact: true }).click();
  await expect(summary(page, "deliveries")).toHaveText("2");
  await expect(summary(page, "earnings")).toHaveText("$22.50");
  await page.getByRole("button", { name: "Merchant Diversity", exact: true }).click();
  const heatmap = page.waitForResponse((r) => r.url().includes("/api/dashboard/destination-heatmap") && r.ok());
  await page.getByRole("button", { name: "Destination Heatmap", exact: true }).click();
  const cells = await (await heatmap).json();
  expect(cells.cells).toHaveLength(1);
  expect(cells.cells[0].count).toBe(2);
  await expect(page.getByLabel("Generalized destination activity map")).toBeVisible();
  await expect(page.getByText("Loading destination heatmap…")).toHaveCount(0);
  expect((await mapEvents(page)).filter((e) => e.name === "view_created")).toHaveLength(1);
  await page.getByRole("link", { name: "Data & Settings" }).click();
  await expect(provider(page, "ArcGIS Maps SDK (Browser)")).toContainText("Operational");
  await expect.poll(async () => (await mapEvents(page)).filter((e) => e.name === "view_destroyed").length).toBe(1);
});

test("Dashboard: SDK initialization failure is visible and session status is unavailable", async ({ page }) => {
  await page.addInitScript(() => sessionStorage.setItem("dgi:e2e:map-failure", "initialization"));
  await page.goto("/dashboard");
  await expect(page.getByRole("alert")).toContainText(/The map could not be initialized|The merchant locations could not be updated/);
  await expect(summary(page, "deliveries")).toHaveText("2");
  await page.getByRole("link", { name: "Data & Settings" }).click();
  await expect(provider(page, "ArcGIS Maps SDK (Browser)")).toContainText("Unavailable");
});

test("History: required fields, synthetic creation and edit persist through the real API", async ({ page, request }) => {
  await page.goto("/history");
  await expect(page.getByText("Showing 1–3 of 3 deliveries")).toBeVisible();
  await expect(page.getByRole("row").filter({ hasText: "Synthetic Market" })).toContainText("$7.50");
  await page.getByRole("button", { name: "Add Delivery", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Add Delivery", exact: true });
  await dialog.getByRole("button", { name: "Save Delivery", exact: true }).click();
  await expect(dialog.getByRole("alert")).toHaveText("Complete the required fields before saving.");
  await dialog.getByRole("combobox", { name: "Merchant", exact: true }).selectOption("111111111111111111111111");
  await dialog.getByLabel("Pickup Date & Time").fill("2026-03-08T11:30");
  await dialog.getByRole("textbox", { name: "Destination Address", exact: true }).fill("Synthetic destination zone A");
  await dialog.getByLabel("Payout", { exact: true }).fill("15.25");
  await dialog.getByLabel("Minutes", { exact: true }).fill("60");
  await dialog.getByRole("button", { name: "Save Delivery", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText("minutes and seconds from 0 to 59");
  await dialog.getByLabel("Minutes", { exact: true }).fill("15");
  await dialog.getByRole("button", { name: "Save Delivery", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  const created = page.getByRole("row").filter({ hasText: "$15.25" });
  await expect(created).toContainText("Location Ready");
  await created.getByRole("button", { name: "Edit delivery for Synthetic Cafe", exact: true }).click();
  await page.getByRole("dialog").getByLabel("Payout", { exact: true }).fill("16.75");
  await page.getByRole("button", { name: "Save Changes", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole("row").filter({ hasText: "$16.75" })).toContainText("15 mins");
  const persisted = await request.get("/api/deliveries");
  expect(persisted.ok()).toBeTruthy();
  expect(await persisted.text()).not.toContain("Synthetic destination zone A");
});

test("Merchants: validation, create, edit, delete and historical-reference protection", async ({ page }) => {
  await page.goto("/merchants");
  await expect(page.getByText("Showing 2 of 2 physical merchants")).toBeVisible();
  await page.getByRole("button", { name: "Add Merchant", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Add Merchant", exact: true });
  await dialog.getByRole("button", { name: "Save Merchant", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText("Complete the required fields");
  await dialog.getByLabel("Merchant Name").fill("Synthetic E2E Store");
  await dialog.getByRole("combobox", { name: "Category", exact: true }).selectOption("retail");
  await dialog.getByRole("textbox", { name: "City", exact: true }).fill("Synthetic City");
  await dialog.getByLabel("Public Business Address").fill("Synthetic business site C");
  await dialog.getByRole("button", { name: "Save Merchant", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await page.getByRole("row").filter({ hasText: "Synthetic E2E Store" }).getByRole("button", { name: /^Edit / }).click();
  await page.getByRole("dialog").getByLabel("Merchant Name").fill("Synthetic Edited Store");
  await page.getByRole("button", { name: "Save Changes", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.reload();
  const edited = page.getByRole("row").filter({ hasText: "Synthetic Edited Store" });
  await expect(edited).toBeVisible();
  await edited.getByRole("button", { name: /^Delete / }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Delete Merchant", exact: true }).click();
  await expect(edited).toHaveCount(0);
  await expect(page.getByText("Showing 2 of 2 physical merchants")).toBeVisible();
  await page.getByRole("row").filter({ hasText: "Synthetic Cafe" }).getByRole("button", { name: /^Delete / }).click();
  await expect(page.getByRole("dialog")).toContainText("has delivery history and cannot be deleted");
  await expect(page.getByRole("dialog").getByRole("button", { name: "Delete Merchant", exact: true })).toHaveCount(0);
});

test("Settings: unknown stays unknown; refresh reads actual synthetic failure without provider calls", async ({ page, request }) => {
  await page.goto("/settings");
  const refresh = page.getByRole("button", { name: "Refresh status", exact: true });
  await expect(refresh).toBeEnabled();
  await expect(provider(page, "ArcGIS Maps SDK (Browser)")).toContainText("Not Yet Verified");
  await expect(provider(page, "ArcGIS Geocoding API (Backend)")).toContainText("Not Yet Verified");
  await expect(provider(page, "OpenAI Analyst")).toContainText("Not Configured");
  const geocoding = page.getByRole("table").getByRole("row").filter({ has: page.getByRole("rowheader", { name: "ArcGIS Geocoding API (Backend)", exact: true }) });
  await expect(geocoding).toContainText("Unavailable");
  await expect(geocoding).not.toContainText("100.0%");
  expect((await request.post(`${backend}/__e2e/provider-failure`)).ok()).toBeTruthy();
  const freshStatus = page.waitForResponse((r) => new URL(r.url()).pathname === "/api/system/status" && r.ok());
  await refresh.click();
  await freshStatus;
  await expect(refresh).toBeEnabled();
  await expect(provider(page, "ArcGIS Geocoding API (Backend)")).toContainText("Unavailable");
  await expect(provider(page, "MongoDB")).toContainText("Operational");
  await expect(geocoding).toContainText("Rate Limit");
  await expect(geocoding).toContainText("0.0%");
  const snapshots = await request.get("/api/system/metrics?window=1h");
  const data = await snapshots.json();
  expect(data.providers.find((p: { provider: string }) => p.provider === "arcgis_geocoding").requestCount).toBe(1);
  expect(data.providers.find((p: { provider: string }) => p.provider === "openai").ai.providerCalls).toBe(0);
  const changedWindow = page.waitForResponse((r) => r.url().includes("/api/system/metrics?window=24h") && r.ok());
  await page.getByLabel("Observation window").selectOption("24h");
  await changedWindow;
  await expect(page.getByRole("table").getByRole("caption")).toHaveText("Retained backend observations · 24h");
});

test("Settings: backend 503 is visible and never suggests healthy providers", async ({ page }) => {
  await page.route("**/api/system/**", (route) => route.fulfill({ status: 503, json: { error: "synthetic_unavailable" } }));
  await page.goto("/settings");
  await expect(page.getByRole("alert")).toContainText("Backend data is unavailable or partial.");
  await expect(page.getByText("Backend providers: status unavailable.")).toBeVisible();
  await expect(page.getByText("Operational", { exact: true })).toHaveCount(0);
  await expect(provider(page, "ArcGIS Maps SDK (Browser)")).toContainText("Not Yet Verified");
});

test("Settings: a failed metrics endpoint preserves useful status results", async ({ page }) => {
  await page.route("**/api/system/metrics?*", (route) => route.fulfill({ status: 503, json: { error: "synthetic_unavailable" } }));
  await page.goto("/settings");
  await expect(page.getByRole("alert")).toContainText("Request metrics unavailable.");
  await expect(provider(page, "MongoDB")).toContainText("Operational");
  await expect(provider(page, "ArcGIS Geocoding API (Backend)")).toContainText("Not Yet Verified");
  await expect(page.getByText("No current metrics available.")).toBeVisible();
});

test("Settings: malformed API data is rejected safely", async ({ page }) => {
  await page.route("**/api/system/**", (route) => route.fulfill({ json: { schemaVersion: 1, providers: [{ status: "operational" }] } }));
  await page.goto("/settings");
  await expect(page.getByRole("alert")).toContainText("Backend data is unavailable or partial.");
  await expect(page.getByRole("heading", { name: "AI Usage", exact: true })).toBeVisible();
  await expect(page.getByText("Operational", { exact: true })).toHaveCount(0);
});

test("Mobile: all four routes remain usable at 390px", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/settings");
  await expect(page.getByRole("button", { name: "Refresh status", exact: true })).toBeEnabled();
  await expect(page.getByRole("region", { name: "Provider request metrics", exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
  for (const [name, heading] of [["Merchants", "Merchants"], ["History", "Delivery History"], ["Dashboard", "Observed Delivery Activity"], ["Data & Settings", "Data & Settings"]]) {
    await page.getByRole("navigation", { name: "Primary navigation" }).getByRole("link", { name, exact: true }).click();
    await expect(page.getByRole("heading", { level: 1, name: heading, exact: true })).toBeVisible();
  }
});
