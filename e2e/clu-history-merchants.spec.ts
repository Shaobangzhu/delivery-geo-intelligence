import { test, expect } from "./fixtures";

for (const width of [1280, 390]) test(`CLU native dialog keyboard, mouse-down and scrolling parity at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 844 });
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/history");
  await expect(page.getByText("Showing 1–3 of 3 deliveries", { exact: true })).toBeVisible();
  await expect(page.getByRole("region", { name: "Delivery records", exact: true }).getByRole("table")).toHaveClass(/clu-table/);
  const add = page.getByRole("button", { name: "Add Delivery", exact: true });
  await add.click();
  const dialog = page.getByRole("dialog", { name: "Add Delivery", exact: true });
  await expect(dialog).toHaveJSProperty("tagName", "DIALOG");
  await expect(dialog).toHaveAttribute("open", "");
  await expect(dialog).toHaveCSS("background-color", "rgb(255, 255, 255)");
  await expect(dialog.getByRole("combobox", { name: "Merchant", exact: true })).toHaveCSS("color-scheme", "light");
  await expect(dialog.getByRole("combobox", { name: "Merchant", exact: true })).toBeFocused();
  const close = dialog.getByRole("button", { name: "Close dialog", exact: true });
  await expect(close).toHaveCount(1);
  await close.focus(); await page.keyboard.press("Shift+Tab");
  await expect(dialog.getByRole("button", { name: "Save Delivery", exact: true })).toBeFocused();
  await page.keyboard.press("Tab"); await expect(close).toBeFocused();
  // Native interior traversal must remain inside the top-layer dialog too.
  await page.keyboard.press("Tab");
  expect(await page.evaluate(() => !!document.activeElement?.closest("dialog[open]"))).toBe(true);
  await page.keyboard.press("Escape"); await expect(dialog).toHaveCount(0); await expect(add).toBeFocused();
  await add.click();
  await page.mouse.move(2, 2); await page.mouse.down();
  await expect(dialog).toHaveCount(0); await page.mouse.up(); await expect(add).toBeFocused();
  await page.getByRole("button", { name: "Add Prop 22 Payment", exact: false }).click();
  const payment = page.getByRole("dialog", { name: "Add Prop 22 Payment", exact: true });
  await expect(payment.getByLabel("Payment Date *", { exact: true })).toBeFocused();
  await payment.getByLabel("Optional Notes", { exact: true }).fill("Synthetic optional note");
  await payment.getByText("Settlement Details (Optional)", { exact: true }).click();
  await payment.getByRole("button", { name: "Save Payment", exact: true }).scrollIntoViewIfNeeded();
  const dimensions = await payment.evaluate((node) => ({ top: node.getBoundingClientRect().top, bottom: node.getBoundingClientRect().bottom, height: innerHeight }));
  expect(dimensions.top).toBeGreaterThanOrEqual(0); expect(dimensions.bottom).toBeLessThanOrEqual(dimensions.height);
  await expect(payment.getByRole("button", { name: "Save Payment", exact: true })).toBeInViewport();
  await page.keyboard.press("Escape");
  await page.getByRole("link", { name: "Merchants", exact: true }).click();
  await expect(page.getByText("Showing 2 of 2 physical merchants", { exact: true })).toBeVisible();
  await expect(page.getByRole("region", { name: "Physical merchants", exact: true }).getByRole("table")).toHaveClass(/clu-table/);
  const merchantAdd = page.getByRole("button", { name: "Add Merchant", exact: true });
  await merchantAdd.click();
  await expect(page.getByRole("textbox", { name: "Merchant Name", exact: true })).toBeFocused();
  await page.keyboard.press("Escape"); await expect(merchantAdd).toBeFocused();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("CLU dialog blocks dismissal and duplicate saves, retains a failed merchant draft and permits retry", async ({ page }) => {
  let calls = 0, release!: () => void;
  const pending = new Promise<void>((resolve) => { release = resolve; });
  await page.route("**/api/merchants", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    calls++;
    if (calls === 1) { await pending; await route.fulfill({ status: 500, json: { error: "SYNTHETIC_PRIVATE_ERROR" } }); }
    else await route.continue();
  });
  await page.goto("/merchants");
  await page.getByRole("button", { name: "Add Merchant", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Add Merchant", exact: true });
  await dialog.getByRole("textbox", { name: "Merchant Name", exact: true }).fill("Synthetic CLU Store");
  await dialog.getByRole("combobox", { name: "Category", exact: true }).selectOption("retail");
  await dialog.getByRole("textbox", { name: "City", exact: true }).fill("Synthetic City");
  await dialog.getByLabel("Public Business Address", { exact: false }).fill("Synthetic business site CLU");
  await dialog.getByRole("button", { name: "Save Merchant", exact: true }).click();
  await expect(dialog).toHaveAttribute("aria-busy", "true");
  await expect(dialog.getByRole("button", { name: "Saving…", exact: true })).toBeDisabled();
  await expect(dialog.getByRole("button", { name: "Close dialog", exact: true })).toBeDisabled();
  await page.keyboard.press("Escape"); await page.mouse.click(2, 2);
  await expect(dialog).toBeVisible(); expect(calls).toBe(1);
  release();
  await expect(dialog.getByRole("alert")).toBeVisible();
  await expect(dialog.getByRole("alert")).not.toContainText("SYNTHETIC_PRIVATE_ERROR");
  await expect(dialog.getByRole("textbox", { name: "Merchant Name", exact: true })).toHaveValue("Synthetic CLU Store");
  await dialog.getByRole("button", { name: "Save Merchant", exact: true }).click();
  await expect(dialog).toHaveCount(0); expect(calls).toBe(2);
  await expect(page.getByRole("button", { name: "Add Merchant", exact: true })).toBeFocused();
});

test("merchant delete race remains blocked on 409 and deleted triggers return focus to Add", async ({ page, request }) => {
  const created = await request.post("/api/merchants", { data: { name: "Synthetic unused CLU", category: "retail", city: "Synthetic City", publicAddress: "Synthetic business site CLU delete" } });
  expect(created.ok()).toBeTruthy(); const { data: merchant } = await created.json();
  await page.goto("/merchants");
  const row = page.getByRole("row").filter({ hasText: "Synthetic unused CLU" });
  await row.getByRole("button", { name: /^Delete / }).click();
  await page.route(`**/api/merchants/${merchant.id}`, (route) => route.fulfill({ status: 409, json: { error: "Synthetic reference conflict" } }));
  await page.getByRole("button", { name: "Delete Merchant", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Delete merchant?", exact: true });
  await expect(dialog.getByRole("alert")).toContainText("has delivery history and cannot be deleted");
  await expect(dialog.getByRole("button", { name: "Delete Merchant", exact: true })).toHaveCount(0);
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  await page.unroute(`**/api/merchants/${merchant.id}`);
  await row.getByRole("button", { name: /^Delete / }).click();
  await page.getByRole("button", { name: "Delete Merchant", exact: true }).click();
  await expect(row).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Add Merchant", exact: true })).toBeFocused();
});

test("all three History pagers stay independent with ten rows and preserve an edited delivery on page eight", async ({ page, request }) => {
  for (let index = 0; index < 78; index++) {
    expect((await request.post("/api/deliveries", { data: { platform: "uber_eats", merchantId: "111111111111111111111111", pickedUpAt: "2026-03-08T18:00:00Z" } })).ok()).toBeTruthy();
  }
  for (let index = 0; index < 11; index++) {
    expect((await request.post("/api/earnings-adjustments", { data: { type: "prop22_guarantee", platform: "uber_eats", paymentDate: "2026-03-08", amount: 1 } })).ok()).toBeTruthy();
    expect((await request.post("/api/delivery-sessions", { data: { startedAt: "2026-03-08T17:00:00Z", endedAt: "2026-03-08T18:00:00Z" } })).ok()).toBeTruthy();
  }
  await page.goto("/history");
  const deliveries = page.getByRole("navigation", { name: "Delivery pages", exact: true });
  for (let index = 1; index < 8; index++) await deliveries.getByRole("button", { name: "Next page", exact: true }).click();
  await expect(page.getByText("Showing 71–80 of 81 deliveries", { exact: true })).toBeVisible();
  for (const name of ["Prop 22 payment pages", "Delivery session pages"]) {
    const nav = page.getByRole("navigation", { name, exact: true });
    await nav.getByRole("button", { name: "Next page", exact: true }).click();
    await expect(nav.getByRole("button", { name: "Page 2", exact: true })).toHaveAttribute("aria-current", "page");
  }
  await expect(deliveries.getByRole("button", { name: "Page 8", exact: true })).toHaveAttribute("aria-current", "page");
  const table = page.getByRole("region", { name: "Delivery records", exact: true }).getByRole("table");
  await expect(table.getByRole("row")).toHaveCount(11);
  await table.getByRole("button", { name: /^Edit delivery/ }).first().click();
  await page.getByRole("dialog").getByLabel("Payout", { exact: true }).fill("0");
  const refreshed = page.waitForResponse(response => response.url().includes("/api/deliveries?") && new URL(response.url()).searchParams.get("page") === "8");
  await page.getByRole("button", { name: "Save Changes", exact: true }).click(); await refreshed;
  await expect(page.getByText("Showing 71–80 of 81 deliveries", { exact: true })).toBeVisible();
  for (const name of ["Prop 22 payment pages", "Delivery session pages"]) await expect(page.getByRole("navigation", { name, exact: true }).getByRole("button", { name: "Page 2", exact: true })).toHaveAttribute("aria-current", "page");
});
